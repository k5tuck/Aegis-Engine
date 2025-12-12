/**
 * AEGIS Adapter Manager
 * Manages AI model adapters with fallback support
 */

import { BaseModelAdapter, ModelAdapterConfig } from './base-adapter.js';
import { ClaudeAdapter, ClaudeAdapterConfig } from './claude-adapter.js';
import { OpenAIAdapter, OpenAIAdapterConfig } from './openai-adapter.js';
import { DeepSeekAdapter, DeepSeekAdapterConfig } from './deepseek-adapter.js';
import { OllamaAdapter, OllamaAdapterConfig } from './ollama-adapter.js';
import { Logger } from '../utils/logger.js';
import { ModelAdapterError } from '../utils/errors.js';

// Re-export all adapter types
export * from './base-adapter.js';
export * from './claude-adapter.js';
export * from './openai-adapter.js';
export * from './deepseek-adapter.js';
export * from './ollama-adapter.js';

// ============================================================================
// Types
// ============================================================================

export type AdapterType = 'claude' | 'openai' | 'deepseek' | 'ollama';

export interface AdapterManagerConfig {
  primary: AdapterType;
  fallback?: AdapterType[];
  adapters: {
    claude?: ClaudeAdapterConfig;
    openai?: OpenAIAdapterConfig;
    deepseek?: DeepSeekAdapterConfig;
    ollama?: OllamaAdapterConfig;
  };
}

export interface AdapterStatus {
  type: AdapterType;
  available: boolean;
  modelId: string;
  lastChecked: Date;
  error?: string;
}

// ============================================================================
// Adapter Manager Implementation
// ============================================================================

export class AdapterManager {
  private adapters: Map<AdapterType, BaseModelAdapter> = new Map();
  private primaryAdapter: AdapterType;
  private fallbackOrder: AdapterType[];
  private logger: Logger;
  private statusCache: Map<AdapterType, AdapterStatus> = new Map();
  private statusCacheTTL: number = 60000; // 1 minute

  constructor(config: AdapterManagerConfig, logger: Logger) {
    this.logger = logger.child({ component: 'AdapterManager' });
    this.primaryAdapter = config.primary;
    this.fallbackOrder = config.fallback || [];

    // Initialize configured adapters
    if (config.adapters.claude) {
      try {
        this.adapters.set('claude', new ClaudeAdapter(config.adapters.claude, logger));
        this.logger.info('Claude adapter initialized', { model: config.adapters.claude.model });
      } catch (error) {
        this.logger.warn('Failed to initialize Claude adapter', { error });
      }
    }

    if (config.adapters.openai) {
      try {
        this.adapters.set('openai', new OpenAIAdapter(config.adapters.openai, logger));
        this.logger.info('OpenAI adapter initialized', { model: config.adapters.openai.model });
      } catch (error) {
        this.logger.warn('Failed to initialize OpenAI adapter', { error });
      }
    }

    if (config.adapters.deepseek) {
      try {
        this.adapters.set('deepseek', new DeepSeekAdapter(config.adapters.deepseek, logger));
        this.logger.info('DeepSeek adapter initialized', { model: config.adapters.deepseek.model });
      } catch (error) {
        this.logger.warn('Failed to initialize DeepSeek adapter', { error });
      }
    }

    if (config.adapters.ollama) {
      try {
        this.adapters.set('ollama', new OllamaAdapter(config.adapters.ollama, logger));
        this.logger.info('Ollama adapter initialized', { model: config.adapters.ollama.model });
      } catch (error) {
        this.logger.warn('Failed to initialize Ollama adapter', { error });
      }
    }

    // Verify primary adapter is available
    if (!this.adapters.has(this.primaryAdapter)) {
      throw new ModelAdapterError(this.primaryAdapter, 'Primary adapter not configured');
    }

    this.logger.info('Adapter manager initialized', {
      primary: this.primaryAdapter,
      fallbacks: this.fallbackOrder,
      adaptersCount: this.adapters.size,
    });
  }

  /**
   * Get the primary adapter
   */
  getPrimaryAdapter(): BaseModelAdapter {
    const adapter = this.adapters.get(this.primaryAdapter);
    if (!adapter) {
      throw new ModelAdapterError(this.primaryAdapter, 'Primary adapter not found');
    }
    return adapter;
  }

  /**
   * Get a specific adapter by type
   */
  getAdapter(type: AdapterType): BaseModelAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Get an available adapter with fallback support
   */
  async getAvailableAdapter(): Promise<BaseModelAdapter> {
    // Try primary first
    const primary = this.adapters.get(this.primaryAdapter);
    if (primary && (await this.checkAdapterAvailability(this.primaryAdapter, primary))) {
      return primary;
    }

    this.logger.warn('Primary adapter unavailable, trying fallbacks', {
      primary: this.primaryAdapter,
    });

    // Try fallbacks in order
    for (const fallbackType of this.fallbackOrder) {
      const fallback = this.adapters.get(fallbackType);
      if (fallback && (await this.checkAdapterAvailability(fallbackType, fallback))) {
        this.logger.info('Using fallback adapter', { adapter: fallbackType });
        return fallback;
      }
    }

    throw new ModelAdapterError(this.primaryAdapter, 'No available adapters');
  }

