
-----

## 🌍 Phase 7: WorldGen Subsystem

### Overview

The WorldGen subsystem provides comprehensive procedural world generation capabilities integrated with UE5.3+ PCG (Procedural Content Generation) framework. It supports terrain generation, biome systems, foliage scattering, and export functionality.

### Directory Structure

```
aegis/mcp-server/src/plugins/worldgen/
├── index.ts                      # Plugin entry point
├── commands/
│   ├── terrain.ts                # Terrain generation commands
│   ├── biome.ts                  # Biome system commands
│   ├── foliage.ts                # Foliage scattering commands
│   ├── export.ts                 # Export commands
│   └── pcg-integration.ts        # UE5 PCG framework integration
├── schemas/
│   ├── terrain-schemas.ts        # Terrain Zod schemas
│   ├── biome-schemas.ts          # Biome Zod schemas
│   ├── foliage-schemas.ts        # Foliage Zod schemas
│   ├── pcg-schemas.ts            # PCG integration schemas
│   └── export-schemas.ts         # Export Zod schemas
├── generators/
│   ├── noise-generator.ts        # Noise functions (Perlin, Simplex, etc.)
│   ├── heightmap-generator.ts    # Heightmap generation
│   ├── biome-placer.ts           # Biome placement logic
│   └── scatter-engine.ts         # Asset scattering engine
├── types/
│   └── worldgen-types.ts         # WorldGen type definitions
└── utils/
    ├── math-utils.ts             # Mathematical utilities
    └── sampling-utils.ts         # Sampling and distribution utilities
```

### Custom Error Classes (src/plugins/worldgen/errors.ts)

```typescript
import { AegisError } from '../../utils/errors';

export class TerrainGenerationError extends AegisError {
  constructor(operation: string, details: string, cause?: Error) {
    super(
      `Terrain generation failed during ${operation}: ${details}`,
      'TERRAIN_GENERATION_FAILED',
      { operation, details, cause: cause?.message },
      true
    );
    this.name = 'TerrainGenerationError';
  }
}

export class BiomeConfigurationError extends AegisError {
  constructor(biomeId: string, reason: string) {
    super(
      `Invalid biome configuration for "${biomeId}": ${reason}`,
      'BIOME_CONFIGURATION_INVALID',
      { biomeId, reason },
      true
    );
    this.name = 'BiomeConfigurationError';
  }
}

export class BiomeTransitionError extends AegisError {
  constructor(fromBiome: string, toBiome: string, reason: string) {
    super(
      `Failed to create transition from "${fromBiome}" to "${toBiome}": ${reason}`,
      'BIOME_TRANSITION_FAILED',
      { fromBiome, toBiome, reason },
      true
    );
    this.name = 'BiomeTransitionError';
  }
}

export class FoliageScatterError extends AegisError {
  constructor(layerId: string, reason: string, instanceCount?: number) {
    super(
      `Foliage scattering failed for layer "${layerId}": ${reason}`,
      'FOLIAGE_SCATTER_FAILED',
      { layerId, reason, instanceCount },
      true
    );
    this.name = 'FoliageScatterError';
  }
}

export class PCGGraphError extends AegisError {
  constructor(graphPath: string, nodeId: string | undefined, reason: string) {
    super(
      `PCG graph error in "${graphPath}"${nodeId ? ` at node ${nodeId}` : ''}: ${reason}`,
      'PCG_GRAPH_ERROR',
      { graphPath, nodeId, reason },
      true
    );
    this.name = 'PCGGraphError';
  }
}

export class HeightmapExportError extends AegisError {
  constructor(format: string, reason: string) {
    super(
      `Failed to export heightmap as ${format}: ${reason}`,
      'HEIGHTMAP_EXPORT_FAILED',
      { format, reason },
      true
    );
    this.name = 'HeightmapExportError';
  }
}

export class WorldGenSeedError extends AegisError {
  constructor(seed: number, reason: string) {
    super(
      `Invalid world generation seed ${seed}: ${reason}`,
      'WORLDGEN_SEED_INVALID',
      { seed, reason },
      true
    );
    this.name = 'WorldGenSeedError';
  }
}

export class AssetResolutionError extends AegisError {
  constructor(assetPath: string, assetType: string) {
    super(
      `Failed to resolve ${assetType} asset: ${assetPath}`,
      'ASSET_RESOLUTION_FAILED',
      { assetPath, assetType },
      true
    );
    this.name = 'AssetResolutionError';
  }
}
```

### Terrain Schemas (src/plugins/worldgen/schemas/terrain-schemas.ts)

```typescript
import { z } from 'zod';

export const Vector2DSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const Vector3DSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const BoundingBox2DSchema = z.object({
  min: Vector2DSchema,
  max: Vector2DSchema,
});

export const BoundingBox3DSchema = z.object({
  min: Vector3DSchema,
  max: Vector3DSchema,
});

export const NoiseTypeSchema = z.enum(['perlin', 'simplex', 'worley', 'value', 'fractal', 'ridged']);

export const NoiseLayerSchema = z.object({
  type: NoiseTypeSchema.describe('Type of noise algorithm'),
  frequency: z.number().positive().default(1.0).describe('Base frequency of the noise'),
  amplitude: z.number().positive().default(1.0).describe('Height multiplier'),
  octaves: z.number().int().min(1).max(16).default(4).describe('Number of noise octaves'),
  persistence: z.number().min(0).max(1).default(0.5).describe('Amplitude decay per octave'),
  lacunarity: z.number().min(1).max(4).default(2.0).describe('Frequency multiplier per octave'),
  offset: Vector2DSchema.default({ x: 0, y: 0 }).describe('Noise offset for variation'),
  seed: z.number().int().default(0).describe('Random seed for this layer'),
});

export const ErosionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  iterations: z.number().int().min(1000).max(1000000).default(50000),
  dropletLifetime: z.number().int().min(10).max(100).default(30),
  sedimentCapacity: z.number().min(1).max(20).default(4),
  depositionRate: z.number().min(0).max(1).default(0.3),
  erosionRate: z.number().min(0).max(1).default(0.3),
  evaporationRate: z.number().min(0).max(1).default(0.01),
  gravity: z.number().min(1).max(20).default(4),
  startSpeed: z.number().min(0).max(5).default(1),
  startWater: z.number().min(0).max(5).default(1),
});

export const GenerateHeightmapSchema = z.object({
  resolution: z.object({
    width: z.number().int().min(64).max(8192).default(1024),
    height: z.number().int().min(64).max(8192).default(1024),
  }).describe('Heightmap pixel resolution'),
  worldSize: z.object({
    width: z.number().positive().default(100000).describe('World width in UE units (cm)'),
    height: z.number().positive().default(100000).describe('World height in UE units (cm)'),
  }),
  heightRange: z.object({
    min: z.number().default(-50000).describe('Minimum terrain height'),
    max: z.number().default(50000).describe('Maximum terrain height'),
  }),
  noiseLayers: z.array(NoiseLayerSchema).min(1).max(16).describe('Noise layers for terrain generation'),
  erosion: ErosionConfigSchema.optional(),
  seed: z.number().int().default(42).describe('Master random seed'),
  outputPath: z.string().optional().describe('Path to save the heightmap (optional)'),
  applyToLandscape: z.boolean().default(false).describe('Apply directly to active landscape'),
  landscapeTarget: z.string().optional().describe('Specific landscape actor to target'),
});

export const ModifyTerrainRegionSchema = z.object({
  landscapeTarget: z.string().describe('Path to the landscape actor'),
  region: BoundingBox2DSchema.describe('Region to modify in world coordinates'),
  operation: z.enum(['raise', 'lower', 'flatten', 'smooth', 'noise', 'stamp']),
  intensity: z.number().min(0).max(1).default(0.5),
  falloff: z.enum(['linear', 'smooth', 'spherical', 'tip', 'none']).default('smooth'),
  brushSize: z.number().positive().optional(),
  noiseConfig: NoiseLayerSchema.optional().describe('Noise config for "noise" operation'),
  stampHeightmap: z.string().optional().describe('Heightmap path for "stamp" operation'),
  stampBlendMode: z.enum(['replace', 'add', 'multiply', 'min', 'max']).optional(),
});

export const CreateLandscapeSchema = z.object({
  name: z.string().default('Landscape'),
  location: Vector3DSchema.default({ x: 0, y: 0, z: 0 }),
  componentsX: z.number().int().min(1).max(32).default(8),
  componentsY: z.number().int().min(1).max(32).default(8),
  sectionsPerComponent: z.number().int().refine(val => [1, 2].includes(val)).default(2),
  quadsPerSection: z.number().int().refine(val => [7, 15, 31, 63, 127, 255].includes(val)).default(63),
  scaleX: z.number().positive().default(100),
  scaleY: z.number().positive().default(100),
  scaleZ: z.number().positive().default(100),
  materialPath: z.string().optional(),
  heightmapPath: z.string().optional().describe('Import heightmap on creation'),
  folder: z.string().optional(),
});

export const ImportHeightmapSchema = z.object({
  landscapeTarget: z.string().describe('Path to the target landscape'),
  heightmapPath: z.string().describe('Path to the heightmap file'),
  format: z.enum(['raw16', 'png16', 'r32', 'auto']).default('auto'),
  heightScale: z.number().positive().default(1.0),
  heightOffset: z.number().default(0),
  flipY: z.boolean().default(false),
});

export const QueryTerrainSchema = z.object({
  landscapeTarget: z.string().optional().describe('Specific landscape to query'),
  samplePoints: z.array(Vector2DSchema).optional().describe('Get height at specific XY points'),
  bounds: BoundingBox2DSchema.optional().describe('Query region bounds'),
  includeNormals: z.boolean().default(false),
  includeLayerWeights: z.boolean().default(false),
});
```

