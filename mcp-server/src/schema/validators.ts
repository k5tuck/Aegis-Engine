/**
 * AEGIS Schema Validators
 * Comprehensive validation utilities for command parameters and responses
 */

import { z, ZodError, ZodSchema, ZodIssue } from 'zod';
import { CommandValidationError } from '../utils/errors.js';

/**
 * Validation result with detailed error information
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
}

/**
 * Structured validation error
 */
export interface ValidationError {
  path: string;
  message: string;
  code: string;
  expected?: string;
  received?: string;
}

/**
 * Convert ZodError to ValidationError array
 */
export function zodErrorToValidationErrors(error: ZodError): ValidationError[] {
  return error.issues.map((issue: ZodIssue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
    expected: 'expected' in issue ? String(issue.expected) : undefined,
    received: 'received' in issue ? String(issue.received) : undefined,
  }));
}

/**
 * Validate data against a Zod schema
 */
export function validateSchema<T>(
  schema: ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    errors: zodErrorToValidationErrors(result.error),
  };
}

/**
 * Validate and throw CommandValidationError if invalid
 */
export function validateOrThrow<T>(
  schema: ZodSchema<T>,
  data: unknown,
  commandName: string
): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    const violations = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    throw new CommandValidationError(commandName, violations);
  }

  return result.data;
}

/**
 * Create a validator function for a schema
 */
export function createValidator<T>(
  schema: ZodSchema<T>
): (data: unknown) => ValidationResult<T> {
  return (data: unknown) => validateSchema(schema, data);
}

/**
 * Partial validation - validates only provided fields
 */
export function validatePartial<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  data: unknown
): ValidationResult<Partial<z.infer<z.ZodObject<T>>>> {
  return validateSchema(schema.partial(), data);
}

/**
 * Coerce and validate - attempts to coerce values before validation
 */
export function coerceAndValidate<T>(
  schema: ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  // First try direct validation
  const directResult = validateSchema(schema, data);
  if (directResult.success) {
    return directResult;
  }

  // Attempt coercion for common types
  const coerced = attemptCoercion(data);
  return validateSchema(schema, coerced);
}

/**
 * Attempt to coerce common types
 */
function attemptCoercion(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'object' && !Array.isArray(data)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = attemptCoercion(value);
    }
    return result;
  }

  if (Array.isArray(data)) {
    return data.map(attemptCoercion);
  }

  // Try to coerce string to number
  if (typeof data === 'string') {
    const num = Number(data);
    if (!isNaN(num) && data.trim() !== '') {
      return num;
    }
    // Try to coerce string to boolean
    if (data.toLowerCase() === 'true') return true;
    if (data.toLowerCase() === 'false') return false;
  }

  return data;
}

// ============================================================================
// Common Validation Patterns
// ============================================================================

/**
 * Unreal Engine asset path validator
 */
export const AssetPathSchema = z
  .string()
  .regex(/^\/[A-Za-z][A-Za-z0-9_]*\//, {
    message: 'Asset path must start with /RootFolder/',
  })
  .describe('Valid Unreal Engine asset path');

/**
 * Unreal Engine actor path validator
 */
export const ActorPathSchema = z
  .string()
  .min(1, 'Actor path cannot be empty')
  .describe('Valid Unreal Engine actor path');

/**
 * Blueprint class path validator
 */
export const BlueprintPathSchema = z
  .string()
  .regex(/^\/[A-Za-z][A-Za-z0-9_]*\/.*\.[A-Za-z][A-Za-z0-9_]*$/, {
    message: 'Blueprint path must be a valid asset path with blueprint name',
  })
  .or(z.string().startsWith('/Script/'))
  .describe('Valid Blueprint or native class path');

/**
 * Identifier validator (for names, IDs)
 */
export const IdentifierSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, {
    message: 'Identifier must start with a letter and contain only letters, numbers, and underscores',
  })
  .min(1)
  .max(256)
  .describe('Valid identifier');

/**
 * Safe identifier (lowercase with underscores)
 */
export const SafeIdentifierSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, {
    message: 'Safe identifier must be lowercase with underscores',
  })
  .min(1)
  .max(64)
  .describe('Lowercase identifier');

/**
 * Positive integer validator
 */
