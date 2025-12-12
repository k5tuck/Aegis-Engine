/**
 * AEGIS Core Plugin - Level Commands
 * Commands for level/map management operations
 */

import { z } from 'zod';
import { CommandDefinition, CommandContext } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { ExecutionError } from '../../utils/errors.js';
import { Vector3DSchema } from '../../schema/commands.js';

// ============================================================================
// Schemas
// ============================================================================

const LoadLevelParamsSchema = z.object({
  levelPath: z.string().describe('Path to the level asset (e.g., /Game/Maps/MainLevel)'),
  makeActive: z.boolean().optional().default(true).describe('Make this the active level'),
});

const SaveLevelParamsSchema = z.object({
  levelPath: z.string().optional().describe('Path to save (defaults to current level)'),
  saveAll: z.boolean().optional().default(false).describe('Save all dirty packages'),
});

const CreateLevelParamsSchema = z.object({
  packagePath: z.string().describe('Package path for the level'),
  levelName: z.string().describe('Name for the new level'),
  templateLevel: z.string().optional().describe('Template level to base the new level on'),
  openAfterCreate: z.boolean().optional().default(true).describe('Open the level after creation'),
});

const GetLevelInfoParamsSchema = z.object({
  levelPath: z.string().optional().describe('Level path (defaults to current level)'),
  includeActors: z.boolean().optional().default(false).describe('Include actor list'),
  includeSettings: z.boolean().optional().default(true).describe('Include level settings'),
});

const AddSubLevelParamsSchema = z.object({
  subLevelPath: z.string().describe('Path to the sublevel to add'),
  streamingMethod: z.enum(['always_loaded', 'blueprint', 'distance']).optional().default('blueprint'),
  loadOnStart: z.boolean().optional().default(false).describe('Load sublevel on level start'),
});

const RemoveSubLevelParamsSchema = z.object({
  subLevelPath: z.string().describe('Path to the sublevel to remove'),
});

const SetLevelStreamingParamsSchema = z.object({
  subLevelPath: z.string().describe('Path to the sublevel'),
  shouldBeLoaded: z.boolean().describe('Whether the sublevel should be loaded'),
  shouldBeVisible: z.boolean().optional().describe('Whether the sublevel should be visible'),
  blockOnLoad: z.boolean().optional().default(false).describe('Block until loaded'),
});

const QueryLevelActorsParamsSchema = z.object({
  levelPath: z.string().optional().describe('Level to query (defaults to current)'),
  actorClass: z.string().optional().describe('Filter by actor class'),
  inBox: z.object({
    min: Vector3DSchema,
    max: Vector3DSchema,
  }).optional().describe('Filter by bounding box'),
  limit: z.number().int().positive().optional().default(100),
});

const SetLevelSettingsParamsSchema = z.object({
  levelPath: z.string().optional().describe('Level to modify (defaults to current)'),
  settings: z.object({
    lightmassImportanceVolumeBounds: z.object({
      min: Vector3DSchema,
      max: Vector3DSchema,
    }).optional(),
    defaultGameMode: z.string().optional(),
    killZ: z.number().optional(),
    worldGravity: z.number().optional(),
    globalTimeDilation: z.number().min(0).max(10).optional(),
  }).describe('Level settings to apply'),
});

const CreateLevelSnapshotParamsSchema = z.object({
  snapshotName: z.string().describe('Name for the snapshot'),
  description: z.string().optional().describe('Snapshot description'),
  includeActors: z.array(z.string()).optional().describe('Specific actors to include'),
  excludeActors: z.array(z.string()).optional().describe('Actors to exclude'),
});

const RestoreLevelSnapshotParamsSchema = z.object({
  snapshotName: z.string().describe('Name of the snapshot to restore'),
  restoreMode: z.enum(['full', 'additive', 'selective']).optional().default('full'),
  selectedActors: z.array(z.string()).optional().describe('Actors to restore (for selective mode)'),
});

// ============================================================================
// Response Types
// ============================================================================

interface GetLevelInfoResult {
  name: string;
  path: string;
  isDirty: boolean;
  isLoaded: boolean;
  isPersistentLevel: boolean;
  actorCount?: number;
  actors?: string[];
  subLevels?: Array<{
    path: string;
    name: string;
    isLoaded: boolean;
    isVisible: boolean;
    streamingMethod: string;
  }>;
  settings?: {
    defaultGameMode?: string;
    killZ?: number;
    worldGravity?: number;
    globalTimeDilation?: number;
  };
}

interface QueryLevelActorsResult {
  actors: Array<{
    path: string;
    name: string;
    class: string;
    level: string;
  }>;
  totalCount: number;
}

// ============================================================================
// Command Implementations
// ============================================================================