### Biome Schemas (src/plugins/worldgen/schemas/biome-schemas.ts)

```typescript
import { z } from 'zod';
import { Vector3DSchema, BoundingBox3DSchema } from './terrain-schemas';

export const BiomeConditionsSchema = z.object({
  heightRange: z.object({
    min: z.number().describe('Minimum height for this biome'),
    max: z.number().describe('Maximum height for this biome'),
  }),
  slopeRange: z.object({
    min: z.number().min(0).max(90).default(0).describe('Minimum slope in degrees'),
    max: z.number().min(0).max(90).default(90).describe('Maximum slope in degrees'),
  }),
  moistureRange: z.object({
    min: z.number().min(0).max(1).default(0),
    max: z.number().min(0).max(1).default(1),
  }),
  temperatureRange: z.object({
    min: z.number().min(-50).max(50).default(-50),
    max: z.number().min(-50).max(50).default(50),
  }),
});

export const BiomeDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/).describe('Unique biome identifier'),
  name: z.string().min(1).max(64).describe('Display name'),
  displayColor: z.object({
    r: z.number().min(0).max(255),
    g: z.number().min(0).max(255),
    b: z.number().min(0).max(255),
  }).describe('Color for visualization'),
  conditions: BiomeConditionsSchema,
  foliageLayers: z.array(z.string()).default([]).describe('Foliage layer IDs for this biome'),
  groundMaterial: z.string().describe('Material asset path'),
  ambientSound: z.string().optional().describe('Ambient sound asset path'),
  weatherProfile: z.string().optional().describe('Weather profile ID'),
  priority: z.number().int().min(0).max(100).default(50).describe('Priority for overlapping conditions'),
});

export const BiomeTransitionSchema = z.object({
  fromBiome: z.string().describe('Source biome ID'),
  toBiome: z.string().describe('Target biome ID'),
  blendWidth: z.number().positive().default(1000).describe('Transition width in UE units'),
  blendCurve: z.enum(['linear', 'smooth', 'sharp']).default('smooth'),
  transitionAssets: z.array(z.string()).optional().describe('Assets to spawn in transition zones'),
});

export const CreateBiomeSystemSchema = z.object({
  name: z.string().default('BiomeSystem').describe('Name for the biome system'),
  biomes: z.array(BiomeDefinitionSchema).min(1).describe('List of biome definitions'),
  transitions: z.array(BiomeTransitionSchema).optional().describe('Biome transition rules'),
  moistureMapPath: z.string().optional().describe('Path to moisture map texture'),
  temperatureMapPath: z.string().optional().describe('Path to temperature map texture'),
  generateMaps: z.boolean().default(true).describe('Auto-generate moisture/temp maps from noise'),
  moistureNoiseConfig: z.object({
    seed: z.number().int().default(12345),
    frequency: z.number().positive().default(0.0001),
    octaves: z.number().int().min(1).max(8).default(4),
  }).optional(),
  temperatureNoiseConfig: z.object({
    seed: z.number().int().default(54321),
    frequency: z.number().positive().default(0.00005),
    octaves: z.number().int().min(1).max(8).default(3),
    latitudeInfluence: z.number().min(0).max(1).default(0.5),
  }).optional(),
});

export const ApplyBiomesToLandscapeSchema = z.object({
  biomeSystemId: z.string().describe('ID of the biome system to apply'),
  landscapeTarget: z.string().describe('Path to target landscape'),
  bounds: BoundingBox3DSchema.optional().describe('Region to apply biomes to'),
  updateMaterials: z.boolean().default(true).describe('Update landscape layer materials'),
  spawnFoliage: z.boolean().default(true).describe('Spawn biome foliage'),
  generateBiomeMap: z.boolean().default(true).describe('Output biome visualization map'),
  outputPath: z.string().optional().describe('Path for biome map export'),
});

export const QueryBiomeAtLocationSchema = z.object({
  location: Vector3DSchema.describe('World location to query'),
  biomeSystemId: z.string().optional().describe('Specific biome system to query'),
  includeConditions: z.boolean().default(false).describe('Include condition values'),
  includeNeighbors: z.boolean().default(false).describe('Include neighboring biomes'),
});

export const ModifyBiomeSchema = z.object({
  biomeSystemId: z.string().describe('ID of the biome system'),
  biomeId: z.string().describe('ID of the biome to modify'),
  updates: z.object({
    name: z.string().optional(),
    displayColor: z.object({
      r: z.number().min(0).max(255),
      g: z.number().min(0).max(255),
      b: z.number().min(0).max(255),
    }).optional(),
    conditions: BiomeConditionsSchema.partial().optional(),
    foliageLayers: z.array(z.string()).optional(),
    groundMaterial: z.string().optional(),
    priority: z.number().int().min(0).max(100).optional(),
  }).describe('Fields to update'),
});

export const GenerateBiomePreviewSchema = z.object({
  biomeSystemId: z.string().describe('ID of the biome system'),
  resolution: z.object({
    width: z.number().int().min(64).max(2048).default(512),
    height: z.number().int().min(64).max(2048).default(512),
  }),
  bounds: BoundingBox3DSchema.optional(),
  outputPath: z.string().describe('Path to save preview image'),
  overlayType: z.enum(['biome', 'moisture', 'temperature', 'slope', 'height']).default('biome'),
});
```

### Foliage Schemas (src/plugins/worldgen/schemas/foliage-schemas.ts)

