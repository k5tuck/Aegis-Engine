/**
 * AEGIS Registry - Export Module
 * Plugin system, command registry, and namespace routing
 */

// Plugin Types
export * from './plugin-types.js';

// Plugin Loader
export {
  PluginLoader,
  PluginLoaderConfig,
  PluginLoadResult,
  PluginLoaderEvents,
  createPluginLoader,
} from './plugin-loader.js';

// Command Registry
export {
  CommandRegistry,
  CommandRegistryConfig,
  CommandLookupResult,
  CommandExecutionResult,
  CommandListItem,
  CommandMetrics,
  CommandRegistryEvents,
  createCommandRegistry,
} from './command-registry.js';

// Namespace Router
export {
  NamespaceRouter,
  NamespaceConfig,
  NamespaceMiddleware,
  RouteResult,
  NamespaceStats,
  NamespaceRouterConfig,
  createNamespaceRouter,
  createLoggingMiddleware,
  createTimeoutMiddleware,
  createRetryMiddleware,
  createValidationMiddleware,
} from './namespace-router.js';

// Validation Pipeline
export {
  ValidationPipeline,
  ValidationStage,
  ValidationInput,
  ValidationContext,
  ValidationStageResult,
  ValidationWarning,
  PipelineResult,
  ValidationPipelineConfig,
  createValidationPipeline,
  createFieldValidationStage,
  createDependencyValidationStage,
  createUnrealReferenceValidationStage,
} from './validation-pipeline.js';

// ============================================================================
// Registry Manager - Unified Interface
// ============================================================================

import { Logger } from '../utils/logger.js';
import { SecuritySandbox } from '../execution/sandbox.js';
import { SafeModeManager } from '../execution/safe-mode.js';
import { PluginLoader, PluginLoaderConfig, createPluginLoader } from './plugin-loader.js';
import { CommandRegistry, CommandRegistryConfig, createCommandRegistry } from './command-registry.js';
import { NamespaceRouter, NamespaceRouterConfig, createNamespaceRouter } from './namespace-router.js';
import { ValidationPipeline, ValidationPipelineConfig, createValidationPipeline } from './validation-pipeline.js';
import { PluginLoadContext, RegisteredPlugin, CommandContext } from './plugin-types.js';

export interface RegistryManagerConfig {
  pluginLoader: Partial<PluginLoaderConfig>;
  commandRegistry: Partial<CommandRegistryConfig>;
  namespaceRouter: Partial<NamespaceRouterConfig>;
  validationPipeline: Partial<ValidationPipelineConfig>;
}

export interface RegistryManagerDependencies {
  logger: Logger;
  pluginContext: PluginLoadContext;
  securitySandbox?: SecuritySandbox;
  safeModeManager?: SafeModeManager;
}

/**
 * Unified registry manager that coordinates all registry components
 */
export class RegistryManager {
  public readonly pluginLoader: PluginLoader;
  public readonly commandRegistry: CommandRegistry;
  public readonly namespaceRouter: NamespaceRouter;
  public readonly validationPipeline: ValidationPipeline;

  private logger: Logger;
  private initialized: boolean = false;

  constructor(
    config: Partial<RegistryManagerConfig>,
    deps: RegistryManagerDependencies
  ) {
    this.logger = deps.logger.child({ component: 'RegistryManager' });

    // Create command registry
    this.commandRegistry = createCommandRegistry(
      config.commandRegistry || {},
      deps.logger,
      {
        onCommandRegistered: (cmd) => {
          this.logger.debug('Command registered via manager', { fullName: cmd.fullName });
        },
        onCommandUnregistered: (name) => {
          this.logger.debug('Command unregistered via manager', { name });
        },
      }
    );

    // Create namespace router
    this.namespaceRouter = createNamespaceRouter(
      this.commandRegistry,
      config.namespaceRouter || {},
      deps.logger
    );

    // Create validation pipeline
    this.validationPipeline = createValidationPipeline(
      config.validationPipeline || {},
      deps.logger,
      deps.securitySandbox,
      deps.safeModeManager
    );

    // Create plugin loader with events that register to command registry
    this.pluginLoader = createPluginLoader(
      config.pluginLoader || {},
      deps.pluginContext,
      deps.logger,
      {
        onPluginLoaded: (plugin) => {
          this.onPluginLoaded(plugin);
        },
        onPluginUnloaded: (pluginId) => {
          this.onPluginUnloaded(pluginId);
        },
        onPluginReloaded: (plugin) => {
          this.onPluginReloaded(plugin);
        },
        onPluginError: (pluginId, error) => {
          this.logger.error('Plugin error', error, { pluginId });
        },
      }
    );

    // Link plugin loader to command registry
    this.commandRegistry.setPluginLoader(this.pluginLoader);
  }

