/**
 * AEGIS Feedback Loop Manager
 * Manages AI refinement loops for iterative improvement
 */

import { Logger } from '../utils/logger.js';
import { ErrorHandler, ErrorFeedback, RecoveryAction } from './error-handler.js';
import { ContextProvider, UnrealContext } from './context-provider.js';

// ============================================================================
// Types
// ============================================================================

export interface LoopIteration {
  id: string;
  attempt: number;
  timestamp: string;
  request: LoopRequest;
  response?: LoopResponse;
  error?: ErrorFeedback;
  feedback?: RefinementFeedback;
  status: IterationStatus;
  durationMs?: number;
}

export interface LoopRequest {
  command: string;
  params: Record<string, unknown>;
  context?: UnrealContext;
  previousAttempts?: number;
}

export interface LoopResponse {
  success: boolean;
  result?: Record<string, unknown>;
  needsRefinement: boolean;
  refinementHints?: string[];
}

export interface RefinementFeedback {
  type: 'parameter_adjustment' | 'alternative_approach' | 'context_update' | 'retry';
  message: string;
  suggestedChanges?: Record<string, unknown>;
  contextUpdate?: Partial<UnrealContext>;
  alternativeCommand?: string;
  alternativeParams?: Record<string, unknown>;
}

export type IterationStatus = 'pending' | 'executing' | 'succeeded' | 'failed' | 'refining';

export interface LoopConfig {
  maxAttempts: number;
  backoffMultiplier: number;
  initialDelayMs: number;
  maxDelayMs: number;
  enableContextRefresh: boolean;
  enableAutoRefinement: boolean;
  refinementStrategies: RefinementStrategy[];
}

export interface RefinementStrategy {
  name: string;
  errorCodes: string[];
  apply: (
    error: ErrorFeedback,
    request: LoopRequest,
    context: UnrealContext | undefined
  ) => Promise<RefinementFeedback | null>;
}

export interface LoopSession {
  id: string;
  startTime: string;
  endTime?: string;
  iterations: LoopIteration[];
  finalStatus: 'running' | 'success' | 'failed' | 'cancelled';
  summary?: LoopSummary;
}

export interface LoopSummary {
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  totalDurationMs: number;
  refinementCount: number;
  finalResult?: Record<string, unknown>;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: LoopConfig = {
  maxAttempts: 5,
  backoffMultiplier: 2,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  enableContextRefresh: true,
  enableAutoRefinement: true,
  refinementStrategies: [],
};

// ============================================================================
// Default Refinement Strategies
// ============================================================================

const defaultStrategies: RefinementStrategy[] = [
  {
    name: 'actor_not_found',
    errorCodes: ['ACTOR_NOT_FOUND'],
    apply: async (error, request, _context) => {
      return {
        type: 'context_update',
        message: 'Actor not found. Suggesting to query available actors first.',
        alternativeCommand: 'aegis.core.query_actors',
        alternativeParams: {
          filter: { class: request.params.actorClass },
          limit: 10,
        },
      };
    },
  },
  {
    name: 'validation_error',
    errorCodes: ['COMMAND_VALIDATION_FAILED'],
    apply: async (error, request, _context) => {
      // Try to extract validation details and suggest fixes
      const violations = error.context.violations as string[] | undefined;
      if (violations) {
        const suggestedChanges: Record<string, unknown> = {};

        for (const violation of violations) {
          // Parse violation and suggest fixes
          if (violation.includes('required')) {
            const field = violation.split(':')[0]?.trim();
            if (field) {
              suggestedChanges[field] = null; // Indicate required field
            }
          }
        }

        return {
          type: 'parameter_adjustment',
          message: `Validation failed: ${violations.join(', ')}`,
          suggestedChanges,
        };
      }

      return null;
    },
  },
  {
    name: 'rate_limit',
    errorCodes: ['RATE_LIMIT_EXCEEDED'],
    apply: async (_error, _request, _context) => {
      return {
        type: 'retry',
        message: 'Rate limit exceeded. Will retry after delay.',
      };
    },
  },
  {
    name: 'connection_error',
    errorCodes: ['UE_CONNECTION_FAILED'],
    apply: async (_error, _request, _context) => {
      return {
        type: 'retry',
        message: 'Connection failed. Will retry with connection check.',
      };
    },
  },
];

// ============================================================================
// Loop Manager Implementation
// ============================================================================

export class LoopManager {
  private errorHandler: ErrorHandler;
  private contextProvider: ContextProvider;
  private config: LoopConfig;
  private logger: Logger;
  private sessions: Map<string, LoopSession> = new Map();
  private strategies: RefinementStrategy[];

