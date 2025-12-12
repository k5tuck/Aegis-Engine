#!/usr/bin/env node
/**
 * AEGIS - AI Engine Game Intelligence System
 * MCP Server Entry Point
 *
 * An AI-powered Unreal Engine development assistant providing:
 * - Multi-model AI support (Claude, OpenAI, DeepSeek, Ollama)
 * - Secure command execution with sandbox and safe mode
 * - Hot-reload plugin architecture
 * - Real-time UE bridge communication
 * - WorldGen, Houdini, NPC/AI, and Seed Protocol subsystems
 */

import { AegisMCPServer, ServerConfig } from './server.js';
import { createLogger, LogLevel } from './utils/logger.js';

// ============================================================================
// Version and Banner
// ============================================================================

const VERSION = '1.0.0';
const BANNER = `
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║     █████╗ ███████╗ ██████╗ ██╗███████╗                          ║
║    ██╔══██╗██╔════╝██╔════╝ ██║██╔════╝                          ║
║    ███████║█████╗  ██║  ███╗██║███████╗                          ║
║    ██╔══██║██╔══╝  ██║   ██║██║╚════██║                          ║
║    ██║  ██║███████╗╚██████╔╝██║███████║                          ║
║    ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝╚══════╝                          ║
║                                                                   ║
║    AI Engine Game Intelligence System                             ║
║    MCP Server v${VERSION.padEnd(52)}║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
`;

// ============================================================================
// Environment Configuration
// ============================================================================

interface EnvConfig {
  logLevel: LogLevel;
  bridgeHost: string;
  bridgeHttpPort: number;
  bridgeWsPort: number;
  enableSandbox: boolean;
  enableSafeMode: boolean;
  defaultModel: string;
  pluginPaths: string[];
}

function loadEnvConfig(): EnvConfig {
  return {
    logLevel: (process.env.AEGIS_LOG_LEVEL as LogLevel) || 'info',
    bridgeHost: process.env.AEGIS_BRIDGE_HOST || 'localhost',
    bridgeHttpPort: parseInt(process.env.AEGIS_BRIDGE_HTTP_PORT || '30010', 10),
    bridgeWsPort: parseInt(process.env.AEGIS_BRIDGE_WS_PORT || '30020', 10),
    enableSandbox: process.env.AEGIS_ENABLE_SANDBOX !== 'false',
    enableSafeMode: process.env.AEGIS_ENABLE_SAFE_MODE !== 'false',
    defaultModel: process.env.AEGIS_DEFAULT_MODEL || 'claude',
    pluginPaths: process.env.AEGIS_PLUGIN_PATHS?.split(',').filter(Boolean) || [],
  };
}

// ============================================================================
// CLI Arguments
// ============================================================================

interface CLIArgs {
  help: boolean;
  version: boolean;
  config?: string;
  logLevel?: LogLevel;
  bridgeHost?: string;
  bridgeHttpPort?: number;
  bridgeWsPort?: number;
  noSandbox: boolean;
  noSafeMode: boolean;
  verbose: boolean;
  quiet: boolean;
}