export function createLevelCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // load_level
    // ========================================================================
    {
      name: 'load_level',
      description: 'Load a level/map into the editor',
      inputSchema: LoadLevelParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'level',
        tags: ['load', 'open', 'level', 'map'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ loaded: boolean; levelPath: string }> => {
        const params = context.params as z.infer<typeof LoadLevelParamsSchema>;

        // Check for unsaved changes
        const currentLevel = await bridge.stateSync.getLevelState();
        if (currentLevel?.dirty) {
          context.logger?.warn('Current level has unsaved changes');
        }

        const result = await bridge.remoteControl.openLevel(params.levelPath);

        if (!result.success) {
          throw new ExecutionError(
            'load_level',
            result.error || 'Failed to load level',
            { levelPath: params.levelPath }
          );
        }

        // Trigger state sync for new level
        await bridge.stateSync.performFullSync();

        return {
          loaded: true,
          levelPath: params.levelPath,
        };
      },
    },

    // ========================================================================
    // save_level
    // ========================================================================
    {
      name: 'save_level',
      description: 'Save the current level or a specific level',
      inputSchema: SaveLevelParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'level',
        tags: ['save', 'level', 'map'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ saved: boolean; path: string }> => {
        const params = context.params as z.infer<typeof SaveLevelParamsSchema>;

        if (params.saveAll) {
          const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
            '/Script/UnrealEd.Default__EditorLoadingAndSavingUtils',
            'SaveAllDirtyPackages'
          );

          if (!result.success || !result.data?.ReturnValue) {
            throw new ExecutionError(
              'save_level',
              result.error || 'Failed to save all packages',
              {}
            );
          }

          return {
            saved: true,
            path: 'all',
          };
        }

        const result = await bridge.remoteControl.saveCurrentLevel();

        if (!result.success) {
          throw new ExecutionError(
            'save_level',
            result.error || 'Failed to save level',
            { levelPath: params.levelPath }
          );
        }

        // Update state sync
        const levelState = await bridge.stateSync.getLevelState(true);

        return {
          saved: true,
          path: levelState?.path || params.levelPath || 'current',
        };
      },
    },

    // ========================================================================
    // create_level
    // ========================================================================
    {
      name: 'create_level',
      description: 'Create a new level/map',
      inputSchema: CreateLevelParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'level',
        tags: ['create', 'new', 'level', 'map'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ levelPath: string; created: boolean }> => {
        const params = context.params as z.infer<typeof CreateLevelParamsSchema>;

        const levelPath = `${params.packagePath}/${params.levelName}`;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/UnrealEd.Default__EditorLevelUtils',
          'CreateNewLevel',
          {
            PackagePath: params.packagePath,
            LevelName: params.levelName,
            TemplateLevel: params.templateLevel,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'create_level',
            result.error || 'Failed to create level',
            { levelPath }
          );
        }

        // Open if requested
        if (params.openAfterCreate) {
          await bridge.remoteControl.openLevel(levelPath);
          await bridge.stateSync.performFullSync();
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'level',
          target: levelPath,
          changeType: 'create',
          source: 'local',
          undoable: true,
        });

        return {
          levelPath,
          created: true,
        };
      },
    },

    // ========================================================================
    // get_level_info
    // ========================================================================
    {
      name: 'get_level_info',
      description: 'Get information about a level',
      inputSchema: GetLevelInfoParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'level',
        tags: ['info', 'details', 'level', 'map'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<GetLevelInfoResult> => {
        const params = context.params as z.infer<typeof GetLevelInfoParamsSchema>;

        const levelState = await bridge.stateSync.getLevelState(true);
        const levelPath = params.levelPath || levelState?.path || '/Game/Maps/Untitled';

        const result: GetLevelInfoResult = {
          name: levelState?.name || levelPath.split('/').pop() || 'Unknown',
          path: levelPath,
          isDirty: levelState?.dirty || false,
          isLoaded: true,
          isPersistentLevel: true,
        };

        if (params.includeActors) {
          result.actorCount = levelState?.actors.length || 0;
          result.actors = levelState?.actors.slice(0, 100); // Limit to 100
        }

        // Get sublevels
        const subLevelsResult = await bridge.remoteControl.callFunction<{
          ReturnValue: Array<{
            Path: string;
            Name: string;
            IsLoaded: boolean;
            IsVisible: boolean;
            StreamingMethod: string;
          }>;
        }>(
          '/Script/Engine.Default__LevelStreamingDynamic',
          'GetStreamingLevels'
        );

        if (subLevelsResult.success && subLevelsResult.data) {
          result.subLevels = subLevelsResult.data.ReturnValue.map((sl) => ({
            path: sl.Path,
            name: sl.Name,
            isLoaded: sl.IsLoaded,
            isVisible: sl.IsVisible,
            streamingMethod: sl.StreamingMethod,
          }));
        }

        // Get settings
        if (params.includeSettings) {
          const settingsResult = await bridge.remoteControl.callFunction<{
            ReturnValue: {
              DefaultGameMode: string;
              KillZ: number;
              WorldGravity: number;
              GlobalTimeDilation: number;
            };
          }>(
            '/Script/Engine.Default__WorldSettings',
            'GetWorldSettings'
          );

          if (settingsResult.success && settingsResult.data) {
            result.settings = {
              defaultGameMode: settingsResult.data.ReturnValue.DefaultGameMode,
              killZ: settingsResult.data.ReturnValue.KillZ,
              worldGravity: settingsResult.data.ReturnValue.WorldGravity,
              globalTimeDilation: settingsResult.data.ReturnValue.GlobalTimeDilation,
            };
          }
        }

        return result;
      },
    },

    // ========================================================================
    // add_sublevel
    // ========================================================================
    {
      name: 'add_sublevel',
      description: 'Add a streaming sublevel to the current level',
      inputSchema: AddSubLevelParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'level',
        tags: ['sublevel', 'streaming', 'add', 'level'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ added: boolean; subLevelPath: string }> => {
        const params = context.params as z.infer<typeof AddSubLevelParamsSchema>;

        const streamingMethod = {
          always_loaded: 'AlwaysLoaded',
          blueprint: 'Blueprint',
          distance: 'Distance',
        }[params.streamingMethod];

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/UnrealEd.Default__EditorLevelUtils',
          'AddLevelToWorld',
          {
            LevelPackageName: params.subLevelPath,
            StreamingMethod: streamingMethod,
            LoadOnStart: params.loadOnStart,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'add_sublevel',
            result.error || 'Failed to add sublevel',
            { subLevelPath: params.subLevelPath }
          );
        }

        return {
          added: true,
          subLevelPath: params.subLevelPath,
        };
      },
    },

    // ========================================================================
    // remove_sublevel
    // ========================================================================
    {
      name: 'remove_sublevel',
      description: 'Remove a streaming sublevel from the current level',
      inputSchema: RemoveSubLevelParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'level',
        tags: ['sublevel', 'streaming', 'remove', 'level'],
        estimatedDuration: 'fast',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ removed: boolean; subLevelPath: string }> => {
        const params = context.params as z.infer<typeof RemoveSubLevelParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/UnrealEd.Default__EditorLevelUtils',
          'RemoveLevelFromWorld',
          {
            LevelPackageName: params.subLevelPath,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'remove_sublevel',
            result.error || 'Failed to remove sublevel',
            { subLevelPath: params.subLevelPath }
          );
        }

        return {
          removed: true,
          subLevelPath: params.subLevelPath,
        };
      },
    },

    // ========================================================================
    // set_level_streaming
    // ========================================================================
    {
      name: 'set_level_streaming',
      description: 'Control streaming state of a sublevel',
      inputSchema: SetLevelStreamingParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'level',
        tags: ['sublevel', 'streaming', 'visibility', 'level'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ success: boolean }> => {
        const params = context.params as z.infer<typeof SetLevelStreamingParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/Engine.Default__GameplayStatics',
          'LoadStreamLevel',
          {
            WorldContextObject: '/Game/Maps/MainLevel',
            LevelName: params.subLevelPath,
            bMakeVisibleAfterLoad: params.shouldBeVisible ?? params.shouldBeLoaded,
            bShouldBlockOnLoad: params.blockOnLoad,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'set_level_streaming',
            result.error || 'Failed to set level streaming state',
            { subLevelPath: params.subLevelPath }
          );
        }

        return {
          success: true,
        };
      },
    },

    // ========================================================================
    // query_level_actors
    // ========================================================================
    {
      name: 'query_level_actors',
      description: 'Query actors in a specific level',
      inputSchema: QueryLevelActorsParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'level',
        tags: ['query', 'actors', 'level'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<QueryLevelActorsResult> => {
        const params = context.params as z.infer<typeof QueryLevelActorsParamsSchema>;

        let actorPaths: string[] = [];

        if (params.actorClass) {
          const result = await bridge.remoteControl.findActorsByClass(params.actorClass);
          if (result.success && result.data) {
            actorPaths = result.data;
          }
        } else {
          const levelState = await bridge.stateSync.getLevelState();
          actorPaths = levelState?.actors || [];
        }

        // Get actor details
        const actors: QueryLevelActorsResult['actors'] = [];

        for (const path of actorPaths.slice(0, params.limit)) {
          const actorData = await bridge.stateSync.getActor(path);
          if (!actorData) continue;

          // Apply bounding box filter
          if (params.inBox && actorData.info.transform) {
            const loc = actorData.info.transform.location;
            if (
              loc.x < params.inBox.min.x || loc.x > params.inBox.max.x ||
              loc.y < params.inBox.min.y || loc.y > params.inBox.max.y ||
              loc.z < params.inBox.min.z || loc.z > params.inBox.max.z
            ) {
              continue;
            }
          }

          actors.push({
            path: actorData.info.path,
            name: actorData.info.name,
            class: actorData.info.class,
            level: params.levelPath || 'PersistentLevel',
          });
        }

        return {
          actors,
          totalCount: actors.length,
        };
      },
    },

    // ========================================================================
    // set_level_settings
    // ========================================================================
    {
      name: 'set_level_settings',
      description: 'Modify level/world settings',
      inputSchema: SetLevelSettingsParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'level',
        tags: ['settings', 'world', 'level'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ modified: string[] }> => {
        const params = context.params as z.infer<typeof SetLevelSettingsParamsSchema>;
        const modified: string[] = [];

        const worldSettingsPath = '/Script/Engine.Default__WorldSettings';

        if (params.settings.defaultGameMode !== undefined) {
          await bridge.remoteControl.setProperty(
            worldSettingsPath,
            'DefaultGameMode',
            params.settings.defaultGameMode
          );
          modified.push('DefaultGameMode');
        }

        if (params.settings.killZ !== undefined) {
          await bridge.remoteControl.setProperty(
            worldSettingsPath,
            'KillZ',
            params.settings.killZ
          );
          modified.push('KillZ');
        }

        if (params.settings.worldGravity !== undefined) {
          await bridge.remoteControl.setProperty(
            worldSettingsPath,
            'GlobalGravityZ',
            params.settings.worldGravity
          );
          modified.push('GlobalGravityZ');
        }

        if (params.settings.globalTimeDilation !== undefined) {
          await bridge.remoteControl.setProperty(
            worldSettingsPath,
            'TimeDilation',
            params.settings.globalTimeDilation
          );
          modified.push('TimeDilation');
        }

        return {
          modified,
        };
      },
    },

    // ========================================================================
    // create_level_snapshot
    // ========================================================================
    {
      name: 'create_level_snapshot',
      description: 'Create a snapshot of the current level state',
      inputSchema: CreateLevelSnapshotParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'level',
        tags: ['snapshot', 'backup', 'level'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ snapshotPath: string; actorCount: number }> => {
        const params = context.params as z.infer<typeof CreateLevelSnapshotParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { SnapshotPath: string; ActorCount: number };
        }>(
          '/Script/LevelSnapshots.Default__LevelSnapshotsLibrary',
          'TakeLevelSnapshot',
          {
            SnapshotName: params.snapshotName,
            Description: params.description,
            IncludeActors: params.includeActors,
            ExcludeActors: params.excludeActors,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'create_level_snapshot',
            result.error || 'Failed to create snapshot',
            { snapshotName: params.snapshotName }
          );
        }

        return {
          snapshotPath: result.data.ReturnValue.SnapshotPath,
          actorCount: result.data.ReturnValue.ActorCount,
        };
      },
    },

    // ========================================================================
    // restore_level_snapshot
    // ========================================================================
    {
      name: 'restore_level_snapshot',
      description: 'Restore level state from a snapshot',
      inputSchema: RestoreLevelSnapshotParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'level',
        tags: ['snapshot', 'restore', 'level'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ restored: boolean; actorsRestored: number }> => {
        const params = context.params as z.infer<typeof RestoreLevelSnapshotParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; ActorsRestored: number };
        }>(
          '/Script/LevelSnapshots.Default__LevelSnapshotsLibrary',
          'RestoreLevelSnapshot',
          {
            SnapshotName: params.snapshotName,
            RestoreMode: params.restoreMode,
            SelectedActors: params.selectedActors,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new ExecutionError(
            'restore_level_snapshot',
            result.error || 'Failed to restore snapshot',
            { snapshotName: params.snapshotName }
          );
        }

        // Refresh state
        await bridge.stateSync.performFullSync();

        return {
          restored: true,
          actorsRestored: result.data.ReturnValue.ActorsRestored,
        };
      },
    },

    // ========================================================================
    // undo
    // ========================================================================
    {
      name: 'undo',
      description: 'Undo the last editor action',
      inputSchema: z.object({}),
      annotations: {
        riskLevel: 'low',
        category: 'level',
        tags: ['undo', 'editor'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (): Promise<{ undone: boolean }> => {
        const result = await bridge.remoteControl.undo();
        return { undone: result.success };
      },
    },

    // ========================================================================
    // redo
    // ========================================================================
    {
      name: 'redo',
      description: 'Redo the last undone editor action',
      inputSchema: z.object({}),
      annotations: {
        riskLevel: 'low',
        category: 'level',
        tags: ['redo', 'editor'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (): Promise<{ redone: boolean }> => {
        const result = await bridge.remoteControl.redo();
        return { redone: result.success };
      },
    },
  ];
}