  /**
   * Check availability of all configured adapters
   */
  async checkAllAdapters(): Promise<Map<AdapterType, AdapterStatus>> {
    const results = new Map<AdapterType, AdapterStatus>();

    for (const [type, adapter] of this.adapters) {
      const status = await this.getAdapterStatus(type, adapter);
      results.set(type, status);
    }

    return results;
  }

  /**
   * Get status of a specific adapter
   */
  async getAdapterStatus(type: AdapterType, adapter?: BaseModelAdapter): Promise<AdapterStatus> {
    // Check cache first
    const cached = this.statusCache.get(type);
    if (cached && Date.now() - cached.lastChecked.getTime() < this.statusCacheTTL) {
      return cached;
    }

    const actualAdapter = adapter || this.adapters.get(type);
    if (!actualAdapter) {
      const status: AdapterStatus = {
        type,
        available: false,
        modelId: 'unknown',
        lastChecked: new Date(),
        error: 'Adapter not configured',
      };
      this.statusCache.set(type, status);
      return status;
    }

    try {
      const available = await actualAdapter.isAvailable();
      const status: AdapterStatus = {
        type,
        available,
        modelId: actualAdapter.getModelId(),
        lastChecked: new Date(),
      };
      this.statusCache.set(type, status);
      return status;
    } catch (error) {
      const status: AdapterStatus = {
        type,
        available: false,
        modelId: actualAdapter.getModelId(),
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : String(error),
      };
      this.statusCache.set(type, status);
      return status;
    }
  }

  /**
   * Check adapter availability with caching
   */
  private async checkAdapterAvailability(
    type: AdapterType,
    adapter: BaseModelAdapter
  ): Promise<boolean> {
    const status = await this.getAdapterStatus(type, adapter);
    return status.available;
  }

  /**
   * Get all configured adapter types
   */
  getConfiguredAdapters(): AdapterType[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get primary adapter type
   */
  getPrimaryAdapterType(): AdapterType {
    return this.primaryAdapter;
  }

  /**
   * Get fallback order
   */
  getFallbackOrder(): AdapterType[] {
    return [...this.fallbackOrder];
  }

  /**
   * Update adapter configuration
   */
  updateAdapterConfig(type: AdapterType, config: Partial<ModelAdapterConfig>): void {
    const adapter = this.adapters.get(type);
    if (adapter) {
      adapter.updateConfig(config);
      // Invalidate status cache
      this.statusCache.delete(type);
      this.logger.info('Adapter configuration updated', { type });
    }
  }

  /**
   * Clear the status cache
   */
  clearStatusCache(): void {
    this.statusCache.clear();
  }

  /**
   * Set the primary adapter
   */
  setPrimaryAdapter(type: AdapterType): void {
    if (!this.adapters.has(type)) {
      throw new ModelAdapterError(type, 'Adapter not configured');
    }
    this.primaryAdapter = type;
    this.logger.info('Primary adapter changed', { newPrimary: type });
  }

  /**
   * Set fallback order
   */
  setFallbackOrder(order: AdapterType[]): void {
    // Filter to only configured adapters
    this.fallbackOrder = order.filter((type) => this.adapters.has(type));
    this.logger.info('Fallback order updated', { order: this.fallbackOrder });
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an adapter manager from environment configuration
 */
export function createAdapterManagerFromEnv(logger: Logger): AdapterManager {
  const config: AdapterManagerConfig = {
    primary: 'claude',
    fallback: ['openai', 'deepseek', 'ollama'],
    adapters: {},
  };

  // Configure Claude if API key is available
  if (process.env.ANTHROPIC_API_KEY) {
    config.adapters.claude = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    };
  }

  // Configure OpenAI if API key is available
  if (process.env.OPENAI_API_KEY) {
    config.adapters.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
    };
  }

  // Configure DeepSeek if API key is available
  if (process.env.DEEPSEEK_API_KEY) {
    config.adapters.deepseek = {
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    };
  }

  // Configure Ollama if host is specified
  if (process.env.OLLAMA_HOST || !process.env.ANTHROPIC_API_KEY) {
    config.adapters.ollama = {
      host: process.env.OLLAMA_HOST || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'llama3.1',
    };
  }

  // Adjust primary based on what's available
  if (!config.adapters.claude && config.adapters.openai) {
    config.primary = 'openai';
  } else if (!config.adapters.claude && !config.adapters.openai && config.adapters.deepseek) {
    config.primary = 'deepseek';
  } else if (
    !config.adapters.claude &&
    !config.adapters.openai &&
    !config.adapters.deepseek &&
    config.adapters.ollama
  ) {
    config.primary = 'ollama';
  }

  return new AdapterManager(config, logger);
}

/**
 * Create a specific adapter by type
 */
export function createAdapter(
  type: AdapterType,
  config: ModelAdapterConfig,
  logger: Logger
): BaseModelAdapter {
  switch (type) {
    case 'claude':
      return new ClaudeAdapter(config as ClaudeAdapterConfig, logger);
    case 'openai':
      return new OpenAIAdapter(config as OpenAIAdapterConfig, logger);
    case 'deepseek':
      return new DeepSeekAdapter(config as DeepSeekAdapterConfig, logger);
    case 'ollama':
      return new OllamaAdapter(config as OllamaAdapterConfig, logger);
    default:
      throw new ModelAdapterError(type, 'Unknown adapter type');
  }
}
