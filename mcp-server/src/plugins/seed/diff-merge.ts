/**
 * AEGIS Seed Protocol - Diff/Merge
 * Compare and merge world states for synchronization
 */

import { CommandDefinition } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { z } from 'zod';
import { snapshotStorage, WorldSnapshot, EntitySnapshot, TransformSnapshot } from './state-capture.js';

// ============================================================================
// Diff/Merge Schemas
// ============================================================================

const DiffOptionsSchema = z.object({
  ignoreTransforms: z.boolean().optional().default(false),
  ignoreProperties: z.array(z.string()).optional(),
  positionTolerance: z.number().optional().default(0.001),
  rotationTolerance: z.number().optional().default(0.01),
  scaleTolerance: z.number().optional().default(0.001),
  includeUnchanged: z.boolean().optional().default(false),
});

const MergeOptionsSchema = z.object({
  conflictResolution: z.enum(['source', 'target', 'manual', 'newest']).optional().default('manual'),
  preserveSourceGUIDs: z.boolean().optional().default(true),
  dryRun: z.boolean().optional().default(false),
  includeTransforms: z.boolean().optional().default(true),
  includeProperties: z.boolean().optional().default(true),
});

const CompareSnapshotsParamsSchema = z.object({
  sourceSnapshotId: z.string().describe('Source snapshot ID'),
  targetSnapshotId: z.string().describe('Target snapshot ID'),
  options: DiffOptionsSchema.optional(),
});

const MergeSnapshotsParamsSchema = z.object({
  sourceSnapshotId: z.string().describe('Source snapshot to merge from'),
  targetSnapshotId: z.string().describe('Target snapshot to merge into'),
  options: MergeOptionsSchema.optional(),
  selectedChanges: z.array(z.string()).optional().describe('Specific change IDs to apply (for manual resolution)'),
});

const ApplyDiffParamsSchema = z.object({
  diffId: z.string().describe('ID of the diff to apply'),
  options: MergeOptionsSchema.optional(),
  selectedChanges: z.array(z.string()).optional(),
});

// ============================================================================
// Diff Types
// ============================================================================

type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

interface EntityDiff {
  changeId: string;
  changeType: ChangeType;
  guid: string;
  entityClass: string;
  entityName: string;
  entityPath: string;
  sourceEntity?: EntitySnapshot;
  targetEntity?: EntitySnapshot;
  propertyChanges: PropertyChange[];
  transformChanges?: TransformChange;
  componentChanges: ComponentChange[];
  referenceChanges: ReferenceChange[];
}

interface PropertyChange {
  propertyName: string;
  changeType: ChangeType;
  sourceValue: any;
  targetValue: any;
}

interface TransformChange {
  location?: {
    source: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    delta: { x: number; y: number; z: number };
  };
  rotation?: {
    source: { pitch: number; yaw: number; roll: number };
    target: { pitch: number; yaw: number; roll: number };
    delta: { pitch: number; yaw: number; roll: number };
  };
  scale?: {
    source: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    delta: { x: number; y: number; z: number };
  };
}

interface ComponentChange {
  changeType: ChangeType;
  componentGuid: string;
  componentClass: string;
  componentName: string;
  propertyChanges: PropertyChange[];
}

interface ReferenceChange {
  changeType: ChangeType;
  propertyName: string;
  sourceGuid?: string;
  targetGuid?: string;
}

