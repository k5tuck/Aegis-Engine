# AEGIS Phase 7 Addendum: Houdini Engine Integration

## 📋 Overview

This addendum extends Phase 7 (WorldGen Subsystem) with optional Houdini Engine integration, providing professional-grade procedural generation capabilities while gracefully falling back to native UE5 PCG when Houdini is unavailable.

### Integration Goals

1. **AI-Assisted HDA Execution** - Natural language → appropriate HDA selection → parameter configuration
2. **Direct HDA Control** - Explicit HDA execution for power users
3. **Graceful Fallback** - Automatic PCG-based alternatives when Houdini unavailable
4. **Bidirectional Data Flow** - UE ↔ Houdini heightfield/geometry exchange

---

## 🏗️ Architecture

### Detection and Fallback Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    AEGIS WorldGen Request                        │
│              "Generate a mountain range with snow"               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Houdini Availability Check                     │
│    1. Houdini Engine Plugin loaded?                             │
│    2. Valid Houdini license?                                    │
│    3. Required HDAs accessible?                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│   Houdini Available     │     │   Houdini Unavailable   │
│                         │     │                         │
│  1. Select best HDA     │     │  1. Map to PCG equiv    │
│  2. Configure params    │     │  2. Use native noise    │
│  3. Execute via Engine  │     │  3. Apply UE5 tools     │
│  4. Import results      │     │  4. Return results      │
└─────────────────────────┘     └─────────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Unified Result Format                         │
│     (Landscape, Foliage, Actors - regardless of source)         │
└─────────────────────────────────────────────────────────────────┘
```

### Directory Structure Addition

```
aegis/mcp-server/src/plugins/worldgen/
├── houdini/
│   ├── index.ts                    # Houdini module entry
│   ├── errors.ts                   # Houdini-specific errors
│   ├── schemas/
│   │   ├── hda-schemas.ts          # HDA execution schemas
│   │   ├── heightfield-schemas.ts  # Heightfield I/O schemas
│   │   └── catalog-schemas.ts      # HDA catalog schemas
│   ├── detection/
│   │   ├── availability-checker.ts # License/plugin detection
│   │   └── capability-mapper.ts    # HDA → PCG capability mapping
│   ├── execution/
│   │   ├── hda-executor.ts         # HDA execution engine
│   │   ├── parameter-mapper.ts     # NL → HDA parameter mapping
│   │   └── result-importer.ts      # Import Houdini outputs
│   ├── catalog/
│   │   ├── hda-catalog.ts          # Available HDA registry
│   │   ├── builtin-hdas.json       # Known SideFX/community HDAs
│   │   └── custom-hdas.json        # User-registered HDAs
│   └── fallback/
│       ├── pcg-equivalents.ts      # PCG fallback mappings
│       └── native-alternatives.ts  # Non-PCG native fallbacks

aegis/ue-plugin/Source/AegisRuntime/Public/Houdini/
├── AegisHoudiniSubsystem.h         # Houdini integration subsystem
├── AegisHDAExecutor.h              # HDA execution wrapper
├── AegisHeightfieldBridge.h        # Heightfield data bridge
└── AegisHoudiniTypes.h             # Shared type definitions
```

---

## 🚨 Custom Error Classes

### src/plugins/worldgen/houdini/errors.ts

```typescript
import { AegisError } from '../../../utils/errors';

export class HoudiniNotAvailableError extends AegisError {
  constructor(reason: 'plugin_missing' | 'license_invalid' | 'engine_not_running') {
    const messages = {
      plugin_missing: 'Houdini Engine plugin is not installed or enabled',
      license_invalid: 'No valid Houdini license found (Indie/Core/FX required)',
      engine_not_running: 'Houdini Engine is not running or not responding',
    };
    super(
      messages[reason],
      'HOUDINI_NOT_AVAILABLE',
      { reason },
      true // Recoverable - can fallback to PCG
    );
    this.name = 'HoudiniNotAvailableError';
  }
}

export class HDANotFoundError extends AegisError {
  constructor(hdaPath: string, searchPaths: string[]) {
    super(
      `HDA not found: "${hdaPath}"`,
      'HDA_NOT_FOUND',
      { hdaPath, searchPaths },
      true
    );
    this.name = 'HDANotFoundError';
  }
}

export class HDAExecutionError extends AegisError {
  constructor(hdaPath: string, nodePath: string, errorMessage: string) {
    super(
      `HDA execution failed: ${errorMessage}`,
      'HDA_EXECUTION_FAILED',
      { hdaPath, nodePath, errorMessage },
      true
    );
    this.name = 'HDAExecutionError';
  }
}

export class HDAParameterError extends AegisError {
  constructor(hdaPath: string, paramName: string, reason: string) {
    super(
      `Invalid HDA parameter "${paramName}": ${reason}`,
      'HDA_PARAMETER_INVALID',
      { hdaPath, paramName, reason },
      true
    );
    this.name = 'HDAParameterError';
  }
}

export class HeightfieldConversionError extends AegisError {
  constructor(direction: 'import' | 'export', reason: string) {
    super(
      `Heightfield ${direction} failed: ${reason}`,
      'HEIGHTFIELD_CONVERSION_FAILED',
      { direction, reason },
      true
    );
    this.name = 'HeightfieldConversionError';
  }
}

export class HoudiniCookError extends AegisError {
  constructor(hdaPath: string, cookTimeMs: number, errors: string[]) {
    super(
      `HDA cook failed after ${cookTimeMs}ms with ${errors.length} error(s)`,
      'HOUDINI_COOK_FAILED',
      { hdaPath, cookTimeMs, errors },
      true
    );
    this.name = 'HoudiniCookError';
  }
}

export class FallbackNotAvailableError extends AegisError {
  constructor(originalCapability: string, reason: string) {
    super(
      `No fallback available for "${originalCapability}": ${reason}`,
      'FALLBACK_NOT_AVAILABLE',
      { originalCapability, reason },
      false // Not recoverable if fallback also fails
    );
    this.name = 'FallbackNotAvailableError';
  }
}
```

---

## 📐 Zod Schemas

### src/plugins/worldgen/houdini/schemas/hda-schemas.ts

```typescript
import { z } from 'zod';