  constructor(
    errorHandler: ErrorHandler,
    contextProvider: ContextProvider,
    config: Partial<LoopConfig> = {},
    logger: Logger
  ) {
    this.errorHandler = errorHandler;
    this.contextProvider = contextProvider;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger.child({ component: 'LoopManager' });
    this.strategies = [...defaultStrategies, ...this.config.refinementStrategies];

    this.logger.info('Loop manager initialized', {
      maxAttempts: this.config.maxAttempts,
      strategiesCount: this.strategies.length,
    });
  }

  /**
   * Execute a command with automatic retry and refinement
   */
  async executeWithLoop(
    command: string,
    params: Record<string, unknown>,
    executor: (cmd: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>,
    sessionId?: string
  ): Promise<LoopSession> {
    const session = this.createSession(sessionId);

    try {
      let currentCommand = command;
      let currentParams = { ...params };
      let attempt = 0;
      let delay = this.config.initialDelayMs;

      while (attempt < this.config.maxAttempts && session.finalStatus === 'running') {
        attempt++;

        // Optionally refresh context
        let context: UnrealContext | undefined;
        if (this.config.enableContextRefresh) {
          try {
            context = await this.contextProvider.gatherContext();
          } catch (error) {
            this.logger.debug('Failed to refresh context', { error });
          }
        }

        const iteration = this.createIteration(session, attempt, {
          command: currentCommand,
          params: currentParams,
          context,
          previousAttempts: attempt - 1,
        });

        try {
          // Execute the command
          iteration.status = 'executing';
          const startTime = Date.now();

          const result = await executor(currentCommand, currentParams);

          iteration.durationMs = Date.now() - startTime;
          iteration.response = {
            success: true,
            result,
            needsRefinement: false,
          };
          iteration.status = 'succeeded';

          // Success!
          session.finalStatus = 'success';
          session.endTime = new Date().toISOString();

          this.logger.info('Loop completed successfully', {
            sessionId: session.id,
            attempts: attempt,
            totalDurationMs: this.calculateTotalDuration(session),
          });

          break;
        } catch (error) {
          iteration.durationMs = Date.now() - Date.parse(iteration.timestamp);

          // Handle the error
          const feedback = this.errorHandler.handleError(error);
          iteration.error = feedback;
          iteration.status = 'failed';

          // Check if we should refine
          if (
            this.config.enableAutoRefinement &&
            this.errorHandler.isRecoverable(error) &&
            attempt < this.config.maxAttempts
          ) {
            const refinement = await this.findRefinementStrategy(
              feedback,
              { command: currentCommand, params: currentParams, context },
              context
            );

            if (refinement) {
              iteration.feedback = refinement;
              iteration.status = 'refining';

              // Apply refinement
              if (refinement.alternativeCommand) {
                currentCommand = refinement.alternativeCommand;
              }
              if (refinement.alternativeParams) {
                currentParams = refinement.alternativeParams;
              }
              if (refinement.suggestedChanges) {
                currentParams = { ...currentParams, ...refinement.suggestedChanges };
              }

              this.logger.info('Applying refinement', {
                sessionId: session.id,
                attempt,
                refinementType: refinement.type,
                message: refinement.message,
              });
            }
          }

          // Wait before retry
          if (attempt < this.config.maxAttempts) {
            await this.delay(delay);
            delay = Math.min(delay * this.config.backoffMultiplier, this.config.maxDelayMs);
          }
        }
      }

      // Check final status
      if (session.finalStatus === 'running') {
        session.finalStatus = 'failed';
        session.endTime = new Date().toISOString();

        this.logger.warn('Loop exhausted all attempts', {
          sessionId: session.id,
          attempts: attempt,
        });
      }

      // Generate summary
      session.summary = this.generateSummary(session);

      return session;
    } catch (error) {
      session.finalStatus = 'failed';
      session.endTime = new Date().toISOString();
      session.summary = this.generateSummary(session);
      throw error;
    }
  }

  /**
   * Cancel a running session
   */
  cancelSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session && session.finalStatus === 'running') {
      session.finalStatus = 'cancelled';
      session.endTime = new Date().toISOString();
      session.summary = this.generateSummary(session);
      return true;
    }
    return false;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): LoopSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): LoopSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clear old sessions
   */
  clearOldSessions(maxAge: number = 3600000): void {
    const cutoff = Date.now() - maxAge;

    for (const [id, session] of this.sessions) {
      if (session.endTime && Date.parse(session.endTime) < cutoff) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Add a custom refinement strategy
   */
  addStrategy(strategy: RefinementStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * Get configuration
   */
  getConfig(): LoopConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<LoopConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createSession(existingId?: string): LoopSession {
    const id = existingId || `loop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const session: LoopSession = {
      id,
      startTime: new Date().toISOString(),
      iterations: [],
      finalStatus: 'running',
    };

    this.sessions.set(id, session);
    return session;
  }

  private createIteration(
    session: LoopSession,
    attempt: number,
    request: LoopRequest
  ): LoopIteration {
    const iteration: LoopIteration = {
      id: `${session.id}_${attempt}`,
      attempt,
      timestamp: new Date().toISOString(),
      request,
      status: 'pending',
    };

    session.iterations.push(iteration);
    return iteration;
  }

  private async findRefinementStrategy(
    error: ErrorFeedback,
    request: LoopRequest,
    context: UnrealContext | undefined
  ): Promise<RefinementFeedback | null> {
    for (const strategy of this.strategies) {
      if (strategy.errorCodes.includes(error.code)) {
        try {
          const refinement = await strategy.apply(error, request, context);
          if (refinement) {
            return refinement;
          }
        } catch (strategyError) {
          this.logger.debug('Strategy failed', {
            strategy: strategy.name,
            error: strategyError,
          });
        }
      }
    }

    // Fall back to recovery actions from error
    if (error.recoveryActions.length > 0) {
      return this.recoveryActionToRefinement(error.recoveryActions[0]);
    }

    return null;
  }

  private recoveryActionToRefinement(action: RecoveryAction): RefinementFeedback {
    switch (action.type) {
      case 'retry':
        return {
          type: 'retry',
          message: action.description,
        };
      case 'alternative':
        return {
          type: 'alternative_approach',
          message: action.description,
          alternativeCommand: action.command,
          alternativeParams: action.params,
        };
      case 'query':
        return {
          type: 'context_update',
          message: action.description,
          alternativeCommand: action.command,
          alternativeParams: action.params,
        };
      default:
        return {
          type: 'retry',
          message: action.description,
        };
    }
  }

  private generateSummary(session: LoopSession): LoopSummary {
    const successfulAttempts = session.iterations.filter((i) => i.status === 'succeeded').length;
    const failedAttempts = session.iterations.filter((i) => i.status === 'failed').length;
    const refinementCount = session.iterations.filter((i) => i.status === 'refining').length;

    const lastSuccessful = session.iterations.find((i) => i.status === 'succeeded');

    return {
      totalAttempts: session.iterations.length,
      successfulAttempts,
      failedAttempts,
      totalDurationMs: this.calculateTotalDuration(session),
      refinementCount,
      finalResult: lastSuccessful?.response?.result,
    };
  }

  private calculateTotalDuration(session: LoopSession): number {
    return session.iterations.reduce((total, i) => total + (i.durationMs || 0), 0);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createLoopManager(
  errorHandler: ErrorHandler,
  contextProvider: ContextProvider,
  logger: Logger,
  config?: Partial<LoopConfig>
): LoopManager {
  return new LoopManager(errorHandler, contextProvider, config, logger);
}