function parseArgs(args: string[]): CLIArgs {
  const result: CLIArgs = {
    help: false,
    version: false,
    noSandbox: false,
    noSafeMode: false,
    verbose: false,
    quiet: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        result.help = true;
        break;
      case '-v':
      case '--version':
        result.version = true;
        break;
      case '-c':
      case '--config':
        result.config = args[++i];
        break;
      case '-l':
      case '--log-level':
        result.logLevel = args[++i] as LogLevel;
        break;
      case '--bridge-host':
        result.bridgeHost = args[++i];
        break;
      case '--bridge-http-port':
        result.bridgeHttpPort = parseInt(args[++i], 10);
        break;
      case '--bridge-ws-port':
        result.bridgeWsPort = parseInt(args[++i], 10);
        break;
      case '--no-sandbox':
        result.noSandbox = true;
        break;
      case '--no-safe-mode':
        result.noSafeMode = true;
        break;
      case '--verbose':
        result.verbose = true;
        break;
      case '--quiet':
      case '-q':
        result.quiet = true;
        break;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
AEGIS MCP Server - AI Engine Game Intelligence System

Usage: aegis-mcp [options]

Options:
  -h, --help              Show this help message
  -v, --version           Show version number
  -c, --config <path>     Path to configuration file
  -l, --log-level <level> Log level (debug, info, warn, error)
  --bridge-host <host>    Unreal Engine bridge host (default: localhost)
  --bridge-http-port <n>  Bridge HTTP port (default: 30010)
  --bridge-ws-port <n>    Bridge WebSocket port (default: 30020)
  --no-sandbox            Disable security sandbox
  --no-safe-mode          Disable safe mode
  --verbose               Enable verbose logging
  -q, --quiet             Suppress non-error output

Environment Variables:
  AEGIS_LOG_LEVEL         Log level
  AEGIS_BRIDGE_HOST       Bridge host
  AEGIS_BRIDGE_HTTP_PORT  Bridge HTTP port
  AEGIS_BRIDGE_WS_PORT    Bridge WebSocket port
  AEGIS_ENABLE_SANDBOX    Enable sandbox (true/false)
  AEGIS_ENABLE_SAFE_MODE  Enable safe mode (true/false)
  AEGIS_DEFAULT_MODEL     Default AI model
  AEGIS_PLUGIN_PATHS      Comma-separated plugin paths
  ANTHROPIC_API_KEY       Anthropic API key for Claude
  OPENAI_API_KEY          OpenAI API key
  DEEPSEEK_API_KEY        DeepSeek API key

Examples:
  aegis-mcp                           # Start with defaults
  aegis-mcp --config config.json      # Use config file
  aegis-mcp --bridge-host 192.168.1.1 # Connect to remote UE
  aegis-mcp --verbose                 # Enable verbose logging
`);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Handle help and version
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log(`AEGIS MCP Server v${VERSION}`);
    process.exit(0);
  }

  // Load configuration
  const envConfig = loadEnvConfig();

  // Determine log level
  let logLevel: LogLevel = envConfig.logLevel;
  if (args.logLevel) logLevel = args.logLevel;
  if (args.verbose) logLevel = 'debug';
  if (args.quiet) logLevel = 'error';

  // Create logger
  const logger = createLogger({ level: logLevel, prefix: 'AEGIS' });

  // Print banner unless quiet
  if (!args.quiet) {
    console.log(BANNER);
  }

  // Load config file if specified
  let fileConfig: Partial<ServerConfig> = {};
  if (args.config) {
    try {
      const fs = await import('fs/promises');
      const configContent = await fs.readFile(args.config, 'utf-8');
      fileConfig = JSON.parse(configContent);
      logger.info('Loaded configuration file', { path: args.config });
    } catch (error) {
      logger.error('Failed to load configuration file', { path: args.config, error });
      process.exit(1);
    }
  }

  // Build final config
  const serverConfig: Partial<ServerConfig> = {
    ...fileConfig,
    logLevel,
    bridge: {
      host: args.bridgeHost || envConfig.bridgeHost,
      httpPort: args.bridgeHttpPort || envConfig.bridgeHttpPort,
      wsPort: args.bridgeWsPort || envConfig.bridgeWsPort,
      ...fileConfig.bridge,
    },
    security: {
      enableSandbox: !args.noSandbox && envConfig.enableSandbox,
      enableSafeMode: !args.noSafeMode && envConfig.enableSafeMode,
      ...fileConfig.security,
    },
    plugins: {
      paths: envConfig.pluginPaths,
      ...fileConfig.plugins,
    },
  };

  // Create and start server
  try {
    const server = new AegisMCPServer(serverConfig);

    logger.info('Starting AEGIS MCP Server', {
      bridgeHost: serverConfig.bridge?.host,
      bridgeHttpPort: serverConfig.bridge?.httpPort,
      sandboxEnabled: serverConfig.security?.enableSandbox,
      safeModeEnabled: serverConfig.security?.enableSafeMode,
    });

    await server.start();
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// ============================================================================
// Module Exports
// ============================================================================

// Core server
export { AegisMCPServer, ServerConfig } from './server.js';

// Utilities
export { Logger, createLogger, LogLevel } from './utils/logger.js';
export { AegisError, ErrorCodes, wrapError } from './utils/errors.js';
export * from './utils/helpers.js';

// Schemas
export * from './schemas/commands.js';
export * from './schemas/validators.js';
export * from './schemas/responses.js';

// Adapters
export * from './adapters/index.js';

// Execution
export { CommandExecutor } from './execution/executor.js';
export { SecuritySandbox } from './execution/sandbox.js';
export { SafeModeManager } from './execution/safe-mode.js';
export { RollbackManager } from './execution/rollback.js';

// Feedback
export { ErrorHandler } from './feedback/error-handler.js';
export { ContextProvider } from './feedback/context-provider.js';
export { LoopManager } from './feedback/loop-manager.js';

// Registry
export { RegistryManager } from './registry/index.js';
export * from './registry/plugin-types.js';
export { PluginLoader } from './registry/plugin-loader.js';
export { CommandRegistry } from './registry/command-registry.js';
export { NamespaceRouter } from './registry/namespace-router.js';

// Bridge
export { BridgeManager } from './bridge/index.js';
export { RemoteControlClient } from './bridge/remote-control.js';
export { WebSocketClient } from './bridge/websocket.js';
export { StateSync } from './bridge/state-sync.js';

// Plugins
export { createCorePlugin } from './plugins/core/index.js';
export { createWorldGenPlugin } from './plugins/worldgen/index.js';
export { createHoudiniPlugin } from './plugins/houdini/index.js';
export { createNPCPlugin } from './plugins/npc/index.js';
export { createSeedPlugin } from './plugins/seed/index.js';

// Version
export const version = VERSION;

// ============================================================================
// Run if executed directly
// ============================================================================

// Check if this module is being run directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