// HDA Parameter Types (matching Houdini's parameter system)
export const HDAParameterTypeSchema = z.enum([
  'int', 'float', 'string', 'toggle',
  'vector2', 'vector3', 'vector4',
  'color', 'ramp', 'file', 'geometry',
  'button', 'folder', 'separator',
]);

export const HDAParameterValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.array(z.number()), // For vectors/colors
  z.object({ // For ramps
    basis: z.enum(['linear', 'bezier', 'bspline', 'hermite', 'catmull-rom']),
    keys: z.array(z.object({
      pos: z.number().min(0).max(1),
      value: z.union([z.number(), z.array(z.number())]),
    })),
  }),
  z.null(),
]);

export const HDAParameterOverrideSchema = z.object({
  name: z.string().describe('Parameter internal name'),
  value: HDAParameterValueSchema,
  expression: z.string().optional().describe('HScript/Python expression'),
});

// Execute HDA Schema
export const ExecuteHDASchema = z.object({
  hdaPath: z.string().describe('Path to HDA file or asset name from catalog'),
  parameters: z.array(HDAParameterOverrideSchema).default([]),
  inputGeometry: z.array(z.object({
    inputIndex: z.number().int().min(0).max(9),
    sourcePath: z.string().describe('UE asset path or world actor path'),
    sourceType: z.enum(['static_mesh', 'landscape', 'actor', 'heightfield', 'point_cloud']),
  })).optional(),
  outputConfig: z.object({
    outputIndex: z.number().int().min(0).default(0),
    targetType: z.enum(['landscape', 'static_mesh', 'instanced_mesh', 'foliage', 'actors', 'data_only']),
    targetPath: z.string().optional().describe('Where to place/save output'),
    applyToExisting: z.boolean().default(false),
  }),
  executionMode: z.enum(['sync', 'async', 'background']).default('async'),
  cookSettings: z.object({
    frameRange: z.tuple([z.number(), z.number()]).optional(),
    currentFrame: z.number().default(0),
    cookTimeoutMs: z.number().int().min(1000).max(600000).default(60000),
    enableCaching: z.boolean().default(true),
  }).default({}),
  fallbackBehavior: z.enum(['error', 'pcg_equivalent', 'skip']).default('pcg_equivalent'),
});

// AI-Assisted HDA Selection Schema
export const AIAssistedHDASchema = z.object({
  intent: z.string().describe('Natural language description of desired result'),
  constraints: z.object({
    maxTriangles: z.number().int().positive().optional(),
    targetPlatform: z.enum(['desktop', 'console', 'mobile']).optional(),
    stylization: z.enum(['realistic', 'stylized', 'low_poly', 'any']).default('any'),
    biome: z.string().optional().describe('Target biome context'),
  }).default({}),
  inputContext: z.object({
    existingLandscape: z.string().optional().describe('Landscape actor to modify'),
    selectionBounds: z.object({
      min: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      max: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    }).optional(),
    referenceImages: z.array(z.string()).optional().describe('Reference image paths'),
  }).default({}),
  preferences: z.object({
    preferHoudini: z.boolean().default(true),
    allowCloudProcessing: z.boolean().default(false),
    qualityPreset: z.enum(['draft', 'preview', 'production']).default('preview'),
  }).default({}),
});

// Query Available HDAs
export const QueryHDACatalogSchema = z.object({
  category: z.enum([
    'terrain', 'vegetation', 'buildings', 'roads', 
    'scatter', 'erosion', 'rivers', 'caves', 
    'cliffs', 'rocks', 'custom', 'all'
  ]).default('all'),
  searchTerm: z.string().optional(),
  includeBuiltin: z.boolean().default(true),
  includeCustom: z.boolean().default(true),
  includeUnavailable: z.boolean().default(false),
});

// Register Custom HDA
export const RegisterCustomHDASchema = z.object({
  hdaPath: z.string().describe('Path to .hda or .hdanc file'),
  catalogEntry: z.object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    displayName: z.string().min(1).max(128),
    description: z.string().max(500),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    thumbnail: z.string().optional(),
    author: z.string().optional(),
    version: z.string().optional(),
  }),
  parameterPresets: z.array(z.object({
    presetName: z.string(),
    description: z.string().optional(),
    parameters: z.array(HDAParameterOverrideSchema),
  })).default([]),
  pcgFallback: z.object({
    hasFallback: z.boolean(),
    fallbackGraphPath: z.string().optional(),
    qualityDegradation: z.enum(['none', 'minor', 'significant', 'major']).optional(),
  }).optional(),
});

// Batch HDA Execution
export const BatchExecuteHDASchema = z.object({
  operations: z.array(ExecuteHDASchema).min(1).max(50),
  executionOrder: z.enum(['sequential', 'parallel', 'dependency_graph']).default('sequential'),
  continueOnError: z.boolean().default(false),
  aggregateOutputs: z.boolean().default(false),
});
```

### src/plugins/worldgen/houdini/schemas/heightfield-schemas.ts

```typescript
import { z } from 'zod';

// Export UE Landscape to Houdini Heightfield
export const ExportToHeightfieldSchema = z.object({
  landscapePath: z.string().describe('UE Landscape actor path'),
  outputPath: z.string().describe('Output .hf or .bgeo path'),
  exportSettings: z.object({
    resolution: z.enum(['full', 'half', 'quarter']).default('full'),
    includeLayers: z.array(z.string()).optional().describe('Specific layers to export'),
    includeAllLayers: z.boolean().default(true),
    normalizeHeight: z.boolean().default(false),
    coordinateSpace: z.enum(['local', 'world']).default('world'),
  }).default({}),
  format: z.enum(['hf', 'bgeo', 'bgeo.sc', 'exr']).default('bgeo.sc'),
});

// Import Houdini Heightfield to UE Landscape
export const ImportFromHeightfieldSchema = z.object({
  heightfieldPath: z.string().describe('Path to Houdini heightfield'),
  targetLandscape: z.string().optional().describe('Existing landscape to modify'),
  createNewLandscape: z.boolean().default(false),
  importSettings: z.object({
    heightScale: z.number().positive().default(1.0),
    layerMapping: z.record(z.string()).optional().describe('Houdini layer → UE layer name'),
    applyErosionMask: z.boolean().default(true),
    preserveExistingFoliage: z.boolean().default(false),
  }).default({}),
  bounds: z.object({
    min: z.object({ x: z.number(), y: z.number() }),
    max: z.object({ x: z.number(), y: z.number() }),
  }).optional().describe('Region to import (full if omitted)'),
});

