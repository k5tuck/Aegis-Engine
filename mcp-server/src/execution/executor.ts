/**
 * AEGIS Action Executor
 * Orchestrates action execution with safety checks, previews, and rollback
 */

import { Logger } from '../utils/logger.js';
import { ExecutionError, AegisError } from '../utils/errors.js';
import { SecuritySandbox, ValidationResult } from './sandbox.js';
import { SafeModeManager, ActionPreview, ChangePreview } from './safe-mode.js';
import { RollbackManager, RollbackState } from './rollback.js';
import { generateRequestId } from '../utils/helpers.js';

// ============================================================================
// Types
// ============================================================================

export interface ExecutionContext {
  sessionId: string;
  userId?: string;
  requestId: string;
  safeModeOverride?: boolean;
  skipValidation?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ExecutionRequest {
  command: string;
  params: Record<string, unknown>;
  context: ExecutionContext;
}

export interface ExecutionResult {
  success: boolean;
  requestId: string;
  command: string;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
    recoverable: boolean;
  };
  preview?: ActionPreview;
  rollbackId?: string;
  executionTimeMs: number;
  metadata?: Record<string, unknown>;
}

export interface CommandHandler {
  (params: Record<string, unknown>, context: ExecutionContext): Promise<{
    result: Record<string, unknown>;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
  }>;
}

export interface ChangeAnalyzer {
  (params: Record<string, unknown>, context: ExecutionContext): Promise<ChangePreview[]>;
}

export interface ExecutorConfig {
  defaultTimeout: number;
  enableRollback: boolean;
  enableMetrics: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ExecutorConfig = {
  defaultTimeout: 30000, // 30 seconds
  enableRollback: true,
  enableMetrics: true,
};

// ============================================================================
// Executor Implementation
// ============================================================================

export class ActionExecutor {
  private sandbox: SecuritySandbox;
  private safeMode: SafeModeManager;
  private rollback: RollbackManager;
  private handlers: Map<string, CommandHandler> = new Map();
  private analyzers: Map<string, ChangeAnalyzer> = new Map();
  private config: ExecutorConfig;
  private logger: Logger;

  // Metrics
  private executionCount: number = 0;
  private successCount: number = 0;
  private errorCount: number = 0;
  private totalExecutionTime: number = 0;

  constructor(
    sandbox: SecuritySandbox,
    safeMode: SafeModeManager,
    rollback: RollbackManager,
    config: Partial<ExecutorConfig> = {},
    logger: Logger
  ) {
    this.sandbox = sandbox;
    this.safeMode = safeMode;
    this.rollback = rollback;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger.child({ component: 'ActionExecutor' });

    this.logger.info('Action executor initialized');
  }

  /**
   * Register a command handler
   */
  registerHandler(command: string, handler: CommandHandler, analyzer?: ChangeAnalyzer): void {
    this.handlers.set(command, handler);
    if (analyzer) {
      this.analyzers.set(command, analyzer);
    }
    this.logger.debug('Handler registered', { command });
  }

  /**
   * Unregister a command handler
   */
  unregisterHandler(command: string): void {
    this.handlers.delete(command);
    this.analyzers.delete(command);
    this.logger.debug('Handler unregistered', { command });
  }

  /**
   * Check if a command has a registered handler
   */
  hasHandler(command: string): boolean {
    return this.handlers.has(command);
  }

