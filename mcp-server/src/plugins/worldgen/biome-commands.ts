/**
 * AEGIS WorldGen Plugin - Biome Commands
 * Commands for biome configuration and management (Phase 7)
 */

import { z } from 'zod';
import { CommandDefinition, CommandContext } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { BiomeConfigurationError, ExecutionError } from '../../utils/errors.js';

// ============================================================================
// Schemas
// ============================================================================

const ColorSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
});

const BiomeConditionsSchema = z.object({
  minHeight: z.number().optional().describe('Minimum terrain height (0-1)'),
  maxHeight: z.number().optional().describe('Maximum terrain height (0-1)'),
  minSlope: z.number().min(0).max(90).optional().describe('Minimum slope angle in degrees'),
  maxSlope: z.number().min(0).max(90).optional().describe('Maximum slope angle in degrees'),
  minMoisture: z.number().min(0).max(1).optional(),
  maxMoisture: z.number().min(0).max(1).optional(),
  minTemperature: z.number().min(-50).max(50).optional(),
  maxTemperature: z.number().min(-50).max(50).optional(),
});

const BiomeLayerSchema = z.object({
  materialLayer: z.string().describe('Landscape material layer name'),
  weight: z.number().min(0).max(1).optional().default(1),
  noiseScale: z.number().positive().optional(),
  noiseThreshold: z.number().min(0).max(1).optional(),
});

const FoliageConfigSchema = z.object({
  foliageType: z.string().describe('Path to foliage type asset'),
  density: z.number().positive().describe('Instances per square meter'),
  minScale: z.number().positive().optional().default(0.8),
  maxScale: z.number().positive().optional().default(1.2),
  alignToSurface: z.boolean().optional().default(true),
  randomRotation: z.boolean().optional().default(true),
});

const CreateBiomeParamsSchema = z.object({
  biomeName: z.string().describe('Unique identifier for the biome'),
  displayName: z.string().describe('Human-readable name'),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional().default(50),
  conditions: BiomeConditionsSchema.describe('Conditions for biome placement'),
  layers: z.array(BiomeLayerSchema).describe('Material layers for this biome'),
  foliage: z.array(FoliageConfigSchema).optional().describe('Foliage types for this biome'),
  color: ColorSchema.optional().describe('Debug visualization color'),
});

const UpdateBiomeParamsSchema = z.object({
  biomeName: z.string().describe('Name of the biome to update'),
  conditions: BiomeConditionsSchema.optional(),
  layers: z.array(BiomeLayerSchema).optional(),
  foliage: z.array(FoliageConfigSchema).optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

const DeleteBiomeParamsSchema = z.object({
  biomeName: z.string().describe('Name of the biome to delete'),
  removeFromLandscapes: z.boolean().optional().default(false),
});

const ApplyBiomesToLandscapeParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape'),
  biomeNames: z.array(z.string()).optional().describe('Specific biomes to apply (all if empty)'),
  generateMoisture: z.boolean().optional().default(true),
  generateTemperature: z.boolean().optional().default(true),
  seed: z.number().int().optional(),
});

const PaintBiomeParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape'),
  biomeName: z.string().describe('Biome to paint'),
  brushCenter: z.object({ x: z.number(), y: z.number() }).describe('Brush center'),
  brushRadius: z.number().positive().describe('Brush radius'),
  brushStrength: z.number().min(0).max(1).optional().default(1),
  brushFalloff: z.number().min(0).max(1).optional().default(0.5),
});

const GetBiomeAtLocationParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape'),
  location: z.object({ x: z.number(), y: z.number() }).describe('World location to query'),
});

const GenerateBiomeMapParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape'),
  resolution: z.number().int().positive().optional().default(512),
  outputPath: z.string().optional().describe('Path to save biome map image'),
});

const ListBiomesParamsSchema = z.object({
  includeConditions: z.boolean().optional().default(false),
  includeFoliage: z.boolean().optional().default(false),
});

// ============================================================================
// Response Types
// ============================================================================

interface BiomeInfo {
  name: string;
  displayName: string;
  priority: number;
  conditions?: {
    minHeight?: number;
    maxHeight?: number;
    minSlope?: number;
    maxSlope?: number;
    minMoisture?: number;
    maxMoisture?: number;
    minTemperature?: number;
    maxTemperature?: number;
  };
  layers: Array<{ materialLayer: string; weight: number }>;
  foliage?: Array<{ foliageType: string; density: number }>;
}

// ============================================================================
// Command Implementations
// ============================================================================