```typescript
import { z } from 'zod';
import { Vector3DSchema, BoundingBox3DSchema } from './terrain-schemas';

export const PlacementRulesSchema = z.object({
  minSlope: z.number().min(0).max(90).default(0).describe('Minimum slope in degrees'),
  maxSlope: z.number().min(0).max(90).default(45).describe('Maximum slope in degrees'),
  minHeight: z.number().default(-100000).describe('Minimum placement height'),
  maxHeight: z.number().default(100000).describe('Maximum placement height'),
  avoidWater: z.boolean().default(true),
  avoidPaths: z.boolean().default(true),
  minDistanceFromOthers: z.number().min(0).default(50).describe('Minimum spacing in UE units'),
  clusteringFactor: z.number().min(0).max(1).default(0).describe('0 = uniform, 1 = clustered'),
  biomeRestrictions: z.array(z.string()).optional().describe('Only spawn in these biomes'),
});

export const FoliageLayerSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/).describe('Unique layer identifier'),
  name: z.string().min(1).max(64).describe('Display name'),
  meshAsset: z.string().describe('Static mesh asset path'),
  density: z.number().min(0).max(100000).default(1000).describe('Instances per 10,000 sq units'),
  scaleRange: z.object({
    min: Vector3DSchema.default({ x: 0.8, y: 0.8, z: 0.8 }),
    max: Vector3DSchema.default({ x: 1.2, y: 1.2, z: 1.2 }),
  }),
  rotationRange: z.object({
    min: Vector3DSchema.default({ x: 0, y: 0, z: 0 }),
    max: Vector3DSchema.default({ x: 0, y: 0, z: 360 }),
  }),
  alignToSurface: z.boolean().default(true).describe('Align mesh to terrain normal'),
  randomYaw: z.boolean().default(true).describe('Random rotation around Z axis'),
  cullDistance: z.object({
    start: z.number().min(0).default(10000).describe('Distance to start fading'),
    end: z.number().min(0).default(15000).describe('Distance to fully cull'),
  }),
  collisionEnabled: z.boolean().default(false),
  castShadows: z.boolean().default(true),
  placementRules: PlacementRulesSchema,
});

export const CreateFoliageTypeSchema = z.object({
  layer: FoliageLayerSchema,
  addToExistingFoliage: z.boolean().default(true).describe('Add to InstancedFoliageActor'),
  createNewActor: z.boolean().default(false).describe('Create new actor for this layer'),
});

export const ScatterFoliageSchema = z.object({
  layers: z.array(z.string()).min(1).describe('Layer IDs to scatter'),
  bounds: BoundingBox3DSchema.describe('Region to scatter foliage'),
  seed: z.number().int().default(42).describe('Random seed for reproducibility'),
  landscapeTarget: z.string().optional().describe('Target landscape for height sampling'),
  biomeSystemId: z.string().optional().describe('Biome system for placement rules'),
  previewOnly: z.boolean().default(false).describe('Generate preview without spawning'),
  maxInstancesPerLayer: z.number().int().positive().default(100000).describe('Instance limit per layer'),
  batchSize: z.number().int().min(100).max(10000).default(1000).describe('Instances per batch'),
});

export const ModifyFoliageLayerSchema = z.object({
  layerId: z.string().describe('Layer ID to modify'),
  updates: z.object({
    name: z.string().optional(),
    meshAsset: z.string().optional(),
    density: z.number().min(0).max(100000).optional(),
    scaleRange: z.object({
      min: Vector3DSchema.optional(),
      max: Vector3DSchema.optional(),
    }).optional(),
    cullDistance: z.object({
      start: z.number().min(0).optional(),
      end: z.number().min(0).optional(),
    }).optional(),
    placementRules: PlacementRulesSchema.partial().optional(),
  }).describe('Fields to update'),
});

export const ClearFoliageSchema = z.object({
  layers: z.array(z.string()).optional().describe('Specific layers to clear (all if empty)'),
  bounds: BoundingBox3DSchema.optional().describe('Region to clear (all if empty)'),
  biomes: z.array(z.string()).optional().describe('Only clear in these biomes'),
});

export const QueryFoliageSchema = z.object({
  layers: z.array(z.string()).optional().describe('Filter by layer IDs'),
  bounds: BoundingBox3DSchema.optional().describe('Query region'),
  includeTransforms: z.boolean().default(false).describe('Include instance transforms'),
  maxResults: z.number().int().min(1).max(100000).default(10000),
});
```

### PCG Integration Schemas (src/plugins/worldgen/schemas/pcg-schemas.ts)

```typescript
import { z } from 'zod';
import { Vector3DSchema, BoundingBox3DSchema } from './terrain-schemas';

export const PCGExecutionModeSchema = z.enum(['immediate', 'deferred', 'streaming']);

export const PCGPinConnectionSchema = z.object({
  fromNode: z.string().describe('Source node name'),
  fromPin: z.string().describe('Source pin name'),
  toPin: z.string().describe('Destination pin name'),
});

export const PCGNodeConfigSchema = z.object({
  nodeType: z.string().describe('PCG node class name (e.g., "PCGSurfaceSamplerSettings")'),
  nodeName: z.string().describe('Unique name for this node instance'),
  parameters: z.record(z.unknown()).describe('Node-specific parameters'),
  inputConnections: z.array(PCGPinConnectionSchema).optional(),
});

export const CreatePCGGraphSchema = z.object({
  graphName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).describe('Name for the PCG graph asset'),
  savePath: z.string().default('/Game/PCG/').describe('Asset save location'),
  nodes: z.array(PCGNodeConfigSchema).min(1).describe('Graph nodes to create'),
  graphSettings: z.object({
    isHierarchical: z.boolean().default(false),
    use2DGrid: z.boolean().default(false),
    gridSize: z.number().positive().default(10000),
    seed: z.number().int().optional(),
  }).optional(),
  description: z.string().optional(),
});

export const ExecutePCGGraphSchema = z.object({
  graphPath: z.string().describe('Path to the PCG graph asset'),
  targetActor: z.string().optional().describe('Actor with PCG component to execute'),
  inputPins: z.record(z.unknown()).optional().describe('Override input pin values'),
  seed: z.number().int().optional().describe('Override graph seed'),
  bounds: BoundingBox3DSchema.optional().describe('Generation bounds'),
  executionMode: PCGExecutionModeSchema.default('immediate'),
  generateCollision: z.boolean().default(true),
  generateNavigation: z.boolean().default(false),
});

export const CreatePCGComponentSchema = z.object({
  actorPath: z.string().describe('Actor to add PCG component to'),
  graphPath: z.string().describe('PCG graph to assign'),
  generateOnLoad: z.boolean().default(false),
  generateOnConstruction: z.boolean().default(true),
  partitionGridSize: z.number().positive().default(25600),
  generateOnBoundsChange: z.boolean().default(true),
});

export const ModifyPCGGraphSchema = z.object({
  graphPath: z.string().describe('Path to the PCG graph'),
  addNodes: z.array(PCGNodeConfigSchema).optional(),
  removeNodes: z.array(z.string()).optional().describe('Node names to remove'),
  updateNodes: z.array(z.object({
    nodeName: z.string(),
    parameters: z.record(z.unknown()),
  })).optional(),
  addConnections: z.array(z.object({
    fromNode: z.string(),
    fromPin: z.string(),
    toNode: z.string(),
    toPin: z.string(),
  })).optional(),
  removeConnections: z.array(z.object({
    fromNode: z.string(),
    fromPin: z.string(),
    toNode: z.string(),
    toPin: z.string(),
  })).optional(),
});

export const QueryPCGGraphSchema = z.object({
  graphPath: z.string().describe('Path to the PCG graph'),
  includeNodes: z.boolean().default(true),
  includeConnections: z.boolean().default(true),
  includeSettings: z.boolean().default(true),
});

export const CleanupPCGGenerationSchema = z.object({
  actorPath: z.string().optional().describe('Specific actor to clean up'),
  bounds: BoundingBox3DSchema.optional().describe('Region to clean up'),
  clearAllManaged: z.boolean().default(false),
});
```

