/**
 * AEGIS Seed Protocol - State Capture
 * Capture and serialize world state for synchronization
 */

import { CommandDefinition } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { z } from 'zod';
import * as crypto from 'crypto';
import { guidRegistry, generateDeterministicGUID } from './guid-generator.js';

// ============================================================================
// State Capture Schemas
// ============================================================================

const CaptureTargetSchema = z.enum([
  'full',
  'actors',
  'landscape',
  'foliage',
  'materials',
  'blueprints',
  'lighting',
  'audio',
  'navigation',
  'custom',
]);

const CaptureOptionsSchema = z.object({
  targets: z.array(CaptureTargetSchema).optional().default(['full']),
  includeTransforms: z.boolean().optional().default(true),
  includeProperties: z.boolean().optional().default(true),
  includeComponents: z.boolean().optional().default(true),
  includeReferences: z.boolean().optional().default(true),
  filterByClass: z.array(z.string()).optional(),
  filterByPath: z.string().optional(),
  filterByTag: z.array(z.string()).optional(),
  maxDepth: z.number().min(1).max(10).optional().default(5),
  compressData: z.boolean().optional().default(false),
});

const CaptureWorldStateParamsSchema = z.object({
  snapshotName: z.string().describe('Name for this snapshot'),
  description: z.string().optional(),
  options: CaptureOptionsSchema.optional(),
});

const RestoreWorldStateParamsSchema = z.object({
  snapshotId: z.string().describe('ID of snapshot to restore'),
  options: z
    .object({
      mergeMode: z
        .enum(['replace', 'merge', 'selective'])
        .optional()
        .default('replace')
        .describe('How to handle existing entities'),
      preserveGUIDs: z.boolean().optional().default(true),
      dryRun: z.boolean().optional().default(false),
    })
    .optional(),
});

const CompareSnapshotsParamsSchema = z.object({
  snapshotIdA: z.string().describe('First snapshot ID'),
  snapshotIdB: z.string().describe('Second snapshot ID'),
  compareOptions: z
    .object({
      ignoreTransforms: z.boolean().optional().default(false),
      ignoreProperties: z.array(z.string()).optional(),
      tolerance: z.number().optional().default(0.001),
    })
    .optional(),
});

// ============================================================================
// Snapshot Storage
// ============================================================================

interface WorldSnapshot {
  id: string;
  name: string;
  description?: string;
  timestamp: Date;
  seed: string;
  checksum: string;
  targets: string[];
  entities: EntitySnapshot[];
  metadata: {
    capturedBy: string;
    engineVersion?: string;
    projectName?: string;
    levelName?: string;
    totalEntities: number;
    compressedSize?: number;
  };
}

interface EntitySnapshot {
  guid: string;
  class: string;
  path: string;
  name: string;
  parentGuid?: string;
  transform?: TransformSnapshot;
  properties: Record<string, any>;
  components: ComponentSnapshot[];
  references: ReferenceSnapshot[];
  tags: string[];
}

interface TransformSnapshot {
  location: { x: number; y: number; z: number };
  rotation: { pitch: number; yaw: number; roll: number };
  scale: { x: number; y: number; z: number };
}

interface ComponentSnapshot {
  guid: string;
  class: string;
  name: string;
  properties: Record<string, any>;
}

interface ReferenceSnapshot {
  propertyName: string;
  targetGuid: string;
  targetPath: string;
}

const snapshotStorage = new Map<string, WorldSnapshot>();

// ============================================================================
// State Capture Functions
// ============================================================================

/**
 * Generate snapshot ID from content
 */
