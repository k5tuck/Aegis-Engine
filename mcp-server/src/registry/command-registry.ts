/**
 * AEGIS Command Registry
 * Central registry for all commands with namespace routing and execution
 */

import { z, ZodSchema } from 'zod';
import { Logger } from '../utils/logger.js';
import { CommandNotFoundError, CommandValidationError, SecurityViolationError } from '../utils/errors.js';
import { validateOrThrow } from '../schema/validators.js';
import {
  AegisPlugin,
  CommandDefinition,
  CommandContext,
  RegisteredCommand,
  RegisteredPlugin,
  CommandAnnotations,
} from './plugin-types.js';
import { PluginLoader } from './plugin-loader.js';

// ============================================================================
// Types
// ============================================================================

export interface CommandRegistryConfig {
  /** Enable command caching */
  enableCache: boolean;

  /** Maximum cached commands */
  maxCacheSize: number;

  /** Enable telemetry/metrics */
  enableTelemetry: boolean;

  /** Allow command overrides */
  allowOverrides: boolean;

  /** Default namespace for commands without one */
  defaultNamespace: string;
}

export interface CommandLookupResult {
  command: RegisteredCommand;
  namespace: string;
  pluginId: string;
}

export interface CommandExecutionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  executionTimeMs: number;
  commandName: string;
  namespace: string;
}

export interface CommandListItem {
  name: string;
  fullName: string;
  namespace: string;
  description: string;
  riskLevel: string;
  tags: string[];
  inputSchema: Record<string, unknown>;
}

export interface CommandMetrics {
  commandName: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageExecutionTimeMs: number;
  lastCalledAt?: Date;
}

export interface CommandRegistryEvents {
  onCommandRegistered?: (command: RegisteredCommand) => void;
  onCommandUnregistered?: (commandName: string) => void;
  onCommandExecuted?: (result: CommandExecutionResult) => void;
  onCommandFailed?: (commandName: string, error: Error) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: CommandRegistryConfig = {
  enableCache: true,
  maxCacheSize: 1000,
  enableTelemetry: true,
  allowOverrides: false,
  defaultNamespace: 'aegis.core',
};

// ============================================================================
// Command Registry Implementation
// ============================================================================

export class CommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();
  private namespaceIndex: Map<string, Set<string>> = new Map();
  private pluginCommands: Map<string, Set<string>> = new Map();
  private metrics: Map<string, CommandMetrics> = new Map();
  private config: CommandRegistryConfig;
  private logger: Logger;
  private events: CommandRegistryEvents;
  private pluginLoader?: PluginLoader;

  constructor(
    config: Partial<CommandRegistryConfig>,
    logger: Logger,
    events?: CommandRegistryEvents
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger.child({ component: 'CommandRegistry' });
    this.events = events || {};
  }

  /**
   * Set the plugin loader for dynamic command registration
   */
  setPluginLoader(loader: PluginLoader): void {
    this.pluginLoader = loader;
  }

  /**
   * Register a command from a plugin
   */
  registerCommand(
    plugin: AegisPlugin,
    command: CommandDefinition<ZodSchema, unknown>
  ): void {
    const fullName = this.buildFullCommandName(plugin.metadata.namespace, command.name);

    // Check for existing command
    if (this.commands.has(fullName)) {
      if (!this.config.allowOverrides) {
        throw new Error(`Command ${fullName} already registered`);
      }
      this.logger.warn('Overriding existing command', { fullName });
    }

    // Create registered command
    const registered: RegisteredCommand = {
      definition: command,
      pluginId: plugin.metadata.id,
      namespace: plugin.metadata.namespace,
      fullName,
      registeredAt: new Date(),
    };

    // Register in main map
    this.commands.set(fullName, registered);

    // Index by namespace
    let namespaceCommands = this.namespaceIndex.get(plugin.metadata.namespace);
    if (!namespaceCommands) {
      namespaceCommands = new Set();
      this.namespaceIndex.set(plugin.metadata.namespace, namespaceCommands);
    }
    namespaceCommands.add(fullName);

    // Index by plugin
    let pluginCmds = this.pluginCommands.get(plugin.metadata.id);
    if (!pluginCmds) {
      pluginCmds = new Set();
      this.pluginCommands.set(plugin.metadata.id, pluginCmds);
    }
    pluginCmds.add(fullName);

    // Initialize metrics
    if (this.config.enableTelemetry) {
      this.metrics.set(fullName, {
        commandName: fullName,
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        averageExecutionTimeMs: 0,
      });
    }

    // Notify listeners
    if (this.events.onCommandRegistered) {
      this.events.onCommandRegistered(registered);
    }

    this.logger.debug('Command registered', {
      fullName,
      pluginId: plugin.metadata.id,
      riskLevel: command.annotations?.riskLevel,
    });
  }