### Export Schemas (src/plugins/worldgen/schemas/export-schemas.ts)

```typescript
import { z } from 'zod';
import { BoundingBox3DSchema } from './terrain-schemas';

export const ExportFormatSchema = z.enum(['raw16', 'png16', 'exr', 'r32']);

export const CompressionTypeSchema = z.enum(['none', 'zip', 'lz4']);

export const ExportHeightmapSchema = z.object({
  landscapeTarget: z.string().describe('Path to landscape actor'),
  format: ExportFormatSchema.default('raw16'),
  outputPath: z.string().describe('Export file path'),
  bounds: BoundingBox3DSchema.optional().describe('Export specific region'),
  resolution: z.object({
    width: z.number().int().min(64).max(8192).optional(),
    height: z.number().int().min(64).max(8192).optional(),
  }).optional().describe('Resample to specific resolution'),
  includeMetadata: z.boolean().default(true).describe('Export .json metadata file'),
  compression: CompressionTypeSchema.default('none'),
});

export const ExportWeightmapsSchema = z.object({
  landscapeTarget: z.string().describe('Path to landscape actor'),
  layers: z.array(z.string()).optional().describe('Specific layers to export (all if empty)'),
  format: z.enum(['png8', 'png16', 'raw8']).default('png8'),
  outputDirectory: z.string().describe('Output directory path'),
  bounds: BoundingBox3DSchema.optional(),
  includeMetadata: z.boolean().default(true),
});

export const ExportBiomeMapSchema = z.object({
  biomeSystemId: z.string().describe('Biome system ID'),
  format: z.enum(['png', 'json', 'both']).default('png'),
  outputPath: z.string().describe('Export file path'),
  resolution: z.object({
    width: z.number().int().min(64).max(4096).default(1024),
    height: z.number().int().min(64).max(4096).default(1024),
  }),
  bounds: BoundingBox3DSchema.optional(),
  includeTransitionZones: z.boolean().default(true),
});

export const ExportFoliageDataSchema = z.object({
  layers: z.array(z.string()).optional().describe('Layers to export'),
  format: z.enum(['json', 'csv', 'binary']).default('json'),
  outputPath: z.string().describe('Export file path'),
  bounds: BoundingBox3DSchema.optional(),
  includeTransforms: z.boolean().default(true),
  includeMetadata: z.boolean().default(true),
  compression: CompressionTypeSchema.default('none'),
});

export const ExportWorldGenPackageSchema = z.object({
  packageName: z.string().describe('Name for the export package'),
  outputDirectory: z.string().describe('Output directory path'),
  includeHeightmap: z.boolean().default(true),
  includeWeightmaps: z.boolean().default(true),
  includeBiomeData: z.boolean().default(true),
  includeFoliageData: z.boolean().default(true),
  includePCGGraphs: z.boolean().default(true),
  includePresets: z.boolean().default(true),
  compressionType: CompressionTypeSchema.default('zip'),
  generateReadme: z.boolean().default(true),
});

export const ImportWorldGenPackageSchema = z.object({
  packagePath: z.string().describe('Path to import package'),
  targetDirectory: z.string().default('/Game/WorldGen/').describe('Import destination'),
  overwriteExisting: z.boolean().default(false),
  importHeightmap: z.boolean().default(true),
  importWeightmaps: z.boolean().default(true),
  importBiomeData: z.boolean().default(true),
  importFoliageData: z.boolean().default(true),
  importPCGGraphs: z.boolean().default(true),
  applyToLandscape: z.string().optional().describe('Apply heightmap to this landscape'),
});
```

### Noise Generator (src/plugins/worldgen/generators/noise-generator.ts)

```typescript
import { NoiseLayer, NoiseType } from '../types/worldgen-types';
import { WorldGenSeedError } from '../errors';

export class NoiseGenerator {
  private permutation: number[];
  private seed: number;

  constructor(seed: number = 0) {
    if (!Number.isInteger(seed) || seed < 0) {
      throw new WorldGenSeedError(seed, 'Seed must be a non-negative integer');
    }
    this.seed = seed;
    this.permutation = this.generatePermutation(seed);
  }

  private generatePermutation(seed: number): number[] {
    const p: number[] = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    
    let rng = this.mulberry32(seed);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    
    return [...p, ...p];
  }

  private mulberry32(seed: number): () => number {
    return () => {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad2D(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }

  perlin2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    
    x -= Math.floor(x);
    y -= Math.floor(y);
    
    const u = this.fade(x);
    const v = this.fade(y);
    
    const p = this.permutation;
    const A = p[X] + Y;
    const B = p[X + 1] + Y;
    
    return this.lerp(
      this.lerp(this.grad2D(p[A], x, y), this.grad2D(p[B], x - 1, y), u),
      this.lerp(this.grad2D(p[A + 1], x, y - 1), this.grad2D(p[B + 1], x - 1, y - 1), u),
      v
    );
  }

  simplex2D(x: number, y: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    
    const ii = i & 255;
    const jj = j & 255;
    
    const p = this.permutation;
    const gi0 = p[ii + p[jj]] % 12;
    const gi1 = p[ii + i1 + p[jj + j1]] % 12;
    const gi2 = p[ii + 1 + p[jj + 1]] % 12;
    
    const grad3 = [
      [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
      [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
      [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
    ];
    
    let n0 = 0, n1 = 0, n2 = 0;
    
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0][0] * x0 + grad3[gi0][1] * y0);
    }
    
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1][0] * x1 + grad3[gi1][1] * y1);
    }
    
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2][0] * x2 + grad3[gi2][1] * y2);
    }
    
    return 70 * (n0 + n1 + n2);
  }

  worley2D(x: number, y: number, numPoints: number = 5): number {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    let minDist = Infinity;
    
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cx = cellX + dx;
        const cy = cellY + dy;
        const cellRng = this.mulberry32(this.seed + cx * 374761393 + cy * 668265263);
        
        for (let i = 0; i < numPoints; i++) {
          const px = cx + cellRng();
          const py = cy + cellRng();
          const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
          minDist = Math.min(minDist, dist);
        }
      }
    }
    
    return minDist;
  }

  fractalNoise(x: number, y: number, layer: NoiseLayer): number {
    let value = 0;
    let amplitude = layer.amplitude;
    let frequency = layer.frequency;
    let maxValue = 0;
    
    const getBaseNoise = (px: number, py: number): number => {
      switch (layer.type) {
        case 'perlin': return this.perlin2D(px, py);
        case 'simplex': return this.simplex2D(px, py);
        case 'worley': return this.worley2D(px, py);
        case 'value': return this.perlin2D(px, py);
        case 'ridged': return 1 - Math.abs(this.perlin2D(px, py));
        default: return this.perlin2D(px, py);
      }
    };
    
    for (let i = 0; i < layer.octaves; i++) {
      const sampleX = (x + layer.offset.x) * frequency;
      const sampleY = (y + layer.offset.y) * frequency;
      
      value += getBaseNoise(sampleX, sampleY) * amplitude;
      maxValue += amplitude;
      
      amplitude *= layer.persistence;
      frequency *= layer.lacunarity;
    }
    
    return value / maxValue;
  }

  generateNoiseMap(width: number, height: number, layers: NoiseLayer[]): Float32Array {
    const map = new Float32Array(width * height);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = 0;
        
        for (const layer of layers) {
          const layerGenerator = new NoiseGenerator(layer.seed || this.seed);
          value += layerGenerator.fractalNoise(x / width, y / height, layer);
        }
        
        map[y * width + x] = (value + 1) / 2;
      }
    }
    
    return map;
  }
}
```

