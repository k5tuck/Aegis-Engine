/**
 * AEGIS Houdini Plugin
 * Houdini Engine integration with PCG fallbacks (Phase 7 Addendum)
 */

import { z } from 'zod';
import { AegisPlugin, PluginLoadContext, CommandDefinition, CommandContext } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { Logger } from '../../utils/logger.js';
import { HoudiniNotAvailableError, HDANotFoundError, ExecutionError } from '../../utils/errors.js';

// ============================================================================
// Plugin Metadata
// ============================================================================

const PLUGIN_ID = 'aegis.houdini';
const PLUGIN_VERSION = '1.0.0';
const PLUGIN_NAMESPACE = 'aegis.houdini';

// ============================================================================
// Plugin State
// ============================================================================

let pluginBridge: BridgeManager | null = null;
let pluginLogger: Logger | null = null;
let houdiniAvailable: boolean = false;

// ============================================================================
// Schemas
// ============================================================================

const HDAParameterSchema = z.object({
  name: z.string(),
  value: z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]),
});

const LoadHDAParamsSchema = z.object({
  hdaPath: z.string().describe('Path to the HDA file or asset'),
  assetName: z.string().optional().describe('Specific asset name within HDA'),
  instantiate: z.boolean().optional().default(true).describe('Immediately instantiate the asset'),
});

const InstantiateHDAParamsSchema = z.object({
  hdaPath: z.string().describe('Path to the loaded HDA'),
  location: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
  parameters: z.array(HDAParameterSchema).optional(),
  autoGenerate: z.boolean().optional().default(true),
});

const SetHDAParametersParamsSchema = z.object({
  actorPath: z.string().describe('Path to the Houdini asset actor'),
  parameters: z.array(HDAParameterSchema).describe('Parameters to set'),
  triggerCook: z.boolean().optional().default(true).describe('Trigger recook after setting'),
});

const CookHDAParamsSchema = z.object({
  actorPath: z.string().describe('Path to the Houdini asset actor'),
  synchronous: z.boolean().optional().default(false),
  force: z.boolean().optional().default(false),
});

const GetHDAInfoParamsSchema = z.object({
  hdaPath: z.string().describe('Path to the HDA'),
  includeParameters: z.boolean().optional().default(true),
  includeInputs: z.boolean().optional().default(true),
  includeOutputs: z.boolean().optional().default(true),
});

const ConnectHDAInputParamsSchema = z.object({
  actorPath: z.string().describe('Path to the Houdini asset actor'),
  inputIndex: z.number().int().min(0).describe('Input index'),
  sourceActor: z.string().describe('Actor to connect as input'),
  sourceOutput: z.number().int().min(0).optional().default(0),
});

const BakeHDAParamsSchema = z.object({
  actorPath: z.string().describe('Path to the Houdini asset actor'),
  bakeMode: z.enum(['static_mesh', 'blueprint', 'actor', 'landscape']).optional().default('static_mesh'),
  targetPath: z.string().optional().describe('Target path for baked assets'),
  replacementMode: z.enum(['keep_hda', 'delete_hda', 'replace']).optional().default('keep_hda'),
});

const CreateHDAPresetParamsSchema = z.object({
  actorPath: z.string().describe('Path to the Houdini asset actor'),
  presetName: z.string().describe('Name for the preset'),
  presetPath: z.string().optional().describe('Path to save preset'),
});

const ApplyHDAPresetParamsSchema = z.object({
  actorPath: z.string().describe('Path to the Houdini asset actor'),
  presetPath: z.string().describe('Path to the preset'),
});

const ListHDAsParamsSchema = z.object({
  searchPath: z.string().optional().describe('Path to search for HDAs'),
  includeBuiltIn: z.boolean().optional().default(true),
});

const FallbackToPCGParamsSchema = z.object({
  hdaPath: z.string().describe('Path to the HDA that failed'),
  fallbackGraph: z.string().describe('PCG graph to use as fallback'),
  targetLocation: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
  parameters: z.record(z.unknown()).optional(),
});

// ============================================================================
// Response Types
// ============================================================================

