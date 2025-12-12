/**
 * AEGIS Core Plugin - Material Commands
 * Commands for creating and modifying materials
 */

import { z } from 'zod';
import { CommandDefinition, CommandContext } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { ExecutionError } from '../../utils/errors.js';

// ============================================================================
// Schemas
// ============================================================================

const ColorSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
  a: z.number().min(0).max(1).optional().default(1),
});

const CreateMaterialParamsSchema = z.object({
  packagePath: z.string().describe('Package path for the material (e.g., /Game/Materials)'),
  materialName: z.string().describe('Name for the new material'),
  materialDomain: z.enum(['surface', 'deferred_decal', 'light_function', 'volume', 'post_process', 'ui'])
    .optional()
    .default('surface')
    .describe('Material domain'),
  blendMode: z.enum(['opaque', 'masked', 'translucent', 'additive', 'modulate'])
    .optional()
    .default('opaque')
    .describe('Blend mode'),
  shadingModel: z.enum(['unlit', 'default_lit', 'subsurface', 'preintegrated_skin', 'clear_coat', 'subsurface_profile', 'two_sided_foliage', 'hair', 'cloth', 'eye'])
    .optional()
    .default('default_lit')
    .describe('Shading model'),
  twoSided: z.boolean().optional().default(false).describe('Enable two-sided rendering'),
});

const CreateMaterialInstanceParamsSchema = z.object({
  packagePath: z.string().describe('Package path for the material instance'),
  instanceName: z.string().describe('Name for the material instance'),
  parentMaterial: z.string().describe('Path to the parent material'),
});

const SetMaterialParametersParamsSchema = z.object({
  materialPath: z.string().describe('Path to the material or material instance'),
  scalarParameters: z.record(z.number()).optional().describe('Scalar parameter values'),
  vectorParameters: z.record(ColorSchema).optional().describe('Vector parameter values (colors)'),
  textureParameters: z.record(z.string()).optional().describe('Texture parameter paths'),
});

const AddMaterialNodeParamsSchema = z.object({
  materialPath: z.string().describe('Path to the material'),
  nodeType: z.string().describe('Type of material expression node'),
  nodeClass: z.string().optional().describe('Specific node class'),
  position: z.object({ x: z.number(), y: z.number() }).optional().describe('Node position in graph'),
  properties: z.record(z.unknown()).optional().describe('Node properties'),
});

const ConnectMaterialNodesParamsSchema = z.object({
  materialPath: z.string().describe('Path to the material'),
  sourceNode: z.string().describe('Source node identifier or path'),
  sourceOutput: z.string().optional().describe('Source output pin name'),
  targetNode: z.string().describe('Target node or material output'),
  targetInput: z.string().describe('Target input pin name'),
});

const GetMaterialInfoParamsSchema = z.object({
  materialPath: z.string().describe('Path to the material'),
  includeParameters: z.boolean().optional().default(true),
  includeNodes: z.boolean().optional().default(false),
  includeTextures: z.boolean().optional().default(true),
});

const ApplyMaterialToActorParamsSchema = z.object({
  actorPath: z.string().describe('Path to the actor'),
  materialPath: z.string().describe('Path to the material'),
  materialIndex: z.number().int().min(0).optional().default(0).describe('Material slot index'),
  componentName: z.string().optional().describe('Specific component to apply material to'),
});

const CreateProceduralTextureParamsSchema = z.object({
  packagePath: z.string().describe('Package path for the texture'),
  textureName: z.string().describe('Name for the texture'),
  width: z.number().int().positive().describe('Texture width'),
  height: z.number().int().positive().describe('Texture height'),
  textureType: z.enum(['color', 'normal', 'grayscale', 'hdr']).optional().default('color'),
  pattern: z.enum(['solid', 'gradient', 'noise', 'checker', 'grid']).optional().describe('Pattern type'),
  patternParams: z.record(z.unknown()).optional().describe('Pattern-specific parameters'),
});

