/**
 * AEGIS Environment Configuration
 * Loads and validates environment variables
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const EnvironmentSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Unreal Engine
  UE_HOST: z.string().default('localhost'),
  UE_HTTP_PORT: z.coerce.number().default(30020),
  UE_WS_PORT: z.coerce.number().default(30021),

  // AI Providers
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  OLLAMA_HOST: z.string().default('http://localhost:11434'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Security
  SAFE_MODE_ENABLED: z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .default('true'),
  MAX_ACTIONS_PER_MINUTE: z.coerce.number().default(60),
  MAX_DELETES_PER_SESSION: z.coerce.number().default(50),

  // Preview
  PREVIEW_EXPIRATION_MS: z.coerce.number().default(300000),
  AUTO_APPROVE_LEVEL: z.enum(['none', 'low', 'medium']).default('low'),

  // Plugin
  PLUGIN_HOT_RELOAD: z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .default('true'),
  PLUGIN_HOT_RELOAD_DEBOUNCE_MS: z.coerce.number().default(1000),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

let cachedEnv: Environment | null = null;

export function getEnvironment(): Environment {
  if (cachedEnv) return cachedEnv;

  const result = EnvironmentSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Environment validation failed:');
    for (const error of result.error.errors) {
      console.error(`  - ${error.path.join('.')}: ${error.message}`);
    }
    throw new Error('Invalid environment configuration');
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function isDevelopment(): boolean {
  return getEnvironment().NODE_ENV === 'development';
}

export function isProduction(): boolean {
  return getEnvironment().NODE_ENV === 'production';
}

export function isTest(): boolean {
  return getEnvironment().NODE_ENV === 'test';
}
