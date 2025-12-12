/**
 * AEGIS WorldGen Plugin - Foliage Commands
 * Commands for vegetation placement and management (Phase 7)
 */

import { z } from 'zod';
import { CommandDefinition, CommandContext } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { FoliageScatterError, ExecutionError } from '../../utils/errors.js';

// ============================================================================
// Schemas
// ============================================================================

const Vector3DSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const FoliageScaleSchema = z.object({
  min: z.number().positive().optional().default(0.8),
  max: z.number().positive().optional().default(1.2),
  uniformScale: z.boolean().optional().default(true),
});

const FoliagePlacementSchema = z.object({
  alignToSurface: z.boolean().optional().default(true),
  randomYaw: z.boolean().optional().default(true),
  randomPitchAngle: z.number().min(0).max(90).optional().default(0),
  groundOffset: z.number().optional().default(0),
  sinkDepth: z.number().min(0).optional().default(0),
});

const CreateFoliageTypeParamsSchema = z.object({
  packagePath: z.string().describe('Package path for the foliage type'),
  name: z.string().describe('Name for the foliage type'),
  mesh: z.string().describe('Static mesh asset path'),
  density: z.number().positive().describe('Instances per 10m square'),
  scale: FoliageScaleSchema.optional(),
  placement: FoliagePlacementSchema.optional(),
  cullDistance: z.object({
    min: z.number().positive().optional().default(0),
    max: z.number().positive().optional().default(50000),
  }).optional(),
  collision: z.object({
    enabled: z.boolean().optional().default(false),
    profile: z.string().optional(),
  }).optional(),
  landscapeLayers: z.array(z.string()).optional().describe('Only spawn on these layers'),
  excludeLayers: z.array(z.string()).optional().describe('Do not spawn on these layers'),
  minSlope: z.number().min(0).max(90).optional().default(0),
  maxSlope: z.number().min(0).max(90).optional().default(45),
  minHeight: z.number().optional(),
  maxHeight: z.number().optional(),
});

const ScatterFoliageParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape'),
  foliageType: z.string().describe('Path to the foliage type asset'),
  area: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('full'),
    }),
    z.object({
      type: z.literal('brush'),
      center: z.object({ x: z.number(), y: z.number() }),
      radius: z.number().positive(),
    }),
    z.object({
      type: z.literal('box'),
      min: z.object({ x: z.number(), y: z.number() }),
      max: z.object({ x: z.number(), y: z.number() }),
    }),
    z.object({
      type: z.literal('spline'),
      splineActorPath: z.string(),
      width: z.number().positive(),
    }),
  ]).describe('Area to scatter foliage in'),
  densityMultiplier: z.number().positive().optional().default(1),
  seed: z.number().int().optional(),
});

const RemoveFoliageParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape'),
  foliageType: z.string().optional().describe('Specific foliage type (all if not specified)'),
  area: z.discriminatedUnion('type', [
    z.object({ type: z.literal('full') }),
    z.object({
      type: z.literal('brush'),
      center: z.object({ x: z.number(), y: z.number() }),
      radius: z.number().positive(),
    }),
    z.object({
      type: z.literal('box'),
      min: z.object({ x: z.number(), y: z.number() }),
      max: z.object({ x: z.number(), y: z.number() }),
    }),
  ]).describe('Area to remove foliage from'),
});

const PaintFoliageParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape'),
  foliageType: z.string().describe('Path to the foliage type'),
  brushCenter: z.object({ x: z.number(), y: z.number() }),
  brushRadius: z.number().positive(),
  brushStrength: z.number().min(0).max(1).optional().default(1),
  erase: z.boolean().optional().default(false).describe('Erase instead of paint'),
});

const GetFoliageStatsParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape'),
  foliageType: z.string().optional().describe('Specific foliage type (all if not specified)'),
});

const OptimizeFoliageParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape'),
  targetDensity: z.number().positive().optional().describe('Target density reduction factor'),
  clusteringDistance: z.number().positive().optional().describe('Merge instances closer than this'),
  lodBias: z.number().optional().describe('Adjust LOD distance bias'),
});

const CreateFoliageClusterParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape'),
  foliageTypes: z.array(z.object({
    foliageType: z.string(),
    weight: z.number().positive().optional().default(1),
  })).describe('Foliage types in the cluster'),
  clusterRadius: z.number().positive().describe('Cluster radius'),
  instancesPerCluster: z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }).describe('Instances per cluster'),
  clusterCount: z.number().int().positive().describe('Number of clusters to create'),
  avoidOverlap: z.boolean().optional().default(true),
  seed: z.number().int().optional(),
});

// ============================================================================
// Response Types
// ============================================================================

