/**
 * AEGIS Configuration - Export Module
 */

export * from './environment.js';

import { getEnvironment, type Environment } from './environment.js';

export interface AegisConfig {
  server: {
    port: number;
    host: string;
  };
  unreal: {
    host: string;
    httpPort: number;
    wsPort: number;
  };
  ai: {
    anthropicApiKey?: string;
    openaiApiKey?: string;
    deepseekApiKey?: string;
    ollamaHost: string;
  };
  security: {
    safeModeEnabled: boolean;
    maxActionsPerMinute: number;
    maxDeletesPerSession: number;
  };
  preview: {
    expirationMs: number;
    autoApproveLevel: 'none' | 'low' | 'medium';
  };
  plugin: {
    hotReload: boolean;
    hotReloadDebounceMs: number;
  };
  logging: {
    level: string;
  };
}

export function createConfig(env?: Partial<Environment>): AegisConfig {
  const environment = env ? { ...getEnvironment(), ...env } : getEnvironment();

  return {
    server: {
      port: environment.PORT,
      host: environment.HOST,
    },
    unreal: {
      host: environment.UE_HOST,
      httpPort: environment.UE_HTTP_PORT,
      wsPort: environment.UE_WS_PORT,
    },
    ai: {
      anthropicApiKey: environment.ANTHROPIC_API_KEY,
      openaiApiKey: environment.OPENAI_API_KEY,
      deepseekApiKey: environment.DEEPSEEK_API_KEY,
      ollamaHost: environment.OLLAMA_HOST,
    },
    security: {
      safeModeEnabled: environment.SAFE_MODE_ENABLED,
      maxActionsPerMinute: environment.MAX_ACTIONS_PER_MINUTE,
      maxDeletesPerSession: environment.MAX_DELETES_PER_SESSION,
    },
    preview: {
      expirationMs: environment.PREVIEW_EXPIRATION_MS,
      autoApproveLevel: environment.AUTO_APPROVE_LEVEL,
    },
    plugin: {
      hotReload: environment.PLUGIN_HOT_RELOAD,
      hotReloadDebounceMs: environment.PLUGIN_HOT_RELOAD_DEBOUNCE_MS,
    },
    logging: {
      level: environment.LOG_LEVEL,
    },
  };
}