// Heightfield Layer Operations
export const HeightfieldLayerOperationSchema = z.object({
  operation: z.enum(['copy', 'blend', 'erode', 'smooth', 'noise', 'terrace']),
  sourceLayer: z.string(),
  targetLayer: z.string().optional(),
  parameters: z.record(z.unknown()).default({}),
});
```

---

## 🔍 Availability Checker

### src/plugins/worldgen/houdini/detection/availability-checker.ts

```typescript
import { Logger } from '../../../../utils/logger';
import { HoudiniNotAvailableError } from '../errors';

export interface HoudiniAvailability {
  available: boolean;
  pluginInstalled: boolean;
  pluginEnabled: boolean;
  licenseValid: boolean;
  licenseType: 'apprentice' | 'indie' | 'core' | 'fx' | 'none';
  engineVersion: string | null;
  sessionActive: boolean;
  capabilities: HoudiniCapabilities;
}

export interface HoudiniCapabilities {
  heightfields: boolean;
  pdgSupport: boolean;
  maxOutputPoints: number;
  supportsGPU: boolean;
  supportedFormats: string[];
}

export class HoudiniAvailabilityChecker {
  private logger: Logger;
  private cachedStatus: HoudiniAvailability | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION_MS = 30000; // 30 seconds

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'HoudiniAvailabilityChecker' });
  }

  async checkAvailability(forceRefresh: boolean = false): Promise<HoudiniAvailability> {
    // Return cached if valid
    if (!forceRefresh && this.cachedStatus && Date.now() - this.cacheTimestamp < this.CACHE_DURATION_MS) {
      return this.cachedStatus;
    }

    this.logger.debug('Checking Houdini availability');

    const status: HoudiniAvailability = {
      available: false,
      pluginInstalled: false,
      pluginEnabled: false,
      licenseValid: false,
      licenseType: 'none',
      engineVersion: null,
      sessionActive: false,
      capabilities: {
        heightfields: false,
        pdgSupport: false,
        maxOutputPoints: 0,
        supportsGPU: false,
        supportedFormats: [],
      },
    };

    try {
      // Check plugin installation via UE client
      // This would be called via the UE WebSocket connection
      const pluginStatus = await this.queryPluginStatus();
      status.pluginInstalled = pluginStatus.installed;
      status.pluginEnabled = pluginStatus.enabled;

      if (!status.pluginInstalled || !status.pluginEnabled) {
        this.cachedStatus = status;
        this.cacheTimestamp = Date.now();
        return status;
      }

      // Check license
      const licenseStatus = await this.queryLicenseStatus();
      status.licenseValid = licenseStatus.valid;
      status.licenseType = licenseStatus.type;

      if (!status.licenseValid) {
        this.cachedStatus = status;
        this.cacheTimestamp = Date.now();
        return status;
      }

      // Check engine session
      const sessionStatus = await this.querySessionStatus();
      status.sessionActive = sessionStatus.active;
      status.engineVersion = sessionStatus.version;

      // Query capabilities
      if (status.sessionActive) {
        status.capabilities = await this.queryCapabilities();
      }

      // All checks passed
      status.available = status.pluginEnabled && status.licenseValid && status.sessionActive;

      this.cachedStatus = status;
      this.cacheTimestamp = Date.now();

      this.logger.info('Houdini availability check complete', {
        available: status.available,
        licenseType: status.licenseType,
        version: status.engineVersion,
      });

      return status;
    } catch (error) {
      this.logger.warn('Houdini availability check failed', { error });
      this.cachedStatus = status;
      this.cacheTimestamp = Date.now();
      return status;
    }
  }

  async requireAvailable(): Promise<HoudiniAvailability> {
    const status = await this.checkAvailability();

    if (!status.pluginInstalled || !status.pluginEnabled) {
      throw new HoudiniNotAvailableError('plugin_missing');
    }

    if (!status.licenseValid) {
      throw new HoudiniNotAvailableError('license_invalid');
    }

    if (!status.sessionActive) {
      throw new HoudiniNotAvailableError('engine_not_running');
    }

    return status;
  }

  isAvailable(): boolean {
    return this.cachedStatus?.available ?? false;
  }

  private async queryPluginStatus(): Promise<{ installed: boolean; enabled: boolean }> {
    // Would call UE to check plugin status
    // Placeholder - actual implementation via UE client
    return { installed: false, enabled: false };
  }

  private async queryLicenseStatus(): Promise<{ valid: boolean; type: HoudiniAvailability['licenseType'] }> {
    // Would query Houdini license server
    return { valid: false, type: 'none' };
  }

  private async querySessionStatus(): Promise<{ active: boolean; version: string | null }> {
    // Would check if Houdini Engine session is running
    return { active: false, version: null };
  }

  private async queryCapabilities(): Promise<HoudiniCapabilities> {
    // Would query Houdini Engine for capabilities
    return {
      heightfields: true,
      pdgSupport: true,
      maxOutputPoints: 10000000,
      supportsGPU: true,
      supportedFormats: ['bgeo', 'bgeo.sc', 'obj', 'fbx', 'hf'],
    };
  }
}
```

---

## 🎯 AI-Assisted HDA Selection

### src/plugins/worldgen/houdini/execution/parameter-mapper.ts

```typescript
import { Logger } from '../../../../utils/logger';

export interface IntentAnalysis {
  primaryCategory: string;
  secondaryCategories: string[];
  keywords: string[];
  scaleHint: 'small' | 'medium' | 'large' | 'massive';
  styleHint: 'realistic' | 'stylized' | 'abstract';
  complexityHint: 'simple' | 'moderate' | 'complex';
  suggestedHDAs: SuggestedHDA[];
}

export interface SuggestedHDA {
  hdaId: string;
  confidence: number;
  reasoning: string;
  suggestedParameters: Record<string, unknown>;
  fallbackAvailable: boolean;
}