interface FoliageStats {
  foliageType: string;
  instanceCount: number;
  memoryUsageMB: number;
  boundingBox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

// ============================================================================
// Command Implementations
// ============================================================================

export function createFoliageCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // create_foliage_type
    // ========================================================================
    {
      name: 'create_foliage_type',
      description: 'Create a new foliage type asset',
      inputSchema: CreateFoliageTypeParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'foliage',
        tags: ['create', 'foliage', 'vegetation', 'worldgen'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ foliageTypePath: string }> => {
        const params = context.params as z.infer<typeof CreateFoliageTypeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/Foliage.Default__FoliageEditorUtils',
          'CreateFoliageType',
          {
            PackagePath: params.packagePath,
            Name: params.name,
            Mesh: params.mesh,
            Density: params.density,
            ScaleMin: params.scale?.min ?? 0.8,
            ScaleMax: params.scale?.max ?? 1.2,
            UniformScale: params.scale?.uniformScale ?? true,
            AlignToSurface: params.placement?.alignToSurface ?? true,
            RandomYaw: params.placement?.randomYaw ?? true,
            RandomPitchAngle: params.placement?.randomPitchAngle ?? 0,
            GroundOffset: params.placement?.groundOffset ?? 0,
            CullDistanceMin: params.cullDistance?.min ?? 0,
            CullDistanceMax: params.cullDistance?.max ?? 50000,
            CollisionEnabled: params.collision?.enabled ?? false,
            CollisionProfile: params.collision?.profile,
            LandscapeLayers: params.landscapeLayers,
            ExcludeLayers: params.excludeLayers,
            MinSlope: params.minSlope,
            MaxSlope: params.maxSlope,
            MinHeight: params.minHeight,
            MaxHeight: params.maxHeight,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'create_foliage_type',
            result.error || 'Failed to create foliage type',
            { name: params.name }
          );
        }

        return {
          foliageTypePath: result.data.ReturnValue,
        };
      },
    },

    // ========================================================================
    // scatter_foliage
    // ========================================================================
    {
      name: 'scatter_foliage',
      description: 'Scatter foliage instances across an area',
      inputSchema: ScatterFoliageParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'foliage',
        tags: ['scatter', 'place', 'foliage', 'vegetation'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{
        scattered: boolean;
        instanceCount: number;
        seed: number;
      }> => {
        const params = context.params as z.infer<typeof ScatterFoliageParamsSchema>;

        const seed = params.seed ?? Math.floor(Math.random() * 2147483647);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; InstanceCount: number; Seed: number };
        }>(
          '/Script/Foliage.Default__ProceduralFoliageSpawner',
          'ScatterFoliage',
          {
            LandscapePath: params.landscapePath,
            FoliageType: params.foliageType,
            Area: params.area,
            DensityMultiplier: params.densityMultiplier,
            Seed: seed,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new FoliageScatterError(
            params.foliageType,
            'full',
            result.error || 'Failed to scatter foliage'
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: params.landscapePath,
          changeType: 'modify',
          newValue: { foliageScattered: params.foliageType, count: result.data.ReturnValue.InstanceCount },
          source: 'local',
          undoable: true,
        });

        return {
          scattered: true,
          instanceCount: result.data.ReturnValue.InstanceCount,
          seed: result.data.ReturnValue.Seed,
        };
      },
    },

    // ========================================================================
    // remove_foliage
    // ========================================================================
    {
      name: 'remove_foliage',
      description: 'Remove foliage instances from an area',
      inputSchema: RemoveFoliageParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'foliage',
        tags: ['remove', 'delete', 'foliage', 'vegetation'],
        estimatedDuration: 'medium',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{
        removed: boolean;
        instancesRemoved: number;
      }> => {
        const params = context.params as z.infer<typeof RemoveFoliageParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; InstancesRemoved: number };
        }>(
          '/Script/Foliage.Default__FoliageEditorUtils',
          'RemoveFoliage',
          {
            LandscapePath: params.landscapePath,
            FoliageType: params.foliageType,
            Area: params.area,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'remove_foliage',
            result.error || 'Failed to remove foliage',
            { foliageType: params.foliageType }
          );
        }

        return {
          removed: result.data?.ReturnValue.Success || false,
          instancesRemoved: result.data?.ReturnValue.InstancesRemoved || 0,
        };
      },
    },

    // ========================================================================
    // paint_foliage
    // ========================================================================
    {
      name: 'paint_foliage',
      description: 'Paint foliage with a brush',
      inputSchema: PaintFoliageParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'foliage',
        tags: ['paint', 'brush', 'foliage'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{
        painted: boolean;
        instancesAffected: number;
      }> => {
        const params = context.params as z.infer<typeof PaintFoliageParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; InstancesAffected: number };
        }>(
          '/Script/Foliage.Default__FoliageBrushTool',
          'PaintFoliage',
          {
            LandscapePath: params.landscapePath,
            FoliageType: params.foliageType,
            BrushCenter: { X: params.brushCenter.x, Y: params.brushCenter.y },
            BrushRadius: params.brushRadius,
            BrushStrength: params.brushStrength,
            Erase: params.erase,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'paint_foliage',
            result.error || 'Failed to paint foliage',
            { foliageType: params.foliageType }
          );
        }

        return {
          painted: result.data?.ReturnValue.Success || false,
          instancesAffected: result.data?.ReturnValue.InstancesAffected || 0,
        };
      },
    },

    // ========================================================================
    // get_foliage_stats
    // ========================================================================
    {
      name: 'get_foliage_stats',
      description: 'Get statistics about foliage in an area',
      inputSchema: GetFoliageStatsParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'foliage',
        tags: ['stats', 'info', 'foliage'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{
        stats: FoliageStats[];
        totalInstances: number;
        totalMemoryMB: number;
      }> => {
        const params = context.params as z.infer<typeof GetFoliageStatsParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Stats: Array<{
              FoliageType: string;
              InstanceCount: number;
              MemoryUsageMB: number;
              BoundingBox: {
                Min: { X: number; Y: number; Z: number };
                Max: { X: number; Y: number; Z: number };
              };
            }>;
            TotalInstances: number;
            TotalMemoryMB: number;
          };
        }>(
          '/Script/Foliage.Default__FoliageEditorUtils',
          'GetFoliageStats',
          {
            LandscapePath: params.landscapePath,
            FoliageType: params.foliageType,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'get_foliage_stats',
            result.error || 'Failed to get foliage stats',
            { landscapePath: params.landscapePath }
          );
        }

        return {
          stats: result.data.ReturnValue.Stats.map((s) => ({
            foliageType: s.FoliageType,
            instanceCount: s.InstanceCount,
            memoryUsageMB: s.MemoryUsageMB,
            boundingBox: {
              min: { x: s.BoundingBox.Min.X, y: s.BoundingBox.Min.Y, z: s.BoundingBox.Min.Z },
              max: { x: s.BoundingBox.Max.X, y: s.BoundingBox.Max.Y, z: s.BoundingBox.Max.Z },
            },
          })),
          totalInstances: result.data.ReturnValue.TotalInstances,
          totalMemoryMB: result.data.ReturnValue.TotalMemoryMB,
        };
      },
    },

    // ========================================================================
    // optimize_foliage
    // ========================================================================
    {
      name: 'optimize_foliage',
      description: 'Optimize foliage for better performance',
      inputSchema: OptimizeFoliageParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'foliage',
        tags: ['optimize', 'performance', 'foliage'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{
        optimized: boolean;
        instancesBefore: number;
        instancesAfter: number;
        memoryReduction: number;
      }> => {
        const params = context.params as z.infer<typeof OptimizeFoliageParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            InstancesBefore: number;
            InstancesAfter: number;
            MemoryReductionMB: number;
          };
        }>(
          '/Script/Foliage.Default__FoliageEditorUtils',
          'OptimizeFoliage',
          {
            LandscapePath: params.landscapePath,
            TargetDensity: params.targetDensity,
            ClusteringDistance: params.clusteringDistance,
            LODBias: params.lodBias,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new ExecutionError(
            'optimize_foliage',
            result.error || 'Failed to optimize foliage',
            { landscapePath: params.landscapePath }
          );
        }

        return {
          optimized: true,
          instancesBefore: result.data.ReturnValue.InstancesBefore,
          instancesAfter: result.data.ReturnValue.InstancesAfter,
          memoryReduction: result.data.ReturnValue.MemoryReductionMB,
        };
      },
    },

    // ========================================================================
    // create_foliage_cluster
    // ========================================================================
    {
      name: 'create_foliage_cluster',
      description: 'Create clusters of mixed foliage types',
      inputSchema: CreateFoliageClusterParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'foliage',
        tags: ['cluster', 'scatter', 'foliage', 'vegetation'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{
        created: boolean;
        clustersCreated: number;
        totalInstances: number;
        seed: number;
      }> => {
        const params = context.params as z.infer<typeof CreateFoliageClusterParamsSchema>;

        const seed = params.seed ?? Math.floor(Math.random() * 2147483647);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            ClustersCreated: number;
            TotalInstances: number;
            Seed: number;
          };
        }>(
          '/Script/Foliage.Default__ProceduralFoliageSpawner',
          'CreateFoliageClusters',
          {
            LandscapePath: params.landscapePath,
            FoliageTypes: params.foliageTypes,
            ClusterRadius: params.clusterRadius,
            InstancesPerClusterMin: params.instancesPerCluster.min,
            InstancesPerClusterMax: params.instancesPerCluster.max,
            ClusterCount: params.clusterCount,
            AvoidOverlap: params.avoidOverlap,
            Seed: seed,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new FoliageScatterError(
            'cluster',
            'cluster',
            result.error || 'Failed to create foliage clusters'
          );
        }

        return {
          created: true,
          clustersCreated: result.data.ReturnValue.ClustersCreated,
          totalInstances: result.data.ReturnValue.TotalInstances,
          seed: result.data.ReturnValue.Seed,
        };
      },
    },
  ];
}
