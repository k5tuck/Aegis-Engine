/**
 * AEGIS Error Handler
 * Structured error handling with AI-friendly feedback for refinement loops
 */

import { Logger } from '../utils/logger.js';
import { AegisError } from '../utils/errors.js';

// ============================================================================
// Types
// ============================================================================

export interface ErrorFeedback {
  code: string;
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  suggestion: string;
  recoveryActions: RecoveryAction[];
  context: Record<string, unknown>;
  timestamp: string;
}

export type ErrorCategory =
  | 'validation'
  | 'connection'
  | 'execution'
  | 'security'
  | 'rate_limit'
  | 'not_found'
  | 'permission'
  | 'timeout'
  | 'internal'
  | 'configuration';

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface RecoveryAction {
  type: 'retry' | 'rollback' | 'alternative' | 'manual' | 'query' | 'wait';
  description: string;
  command?: string;
  params?: Record<string, unknown>;
  waitMs?: number;
}

export interface ErrorPattern {
  code: string | RegExp;
  category: ErrorCategory;
  severity: ErrorSeverity;
  suggestion: string;
  recoveryActions: RecoveryAction[];
}

// ============================================================================
// Default Error Patterns
// ============================================================================

const DEFAULT_ERROR_PATTERNS: ErrorPattern[] = [
  // Connection errors
  {
    code: 'UE_CONNECTION_FAILED',
    category: 'connection',
    severity: 'error',
    suggestion:
      'Check that Unreal Engine is running and Remote Control API plugin is enabled. Verify port 30020 is accessible.',
    recoveryActions: [
      { type: 'retry', description: 'Retry connection in 5 seconds', waitMs: 5000 },
      { type: 'manual', description: 'Start Unreal Engine editor and enable Remote Control API' },
    ],
  },

  // Validation errors
  {
    code: 'COMMAND_VALIDATION_FAILED',
    category: 'validation',
    severity: 'warning',
    suggestion: 'Review the command parameters and fix validation errors.',
    recoveryActions: [
      { type: 'query', description: 'Query available commands', command: 'aegis.core.list_commands' },
      { type: 'alternative', description: 'Use a different command or parameters' },
    ],
  },

  // Not found errors
  {
    code: 'ACTOR_NOT_FOUND',
    category: 'not_found',
    severity: 'warning',
    suggestion: 'The specified actor does not exist. Query available actors first.',
    recoveryActions: [
      {
        type: 'query',
        description: 'Query actors in current level',
        command: 'aegis.core.query_actors',
      },
    ],
  },
  {
    code: 'ASSET_NOT_FOUND',
    category: 'not_found',
    severity: 'warning',
    suggestion: 'The specified asset does not exist. Query available assets first.',
    recoveryActions: [
      {
        type: 'query',
        description: 'Query assets',
        command: 'aegis.core.query_assets',
      },
    ],
  },

  // Security errors
  {
    code: 'SECURITY_VIOLATION',
    category: 'security',
    severity: 'error',
    suggestion: 'This action is blocked by security policy. Contact administrator if needed.',
    recoveryActions: [{ type: 'manual', description: 'Request security policy update' }],
  },
  {
    code: 'RATE_LIMIT_EXCEEDED',
    category: 'rate_limit',
    severity: 'warning',
    suggestion: 'Too many actions in a short period. Wait before sending more commands.',
    recoveryActions: [
      { type: 'wait', description: 'Wait 60 seconds before retrying', waitMs: 60000 },
    ],
  },

  // Execution errors
  {
    code: 'EXECUTION_FAILED',
    category: 'execution',
    severity: 'error',
    suggestion: 'The action failed during execution. Check error details and retry.',
    recoveryActions: [
      { type: 'retry', description: 'Retry the action' },
      { type: 'rollback', description: 'Rollback to previous state' },
    ],
  },
  {
    code: 'BLUEPRINT_COMPILE_ERROR',
    category: 'execution',
    severity: 'error',
    suggestion: 'Blueprint compilation failed. Check the Output Log in Unreal Engine.',
    recoveryActions: [
      { type: 'query', description: 'Get blueprint details', command: 'aegis.core.query_blueprint' },
      { type: 'manual', description: 'Review blueprint in Unreal Editor' },
    ],
  },

  // Timeout errors
  {
    code: /TIMEOUT/i,
    category: 'timeout',
    severity: 'warning',
    suggestion: 'The operation timed out. This may be due to a complex operation or slow connection.',
    recoveryActions: [
      { type: 'retry', description: 'Retry with longer timeout' },
      { type: 'alternative', description: 'Break down into smaller operations' },
    ],
  },

  // Preview errors
  {
    code: 'PREVIEW_EXPIRED',
    category: 'validation',
    severity: 'info',
    suggestion: 'The action preview has expired. Create a new preview by re-sending the command.',
    recoveryActions: [{ type: 'retry', description: 'Re-create preview' }],
  },
];

