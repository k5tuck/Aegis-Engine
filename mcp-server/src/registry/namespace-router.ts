/**
 * AEGIS Namespace Router
 * Routes commands to appropriate handlers based on namespace hierarchy
 */

import { Logger } from '../utils/logger.js';
import { CommandNotFoundError } from '../utils/errors.js';
import { CommandRegistry, CommandExecutionResult } from './command-registry.js';
import { CommandContext, RegisteredCommand } from './plugin-types.js';

// ============================================================================
// Types
// ============================================================================

export interface NamespaceConfig {
  /** Namespace identifier (e.g., 'aegis.core', 'aegis.worldgen') */
  namespace: string;

  /** Human-readable name */
  displayName: string;

  /** Description of what this namespace handles */
  description: string;

  /** Whether this namespace is enabled */
  enabled: boolean;

  /** Priority for command resolution (higher = preferred) */
  priority: number;

  /** Parent namespace (for hierarchy) */
  parent?: string;

  /** Custom middleware for this namespace */
  middleware?: NamespaceMiddleware[];
}

export interface NamespaceMiddleware {
  name: string;
  priority: number;
  execute: (
    context: CommandContext,
    next: () => Promise<unknown>
  ) => Promise<unknown>;
}

export interface RouteResult {
  namespace: string;
  command: RegisteredCommand;
  middleware: NamespaceMiddleware[];
}

export interface NamespaceStats {
  namespace: string;
  commandCount: number;
  totalCalls: number;
  averageExecutionTimeMs: number;
  childNamespaces: string[];
}

export interface NamespaceRouterConfig {
  /** Enable namespace caching */
  enableCache: boolean;

  /** Enable fallback to parent namespace */
  enableFallback: boolean;

  /** Default namespace for unqualified commands */
  defaultNamespace: string;

  /** Global middleware applied to all commands */
  globalMiddleware: NamespaceMiddleware[];
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: NamespaceRouterConfig = {
  enableCache: true,
  enableFallback: true,
  defaultNamespace: 'aegis.core',
  globalMiddleware: [],
};

// ============================================================================
// Namespace Router Implementation
// ============================================================================

export class NamespaceRouter {
  private namespaces: Map<string, NamespaceConfig> = new Map();
  private namespaceMiddleware: Map<string, NamespaceMiddleware[]> = new Map();
  private commandRegistry: CommandRegistry;
  private config: NamespaceRouterConfig;
  private logger: Logger;
  private routeCache: Map<string, RouteResult> = new Map();
  private callStats: Map<string, { calls: number; totalTimeMs: number }> = new Map();

  constructor(
    commandRegistry: CommandRegistry,
    config: Partial<NamespaceRouterConfig>,
    logger: Logger
  ) {
    this.commandRegistry = commandRegistry;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger.child({ component: 'NamespaceRouter' });

    // Register default namespaces
    this.registerDefaultNamespaces();
  }

  /**
   * Register a namespace
   */
  registerNamespace(config: NamespaceConfig): void {
    this.namespaces.set(config.namespace, config);
    this.namespaceMiddleware.set(config.namespace, config.middleware || []);

    // Sort middleware by priority
    const middleware = this.namespaceMiddleware.get(config.namespace)!;
    middleware.sort((a, b) => b.priority - a.priority);

    // Clear cache when namespaces change
    if (this.config.enableCache) {
      this.routeCache.clear();
    }

    this.logger.debug('Namespace registered', {
      namespace: config.namespace,
      displayName: config.displayName,
      priority: config.priority,
    });
  }

  /**
   * Unregister a namespace
   */
  unregisterNamespace(namespace: string): void {
    this.namespaces.delete(namespace);
    this.namespaceMiddleware.delete(namespace);

    if (this.config.enableCache) {
      // Clear routes for this namespace
      for (const [key, route] of this.routeCache) {
        if (route.namespace === namespace) {
          this.routeCache.delete(key);
        }
      }
    }

    this.logger.debug('Namespace unregistered', { namespace });
  }

  /**
   * Check if a namespace is registered
   */
  hasNamespace(namespace: string): boolean {
    return this.namespaces.has(namespace);
  }

  /**
   * Get namespace configuration
   */
  getNamespace(namespace: string): NamespaceConfig | undefined {
    return this.namespaces.get(namespace);
  }

