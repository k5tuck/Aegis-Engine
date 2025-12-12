/**
 * AEGIS Core Plugin - Actor Commands
 * Commands for spawning, modifying, querying, and deleting actors
 */

import { z } from 'zod';
import { CommandDefinition, CommandContext } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { ActorNotFoundError, ExecutionError } from '../../utils/errors.js';
import {
  Vector3DSchema,
  RotatorSchema,
  TransformSchema,
} from '../../schema/commands.js';

// ============================================================================
// Schemas
// ============================================================================

const SpawnActorParamsSchema = z.object({
  classPath: z.string().describe('Blueprint or native class path (e.g., /Game/Blueprints/BP_MyActor)'),
  label: z.string().optional().describe('Actor label for editor display'),
  location: Vector3DSchema.optional().describe('Spawn location'),
  rotation: RotatorSchema.optional().describe('Spawn rotation'),
  scale: Vector3DSchema.optional().describe('Spawn scale'),
  tags: z.array(z.string()).optional().describe('Actor tags'),
  properties: z.record(z.unknown()).optional().describe('Initial property values to set'),
});

const ModifyActorParamsSchema = z.object({
  actorPath: z.string().describe('Path to the actor to modify'),
  location: Vector3DSchema.optional().describe('New location'),
  rotation: RotatorSchema.optional().describe('New rotation'),
  scale: Vector3DSchema.optional().describe('New scale'),
  properties: z.record(z.unknown()).optional().describe('Property values to set'),
  addTags: z.array(z.string()).optional().describe('Tags to add'),
  removeTags: z.array(z.string()).optional().describe('Tags to remove'),
});

const DeleteActorParamsSchema = z.object({
  actorPath: z.string().describe('Path to the actor to delete'),
  force: z.boolean().optional().default(false).describe('Force delete even if actor has dependencies'),
});

const QueryActorsParamsSchema = z.object({
  className: z.string().optional().describe('Filter by class name'),
  tag: z.string().optional().describe('Filter by tag'),
  namePattern: z.string().optional().describe('Filter by name pattern (regex)'),
  inBox: z.object({
    min: Vector3DSchema,
    max: Vector3DSchema,
  }).optional().describe('Filter by bounding box'),
  limit: z.number().int().positive().optional().default(100).describe('Maximum results'),
  includeTransform: z.boolean().optional().default(true).describe('Include transform in results'),
});

const GetActorParamsSchema = z.object({
  actorPath: z.string().describe('Path to the actor'),
  includeProperties: z.array(z.string()).optional().describe('Specific properties to include'),
  includeComponents: z.boolean().optional().default(false).describe('Include component information'),
});

const DuplicateActorParamsSchema = z.object({
  actorPath: z.string().describe('Path to the actor to duplicate'),
  offset: Vector3DSchema.optional().describe('Offset from original location'),
  newLabel: z.string().optional().describe('Label for the new actor'),
});

const SelectActorsParamsSchema = z.object({
  actorPaths: z.array(z.string()).describe('Paths to actors to select'),
  addToSelection: z.boolean().optional().default(false).describe('Add to existing selection'),
});

const FocusActorParamsSchema = z.object({
  actorPath: z.string().describe('Path to the actor to focus'),
  distance: z.number().optional().describe('Camera distance from actor'),
});

// ============================================================================
// Response Types
// ============================================================================

interface SpawnActorResult {
  actorPath: string;
  actorLabel: string;
  actorClass: string;
}

interface ModifyActorResult {
  actorPath: string;
  modifiedProperties: string[];
}

interface DeleteActorResult {
  deleted: boolean;
  actorPath: string;
}

interface QueryActorsResult {
  actors: Array<{
    path: string;
    name: string;
    class: string;
    label?: string;
    tags?: string[];
    transform?: {
      location: { x: number; y: number; z: number };
      rotation: { pitch: number; yaw: number; roll: number };
      scale: { x: number; y: number; z: number };
    };
  }>;
  totalCount: number;
}