  /**
   * Get all registered commands
   */
  getRegisteredCommands(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Execute a command
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const timer = this.logger.startTimer();
    const { command, params, context } = request;

    this.logger.info('Executing command', {
      command,
      requestId: context.requestId,
      sessionId: context.sessionId,
    });

    try {
      // 1. Check if handler exists
      const handler = this.handlers.get(command);
      if (!handler) {
        throw new ExecutionError(command, 'No handler registered for this command', false);
      }

      // 2. Validate against security policies
      if (!context.skipValidation) {
        const validation = this.sandbox.validateAction(
          command,
          this.getTarget(params),
          params,
          context.sessionId
        );

        if (!validation.valid) {
          return this.createErrorResult(
            context.requestId,
            command,
            'VALIDATION_FAILED',
            validation.reason || 'Validation failed',
            timer()
          );
        }

        // 3. Check if safe mode preview is required
        if (
          this.safeMode.isEnabled() &&
          !context.safeModeOverride &&
          validation.requiresApproval
        ) {
          const preview = await this.createPreview(command, params, context);

          if (!preview.approved) {
            return {
              success: true,
              requestId: context.requestId,
              command,
              preview,
              executionTimeMs: timer(),
              metadata: { requiresApproval: true },
            };
          }
        }
      }

      // 4. Execute the command
      const { result, previousState, newState } = await this.executeWithTimeout(
        handler,
        params,
        context
      );

      // 5. Record for rollback if enabled
      let rollbackId: string | undefined;
      if (this.config.enableRollback && previousState) {
        const rollbackState = this.rollback.recordState(
          context.requestId,
          command,
          this.getTarget(params),
          previousState,
          newState || result,
          context.sessionId
        );
        rollbackId = rollbackState.id;
      }

      // 6. Record action in sandbox
      this.sandbox.recordAction(command, this.getTarget(params), true, context.sessionId);

      // 7. Update metrics
      this.recordSuccess(timer());

      this.logger.info('Command executed successfully', {
        command,
        requestId: context.requestId,
        executionTimeMs: timer(),
        rollbackId,
      });

      return {
        success: true,
        requestId: context.requestId,
        command,
        result,
        rollbackId,
        executionTimeMs: timer(),
      };
    } catch (error) {
      return this.handleError(error, context.requestId, command, timer());
    }
  }

  /**
   * Execute a previously approved preview
   */
  async executePreview(previewId: string, context: ExecutionContext): Promise<ExecutionResult> {
    const timer = this.logger.startTimer();
    const preview = this.safeMode.getPreview(previewId);

    if (!preview) {
      return this.createErrorResult(
        context.requestId,
        'execute_preview',
        'PREVIEW_NOT_FOUND',
        `Preview ${previewId} not found or expired`,
        timer()
      );
    }

    if (!preview.approved) {
      return this.createErrorResult(
        context.requestId,
        preview.command,
        'PREVIEW_NOT_APPROVED',
        'Preview has not been approved',
        timer()
      );
    }

    if (preview.executed) {
      return this.createErrorResult(
        context.requestId,
        preview.command,
        'PREVIEW_ALREADY_EXECUTED',
        'Preview has already been executed',
        timer()
      );
    }

    try {
      const result = await this.execute({
        command: preview.command,
        params: preview.params,
        context: {
          ...context,
          safeModeOverride: true, // Skip safe mode since preview was approved
        },
      });

      // Mark preview as executed
      this.safeMode.markExecuted(previewId, result.result, result.error?.message);

      return result;
    } catch (error) {
      this.safeMode.markExecuted(previewId, undefined, String(error));
      throw error;
    }
  }

  /**
   * Rollback a previous action
   */
  async rollbackAction(rollbackId: string, context: ExecutionContext): Promise<ExecutionResult> {
    const timer = this.logger.startTimer();

    if (!this.rollback.canRollback(rollbackId)) {
      return this.createErrorResult(
        context.requestId,
        'rollback',
        'ROLLBACK_NOT_AVAILABLE',
        'Rollback is not available for this action',
        timer()
      );
    }

    try {
      const { command, params } = this.rollback.prepareRollback(rollbackId);

      const result = await this.execute({
        command,
        params,
        context: {
          ...context,
          skipValidation: true, // Skip validation for rollback
          metadata: { rollbackOf: rollbackId },
        },
      });

      if (result.success) {
        this.rollback.markRolledBack(rollbackId);
      }

      return result;
    } catch (error) {
      return this.handleError(error, context.requestId, 'rollback', timer());
    }
  }