// Intent → HDA mapping rules
const INTENT_MAPPINGS: Record<string, {
  keywords: string[];
  hdaIds: string[];
  parameterHints: Record<string, Record<string, unknown>>;
}> = {
  mountain: {
    keywords: ['mountain', 'peak', 'alpine', 'summit', 'ridge', 'rocky'],
    hdaIds: ['sidefx_mountain_generator', 'terrain_mountain_v2', 'alpine_terrain'],
    parameterHints: {
      sidefx_mountain_generator: { style: 'alpine', erosion_strength: 0.7 },
      terrain_mountain_v2: { peak_count: 3, snow_line: 2000 },
    },
  },
  canyon: {
    keywords: ['canyon', 'gorge', 'ravine', 'valley', 'cliff'],
    hdaIds: ['canyon_carver', 'river_canyon_hda', 'erosion_canyon'],
    parameterHints: {
      canyon_carver: { depth: 500, wall_angle: 75 },
    },
  },
  forest: {
    keywords: ['forest', 'trees', 'woodland', 'woods', 'jungle'],
    hdaIds: ['forest_scatter', 'tree_placement_hda', 'vegetation_system'],
    parameterHints: {
      forest_scatter: { density: 0.7, variation: 0.3 },
    },
  },
  river: {
    keywords: ['river', 'stream', 'creek', 'water', 'flow'],
    hdaIds: ['river_generator', 'water_flow_hda', 'stream_carver'],
    parameterHints: {
      river_generator: { width: 50, depth: 5, meander: 0.5 },
    },
  },
  desert: {
    keywords: ['desert', 'dune', 'sand', 'arid', 'badlands'],
    hdaIds: ['dune_generator', 'desert_terrain', 'sand_dunes_hda'],
    parameterHints: {
      dune_generator: { dune_height: 30, wind_direction: 45 },
    },
  },
  city: {
    keywords: ['city', 'buildings', 'urban', 'town', 'street'],
    hdaIds: ['city_generator', 'building_scatter', 'urban_layout'],
    parameterHints: {
      city_generator: { block_size: 100, building_density: 0.8 },
    },
  },
  road: {
    keywords: ['road', 'path', 'highway', 'trail', 'street'],
    hdaIds: ['road_generator', 'path_creator', 'highway_tool'],
    parameterHints: {
      road_generator: { width: 10, curve_smoothing: 0.5 },
    },
  },
  rock: {
    keywords: ['rock', 'boulder', 'stone', 'cliff', 'outcrop'],
    hdaIds: ['rock_generator', 'boulder_scatter', 'cliff_faces'],
    parameterHints: {
      rock_generator: { scale_variation: 0.5, weathering: 0.3 },
    },
  },
};

export class AIParameterMapper {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'AIParameterMapper' });
  }

  analyzeIntent(intent: string, context?: Record<string, unknown>): IntentAnalysis {
    const normalizedIntent = intent.toLowerCase();
    const words = normalizedIntent.split(/\s+/);

    // Find matching categories
    const categoryScores: Record<string, number> = {};
    const matchedKeywords: string[] = [];

    for (const [category, mapping] of Object.entries(INTENT_MAPPINGS)) {
      let score = 0;
      for (const keyword of mapping.keywords) {
        if (normalizedIntent.includes(keyword)) {
          score += keyword.length; // Longer matches score higher
          matchedKeywords.push(keyword);
        }
      }
      if (score > 0) {
        categoryScores[category] = score;
      }
    }

    // Sort categories by score
    const sortedCategories = Object.entries(categoryScores)
      .sort(([, a], [, b]) => b - a)
      .map(([cat]) => cat);

    const primaryCategory = sortedCategories[0] || 'terrain';
    const secondaryCategories = sortedCategories.slice(1, 3);

    // Analyze scale
    const scaleHint = this.analyzeScale(normalizedIntent);

    // Analyze style
    const styleHint = this.analyzeStyle(normalizedIntent);

    // Analyze complexity
    const complexityHint = this.analyzeComplexity(normalizedIntent);

    // Get suggested HDAs
    const suggestedHDAs = this.getSuggestedHDAs(
      primaryCategory,
      secondaryCategories,
      { scale: scaleHint, style: styleHint, complexity: complexityHint }
    );

    return {
      primaryCategory,
      secondaryCategories,
      keywords: [...new Set(matchedKeywords)],
      scaleHint,
      styleHint,
      complexityHint,
      suggestedHDAs,
    };
  }

  private analyzeScale(intent: string): IntentAnalysis['scaleHint'] {
    if (/massive|huge|epic|world|continent/i.test(intent)) return 'massive';
    if (/large|big|expansive|wide/i.test(intent)) return 'large';
    if (/small|tiny|little|compact/i.test(intent)) return 'small';
    return 'medium';
  }

  private analyzeStyle(intent: string): IntentAnalysis['styleHint'] {
    if (/realistic|photorealistic|natural|real/i.test(intent)) return 'realistic';
    if (/stylized|cartoon|artistic|fantasy/i.test(intent)) return 'stylized';
    if (/abstract|procedural|geometric/i.test(intent)) return 'abstract';
    return 'realistic';
  }

  private analyzeComplexity(intent: string): IntentAnalysis['complexityHint'] {
    if (/complex|detailed|intricate|elaborate/i.test(intent)) return 'complex';
    if (/simple|basic|minimal|clean/i.test(intent)) return 'simple';
    return 'moderate';
  }

  private getSuggestedHDAs(
    primaryCategory: string,
    secondaryCategories: string[],
    hints: { scale: string; style: string; complexity: string }
  ): SuggestedHDA[] {
    const suggestions: SuggestedHDA[] = [];
    const mapping = INTENT_MAPPINGS[primaryCategory];

    if (mapping) {
      for (const hdaId of mapping.hdaIds) {
        suggestions.push({
          hdaId,
          confidence: 0.9 - suggestions.length * 0.1,
          reasoning: `Primary match for ${primaryCategory} terrain generation`,
          suggestedParameters: mapping.parameterHints[hdaId] || {},
          fallbackAvailable: true, // Would check actual fallback registry
        });
      }
    }

    // Add secondary suggestions
    for (const category of secondaryCategories) {
      const secondaryMapping = INTENT_MAPPINGS[category];
      if (secondaryMapping && secondaryMapping.hdaIds[0]) {
        suggestions.push({
          hdaId: secondaryMapping.hdaIds[0],
          confidence: 0.5,
          reasoning: `Secondary match for ${category} features`,
          suggestedParameters: secondaryMapping.parameterHints[secondaryMapping.hdaIds[0]] || {},
          fallbackAvailable: true,
        });
      }
    }

    return suggestions.slice(0, 5);
  }
}
```

---

## 🔄 PCG Fallback Mapper

### src/plugins/worldgen/houdini/fallback/pcg-equivalents.ts

```typescript
import { Logger } from '../../../../utils/logger';
import { FallbackNotAvailableError } from '../errors';