-----

## 🎮 UE5 C++ Headers

### Phase 7: WorldGen Subsystem Headers

#### AegisWorldGenSubsystem.h

```cpp
// aegis/ue-plugin/Source/AegisRuntime/Public/AegisWorldGenSubsystem.h

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "AegisWorldGenSubsystem.generated.h"

USTRUCT(BlueprintType)
struct FAegisNoiseLayer
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString NoiseType = TEXT("perlin");

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float Frequency = 1.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float Amplitude = 1.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Octaves = 4;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float Persistence = 0.5f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float Lacunarity = 2.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FVector2D Offset = FVector2D::ZeroVector;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Seed = 0;
};

USTRUCT(BlueprintType)
struct FAegisBiomeConditions
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FVector2D HeightRange = FVector2D(-50000, 50000);

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FVector2D SlopeRange = FVector2D(0, 90);

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FVector2D MoistureRange = FVector2D(0, 1);

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FVector2D TemperatureRange = FVector2D(-50, 50);
};

USTRUCT(BlueprintType)
struct FAegisBiomeDefinition
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString BiomeId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString DisplayName;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FColor DisplayColor = FColor::Green;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FAegisBiomeConditions Conditions;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TArray<FString> FoliageLayers;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TSoftObjectPtr<UMaterialInterface> GroundMaterial;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Priority = 50;
};

USTRUCT(BlueprintType)
struct FAegisFoliageLayer
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString LayerId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TSoftObjectPtr<UStaticMesh> Mesh;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float Density = 1000.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FVector ScaleMin = FVector(0.8f);

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FVector ScaleMax = FVector(1.2f);

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    bool bAlignToSurface = true;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    bool bRandomYaw = true;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float MinSlope = 0.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float MaxSlope = 45.0f;
};

USTRUCT(BlueprintType)
struct FAegisWorldGenResult
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    bool bSuccess = false;

    UPROPERTY(BlueprintReadOnly)
    FString HeightmapPath;

    UPROPERTY(BlueprintReadOnly)
    int32 FoliageInstanceCount = 0;

    UPROPERTY(BlueprintReadOnly)
    float ExecutionTimeMs = 0.0f;

    UPROPERTY(BlueprintReadOnly)
    TArray<FString> Warnings;
};

UCLASS()
class AEGISRUNTIME_API UAegisWorldGenSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    // Terrain Generation
    UFUNCTION(BlueprintCallable, Category = "AEGIS|WorldGen|Terrain")
    FAegisWorldGenResult GenerateHeightmap(
        FIntPoint Resolution,
        const TArray<FAegisNoiseLayer>& NoiseLayers,
        int32 Seed = 42
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|WorldGen|Terrain")
    bool ApplyHeightmapToLandscape(
        ALandscape* Landscape,
        const TArray<float>& HeightData,
        FIntPoint Resolution
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|WorldGen|Terrain")
    TArray<float> QueryTerrainHeights(
        ALandscape* Landscape,
        const TArray<FVector2D>& SamplePoints
    );

    // Biome System
    UFUNCTION(BlueprintCallable, Category = "AEGIS|WorldGen|Biome")
    bool CreateBiomeSystem(
        const FString& SystemName,
        const TArray<FAegisBiomeDefinition>& Biomes
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|WorldGen|Biome")
    FString GetBiomeAtLocation(const FVector& WorldLocation);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|WorldGen|Biome")
    bool ApplyBiomesToLandscape(
        const FString& BiomeSystemId,
        ALandscape* Landscape
    );

    // Foliage Scattering
    UFUNCTION(BlueprintCallable, Category = "AEGIS|WorldGen|Foliage")
    int32 ScatterFoliageLayer(
        const FAegisFoliageLayer& Layer,
        const FBox& Bounds,
        int32 Seed = 42
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|WorldGen|Foliage")
    bool ClearFoliage(
        const TArray<FString>& LayerIds,
        const FBox& Bounds
    );

    // PCG Integration
    UFUNCTION(BlueprintCallable, Category = "AEGIS|WorldGen|PCG")
    bool ExecutePCGGraph(
        const FString& GraphPath,
        AActor* TargetActor,
        int32 Seed = -1
    );

private:
    // Noise generation helpers
    float SamplePerlinNoise(float X, float Y, const FAegisNoiseLayer& Layer);
    float SampleSimplexNoise(float X, float Y, const FAegisNoiseLayer& Layer);
    float SampleWorleyNoise(float X, float Y, const FAegisNoiseLayer& Layer);

    // Biome storage
    TMap<FString, TArray<FAegisBiomeDefinition>> BiomeSystems;

    // Foliage layer storage
    TMap<FString, FAegisFoliageLayer> FoliageLayers;
};
```

### Phase 8: Runtime AI Headers

#### AegisAIExecutionLayer.h

```cpp
// aegis/ue-plugin/Source/AegisRuntime/Public/AegisAIExecutionLayer.h

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "BehaviorTree/BehaviorTree.h"
#include "AegisAIExecutionLayer.generated.h"

UENUM(BlueprintType)
enum class EAegisInferenceMode : uint8
{
    LocalONNX,
    CloudAPI,
    Hybrid,
    RuleBased
};

USTRUCT(BlueprintType)
struct FAegisDecisionContext
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString EntityId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TMap<FString, FString> WorldState;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TMap<FString, FString> Blackboard;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString CurrentBehavior;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float Timestamp = 0.0f;
};

USTRUCT(BlueprintType)
struct FAegisDecisionResult
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FString Action;

    UPROPERTY(BlueprintReadOnly)
    FString Target;

    UPROPERTY(BlueprintReadOnly)
    float Confidence = 0.0f;

    UPROPERTY(BlueprintReadOnly)
    TArray<FString> Reasoning;

    UPROPERTY(BlueprintReadOnly)
    float DecisionTimeMs = 0.0f;
};

USTRUCT(BlueprintType)
struct FAegisPerformanceBudget
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float TotalBudgetMs = 16.67f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float ONNXBudgetMs = 5.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float BehaviorTreeBudgetMs = 3.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float StateMachineBudgetMs = 2.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    float DecisionPipelineBudgetMs = 5.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    bool bAdaptiveBudgeting = true;
};

USTRUCT(BlueprintType)
struct FAegisAIStrategy
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString StrategyId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString StrategyName;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Priority = 50;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TSoftObjectPtr<UBehaviorTree> BehaviorTree;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString FallbackStrategyId;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnStrategySwapped, const FString&, EntityId, const FString&, NewStrategyId);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBudgetExceeded, const FString&, Component, float, ActualMs);

UCLASS()
class AEGISRUNTIME_API UAegisAIExecutionLayer : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;
    virtual void Tick(float DeltaTime);

    // Decision Pipeline
    UFUNCTION(BlueprintCallable, Category = "AEGIS|AI|Decision")
    FAegisDecisionResult ExecuteDecision(
        const FString& PipelineId,
        const FAegisDecisionContext& Context,
        EAegisInferenceMode ForceMode = EAegisInferenceMode::Hybrid
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|AI|Decision")
    bool CreateDecisionPipeline(
        const FString& PipelineId,
        const FString& Name,
        EAegisInferenceMode PreferredMode
    );

    // Strategy Management
    UFUNCTION(BlueprintCallable, Category = "AEGIS|AI|Strategy")
    bool RegisterStrategy(const FAegisAIStrategy& Strategy);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|AI|Strategy")
    bool SwapStrategy(
        const FString& EntityId,
        const FString& NewStrategyId,
        bool bImmediate = false,
        bool bPreserveState = true
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|AI|Strategy")
    FString GetActiveStrategy(const FString& EntityId) const;

    // Performance Budget
    UFUNCTION(BlueprintCallable, Category = "AEGIS|AI|Performance")
    void SetPerformanceBudget(const FAegisPerformanceBudget& Budget);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|AI|Performance")
    FAegisPerformanceBudget GetPerformanceBudget() const;

    UFUNCTION(BlueprintCallable, Category = "AEGIS|AI|Performance")
    bool CheckBudget(const FString& Component) const;

    // Events
    UPROPERTY(BlueprintAssignable, Category = "AEGIS|AI|Events")
    FOnStrategySwapped OnStrategySwapped;

    UPROPERTY(BlueprintAssignable, Category = "AEGIS|AI|Events")
    FOnBudgetExceeded OnBudgetExceeded;

private:
    // Performance tracking
    void BeginFrame();
    void EndFrame();
    void RecordComponentTime(const FString& Component, float TimeMs);

    // Registered strategies
    TMap<FString, FAegisAIStrategy> RegisteredStrategies;

    // Active strategies per entity
    TMap<FString, FString> EntityStrategies;

    // Performance budget
    FAegisPerformanceBudget CurrentBudget;

    // Frame timing
    double FrameStartTime = 0.0;
    TMap<FString, float> ComponentTimes;

    // Statistics
    TArray<float> FrameTimeHistory;
    int32 BudgetExceededCount = 0;
};
```