  /**
   * Get execution metrics
   */
  getMetrics(): {
    totalExecutions: number;
    successCount: number;
    errorCount: number;
    successRate: number;
    averageExecutionTimeMs: number;
  } {
    const successRate =
      this.executionCount > 0 ? (this.successCount / this.executionCount) * 100 : 0;
    const averageTime =
      this.executionCount > 0 ? this.totalExecutionTime / this.executionCount : 0;

    return {
      totalExecutions: this.executionCount,
      successCount: this.successCount,
      errorCount: this.errorCount,
      successRate,
      averageExecutionTimeMs: averageTime,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.executionCount = 0;
    this.successCount = 0;
    this.errorCount = 0;
    this.totalExecutionTime = 0;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async createPreview(
    command: string,
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ActionPreview> {
    const analyzer = this.analyzers.get(command);

    const analyzeChanges = async (): Promise<ChangePreview[]> => {
      if (analyzer) {
        return analyzer(params, context);
      }
      // Default change preview
      return [
        {
          type: this.inferChangeType(command),
          target: this.getTarget(params),
          description: `Execute ${command}`,
        },
      ];
    };

    return this.safeMode.createPreview(
      command,
      params,
      analyzeChanges,
      context.sessionId,
      context.userId
    );
  }

  private async executeWithTimeout(
    handler: CommandHandler,
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<{
    result: Record<string, unknown>;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
  }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new ExecutionError(context.requestId, 'Execution timed out', true));
      }, this.config.defaultTimeout);

      handler(params, context)
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private handleError(
    error: unknown,
    requestId: string,
    command: string,
    executionTimeMs: number
  ): ExecutionResult {
    this.recordError(executionTimeMs);

    if (error instanceof AegisError) {
      this.logger.error('Command execution failed', error, { command, requestId });
      return {
        success: false,
        requestId,
        command,
        error: error.toAIFeedback(),
        executionTimeMs,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    this.logger.error('Command execution failed', error instanceof Error ? error : undefined, {
      command,
      requestId,
    });

    return {
      success: false,
      requestId,
      command,
      error: {
        code: 'EXECUTION_ERROR',
        message,
        recoverable: true,
      },
      executionTimeMs,
    };
  }

  private createErrorResult(
    requestId: string,
    command: string,
    code: string,
    message: string,
    executionTimeMs: number
  ): ExecutionResult {
    this.recordError(executionTimeMs);
    return {
      success: false,
      requestId,
      command,
      error: {
        code,
        message,
        recoverable: true,
      },
      executionTimeMs,
    };
  }

  private getTarget(params: Record<string, unknown>): string {
    return (
      (params.actorPath as string) ||
      (params.blueprintPath as string) ||
      (params.assetPath as string) ||
      (params.materialPath as string) ||
      (params.levelPath as string) ||
      (params.target as string) ||
      (params.path as string) ||
      ''
    );
  }

  private inferChangeType(command: string): ChangePreview['type'] {
    if (command.includes('create') || command.includes('spawn') || command.includes('add')) {
      return 'create';
    }
    if (command.includes('delete') || command.includes('remove')) {
      return 'delete';
    }
    if (command.includes('move')) {
      return 'move';
    }
    return 'modify';
  }

  private recordSuccess(executionTimeMs: number): void {
    if (this.config.enableMetrics) {
      this.executionCount++;
      this.successCount++;
      this.totalExecutionTime += executionTimeMs;
    }
  }

  private recordError(executionTimeMs: number): void {
    if (this.config.enableMetrics) {
      this.executionCount++;
      this.errorCount++;
      this.totalExecutionTime += executionTimeMs;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createExecutor(
  sandbox: SecuritySandbox,
  safeMode: SafeModeManager,
  rollback: RollbackManager,
  logger: Logger,
  config?: Partial<ExecutorConfig>
): ActionExecutor {
  return new ActionExecutor(sandbox, safeMode, rollback, config, logger);
}

/**
 * Create execution context with defaults
 */
export function createExecutionContext(
  sessionId: string,
  options?: Partial<Omit<ExecutionContext, 'sessionId' | 'requestId'>>
): ExecutionContext {
  return {
    sessionId,
    requestId: generateRequestId(),
    ...options,
  };
}