export interface PCGFallback {
  pcgGraphPath: string;
  parameterMapping: Record<string, string>; // HDA param → PCG param
  qualityDegradation: 'none' | 'minor' | 'significant' | 'major';
  limitations: string[];
  additionalSteps?: string[];
}

// HDA → PCG fallback mappings
const FALLBACK_REGISTRY: Record<string, PCGFallback> = {
  sidefx_mountain_generator: {
    pcgGraphPath: '/Game/AEGIS/PCG/Terrain/PCG_MountainGenerator',
    parameterMapping: {
      height: 'MaxHeight',
      erosion_strength: 'ErosionIterations',
      peak_count: 'NumPeaks',
      noise_scale: 'NoiseFrequency',
    },
    qualityDegradation: 'minor',
    limitations: [
      'Erosion simulation less physically accurate',
      'No thermal weathering support',
    ],
  },
  canyon_carver: {
    pcgGraphPath: '/Game/AEGIS/PCG/Terrain/PCG_CanyonCarver',
    parameterMapping: {
      depth: 'CanyonDepth',
      width: 'CanyonWidth',
      wall_angle: 'WallSteepness',
    },
    qualityDegradation: 'significant',
    limitations: [
      'No water flow simulation',
      'Simplified wall geometry',
      'No layered rock strata',
    ],
  },
  forest_scatter: {
    pcgGraphPath: '/Game/AEGIS/PCG/Vegetation/PCG_ForestScatter',
    parameterMapping: {
      density: 'TreeDensity',
      variation: 'SpeciesVariation',
      min_distance: 'MinSpacing',
    },
    qualityDegradation: 'none',
    limitations: [],
  },
  river_generator: {
    pcgGraphPath: '/Game/AEGIS/PCG/Water/PCG_RiverPath',
    parameterMapping: {
      width: 'RiverWidth',
      meander: 'MeanderAmount',
    },
    qualityDegradation: 'major',
    limitations: [
      'No fluid simulation',
      'Simplified spline-based path',
      'No bank erosion',
      'No sediment deposition',
    ],
    additionalSteps: [
      'Manually adjust river mesh after generation',
      'Add water material separately',
    ],
  },
  dune_generator: {
    pcgGraphPath: '/Game/AEGIS/PCG/Terrain/PCG_DuneField',
    parameterMapping: {
      dune_height: 'DuneScale',
      wind_direction: 'WindAngle',
      density: 'DuneDensity',
    },
    qualityDegradation: 'minor',
    limitations: [
      'No wind simulation',
      'Static dune shapes',
    ],
  },
  rock_generator: {
    pcgGraphPath: '/Game/AEGIS/PCG/Props/PCG_RockScatter',
    parameterMapping: {
      scale_variation: 'ScaleRange',
      count: 'InstanceCount',
    },
    qualityDegradation: 'none',
    limitations: [],
  },
  city_generator: {
    pcgGraphPath: '/Game/AEGIS/PCG/Urban/PCG_CityBlocks',
    parameterMapping: {
      block_size: 'BlockDimension',
      building_density: 'BuildingDensity',
    },
    qualityDegradation: 'significant',
    limitations: [
      'Limited building variety',
      'No procedural interiors',
      'Simplified road network',
    ],
  },
};

// Native UE alternatives (when even PCG isn't suitable)
const NATIVE_ALTERNATIVES: Record<string, {
  method: string;
  description: string;
  steps: string[];
}> = {
  terrain_basic: {
    method: 'LandscapeMode',
    description: 'Use UE Landscape sculpting tools with noise brushes',
    steps: [
      'Create Landscape actor',
      'Apply noise-based heightmap',
      'Use sculpt tools for refinement',
    ],
  },
  scatter_basic: {
    method: 'FoliageMode',
    description: 'Use UE Foliage painting system',
    steps: [
      'Configure foliage types',
      'Paint instances manually or via procedural volume',
    ],
  },
};

export class PCGFallbackMapper {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'PCGFallbackMapper' });
  }

  hasFallback(hdaId: string): boolean {
    return hdaId in FALLBACK_REGISTRY;
  }

  getFallback(hdaId: string): PCGFallback {
    const fallback = FALLBACK_REGISTRY[hdaId];
    if (!fallback) {
      throw new FallbackNotAvailableError(
        hdaId,
        'No PCG equivalent registered for this HDA'
      );
    }
    return fallback;
  }

  mapParameters(
    hdaId: string,
    hdaParams: Record<string, unknown>
  ): Record<string, unknown> {
    const fallback = this.getFallback(hdaId);
    const pcgParams: Record<string, unknown> = {};

    for (const [hdaParam, value] of Object.entries(hdaParams)) {
      const pcgParam = fallback.parameterMapping[hdaParam];
      if (pcgParam) {
        pcgParams[pcgParam] = value;
      } else {
        this.logger.debug('No PCG mapping for HDA parameter', { hdaParam, hdaId });
      }
    }

    return pcgParams;
  }

  getNativeAlternative(category: string): typeof NATIVE_ALTERNATIVES[string] | null {
    return NATIVE_ALTERNATIVES[category] || null;
  }

  getAllFallbacks(): Record<string, PCGFallback> {
    return { ...FALLBACK_REGISTRY };
  }

  getQualityWarning(hdaId: string): string | null {
    const fallback = FALLBACK_REGISTRY[hdaId];
    if (!fallback) return null;

    switch (fallback.qualityDegradation) {
      case 'none':
        return null;
      case 'minor':
        return 'PCG fallback available with minor quality reduction';
      case 'significant':
        return `PCG fallback has significant limitations: ${fallback.limitations.join(', ')}`;
      case 'major':
        return `PCG fallback has major limitations and may require manual adjustments: ${fallback.limitations.join(', ')}`;
    }
  }
}
```

---

## 🔌 Houdini Commands (Plugin Integration)

### src/plugins/worldgen/houdini/index.ts

```typescript
import { z } from 'zod';
import { CommandDefinition, CommandAnnotations } from '../../../../registry/plugin-types';
import { Logger } from '../../../../utils/logger';