// ============================================================================
// Response Types
// ============================================================================

interface CreateMaterialResult {
  materialPath: string;
  materialType: string;
}

interface GetMaterialInfoResult {
  path: string;
  name: string;
  domain: string;
  blendMode: string;
  shadingModel: string;
  twoSided: boolean;
  parameters?: {
    scalar: Array<{ name: string; value: number; group?: string }>;
    vector: Array<{ name: string; value: { r: number; g: number; b: number; a: number }; group?: string }>;
    texture: Array<{ name: string; texturePath: string | null; group?: string }>;
  };
  textures?: string[];
  nodeCount?: number;
}

// ============================================================================
// Command Implementations
// ============================================================================

export function createMaterialCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // create_material
    // ========================================================================
    {
      name: 'create_material',
      description: 'Create a new material asset',
      inputSchema: CreateMaterialParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'material',
        tags: ['create', 'material', 'render'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<CreateMaterialResult> => {
        const params = context.params as z.infer<typeof CreateMaterialParamsSchema>;

        const materialPath = `${params.packagePath}/${params.materialName}`;

        // Map enum values to UE values
        const domainMap: Record<string, string> = {
          surface: 'MD_Surface',
          deferred_decal: 'MD_DeferredDecal',
          light_function: 'MD_LightFunction',
          volume: 'MD_Volume',
          post_process: 'MD_PostProcess',
          ui: 'MD_UI',
        };

        const blendModeMap: Record<string, string> = {
          opaque: 'BLEND_Opaque',
          masked: 'BLEND_Masked',
          translucent: 'BLEND_Translucent',
          additive: 'BLEND_Additive',
          modulate: 'BLEND_Modulate',
        };

        const shadingModelMap: Record<string, string> = {
          unlit: 'MSM_Unlit',
          default_lit: 'MSM_DefaultLit',
          subsurface: 'MSM_Subsurface',
          preintegrated_skin: 'MSM_PreintegratedSkin',
          clear_coat: 'MSM_ClearCoat',
          subsurface_profile: 'MSM_SubsurfaceProfile',
          two_sided_foliage: 'MSM_TwoSidedFoliage',
          hair: 'MSM_Hair',
          cloth: 'MSM_Cloth',
          eye: 'MSM_Eye',
        };

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/UnrealEd.Default__MaterialEditingLibrary',
          'CreateMaterial',
          {
            PackagePath: params.packagePath,
            MaterialName: params.materialName,
            MaterialDomain: domainMap[params.materialDomain],
            BlendMode: blendModeMap[params.blendMode],
            ShadingModel: shadingModelMap[params.shadingModel],
            TwoSided: params.twoSided,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'create_material',
            result.error || 'Failed to create material',
            { packagePath: params.packagePath, materialName: params.materialName }
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'asset',
          target: materialPath,
          changeType: 'create',
          newValue: { type: 'Material', domain: params.materialDomain },
          source: 'local',
          undoable: true,
        });

        return {
          materialPath: result.data.ReturnValue,
          materialType: 'Material',
        };
      },
    },

    // ========================================================================
    // create_material_instance
    // ========================================================================
    {
      name: 'create_material_instance',
      description: 'Create a material instance from a parent material',
      inputSchema: CreateMaterialInstanceParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'material',
        tags: ['create', 'material', 'instance'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<CreateMaterialResult> => {
        const params = context.params as z.infer<typeof CreateMaterialInstanceParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/UnrealEd.Default__MaterialEditingLibrary',
          'CreateMaterialInstance',
          {
            PackagePath: params.packagePath,
            InstanceName: params.instanceName,
            ParentMaterial: params.parentMaterial,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'create_material_instance',
            result.error || 'Failed to create material instance',
            { instanceName: params.instanceName }
          );
        }

        return {
          materialPath: result.data.ReturnValue,
          materialType: 'MaterialInstanceConstant',
        };
      },
    },

    // ========================================================================
    // set_material_parameters
    // ========================================================================
    {
      name: 'set_material_parameters',
      description: 'Set parameter values on a material or material instance',
      inputSchema: SetMaterialParametersParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'material',
        tags: ['parameter', 'material', 'modify'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ modified: string[] }> => {
        const params = context.params as z.infer<typeof SetMaterialParametersParamsSchema>;
        const modified: string[] = [];

        // Set scalar parameters
        if (params.scalarParameters) {
          for (const [name, value] of Object.entries(params.scalarParameters)) {
            const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
              '/Script/UnrealEd.Default__MaterialEditingLibrary',
              'SetScalarParameterValue',
              {
                Material: params.materialPath,
                ParameterName: name,
                ParameterValue: value,
              }
            );

            if (result.success && result.data?.ReturnValue) {
              modified.push(`scalar:${name}`);
            }
          }
        }

        // Set vector parameters
        if (params.vectorParameters) {
          for (const [name, value] of Object.entries(params.vectorParameters)) {
            const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
              '/Script/UnrealEd.Default__MaterialEditingLibrary',
              'SetVectorParameterValue',
              {
                Material: params.materialPath,
                ParameterName: name,
                ParameterValue: { R: value.r, G: value.g, B: value.b, A: value.a },
              }
            );

            if (result.success && result.data?.ReturnValue) {
              modified.push(`vector:${name}`);
            }
          }
        }

        // Set texture parameters
        if (params.textureParameters) {
          for (const [name, texturePath] of Object.entries(params.textureParameters)) {
            const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
              '/Script/UnrealEd.Default__MaterialEditingLibrary',
              'SetTextureParameterValue',
              {
                Material: params.materialPath,
                ParameterName: name,
                TexturePath: texturePath,
              }
            );

            if (result.success && result.data?.ReturnValue) {
              modified.push(`texture:${name}`);
            }
          }
        }

        return { modified };
      },
    },

    // ========================================================================
    // add_material_node
    // ========================================================================
    {
      name: 'add_material_node',
      description: 'Add a node to a material graph',
      inputSchema: AddMaterialNodeParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'material',
        tags: ['node', 'graph', 'material'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ nodeId: string; nodeType: string }> => {
        const params = context.params as z.infer<typeof AddMaterialNodeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/UnrealEd.Default__MaterialEditingLibrary',
          'AddMaterialExpression',
          {
            Material: params.materialPath,
            ExpressionClass: params.nodeClass || params.nodeType,
            NodePosX: params.position?.x || 0,
            NodePosY: params.position?.y || 0,
            Properties: params.properties,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'add_material_node',
            result.error || 'Failed to add material node',
            { nodeType: params.nodeType }
          );
        }

        return {
          nodeId: result.data.ReturnValue,
          nodeType: params.nodeType,
        };
      },
    },

    // ========================================================================
    // connect_material_nodes
    // ========================================================================
    {
      name: 'connect_material_nodes',
      description: 'Connect nodes in a material graph',
      inputSchema: ConnectMaterialNodesParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'material',
        tags: ['connect', 'node', 'graph', 'material'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ connected: boolean }> => {
        const params = context.params as z.infer<typeof ConnectMaterialNodesParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/UnrealEd.Default__MaterialEditingLibrary',
          'ConnectMaterialExpressions',
          {
            Material: params.materialPath,
            FromExpression: params.sourceNode,
            FromOutputName: params.sourceOutput || '',
            ToExpression: params.targetNode,
            ToInputName: params.targetInput,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'connect_material_nodes',
            result.error || 'Failed to connect nodes',
            params
          );
        }

        return {
          connected: result.data.ReturnValue,
        };
      },
    },

    // ========================================================================
    // get_material_info
    // ========================================================================
    {
      name: 'get_material_info',
      description: 'Get information about a material',
      inputSchema: GetMaterialInfoParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'material',
        tags: ['info', 'material', 'inspect'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<GetMaterialInfoResult> => {
        const params = context.params as z.infer<typeof GetMaterialInfoParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Name: string;
            Domain: string;
            BlendMode: string;
            ShadingModel: string;
            TwoSided: boolean;
            ScalarParameters: Array<{ Name: string; Value: number; Group?: string }>;
            VectorParameters: Array<{ Name: string; Value: { R: number; G: number; B: number; A: number }; Group?: string }>;
            TextureParameters: Array<{ Name: string; TexturePath: string | null; Group?: string }>;
            NodeCount: number;
          };
        }>(
          '/Script/UnrealEd.Default__MaterialEditingLibrary',
          'GetMaterialInfo',
          { Material: params.materialPath }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'get_material_info',
            result.error || 'Failed to get material info',
            { materialPath: params.materialPath }
          );
        }

        const data = result.data.ReturnValue;
        const info: GetMaterialInfoResult = {
          path: params.materialPath,
          name: data.Name,
          domain: data.Domain,
          blendMode: data.BlendMode,
          shadingModel: data.ShadingModel,
          twoSided: data.TwoSided,
        };

        if (params.includeParameters) {
          info.parameters = {
            scalar: data.ScalarParameters.map((p) => ({
              name: p.Name,
              value: p.Value,
              group: p.Group,
            })),
            vector: data.VectorParameters.map((p) => ({
              name: p.Name,
              value: { r: p.Value.R, g: p.Value.G, b: p.Value.B, a: p.Value.A },
              group: p.Group,
            })),
            texture: data.TextureParameters.map((p) => ({
              name: p.Name,
              texturePath: p.TexturePath,
              group: p.Group,
            })),
          };
        }

        if (params.includeTextures) {
          info.textures = data.TextureParameters
            .filter((p) => p.TexturePath)
            .map((p) => p.TexturePath!);
        }

        if (params.includeNodes) {
          info.nodeCount = data.NodeCount;
        }

        return info;
      },
    },

    // ========================================================================
    // apply_material_to_actor
    // ========================================================================
    {
      name: 'apply_material_to_actor',
      description: 'Apply a material to an actor\'s mesh component',
      inputSchema: ApplyMaterialToActorParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'material',
        tags: ['apply', 'material', 'actor'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ applied: boolean; materialIndex: number }> => {
        const params = context.params as z.infer<typeof ApplyMaterialToActorParamsSchema>;

        // Get the component to apply material to
        const componentPath = params.componentName
          ? `${params.actorPath}.${params.componentName}`
          : `${params.actorPath}.StaticMeshComponent0`; // Default to first static mesh

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          componentPath,
          'SetMaterial',
          {
            ElementIndex: params.materialIndex,
            Material: params.materialPath,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'apply_material_to_actor',
            result.error || 'Failed to apply material',
            { actorPath: params.actorPath, materialPath: params.materialPath }
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: params.actorPath,
          changeType: 'modify',
          newValue: { material: params.materialPath, index: params.materialIndex },
          source: 'local',
          undoable: true,
        });

        return {
          applied: true,
          materialIndex: params.materialIndex,
        };
      },
    },

    // ========================================================================
    // create_procedural_texture
    // ========================================================================
    {
      name: 'create_procedural_texture',
      description: 'Create a procedural texture asset',
      inputSchema: CreateProceduralTextureParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'material',
        tags: ['texture', 'procedural', 'create'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ texturePath: string; textureType: string }> => {
        const params = context.params as z.infer<typeof CreateProceduralTextureParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/UnrealEd.Default__EditorTextureLibrary',
          'CreateProceduralTexture',
          {
            PackagePath: params.packagePath,
            TextureName: params.textureName,
            Width: params.width,
            Height: params.height,
            TextureType: params.textureType,
            Pattern: params.pattern,
            PatternParams: params.patternParams,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'create_procedural_texture',
            result.error || 'Failed to create texture',
            { textureName: params.textureName }
          );
        }

        return {
          texturePath: result.data.ReturnValue,
          textureType: params.textureType,
        };
      },
    },
  ];
}