  /**
   * Get all registered namespaces
   */
  getAllNamespaces(): NamespaceConfig[] {
    return Array.from(this.namespaces.values());
  }

  /**
   * Enable or disable a namespace
   */
  setNamespaceEnabled(namespace: string, enabled: boolean): void {
    const config = this.namespaces.get(namespace);
    if (config) {
      config.enabled = enabled;

      if (this.config.enableCache) {
        // Clear routes for this namespace
        for (const [key, route] of this.routeCache) {
          if (route.namespace === namespace) {
            this.routeCache.delete(key);
          }
        }
      }
    }
  }

  /**
   * Add middleware to a namespace
   */
  addMiddleware(namespace: string, middleware: NamespaceMiddleware): void {
    let middlewareList = this.namespaceMiddleware.get(namespace);
    if (!middlewareList) {
      middlewareList = [];
      this.namespaceMiddleware.set(namespace, middlewareList);
    }

    middlewareList.push(middleware);
    middlewareList.sort((a, b) => b.priority - a.priority);

    this.logger.debug('Middleware added', {
      namespace,
      middleware: middleware.name,
      priority: middleware.priority,
    });
  }

  /**
   * Remove middleware from a namespace
   */
  removeMiddleware(namespace: string, middlewareName: string): void {
    const middlewareList = this.namespaceMiddleware.get(namespace);
    if (middlewareList) {
      const index = middlewareList.findIndex((m) => m.name === middlewareName);
      if (index !== -1) {
        middlewareList.splice(index, 1);
      }
    }
  }

  /**
   * Route a command to its handler
   */
  async routeCommand(commandName: string): Promise<RouteResult> {
    // Check cache
    if (this.config.enableCache && this.routeCache.has(commandName)) {
      return this.routeCache.get(commandName)!;
    }

    // Parse command name to extract namespace
    const { namespace, localName } = this.parseCommandName(commandName);

    // Find the command
    const lookup = this.commandRegistry.lookupCommand(commandName);
    if (!lookup) {
      throw new CommandNotFoundError(commandName);
    }

    // Check if namespace is enabled
    const namespaceConfig = this.namespaces.get(lookup.namespace);
    if (namespaceConfig && !namespaceConfig.enabled) {
      throw new Error(`Namespace ${lookup.namespace} is disabled`);
    }

    // Collect middleware (global + namespace chain)
    const middleware = this.collectMiddleware(lookup.namespace);

    const result: RouteResult = {
      namespace: lookup.namespace,
      command: lookup.command,
      middleware,
    };

    // Cache result
    if (this.config.enableCache) {
      this.routeCache.set(commandName, result);
    }

    return result;
  }