import {
  ExecuteHDASchema,
  AIAssistedHDASchema,
  QueryHDACatalogSchema,
  RegisterCustomHDASchema,
  BatchExecuteHDASchema,
} from './schemas/hda-schemas';

import {
  ExportToHeightfieldSchema,
  ImportFromHeightfieldSchema,
} from './schemas/heightfield-schemas';

import { HoudiniAvailabilityChecker } from './detection/availability-checker';
import { AIParameterMapper } from './execution/parameter-mapper';
import { PCGFallbackMapper } from './fallback/pcg-equivalents';

const houdiniAnnotations: CommandAnnotations = {
  readOnly: false,
  destructive: false,
  idempotent: false,
  openWorld: false,
  riskLevel: 'medium',
  requiresApproval: true,
  runtimeCapable: false,
  estimatedDuration: 30000, // HDAs can take a while
};

export function getHoudiniCommands(logger: Logger): CommandDefinition[] {
  const availabilityChecker = new HoudiniAvailabilityChecker(logger);
  const parameterMapper = new AIParameterMapper(logger);
  const fallbackMapper = new PCGFallbackMapper(logger);

  return [
    {
      name: 'check_houdini_availability',
      description: 'Check if Houdini Engine is available and get capabilities.',
      shortDescription: 'Check Houdini status',
      paramsSchema: z.object({
        forceRefresh: z.boolean().default(false),
      }),
      annotations: { ...houdiniAnnotations, readOnly: true, requiresApproval: false, riskLevel: 'low' },
      async execute(params, context) {
        const status = await availabilityChecker.checkAvailability(params.forceRefresh);
        return { success: true, status };
      },
    },

    {
      name: 'execute_hda',
      description: 'Execute a Houdini Digital Asset (HDA) with specified parameters. Falls back to PCG if Houdini unavailable.',
      shortDescription: 'Execute HDA',
      paramsSchema: ExecuteHDASchema,
      annotations: houdiniAnnotations,
      async execute(params, context) {
        const status = await availabilityChecker.checkAvailability();

        if (!status.available) {
          // Handle fallback
          if (params.fallbackBehavior === 'error') {
            throw new Error('Houdini not available and fallback disabled');
          }

          if (params.fallbackBehavior === 'pcg_equivalent') {
            const hdaId = params.hdaPath.split('/').pop()?.replace('.hda', '') || '';
            if (fallbackMapper.hasFallback(hdaId)) {
              const fallback = fallbackMapper.getFallback(hdaId);
              const pcgParams = fallbackMapper.mapParameters(
                hdaId,
                Object.fromEntries(params.parameters.map(p => [p.name, p.value]))
              );

              context.logger.info('Using PCG fallback for HDA', {
                hdaId,
                pcgGraph: fallback.pcgGraphPath,
                qualityDegradation: fallback.qualityDegradation,
              });

              // Execute PCG graph instead
              return context.ueClient.callFunction(
                '/Script/Aegis.Default__AegisWorldGenSubsystem',
                'ExecutePCGGraph',
                {
                  GraphPath: fallback.pcgGraph,
                  Parameters: pcgParams,
                  TargetActor: params.outputConfig.targetPath,
                }
              );
            }
          }

          return { success: false, reason: 'houdini_unavailable', fallbackUsed: false };
        }

        // Execute actual HDA via Houdini Engine
        return context.ueClient.callFunction(
          '/Script/HoudiniEngineRuntime.Default__HoudiniPublicAPI',
          'ExecuteHDA',
          params
        );
      },
    },

    {
      name: 'ai_assisted_hda',
      description: 'Use AI to select and configure the best HDA for a natural language terrain request.',
      shortDescription: 'AI-assisted HDA',
      paramsSchema: AIAssistedHDASchema,
      annotations: { ...houdiniAnnotations, riskLevel: 'low', requiresApproval: false },
      async execute(params, context) {
        // Analyze intent
        const analysis = parameterMapper.analyzeIntent(params.intent, params.inputContext);

        // Check availability
        const status = await availabilityChecker.checkAvailability();

        // Enrich suggestions with availability info
        const enrichedSuggestions = analysis.suggestedHDAs.map(suggestion => ({
          ...suggestion,
          houdiniAvailable: status.available,
          willUseFallback: !status.available && fallbackMapper.hasFallback(suggestion.hdaId),
          fallbackQuality: !status.available && fallbackMapper.hasFallback(suggestion.hdaId)
            ? fallbackMapper.getFallback(suggestion.hdaId).qualityDegradation
            : null,
        }));

        return {
          success: true,
          analysis: {
            ...analysis,
            suggestedHDAs: enrichedSuggestions,
          },
          houdiniAvailable: status.available,
          recommendedAction: status.available
            ? `Execute HDA: ${analysis.suggestedHDAs[0]?.hdaId}`
            : `Use PCG fallback for: ${analysis.suggestedHDAs[0]?.hdaId}`,
        };
      },
    },

    {
      name: 'query_hda_catalog',
      description: 'Query available HDAs in the catalog.',
      shortDescription: 'Query HDA catalog',
      paramsSchema: QueryHDACatalogSchema,
      annotations: { ...houdiniAnnotations, readOnly: true, requiresApproval: false, riskLevel: 'low' },
      async execute(params, context) {
        // Would query actual catalog
        return { success: true, hdas: [] };
      },
    },

    {
      name: 'register_custom_hda',
      description: 'Register a custom HDA in the AEGIS catalog.',
      shortDescription: 'Register custom HDA',
      paramsSchema: RegisterCustomHDASchema,
      annotations: houdiniAnnotations,
      async execute(params, context) {
        // Would register HDA in catalog
        return { success: true, hdaId: params.catalogEntry.id };
      },
    },

    {
      name: 'export_to_heightfield',
      description: 'Export UE Landscape to Houdini heightfield format.',
      shortDescription: 'Export to heightfield',
      paramsSchema: ExportToHeightfieldSchema,
      annotations: { ...houdiniAnnotations, readOnly: true },
      async execute(params, context) {
        return context.ueClient.callFunction(
          '/Script/Aegis.Default__AegisHoudiniSubsystem',
          'ExportToHeightfield',
          params
        );
      },
    },

    {
      name: 'import_from_heightfield',
      description: 'Import Houdini heightfield to UE Landscape.',
      shortDescription: 'Import from heightfield',
      paramsSchema: ImportFromHeightfieldSchema,
      annotations: houdiniAnnotations,
      async execute(params, context) {
        return context.ueClient.callFunction(
          '/Script/Aegis.Default__AegisHoudiniSubsystem',
          'ImportFromHeightfield',
          params
        );
      },
    },
  ];
}
```

---

## 🎮 UE5 C++ Headers

### AegisHoudiniSubsystem.h

```cpp
// aegis/ue-plugin/Source/AegisRuntime/Public/Houdini/AegisHoudiniSubsystem.h

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "AegisHoudiniSubsystem.generated.h"