function generateSnapshotId(name: string, timestamp: Date, seed: string): string {
  const input = `${name}:${timestamp.toISOString()}:${seed}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return `SNAP-${hash.substring(0, 16).toUpperCase()}`;
}

/**
 * Calculate checksum for snapshot data
 */
function calculateChecksum(entities: EntitySnapshot[]): string {
  const data = JSON.stringify(entities);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Capture actors from UE
 */
async function captureActors(
  bridge: BridgeManager,
  options: z.infer<typeof CaptureOptionsSchema>
): Promise<EntitySnapshot[]> {
  const entities: EntitySnapshot[] = [];

  try {
    // Query all actors
    const queryParams: Record<string, any> = {};

    if (options.filterByClass?.length) {
      queryParams.ClassFilter = options.filterByClass;
    }

    if (options.filterByPath) {
      queryParams.PathFilter = options.filterByPath;
    }

    if (options.filterByTag?.length) {
      queryParams.TagFilter = options.filterByTag;
    }

    const result = await bridge.remoteControl.callFunction(
      '/Script/AegisBridge.AegisSeedSubsystem',
      'CaptureAllActors',
      queryParams
    );

    if (result.success && result.data?.actors) {
      for (const actor of result.data.actors) {
        const entityGuid =
          guidRegistry.get(actor.guid)?.guid ||
          generateDeterministicGUID('actor', actor.class, '', entities.length, actor.name);

        const entitySnapshot: EntitySnapshot = {
          guid: entityGuid,
          class: actor.class,
          path: actor.path,
          name: actor.name,
          tags: actor.tags || [],
          properties: {},
          components: [],
          references: [],
        };

        // Capture transform if requested
        if (options.includeTransforms && actor.transform) {
          entitySnapshot.transform = {
            location: actor.transform.location || { x: 0, y: 0, z: 0 },
            rotation: actor.transform.rotation || { pitch: 0, yaw: 0, roll: 0 },
            scale: actor.transform.scale || { x: 1, y: 1, z: 1 },
          };
        }

        // Capture properties if requested
        if (options.includeProperties && actor.properties) {
          entitySnapshot.properties = actor.properties;
        }

        // Capture components if requested
        if (options.includeComponents && actor.components) {
          for (const comp of actor.components) {
            const compGuid = generateDeterministicGUID(
              'component',
              comp.class,
              entityGuid,
              entitySnapshot.components.length,
              comp.name
            );

            entitySnapshot.components.push({
              guid: compGuid,
              class: comp.class,
              name: comp.name,
              properties: comp.properties || {},
            });
          }
        }

        // Capture references if requested
        if (options.includeReferences && actor.references) {
          for (const ref of actor.references) {
            entitySnapshot.references.push({
              propertyName: ref.propertyName,
              targetGuid: ref.targetGuid || '',
              targetPath: ref.targetPath,
            });
          }
        }

        entities.push(entitySnapshot);
      }
    }
  } catch (error) {
    // Return empty array on failure, let caller handle
    console.error('Failed to capture actors:', error);
  }

  return entities;
}

/**
 * Capture landscape data from UE
 */
async function captureLandscape(
  bridge: BridgeManager,
  options: z.infer<typeof CaptureOptionsSchema>
): Promise<EntitySnapshot[]> {
  const entities: EntitySnapshot[] = [];

  try {
    const result = await bridge.remoteControl.callFunction(
      '/Script/AegisBridge.AegisSeedSubsystem',
      'CaptureLandscape',
      { IncludeHeightmap: true, IncludeLayers: true }
    );

    if (result.success && result.data?.landscapes) {
      for (const landscape of result.data.landscapes) {
        const entityGuid = generateDeterministicGUID(
          'landscape',
          'ALandscape',
          '',
          entities.length,
          landscape.name
        );

        entities.push({
          guid: entityGuid,
          class: 'ALandscape',
          path: landscape.path,
          name: landscape.name,
          tags: landscape.tags || [],
          transform: landscape.transform,
          properties: {
            sizeX: landscape.sizeX,
            sizeY: landscape.sizeY,
            heightmapHash: landscape.heightmapHash,
            layerInfo: landscape.layers,
          },
          components: [],
          references: [],
        });
      }
    }
  } catch (error) {
    console.error('Failed to capture landscape:', error);
  }

  return entities;
}

/**
 * Capture foliage data from UE
 */
async function captureFoliage(
  bridge: BridgeManager,
  options: z.infer<typeof CaptureOptionsSchema>
): Promise<EntitySnapshot[]> {
  const entities: EntitySnapshot[] = [];

  try {
    const result = await bridge.remoteControl.callFunction(
      '/Script/AegisBridge.AegisSeedSubsystem',
      'CaptureFoliage',
      { IncludeInstances: true }
    );

    if (result.success && result.data?.foliageActors) {
      for (const foliage of result.data.foliageActors) {
        const entityGuid = generateDeterministicGUID(
          'foliage',
          'AInstancedFoliageActor',
          '',
          entities.length,
          foliage.name
        );

        entities.push({
          guid: entityGuid,
          class: 'AInstancedFoliageActor',
          path: foliage.path,
          name: foliage.name,
          tags: [],
          properties: {
            foliageTypes: foliage.types,
            instanceCount: foliage.instanceCount,
            instanceDataHash: foliage.instanceDataHash,
          },
          components: [],
          references: [],
        });
      }
    }
  } catch (error) {
    console.error('Failed to capture foliage:', error);
  }

  return entities;
}

// ============================================================================
// Command Implementations
// ============================================================================

/**
 * Create state capture commands
 */
export function createStateCaptureCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // capture_world_state - Capture entire world state
    // ========================================================================
    {
      name: 'capture_world_state',
      description: 'Capture the current world state as a snapshot for later restoration or comparison',
      category: 'seed',
      parameters: CaptureWorldStateParamsSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = CaptureWorldStateParamsSchema.parse(params);
        const options = validatedParams.options || {};
        const targets = options.targets || ['full'];

        logger?.info('Capturing world state', {
          name: validatedParams.snapshotName,
          targets,
        });

        const allEntities: EntitySnapshot[] = [];

        // Capture based on targets
        const captureTargets = targets.includes('full')
          ? ['actors', 'landscape', 'foliage', 'materials', 'blueprints']
          : targets;

        for (const target of captureTargets) {
          switch (target) {
            case 'actors':
              allEntities.push(...(await captureActors(bridge, options)));
              break;
            case 'landscape':
              allEntities.push(...(await captureLandscape(bridge, options)));
              break;
            case 'foliage':
              allEntities.push(...(await captureFoliage(bridge, options)));
              break;
            // Add more target handlers as needed
          }
        }

        // Get level info
        let levelInfo: any = {};
        try {
          const levelResult = await bridge.remoteControl.callFunction(
            '/Script/AegisBridge.AegisSeedSubsystem',
            'GetCurrentLevelInfo'
          );
          if (levelResult.success) {
            levelInfo = levelResult.data;
          }
        } catch {
          // Use defaults
        }

        // Generate snapshot
        const timestamp = new Date();
        const seed = crypto.randomBytes(8).toString('hex');
        const snapshotId = generateSnapshotId(validatedParams.snapshotName, timestamp, seed);
        const checksum = calculateChecksum(allEntities);

        const snapshot: WorldSnapshot = {
          id: snapshotId,
          name: validatedParams.snapshotName,
          description: validatedParams.description,
          timestamp,
          seed,
          checksum,
          targets: captureTargets,
          entities: allEntities,
          metadata: {
            capturedBy: 'aegis.seed',
            engineVersion: levelInfo.engineVersion,
            projectName: levelInfo.projectName,
            levelName: levelInfo.levelName,
            totalEntities: allEntities.length,
          },
        };

        // Store snapshot
        snapshotStorage.set(snapshotId, snapshot);

        // Also store in UE for persistence
        try {
          await bridge.remoteControl.callFunction(
            '/Script/AegisBridge.AegisSeedSubsystem',
            'StoreSnapshot',
            {
              SnapshotId: snapshotId,
              SnapshotData: JSON.stringify(snapshot),
            }
          );
        } catch (error) {
          logger?.warn('Failed to store snapshot in UE', { error });
        }

        logger?.info('World state captured', {
          snapshotId,
          entityCount: allEntities.length,
        });

        return {
          success: true,
          snapshotId,
          name: validatedParams.snapshotName,
          timestamp: timestamp.toISOString(),
          checksum,
          entityCount: allEntities.length,
          targets: captureTargets,
          metadata: snapshot.metadata,
        };
      },
    },

    // ========================================================================
    // restore_world_state - Restore from snapshot
    // ========================================================================
    {
      name: 'restore_world_state',
      description: 'Restore world state from a previously captured snapshot',
      category: 'seed',
      parameters: RestoreWorldStateParamsSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = RestoreWorldStateParamsSchema.parse(params);
        const options = validatedParams.options || {};

        // Find snapshot
        let snapshot = snapshotStorage.get(validatedParams.snapshotId);

        if (!snapshot) {
          // Try to load from UE
          try {
            const result = await bridge.remoteControl.callFunction(
              '/Script/AegisBridge.AegisSeedSubsystem',
              'LoadSnapshot',
              { SnapshotId: validatedParams.snapshotId }
            );

            if (result.success && result.data?.snapshot) {
              snapshot = JSON.parse(result.data.snapshot);
              if (snapshot) {
                snapshotStorage.set(validatedParams.snapshotId, snapshot);
              }
            }
          } catch (error) {
            logger?.warn('Failed to load snapshot from UE', { error });
          }
        }

        if (!snapshot) {
          return {
            success: false,
            error: `Snapshot not found: ${validatedParams.snapshotId}`,
          };
        }

        // Verify checksum
        const currentChecksum = calculateChecksum(snapshot.entities);
        if (currentChecksum !== snapshot.checksum) {
          logger?.warn('Snapshot checksum mismatch - data may be corrupted');
        }

        if (options.dryRun) {
          return {
            success: true,
            dryRun: true,
            snapshotId: validatedParams.snapshotId,
            wouldRestore: {
              entityCount: snapshot.entities.length,
              targets: snapshot.targets,
            },
            mergeMode: options.mergeMode,
          };
        }

        logger?.info('Restoring world state', {
          snapshotId: validatedParams.snapshotId,
          entityCount: snapshot.entities.length,
          mergeMode: options.mergeMode,
        });

        // Perform restoration in UE
        const restorationResult = await bridge.remoteControl.callFunction(
          '/Script/AegisBridge.AegisSeedSubsystem',
          'RestoreWorldState',
          {
            SnapshotId: validatedParams.snapshotId,
            Entities: JSON.stringify(snapshot.entities),
            MergeMode: options.mergeMode,
            PreserveGUIDs: options.preserveGUIDs,
          }
        );

        if (!restorationResult.success) {
          return {
            success: false,
            error: 'Failed to restore world state in Unreal Engine',
            details: restorationResult.error,
          };
        }

        logger?.info('World state restored', {
          snapshotId: validatedParams.snapshotId,
          restoredCount: restorationResult.data?.restoredCount,
        });

        return {
          success: true,
          snapshotId: validatedParams.snapshotId,
          restored: true,
          restoredCount: restorationResult.data?.restoredCount || snapshot.entities.length,
          mergeMode: options.mergeMode,
          warnings: restorationResult.data?.warnings,
        };
      },
    },

    // ========================================================================
    // list_snapshots - List available snapshots
    // ========================================================================
    {
      name: 'list_snapshots',
      description: 'List all available world state snapshots',
      category: 'seed',
      parameters: z.object({
        includeMetadata: z.boolean().optional().default(true),
        sortBy: z.enum(['timestamp', 'name', 'entityCount']).optional().default('timestamp'),
        sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z
          .object({
            includeMetadata: z.boolean().optional().default(true),
            sortBy: z.enum(['timestamp', 'name', 'entityCount']).optional().default('timestamp'),
            sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
          })
          .parse(params);

        // Get from local storage
        let snapshots = Array.from(snapshotStorage.values());

        // Also try to get from UE
        try {
          const result = await bridge.remoteControl.callFunction(
            '/Script/AegisBridge.AegisSeedSubsystem',
            'ListSnapshots'
          );

          if (result.success && result.data?.snapshots) {
            for (const snap of result.data.snapshots) {
              if (!snapshotStorage.has(snap.id)) {
                const parsed = JSON.parse(snap.data);
                snapshotStorage.set(snap.id, parsed);
                snapshots.push(parsed);
              }
            }
          }
        } catch {
          // Use local only
        }

        // Sort
        snapshots.sort((a, b) => {
          let comparison = 0;
          switch (validatedParams.sortBy) {
            case 'timestamp':
              comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
              break;
            case 'name':
              comparison = a.name.localeCompare(b.name);
              break;
            case 'entityCount':
              comparison = a.entities.length - b.entities.length;
              break;
          }
          return validatedParams.sortOrder === 'desc' ? -comparison : comparison;
        });

        return {
          success: true,
          snapshots: snapshots.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            timestamp: s.timestamp,
            entityCount: s.entities.length,
            targets: s.targets,
            checksum: s.checksum,
            metadata: validatedParams.includeMetadata ? s.metadata : undefined,
          })),
          total: snapshots.length,
        };
      },
    },

    // ========================================================================
    // get_snapshot - Get snapshot details
    // ========================================================================
    {
      name: 'get_snapshot',
      description: 'Get detailed information about a specific snapshot',
      category: 'seed',
      parameters: z.object({
        snapshotId: z.string(),
        includeEntities: z.boolean().optional().default(false),
        entityLimit: z.number().optional().default(100),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z
          .object({
            snapshotId: z.string(),
            includeEntities: z.boolean().optional().default(false),
            entityLimit: z.number().optional().default(100),
          })
          .parse(params);

        const snapshot = snapshotStorage.get(validatedParams.snapshotId);

        if (!snapshot) {
          return {
            success: false,
            error: `Snapshot not found: ${validatedParams.snapshotId}`,
          };
        }

        const result: any = {
          success: true,
          id: snapshot.id,
          name: snapshot.name,
          description: snapshot.description,
          timestamp: snapshot.timestamp,
          seed: snapshot.seed,
          checksum: snapshot.checksum,
          targets: snapshot.targets,
          metadata: snapshot.metadata,
          entityCount: snapshot.entities.length,
        };

        if (validatedParams.includeEntities) {
          result.entities = snapshot.entities.slice(0, validatedParams.entityLimit).map((e) => ({
            guid: e.guid,
            class: e.class,
            name: e.name,
            path: e.path,
            hasTransform: !!e.transform,
            propertyCount: Object.keys(e.properties).length,
            componentCount: e.components.length,
            referenceCount: e.references.length,
          }));
          result.entitiesLimited =
            snapshot.entities.length > validatedParams.entityLimit;
        }

        return result;
      },
    },

    // ========================================================================
    // delete_snapshot - Delete a snapshot
    // ========================================================================
    {
      name: 'delete_snapshot',
      description: 'Delete a world state snapshot',
      category: 'seed',
      parameters: z.object({
        snapshotId: z.string(),
        confirm: z.boolean().describe('Must be true to confirm deletion'),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z
          .object({
            snapshotId: z.string(),
            confirm: z.boolean(),
          })
          .parse(params);

        if (!validatedParams.confirm) {
          return {
            success: false,
            error: 'Must confirm deletion with confirm: true',
          };
        }

        const snapshot = snapshotStorage.get(validatedParams.snapshotId);

        if (!snapshot) {
          return {
            success: false,
            error: `Snapshot not found: ${validatedParams.snapshotId}`,
          };
        }

        // Delete from local storage
        snapshotStorage.delete(validatedParams.snapshotId);

        // Delete from UE
        try {
          await bridge.remoteControl.callFunction(
            '/Script/AegisBridge.AegisSeedSubsystem',
            'DeleteSnapshot',
            { SnapshotId: validatedParams.snapshotId }
          );
        } catch (error) {
          logger?.warn('Failed to delete snapshot from UE', { error });
        }

        logger?.info('Deleted snapshot', { snapshotId: validatedParams.snapshotId });

        return {
          success: true,
          deleted: true,
          snapshotId: validatedParams.snapshotId,
          snapshotName: snapshot.name,
        };
      },
    },

    // ========================================================================
    // export_snapshot - Export snapshot to file
    // ========================================================================
    {
      name: 'export_snapshot',
      description: 'Export a snapshot to a file for external storage or sharing',
      category: 'seed',
      parameters: z.object({
        snapshotId: z.string(),
        outputPath: z.string().describe('Path to save the snapshot file'),
        format: z.enum(['json', 'binary']).optional().default('json'),
        compress: z.boolean().optional().default(true),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z
          .object({
            snapshotId: z.string(),
            outputPath: z.string(),
            format: z.enum(['json', 'binary']).optional().default('json'),
            compress: z.boolean().optional().default(true),
          })
          .parse(params);

        const snapshot = snapshotStorage.get(validatedParams.snapshotId);

        if (!snapshot) {
          return {
            success: false,
            error: `Snapshot not found: ${validatedParams.snapshotId}`,
          };
        }

        // Export via UE file system
        const result = await bridge.remoteControl.callFunction(
          '/Script/AegisBridge.AegisSeedSubsystem',
          'ExportSnapshot',
          {
            SnapshotId: validatedParams.snapshotId,
            SnapshotData: JSON.stringify(snapshot),
            OutputPath: validatedParams.outputPath,
            Format: validatedParams.format,
            Compress: validatedParams.compress,
          }
        );

        if (!result.success) {
          return {
            success: false,
            error: 'Failed to export snapshot',
            details: result.error,
          };
        }

        return {
          success: true,
          exported: true,
          snapshotId: validatedParams.snapshotId,
          outputPath: result.data?.outputPath || validatedParams.outputPath,
          format: validatedParams.format,
          compressed: validatedParams.compress,
          fileSize: result.data?.fileSize,
        };
      },
    },

    // ========================================================================
    // import_snapshot - Import snapshot from file
    // ========================================================================
    {
      name: 'import_snapshot',
      description: 'Import a snapshot from an external file',
      category: 'seed',
      parameters: z.object({
        inputPath: z.string().describe('Path to the snapshot file'),
        newName: z.string().optional().describe('Optional new name for imported snapshot'),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z
          .object({
            inputPath: z.string(),
            newName: z.string().optional(),
          })
          .parse(params);

        // Import via UE file system
        const result = await bridge.remoteControl.callFunction(
          '/Script/AegisBridge.AegisSeedSubsystem',
          'ImportSnapshot',
          { InputPath: validatedParams.inputPath }
        );

        if (!result.success || !result.data?.snapshotData) {
          return {
            success: false,
            error: 'Failed to import snapshot',
            details: result.error,
          };
        }

        // Parse and store
        const snapshot: WorldSnapshot = JSON.parse(result.data.snapshotData);

        if (validatedParams.newName) {
          snapshot.name = validatedParams.newName;
          // Regenerate ID with new name
          snapshot.id = generateSnapshotId(validatedParams.newName, snapshot.timestamp, snapshot.seed);
        }

        snapshotStorage.set(snapshot.id, snapshot);

        logger?.info('Imported snapshot', {
          snapshotId: snapshot.id,
          name: snapshot.name,
        });

        return {
          success: true,
          imported: true,
          snapshotId: snapshot.id,
          name: snapshot.name,
          entityCount: snapshot.entities.length,
          originalTimestamp: snapshot.timestamp,
        };
      },
    },
  ];
}

// ============================================================================
// Exports
// ============================================================================

export { snapshotStorage, WorldSnapshot, EntitySnapshot, TransformSnapshot };