// ============================================================================
// Error Handler Implementation
// ============================================================================

export class ErrorHandler {
  private patterns: ErrorPattern[];
  private logger: Logger;
  private errorHistory: ErrorFeedback[] = [];
  private maxHistorySize: number = 100;

  constructor(logger: Logger, customPatterns?: ErrorPattern[]) {
    this.logger = logger.child({ component: 'ErrorHandler' });
    this.patterns = customPatterns
      ? [...DEFAULT_ERROR_PATTERNS, ...customPatterns]
      : DEFAULT_ERROR_PATTERNS;
  }

  /**
   * Process an error and generate AI-friendly feedback
   */
  handleError(error: unknown, context: Record<string, unknown> = {}): ErrorFeedback {
    const feedback = this.createFeedback(error, context);

    // Log the error
    this.logger.error('Error processed', error instanceof Error ? error : undefined, {
      errorCode: feedback.code,
      category: feedback.category,
      severity: feedback.severity,
    });

    // Store in history
    this.recordError(feedback);

    return feedback;
  }

  /**
   * Create error feedback from an error
   */
  createFeedback(error: unknown, context: Record<string, unknown> = {}): ErrorFeedback {
    // Handle AegisError instances
    if (error instanceof AegisError) {
      const pattern = this.findPattern(error.code);
      return {
        code: error.code,
        message: error.message,
        category: pattern?.category || 'internal',
        severity: pattern?.severity || 'error',
        suggestion: pattern?.suggestion || error.toAIFeedback().suggestion,
        recoveryActions: pattern?.recoveryActions || [],
        context: { ...error.context, ...context },
        timestamp: new Date().toISOString(),
      };
    }

    // Handle standard errors
    if (error instanceof Error) {
      const pattern = this.findPatternByMessage(error.message);
      return {
        code: 'UNKNOWN_ERROR',
        message: error.message,
        category: pattern?.category || 'internal',
        severity: pattern?.severity || 'error',
        suggestion: pattern?.suggestion || 'An unexpected error occurred. Please retry.',
        recoveryActions: pattern?.recoveryActions || [{ type: 'retry', description: 'Retry the operation' }],
        context,
        timestamp: new Date().toISOString(),
      };
    }

    // Handle unknown errors
    return {
      code: 'UNKNOWN_ERROR',
      message: String(error),
      category: 'internal',
      severity: 'error',
      suggestion: 'An unexpected error occurred.',
      recoveryActions: [],
      context,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get recovery suggestions for an error
   */
  getRecoverySuggestions(errorCode: string): RecoveryAction[] {
    const pattern = this.findPattern(errorCode);
    return pattern?.recoveryActions || [];
  }

  /**
   * Check if an error is recoverable
   */
  isRecoverable(error: unknown): boolean {
    if (error instanceof AegisError) {
      return error.recoverable;
    }
    const feedback = this.createFeedback(error);
    return feedback.severity !== 'critical' && feedback.recoveryActions.length > 0;
  }

  /**
   * Get error history
   */
  getErrorHistory(limit: number = 20): ErrorFeedback[] {
    return this.errorHistory.slice(-limit);
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    total: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
  } {
    const byCategory: Record<ErrorCategory, number> = {
      validation: 0,
      connection: 0,
      execution: 0,
      security: 0,
      rate_limit: 0,
      not_found: 0,
      permission: 0,
      timeout: 0,
      internal: 0,
      configuration: 0,
    };

    const bySeverity: Record<ErrorSeverity, number> = {
      info: 0,
      warning: 0,
      error: 0,
      critical: 0,
    };

    for (const feedback of this.errorHistory) {
      byCategory[feedback.category]++;
      bySeverity[feedback.severity]++;
    }

    return {
      total: this.errorHistory.length,
      byCategory,
      bySeverity,
    };
  }

  /**
   * Clear error history
   */
  clearHistory(): void {
    this.errorHistory = [];
  }

  /**
   * Add a custom error pattern
   */
  addPattern(pattern: ErrorPattern): void {
    this.patterns.push(pattern);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private findPattern(code: string): ErrorPattern | undefined {
    return this.patterns.find((p) => {
      if (typeof p.code === 'string') {
        return p.code === code;
      }
      return p.code.test(code);
    });
  }

  private findPatternByMessage(message: string): ErrorPattern | undefined {
    return this.patterns.find((p) => {
      if (p.code instanceof RegExp) {
        return p.code.test(message);
      }
      return message.toLowerCase().includes(p.code.toLowerCase());
    });
  }

  private recordError(feedback: ErrorFeedback): void {
    this.errorHistory.push(feedback);

    // Trim history if too large
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createErrorHandler(
  logger: Logger,
  customPatterns?: ErrorPattern[]
): ErrorHandler {
  return new ErrorHandler(logger, customPatterns);
}