  /**
   * Execute a command with routing and middleware
   */
  async executeCommand<T>(
    commandName: string,
    params: unknown,
    context: Omit<CommandContext, 'params'>
  ): Promise<CommandExecutionResult<T>> {
    const startTime = Date.now();

    try {
      // Route the command
      const route = await this.routeCommand(commandName);

      // Build middleware chain
      const fullContext: CommandContext = {
        ...context,
        params,
      };

      // Execute with middleware
      const result = await this.executeWithMiddleware(
        route.middleware,
        fullContext,
        async () => {
          return this.commandRegistry.executeCommand<T>(
            commandName,
            params,
            context
          );
        }
      );

      // Update stats
      const executionTimeMs = Date.now() - startTime;
      this.updateStats(route.namespace, executionTimeMs);

      return result as CommandExecutionResult<T>;
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;

      this.logger.error('Command routing failed', error as Error, {
        commandName,
        executionTimeMs,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs,
        commandName,
        namespace: 'unknown',
      };
    }
  }

  /**
   * Get statistics for a namespace
   */
  getNamespaceStats(namespace: string): NamespaceStats {
    const config = this.namespaces.get(namespace);
    const commands = this.commandRegistry.getCommandsByNamespace(namespace);
    const stats = this.callStats.get(namespace) || { calls: 0, totalTimeMs: 0 };

    // Find child namespaces
    const childNamespaces: string[] = [];
    for (const ns of this.namespaces.values()) {
      if (ns.parent === namespace) {
        childNamespaces.push(ns.namespace);
      }
    }

    return {
      namespace,
      commandCount: commands.length,
      totalCalls: stats.calls,
      averageExecutionTimeMs: stats.calls > 0 ? stats.totalTimeMs / stats.calls : 0,
      childNamespaces,
    };
  }

  /**
   * Get all namespace statistics
   */
  getAllStats(): NamespaceStats[] {
    return Array.from(this.namespaces.keys()).map((ns) => this.getNamespaceStats(ns));
  }

  /**
   * Clear route cache
   */
  clearCache(): void {
    this.routeCache.clear();
    this.logger.debug('Route cache cleared');
  }

  /**
   * Get namespace hierarchy
   */
  getNamespaceHierarchy(): Map<string, string[]> {
    const hierarchy = new Map<string, string[]>();

    // Find root namespaces (no parent)
    const roots: string[] = [];
    for (const config of this.namespaces.values()) {
      if (!config.parent) {
        roots.push(config.namespace);
      }
    }

    // Build hierarchy
    const buildChildren = (parent: string): string[] => {
      const children: string[] = [];
      for (const config of this.namespaces.values()) {
        if (config.parent === parent) {
          children.push(config.namespace);
        }
      }
      return children;
    };

    const traverse = (namespace: string) => {
      const children = buildChildren(namespace);
      hierarchy.set(namespace, children);
      for (const child of children) {
        traverse(child);
      }
    };

    for (const root of roots) {
      traverse(root);
    }

    return hierarchy;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private registerDefaultNamespaces(): void {
    // Core namespace
    this.registerNamespace({
      namespace: 'aegis.core',
      displayName: 'AEGIS Core',
      description: 'Core system commands for actors, blueprints, and assets',
      enabled: true,
      priority: 100,
    });

    // WorldGen namespace
    this.registerNamespace({
      namespace: 'aegis.worldgen',
      displayName: 'World Generation',
      description: 'Terrain, biome, foliage, and procedural generation commands',
      enabled: true,
      priority: 90,
      parent: 'aegis.core',
    });

    // WorldGen sub-namespaces
    this.registerNamespace({
      namespace: 'aegis.worldgen.terrain',
      displayName: 'Terrain Generation',
      description: 'Heightmap and terrain sculpting commands',
      enabled: true,
      priority: 89,
      parent: 'aegis.worldgen',
    });

    this.registerNamespace({
      namespace: 'aegis.worldgen.biome',
      displayName: 'Biome System',
      description: 'Biome configuration and painting commands',
      enabled: true,
      priority: 88,
      parent: 'aegis.worldgen',
    });

    this.registerNamespace({
      namespace: 'aegis.worldgen.foliage',
      displayName: 'Foliage System',
      description: 'Vegetation and foliage placement commands',
      enabled: true,
      priority: 87,
      parent: 'aegis.worldgen',
    });

    this.registerNamespace({
      namespace: 'aegis.worldgen.pcg',
      displayName: 'PCG Integration',
      description: 'Procedural Content Generation graph commands',
      enabled: true,
      priority: 86,
      parent: 'aegis.worldgen',
    });

    // Houdini namespace
    this.registerNamespace({
      namespace: 'aegis.houdini',
      displayName: 'Houdini Engine',
      description: 'Houdini Digital Asset integration commands',
      enabled: true,
      priority: 85,
      parent: 'aegis.worldgen',
    });

    // NPC/AI namespace
    this.registerNamespace({
      namespace: 'aegis.npc',
      displayName: 'NPC & AI',
      description: 'NPC behavior, AI, and ML model commands',
      enabled: true,
      priority: 80,
      parent: 'aegis.core',
    });

    this.registerNamespace({
      namespace: 'aegis.npc.behavior',
      displayName: 'Behavior Trees',
      description: 'Behavior tree creation and modification',
      enabled: true,
      priority: 79,
      parent: 'aegis.npc',
    });

    this.registerNamespace({
      namespace: 'aegis.npc.onnx',
      displayName: 'ONNX Runtime',
      description: 'ML model loading and inference',
      enabled: true,
      priority: 78,
      parent: 'aegis.npc',
    });

    // Seed Protocol namespace
    this.registerNamespace({
      namespace: 'aegis.seed',
      displayName: 'Seed Protocol',
      description: 'Deterministic state capture and synchronization',
      enabled: true,
      priority: 70,
      parent: 'aegis.core',
    });

    // Utility namespace
    this.registerNamespace({
      namespace: 'aegis.util',
      displayName: 'Utilities',
      description: 'Helper and utility commands',
      enabled: true,
      priority: 50,
      parent: 'aegis.core',
    });
  }

  private parseCommandName(commandName: string): { namespace: string; localName: string } {
    const lastDot = commandName.lastIndexOf('.');
    if (lastDot === -1) {
      return {
        namespace: this.config.defaultNamespace,
        localName: commandName,
      };
    }

    return {
      namespace: commandName.substring(0, lastDot),
      localName: commandName.substring(lastDot + 1),
    };
  }

  private collectMiddleware(namespace: string): NamespaceMiddleware[] {
    const middleware: NamespaceMiddleware[] = [...this.config.globalMiddleware];

    // Collect middleware from namespace hierarchy (parent to child)
    const chain = this.getNamespaceChain(namespace);

    for (const ns of chain) {
      const nsMiddleware = this.namespaceMiddleware.get(ns) || [];
      middleware.push(...nsMiddleware);
    }

    // Sort by priority (higher first)
    middleware.sort((a, b) => b.priority - a.priority);

    return middleware;
  }

  private getNamespaceChain(namespace: string): string[] {
    const chain: string[] = [];
    let current = namespace;

    while (current) {
      chain.unshift(current);
      const config = this.namespaces.get(current);
      current = config?.parent || '';
    }

    return chain;
  }

  private async executeWithMiddleware(
    middleware: NamespaceMiddleware[],
    context: CommandContext,
    handler: () => Promise<unknown>
  ): Promise<unknown> {
    if (middleware.length === 0) {
      return handler();
    }

    let index = 0;

    const next = async (): Promise<unknown> => {
      if (index >= middleware.length) {
        return handler();
      }

      const current = middleware[index++];
      return current.execute(context, next);
    };

    return next();
  }

  private updateStats(namespace: string, executionTimeMs: number): void {
    const existing = this.callStats.get(namespace) || { calls: 0, totalTimeMs: 0 };

    this.callStats.set(namespace, {
      calls: existing.calls + 1,
      totalTimeMs: existing.totalTimeMs + executionTimeMs,
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createNamespaceRouter(
  commandRegistry: CommandRegistry,
  config: Partial<NamespaceRouterConfig>,
  logger: Logger
): NamespaceRouter {
  return new NamespaceRouter(commandRegistry, config, logger);
}

// ============================================================================
// Built-in Middleware
// ============================================================================

/**
 * Logging middleware
 */
export function createLoggingMiddleware(logger: Logger): NamespaceMiddleware {
  return {
    name: 'logging',
    priority: 1000,
    execute: async (context, next) => {
      const startTime = Date.now();
      logger.debug('Command started', { requestId: context.requestId });

      try {
        const result = await next();
        const duration = Date.now() - startTime;
        logger.debug('Command completed', { requestId: context.requestId, duration });
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('Command failed', error as Error, { requestId: context.requestId, duration });
        throw error;
      }
    },
  };
}

/**
 * Timeout middleware
 */
export function createTimeoutMiddleware(timeoutMs: number): NamespaceMiddleware {
  return {
    name: 'timeout',
    priority: 900,
    execute: async (context, next) => {
      return Promise.race([
        next(),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Command timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    },
  };
}

/**
 * Retry middleware
 */
export function createRetryMiddleware(maxRetries: number, backoffMs: number): NamespaceMiddleware {
  return {
    name: 'retry',
    priority: 800,
    execute: async (context, next) => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await next();
        } catch (error) {
          lastError = error as Error;

          if (attempt < maxRetries) {
            const delay = backoffMs * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      throw lastError;
    },
  };
}

/**
 * Validation middleware
 */
export function createValidationMiddleware(): NamespaceMiddleware {
  return {
    name: 'validation',
    priority: 950,
    execute: async (context, next) => {
      // Ensure required context fields exist
      if (!context.requestId) {
        throw new Error('Missing requestId in context');
      }

      return next();
    },
  };
}