export function createBiomeCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // create_biome
    // ========================================================================
    {
      name: 'create_biome',
      description: 'Create a new biome definition',
      inputSchema: CreateBiomeParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'biome',
        tags: ['create', 'biome', 'worldgen'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ biomeName: string; created: boolean }> => {
        const params = context.params as z.infer<typeof CreateBiomeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/WorldGen.Default__BiomeManager',
          'CreateBiome',
          {
            BiomeName: params.biomeName,
            DisplayName: params.displayName,
            Description: params.description,
            Priority: params.priority,
            Conditions: params.conditions,
            Layers: params.layers,
            Foliage: params.foliage,
            Color: params.color,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new BiomeConfigurationError(
            params.biomeName,
            result.error || 'Failed to create biome'
          );
        }

        return {
          biomeName: params.biomeName,
          created: true,
        };
      },
    },

    // ========================================================================
    // update_biome
    // ========================================================================
    {
      name: 'update_biome',
      description: 'Update an existing biome definition',
      inputSchema: UpdateBiomeParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'biome',
        tags: ['update', 'modify', 'biome'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ biomeName: string; updated: boolean }> => {
        const params = context.params as z.infer<typeof UpdateBiomeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/WorldGen.Default__BiomeManager',
          'UpdateBiome',
          {
            BiomeName: params.biomeName,
            Conditions: params.conditions,
            Layers: params.layers,
            Foliage: params.foliage,
            Priority: params.priority,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'update_biome',
            result.error || 'Failed to update biome',
            { biomeName: params.biomeName }
          );
        }

        return {
          biomeName: params.biomeName,
          updated: true,
        };
      },
    },

    // ========================================================================
    // delete_biome
    // ========================================================================
    {
      name: 'delete_biome',
      description: 'Delete a biome definition',
      inputSchema: DeleteBiomeParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'biome',
        tags: ['delete', 'remove', 'biome'],
        estimatedDuration: 'fast',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ biomeName: string; deleted: boolean }> => {
        const params = context.params as z.infer<typeof DeleteBiomeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/WorldGen.Default__BiomeManager',
          'DeleteBiome',
          {
            BiomeName: params.biomeName,
            RemoveFromLandscapes: params.removeFromLandscapes,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'delete_biome',
            result.error || 'Failed to delete biome',
            { biomeName: params.biomeName }
          );
        }

        return {
          biomeName: params.biomeName,
          deleted: true,
        };
      },
    },

    // ========================================================================
    // apply_biomes_to_landscape
    // ========================================================================
    {
      name: 'apply_biomes_to_landscape',
      description: 'Apply biome system to a landscape based on conditions',
      inputSchema: ApplyBiomesToLandscapeParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'biome',
        tags: ['apply', 'generate', 'biome', 'landscape'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{
        applied: boolean;
        biomesApplied: string[];
        coverage: Record<string, number>;
      }> => {
        const params = context.params as z.infer<typeof ApplyBiomesToLandscapeParamsSchema>;

        const seed = params.seed ?? Math.floor(Math.random() * 2147483647);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            BiomesApplied: string[];
            Coverage: Record<string, number>;
          };
        }>(
          '/Script/WorldGen.Default__BiomeManager',
          'ApplyBiomesToLandscape',
          {
            LandscapePath: params.landscapePath,
            BiomeNames: params.biomeNames,
            GenerateMoisture: params.generateMoisture,
            GenerateTemperature: params.generateTemperature,
            Seed: seed,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new BiomeConfigurationError(
            'apply_biomes',
            result.error || 'Failed to apply biomes'
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: params.landscapePath,
          changeType: 'modify',
          newValue: { biomesApplied: result.data.ReturnValue.BiomesApplied },
          source: 'local',
          undoable: true,
        });

        return {
          applied: true,
          biomesApplied: result.data.ReturnValue.BiomesApplied,
          coverage: result.data.ReturnValue.Coverage,
        };
      },
    },

    // ========================================================================
    // paint_biome
    // ========================================================================
    {
      name: 'paint_biome',
      description: 'Paint a specific biome onto the landscape',
      inputSchema: PaintBiomeParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'biome',
        tags: ['paint', 'brush', 'biome'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ painted: boolean; areaAffected: number }> => {
        const params = context.params as z.infer<typeof PaintBiomeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; AreaAffected: number };
        }>(
          '/Script/WorldGen.Default__BiomeBrushTool',
          'PaintBiome',
          {
            LandscapePath: params.landscapePath,
            BiomeName: params.biomeName,
            BrushCenter: { X: params.brushCenter.x, Y: params.brushCenter.y },
            BrushRadius: params.brushRadius,
            BrushStrength: params.brushStrength,
            BrushFalloff: params.brushFalloff,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'paint_biome',
            result.error || 'Failed to paint biome',
            { biomeName: params.biomeName }
          );
        }

        return {
          painted: result.data?.ReturnValue.Success || false,
          areaAffected: result.data?.ReturnValue.AreaAffected || 0,
        };
      },
    },

    // ========================================================================
    // get_biome_at_location
    // ========================================================================
    {
      name: 'get_biome_at_location',
      description: 'Query which biome is at a specific location',
      inputSchema: GetBiomeAtLocationParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'biome',
        tags: ['query', 'location', 'biome'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{
        biomeName: string;
        biomeWeight: number;
        allBiomes: Array<{ name: string; weight: number }>;
      }> => {
        const params = context.params as z.infer<typeof GetBiomeAtLocationParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            PrimaryBiome: string;
            PrimaryWeight: number;
            AllBiomes: Array<{ Name: string; Weight: number }>;
          };
        }>(
          '/Script/WorldGen.Default__BiomeManager',
          'GetBiomeAtLocation',
          {
            LandscapePath: params.landscapePath,
            Location: { X: params.location.x, Y: params.location.y },
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'get_biome_at_location',
            result.error || 'Failed to query biome',
            params
          );
        }

        return {
          biomeName: result.data.ReturnValue.PrimaryBiome,
          biomeWeight: result.data.ReturnValue.PrimaryWeight,
          allBiomes: result.data.ReturnValue.AllBiomes.map((b) => ({
            name: b.Name,
            weight: b.Weight,
          })),
        };
      },
    },

    // ========================================================================
    // generate_biome_map
    // ========================================================================
    {
      name: 'generate_biome_map',
      description: 'Generate a visualization map of biome distribution',
      inputSchema: GenerateBiomeMapParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'biome',
        tags: ['generate', 'map', 'visualization', 'biome'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{
        generated: boolean;
        outputPath?: string;
        biomeColors: Record<string, { r: number; g: number; b: number }>;
      }> => {
        const params = context.params as z.infer<typeof GenerateBiomeMapParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            OutputPath: string;
            BiomeColors: Record<string, { R: number; G: number; B: number }>;
          };
        }>(
          '/Script/WorldGen.Default__BiomeManager',
          'GenerateBiomeMap',
          {
            LandscapePath: params.landscapePath,
            Resolution: params.resolution,
            OutputPath: params.outputPath,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new ExecutionError(
            'generate_biome_map',
            result.error || 'Failed to generate biome map',
            { landscapePath: params.landscapePath }
          );
        }

        const biomeColors: Record<string, { r: number; g: number; b: number }> = {};
        for (const [name, color] of Object.entries(result.data.ReturnValue.BiomeColors)) {
          biomeColors[name] = { r: color.R, g: color.G, b: color.B };
        }

        return {
          generated: true,
          outputPath: result.data.ReturnValue.OutputPath,
          biomeColors,
        };
      },
    },

    // ========================================================================
    // list_biomes
    // ========================================================================
    {
      name: 'list_biomes',
      description: 'List all registered biomes',
      inputSchema: ListBiomesParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'biome',
        tags: ['list', 'query', 'biome'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ biomes: BiomeInfo[]; count: number }> => {
        const params = context.params as z.infer<typeof ListBiomesParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: Array<{
            Name: string;
            DisplayName: string;
            Priority: number;
            Conditions?: Record<string, number>;
            Layers: Array<{ MaterialLayer: string; Weight: number }>;
            Foliage?: Array<{ FoliageType: string; Density: number }>;
          }>;
        }>(
          '/Script/WorldGen.Default__BiomeManager',
          'GetAllBiomes',
          {
            IncludeConditions: params.includeConditions,
            IncludeFoliage: params.includeFoliage,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'list_biomes',
            result.error || 'Failed to list biomes',
            {}
          );
        }

        const biomes = result.data.ReturnValue.map((b): BiomeInfo => ({
          name: b.Name,
          displayName: b.DisplayName,
          priority: b.Priority,
          conditions: params.includeConditions ? b.Conditions : undefined,
          layers: b.Layers.map((l) => ({
            materialLayer: l.MaterialLayer,
            weight: l.Weight,
          })),
          foliage: params.includeFoliage
            ? b.Foliage?.map((f) => ({
                foliageType: f.FoliageType,
                density: f.Density,
              }))
            : undefined,
        }));

        return {
          biomes,
          count: biomes.length,
        };
      },
    },
  ];
}