#### AegisONNXRunner.h

```cpp
// aegis/ue-plugin/Source/AegisRuntime/Public/AegisONNXRunner.h

#pragma once

#include "CoreMinimal.h"
#include "AegisONNXRunner.generated.h"

// Forward declarations for ONNX Runtime types
namespace Ort
{
    struct Session;
    struct Env;
    struct SessionOptions;
}

USTRUCT(BlueprintType)
struct FAegisONNXModelConfig
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString ModelPath;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TArray<FString> InputNames;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TArray<FString> OutputNames;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString ExecutionProvider = TEXT("cpu");

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 WarmupRuns = 3;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    bool bEnableProfiling = false;
};

USTRUCT(BlueprintType)
struct FAegisONNXModelStats
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    float LoadTimeMs = 0.0f;

    UPROPERTY(BlueprintReadOnly)
    int32 TotalInferences = 0;

    UPROPERTY(BlueprintReadOnly)
    float AverageInferenceTimeMs = 0.0f;

    UPROPERTY(BlueprintReadOnly)
    float LastInferenceTimeMs = 0.0f;

    UPROPERTY(BlueprintReadOnly)
    int64 PeakMemoryBytes = 0;
};

UCLASS()
class AEGISRUNTIME_API UAegisONNXRunner : public UObject
{
    GENERATED_BODY()

public:
    UAegisONNXRunner();
    virtual ~UAegisONNXRunner();

    UFUNCTION(BlueprintCallable, Category = "AEGIS|ONNX")
    bool LoadModel(const FString& ModelId, const FAegisONNXModelConfig& Config);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|ONNX")
    bool UnloadModel(const FString& ModelId);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|ONNX")
    bool IsModelLoaded(const FString& ModelId) const;

    UFUNCTION(BlueprintCallable, Category = "AEGIS|ONNX")
    TArray<float> RunInference(
        const FString& ModelId,
        const TMap<FString, TArray<float>>& Inputs
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|ONNX")
    FAegisONNXModelStats GetModelStats(const FString& ModelId) const;

    UFUNCTION(BlueprintCallable, Category = "AEGIS|ONNX")
    TArray<FString> GetLoadedModelIds() const;

private:
    // ONNX Runtime environment (shared across all models)
    TUniquePtr<Ort::Env> OrtEnvironment;

    // Loaded model sessions
    struct FLoadedModel
    {
        TUniquePtr<Ort::Session> Session;
        FAegisONNXModelConfig Config;
        FAegisONNXModelStats Stats;
    };
    TMap<FString, TSharedPtr<FLoadedModel>> LoadedModels;

    // Helper functions
    void InitializeEnvironment();
    bool ValidateModelIO(Ort::Session* Session, const FAegisONNXModelConfig& Config);
    void PerformWarmup(const FString& ModelId, int32 Runs);
};
```

#### AegisBehaviorTreeConverter.h

```cpp
// aegis/ue-plugin/Source/AegisRuntime/Public/AegisBehaviorTreeConverter.h

#pragma once

#include "CoreMinimal.h"
#include "BehaviorTree/BehaviorTree.h"
#include "BehaviorTree/BTCompositeNode.h"
#include "BehaviorTree/BTTaskNode.h"
#include "BehaviorTree/BTDecorator.h"
#include "AegisBehaviorTreeConverter.generated.h"

USTRUCT(BlueprintType)
struct FAegisBTNodeDefinition
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString NodeId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString NodeType; // selector, sequence, parallel, task, condition, etc.

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString NodeName;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString TaskClass;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString DecoratorType;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TMap<FString, FString> Parameters;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TArray<FString> BlackboardKeys;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TArray<FAegisBTNodeDefinition> Children;
};

USTRUCT(BlueprintType)
struct FAegisBTDefinition
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString TreeId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString TreeName;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString Description;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FAegisBTNodeDefinition RootNode;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TSoftObjectPtr<UBlackboardData> BlackboardAsset;
};

USTRUCT(BlueprintType)
struct FAegisBTConversionResult
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    bool bSuccess = false;

    UPROPERTY(BlueprintReadOnly)
    FString AssetPath;

    UPROPERTY(BlueprintReadOnly)
    TArray<FString> Errors;

    UPROPERTY(BlueprintReadOnly)
    TArray<FString> Warnings;
};

UCLASS()
class AEGISRUNTIME_API UAegisBehaviorTreeConverter : public UObject
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintCallable, Category = "AEGIS|BehaviorTree")
    static FAegisBTDefinition ParseFromJSON(const FString& JSONContent, FString& OutError);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|BehaviorTree")
    static FAegisBTDefinition ParseFromYAML(const FString& YAMLContent, FString& OutError);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|BehaviorTree")
    static FAegisBTConversionResult ConvertToUEAsset(
        const FAegisBTDefinition& Definition,
        const FString& SavePath,
        bool bOverwrite = false
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|BehaviorTree")
    static bool ValidateDefinition(
        const FAegisBTDefinition& Definition,
        TArray<FString>& OutErrors
    );

private:
    static UBTCompositeNode* CreateCompositeNode(
        UBehaviorTree* Tree,
        const FAegisBTNodeDefinition& NodeDef
    );

    static UBTTaskNode* CreateTaskNode(
        UBehaviorTree* Tree,
        const FAegisBTNodeDefinition& NodeDef
    );

    static UBTDecorator* CreateDecorator(
        UBehaviorTree* Tree,
        const FAegisBTNodeDefinition& NodeDef
    );

    static TSubclassOf<UBTCompositeNode> GetCompositeClass(const FString& NodeType);
    static TSubclassOf<UBTTaskNode> GetTaskClass(const FString& TaskClass);
    static TSubclassOf<UBTDecorator> GetDecoratorClass(const FString& DecoratorType);
};
```

### Phase 9: Seed Protocol Headers

#### SeedProtocolSubsystem.h