interface WorldDiff {
  diffId: string;
  sourceSnapshotId: string;
  targetSnapshotId: string;
  timestamp: Date;
  summary: {
    totalChanges: number;
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  entityDiffs: EntityDiff[];
  options: z.infer<typeof DiffOptionsSchema>;
}

// Storage for computed diffs
const diffStorage = new Map<string, WorldDiff>();

// ============================================================================
// Diff Functions
// ============================================================================

/**
 * Generate diff ID
 */
function generateDiffId(sourceId: string, targetId: string): string {
  const timestamp = Date.now();
  return `DIFF-${sourceId.substring(5, 13)}-${targetId.substring(5, 13)}-${timestamp.toString(36).toUpperCase()}`;
}

/**
 * Compare two transforms within tolerance
 */
function compareTransforms(
  source: TransformSnapshot | undefined,
  target: TransformSnapshot | undefined,
  options: z.infer<typeof DiffOptionsSchema>
): TransformChange | undefined {
  if (!source && !target) return undefined;
  if (!source || !target) {
    return {
      location: source?.location || target?.location ? {
        source: source?.location || { x: 0, y: 0, z: 0 },
        target: target?.location || { x: 0, y: 0, z: 0 },
        delta: {
          x: (target?.location?.x || 0) - (source?.location?.x || 0),
          y: (target?.location?.y || 0) - (source?.location?.y || 0),
          z: (target?.location?.z || 0) - (source?.location?.z || 0),
        },
      } : undefined,
    };
  }

  const changes: TransformChange = {};
  let hasChanges = false;

  // Compare location
  const locDelta = {
    x: target.location.x - source.location.x,
    y: target.location.y - source.location.y,
    z: target.location.z - source.location.z,
  };

  if (
    Math.abs(locDelta.x) > options.positionTolerance ||
    Math.abs(locDelta.y) > options.positionTolerance ||
    Math.abs(locDelta.z) > options.positionTolerance
  ) {
    changes.location = {
      source: source.location,
      target: target.location,
      delta: locDelta,
    };
    hasChanges = true;
  }

  // Compare rotation
  const rotDelta = {
    pitch: target.rotation.pitch - source.rotation.pitch,
    yaw: target.rotation.yaw - source.rotation.yaw,
    roll: target.rotation.roll - source.rotation.roll,
  };

  if (
    Math.abs(rotDelta.pitch) > options.rotationTolerance ||
    Math.abs(rotDelta.yaw) > options.rotationTolerance ||
    Math.abs(rotDelta.roll) > options.rotationTolerance
  ) {
    changes.rotation = {
      source: source.rotation,
      target: target.rotation,
      delta: rotDelta,
    };
    hasChanges = true;
  }

  // Compare scale
  const scaleDelta = {
    x: target.scale.x - source.scale.x,
    y: target.scale.y - source.scale.y,
    z: target.scale.z - source.scale.z,
  };

  if (
    Math.abs(scaleDelta.x) > options.scaleTolerance ||
    Math.abs(scaleDelta.y) > options.scaleTolerance ||
    Math.abs(scaleDelta.z) > options.scaleTolerance
  ) {
    changes.scale = {
      source: source.scale,
      target: target.scale,
      delta: scaleDelta,
    };
    hasChanges = true;
  }

  return hasChanges ? changes : undefined;
}

/**
 * Compare two property sets
 */
function compareProperties(
  sourceProps: Record<string, any>,
  targetProps: Record<string, any>,
  ignoreProperties: string[] = []
): PropertyChange[] {
  const changes: PropertyChange[] = [];
  const allKeys = new Set([...Object.keys(sourceProps), ...Object.keys(targetProps)]);

  for (const key of allKeys) {
    if (ignoreProperties.includes(key)) continue;

    const sourceValue = sourceProps[key];
    const targetValue = targetProps[key];

    if (sourceValue === undefined && targetValue !== undefined) {
      changes.push({
        propertyName: key,
        changeType: 'added',
        sourceValue: undefined,
        targetValue,
      });
    } else if (sourceValue !== undefined && targetValue === undefined) {
      changes.push({
        propertyName: key,
        changeType: 'removed',
        sourceValue,
        targetValue: undefined,
      });
    } else if (JSON.stringify(sourceValue) !== JSON.stringify(targetValue)) {
      changes.push({
        propertyName: key,
        changeType: 'modified',
        sourceValue,
        targetValue,
      });
    }
  }

  return changes;
}

/**
 * Compare two entity snapshots
 */
function compareEntities(
  source: EntitySnapshot | undefined,
  target: EntitySnapshot | undefined,
  options: z.infer<typeof DiffOptionsSchema>,
  changeIdPrefix: string
): EntityDiff {
  const changeType: ChangeType =
    !source ? 'added' :
    !target ? 'removed' :
    'modified';

  const entity = source || target!;

  const diff: EntityDiff = {
    changeId: `${changeIdPrefix}-${entity.guid}`,
    changeType,
    guid: entity.guid,
    entityClass: entity.class,
    entityName: entity.name,
    entityPath: entity.path,
    sourceEntity: source,
    targetEntity: target,
    propertyChanges: [],
    componentChanges: [],
    referenceChanges: [],
  };

  if (source && target) {
    // Compare properties
    diff.propertyChanges = compareProperties(
      source.properties,
      target.properties,
      options.ignoreProperties
    );

    // Compare transforms
    if (!options.ignoreTransforms) {
      diff.transformChanges = compareTransforms(source.transform, target.transform, options);
    }

    // Compare components
    const sourceComps = new Map(source.components.map(c => [c.guid, c]));
    const targetComps = new Map(target.components.map(c => [c.guid, c]));

    for (const [guid, sourceComp] of sourceComps) {
      const targetComp = targetComps.get(guid);
      if (!targetComp) {
        diff.componentChanges.push({
          changeType: 'removed',
          componentGuid: guid,
          componentClass: sourceComp.class,
          componentName: sourceComp.name,
          propertyChanges: [],
        });
      } else {
        const propChanges = compareProperties(
          sourceComp.properties,
          targetComp.properties,
          options.ignoreProperties
        );
        if (propChanges.length > 0) {
          diff.componentChanges.push({
            changeType: 'modified',
            componentGuid: guid,
            componentClass: sourceComp.class,
            componentName: sourceComp.name,
            propertyChanges: propChanges,
          });
        }
      }
    }

    for (const [guid, targetComp] of targetComps) {
      if (!sourceComps.has(guid)) {
        diff.componentChanges.push({
          changeType: 'added',
          componentGuid: guid,
          componentClass: targetComp.class,
          componentName: targetComp.name,
          propertyChanges: [],
        });
      }
    }

    // Compare references
    const sourceRefs = new Map(source.references.map(r => [r.propertyName, r]));
    const targetRefs = new Map(target.references.map(r => [r.propertyName, r]));

    for (const [propName, sourceRef] of sourceRefs) {
      const targetRef = targetRefs.get(propName);
      if (!targetRef) {
        diff.referenceChanges.push({
          changeType: 'removed',
          propertyName: propName,
          sourceGuid: sourceRef.targetGuid,
        });
      } else if (sourceRef.targetGuid !== targetRef.targetGuid) {
        diff.referenceChanges.push({
          changeType: 'modified',
          propertyName: propName,
          sourceGuid: sourceRef.targetGuid,
          targetGuid: targetRef.targetGuid,
        });
      }
    }

    for (const [propName, targetRef] of targetRefs) {
      if (!sourceRefs.has(propName)) {
        diff.referenceChanges.push({
          changeType: 'added',
          propertyName: propName,
          targetGuid: targetRef.targetGuid,
        });
      }
    }

    // Determine if actually modified
    if (
      diff.propertyChanges.length === 0 &&
      !diff.transformChanges &&
      diff.componentChanges.length === 0 &&
      diff.referenceChanges.length === 0
    ) {
      diff.changeType = 'unchanged';
    }
  }

  return diff;
}

/**
 * Compute full diff between two snapshots
 */
function computeWorldDiff(
  source: WorldSnapshot,
  target: WorldSnapshot,
  options: z.infer<typeof DiffOptionsSchema>
): WorldDiff {
  const diffId = generateDiffId(source.id, target.id);
  const entityDiffs: EntityDiff[] = [];

  // Build entity maps
  const sourceEntities = new Map(source.entities.map(e => [e.guid, e]));
  const targetEntities = new Map(target.entities.map(e => [e.guid, e]));

  // Find removed and modified entities
  for (const [guid, sourceEntity] of sourceEntities) {
    const targetEntity = targetEntities.get(guid);
    const diff = compareEntities(sourceEntity, targetEntity, options, diffId);

    if (diff.changeType !== 'unchanged' || options.includeUnchanged) {
      entityDiffs.push(diff);
    }
  }

  // Find added entities
  for (const [guid, targetEntity] of targetEntities) {
    if (!sourceEntities.has(guid)) {
      entityDiffs.push(compareEntities(undefined, targetEntity, options, diffId));
    }
  }

  // Compute summary
  const summary = {
    totalChanges: entityDiffs.length,
    added: entityDiffs.filter(d => d.changeType === 'added').length,
    removed: entityDiffs.filter(d => d.changeType === 'removed').length,
    modified: entityDiffs.filter(d => d.changeType === 'modified').length,
    unchanged: entityDiffs.filter(d => d.changeType === 'unchanged').length,
  };

  return {
    diffId,
    sourceSnapshotId: source.id,
    targetSnapshotId: target.id,
    timestamp: new Date(),
    summary,
    entityDiffs,
    options,
  };
}

// ============================================================================
// Command Implementations
// ============================================================================

/**
 * Create diff/merge commands
 */
export function createDiffMergeCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // compare_snapshots - Compare two snapshots
    // ========================================================================
    {
      name: 'compare_snapshots',
      description: 'Compare two world state snapshots and generate a detailed diff',
      category: 'seed',
      parameters: CompareSnapshotsParamsSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = CompareSnapshotsParamsSchema.parse(params);
        const options = validatedParams.options || {};

        // Get snapshots
        const sourceSnapshot = snapshotStorage.get(validatedParams.sourceSnapshotId);
        const targetSnapshot = snapshotStorage.get(validatedParams.targetSnapshotId);

        if (!sourceSnapshot) {
          return {
            success: false,
            error: `Source snapshot not found: ${validatedParams.sourceSnapshotId}`,
          };
        }

        if (!targetSnapshot) {
          return {
            success: false,
            error: `Target snapshot not found: ${validatedParams.targetSnapshotId}`,
          };
        }

        logger?.info('Comparing snapshots', {
          source: validatedParams.sourceSnapshotId,
          target: validatedParams.targetSnapshotId,
        });

        // Compute diff
        const diff = computeWorldDiff(sourceSnapshot, targetSnapshot, {
          ignoreTransforms: options.ignoreTransforms ?? false,
          ignoreProperties: options.ignoreProperties,
          positionTolerance: options.positionTolerance ?? 0.001,
          rotationTolerance: options.rotationTolerance ?? 0.01,
          scaleTolerance: options.scaleTolerance ?? 0.001,
          includeUnchanged: options.includeUnchanged ?? false,
        });

        // Store diff for later use
        diffStorage.set(diff.diffId, diff);

        logger?.info('Snapshot comparison complete', {
          diffId: diff.diffId,
          totalChanges: diff.summary.totalChanges,
        });

        return {
          success: true,
          diffId: diff.diffId,
          sourceSnapshot: {
            id: sourceSnapshot.id,
            name: sourceSnapshot.name,
            entityCount: sourceSnapshot.entities.length,
          },
          targetSnapshot: {
            id: targetSnapshot.id,
            name: targetSnapshot.name,
            entityCount: targetSnapshot.entities.length,
          },
          summary: diff.summary,
          changes: diff.entityDiffs.slice(0, 50).map(d => ({
            changeId: d.changeId,
            changeType: d.changeType,
            guid: d.guid,
            entityClass: d.entityClass,
            entityName: d.entityName,
            propertyChangeCount: d.propertyChanges.length,
            hasTransformChange: !!d.transformChanges,
            componentChangeCount: d.componentChanges.length,
            referenceChangeCount: d.referenceChanges.length,
          })),
          totalChanges: diff.entityDiffs.length,
          changesLimited: diff.entityDiffs.length > 50,
        };
      },
    },

    // ========================================================================
    // get_diff_details - Get detailed diff information
    // ========================================================================
    {
      name: 'get_diff_details',
      description: 'Get detailed information about a specific diff or change',
      category: 'seed',
      parameters: z.object({
        diffId: z.string(),
        changeId: z.string().optional().describe('Specific change to get details for'),
        includeValues: z.boolean().optional().default(true),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z
          .object({
            diffId: z.string(),
            changeId: z.string().optional(),
            includeValues: z.boolean().optional().default(true),
          })
          .parse(params);

        const diff = diffStorage.get(validatedParams.diffId);

        if (!diff) {
          return {
            success: false,
            error: `Diff not found: ${validatedParams.diffId}`,
          };
        }

        if (validatedParams.changeId) {
          const change = diff.entityDiffs.find(d => d.changeId === validatedParams.changeId);
          if (!change) {
            return {
              success: false,
              error: `Change not found: ${validatedParams.changeId}`,
            };
          }

          return {
            success: true,
            diffId: diff.diffId,
            change: {
              changeId: change.changeId,
              changeType: change.changeType,
              guid: change.guid,
              entityClass: change.entityClass,
              entityName: change.entityName,
              entityPath: change.entityPath,
              propertyChanges: validatedParams.includeValues ? change.propertyChanges : change.propertyChanges.map(p => ({ propertyName: p.propertyName, changeType: p.changeType })),
              transformChanges: change.transformChanges,
              componentChanges: change.componentChanges,
              referenceChanges: change.referenceChanges,
            },
          };
        }

        return {
          success: true,
          diffId: diff.diffId,
          sourceSnapshotId: diff.sourceSnapshotId,
          targetSnapshotId: diff.targetSnapshotId,
          timestamp: diff.timestamp.toISOString(),
          summary: diff.summary,
          options: diff.options,
          entityDiffCount: diff.entityDiffs.length,
        };
      },
    },

    // ========================================================================
    // merge_snapshots - Merge two snapshots
    // ========================================================================
    {
      name: 'merge_snapshots',
      description: 'Merge changes from source snapshot into target snapshot',
      category: 'seed',
      parameters: MergeSnapshotsParamsSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = MergeSnapshotsParamsSchema.parse(params);
        const options = validatedParams.options || {};

        // Get snapshots
        const sourceSnapshot = snapshotStorage.get(validatedParams.sourceSnapshotId);
        const targetSnapshot = snapshotStorage.get(validatedParams.targetSnapshotId);

        if (!sourceSnapshot) {
          return {
            success: false,
            error: `Source snapshot not found: ${validatedParams.sourceSnapshotId}`,
          };
        }

        if (!targetSnapshot) {
          return {
            success: false,
            error: `Target snapshot not found: ${validatedParams.targetSnapshotId}`,
          };
        }

        // Compute diff first
        const diff = computeWorldDiff(sourceSnapshot, targetSnapshot, {
          ignoreTransforms: false,
          positionTolerance: 0.001,
          rotationTolerance: 0.01,
          scaleTolerance: 0.001,
          includeUnchanged: false,
        });

        // Filter changes if specific ones are selected
        let changesToApply = diff.entityDiffs;
        if (validatedParams.selectedChanges?.length) {
          changesToApply = diff.entityDiffs.filter(d =>
            validatedParams.selectedChanges!.includes(d.changeId)
          );
        }

        if (options.dryRun) {
          return {
            success: true,
            dryRun: true,
            sourceSnapshot: validatedParams.sourceSnapshotId,
            targetSnapshot: validatedParams.targetSnapshotId,
            changesToApply: changesToApply.length,
            summary: {
              added: changesToApply.filter(d => d.changeType === 'added').length,
              removed: changesToApply.filter(d => d.changeType === 'removed').length,
              modified: changesToApply.filter(d => d.changeType === 'modified').length,
            },
            conflictResolution: options.conflictResolution,
          };
        }

        logger?.info('Merging snapshots', {
          source: validatedParams.sourceSnapshotId,
          target: validatedParams.targetSnapshotId,
          changesToApply: changesToApply.length,
        });

        // Apply merge in UE
        const mergeResult = await bridge.remoteControl.callFunction(
          '/Script/AegisBridge.AegisSeedSubsystem',
          'MergeWorldStates',
          {
            SourceSnapshotId: validatedParams.sourceSnapshotId,
            TargetSnapshotId: validatedParams.targetSnapshotId,
            Changes: JSON.stringify(changesToApply),
            ConflictResolution: options.conflictResolution,
            PreserveSourceGUIDs: options.preserveSourceGUIDs,
            IncludeTransforms: options.includeTransforms,
            IncludeProperties: options.includeProperties,
          }
        );

        if (!mergeResult.success) {
          return {
            success: false,
            error: 'Failed to merge world states',
            details: mergeResult.error,
          };
        }

        logger?.info('Merge complete', {
          appliedChanges: mergeResult.data?.appliedChanges,
          conflicts: mergeResult.data?.conflicts,
        });

        return {
          success: true,
          merged: true,
          sourceSnapshot: validatedParams.sourceSnapshotId,
          targetSnapshot: validatedParams.targetSnapshotId,
          appliedChanges: mergeResult.data?.appliedChanges || changesToApply.length,
          conflicts: mergeResult.data?.conflicts || [],
          warnings: mergeResult.data?.warnings,
        };
      },
    },

    // ========================================================================
    // apply_diff - Apply a computed diff to current world
    // ========================================================================
    {
      name: 'apply_diff',
      description: 'Apply a previously computed diff to the current world state',
      category: 'seed',
      parameters: ApplyDiffParamsSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = ApplyDiffParamsSchema.parse(params);
        const options = validatedParams.options || {};

        const diff = diffStorage.get(validatedParams.diffId);

        if (!diff) {
          return {
            success: false,
            error: `Diff not found: ${validatedParams.diffId}`,
          };
        }

        // Filter changes if specific ones are selected
        let changesToApply = diff.entityDiffs;
        if (validatedParams.selectedChanges?.length) {
          changesToApply = diff.entityDiffs.filter(d =>
            validatedParams.selectedChanges!.includes(d.changeId)
          );
        }

        if (options.dryRun) {
          return {
            success: true,
            dryRun: true,
            diffId: validatedParams.diffId,
            changesToApply: changesToApply.length,
            summary: {
              added: changesToApply.filter(d => d.changeType === 'added').length,
              removed: changesToApply.filter(d => d.changeType === 'removed').length,
              modified: changesToApply.filter(d => d.changeType === 'modified').length,
            },
          };
        }

        logger?.info('Applying diff', {
          diffId: validatedParams.diffId,
          changesToApply: changesToApply.length,
        });

        // Apply in UE
        const applyResult = await bridge.remoteControl.callFunction(
          '/Script/AegisBridge.AegisSeedSubsystem',
          'ApplyDiff',
          {
            DiffId: validatedParams.diffId,
            Changes: JSON.stringify(changesToApply),
            ConflictResolution: options.conflictResolution,
            IncludeTransforms: options.includeTransforms,
            IncludeProperties: options.includeProperties,
          }
        );

        if (!applyResult.success) {
          return {
            success: false,
            error: 'Failed to apply diff',
            details: applyResult.error,
          };
        }

        return {
          success: true,
          applied: true,
          diffId: validatedParams.diffId,
          appliedChanges: applyResult.data?.appliedChanges || changesToApply.length,
          skippedChanges: applyResult.data?.skippedChanges || 0,
          warnings: applyResult.data?.warnings,
        };
      },
    },

    // ========================================================================
    // list_diffs - List computed diffs
    // ========================================================================
    {
      name: 'list_diffs',
      description: 'List all computed diffs',
      category: 'seed',
      parameters: z.object({
        limit: z.number().optional().default(50),
      }),
      handler: async ({ params }) => {
        const validatedParams = z
          .object({
            limit: z.number().optional().default(50),
          })
          .parse(params);

        const diffs = Array.from(diffStorage.values())
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .slice(0, validatedParams.limit);

        return {
          success: true,
          diffs: diffs.map(d => ({
            diffId: d.diffId,
            sourceSnapshotId: d.sourceSnapshotId,
            targetSnapshotId: d.targetSnapshotId,
            timestamp: d.timestamp.toISOString(),
            summary: d.summary,
          })),
          total: diffStorage.size,
        };
      },
    },

    // ========================================================================
    // delete_diff - Delete a computed diff
    // ========================================================================
    {
      name: 'delete_diff',
      description: 'Delete a computed diff from storage',
      category: 'seed',
      parameters: z.object({
        diffId: z.string(),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z
          .object({
            diffId: z.string(),
          })
          .parse(params);

        if (!diffStorage.has(validatedParams.diffId)) {
          return {
            success: false,
            error: `Diff not found: ${validatedParams.diffId}`,
          };
        }

        diffStorage.delete(validatedParams.diffId);

        logger?.info('Deleted diff', { diffId: validatedParams.diffId });

        return {
          success: true,
          deleted: true,
          diffId: validatedParams.diffId,
        };
      },
    },

    // ========================================================================
    // sync_world_state - Synchronize current world with snapshot
    // ========================================================================
    {
      name: 'sync_world_state',
      description: 'Synchronize the current world state with a target snapshot, applying only necessary changes',
      category: 'seed',
      parameters: z.object({
        targetSnapshotId: z.string(),
        options: z.object({
          captureCurrentFirst: z.boolean().optional().default(true),
          conflictResolution: z.enum(['source', 'target', 'manual', 'newest']).optional().default('target'),
          dryRun: z.boolean().optional().default(false),
        }).optional(),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z
          .object({
            targetSnapshotId: z.string(),
            options: z.object({
              captureCurrentFirst: z.boolean().optional().default(true),
              conflictResolution: z.enum(['source', 'target', 'manual', 'newest']).optional().default('target'),
              dryRun: z.boolean().optional().default(false),
            }).optional(),
          })
          .parse(params);

        const options = validatedParams.options || {};
        const targetSnapshot = snapshotStorage.get(validatedParams.targetSnapshotId);

        if (!targetSnapshot) {
          return {
            success: false,
            error: `Target snapshot not found: ${validatedParams.targetSnapshotId}`,
          };
        }

        logger?.info('Synchronizing world state', {
          targetSnapshot: validatedParams.targetSnapshotId,
        });

        // Sync via UE
        const syncResult = await bridge.remoteControl.callFunction(
          '/Script/AegisBridge.AegisSeedSubsystem',
          'SyncWorldState',
          {
            TargetSnapshotId: validatedParams.targetSnapshotId,
            TargetEntities: JSON.stringify(targetSnapshot.entities),
            CaptureCurrentFirst: options.captureCurrentFirst,
            ConflictResolution: options.conflictResolution,
            DryRun: options.dryRun,
          }
        );

        if (!syncResult.success) {
          return {
            success: false,
            error: 'Failed to synchronize world state',
            details: syncResult.error,
          };
        }

        if (options.dryRun) {
          return {
            success: true,
            dryRun: true,
            targetSnapshot: validatedParams.targetSnapshotId,
            plannedChanges: syncResult.data?.plannedChanges,
          };
        }

        return {
          success: true,
          synchronized: true,
          targetSnapshot: validatedParams.targetSnapshotId,
          appliedChanges: syncResult.data?.appliedChanges,
          currentSnapshotId: syncResult.data?.currentSnapshotId,
          warnings: syncResult.data?.warnings,
        };
      },
    },
  ];
}

// ============================================================================
// Exports
// ============================================================================

export { diffStorage, WorldDiff, EntityDiff, computeWorldDiff };