UENUM(BlueprintType)
enum class EAegisHoudiniLicenseType : uint8
{
    None,
    Apprentice,
    Indie,
    Core,
    FX
};

USTRUCT(BlueprintType)
struct FAegisHoudiniStatus
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    bool bAvailable = false;

    UPROPERTY(BlueprintReadOnly)
    bool bPluginInstalled = false;

    UPROPERTY(BlueprintReadOnly)
    bool bPluginEnabled = false;

    UPROPERTY(BlueprintReadOnly)
    bool bLicenseValid = false;

    UPROPERTY(BlueprintReadOnly)
    EAegisHoudiniLicenseType LicenseType = EAegisHoudiniLicenseType::None;

    UPROPERTY(BlueprintReadOnly)
    FString EngineVersion;

    UPROPERTY(BlueprintReadOnly)
    bool bSessionActive = false;
};

USTRUCT(BlueprintType)
struct FAegisHDAParameter
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString Name;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString Value;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString Expression;
};

USTRUCT(BlueprintType)
struct FAegisHDAExecutionResult
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    bool bSuccess = false;

    UPROPERTY(BlueprintReadOnly)
    bool bUsedFallback = false;

    UPROPERTY(BlueprintReadOnly)
    FString FallbackReason;

    UPROPERTY(BlueprintReadOnly)
    float CookTimeMs = 0.0f;

    UPROPERTY(BlueprintReadOnly)
    int32 OutputPointCount = 0;

    UPROPERTY(BlueprintReadOnly)
    TArray<FString> GeneratedActors;

    UPROPERTY(BlueprintReadOnly)
    TArray<FString> Warnings;

    UPROPERTY(BlueprintReadOnly)
    TArray<FString> Errors;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnHDACookComplete, const FString&, HDAPath, const FAegisHDAExecutionResult&, Result);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnHoudiniStatusChanged, const FAegisHoudiniStatus&, NewStatus);

UCLASS()
class AEGISRUNTIME_API UAegisHoudiniSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    // Status
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Houdini")
    FAegisHoudiniStatus CheckAvailability(bool bForceRefresh = false);

    UFUNCTION(BlueprintPure, Category = "AEGIS|Houdini")
    bool IsHoudiniAvailable() const { return CachedStatus.bAvailable; }

    // HDA Execution
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Houdini")
    FAegisHDAExecutionResult ExecuteHDA(
        const FString& HDAPath,
        const TArray<FAegisHDAParameter>& Parameters,
        bool bUseFallbackIfUnavailable = true
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Houdini")
    void ExecuteHDAAsync(
        const FString& HDAPath,
        const TArray<FAegisHDAParameter>& Parameters,
        bool bUseFallbackIfUnavailable = true
    );

    // Heightfield Operations
    UFUNCTION(BlueprintCallable, Category = "AEGIS|Houdini|Heightfield")
    bool ExportLandscapeToHeightfield(
        ALandscape* Landscape,
        const FString& OutputPath,
        bool bIncludeAllLayers = true
    );

    UFUNCTION(BlueprintCallable, Category = "AEGIS|Houdini|Heightfield")
    bool ImportHeightfieldToLandscape(
        const FString& HeightfieldPath,
        ALandscape* TargetLandscape,
        bool bCreateIfNotExists = false
    );

    // Events
    UPROPERTY(BlueprintAssignable, Category = "AEGIS|Houdini|Events")
    FOnHDACookComplete OnHDACookComplete;

    UPROPERTY(BlueprintAssignable, Category = "AEGIS|Houdini|Events")
    FOnHoudiniStatusChanged OnHoudiniStatusChanged;

private:
    FAegisHoudiniStatus CachedStatus;
    double LastStatusCheckTime = 0.0;

    // Fallback execution
    FAegisHDAExecutionResult ExecutePCGFallback(
        const FString& HDAPath,
        const TArray<FAegisHDAParameter>& Parameters
    );

    // Internal Houdini Engine calls
    bool InitializeHoudiniSession();
    void ShutdownHoudiniSession();
};
```

---

## 📦 User-Uploadable Houdini Skill

This is an example of what a user-uploadable skill looks like. Users can create and upload custom skills to extend AEGIS with their own HDAs and workflows.

### Skill Directory Structure

```
houdini-terrain-pack/
├── SKILL.md                           # Required - Main skill file
├── references/
│   ├── hda-catalog.md                 # HDA documentation
│   └── parameter-guide.md             # Parameter tuning guide
├── assets/
│   ├── hdas/
│   │   ├── mountain_erosion_v2.hda    # Custom HDA files
│   │   ├── river_carver_pro.hda
│   │   └── cliff_generator.hda
│   ├── presets/
│   │   ├── alpine_preset.json         # Parameter presets
│   │   ├── desert_preset.json
│   │   └── tropical_preset.json
│   └── thumbnails/
│       ├── mountain_erosion.png
│       ├── river_carver.png
│       └── cliff_generator.png
└── scripts/
    ├── register_hdas.py               # Auto-registration script
    └── validate_hdas.py               # HDA validation