```cpp
// aegis/ue-plugin/Source/AegisRuntime/Public/SeedProtocol/SeedProtocolSubsystem.h

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "SeedProtocolSubsystem.generated.h"

UENUM(BlueprintType)
enum class EAegisEntityType : uint8
{
    Actor,
    Component,
    Landscape,
    Foliage,
    Biome,
    PCGGraph,
    Asset,
    Custom
};

USTRUCT(BlueprintType)
struct FAegisEntityIdentity
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FGuid GUID;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    EAegisEntityType Type = EAegisEntityType::Actor;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString Name;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 CreationOrder = 0;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FGuid ParentGUID;
};

USTRUCT(BlueprintType)
struct FAegisEntityState
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FAegisEntityIdentity Identity;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FTransform Transform;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TMap<FString, FString> Properties;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Version = 0;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int64 LastModified = 0;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString Checksum;
};

USTRUCT(BlueprintType)
struct FAegisWorldStateSnapshot
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FGuid SnapshotId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString Name;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString Description;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Version = 0;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int64 Timestamp = 0;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Seed = 0;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TArray<FAegisEntityState> Entities;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString Checksum;
};

USTRUCT(BlueprintType)
struct FAegisDiffResult
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    int32 BaseVersion = 0;

    UPROPERTY(BlueprintReadOnly)
    int32 ComparedVersion = 0;

    UPROPERTY(BlueprintReadOnly)
    int32 Additions = 0;

    UPROPERTY(BlueprintReadOnly)
    int32 Modifications = 0;

    UPROPERTY(BlueprintReadOnly)
    int32 Deletions = 0;

    UPROPERTY(BlueprintReadOnly)
    bool bHasTerrainChanges = false;

    UPROPERTY(BlueprintReadOnly)
    bool bHasBiomeChanges = false;

    UPROPERTY(BlueprintReadOnly)
    bool bHasFoliageChanges = false;
};

USTRUCT(BlueprintType)
struct FAegisMergeConflict
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FGuid EntityGUID;

    UPROPERTY(BlueprintReadOnly)
    FString PropertyPath;

    UPROPERTY(BlueprintReadOnly)
    FString BaseValue;

    UPROPERTY(BlueprintReadOnly)
    FString OurValue;

    UPROPERTY(BlueprintReadOnly)
    FString TheirValue;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString Resolution; // "ours", "theirs", "manual"

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString ResolvedValue;
};

USTRUCT(BlueprintType)
struct FAegisMergeResult
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    bool bSuccess = false;

    UPROPERTY(BlueprintReadOnly)
    FAegisWorldStateSnapshot MergedState;

    UPROPERTY(BlueprintReadOnly)
    TArray<FAegisMergeConflict> Conflicts;

    UPROPERTY(BlueprintReadOnly)
    int32 ResolvedConflicts = 0;

    UPROPERTY(BlueprintReadOnly)
    int32 UnresolvedConflicts = 0;
};

UENUM(BlueprintType)
enum class EAegisSeedEventType : uint8
{
    EntityCreated,
    EntityModified,
    EntityDeleted,
    TerrainModified,
    BiomeModified,
    FoliageModified,
    PCGExecuted,
    StateCaptured,
    StateRestored,
    SyncStarted,
    SyncCompleted,
    SyncFailed
};

USTRUCT(BlueprintType)
struct FAegisSeedEvent
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FGuid EventId;

    UPROPERTY(BlueprintReadOnly)
    EAegisSeedEventType Type = EAegisSeedEventType::EntityCreated;

    UPROPERTY(BlueprintReadOnly)
    int64 Timestamp = 0;

    UPROPERTY(BlueprintReadOnly)
    FGuid EntityGUID;

    UPROPERTY(BlueprintReadOnly)
    FString CommandId;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnSeedEvent, const FAegisSeedEvent&, Event);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnStateChanged, const FGuid&, StateId, int32, Version);

UCLASS()
class AEGISRUNTIME_API USeedProtocolSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    // GUID Generation
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Identity")
    FGuid GenerateGUID(EAegisEntityType Type, const FString& Name, const FGuid& ParentGUID = FGuid());

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Identity")
    FAegisEntityIdentity LookupEntity(const FGuid& GUID) const;

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Identity")
    bool RegisterEntity(const FAegisEntityIdentity& Identity);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Identity")
    bool UnregisterEntity(const FGuid& GUID);

    // State Management
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|State")
    FAegisWorldStateSnapshot CaptureWorldState(
        const FString& Name,
        const FString& Description = TEXT(""),
        bool bIncludeTerrain = true,
        bool bIncludeBiomes = true,
        bool bIncludeFoliage = true
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|State")
    bool RestoreWorldState(
        const FGuid& StateId,
        bool bRestoreTerrain = true,
        bool bRestoreBiomes = true,
        bool bRestoreFoliage = true,
        bool bClearExisting = false
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|State")
    FAegisWorldStateSnapshot GetState(const FGuid& StateId) const;

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|State")
    TArray<FAegisWorldStateSnapshot> GetAllStates() const;

    // Diff and Merge
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Diff")
    FAegisDiffResult GenerateDiff(const FGuid& BaseStateId, const FGuid& CompareStateId);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Merge")
    FAegisMergeResult MergeStates(
        const FGuid& BaseStateId,
        const FGuid& OurStateId,
        const FGuid& TheirStateId,
        const FString& Strategy = TEXT("manual")
    );

    // Event System
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Events")
    TArray<FAegisSeedEvent> QueryEntityHistory(
        const FGuid& EntityGUID,
        int64 StartTime = 0,
        int64 EndTime = 0,
        int32 MaxEvents = 100
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Events")
    bool ReplayEvents(
        int64 FromTimestamp,
        int64 ToTimestamp = 0,
        bool bDryRun = true
    );

    // Events
    UPROPERTY(BlueprintAssignable, Category = "AEGIS|Seed|Events")
    FOnSeedEvent OnSeedEvent;

    UPROPERTY(BlueprintAssignable, Category = "AEGIS|Seed|Events")
    FOnStateChanged OnStateChanged;

private:
    // GUID generation
    FGuid GenerateDeterministicGUID(
        EAegisEntityType Type,
        const FString& Name,
        int32 CreationOrder,
        const FGuid& ParentGUID
    );

    FString ComputeChecksum(const FAegisEntityState& State);
    FString ComputeChecksum(const FAegisWorldStateSnapshot& Snapshot);

    // Entity registry
    TMap<FGuid, FAegisEntityIdentity> EntityRegistry;
    TMap<EAegisEntityType, int32> CreationCounters;

    // State storage
    TMap<FGuid, FAegisWorldStateSnapshot> StateStorage;

    // Event log
    TArray<FAegisSeedEvent> EventLog;

    // Configuration
    int32 WorldSeed = 42;
    FString ProjectId = TEXT("aegis-project");
    bool bDeterministicMode = true;

    // Helper to emit events
    void EmitEvent(EAegisSeedEventType Type, const FGuid& EntityGUID = FGuid(), const FString& CommandId = TEXT(""));
};
```

#### SeedPlatformConnector.h

