/**
 * AEGIS WorldGen Plugin - Terrain Commands
 * Commands for terrain generation and manipulation (Phase 7)
 */

import { z } from 'zod';
import { CommandDefinition, CommandContext } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { TerrainGenerationError, ExecutionError } from '../../utils/errors.js';

// ============================================================================
// Schemas
// ============================================================================

const Vector2DSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const HeightmapSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('file'),
    filePath: z.string().describe('Path to heightmap image (PNG, RAW, R16)'),
    bitDepth: z.enum(['8', '16']).optional().default('16'),
  }),
  z.object({
    type: z.literal('procedural'),
    noiseType: z.enum(['perlin', 'simplex', 'worley', 'ridged', 'fbm']).describe('Noise algorithm'),
    seed: z.number().int().optional().describe('Random seed'),
    scale: z.number().positive().optional().default(1).describe('Noise scale'),
    octaves: z.number().int().min(1).max(16).optional().default(4),
    persistence: z.number().min(0).max(1).optional().default(0.5),
    lacunarity: z.number().min(1).max(4).optional().default(2),
  }),
  z.object({
    type: z.literal('flat'),
    height: z.number().optional().default(0).describe('Flat height value'),
  }),
]);

const CreateLandscapeParamsSchema = z.object({
  name: z.string().describe('Name for the landscape actor'),
  location: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
  }).optional().describe('World location'),
  sizeX: z.number().int().positive().describe('Number of components in X'),
  sizeY: z.number().int().positive().describe('Number of components in Y'),
  componentSize: z.enum(['63', '127', '255']).optional().default('127').describe('Quads per component section'),
  sectionsPerComponent: z.enum(['1', '4']).optional().default('1'),
  heightmapSource: HeightmapSourceSchema.optional().describe('Initial heightmap data'),
  material: z.string().optional().describe('Landscape material path'),
  scale: z.object({
    x: z.number().positive(),
    y: z.number().positive(),
    z: z.number().positive(),
  }).optional().describe('Landscape scale'),
});

const ImportHeightmapParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape actor'),
  heightmapSource: HeightmapSourceSchema.describe('Heightmap data source'),
  heightScale: z.number().positive().optional().default(100).describe('Height scaling factor'),
  centerOffset: z.boolean().optional().default(true).describe('Center heightmap on landscape'),
});

const ExportHeightmapParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape actor'),
  outputPath: z.string().describe('Output file path'),
  format: z.enum(['png16', 'raw16', 'r32']).optional().default('png16'),
  includeWeightmaps: z.boolean().optional().default(false).describe('Export layer weight maps'),
});

const SculptTerrainParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape actor'),
  brushCenter: z.object({ x: z.number(), y: z.number() }).describe('Brush center in world XY'),
  brushRadius: z.number().positive().describe('Brush radius in world units'),
  brushFalloff: z.number().min(0).max(1).optional().default(0.5),
  brushStrength: z.number().min(-1).max(1).describe('Positive raises, negative lowers'),
  tool: z.enum(['sculpt', 'smooth', 'flatten', 'ramp', 'erosion', 'noise']).optional().default('sculpt'),
  toolParams: z.record(z.unknown()).optional().describe('Tool-specific parameters'),
});

const PaintLayerParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape actor'),
  layerName: z.string().describe('Name of the landscape layer'),
  brushCenter: z.object({ x: z.number(), y: z.number() }).describe('Brush center'),
  brushRadius: z.number().positive().describe('Brush radius'),
  brushFalloff: z.number().min(0).max(1).optional().default(0.5),
  brushStrength: z.number().min(0).max(1).optional().default(1),
});

const AddLandscapeLayerParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape actor'),
  layerName: z.string().describe('Name for the new layer'),
  layerType: z.enum(['weight', 'visibility']).optional().default('weight'),
  blendMode: z.enum(['additive', 'alpha_blend']).optional().default('alpha_blend'),
  fillWeight: z.number().min(0).max(1).optional().default(0).describe('Initial fill weight'),
});

const GenerateProceduralTerrainParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape actor'),
  algorithm: z.enum(['perlin', 'simplex', 'diamond_square', 'hydraulic_erosion', 'thermal_erosion']),
  seed: z.number().int().optional().describe('Random seed'),
  parameters: z.object({
    scale: z.number().positive().optional(),
    amplitude: z.number().positive().optional(),
    octaves: z.number().int().min(1).max(16).optional(),
    persistence: z.number().min(0).max(1).optional(),
    lacunarity: z.number().min(1).max(4).optional(),
    erosionIterations: z.number().int().positive().optional(),
    erosionStrength: z.number().min(0).max(1).optional(),
  }).optional(),
  blendWithExisting: z.boolean().optional().default(false),
  blendStrength: z.number().min(0).max(1).optional().default(0.5),
});

