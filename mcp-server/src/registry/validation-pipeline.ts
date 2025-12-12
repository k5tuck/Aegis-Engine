/**
 * AEGIS Validation Pipeline
 * Comprehensive validation flow for commands before execution
 */

import { z, ZodSchema } from 'zod';
import { Logger } from '../utils/logger.js';
import { CommandValidationError, SecurityViolationError } from '../utils/errors.js';
import { ValidationResult, ValidationError, validateSchema } from '../schema/validators.js';
import { CommandContext, RegisteredCommand, CommandAnnotations } from './plugin-types.js';
import { SecuritySandbox } from '../execution/sandbox.js';
import { SafeModeManager } from '../execution/safe-mode.js';

// ============================================================================
// Types
// ============================================================================

export interface ValidationStage {
  /** Stage name for identification */
  name: string;

  /** Stage priority (higher = runs first) */
  priority: number;

  /** Whether this stage is enabled */
  enabled: boolean;

  /** Whether failure in this stage is fatal */
  fatal: boolean;

  /** Validate function */
  validate: (
    input: ValidationInput,
    context: ValidationContext
  ) => Promise<ValidationStageResult>;
}

export interface ValidationInput {
  commandName: string;
  command: RegisteredCommand;
  params: unknown;
  rawParams?: unknown;
}

export interface ValidationContext {
  requestId: string;
  sessionId?: string;
  userId?: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface ValidationStageResult {
  passed: boolean;
  stageName: string;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  transformedParams?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}

export interface PipelineResult {
  valid: boolean;
  commandName: string;
  validatedParams?: unknown;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  stageResults: ValidationStageResult[];
  executionTimeMs: number;
  requiresApproval: boolean;
  riskLevel: string;
}

export interface ValidationPipelineConfig {
  /** Enable strict mode (all warnings become errors) */
  strictMode: boolean;

  /** Maximum validation time before timeout */
  timeoutMs: number;

  /** Enable parameter transformation */
  enableTransformation: boolean;

  /** Enable security validation */
  enableSecurityValidation: boolean;

  /** Enable safe mode integration */
  enableSafeModeIntegration: boolean;

  /** Custom stages to add */
  customStages: ValidationStage[];
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ValidationPipelineConfig = {
  strictMode: false,
  timeoutMs: 5000,
  enableTransformation: true,
  enableSecurityValidation: true,
  enableSafeModeIntegration: true,
  customStages: [],
};

// ============================================================================
// Validation Pipeline Implementation
// ============================================================================

export class ValidationPipeline {
  private stages: ValidationStage[] = [];
  private config: ValidationPipelineConfig;
  private logger: Logger;
  private securitySandbox?: SecuritySandbox;
  private safeModeManager?: SafeModeManager;

  constructor(
    config: Partial<ValidationPipelineConfig>,
    logger: Logger,
    securitySandbox?: SecuritySandbox,
    safeModeManager?: SafeModeManager
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger.child({ component: 'ValidationPipeline' });
    this.securitySandbox = securitySandbox;
    this.safeModeManager = safeModeManager;

    // Register default stages
    this.registerDefaultStages();

    // Register custom stages
    for (const stage of this.config.customStages) {
      this.registerStage(stage);
    }
  }

  /**
   * Set security sandbox for validation
   */
  setSecuritySandbox(sandbox: SecuritySandbox): void {
    this.securitySandbox = sandbox;
  }

  /**
   * Set safe mode manager for validation
   */
  setSafeModeManager(manager: SafeModeManager): void {
    this.safeModeManager = manager;
  }

  /**
   * Register a validation stage
   */
  registerStage(stage: ValidationStage): void {
    this.stages.push(stage);
    this.stages.sort((a, b) => b.priority - a.priority);

    this.logger.debug('Validation stage registered', {
      name: stage.name,
      priority: stage.priority,
    });
  }

  /**
   * Unregister a validation stage
   */
  unregisterStage(stageName: string): void {
    const index = this.stages.findIndex((s) => s.name === stageName);
    if (index !== -1) {
      this.stages.splice(index, 1);
    }
  }

  /**
   * Enable or disable a stage
   */
  setStageEnabled(stageName: string, enabled: boolean): void {
    const stage = this.stages.find((s) => s.name === stageName);
    if (stage) {
      stage.enabled = enabled;
    }
  }

  /**
   * Get all registered stages
   */
  getStages(): ValidationStage[] {
    return [...this.stages];
  }