export const PositiveIntSchema = z.number().int().positive();

/**
 * Non-negative integer validator
 */
export const NonNegativeIntSchema = z.number().int().min(0);

/**
 * Percentage validator (0-1)
 */
export const PercentageSchema = z.number().min(0).max(1);

/**
 * Degrees validator (0-360)
 */
export const DegreesSchema = z.number().min(0).max(360);

/**
 * Angle validator (-180 to 180)
 */
export const AngleSchema = z.number().min(-180).max(180);

/**
 * Timestamp validator
 */
export const TimestampSchema = z.number().int().positive();

/**
 * UUID validator
 */
export const UUIDSchema = z.string().uuid();

/**
 * Email validator
 */
export const EmailSchema = z.string().email();

/**
 * URL validator
 */
export const URLSchema = z.string().url();

/**
 * File path validator
 */
export const FilePathSchema = z.string().min(1).describe('Valid file system path');

// ============================================================================
// Composite Validators
// ============================================================================

/**
 * Range validator
 */
export function createRangeSchema(min: number, max: number, integer: boolean = false) {
  let schema = z.number().min(min).max(max);
  if (integer) {
    schema = schema.int();
  }
  return schema;
}

/**
 * Array with length constraints
 */
export function createArraySchema<T>(
  itemSchema: ZodSchema<T>,
  minLength: number = 0,
  maxLength: number = Infinity
) {
  return z.array(itemSchema).min(minLength).max(maxLength);
}

/**
 * Optional with default
 */
export function createOptionalWithDefault<T>(schema: ZodSchema<T>, defaultValue: T) {
  return schema.optional().default(defaultValue);
}

/**
 * Enum from array of strings
 */
export function createEnumSchema<T extends string>(values: readonly T[]) {
  return z.enum(values as [T, ...T[]]);
}

/**
 * Record with validated keys and values
 */
export function createRecordSchema<K extends string, V>(
  keySchema: ZodSchema<K>,
  valueSchema: ZodSchema<V>
) {
  return z.record(keySchema, valueSchema);
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Merge multiple validation results
 */
export function mergeValidationResults<T>(
  results: ValidationResult<Partial<T>>[]
): ValidationResult<T> {
  const errors: ValidationError[] = [];
  let mergedData: Partial<T> = {};

  for (const result of results) {
    if (result.errors) {
      errors.push(...result.errors);
    }
    if (result.data) {
      mergedData = { ...mergedData, ...result.data };
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: mergedData as T };
}

/**
 * Validate multiple values
 */
export function validateMultiple<T extends Record<string, unknown>>(
  schemas: { [K in keyof T]: ZodSchema<T[K]> },
  values: { [K in keyof T]: unknown }
): ValidationResult<T> {
  const errors: ValidationError[] = [];
  const data: Partial<T> = {};

  for (const key of Object.keys(schemas) as Array<keyof T>) {
    const result = validateSchema(schemas[key], values[key]);
    if (result.success) {
      data[key] = result.data;
    } else if (result.errors) {
      // Prefix errors with key
      for (const error of result.errors) {
        errors.push({
          ...error,
          path: error.path ? `${String(key)}.${error.path}` : String(key),
        });
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: data as T };
}

/**
 * Create async validator with custom async validation
 */
export function createAsyncValidator<T>(
  schema: ZodSchema<T>,
  asyncValidation: (data: T) => Promise<string | null>
): (data: unknown) => Promise<ValidationResult<T>> {
  return async (data: unknown) => {
    const result = validateSchema(schema, data);
    if (!result.success) {
      return result;
    }

    const asyncError = await asyncValidation(result.data!);
    if (asyncError) {
      return {
        success: false,
        errors: [
          {
            path: '',
            message: asyncError,
            code: 'custom',
          },
        ],
      };
    }

    return result;
  };
}

/**
 * Sanitize input before validation
 */
export function sanitizeInput(input: unknown): unknown {
  if (typeof input === 'string') {
    // Trim whitespace
    return input.trim();
  }

  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }

  if (input !== null && typeof input === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }

  return input;
}

/**
 * Validate and sanitize
 */
export function validateAndSanitize<T>(
  schema: ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const sanitized = sanitizeInput(data);
  return validateSchema(schema, sanitized);
}