interface GetActorResult {
  path: string;
  name: string;
  class: string;
  label?: string;
  tags?: string[];
  transform: {
    location: { x: number; y: number; z: number };
    rotation: { pitch: number; yaw: number; roll: number };
    scale: { x: number; y: number; z: number };
  };
  properties?: Record<string, unknown>;
  components?: Array<{
    name: string;
    class: string;
  }>;
}

// ============================================================================
// Command Implementations
// ============================================================================

export function createActorCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // spawn_actor
    // ========================================================================
    {
      name: 'spawn_actor',
      description: 'Spawn a new actor in the current level from a Blueprint or native class',
      inputSchema: SpawnActorParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'actor',
        tags: ['create', 'spawn', 'actor'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<SpawnActorResult> => {
        const params = context.params as z.infer<typeof SpawnActorParamsSchema>;

        const result = await bridge.remoteControl.spawnActor(
          params.classPath,
          params.label,
          {
            location: params.location,
            rotation: params.rotation,
            scale: params.scale,
          }
        );

        if (!result.success || !result.data) {
          throw new ExecutionError(
            'spawn_actor',
            result.error || 'Failed to spawn actor',
            { classPath: params.classPath }
          );
        }

        const actorPath = result.data.actorPath;

        // Set tags if provided
        if (params.tags && params.tags.length > 0) {
          await bridge.remoteControl.setProperty(actorPath, 'Tags', params.tags);
        }

        // Set additional properties
        if (params.properties) {
          for (const [propName, propValue] of Object.entries(params.properties)) {
            await bridge.remoteControl.setProperty(actorPath, propName, propValue);
          }
        }

        // Record change for state sync
        bridge.stateSync.recordChange({
          type: 'actor',
          target: actorPath,
          changeType: 'create',
          newValue: { classPath: params.classPath, label: params.label },
          source: 'local',
          undoable: true,
        });

        return {
          actorPath,
          actorLabel: params.label || actorPath.split('.').pop() || '',
          actorClass: params.classPath,
        };
      },
    },

    // ========================================================================
    // modify_actor
    // ========================================================================
    {
      name: 'modify_actor',
      description: 'Modify properties of an existing actor',
      inputSchema: ModifyActorParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'actor',
        tags: ['modify', 'edit', 'actor'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<ModifyActorResult> => {
        const params = context.params as z.infer<typeof ModifyActorParamsSchema>;
        const modifiedProperties: string[] = [];

        // Verify actor exists
        const actorInfo = await bridge.stateSync.getActor(params.actorPath);
        if (!actorInfo) {
          throw new ActorNotFoundError(params.actorPath);
        }

        // Set transform if provided
        if (params.location || params.rotation || params.scale) {
          const transformResult = await bridge.remoteControl.setActorTransform(
            params.actorPath,
            {
              location: params.location,
              rotation: params.rotation,
              scale: params.scale,
            }
          );

          if (!transformResult.success) {
            throw new ExecutionError(
              'modify_actor',
              transformResult.error || 'Failed to set transform',
              { actorPath: params.actorPath }
            );
          }

          if (params.location) modifiedProperties.push('RelativeLocation');
          if (params.rotation) modifiedProperties.push('RelativeRotation');
          if (params.scale) modifiedProperties.push('RelativeScale3D');
        }

        // Set custom properties
        if (params.properties) {
          for (const [propName, propValue] of Object.entries(params.properties)) {
            const propResult = await bridge.remoteControl.setProperty(
              params.actorPath,
              propName,
              propValue
            );

            if (propResult.success) {
              modifiedProperties.push(propName);
            }
          }
        }

        // Handle tags
        if (params.addTags || params.removeTags) {
          const currentTagsResult = await bridge.remoteControl.getProperty<string[]>(
            params.actorPath,
            'Tags'
          );

          let tags = currentTagsResult.data || [];

          if (params.addTags) {
            tags = [...new Set([...tags, ...params.addTags])];
          }

          if (params.removeTags) {
            tags = tags.filter((t) => !params.removeTags!.includes(t));
          }

          await bridge.remoteControl.setProperty(params.actorPath, 'Tags', tags);
          modifiedProperties.push('Tags');
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: params.actorPath,
          changeType: 'modify',
          previousValue: actorInfo.info,
          newValue: params,
          source: 'local',
          undoable: true,
        });

        return {
          actorPath: params.actorPath,
          modifiedProperties,
        };
      },
    },

    // ========================================================================
    // delete_actor
    // ========================================================================
    {
      name: 'delete_actor',
      description: 'Delete an actor from the level',
      inputSchema: DeleteActorParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'actor',
        tags: ['delete', 'remove', 'actor'],
        estimatedDuration: 'fast',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<DeleteActorResult> => {
        const params = context.params as z.infer<typeof DeleteActorParamsSchema>;

        // Get actor info before deletion for undo
        const actorInfo = await bridge.stateSync.getActor(params.actorPath);
        if (!actorInfo) {
          throw new ActorNotFoundError(params.actorPath);
        }

        const result = await bridge.remoteControl.deleteActor(params.actorPath);

        if (!result.success) {
          throw new ExecutionError(
            'delete_actor',
            result.error || 'Failed to delete actor',
            { actorPath: params.actorPath }
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: params.actorPath,
          changeType: 'delete',
          previousValue: actorInfo.info,
          source: 'local',
          undoable: true,
        });

        return {
          deleted: true,
          actorPath: params.actorPath,
        };
      },
    },

    // ========================================================================
    // query_actors
    // ========================================================================
    {
      name: 'query_actors',
      description: 'Query actors in the current level with optional filters',
      inputSchema: QueryActorsParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'actor',
        tags: ['query', 'search', 'find', 'actor'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<QueryActorsResult> => {
        const params = context.params as z.infer<typeof QueryActorsParamsSchema>;
        let actorPaths: string[] = [];

        // Query by class or tag
        if (params.className) {
          const result = await bridge.remoteControl.findActorsByClass(params.className);
          if (result.success && result.data) {
            actorPaths = result.data;
          }
        } else if (params.tag) {
          const result = await bridge.remoteControl.findActorsByTag(params.tag);
          if (result.success && result.data) {
            actorPaths = result.data;
          }
        } else {
          // Get all actors from level state
          const levelState = await bridge.stateSync.getLevelState();
          actorPaths = levelState?.actors || [];
        }

        // Fetch actor details
        const actors: QueryActorsResult['actors'] = [];
        const limit = params.limit || 100;

        for (const path of actorPaths.slice(0, limit)) {
          const actorData = await bridge.stateSync.getActor(path);
          if (!actorData) continue;

          const info = actorData.info;

          // Apply name pattern filter
          if (params.namePattern) {
            const regex = new RegExp(params.namePattern, 'i');
            if (!regex.test(info.name) && !regex.test(info.label || '')) {
              continue;
            }
          }

          // Apply bounding box filter
          if (params.inBox && info.transform) {
            const loc = info.transform.location;
            if (
              loc.x < params.inBox.min.x || loc.x > params.inBox.max.x ||
              loc.y < params.inBox.min.y || loc.y > params.inBox.max.y ||
              loc.z < params.inBox.min.z || loc.z > params.inBox.max.z
            ) {
              continue;
            }
          }

          actors.push({
            path: info.path,
            name: info.name,
            class: info.class,
            label: info.label,
            tags: info.tags,
            transform: params.includeTransform ? info.transform : undefined,
          });
        }

        return {
          actors,
          totalCount: actors.length,
        };
      },
    },

    // ========================================================================
    // get_actor
    // ========================================================================
    {
      name: 'get_actor',
      description: 'Get detailed information about a specific actor',
      inputSchema: GetActorParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'actor',
        tags: ['get', 'info', 'actor'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<GetActorResult> => {
        const params = context.params as z.infer<typeof GetActorParamsSchema>;

        const actorData = await bridge.stateSync.getActor(params.actorPath, true);
        if (!actorData) {
          throw new ActorNotFoundError(params.actorPath);
        }

        const info = actorData.info;
        const result: GetActorResult = {
          path: info.path,
          name: info.name,
          class: info.class,
          label: info.label,
          tags: info.tags,
          transform: info.transform || {
            location: { x: 0, y: 0, z: 0 },
            rotation: { pitch: 0, yaw: 0, roll: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        };

        // Fetch specific properties if requested
        if (params.includeProperties) {
          result.properties = {};
          for (const propName of params.includeProperties) {
            const propResult = await bridge.remoteControl.getProperty(
              params.actorPath,
              propName
            );
            if (propResult.success) {
              result.properties[propName] = propResult.data;
            }
          }
        }

        // Fetch components if requested
        if (params.includeComponents) {
          const descResult = await bridge.remoteControl.describeObject(params.actorPath);
          if (descResult.success && descResult.data) {
            // Components would be extracted from the description
            result.components = [];
          }
        }

        return result;
      },
    },

    // ========================================================================
    // duplicate_actor
    // ========================================================================
    {
      name: 'duplicate_actor',
      description: 'Duplicate an existing actor',
      inputSchema: DuplicateActorParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'actor',
        tags: ['duplicate', 'copy', 'clone', 'actor'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<SpawnActorResult> => {
        const params = context.params as z.infer<typeof DuplicateActorParamsSchema>;

        // Get original actor info
        const originalActor = await bridge.stateSync.getActor(params.actorPath);
        if (!originalActor) {
          throw new ActorNotFoundError(params.actorPath);
        }

        const info = originalActor.info;

        // Calculate new location
        const newLocation = info.transform ? {
          x: info.transform.location.x + (params.offset?.x || 100),
          y: info.transform.location.y + (params.offset?.y || 0),
          z: info.transform.location.z + (params.offset?.z || 0),
        } : params.offset || { x: 0, y: 0, z: 0 };

        // Spawn duplicate
        const result = await bridge.remoteControl.spawnActor(
          info.class,
          params.newLabel || `${info.label || info.name}_Copy`,
          {
            location: newLocation,
            rotation: info.transform?.rotation,
            scale: info.transform?.scale,
          }
        );

        if (!result.success || !result.data) {
          throw new ExecutionError(
            'duplicate_actor',
            result.error || 'Failed to duplicate actor',
            { originalPath: params.actorPath }
          );
        }

        // Copy tags
        if (info.tags) {
          await bridge.remoteControl.setProperty(result.data.actorPath, 'Tags', info.tags);
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: result.data.actorPath,
          changeType: 'create',
          newValue: { duplicatedFrom: params.actorPath },
          source: 'local',
          undoable: true,
        });

        return {
          actorPath: result.data.actorPath,
          actorLabel: params.newLabel || `${info.label || info.name}_Copy`,
          actorClass: info.class,
        };
      },
    },

    // ========================================================================
    // select_actors
    // ========================================================================
    {
      name: 'select_actors',
      description: 'Select actors in the editor viewport',
      inputSchema: SelectActorsParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'actor',
        tags: ['select', 'editor', 'actor'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ selectedCount: number }> => {
        const params = context.params as z.infer<typeof SelectActorsParamsSchema>;

        let actorsToSelect = params.actorPaths;

        // Add to existing selection if requested
        if (params.addToSelection) {
          const currentSelection = await bridge.remoteControl.getSelectedActors();
          if (currentSelection.success && currentSelection.data) {
            actorsToSelect = [...new Set([...currentSelection.data, ...params.actorPaths])];
          }
        }

        await bridge.remoteControl.selectActors(actorsToSelect);

        return {
          selectedCount: actorsToSelect.length,
        };
      },
    },

    // ========================================================================
    // focus_actor
    // ========================================================================
    {
      name: 'focus_actor',
      description: 'Focus the editor camera on a specific actor',
      inputSchema: FocusActorParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'actor',
        tags: ['focus', 'camera', 'editor', 'actor'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ focused: boolean }> => {
        const params = context.params as z.infer<typeof FocusActorParamsSchema>;

        // Verify actor exists
        const actorInfo = await bridge.stateSync.getActor(params.actorPath);
        if (!actorInfo) {
          throw new ActorNotFoundError(params.actorPath);
        }

        await bridge.remoteControl.focusOnActor(params.actorPath);

        return {
          focused: true,
        };
      },
    },
  ];
}