  /**
   * Validate input through the pipeline
   */
  async validate(
    commandName: string,
    command: RegisteredCommand,
    params: unknown,
    context: ValidationContext
  ): Promise<PipelineResult> {
    const startTime = Date.now();

    const input: ValidationInput = {
      commandName,
      command,
      params,
      rawParams: params,
    };

    const allErrors: ValidationError[] = [];
    const allWarnings: ValidationWarning[] = [];
    const stageResults: ValidationStageResult[] = [];
    let currentParams = params;
    let requiresApproval = false;
    let riskLevel = command.definition.annotations?.riskLevel || 'low';

    this.logger.debug('Starting validation pipeline', {
      commandName,
      stageCount: this.stages.filter((s) => s.enabled).length,
    });

    // Run through stages
    for (const stage of this.stages) {
      if (!stage.enabled) {
        continue;
      }

      try {
        const stageInput: ValidationInput = {
          ...input,
          params: currentParams,
        };

        // Apply timeout
        const result = await this.executeWithTimeout(
          stage.validate(stageInput, context),
          this.config.timeoutMs,
          stage.name
        );

        stageResults.push(result);

        // Collect errors and warnings
        if (result.errors) {
          allErrors.push(...result.errors);
        }
        if (result.warnings) {
          allWarnings.push(...result.warnings);
        }

        // Apply transformation if available
        if (this.config.enableTransformation && result.transformedParams !== undefined) {
          currentParams = result.transformedParams;
        }

        // Update approval requirement
        if (result.metadata?.requiresApproval) {
          requiresApproval = true;
        }

        // Update risk level if higher
        if (result.metadata?.riskLevel) {
          const levels = ['low', 'medium', 'high', 'critical'];
          const currentIndex = levels.indexOf(riskLevel);
          const newIndex = levels.indexOf(result.metadata.riskLevel as string);
          if (newIndex > currentIndex) {
            riskLevel = result.metadata.riskLevel as string;
          }
        }

        // If stage failed and is fatal, stop pipeline
        if (!result.passed && stage.fatal) {
          this.logger.debug('Validation pipeline stopped by fatal stage', {
            stage: stage.name,
            errors: result.errors,
          });
          break;
        }
      } catch (error) {
        const errorResult: ValidationStageResult = {
          passed: false,
          stageName: stage.name,
          errors: [
            {
              path: '',
              message: error instanceof Error ? error.message : String(error),
              code: 'stage_error',
            },
          ],
        };

        stageResults.push(errorResult);
        allErrors.push(...(errorResult.errors || []));

        if (stage.fatal) {
          break;
        }
      }
    }

    // Convert warnings to errors in strict mode
    if (this.config.strictMode) {
      for (const warning of allWarnings) {
        allErrors.push({
          path: '',
          message: warning.message,
          code: warning.code,
        });
      }
    }

    const executionTimeMs = Date.now() - startTime;
    const valid = allErrors.length === 0;

    this.logger.debug('Validation pipeline completed', {
      commandName,
      valid,
      errorCount: allErrors.length,
      warningCount: allWarnings.length,
      executionTimeMs,
    });

    return {
      valid,
      commandName,
      validatedParams: valid ? currentParams : undefined,
      errors: allErrors,
      warnings: allWarnings,
      stageResults,
      executionTimeMs,
      requiresApproval,
      riskLevel,
    };
  }

