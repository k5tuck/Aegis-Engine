/**
 * AEGIS MCP Server
 * Main server implementation for Model Context Protocol
 *
 * Provides AI-powered Unreal Engine development assistance through:
 * - Multi-model AI adapter system (Claude, OpenAI, DeepSeek, Ollama)
 * - Secure command execution with sandbox and safe mode
 * - Hot-reload plugin architecture
 * - Real-time UE bridge communication
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { Logger, createLogger, LogLevel } from './utils/logger.js';
import { AegisError, ErrorCodes, wrapError } from './utils/errors.js';
import { loadConfig, AegisConfig } from './utils/helpers.js';

import { RegistryManager } from './registry/index.js';
import { BridgeManager } from './bridge/index.js';
import { CommandExecutor } from './execution/executor.js';
import { SecuritySandbox } from './execution/sandbox.js';
import { SafeModeManager } from './execution/safe-mode.js';
import { RollbackManager } from './execution/rollback.js';

import { ModelAdapterFactory, ModelConfig } from './adapters/index.js';
import { ErrorHandler } from './feedback/error-handler.js';
import { ContextProvider } from './feedback/context-provider.js';
import { LoopManager } from './feedback/loop-manager.js';

import { createCorePlugin } from './plugins/core/index.js';
import { createWorldGenPlugin } from './plugins/worldgen/index.js';
import { createHoudiniPlugin } from './plugins/houdini/index.js';
import { createNPCPlugin } from './plugins/npc/index.js';
import { createSeedPlugin } from './plugins/seed/index.js';

// ============================================================================
// Server Configuration Schema
// ============================================================================

const ServerConfigSchema = z.object({
  name: z.string().default('aegis-mcp-server'),
  version: z.string().default('1.0.0'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  bridge: z.object({
    host: z.string().default('localhost'),
    httpPort: z.number().default(30010),
    wsPort: z.number().default(30020),
    timeout: z.number().default(30000),
    retryAttempts: z.number().default(3),
    retryDelay: z.number().default(1000),
  }).default({}),
  security: z.object({
    enableSandbox: z.boolean().default(true),
    enableSafeMode: z.boolean().default(true),
    allowedPaths: z.array(z.string()).default([]),
    blockedCommands: z.array(z.string()).default([]),
    maxOperationsPerMinute: z.number().default(60),
    requireConfirmation: z.array(z.string()).default([
      'delete_actor',
      'delete_asset',
      'clear_guid_registry',
    ]),
  }).default({}),
  models: z.object({
    default: z.string().default('claude'),
    configs: z.record(z.object({
      provider: z.string(),
      model: z.string(),
      apiKey: z.string().optional(),
      baseUrl: z.string().optional(),
      options: z.record(z.any()).optional(),
    })).default({}),
  }).default({}),
  plugins: z.object({
    autoload: z.boolean().default(true),
    paths: z.array(z.string()).default([]),
    disabled: z.array(z.string()).default([]),
  }).default({}),
});

type ServerConfig = z.infer<typeof ServerConfigSchema>;

// ============================================================================
// AEGIS MCP Server Class
// ============================================================================

export class AegisMCPServer {
  private server: Server;
  private logger: Logger;
  private config: ServerConfig;

  // Core components
  private registry: RegistryManager;
  private bridge: BridgeManager;
  private executor: CommandExecutor;
  private sandbox: SecuritySandbox;
  private safeMode: SafeModeManager;
  private rollback: RollbackManager;

  // AI components
  private modelFactory: ModelAdapterFactory;
  private errorHandler: ErrorHandler;
  private contextProvider: ContextProvider;
  private loopManager: LoopManager;

  private initialized = false;
  private shuttingDown = false;

  constructor(config: Partial<ServerConfig> = {}) {
    // Parse and validate config
    this.config = ServerConfigSchema.parse(config);

    // Create logger
    this.logger = createLogger({
      level: this.config.logLevel as LogLevel,
      prefix: 'AEGIS',
    });

    // Create MCP server
    this.server = new Server(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    // Initialize core components
    this.bridge = new BridgeManager({
      host: this.config.bridge.host,
      httpPort: this.config.bridge.httpPort,
      wsPort: this.config.bridge.wsPort,
      timeout: this.config.bridge.timeout,
      retryAttempts: this.config.bridge.retryAttempts,
      retryDelay: this.config.bridge.retryDelay,
    });

    this.sandbox = new SecuritySandbox({
      enabled: this.config.security.enableSandbox,
      allowedPaths: this.config.security.allowedPaths,
      blockedCommands: this.config.security.blockedCommands,
      maxOperationsPerMinute: this.config.security.maxOperationsPerMinute,
    });

    this.safeMode = new SafeModeManager({
      enabled: this.config.security.enableSafeMode,
      requireConfirmation: this.config.security.requireConfirmation,
    });

    this.rollback = new RollbackManager({
      maxHistory: 100,
      autoCapture: true,
    });

    this.registry = new RegistryManager();

    this.executor = new CommandExecutor({
      registry: this.registry,
      bridge: this.bridge,
      sandbox: this.sandbox,
      safeMode: this.safeMode,
      rollback: this.rollback,
      logger: this.logger,
    });

    // Initialize AI components
    this.modelFactory = new ModelAdapterFactory();

    this.errorHandler = new ErrorHandler({
      logger: this.logger,
      maxRetries: 3,
    });

    this.contextProvider = new ContextProvider({
      bridge: this.bridge,
      registry: this.registry,
    });

    this.loopManager = new LoopManager({
      executor: this.executor,
      contextProvider: this.contextProvider,
      errorHandler: this.errorHandler,
      logger: this.logger,
    });

    // Setup handlers
    this.setupHandlers();

    this.logger.info('AEGIS MCP Server created', {
      name: this.config.name,
      version: this.config.version,
    });
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('Server already initialized');
      return;
    }

    this.logger.info('Initializing AEGIS MCP Server...');

    try {
      // Connect to UE bridge
      this.logger.info('Connecting to Unreal Engine bridge...');
      await this.bridge.connect();
      this.logger.info('Bridge connected successfully');

      // Initialize model adapters
      this.logger.info('Initializing model adapters...');
      await this.initializeModels();

      // Load plugins
      this.logger.info('Loading plugins...');
      await this.loadPlugins();

      // Initialize registry
      await this.registry.initialize();

      this.initialized = true;
      this.logger.info('AEGIS MCP Server initialized successfully', {
        commandCount: this.registry.getCommandCount(),
        pluginCount: this.registry.getPluginCount(),
      });
    } catch (error) {
      this.logger.error('Failed to initialize server', { error });
      throw wrapError(error, 'Server initialization failed');
    }
  }

  private async initializeModels(): Promise<void> {
    // Register default Claude adapter
    if (!this.config.models.configs['claude']) {
      this.modelFactory.registerAdapter('claude', {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }

    // Register configured models
    for (const [name, config] of Object.entries(this.config.models.configs)) {
      this.modelFactory.registerAdapter(name, config as ModelConfig);
    }
  }

  private async loadPlugins(): Promise<void> {
    const pluginContext = {
      bridge: this.bridge,
      logger: this.logger,
      registerCommand: this.registry.registerCommand.bind(this.registry),
      config: this.config,
    };

    // Load built-in plugins
    const builtinPlugins = [
      { name: 'core', factory: createCorePlugin },
      { name: 'worldgen', factory: createWorldGenPlugin },
      { name: 'houdini', factory: createHoudiniPlugin },
      { name: 'npc', factory: createNPCPlugin },
      { name: 'seed', factory: createSeedPlugin },
    ];

    for (const { name, factory } of builtinPlugins) {
      if (this.config.plugins.disabled.includes(name)) {
        this.logger.info(`Plugin ${name} is disabled, skipping`);
        continue;
      }

      try {
        const plugin = factory();
        await plugin.initialize(pluginContext as any);
        this.registry.registerPlugin(plugin);
        this.logger.info(`Plugin loaded: ${name}`, {
          namespace: plugin.manifest.namespace,
          commands: plugin.getCommands().length,
        });
      } catch (error) {
        this.logger.error(`Failed to load plugin: ${name}`, { error });
      }
    }

    // Load custom plugins from paths
    if (this.config.plugins.autoload) {
      for (const pluginPath of this.config.plugins.paths) {
        try {
          await this.registry.loadPluginFromPath(pluginPath, pluginContext as any);
        } catch (error) {
          this.logger.error(`Failed to load plugin from path: ${pluginPath}`, { error });
        }
      }
    }
  }

  // ============================================================================
  // MCP Handlers
  // ============================================================================

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const commands = this.registry.getAllCommands();

      return {
        tools: commands.map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
          inputSchema: cmd.parameters ? this.zodToJsonSchema(cmd.parameters) : { type: 'object', properties: {} },
        })),
      };
    });

    // Execute tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.executor.execute(name, args || {});

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const aegisError = error instanceof AegisError
          ? error
          : new AegisError(
              (error as Error).message,
              ErrorCodes.EXECUTION_ERROR,
              { command: name, args }
            );

        // Let error handler process it
        const handled = await this.errorHandler.handle(aegisError, { command: name, args });

        if (handled.retry && handled.suggestion) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: aegisError.message,
                  suggestion: handled.suggestion,
                  recoverable: handled.retry,
                }, null, 2),
              },
            ],
            isError: true,
          };
        }

        throw new McpError(
          ErrorCode.InternalError,
          aegisError.message,
          aegisError.details
        );
      }
    });

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'aegis://context/current',
            name: 'Current Editor Context',
            description: 'Current state of the Unreal Engine editor',
            mimeType: 'application/json',
          },
          {
            uri: 'aegis://context/selection',
            name: 'Current Selection',
            description: 'Currently selected actors and assets',
            mimeType: 'application/json',
          },
          {
            uri: 'aegis://context/level',
            name: 'Level Information',
            description: 'Information about the current level',
            mimeType: 'application/json',
          },
          {
            uri: 'aegis://commands',
            name: 'Available Commands',
            description: 'List of all available AEGIS commands',
            mimeType: 'application/json',
          },
        ],
      };
    });

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      switch (uri) {
        case 'aegis://context/current':
          const context = await this.contextProvider.getCurrentContext();
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(context, null, 2),
              },
            ],
          };

        case 'aegis://context/selection':
          const selection = await this.contextProvider.getSelection();
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(selection, null, 2),
              },
            ],
          };

        case 'aegis://context/level':
          const level = await this.contextProvider.getLevelInfo();
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(level, null, 2),
              },
            ],
          };

        case 'aegis://commands':
          const commands = this.registry.getAllCommands();
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(
                  commands.map((c) => ({
                    name: c.name,
                    description: c.description,
                    category: c.category,
                  })),
                  null,
                  2
                ),
              },
            ],
          };

        default:
          throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
      }
    });

    // List prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [
          {
            name: 'create_actor',
            description: 'Create a new actor in the scene with AI assistance',
            arguments: [
              {
                name: 'description',
                description: 'Natural language description of what to create',
                required: true,
              },
            ],
          },
          {
            name: 'modify_scene',
            description: 'Modify the current scene based on description',
            arguments: [
              {
                name: 'description',
                description: 'What changes to make',
                required: true,
              },
            ],
          },
          {
            name: 'generate_terrain',
            description: 'Generate terrain based on description',
            arguments: [
              {
                name: 'description',
                description: 'Description of the terrain to generate',
                required: true,
              },
            ],
          },
          {
            name: 'create_npc',
            description: 'Create an NPC with behavior',
            arguments: [
              {
                name: 'description',
                description: 'Description of the NPC and its behavior',
                required: true,
              },
            ],
          },
        ],
      };
    });

    // Get prompt
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const promptTemplates: Record<string, (args: Record<string, string>) => string> = {
        create_actor: (a) => `
You are an Unreal Engine AI assistant. Create an actor based on this description:

"${a.description}"

Use the available AEGIS commands to:
1. Determine what type of actor to create
2. Spawn the actor with appropriate settings
3. Configure components and properties
4. Position it appropriately in the scene

Explain your reasoning and the commands you'll use.
        `.trim(),

        modify_scene: (a) => `
You are an Unreal Engine AI assistant. Modify the current scene based on this request:

"${a.description}"

First, analyze the current scene context, then use AEGIS commands to make the requested changes.
Explain what changes you're making and why.
        `.trim(),

        generate_terrain: (a) => `
You are an Unreal Engine AI assistant. Generate terrain based on this description:

"${a.description}"

Use the WorldGen plugin commands to:
1. Create the landscape
2. Generate heightmap or procedural terrain
3. Apply biomes and layers
4. Add foliage as appropriate

Consider using PCG for procedural elements.
        `.trim(),

        create_npc: (a) => `
You are an Unreal Engine AI assistant. Create an NPC based on this description:

"${a.description}"

Use the NPC plugin commands to:
1. Create appropriate AI controller
2. Set up behavior tree
3. Configure perception
4. Spawn the character

Make the NPC behavior match the description.
        `.trim(),
      };

      const template = promptTemplates[name];
      if (!template) {
        throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
      }

      return {
        description: `Prompt for ${name}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: template(args || {}),
            },
          },
        ],
      };
    });

    // Error handling
    this.server.onerror = (error) => {
      this.logger.error('MCP Server error', { error });
    };
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private zodToJsonSchema(schema: z.ZodType): any {
    // Basic Zod to JSON Schema conversion
    // In production, use a proper library like zod-to-json-schema
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = this.zodToJsonSchema(value as z.ZodType);
        if (!(value as any).isOptional()) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      };
    }

    if (schema instanceof z.ZodString) {
      return { type: 'string' };
    }

    if (schema instanceof z.ZodNumber) {
      return { type: 'number' };
    }

    if (schema instanceof z.ZodBoolean) {
      return { type: 'boolean' };
    }

    if (schema instanceof z.ZodArray) {
      return {
        type: 'array',
        items: this.zodToJsonSchema((schema as any)._def.type),
      };
    }

    if (schema instanceof z.ZodEnum) {
      return {
        type: 'string',
        enum: (schema as any)._def.values,
      };
    }

    if (schema instanceof z.ZodOptional) {
      return this.zodToJsonSchema((schema as any)._def.innerType);
    }

    if (schema instanceof z.ZodDefault) {
      return this.zodToJsonSchema((schema as any)._def.innerType);
    }

    return { type: 'object' };
  }

  // ============================================================================
  // Server Lifecycle
  // ============================================================================

  async start(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.logger.info('Starting AEGIS MCP Server...');

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    this.logger.info('AEGIS MCP Server started and listening');

    // Handle shutdown signals
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    this.logger.info('Shutting down AEGIS MCP Server...');

    try {
      // Shutdown plugins
      await this.registry.shutdownAll();

      // Disconnect bridge
      await this.bridge.disconnect();

      // Close server
      await this.server.close();

      this.logger.info('AEGIS MCP Server shut down successfully');
    } catch (error) {
      this.logger.error('Error during shutdown', { error });
    }

    process.exit(0);
  }

  // ============================================================================
  // Public API
  // ============================================================================

  getRegistry(): RegistryManager {
    return this.registry;
  }

  getBridge(): BridgeManager {
    return this.bridge;
  }

  getExecutor(): CommandExecutor {
    return this.executor;
  }

  getModelAdapter(name?: string) {
    return this.modelFactory.getAdapter(name || this.config.models.default);
  }

  async queryUnrealAIAssistant(query: string): Promise<any> {
    // Integration with Unreal AI Assistant for context
    const context = await this.contextProvider.getCurrentContext();

    return this.bridge.remoteControl.callFunction(
      '/Script/AegisBridge.AegisAIAssistantIntegration',
      'QueryForContext',
      {
        Query: query,
        CurrentContext: JSON.stringify(context),
      }
    );
  }
}

// ============================================================================
// Exports
// ============================================================================

export { ServerConfig, ServerConfigSchema };
