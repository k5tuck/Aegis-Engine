/**
 * AEGIS Core Plugin
 * Main plugin providing fundamental editor commands
 */

import { AegisPlugin, PluginLoadContext, CommandDefinition } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { Logger } from '../../utils/logger.js';
import { createActorCommands } from './actor-commands.js';
import { createBlueprintCommands } from './blueprint-commands.js';
import { createAssetCommands } from './asset-commands.js';
import { createLevelCommands } from './level-commands.js';
import { createMaterialCommands } from './material-commands.js';

// ============================================================================
// Plugin Metadata
// ============================================================================

const PLUGIN_ID = 'aegis.core';
const PLUGIN_VERSION = '1.0.0';
const PLUGIN_NAMESPACE = 'aegis.core';

// ============================================================================
// Plugin State
// ============================================================================

let pluginBridge: BridgeManager | null = null;
let pluginLogger: Logger | null = null;

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create the core plugin with all commands
 */
export function createCorePlugin(bridge: BridgeManager, logger: Logger): AegisPlugin {
  // Collect all commands
  const allCommands: CommandDefinition[] = [
    ...createActorCommands(bridge),
    ...createBlueprintCommands(bridge),
    ...createAssetCommands(bridge),
    ...createLevelCommands(bridge),
    ...createMaterialCommands(bridge),
  ];

  // Inject logger into command contexts
  const commandsWithLogger = allCommands.map((cmd) => ({
    ...cmd,
    handler: async (context: any) => {
      return cmd.handler({
        ...context,
        logger: logger.child({ command: cmd.name }),
      });
    },
  }));

  return {
    metadata: {
      id: PLUGIN_ID,
      name: 'AEGIS Core',
      version: PLUGIN_VERSION,
      description: 'Core plugin providing fundamental Unreal Engine editor commands',
      author: 'AEGIS Team',
      namespace: PLUGIN_NAMESPACE,
      tags: ['core', 'editor', 'actors', 'blueprints', 'assets', 'levels', 'materials'],
    },

    commands: commandsWithLogger,

    onLoad: async (context: PluginLoadContext) => {
      pluginBridge = bridge;
      pluginLogger = logger;

      logger.info('AEGIS Core Plugin loaded', {
        version: PLUGIN_VERSION,
        commandCount: allCommands.length,
      });

      // Verify bridge connection
      if (!bridge.isConnected()) {
        logger.warn('Bridge not connected during plugin load');
      }
    },

    onUnload: async () => {
      logger.info('AEGIS Core Plugin unloading');
      pluginBridge = null;
      pluginLogger = null;
    },

    healthCheck: async () => {
      const bridgeStatus = pluginBridge?.getStatus();

      if (!bridgeStatus) {
        return {
          healthy: false,
          message: 'Bridge not initialized',
        };
      }

      if (!bridgeStatus.httpConnected && !bridgeStatus.wsConnected) {
        return {
          healthy: false,
          message: 'Not connected to Unreal Engine',
        };
      }

      return {
        healthy: true,
        message: `Connected (HTTP: ${bridgeStatus.httpConnected}, WS: ${bridgeStatus.wsConnected})`,
      };
    },
  };
}

// ============================================================================
// Default Export for Plugin Loader
// ============================================================================

/**
 * Plugin entry point
 * Used by the plugin loader when loading from file
 */
export default {
  metadata: {
    id: PLUGIN_ID,
    name: 'AEGIS Core',
    version: PLUGIN_VERSION,
    description: 'Core plugin providing fundamental Unreal Engine editor commands',
    author: 'AEGIS Team',
    namespace: PLUGIN_NAMESPACE,
    tags: ['core', 'editor', 'actors', 'blueprints', 'assets', 'levels', 'materials'],
  },

  // Placeholder commands - actual commands are created by createCorePlugin
  commands: [],

  onLoad: async (context: PluginLoadContext) => {
    // This is called when loaded via file system
    // Bridge and logger should be provided in context
    console.log('AEGIS Core Plugin loaded via file system');
  },

  onUnload: async () => {
    console.log('AEGIS Core Plugin unloaded');
  },
};

// ============================================================================
// Command Categories
// ============================================================================

export const CommandCategories = {
  ACTOR: 'actor',
  BLUEPRINT: 'blueprint',
  ASSET: 'asset',
  LEVEL: 'level',
  MATERIAL: 'material',
} as const;

// ============================================================================
// Command Helpers
// ============================================================================

/**
 * Get all core commands by category
 */
export function getCoreCommandsByCategory(
  bridge: BridgeManager
): Record<string, CommandDefinition[]> {
  return {
    [CommandCategories.ACTOR]: createActorCommands(bridge),
    [CommandCategories.BLUEPRINT]: createBlueprintCommands(bridge),
    [CommandCategories.ASSET]: createAssetCommands(bridge),
    [CommandCategories.LEVEL]: createLevelCommands(bridge),
    [CommandCategories.MATERIAL]: createMaterialCommands(bridge),
  };
}

/**
 * Get command count by category
 */
export function getCoreCommandCount(bridge: BridgeManager): Record<string, number> {
  const categories = getCoreCommandsByCategory(bridge);
  const counts: Record<string, number> = {};

  for (const [category, commands] of Object.entries(categories)) {
    counts[category] = commands.length;
  }

  return counts;
}

// ============================================================================
// Re-exports
// ============================================================================

export { createActorCommands } from './actor-commands.js';
export { createBlueprintCommands } from './blueprint-commands.js';
export { createAssetCommands } from './asset-commands.js';
export { createLevelCommands } from './level-commands.js';
export { createMaterialCommands } from './material-commands.js';
