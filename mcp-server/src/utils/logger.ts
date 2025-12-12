/**
 * AEGIS Structured Logging
 * Provides pino-based logging with context management
 */

import pino from 'pino';
import { AegisError } from './errors.js';

export interface LogContext {
  requestId?: string;
  sessionId?: string;
  conversationId?: string;
  tool?: string;
  action?: string;
  plugin?: string;
  component?: string;
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: Error | AegisError, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  trace(message: string, data?: Record<string, unknown>): void;
  fatal(message: string, error?: Error, data?: Record<string, unknown>): void;
  child(additionalContext: LogContext): Logger;
  startTimer(): () => number;
}

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    service: 'aegis-mcp',
    version: process.env.npm_package_version || '1.0.0',
  },
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['*.apiKey', '*.password', '*.token', '*.secret'],
    censor: '[REDACTED]',
  },
});

class PinoLogger implements Logger {
  private pinoInstance: pino.Logger;
  private context: LogContext;

  constructor(context: LogContext = {}, pinoInstance?: pino.Logger) {
    this.context = context;
    this.pinoInstance = pinoInstance || baseLogger.child(context);
  }

  child(additionalContext: LogContext): Logger {
    const newContext = { ...this.context, ...additionalContext };
    return new PinoLogger(newContext, this.pinoInstance.child(additionalContext));
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.pinoInstance.info(data, message);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.pinoInstance.warn(data, message);
  }

  error(message: string, error?: Error | AegisError, data?: Record<string, unknown>): void {
    const errorData =
      error instanceof AegisError
        ? error.toJSON()
        : error
          ? { message: error.message, stack: error.stack, name: error.name }
          : undefined;
    this.pinoInstance.error({ ...data, error: errorData }, message);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.pinoInstance.debug(data, message);
  }

  trace(message: string, data?: Record<string, unknown>): void {
    this.pinoInstance.trace(data, message);
  }

  fatal(message: string, error?: Error, data?: Record<string, unknown>): void {
    const errorData = error
      ? { message: error.message, stack: error.stack, name: error.name }
      : undefined;
    this.pinoInstance.fatal({ ...data, error: errorData }, message);
  }

  startTimer(): () => number {
    const start = process.hrtime.bigint();
    return () => Number(process.hrtime.bigint() - start) / 1_000_000;
  }
}

// Singleton logger instance
export const logger: Logger = new PinoLogger();

// Factory function for creating loggers with context
export function createLogger(context: LogContext = {}): Logger {
  return new PinoLogger(context);
}

// Utility for logging performance metrics
export interface PerformanceMetrics {
  operationName: string;
  durationMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export function logPerformance(log: Logger, metrics: PerformanceMetrics): void {
  const level = metrics.success ? 'info' : 'warn';
  log[level](`Performance: ${metrics.operationName}`, {
    durationMs: metrics.durationMs,
    success: metrics.success,
    ...metrics.metadata,
  });
}

// Request logging middleware context
export interface RequestLogContext extends LogContext {
  method?: string;
  path?: string;
  statusCode?: number;
  responseTime?: number;
}

export function logRequest(log: Logger, context: RequestLogContext): void {
  log.info(`${context.method} ${context.path}`, {
    statusCode: context.statusCode,
    responseTime: context.responseTime,
  });
}

// Audit logging for security-sensitive operations
export interface AuditLogEntry {
  action: string;
  userId?: string;
  sessionId: string;
  target?: string;
  result: 'success' | 'failure' | 'blocked';
  reason?: string;
  metadata?: Record<string, unknown>;
}

export function logAudit(log: Logger, entry: AuditLogEntry): void {
  log.info(`AUDIT: ${entry.action}`, {
    audit: true,
    ...entry,
  });
}