```

### SKILL.md Example

```markdown
---
name: houdini-terrain-pack
description: "Professional Houdini terrain generation HDAs for AEGIS. Provides advanced mountain erosion, river carving, and cliff generation tools. Use when: (1) User requests realistic terrain with erosion, (2) User needs river/water body generation, (3) User wants cliff or rock face generation, (4) User mentions 'Houdini' or 'HDA' for terrain. Requires Houdini Engine plugin and valid license."
---

# Houdini Terrain Pack for AEGIS

## Overview

This skill provides professional-grade Houdini Digital Assets (HDAs) for terrain generation in Unreal Engine via AEGIS. All HDAs include PCG fallbacks for environments without Houdini.

## Requirements

- Houdini Engine for Unreal plugin (v19.5+)
- Houdini Indie license or higher
- Unreal Engine 5.3+

## Included HDAs

### 1. Mountain Erosion v2 (`mountain_erosion_v2.hda`)

Advanced mountain terrain with thermal and hydraulic erosion simulation.

**When to use**: Realistic mountain ranges, alpine environments, rocky peaks

**Key Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `base_height` | float | 5000 | Maximum terrain height (UE units) |
| `erosion_iterations` | int | 50 | Erosion simulation passes |
| `thermal_erosion` | float | 0.5 | Thermal weathering strength |
| `hydraulic_erosion` | float | 0.7 | Water erosion strength |
| `snow_coverage` | float | 0.3 | Snow mask threshold |

**Example Usage**:
```
"Generate a mountain range with heavy erosion and 30% snow coverage"
→ AEGIS selects mountain_erosion_v2.hda
→ Parameters: erosion_iterations=75, hydraulic_erosion=0.8, snow_coverage=0.3
```

**PCG Fallback**: Uses `PCG_MountainGenerator` with simplified erosion (quality: minor degradation)

### 2. River Carver Pro (`river_carver_pro.hda`)

Physically-based river and stream generation with bank erosion.

**When to use**: Rivers, streams, canyons carved by water, lake shores

**Key Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `river_width` | float | 50 | Base river width (UE units) |
| `flow_rate` | float | 1.0 | Water volume multiplier |
| `meander` | float | 0.5 | River curvature (0=straight, 1=very curvy) |
| `bank_erosion` | float | 0.3 | Bank erosion strength |
| `sediment_deposit` | bool | true | Enable sediment deposition |

**PCG Fallback**: Uses spline-based river path (quality: significant degradation - no fluid sim)

### 3. Cliff Generator (`cliff_generator.hda`)

Procedural cliff faces with rock strata and overhang details.

**When to use**: Cliff faces, canyon walls, coastal cliffs, rock outcrops

**Key Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cliff_height` | float | 500 | Cliff face height |
| `strata_layers` | int | 5 | Number of rock layers |
| `overhang_amount` | float | 0.2 | Overhang/underhang variation |
| `weathering` | float | 0.4 | Surface weathering detail |

**PCG Fallback**: Basic cliff mesh with limited detail (quality: significant degradation)

## Using Presets

Presets are pre-configured parameter sets for common scenarios:

```bash
# List available presets
aegis.worldgen.houdini.list_presets

# Apply preset
aegis.worldgen.houdini.execute_hda({
  hdaPath: "mountain_erosion_v2",
  preset: "alpine_preset"
})
```

### Available Presets

- **alpine_preset.json**: High peaks, heavy snow, dramatic erosion
- **desert_preset.json**: Wind erosion, sand accumulation, dry riverbeds
- **tropical_preset.json**: Lush erosion, waterfall cliffs, dense vegetation areas

## Registration

HDAs are automatically registered when this skill is loaded. To manually register:

```bash
python scripts/register_hdas.py --path assets/hdas/
```

## Fallback Behavior

When Houdini is unavailable, AEGIS automatically uses PCG equivalents:

| HDA | PCG Fallback | Quality Loss |
|-----|--------------|--------------|
| mountain_erosion_v2 | PCG_MountainGenerator | Minor |
| river_carver_pro | PCG_RiverPath | Significant |
| cliff_generator | PCG_CliffFaces | Significant |

To force Houdini-only execution (fails if unavailable):
```
aegis.worldgen.houdini.execute_hda({
  hdaPath: "mountain_erosion_v2",
  fallbackBehavior: "error"
})
```

## Troubleshooting

### "Houdini Engine not available"
1. Verify Houdini Engine plugin is enabled in UE
2. Check Houdini license status
3. Restart Unreal Editor

### "HDA not found"
1. Verify HDA files are in `assets/hdas/`
2. Run `python scripts/validate_hdas.py`
3. Check HDA search paths in AEGIS config

## See Also

- [HDA Catalog Reference](references/hda-catalog.md) - Full parameter documentation
- [Parameter Tuning Guide](references/parameter-guide.md) - Optimization tips
```

---

## 📋 Updated Phase 7 Checklist

### Core WorldGen (Original)
- [ ] Terrain generation commands and schemas
- [ ] Biome system with conditions and transitions
- [ ] Foliage scattering with placement rules
- [ ] PCG framework integration (UE5.3+)
- [ ] Export commands for all data types
- [ ] NoiseGenerator implementation

### Houdini Integration (Addendum)
- [ ] Availability checker (plugin/license/session detection)
- [ ] HDA execution schemas and commands
- [ ] AI-assisted HDA selection (intent analysis)
- [ ] Parameter mapper (NL → HDA parameters)
- [ ] PCG fallback registry and mapper
- [ ] Heightfield import/export bridge
- [ ] HDA catalog system (builtin + custom)
- [ ] UE5 C++ Houdini subsystem
- [ ] User skill example and documentation

---

## 🎯 Summary

This addendum provides:

1. **Full Houdini Engine Integration**
   - Plugin/license/session detection
   - HDA execution with parameter configuration
   - Heightfield data exchange (UE ↔ Houdini)

2. **AI-Assisted Workflow**
   - Natural language intent analysis
   - Automatic HDA selection based on request
   - Smart parameter mapping from user intent

3. **Graceful Fallback System**
   - PCG equivalents for all major HDAs
   - Quality degradation warnings
   - Native UE alternatives when PCG insufficient

4. **User-Uploadable Skills**
   - Complete skill structure example
   - HDA packaging and registration
   - Preset system for common configurations
   - Reference documentation pattern

The implementation follows AEGIS patterns with custom error classes, Zod schemas, and proper command annotations while maintaining the modular plugin architecture.