  /**
   * Quick validation (schema only)
   */
  async quickValidate(
    command: RegisteredCommand,
    params: unknown
  ): Promise<ValidationResult<unknown>> {
    return validateSchema(command.definition.inputSchema, params);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private registerDefaultStages(): void {
    // Stage 1: Type Coercion
    this.registerStage({
      name: 'type_coercion',
      priority: 1000,
      enabled: true,
      fatal: false,
      validate: async (input) => {
        const coerced = this.coerceTypes(input.params);
        return {
          passed: true,
          stageName: 'type_coercion',
          transformedParams: coerced,
        };
      },
    });

    // Stage 2: Schema Validation
    this.registerStage({
      name: 'schema_validation',
      priority: 900,
      enabled: true,
      fatal: true,
      validate: async (input) => {
        const result = validateSchema(input.command.definition.inputSchema, input.params);

        if (result.success) {
          return {
            passed: true,
            stageName: 'schema_validation',
            transformedParams: result.data,
          };
        }

        return {
          passed: false,
          stageName: 'schema_validation',
          errors: result.errors,
        };
      },
    });

    // Stage 3: Semantic Validation
    this.registerStage({
      name: 'semantic_validation',
      priority: 800,
      enabled: true,
      fatal: true,
      validate: async (input) => {
        const semanticValidator = input.command.definition.semanticValidator;
        if (!semanticValidator) {
          return { passed: true, stageName: 'semantic_validation' };
        }

        const errors = await semanticValidator(input.params);
        if (errors.length === 0) {
          return { passed: true, stageName: 'semantic_validation' };
        }

        return {
          passed: false,
          stageName: 'semantic_validation',
          errors: errors.map((e) => ({
            path: e.path || '',
            message: e.message,
            code: 'semantic_error',
          })),
        };
      },
    });

    // Stage 4: Security Validation
    if (this.config.enableSecurityValidation) {
      this.registerStage({
        name: 'security_validation',
        priority: 700,
        enabled: true,
        fatal: true,
        validate: async (input, context) => {
          if (!this.securitySandbox) {
            return { passed: true, stageName: 'security_validation' };
          }

          const action = {
            type: input.commandName,
            target: this.extractTarget(input.params),
            params: input.params as Record<string, unknown>,
          };

          const result = this.securitySandbox.validateAction(action);

          if (!result.allowed) {
            return {
              passed: false,
              stageName: 'security_validation',
              errors: result.violations.map((v) => ({
                path: '',
                message: v,
                code: 'security_violation',
              })),
            };
          }

          return {
            passed: true,
            stageName: 'security_validation',
            metadata: {
              riskLevel: result.riskLevel,
              requiresApproval: result.requiresApproval,
            },
          };
        },
      });
    }

    // Stage 5: Reference Validation
    this.registerStage({
      name: 'reference_validation',
      priority: 600,
      enabled: true,
      fatal: false,
      validate: async (input) => {
        const warnings: ValidationWarning[] = [];

        // Check for common reference issues
        const params = input.params as Record<string, unknown>;

        // Validate asset paths
        if (typeof params.assetPath === 'string') {
          if (!params.assetPath.startsWith('/')) {
            warnings.push({
              code: 'invalid_asset_path',
              message: 'Asset path should start with /',
              suggestion: 'Use format: /Game/Path/AssetName',
            });
          }
        }

        // Validate class paths
        if (typeof params.classPath === 'string') {
          if (!params.classPath.startsWith('/Script/') && !params.classPath.startsWith('/Game/')) {
            warnings.push({
              code: 'suspicious_class_path',
              message: 'Class path may be invalid',
              suggestion: 'Use /Script/ModuleName.ClassName or /Game/Path/Blueprint.Blueprint_C',
            });
          }
        }

        return {
          passed: true,
          stageName: 'reference_validation',
          warnings,
        };
      },
    });

    // Stage 6: Safe Mode Integration
    if (this.config.enableSafeModeIntegration) {
      this.registerStage({
        name: 'safe_mode_check',
        priority: 500,
        enabled: true,
        fatal: false,
        validate: async (input) => {
          const annotations = input.command.definition.annotations;
          const riskLevel = annotations?.riskLevel || 'low';
          const requiresPreview = annotations?.requiresPreview ?? false;

          const metadata: Record<string, unknown> = {
            riskLevel,
          };

          // Determine if approval is needed based on risk
          if (riskLevel === 'high' || riskLevel === 'critical' || requiresPreview) {
            metadata.requiresApproval = true;
          }

          return {
            passed: true,
            stageName: 'safe_mode_check',
            metadata,
          };
        },
      });
    }

    // Stage 7: Custom Validators
    this.registerStage({
      name: 'custom_validators',
      priority: 400,
      enabled: true,
      fatal: true,
      validate: async (input) => {
        const customValidators = input.command.definition.validators;
        if (!customValidators || customValidators.length === 0) {
          return { passed: true, stageName: 'custom_validators' };
        }

        const errors: ValidationError[] = [];

        for (const validator of customValidators) {
          try {
            const result = await validator(input.params);
            if (!result.valid) {
              errors.push({
                path: '',
                message: result.message || 'Custom validation failed',
                code: 'custom_validation_error',
              });
            }
          } catch (error) {
            errors.push({
              path: '',
              message: error instanceof Error ? error.message : String(error),
              code: 'custom_validator_error',
            });
          }
        }

        return {
          passed: errors.length === 0,
          stageName: 'custom_validators',
          errors: errors.length > 0 ? errors : undefined,
        };
      },
    });

    // Stage 8: Final Sanitization
    this.registerStage({
      name: 'sanitization',
      priority: 100,
      enabled: true,
      fatal: false,
      validate: async (input) => {
        const sanitized = this.sanitizeParams(input.params);
        return {
          passed: true,
          stageName: 'sanitization',
          transformedParams: sanitized,
        };
      },
    });
  }

  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    stageName: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Validation stage '${stageName}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  }

  private coerceTypes(params: unknown): unknown {
    if (params === null || params === undefined) {
      return params;
    }

    if (typeof params === 'object' && !Array.isArray(params)) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        result[key] = this.coerceTypes(value);
      }
      return result;
    }

    if (Array.isArray(params)) {
      return params.map((item) => this.coerceTypes(item));
    }

    if (typeof params === 'string') {
      // Try number coercion
      const num = Number(params);
      if (!isNaN(num) && params.trim() !== '') {
        return num;
      }

      // Try boolean coercion
      if (params.toLowerCase() === 'true') return true;
      if (params.toLowerCase() === 'false') return false;
    }