const GetLandscapeInfoParamsSchema = z.object({
  landscapePath: z.string().describe('Path to the landscape actor'),
  includeLayerInfo: z.boolean().optional().default(true),
  includeComponentInfo: z.boolean().optional().default(false),
});

// ============================================================================
// Response Types
// ============================================================================

interface CreateLandscapeResult {
  landscapePath: string;
  componentCount: number;
  totalVertices: number;
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

interface GetLandscapeInfoResult {
  path: string;
  name: string;
  componentCountX: number;
  componentCountY: number;
  totalComponents: number;
  resolution: { x: number; y: number };
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  material?: string;
  layers?: Array<{
    name: string;
    type: string;
    blendMode: string;
  }>;
  components?: Array<{
    index: { x: number; y: number };
    bounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    };
  }>;
}

// ============================================================================
// Command Implementations
// ============================================================================

export function createTerrainCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // create_landscape
    // ========================================================================
    {
      name: 'create_landscape',
      description: 'Create a new landscape actor',
      inputSchema: CreateLandscapeParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'terrain',
        tags: ['create', 'landscape', 'terrain', 'worldgen'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<CreateLandscapeResult> => {
        const params = context.params as z.infer<typeof CreateLandscapeParamsSchema>;

        // Calculate resolution
        const componentQuads = parseInt(params.componentSize);
        const sectionsPerComponent = parseInt(params.sectionsPerComponent);
        const componentsX = params.sizeX;
        const componentsY = params.sizeY;

        const resolutionX = componentsX * componentQuads * sectionsPerComponent + 1;
        const resolutionY = componentsY * componentQuads * sectionsPerComponent + 1;

        // Generate heightmap if procedural source specified
        let heightmapData: number[] | undefined;
        if (params.heightmapSource?.type === 'procedural') {
          heightmapData = generateProceduralHeightmap(
            resolutionX,
            resolutionY,
            params.heightmapSource
          );
        }

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            LandscapePath: string;
            ComponentCount: number;
            TotalVertices: number;
            Bounds: {
              Min: { X: number; Y: number; Z: number };
              Max: { X: number; Y: number; Z: number };
            };
          };
        }>(
          '/Script/Landscape.Default__LandscapeEditorUtils',
          'CreateLandscape',
          {
            Name: params.name,
            Location: params.location || { X: 0, Y: 0, Z: 0 },
            NumComponentsX: componentsX,
            NumComponentsY: componentsY,
            QuadsPerSection: componentQuads,
            SectionsPerComponent: sectionsPerComponent,
            HeightmapData: heightmapData,
            Material: params.material,
            Scale: params.scale,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new TerrainGenerationError(
            'create_landscape',
            result.error || 'Failed to create landscape'
          );
        }

        const data = result.data.ReturnValue;

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: data.LandscapePath,
          changeType: 'create',
          newValue: { type: 'Landscape', name: params.name },
          source: 'local',
          undoable: true,
        });

        return {
          landscapePath: data.LandscapePath,
          componentCount: data.ComponentCount,
          totalVertices: data.TotalVertices,
          bounds: {
            min: { x: data.Bounds.Min.X, y: data.Bounds.Min.Y, z: data.Bounds.Min.Z },
            max: { x: data.Bounds.Max.X, y: data.Bounds.Max.Y, z: data.Bounds.Max.Z },
          },
        };
      },
    },

    // ========================================================================
    // import_heightmap
    // ========================================================================
    {
      name: 'import_heightmap',
      description: 'Import heightmap data into an existing landscape',
      inputSchema: ImportHeightmapParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'terrain',
        tags: ['import', 'heightmap', 'landscape', 'terrain'],
        estimatedDuration: 'medium',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ imported: boolean; verticesModified: number }> => {
        const params = context.params as z.infer<typeof ImportHeightmapParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; VerticesModified: number };
        }>(
          '/Script/Landscape.Default__LandscapeEditorUtils',
          'ImportHeightmap',
          {
            LandscapePath: params.landscapePath,
            HeightmapSource: params.heightmapSource,
            HeightScale: params.heightScale,
            CenterOffset: params.centerOffset,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new TerrainGenerationError(
            'import_heightmap',
            result.error || 'Failed to import heightmap'
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: params.landscapePath,
          changeType: 'modify',
          newValue: { heightmapImported: true },
          source: 'local',
          undoable: true,
        });

        return {
          imported: true,
          verticesModified: result.data.ReturnValue.VerticesModified,
        };
      },
    },

    // ========================================================================
    // export_heightmap
    // ========================================================================
    {
      name: 'export_heightmap',
      description: 'Export landscape heightmap to file',
      inputSchema: ExportHeightmapParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'terrain',
        tags: ['export', 'heightmap', 'landscape'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ exported: boolean; outputPath: string }> => {
        const params = context.params as z.infer<typeof ExportHeightmapParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/Landscape.Default__LandscapeEditorUtils',
          'ExportHeightmap',
          {
            LandscapePath: params.landscapePath,
            OutputPath: params.outputPath,
            Format: params.format,
            IncludeWeightmaps: params.includeWeightmaps,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'export_heightmap',
            result.error || 'Failed to export heightmap',
            { landscapePath: params.landscapePath }
          );
        }

        return {
          exported: true,
          outputPath: params.outputPath,
        };
      },
    },

    // ========================================================================
    // sculpt_terrain
    // ========================================================================
    {
      name: 'sculpt_terrain',
      description: 'Apply sculpting brush to terrain',
      inputSchema: SculptTerrainParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'terrain',
        tags: ['sculpt', 'brush', 'terrain', 'edit'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ modified: boolean; verticesAffected: number }> => {
        const params = context.params as z.infer<typeof SculptTerrainParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; VerticesAffected: number };
        }>(
          '/Script/Landscape.Default__LandscapeBrushTool',
          'ApplyBrush',
          {
            LandscapePath: params.landscapePath,
            BrushCenter: { X: params.brushCenter.x, Y: params.brushCenter.y },
            BrushRadius: params.brushRadius,
            BrushFalloff: params.brushFalloff,
            BrushStrength: params.brushStrength,
            Tool: params.tool,
            ToolParams: params.toolParams,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'sculpt_terrain',
            result.error || 'Failed to apply sculpt brush',
            { landscapePath: params.landscapePath }
          );
        }

        return {
          modified: result.data?.ReturnValue.Success || false,
          verticesAffected: result.data?.ReturnValue.VerticesAffected || 0,
        };
      },
    },

    // ========================================================================
    // paint_layer
    // ========================================================================
    {
      name: 'paint_layer',
      description: 'Paint a landscape material layer',
      inputSchema: PaintLayerParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'terrain',
        tags: ['paint', 'layer', 'material', 'terrain'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ painted: boolean; pixelsAffected: number }> => {
        const params = context.params as z.infer<typeof PaintLayerParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; PixelsAffected: number };
        }>(
          '/Script/Landscape.Default__LandscapePaintTool',
          'PaintLayer',
          {
            LandscapePath: params.landscapePath,
            LayerName: params.layerName,
            BrushCenter: { X: params.brushCenter.x, Y: params.brushCenter.y },
            BrushRadius: params.brushRadius,
            BrushFalloff: params.brushFalloff,
            BrushStrength: params.brushStrength,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'paint_layer',
            result.error || 'Failed to paint layer',
            { layerName: params.layerName }
          );
        }

        return {
          painted: result.data?.ReturnValue.Success || false,
          pixelsAffected: result.data?.ReturnValue.PixelsAffected || 0,
        };
      },
    },

    // ========================================================================
    // add_landscape_layer
    // ========================================================================
    {
      name: 'add_landscape_layer',
      description: 'Add a new layer to a landscape',
      inputSchema: AddLandscapeLayerParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'terrain',
        tags: ['layer', 'add', 'landscape'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ layerName: string; layerIndex: number }> => {
        const params = context.params as z.infer<typeof AddLandscapeLayerParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { LayerName: string; LayerIndex: number };
        }>(
          '/Script/Landscape.Default__LandscapeEditorUtils',
          'AddLandscapeLayer',
          {
            LandscapePath: params.landscapePath,
            LayerName: params.layerName,
            LayerType: params.layerType,
            BlendMode: params.blendMode,
            FillWeight: params.fillWeight,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'add_landscape_layer',
            result.error || 'Failed to add layer',
            { layerName: params.layerName }
          );
        }

        return {
          layerName: result.data.ReturnValue.LayerName,
          layerIndex: result.data.ReturnValue.LayerIndex,
        };
      },
    },

    // ========================================================================
    // generate_procedural_terrain
    // ========================================================================
    {
      name: 'generate_procedural_terrain',
      description: 'Generate procedural terrain using various algorithms',
      inputSchema: GenerateProceduralTerrainParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'terrain',
        tags: ['procedural', 'generate', 'terrain', 'worldgen'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ generated: boolean; seed: number }> => {
        const params = context.params as z.infer<typeof GenerateProceduralTerrainParamsSchema>;

        const seed = params.seed ?? Math.floor(Math.random() * 2147483647);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; Seed: number };
        }>(
          '/Script/Landscape.Default__ProceduralLandscapeGenerator',
          'GenerateTerrain',
          {
            LandscapePath: params.landscapePath,
            Algorithm: params.algorithm,
            Seed: seed,
            Parameters: params.parameters,
            BlendWithExisting: params.blendWithExisting,
            BlendStrength: params.blendStrength,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new TerrainGenerationError(
            'generate_procedural_terrain',
            result.error || 'Failed to generate procedural terrain'
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: params.landscapePath,
          changeType: 'modify',
          newValue: { proceduralGeneration: params.algorithm, seed },
          source: 'local',
          undoable: true,
        });

        return {
          generated: true,
          seed: result.data.ReturnValue.Seed,
        };
      },
    },

    // ========================================================================
    // get_landscape_info
    // ========================================================================
    {
      name: 'get_landscape_info',
      description: 'Get information about a landscape',
      inputSchema: GetLandscapeInfoParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'terrain',
        tags: ['info', 'landscape', 'terrain'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<GetLandscapeInfoResult> => {
        const params = context.params as z.infer<typeof GetLandscapeInfoParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Name: string;
            ComponentCountX: number;
            ComponentCountY: number;
            TotalComponents: number;
            ResolutionX: number;
            ResolutionY: number;
            Bounds: {
              Min: { X: number; Y: number; Z: number };
              Max: { X: number; Y: number; Z: number };
            };
            Material: string;
            Layers: Array<{
              Name: string;
              Type: string;
              BlendMode: string;
            }>;
            Components: Array<{
              IndexX: number;
              IndexY: number;
              Bounds: {
                Min: { X: number; Y: number; Z: number };
                Max: { X: number; Y: number; Z: number };
              };
            }>;
          };
        }>(
          '/Script/Landscape.Default__LandscapeEditorUtils',
          'GetLandscapeInfo',
          {
            LandscapePath: params.landscapePath,
            IncludeLayerInfo: params.includeLayerInfo,
            IncludeComponentInfo: params.includeComponentInfo,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'get_landscape_info',
            result.error || 'Failed to get landscape info',
            { landscapePath: params.landscapePath }
          );
        }

        const data = result.data.ReturnValue;

        const info: GetLandscapeInfoResult = {
          path: params.landscapePath,
          name: data.Name,
          componentCountX: data.ComponentCountX,
          componentCountY: data.ComponentCountY,
          totalComponents: data.TotalComponents,
          resolution: { x: data.ResolutionX, y: data.ResolutionY },
          bounds: {
            min: { x: data.Bounds.Min.X, y: data.Bounds.Min.Y, z: data.Bounds.Min.Z },
            max: { x: data.Bounds.Max.X, y: data.Bounds.Max.Y, z: data.Bounds.Max.Z },
          },
          material: data.Material,
        };

        if (params.includeLayerInfo) {
          info.layers = data.Layers.map((l) => ({
            name: l.Name,
            type: l.Type,
            blendMode: l.BlendMode,
          }));
        }

        if (params.includeComponentInfo) {
          info.components = data.Components.map((c) => ({
            index: { x: c.IndexX, y: c.IndexY },
            bounds: {
              min: { x: c.Bounds.Min.X, y: c.Bounds.Min.Y, z: c.Bounds.Min.Z },
              max: { x: c.Bounds.Max.X, y: c.Bounds.Max.Y, z: c.Bounds.Max.Z },
            },
          }));
        }

        return info;
      },
    },
  ];
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateProceduralHeightmap(
  width: number,
  height: number,
  params: { noiseType: string; seed?: number; scale?: number; octaves?: number; persistence?: number; lacunarity?: number }
): number[] {
  const seed = params.seed ?? Math.floor(Math.random() * 2147483647);
  const scale = params.scale ?? 1;
  const octaves = params.octaves ?? 4;
  const persistence = params.persistence ?? 0.5;
  const lacunarity = params.lacunarity ?? 2;

  const heightmap: number[] = new Array(width * height);

  // Simple noise implementation (would use proper noise library in production)
  const noise2D = (x: number, y: number, s: number): number => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + s) * 43758.5453;
    return n - Math.floor(n);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      let amplitude = 1;
      let frequency = 1;
      let maxValue = 0;

      for (let o = 0; o < octaves; o++) {
        const sampleX = (x / width) * scale * frequency;
        const sampleY = (y / height) * scale * frequency;

        value += noise2D(sampleX, sampleY, seed + o * 1000) * amplitude;
        maxValue += amplitude;

        amplitude *= persistence;
        frequency *= lacunarity;
      }

      heightmap[y * width + x] = (value / maxValue + 1) * 0.5 * 65535; // 16-bit range
    }
  }

  return heightmap;
}