  /**
   * Initialize all registry components
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('Registry manager already initialized');
      return;
    }

    this.logger.info('Initializing registry manager');

    // Initialize plugin loader (which will load plugins and register commands)
    await this.pluginLoader.initialize();

    this.initialized = true;

    this.logger.info('Registry manager initialized', {
      pluginCount: this.pluginLoader.getAllPlugins().length,
      commandCount: this.commandRegistry.getCommandCount(),
      namespaceCount: this.commandRegistry.getNamespaces().length,
    });
  }

  /**
   * Shutdown all registry components
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.info('Shutting down registry manager');

    // Shutdown plugin loader (will unload all plugins)
    await this.pluginLoader.shutdown();

    // Clear command registry
    this.commandRegistry.clear();

    // Clear namespace router cache
    this.namespaceRouter.clearCache();

    this.initialized = false;

    this.logger.info('Registry manager shutdown complete');
  }

  /**
   * Execute a command with full validation and routing
   */
  async executeCommand<T>(
    commandName: string,
    params: unknown,
    context: Omit<CommandContext, 'params'>
  ): Promise<{
    success: boolean;
    data?: T;
    error?: string;
    validationResult?: import('./validation-pipeline.js').PipelineResult;
  }> {
    // Look up command
    const lookup = this.commandRegistry.lookupCommand(commandName);
    if (!lookup) {
      return {
        success: false,
        error: `Command not found: ${commandName}`,
      };
    }

    // Validate through pipeline
    const validationContext = {
      requestId: context.requestId,
      sessionId: context.sessionId,
      timestamp: new Date(),
      metadata: {},
    };

    const validationResult = await this.validationPipeline.validate(
      commandName,
      lookup.command,
      params,
      validationContext
    );

    if (!validationResult.valid) {
      return {
        success: false,
        error: validationResult.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
        validationResult,
      };
    }

    // Execute through namespace router
    const result = await this.namespaceRouter.executeCommand<T>(
      commandName,
      validationResult.validatedParams,
      context
    );

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      validationResult,
    };
  }

  /**
   * Get all available commands for AI tools
   */
  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    const commands = this.commandRegistry.getCommandsForAI();

    return commands.map((cmd) => ({
      name: cmd.fullName,
      description: cmd.description,
      inputSchema: cmd.inputSchema,
    }));
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    plugins: number;
    commands: number;
    namespaces: string[];
    initialized: boolean;
  } {
    return {
      plugins: this.pluginLoader.getAllPlugins().length,
      commands: this.commandRegistry.getCommandCount(),
      namespaces: this.commandRegistry.getNamespaces(),
      initialized: this.initialized,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private onPluginLoaded(registered: RegisteredPlugin): void {
    this.logger.info('Plugin loaded, registering commands', {
      pluginId: registered.plugin.metadata.id,
      commandCount: registered.plugin.commands.length,
    });

    // Register all plugin commands
    this.commandRegistry.registerPlugin(registered.plugin);
  }

  private onPluginUnloaded(pluginId: string): void {
    this.logger.info('Plugin unloaded, unregistering commands', { pluginId });

    // Unregister all plugin commands
    this.commandRegistry.unregisterPlugin(pluginId);

    // Clear router cache
    this.namespaceRouter.clearCache();
  }

  private onPluginReloaded(registered: RegisteredPlugin): void {
    this.logger.info('Plugin reloaded, re-registering commands', {
      pluginId: registered.plugin.metadata.id,
      commandCount: registered.plugin.commands.length,
    });

    // Commands are automatically re-registered by the command registry
    // Just clear the router cache
    this.namespaceRouter.clearCache();
  }
}

/**
 * Create a registry manager with default configuration
 */
export function createRegistryManager(
  config: Partial<RegistryManagerConfig>,
  deps: RegistryManagerDependencies
): RegistryManager {
  return new RegistryManager(config, deps);
}