```cpp
// aegis/ue-plugin/Source/AegisRuntime/Public/SeedProtocol/SeedPlatformConnector.h

#pragma once

#include "CoreMinimal.h"
#include "SeedProtocolSubsystem.h"
#include "SeedPlatformConnector.generated.h"

UENUM(BlueprintType)
enum class EAegisConnectorType : uint8
{
    Git,
    Perforce,
    Notion,
    Linear,
    Custom
};

UENUM(BlueprintType)
enum class EAegisSyncStatus : uint8
{
    Pending,
    InProgress,
    Completed,
    Failed
};

USTRUCT(BlueprintType)
struct FAegisSyncOperation
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FGuid OperationId;

    UPROPERTY(BlueprintReadOnly)
    FString Type; // "push", "pull", "sync"

    UPROPERTY(BlueprintReadOnly)
    EAegisConnectorType Connector = EAegisConnectorType::Git;

    UPROPERTY(BlueprintReadOnly)
    EAegisSyncStatus Status = EAegisSyncStatus::Pending;

    UPROPERTY(BlueprintReadOnly)
    int64 StartTime = 0;

    UPROPERTY(BlueprintReadOnly)
    int64 EndTime = 0;

    UPROPERTY(BlueprintReadOnly)
    FGuid StateId;

    UPROPERTY(BlueprintReadOnly)
    FString Error;
};

UCLASS(Abstract)
class AEGISRUNTIME_API UAegisSeedPlatformConnector : public UObject
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Connector")
    virtual bool TestConnection() PURE_VIRTUAL(UAegisSeedPlatformConnector::TestConnection, return false;);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Connector")
    virtual FAegisSyncOperation PushState(const FAegisWorldStateSnapshot& State, const FString& Message = TEXT("")) PURE_VIRTUAL(UAegisSeedPlatformConnector::PushState, return FAegisSyncOperation(););

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Connector")
    virtual FAegisWorldStateSnapshot PullState(const FGuid& StateId) PURE_VIRTUAL(UAegisSeedPlatformConnector::PullState, return FAegisWorldStateSnapshot(););

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Connector")
    virtual TArray<FGuid> ListRemoteStates() PURE_VIRTUAL(UAegisSeedPlatformConnector::ListRemoteStates, return TArray<FGuid>(););

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Connector")
    virtual EAegisConnectorType GetConnectorType() const PURE_VIRTUAL(UAegisSeedPlatformConnector::GetConnectorType, return EAegisConnectorType::Custom;);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Connector")
    virtual bool IsConfigured() const PURE_VIRTUAL(UAegisSeedPlatformConnector::IsConfigured, return false;);

protected:
    bool bIsConnected = false;
};

UCLASS()
class AEGISRUNTIME_API UAegisSeedGitConnector : public UAegisSeedPlatformConnector
{
    GENERATED_BODY()

public:
    virtual bool TestConnection() override;
    virtual FAegisSyncOperation PushState(const FAegisWorldStateSnapshot& State, const FString& Message = TEXT("")) override;
    virtual FAegisWorldStateSnapshot PullState(const FGuid& StateId) override;
    virtual TArray<FGuid> ListRemoteStates() override;
    virtual EAegisConnectorType GetConnectorType() const override { return EAegisConnectorType::Git; }
    virtual bool IsConfigured() const override;

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Git")
    void Configure(
        const FString& RepositoryPath,
        const FString& Branch = TEXT("main"),
        const FString& RemoteName = TEXT("origin"),
        const FString& StatesDirectory = TEXT(".aegis/states/")
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Git")
    bool CreateBranch(const FString& BranchName, const FString& FromRef = TEXT(""));

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Git")
    bool SwitchBranch(const FString& BranchName);

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Git")
    bool Push();

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Git")
    bool Pull();

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Seed|Git")
    bool CreateTag(const FString& TagName, const FString& Message = TEXT(""));

private:
    FString RepositoryPath;
    FString Branch = TEXT("main");
    FString RemoteName = TEXT("origin");
    FString StatesDirectory = TEXT(".aegis/states/");

    FString RunGitCommand(const TArray<FString>& Args);
};
```

-----

## 📊 Testing Summary

### Phase 7 Tests
```
tests/plugins/worldgen/
├── noise-generator.test.ts
├── heightmap-generator.test.ts
├── biome-placer.test.ts
├── scatter-engine.test.ts
├── terrain-commands.test.ts
├── biome-commands.test.ts
├── foliage-commands.test.ts
├── pcg-integration.test.ts
└── export-commands.test.ts
```

### Phase 8 Tests
```
tests/plugins/npc/
├── onnx-runner.test.ts
├── behavior-tree-converter.test.ts
├── state-machine-executor.test.ts
├── decision-pipeline.test.ts
├── performance-budget.test.ts
├── ai-strategy.test.ts
└── integration/
    ├── onnx-behavior-integration.test.ts
    └── full-decision-flow.test.ts
```

### Phase 9 Tests
```
tests/seed-protocol/
├── guid-generator.test.ts
├── entity-registry.test.ts
├── diff-engine.test.ts
├── merge-engine.test.ts
├── serializer.test.ts
├── deserializer.test.ts
├── connectors/
│   ├── git-connector.test.ts
│   ├── perforce-connector.test.ts
│   ├── notion-connector.test.ts
│   └── linear-connector.test.ts
└── integration/
    ├── capture-restore.test.ts
    ├── diff-merge-flow.test.ts
    └── multi-connector-sync.test.ts
```

-----

## 🚀 Implementation Order

### Recommended Execution Sequence

1. **Phase 7 - WorldGen (Week 1-2)**
   - Day 1-2: NoiseGenerator implementation with all noise types
   - Day 3-4: Terrain schemas and heightmap generation commands
   - Day 5-6: Biome system with conditions and transitions
   - Day 7-8: Foliage scattering with placement rules
   - Day 9-10: PCG framework integration (UE5.3+)
   - Day 11-12: Export commands and testing
   - Day 13-14: Integration testing and bug fixes

2. **Phase 8 - Runtime AI (Week 3-4)**
   - Day 1-2: ONNX runner setup (onnxruntime-node + UE integration)
   - Day 3-4: Behavior tree JSON/YAML parser
   - Day 5-6: Behavior tree to UE converter
   - Day 7-8: State machine executor
   - Day 9-10: Decision pipeline implementation
   - Day 11-12: Performance budgeting system
   - Day 13-14: Hot-swap strategies and API fallback

3. **Phase 9 - Seed Protocol (Week 5-6)**
   - Day 1-2: GUID generation and entity registry
   - Day 3-4: World state schemas and serialization
   - Day 5-6: Diff engine implementation
   - Day 7-8: Merge engine with conflict resolution
   - Day 9-10: Git connector
   - Day 11-12: Perforce, Notion, Linear connectors
   - Day 13-14: Integration testing and documentation

-----

## ✅ Success Criteria

### MVP Criteria
- [ ] Basic terrain generation with Perlin noise
- [ ] Simple biome system with 3+ biomes
- [ ] Foliage scattering functional
- [ ] ONNX inference operational (CPU)
- [ ] Basic behavior tree execution
- [ ] Seed state capture/restore working
- [ ] Git connector functional

### Production Ready Criteria
- [ ] All noise types implemented
- [ ] Full biome system with transitions
- [ ] PCG integration complete
- [ ] ONNX with GPU support (CUDA/DirectML)
- [ ] Full behavior tree converter
- [ ] State machine executor complete
- [ ] Performance budgeting active
- [ ] All platform connectors functional
- [ ] Diff/merge with conflict resolution
- [ ] 80%+ test coverage

### Enterprise Scale Criteria
- [ ] Large-world streaming support (64km²+)
- [ ] Multi-user collaborative editing
- [ ] Advanced AI strategies library
- [ ] Automated conflict resolution ML
- [ ] Cloud-based state synchronization
- [ ] Real-time collaboration features
- [ ] Full audit trail and compliance

-----

## 📝 Document Complete

This document provides the complete implementation specification for:
- **Phase 7**: WorldGen Subsystem with terrain, biome, foliage, and PCG integration
- **Phase 8**: Runtime AI Execution Layer with ONNX, behavior trees, state machines, and decision pipelines
- **Phase 9**: Seed Protocol for deterministic world state synchronization

All code follows the established patterns from Phases 0-6:
- Custom error classes extending AegisError
- Zod schemas for validation
- Pino logger integration
- Command annotations for safety
- UE5 C++ integration headers

The implementation is designed to be modular, testable, and production-ready while supporting the needs of indie game developers building AI-powered games in Unreal Engine.
