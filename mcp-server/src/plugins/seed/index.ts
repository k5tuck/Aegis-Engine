/**
 * AEGIS Seed Protocol Plugin
 * Phase 9 - Deterministic world state synchronization
 *
 * Provides:
 * - GUID generation for deterministic entity identification
 * - State capture and restoration
 * - Diff/merge for world state synchronization
 */

import { AegisPlugin, PluginManifest, PluginContext, CommandDefinition } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { createGUIDCommands } from './guid-generator.js';
import { createStateCaptureCommands } from './state-capture.js';
import { createDiffMergeCommands } from './diff-merge.js';

// ============================================================================
// Plugin Manifest
// ============================================================================

const seedPluginManifest: PluginManifest = {
  name: 'aegis-seed-protocol',
  version: '1.0.0',
  description: 'Seed Protocol for deterministic world state synchronization',
  author: 'AEGIS Team',
  namespace: 'aegis.seed',
  dependencies: ['aegis-core'],
  capabilities: [
    'guid_generation',
    'state_capture',
    'state_restoration',
    'snapshot_management',
    'diff_computation',
    'world_merge',
    'state_synchronization',
  ],
  requiredBridgeVersion: '1.0.0',
};

// ============================================================================
// Plugin Implementation
// ============================================================================

class SeedProtocolPlugin implements AegisPlugin {
  public readonly manifest = seedPluginManifest;
  private bridge: BridgeManager | null = null;
  private context: PluginContext | null = null;
  private commands: CommandDefinition[] = [];
  private initialized = false;

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    this.bridge = context.bridge;

    context.logger.info('Initializing Seed Protocol plugin', {
      namespace: this.manifest.namespace,
    });

    // Create all commands
    this.commands = [
      ...createGUIDCommands(this.bridge),
      ...createStateCaptureCommands(this.bridge),
      ...createDiffMergeCommands(this.bridge),
    ];

    // Register commands
    for (const command of this.commands) {
      context.registerCommand(command);
    }

    // Subscribe to relevant UE events
    if (this.bridge.websocket) {
      this.bridge.websocket.subscribe('world.entity.spawned', this.handleEntitySpawned.bind(this));
      this.bridge.websocket.subscribe('world.entity.destroyed', this.handleEntityDestroyed.bind(this));
      this.bridge.websocket.subscribe('world.level.changed', this.handleLevelChanged.bind(this));
    }

    // Initialize UE-side seed subsystem
    try {
      await this.bridge.remoteControl.callFunction(
        '/Script/AegisBridge.AegisSeedSubsystem',
        'Initialize',
        { PluginVersion: this.manifest.version }
      );
    } catch (error) {
      context.logger.warn('Failed to initialize UE seed subsystem', { error });
    }

    this.initialized = true;
    context.logger.info('Seed Protocol plugin initialized', {
      commandCount: this.commands.length,
    });
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    this.context?.logger.info('Shutting down Seed Protocol plugin');

    // Unsubscribe from events
    if (this.bridge?.websocket) {
      this.bridge.websocket.unsubscribe('world.entity.spawned', this.handleEntitySpawned.bind(this));
      this.bridge.websocket.unsubscribe('world.entity.destroyed', this.handleEntityDestroyed.bind(this));
      this.bridge.websocket.unsubscribe('world.level.changed', this.handleLevelChanged.bind(this));
    }

    // Cleanup UE-side
    try {
      await this.bridge?.remoteControl.callFunction(
        '/Script/AegisBridge.AegisSeedSubsystem',
        'Shutdown'
      );
    } catch {
      // Ignore shutdown errors
    }

    this.initialized = false;
  }

  getCommands(): CommandDefinition[] {
    return this.commands;
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private handleEntitySpawned(data: any): void {
    this.context?.logger.debug('Entity spawned event', { data });
    // Could auto-register GUID here if configured
  }

  private handleEntityDestroyed(data: any): void {
    this.context?.logger.debug('Entity destroyed event', { data });
    // Could cleanup GUID registry here
  }

  private handleLevelChanged(data: any): void {
    this.context?.logger.info('Level changed event', { data });
    // Could auto-capture snapshot here if configured
  }
}

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create Seed Protocol plugin instance
 */
export function createSeedPlugin(): AegisPlugin {
  return new SeedProtocolPlugin();
}

// ============================================================================
// Re-exports
// ============================================================================

export {
  createGUIDCommands,
  createStateCaptureCommands,
  createDiffMergeCommands,
} from './guid-generator.js';

export { generateDeterministicGUID, validateGUIDFormat, guidRegistry, pathToGuidMap } from './guid-generator.js';
export { snapshotStorage, WorldSnapshot, EntitySnapshot, TransformSnapshot } from './state-capture.js';
export { diffStorage, WorldDiff, EntityDiff, computeWorldDiff } from './diff-merge.js';

export default createSeedPlugin;
