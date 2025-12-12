/**
 * AEGIS WorldGen Plugin
 * World generation commands for terrain, biomes, foliage, and PCG (Phase 7)
 */

import { AegisPlugin, PluginLoadContext, CommandDefinition } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { Logger } from '../../utils/logger.js';
import { createTerrainCommands } from './terrain-commands.js';
import { createBiomeCommands } from './biome-commands.js';
import { createFoliageCommands } from './foliage-commands.js';
import { createPCGCommands } from './pcg-commands.js';

// ============================================================================
// Plugin Metadata
// ============================================================================

const PLUGIN_ID = 'aegis.worldgen';
const PLUGIN_VERSION = '1.0.0';
const PLUGIN_NAMESPACE = 'aegis.worldgen';

// ============================================================================
// Plugin State
// ============================================================================

let pluginBridge: BridgeManager | null = null;
let pluginLogger: Logger | null = null;

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create the WorldGen plugin with all commands
 */
export function createWorldGenPlugin(bridge: BridgeManager, logger: Logger): AegisPlugin {
  // Collect all commands
  const allCommands: CommandDefinition[] = [
    ...createTerrainCommands(bridge),
    ...createBiomeCommands(bridge),
    ...createFoliageCommands(bridge),
    ...createPCGCommands(bridge),
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
      name: 'AEGIS WorldGen',
      version: PLUGIN_VERSION,
      description: 'World generation plugin for terrain, biomes, foliage, and procedural content',
      author: 'AEGIS Team',
      namespace: PLUGIN_NAMESPACE,
      tags: ['worldgen', 'terrain', 'landscape', 'biome', 'foliage', 'pcg', 'procedural'],
      dependencies: [
        {
          pluginId: 'aegis.core',
          minVersion: '1.0.0',
          optional: false,
        },
      ],
    },

    commands: commandsWithLogger,

    onLoad: async (context: PluginLoadContext) => {
      pluginBridge = bridge;
      pluginLogger = logger;

      logger.info('AEGIS WorldGen Plugin loaded', {
        version: PLUGIN_VERSION,
        commandCount: allCommands.length,
        categories: ['terrain', 'biome', 'foliage', 'pcg'],
      });

      // Verify landscape support
      const landscapeSupport = await checkLandscapeSupport(bridge);
      if (!landscapeSupport) {
        logger.warn('Landscape subsystem not available - some features may not work');
      }

      // Verify PCG support
      const pcgSupport = await checkPCGSupport(bridge);
      if (!pcgSupport) {
        logger.warn('PCG subsystem not available - PCG features will be limited');
      }
    },

    onUnload: async () => {
      logger.info('AEGIS WorldGen Plugin unloading');
      pluginBridge = null;
      pluginLogger = null;
    },

    healthCheck: async () => {
      if (!pluginBridge) {
        return {
          healthy: false,
          message: 'Bridge not initialized',
        };
      }

      const bridgeStatus = pluginBridge.getStatus();
      if (!bridgeStatus.httpConnected) {
        return {
          healthy: false,
          message: 'Not connected to Unreal Engine',
        };
      }

      // Check subsystem availability
      const landscapeOk = await checkLandscapeSupport(pluginBridge);
      const pcgOk = await checkPCGSupport(pluginBridge);

      return {
        healthy: true,
        message: `Landscape: ${landscapeOk ? 'OK' : 'Limited'}, PCG: ${pcgOk ? 'OK' : 'Limited'}`,
      };
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

async function checkLandscapeSupport(bridge: BridgeManager): Promise<boolean> {
  try {
    const result = await bridge.remoteControl.callFunction(
      '/Script/Landscape.Default__LandscapeEditorUtils',
      'IsLandscapeSubsystemAvailable'
    );
    return result.success;
  } catch {
    return false;
  }
}

async function checkPCGSupport(bridge: BridgeManager): Promise<boolean> {
  try {
    const result = await bridge.remoteControl.callFunction(
      '/Script/PCG.Default__PCGBlueprintHelpers',
      'IsPCGSubsystemAvailable'
    );
    return result.success;
  } catch {
    return false;
  }
}

// ============================================================================
// Default Export for Plugin Loader
// ============================================================================

export default {
  metadata: {
    id: PLUGIN_ID,
    name: 'AEGIS WorldGen',
    version: PLUGIN_VERSION,
    description: 'World generation plugin for terrain, biomes, foliage, and procedural content',
    author: 'AEGIS Team',
    namespace: PLUGIN_NAMESPACE,
    tags: ['worldgen', 'terrain', 'landscape', 'biome', 'foliage', 'pcg', 'procedural'],
    dependencies: [
      {
        pluginId: 'aegis.core',
        minVersion: '1.0.0',
        optional: false,
      },
    ],
  },

  commands: [],

  onLoad: async (context: PluginLoadContext) => {
    console.log('AEGIS WorldGen Plugin loaded via file system');
  },

  onUnload: async () => {
    console.log('AEGIS WorldGen Plugin unloaded');
  },
};

// ============================================================================
// Command Categories
// ============================================================================

export const WorldGenCategories = {
  TERRAIN: 'terrain',
  BIOME: 'biome',
  FOLIAGE: 'foliage',
  PCG: 'pcg',
} as const;

// ============================================================================
// Command Helpers
// ============================================================================

/**
 * Get all WorldGen commands by category
 */
export function getWorldGenCommandsByCategory(
  bridge: BridgeManager
): Record<string, CommandDefinition[]> {
  return {
    [WorldGenCategories.TERRAIN]: createTerrainCommands(bridge),
    [WorldGenCategories.BIOME]: createBiomeCommands(bridge),
    [WorldGenCategories.FOLIAGE]: createFoliageCommands(bridge),
    [WorldGenCategories.PCG]: createPCGCommands(bridge),
  };
}

/**
 * Get command count by category
 */
export function getWorldGenCommandCount(bridge: BridgeManager): Record<string, number> {
  const categories = getWorldGenCommandsByCategory(bridge);
  const counts: Record<string, number> = {};

  for (const [category, commands] of Object.entries(categories)) {
    counts[category] = commands.length;
  }

  return counts;
}

// ============================================================================
// Re-exports
// ============================================================================

export { createTerrainCommands } from './terrain-commands.js';
export { createBiomeCommands } from './biome-commands.js';
export { createFoliageCommands } from './foliage-commands.js';
export { createPCGCommands } from './pcg-commands.js';