interface HDAInfo {
  path: string;
  name: string;
  label: string;
  version: string;
  parameters?: Array<{
    name: string;
    label: string;
    type: string;
    defaultValue: unknown;
    min?: number;
    max?: number;
  }>;
  inputs?: Array<{
    index: number;
    name: string;
    type: string;
  }>;
  outputs?: Array<{
    index: number;
    name: string;
    type: string;
  }>;
}

interface CookResult {
  cooked: boolean;
  cookTimeMs: number;
  outputCount: number;
  warnings: string[];
  errors: string[];
}

interface BakeResult {
  baked: boolean;
  bakedAssets: string[];
  bakedActors: string[];
}

// ============================================================================
// Command Implementations
// ============================================================================

function createHoudiniCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // load_hda
    // ========================================================================
    {
      name: 'load_hda',
      description: 'Load a Houdini Digital Asset (HDA) into the project',
      inputSchema: LoadHDAParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'houdini',
        tags: ['load', 'hda', 'houdini', 'asset'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ loaded: boolean; assetPath: string }> => {
        const params = context.params as z.infer<typeof LoadHDAParamsSchema>;

        await ensureHoudiniAvailable(bridge);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; AssetPath: string };
        }>(
          '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
          'LoadHDA',
          {
            HDAPath: params.hdaPath,
            AssetName: params.assetName,
            Instantiate: params.instantiate,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new HDANotFoundError(
            params.hdaPath,
            result.error || 'Failed to load HDA'
          );
        }

        return {
          loaded: true,
          assetPath: result.data.ReturnValue.AssetPath,
        };
      },
    },

    // ========================================================================
    // instantiate_hda
    // ========================================================================
    {
      name: 'instantiate_hda',
      description: 'Instantiate a loaded HDA in the level',
      inputSchema: InstantiateHDAParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'houdini',
        tags: ['instantiate', 'spawn', 'hda', 'houdini'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ actorPath: string; instantiated: boolean }> => {
        const params = context.params as z.infer<typeof InstantiateHDAParamsSchema>;

        await ensureHoudiniAvailable(bridge);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; ActorPath: string };
        }>(
          '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
          'InstantiateHDA',
          {
            HDAPath: params.hdaPath,
            Location: params.location,
            Parameters: params.parameters,
            AutoGenerate: params.autoGenerate,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new ExecutionError(
            'instantiate_hda',
            result.error || 'Failed to instantiate HDA',
            { hdaPath: params.hdaPath }
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: result.data.ReturnValue.ActorPath,
          changeType: 'create',
          newValue: { type: 'HoudiniAsset', hda: params.hdaPath },
          source: 'local',
          undoable: true,
        });

        return {
          actorPath: result.data.ReturnValue.ActorPath,
          instantiated: true,
        };
      },
    },

    // ========================================================================
    // set_hda_parameters
    // ========================================================================
    {
      name: 'set_hda_parameters',
      description: 'Set parameters on a Houdini asset',
      inputSchema: SetHDAParametersParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'houdini',
        tags: ['parameters', 'set', 'hda', 'houdini'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ parametersSet: string[] }> => {
        const params = context.params as z.infer<typeof SetHDAParametersParamsSchema>;

        await ensureHoudiniAvailable(bridge);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { ParametersSet: string[] };
        }>(
          '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
          'SetHDAParameters',
          {
            ActorPath: params.actorPath,
            Parameters: params.parameters,
            TriggerCook: params.triggerCook,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'set_hda_parameters',
            result.error || 'Failed to set HDA parameters',
            { actorPath: params.actorPath }
          );
        }

        return {
          parametersSet: result.data?.ReturnValue.ParametersSet || [],
        };
      },
    },

    // ========================================================================
    // cook_hda
    // ========================================================================
    {
      name: 'cook_hda',
      description: 'Cook/generate a Houdini asset',
      inputSchema: CookHDAParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'houdini',
        tags: ['cook', 'generate', 'hda', 'houdini'],
        estimatedDuration: 'slow',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<CookResult> => {
        const params = context.params as z.infer<typeof CookHDAParamsSchema>;

        await ensureHoudiniAvailable(bridge);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            CookTimeMs: number;
            OutputCount: number;
            Warnings: string[];
            Errors: string[];
          };
        }>(
          '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
          'CookHDA',
          {
            ActorPath: params.actorPath,
            Synchronous: params.synchronous,
            Force: params.force,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new ExecutionError(
            'cook_hda',
            result.error || 'Failed to cook HDA',
            { actorPath: params.actorPath, errors: result.data?.ReturnValue.Errors }
          );
        }

        return {
          cooked: true,
          cookTimeMs: result.data.ReturnValue.CookTimeMs,
          outputCount: result.data.ReturnValue.OutputCount,
          warnings: result.data.ReturnValue.Warnings,
          errors: result.data.ReturnValue.Errors,
        };
      },
    },

    // ========================================================================
    // get_hda_info
    // ========================================================================
    {
      name: 'get_hda_info',
      description: 'Get information about a Houdini Digital Asset',
      inputSchema: GetHDAInfoParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'houdini',
        tags: ['info', 'hda', 'houdini'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<HDAInfo> => {
        const params = context.params as z.infer<typeof GetHDAInfoParamsSchema>;

        await ensureHoudiniAvailable(bridge);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Name: string;
            Label: string;
            Version: string;
            Parameters?: Array<{
              Name: string;
              Label: string;
              Type: string;
              DefaultValue: unknown;
              Min?: number;
              Max?: number;
            }>;
            Inputs?: Array<{
              Index: number;
              Name: string;
              Type: string;
            }>;
            Outputs?: Array<{
              Index: number;
              Name: string;
              Type: string;
            }>;
          };
        }>(
          '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
          'GetHDAInfo',
          {
            HDAPath: params.hdaPath,
            IncludeParameters: params.includeParameters,
            IncludeInputs: params.includeInputs,
            IncludeOutputs: params.includeOutputs,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new HDANotFoundError(
            params.hdaPath,
            result.error || 'Failed to get HDA info'
          );
        }

        const data = result.data.ReturnValue;

        return {
          path: params.hdaPath,
          name: data.Name,
          label: data.Label,
          version: data.Version,
          parameters: data.Parameters?.map((p) => ({
            name: p.Name,
            label: p.Label,
            type: p.Type,
            defaultValue: p.DefaultValue,
            min: p.Min,
            max: p.Max,
          })),
          inputs: data.Inputs?.map((i) => ({
            index: i.Index,
            name: i.Name,
            type: i.Type,
          })),
          outputs: data.Outputs?.map((o) => ({
            index: o.Index,
            name: o.Name,
            type: o.Type,
          })),
        };
      },
    },

    // ========================================================================
    // connect_hda_input
    // ========================================================================
    {
      name: 'connect_hda_input',
      description: 'Connect an actor as input to a Houdini asset',
      inputSchema: ConnectHDAInputParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'houdini',
        tags: ['connect', 'input', 'hda', 'houdini'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ connected: boolean }> => {
        const params = context.params as z.infer<typeof ConnectHDAInputParamsSchema>;

        await ensureHoudiniAvailable(bridge);

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
          'ConnectHDAInput',
          {
            ActorPath: params.actorPath,
            InputIndex: params.inputIndex,
            SourceActor: params.sourceActor,
            SourceOutput: params.sourceOutput,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'connect_hda_input',
            result.error || 'Failed to connect HDA input',
            { actorPath: params.actorPath, inputIndex: params.inputIndex }
          );
        }

        return {
          connected: true,
        };
      },
    },

    // ========================================================================
    // bake_hda
    // ========================================================================
    {
      name: 'bake_hda',
      description: 'Bake Houdini asset output to static assets',
      inputSchema: BakeHDAParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'houdini',
        tags: ['bake', 'export', 'hda', 'houdini'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<BakeResult> => {
        const params = context.params as z.infer<typeof BakeHDAParamsSchema>;

        await ensureHoudiniAvailable(bridge);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            BakedAssets: string[];
            BakedActors: string[];
          };
        }>(
          '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
          'BakeHDA',
          {
            ActorPath: params.actorPath,
            BakeMode: params.bakeMode,
            TargetPath: params.targetPath,
            ReplacementMode: params.replacementMode,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new ExecutionError(
            'bake_hda',
            result.error || 'Failed to bake HDA',
            { actorPath: params.actorPath }
          );
        }

        return {
          baked: true,
          bakedAssets: result.data.ReturnValue.BakedAssets,
          bakedActors: result.data.ReturnValue.BakedActors,
        };
      },
    },

    // ========================================================================
    // create_hda_preset
    // ========================================================================
    {
      name: 'create_hda_preset',
      description: 'Create a preset from current HDA parameter values',
      inputSchema: CreateHDAPresetParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'houdini',
        tags: ['preset', 'create', 'hda', 'houdini'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ presetPath: string }> => {
        const params = context.params as z.infer<typeof CreateHDAPresetParamsSchema>;

        await ensureHoudiniAvailable(bridge);

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
          'CreateHDAPreset',
          {
            ActorPath: params.actorPath,
            PresetName: params.presetName,
            PresetPath: params.presetPath,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'create_hda_preset',
            result.error || 'Failed to create HDA preset',
            { actorPath: params.actorPath }
          );
        }

        return {
          presetPath: result.data.ReturnValue,
        };
      },
    },

    // ========================================================================
    // apply_hda_preset
    // ========================================================================
    {
      name: 'apply_hda_preset',
      description: 'Apply a preset to a Houdini asset',
      inputSchema: ApplyHDAPresetParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'houdini',
        tags: ['preset', 'apply', 'hda', 'houdini'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ applied: boolean }> => {
        const params = context.params as z.infer<typeof ApplyHDAPresetParamsSchema>;

        await ensureHoudiniAvailable(bridge);

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
          'ApplyHDAPreset',
          {
            ActorPath: params.actorPath,
            PresetPath: params.presetPath,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'apply_hda_preset',
            result.error || 'Failed to apply HDA preset',
            { actorPath: params.actorPath }
          );
        }

        return {
          applied: true,
        };
      },
    },

    // ========================================================================
    // list_hdas
    // ========================================================================
    {
      name: 'list_hdas',
      description: 'List available Houdini Digital Assets',
      inputSchema: ListHDAsParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'houdini',
        tags: ['list', 'hda', 'houdini'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{
        hdas: Array<{ path: string; name: string; label: string }>;
        count: number;
      }> => {
        const params = context.params as z.infer<typeof ListHDAsParamsSchema>;

        await ensureHoudiniAvailable(bridge);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: Array<{ Path: string; Name: string; Label: string }>;
        }>(
          '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
          'ListHDAs',
          {
            SearchPath: params.searchPath,
            IncludeBuiltIn: params.includeBuiltIn,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'list_hdas',
            result.error || 'Failed to list HDAs',
            {}
          );
        }

        const hdas = result.data?.ReturnValue || [];

        return {
          hdas: hdas.map((h) => ({
            path: h.Path,
            name: h.Name,
            label: h.Label,
          })),
          count: hdas.length,
        };
      },
    },

    // ========================================================================
    // fallback_to_pcg
    // ========================================================================
    {
      name: 'fallback_to_pcg',
      description: 'Use PCG graph as fallback when Houdini is unavailable',
      inputSchema: FallbackToPCGParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'houdini',
        tags: ['fallback', 'pcg', 'houdini'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{
        usedFallback: boolean;
        pcgResult: {
          executed: boolean;
          generatedActors: number;
        };
      }> => {
        const params = context.params as z.infer<typeof FallbackToPCGParamsSchema>;

        // Try Houdini first
        if (houdiniAvailable) {
          try {
            // If Houdini works, we shouldn't use fallback
            return {
              usedFallback: false,
              pcgResult: { executed: false, generatedActors: 0 },
            };
          } catch {
            // Fall through to PCG
          }
        }

        // Use PCG fallback
        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            GeneratedActors: number;
          };
        }>(
          '/Script/PCG.Default__PCGBlueprintHelpers',
          'ExecutePCGGraph',
          {
            GraphPath: params.fallbackGraph,
            Location: params.targetLocation,
            Parameters: params.parameters,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new ExecutionError(
            'fallback_to_pcg',
            result.error || 'Failed to execute PCG fallback',
            { fallbackGraph: params.fallbackGraph }
          );
        }

        return {
          usedFallback: true,
          pcgResult: {
            executed: true,
            generatedActors: result.data.ReturnValue.GeneratedActors,
          },
        };
      },
    },

    // ========================================================================
    // check_houdini_status
    // ========================================================================
    {
      name: 'check_houdini_status',
      description: 'Check Houdini Engine availability and status',
      inputSchema: z.object({}),
      annotations: {
        riskLevel: 'low',
        category: 'houdini',
        tags: ['status', 'check', 'houdini'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (): Promise<{
        available: boolean;
        version?: string;
        licensetype?: string;
        sessionId?: number;
      }> => {
        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Available: boolean;
            Version?: string;
            LicenseType?: string;
            SessionId?: number;
          };
        }>(
          '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
          'GetHoudiniStatus'
        );

        houdiniAvailable = result.success && result.data?.ReturnValue.Available === true;

        return {
          available: houdiniAvailable,
          version: result.data?.ReturnValue.Version,
          licensetype: result.data?.ReturnValue.LicenseType,
          sessionId: result.data?.ReturnValue.SessionId,
        };
      },
    },
  ];
}