  /**
   * Register all commands from a plugin
   */
  registerPlugin(plugin: AegisPlugin): void {
    this.logger.info('Registering plugin commands', {
      pluginId: plugin.metadata.id,
      commandCount: plugin.commands.length,
    });

    for (const command of plugin.commands) {
      try {
        this.registerCommand(plugin, command);
      } catch (error) {
        this.logger.error('Failed to register command', error as Error, {
          pluginId: plugin.metadata.id,
          command: command.name,
        });
        throw error;
      }
    }
  }

  /**
   * Unregister all commands from a plugin
   */
  unregisterPlugin(pluginId: string): void {
    const pluginCmds = this.pluginCommands.get(pluginId);
    if (!pluginCmds) {
      return;
    }

    for (const fullName of pluginCmds) {
      this.unregisterCommand(fullName);
    }

    this.pluginCommands.delete(pluginId);
    this.logger.info('Plugin commands unregistered', { pluginId });
  }

  /**
   * Unregister a single command
   */
  unregisterCommand(fullName: string): void {
    const command = this.commands.get(fullName);
    if (!command) {
      return;
    }

    // Remove from namespace index
    const namespaceCommands = this.namespaceIndex.get(command.namespace);
    if (namespaceCommands) {
      namespaceCommands.delete(fullName);
      if (namespaceCommands.size === 0) {
        this.namespaceIndex.delete(command.namespace);
      }
    }

    // Remove from plugin index
    const pluginCmds = this.pluginCommands.get(command.pluginId);
    if (pluginCmds) {
      pluginCmds.delete(fullName);
    }

    // Remove command
    this.commands.delete(fullName);

    // Notify listeners
    if (this.events.onCommandUnregistered) {
      this.events.onCommandUnregistered(fullName);
    }

    this.logger.debug('Command unregistered', { fullName });
  }

  /**
   * Look up a command by name (supports short and full names)
   */
  lookupCommand(name: string): CommandLookupResult | null {
    // Try exact match first
    const exact = this.commands.get(name);
    if (exact) {
      return {
        command: exact,
        namespace: exact.namespace,
        pluginId: exact.pluginId,
      };
    }

    // Try with default namespace
    const withDefault = this.buildFullCommandName(this.config.defaultNamespace, name);
    const defaultMatch = this.commands.get(withDefault);
    if (defaultMatch) {
      return {
        command: defaultMatch,
        namespace: defaultMatch.namespace,
        pluginId: defaultMatch.pluginId,
      };
    }

    // Search all namespaces for short name match
    for (const [fullName, command] of this.commands) {
      if (fullName.endsWith(`.${name}`)) {
        return {
          command,
          namespace: command.namespace,
          pluginId: command.pluginId,
        };
      }
    }

    return null;
  }

  /**
   * Get a command by full name
   */
  getCommand(fullName: string): RegisteredCommand | undefined {
    return this.commands.get(fullName);
  }

  /**
   * Check if a command exists
   */
  hasCommand(name: string): boolean {
    return this.lookupCommand(name) !== null;
  }