    return params;
  }

  private sanitizeParams(params: unknown): unknown {
    if (params === null || params === undefined) {
      return params;
    }

    if (typeof params === 'string') {
      // Trim whitespace
      return params.trim();
    }

    if (typeof params === 'object' && !Array.isArray(params)) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        // Skip undefined values
        if (value !== undefined) {
          result[key] = this.sanitizeParams(value);
        }
      }
      return result;
    }

    if (Array.isArray(params)) {
      return params.map((item) => this.sanitizeParams(item));
    }

    return params;
  }

  private extractTarget(params: unknown): string {
    if (!params || typeof params !== 'object') {
      return '';
    }

    const p = params as Record<string, unknown>;

    // Common target fields
    if (typeof p.actorPath === 'string') return p.actorPath;
    if (typeof p.assetPath === 'string') return p.assetPath;
    if (typeof p.blueprintPath === 'string') return p.blueprintPath;
    if (typeof p.target === 'string') return p.target;
    if (typeof p.path === 'string') return p.path;
    if (typeof p.name === 'string') return p.name;

    return '';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createValidationPipeline(
  config: Partial<ValidationPipelineConfig>,
  logger: Logger,
  securitySandbox?: SecuritySandbox,
  safeModeManager?: SafeModeManager
): ValidationPipeline {
  return new ValidationPipeline(config, logger, securitySandbox, safeModeManager);
}

// ============================================================================
// Custom Stage Builders
// ============================================================================

/**
 * Create a stage that validates specific fields
 */
export function createFieldValidationStage(
  name: string,
  fields: Record<string, ZodSchema>,
  priority: number = 750
): ValidationStage {
  return {
    name,
    priority,
    enabled: true,
    fatal: true,
    validate: async (input) => {
      const errors: ValidationError[] = [];
      const params = input.params as Record<string, unknown>;

      for (const [fieldName, schema] of Object.entries(fields)) {
        if (fieldName in params) {
          const result = validateSchema(schema, params[fieldName]);
          if (!result.success && result.errors) {
            for (const error of result.errors) {
              errors.push({
                ...error,
                path: error.path ? `${fieldName}.${error.path}` : fieldName,
              });
            }
          }
        }
      }

      return {
        passed: errors.length === 0,
        stageName: name,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
  };
}

/**
 * Create a stage that checks command dependencies
 */
export function createDependencyValidationStage(
  checkDependency: (depName: string) => boolean,
  priority: number = 650
): ValidationStage {
  return {
    name: 'dependency_validation',
    priority,
    enabled: true,
    fatal: true,
    validate: async (input) => {
      const dependencies = input.command.definition.annotations?.dependencies || [];
      const errors: ValidationError[] = [];

      for (const dep of dependencies) {
        if (!checkDependency(dep)) {
          errors.push({
            path: '',
            message: `Required dependency not available: ${dep}`,
            code: 'missing_dependency',
          });
        }
      }

      return {
        passed: errors.length === 0,
        stageName: 'dependency_validation',
        errors: errors.length > 0 ? errors : undefined,
      };
    },
  };
}

/**
 * Create a stage that validates Unreal Engine references
 */
export function createUnrealReferenceValidationStage(
  validateReference: (type: string, path: string) => Promise<boolean>,
  priority: number = 550
): ValidationStage {
  return {
    name: 'unreal_reference_validation',
    priority,
    enabled: true,
    fatal: false,
    validate: async (input) => {
      const warnings: ValidationWarning[] = [];
      const params = input.params as Record<string, unknown>;

      // Check actor references
      if (typeof params.actorPath === 'string') {
        const valid = await validateReference('actor', params.actorPath);
        if (!valid) {
          warnings.push({
            code: 'actor_not_found',
            message: `Actor path may not exist: ${params.actorPath}`,
            suggestion: 'Verify the actor exists in the current level',
          });
        }
      }

      // Check asset references
      if (typeof params.assetPath === 'string') {
        const valid = await validateReference('asset', params.assetPath);
        if (!valid) {
          warnings.push({
            code: 'asset_not_found',
            message: `Asset path may not exist: ${params.assetPath}`,
            suggestion: 'Verify the asset exists in the project',
          });
        }
      }

      // Check blueprint references
      if (typeof params.blueprintPath === 'string') {
        const valid = await validateReference('blueprint', params.blueprintPath);
        if (!valid) {
          warnings.push({
            code: 'blueprint_not_found',
            message: `Blueprint path may not exist: ${params.blueprintPath}`,
            suggestion: 'Verify the blueprint exists and is compiled',
          });
        }
      }

      return {
        passed: true,
        stageName: 'unreal_reference_validation',
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    },
  };
}