// ============================================================================
// Helper Functions
// ============================================================================

async function ensureHoudiniAvailable(bridge: BridgeManager): Promise<void> {
  if (houdiniAvailable) {
    return;
  }

  const result = await bridge.remoteControl.callFunction<{
    ReturnValue: { Available: boolean };
  }>(
    '/Script/HoudiniEngineRuntime.Default__HoudiniEngineSubsystem',
    'GetHoudiniStatus'
  );

  if (!result.success || !result.data?.ReturnValue.Available) {
    throw new HoudiniNotAvailableError(
      'Houdini Engine is not available. Ensure Houdini Engine plugin is installed and a valid license is available.'
    );
  }

  houdiniAvailable = true;
}

// ============================================================================
// Plugin Factory
// ============================================================================

export function createHoudiniPlugin(bridge: BridgeManager, logger: Logger): AegisPlugin {
  const allCommands = createHoudiniCommands(bridge);

  const commandsWithLogger = allCommands.map((cmd) => ({
    ...cmd,
    handler: async (context: any) => {
      return cmd.handler({
        ...context,
        logger: logger.child({ command: cmd.name }),
      });
    },
  }));

  return {
    metadata: {
      id: PLUGIN_ID,
      name: 'AEGIS Houdini',
      version: PLUGIN_VERSION,
      description: 'Houdini Engine integration with PCG fallbacks for procedural content generation',
      author: 'AEGIS Team',
      namespace: PLUGIN_NAMESPACE,
      tags: ['houdini', 'hda', 'procedural', 'worldgen'],
      dependencies: [
        {
          pluginId: 'aegis.worldgen',
          minVersion: '1.0.0',
          optional: true,
        },
      ],
    },

    commands: commandsWithLogger,

    onLoad: async (context: PluginLoadContext) => {
      pluginBridge = bridge;
      pluginLogger = logger;

      logger.info('AEGIS Houdini Plugin loaded', {
        version: PLUGIN_VERSION,
        commandCount: allCommands.length,
      });

      // Check Houdini availability
      try {
        await ensureHoudiniAvailable(bridge);
        logger.info('Houdini Engine is available');
      } catch {
        logger.warn('Houdini Engine is not available - PCG fallbacks will be used');
      }
    },

    onUnload: async () => {
      logger.info('AEGIS Houdini Plugin unloading');
      pluginBridge = null;
      pluginLogger = null;
    },

    healthCheck: async () => {
      return {
        healthy: true,
        message: houdiniAvailable ? 'Houdini Engine available' : 'Using PCG fallbacks',
      };
    },
  };
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  metadata: {
    id: PLUGIN_ID,
    name: 'AEGIS Houdini',
    version: PLUGIN_VERSION,
    description: 'Houdini Engine integration with PCG fallbacks',
    author: 'AEGIS Team',
    namespace: PLUGIN_NAMESPACE,
    tags: ['houdini', 'hda', 'procedural', 'worldgen'],
  },
  commands: [],
  onLoad: async () => console.log('AEGIS Houdini Plugin loaded'),
  onUnload: async () => console.log('AEGIS Houdini Plugin unloaded'),
};