  /**
   * Execute a command
   */
  async executeCommand<T>(
    name: string,
    params: unknown,
    context: Omit<CommandContext, 'params'>
  ): Promise<CommandExecutionResult<T>> {
    const startTime = Date.now();
    const lookup = this.lookupCommand(name);

    if (!lookup) {
      throw new CommandNotFoundError(name);
    }

    const { command, namespace } = lookup;
    const fullName = command.fullName;

    try {
      // Validate parameters
      const validatedParams = validateOrThrow(
        command.definition.inputSchema,
        params,
        fullName
      );

      // Create full context
      const fullContext: CommandContext = {
        ...context,
        params: validatedParams,
      };

      // Check middleware/guards
      if (command.definition.guards) {
        for (const guard of command.definition.guards) {
          const guardResult = await guard(fullContext);
          if (!guardResult.allowed) {
            throw new SecurityViolationError(
              guardResult.reason || 'Guard check failed',
              fullName
            );
          }
        }
      }

      // Execute the handler
      const result = await command.definition.handler(fullContext);

      // Validate output if schema provided
      if (command.definition.outputSchema) {
        const outputResult = command.definition.outputSchema.safeParse(result);
        if (!outputResult.success) {
          this.logger.warn('Output validation failed', {
            fullName,
            errors: outputResult.error.errors,
          });
        }
      }

      const executionTimeMs = Date.now() - startTime;

      // Update metrics
      if (this.config.enableTelemetry) {
        this.updateMetrics(fullName, executionTimeMs, true);
      }

      const execResult: CommandExecutionResult<T> = {
        success: true,
        data: result as T,
        executionTimeMs,
        commandName: fullName,
        namespace,
      };

      // Notify listeners
      if (this.events.onCommandExecuted) {
        this.events.onCommandExecuted(execResult);
      }

      return execResult;
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;

      // Update metrics
      if (this.config.enableTelemetry) {
        this.updateMetrics(fullName, executionTimeMs, false);
      }

      // Notify listeners
      if (this.events.onCommandFailed) {
        this.events.onCommandFailed(fullName, error as Error);
      }

      this.logger.error('Command execution failed', error as Error, {
        fullName,
        executionTimeMs,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs,
        commandName: fullName,
        namespace,
      };
    }
  }

  /**
   * Get all commands as a list for AI tools
   */
  getCommandsForAI(): CommandListItem[] {
    const items: CommandListItem[] = [];

    for (const [fullName, registered] of this.commands) {
      const def = registered.definition;
      const annotations = def.annotations || ({} as CommandAnnotations);

      items.push({
        name: def.name,
        fullName,
        namespace: registered.namespace,
        description: def.description,
        riskLevel: annotations.riskLevel || 'low',
        tags: annotations.tags || [],
        inputSchema: this.schemaToJsonSchema(def.inputSchema),
      });
    }

    return items.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /**
   * Get commands by namespace
   */
  getCommandsByNamespace(namespace: string): RegisteredCommand[] {
    const commands: RegisteredCommand[] = [];
    const namespaceCommands = this.namespaceIndex.get(namespace);

    if (namespaceCommands) {
      for (const fullName of namespaceCommands) {
        const cmd = this.commands.get(fullName);
        if (cmd) {
          commands.push(cmd);
        }
      }
    }

    return commands;
  }

  /**
   * Get commands by tag
   */
  getCommandsByTag(tag: string): RegisteredCommand[] {
    const commands: RegisteredCommand[] = [];

    for (const command of this.commands.values()) {
      const tags = command.definition.annotations?.tags || [];
      if (tags.includes(tag)) {
        commands.push(command);
      }
    }

    return commands;
  }

  /**
   * Get commands by risk level
   */
  getCommandsByRiskLevel(riskLevel: CommandAnnotations['riskLevel']): RegisteredCommand[] {
    const commands: RegisteredCommand[] = [];

    for (const command of this.commands.values()) {
      if (command.definition.annotations?.riskLevel === riskLevel) {
        commands.push(command);
      }
    }

    return commands;
  }

  /**
   * Get all registered namespaces
   */
  getNamespaces(): string[] {
    return Array.from(this.namespaceIndex.keys()).sort();
  }

  /**
   * Get command count
   */
  getCommandCount(): number {
    return this.commands.size;
  }

  /**
   * Get metrics for a command
   */
  getCommandMetrics(fullName: string): CommandMetrics | undefined {
    return this.metrics.get(fullName);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): CommandMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Clear all commands
   */
  clear(): void {
    this.commands.clear();
    this.namespaceIndex.clear();
    this.pluginCommands.clear();
    this.metrics.clear();
    this.logger.info('Command registry cleared');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private buildFullCommandName(namespace: string, name: string): string {
    // If name already contains namespace, use as-is
    if (name.includes('.')) {
      return name;
    }
    return `${namespace}.${name}`;
  }

  private updateMetrics(fullName: string, executionTimeMs: number, success: boolean): void {
    const existing = this.metrics.get(fullName);
    if (!existing) {
      return;
    }

    const newTotalCalls = existing.totalCalls + 1;
    const newSuccessful = success ? existing.successfulCalls + 1 : existing.successfulCalls;
    const newFailed = success ? existing.failedCalls : existing.failedCalls + 1;

    // Calculate running average
    const newAverage =
      (existing.averageExecutionTimeMs * existing.totalCalls + executionTimeMs) / newTotalCalls;

    this.metrics.set(fullName, {
      commandName: fullName,
      totalCalls: newTotalCalls,
      successfulCalls: newSuccessful,
      failedCalls: newFailed,
      averageExecutionTimeMs: newAverage,
      lastCalledAt: new Date(),
    });
  }

  private schemaToJsonSchema(schema: ZodSchema): Record<string, unknown> {
    // Convert Zod schema to JSON Schema for MCP tools
    try {
      // Use zod-to-json-schema if available, otherwise return basic structure
      const description = schema.description || '';

      // Extract shape from ZodObject if possible
      if ('shape' in schema && typeof schema.shape === 'object') {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        const shape = schema.shape as Record<string, ZodSchema>;

        for (const [key, fieldSchema] of Object.entries(shape)) {
          properties[key] = this.fieldToJsonSchema(fieldSchema);

          // Check if field is required (not optional)
          if (!this.isOptional(fieldSchema)) {
            required.push(key);
          }
        }

        return {
          type: 'object',
          description,
          properties,
          required: required.length > 0 ? required : undefined,
        };
      }

      return {
        type: 'object',
        description,
      };
    } catch {
      return { type: 'object' };
    }
  }

  private fieldToJsonSchema(schema: ZodSchema): Record<string, unknown> {
    const description = schema.description || '';

    // Get the inner type name
    const typeName = this.getZodTypeName(schema);

    switch (typeName) {
      case 'ZodString':
        return { type: 'string', description };
      case 'ZodNumber':
        return { type: 'number', description };
      case 'ZodBoolean':
        return { type: 'boolean', description };
      case 'ZodArray':
        return { type: 'array', description };
      case 'ZodObject':
        return this.schemaToJsonSchema(schema);
      case 'ZodEnum':
        return { type: 'string', description };
      case 'ZodOptional':
        return this.fieldToJsonSchema((schema as z.ZodOptional<ZodSchema>).unwrap());
      case 'ZodDefault':
        return this.fieldToJsonSchema((schema as z.ZodDefault<ZodSchema>).removeDefault());
      default:
        return { description };
    }
  }

  private getZodTypeName(schema: ZodSchema): string {
    return (schema as { _def?: { typeName?: string } })._def?.typeName || 'unknown';
  }

  private isOptional(schema: ZodSchema): boolean {
    const typeName = this.getZodTypeName(schema);
    return typeName === 'ZodOptional' || typeName === 'ZodDefault';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createCommandRegistry(
  config: Partial<CommandRegistryConfig>,
  logger: Logger,
  events?: CommandRegistryEvents
): CommandRegistry {
  return new CommandRegistry(config, logger, events);
}
