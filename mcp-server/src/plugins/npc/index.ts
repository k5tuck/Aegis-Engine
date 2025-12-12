/**
 * AEGIS NPC/AI Plugin
 * AI behavior system with ONNX integration and behavior trees (Phase 8)
 */

import { z } from 'zod';
import { AegisPlugin, PluginLoadContext, CommandDefinition, CommandContext } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { Logger } from '../../utils/logger.js';
import { ONNXModelError, BehaviorTreeError, ExecutionError } from '../../utils/errors.js';

// ============================================================================
// Plugin Metadata
// ============================================================================

const PLUGIN_ID = 'aegis.npc';
const PLUGIN_VERSION = '1.0.0';
const PLUGIN_NAMESPACE = 'aegis.npc';

// ============================================================================
// Schemas
// ============================================================================

// ONNX Schemas
const LoadONNXModelParamsSchema = z.object({
  modelPath: z.string().describe('Path to the ONNX model file'),
  modelName: z.string().describe('Name to register the model under'),
  executionProvider: z.enum(['cpu', 'cuda', 'directml', 'tensorrt']).optional().default('cpu'),
  optimizationLevel: z.enum(['disabled', 'basic', 'extended', 'all']).optional().default('all'),
});

const RunONNXInferenceParamsSchema = z.object({
  modelName: z.string().describe('Registered model name'),
  inputs: z.record(z.array(z.number())).describe('Input tensors keyed by name'),
  outputNames: z.array(z.string()).optional().describe('Specific outputs to retrieve'),
});

const GetONNXModelInfoParamsSchema = z.object({
  modelName: z.string().describe('Registered model name'),
});

// Behavior Tree Schemas
const CreateBehaviorTreeParamsSchema = z.object({
  packagePath: z.string().describe('Package path for the behavior tree'),
  treeName: z.string().describe('Name for the behavior tree'),
  description: z.string().optional(),
  rootType: z.enum(['selector', 'sequence', 'parallel']).optional().default('selector'),
});

const AddBTNodeParamsSchema = z.object({
  treePath: z.string().describe('Path to the behavior tree'),
  parentNode: z.string().optional().describe('Parent node ID (root if not specified)'),
  nodeType: z.enum([
    'selector', 'sequence', 'parallel', 'decorator', 'service',
    'task_move_to', 'task_wait', 'task_play_animation', 'task_custom',
    'decorator_blackboard', 'decorator_loop', 'decorator_cooldown',
    'service_update_blackboard', 'service_custom',
  ]).describe('Type of node to add'),
  nodeName: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});

const SetBlackboardKeyParamsSchema = z.object({
  aiControllerPath: z.string().describe('Path to the AI controller'),
  keyName: z.string().describe('Blackboard key name'),
  keyType: z.enum(['bool', 'int', 'float', 'string', 'vector', 'rotator', 'object', 'class', 'enum', 'name']),
  value: z.unknown().describe('Value to set'),
});

const RunBehaviorTreeParamsSchema = z.object({
  aiControllerPath: z.string().describe('Path to the AI controller'),
  treePath: z.string().describe('Path to the behavior tree'),
  startImmediately: z.boolean().optional().default(true),
});

const CreateAIControllerParamsSchema = z.object({
  packagePath: z.string().describe('Package path'),
  controllerName: z.string().describe('Name for the AI controller'),
  parentClass: z.string().optional().default('/Script/AIModule.AIController'),
  behaviorTree: z.string().optional().describe('Initial behavior tree'),
  blackboardAsset: z.string().optional().describe('Blackboard data asset'),
});

const SpawnAICharacterParamsSchema = z.object({
  characterClass: z.string().describe('Character Blueprint or class path'),
  location: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  rotation: z.object({ pitch: z.number(), yaw: z.number(), roll: z.number() }).optional(),
  aiController: z.string().optional().describe('AI controller class'),
  behaviorTree: z.string().optional().describe('Behavior tree to run'),
  teamId: z.number().int().optional(),
  displayName: z.string().optional(),
});

const ConfigurePerceptionParamsSchema = z.object({
  aiControllerPath: z.string().describe('Path to the AI controller'),
  senses: z.array(z.object({
    senseType: z.enum(['sight', 'hearing', 'damage', 'touch', 'team', 'prediction']),
    enabled: z.boolean().optional().default(true),
    config: z.record(z.unknown()).optional(),
  })).describe('Perception senses to configure'),
  dominantSense: z.enum(['sight', 'hearing', 'damage', 'touch', 'team', 'prediction']).optional(),
});

const QueryAIDecisionParamsSchema = z.object({
  aiControllerPath: z.string().describe('Path to the AI controller'),
  decisionContext: z.record(z.unknown()).optional().describe('Context for the decision'),
  useONNX: z.boolean().optional().default(false).describe('Use ONNX model for decision'),
  modelName: z.string().optional().describe('ONNX model to use'),
});

const CreateEQSQueryParamsSchema = z.object({
  packagePath: z.string().describe('Package path'),
  queryName: z.string().describe('Name for the EQS query'),
  generators: z.array(z.object({
    type: z.enum(['points_around', 'points_on_grid', 'points_on_circle', 'actors_of_class', 'current_location']),
    settings: z.record(z.unknown()).optional(),
  })).describe('Query generators'),
  tests: z.array(z.object({
    type: z.enum(['distance', 'trace', 'dot', 'pathfinding', 'overlap', 'random']),
    settings: z.record(z.unknown()).optional(),
  })).optional().describe('Query tests'),
});

const RunEQSQueryParamsSchema = z.object({
  aiControllerPath: z.string().describe('Path to the AI controller'),
  queryPath: z.string().describe('Path to the EQS query'),
  queryParams: z.record(z.unknown()).optional(),
  resultLimit: z.number().int().positive().optional().default(10),
});

// ============================================================================
// Response Types
// ============================================================================

interface ONNXModelInfo {
  name: string;
  path: string;
  inputs: Array<{ name: string; shape: number[]; type: string }>;
  outputs: Array<{ name: string; shape: number[]; type: string }>;
  executionProvider: string;
}

interface BTNodeInfo {
  id: string;
  type: string;
  name: string;
  children: string[];
  decorators: string[];
  services: string[];
}

interface AIDecisionResult {
  decision: string;
  confidence: number;
  alternatives: Array<{ action: string; score: number }>;
  usedONNX: boolean;
}

interface EQSQueryResult {
  items: Array<{
    location: { x: number; y: number; z: number };
    score: number;
    actor?: string;
  }>;
  bestItem: {
    location: { x: number; y: number; z: number };
    score: number;
    actor?: string;
  } | null;
}

// ============================================================================
// Command Implementations
// ============================================================================

function createNPCCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // ONNX Commands
    // ========================================================================
    {
      name: 'load_onnx_model',
      description: 'Load an ONNX model for AI inference',
      inputSchema: LoadONNXModelParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'onnx',
        tags: ['onnx', 'model', 'ai', 'ml', 'load'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ loaded: boolean; modelInfo: ONNXModelInfo }> => {
        const params = context.params as z.infer<typeof LoadONNXModelParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            ModelInfo: {
              Name: string;
              Path: string;
              Inputs: Array<{ Name: string; Shape: number[]; Type: string }>;
              Outputs: Array<{ Name: string; Shape: number[]; Type: string }>;
              ExecutionProvider: string;
            };
          };
        }>(
          '/Script/NNE.Default__NNERuntimeBasicCPU',
          'LoadONNXModel',
          {
            ModelPath: params.modelPath,
            ModelName: params.modelName,
            ExecutionProvider: params.executionProvider,
            OptimizationLevel: params.optimizationLevel,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new ONNXModelError(
            params.modelName,
            'load',
            result.error || 'Failed to load ONNX model'
          );
        }

        const info = result.data.ReturnValue.ModelInfo;

        return {
          loaded: true,
          modelInfo: {
            name: info.Name,
            path: info.Path,
            inputs: info.Inputs.map((i) => ({ name: i.Name, shape: i.Shape, type: i.Type })),
            outputs: info.Outputs.map((o) => ({ name: o.Name, shape: o.Shape, type: o.Type })),
            executionProvider: info.ExecutionProvider,
          },
        };
      },
    },

    {
      name: 'run_onnx_inference',
      description: 'Run inference on a loaded ONNX model',
      inputSchema: RunONNXInferenceParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'onnx',
        tags: ['onnx', 'inference', 'ai', 'ml'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{
        outputs: Record<string, number[]>;
        inferenceTimeMs: number;
      }> => {
        const params = context.params as z.infer<typeof RunONNXInferenceParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            Outputs: Record<string, number[]>;
            InferenceTimeMs: number;
          };
        }>(
          '/Script/NNE.Default__NNERuntimeBasicCPU',
          'RunInference',
          {
            ModelName: params.modelName,
            Inputs: params.inputs,
            OutputNames: params.outputNames,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new ONNXModelError(
            params.modelName,
            'inference',
            result.error || 'Inference failed'
          );
        }

        return {
          outputs: result.data.ReturnValue.Outputs,
          inferenceTimeMs: result.data.ReturnValue.InferenceTimeMs,
        };
      },
    },

    {
      name: 'get_onnx_model_info',
      description: 'Get information about a loaded ONNX model',
      inputSchema: GetONNXModelInfoParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'onnx',
        tags: ['onnx', 'info', 'model'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<ONNXModelInfo> => {
        const params = context.params as z.infer<typeof GetONNXModelInfoParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Name: string;
            Path: string;
            Inputs: Array<{ Name: string; Shape: number[]; Type: string }>;
            Outputs: Array<{ Name: string; Shape: number[]; Type: string }>;
            ExecutionProvider: string;
          };
        }>(
          '/Script/NNE.Default__NNERuntimeBasicCPU',
          'GetModelInfo',
          { ModelName: params.modelName }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ONNXModelError(params.modelName, 'get_info', 'Model not found');
        }

        const info = result.data.ReturnValue;
        return {
          name: info.Name,
          path: info.Path,
          inputs: info.Inputs.map((i) => ({ name: i.Name, shape: i.Shape, type: i.Type })),
          outputs: info.Outputs.map((o) => ({ name: o.Name, shape: o.Shape, type: o.Type })),
          executionProvider: info.ExecutionProvider,
        };
      },
    },

    // ========================================================================
    // Behavior Tree Commands
    // ========================================================================
    {
      name: 'create_behavior_tree',
      description: 'Create a new behavior tree asset',
      inputSchema: CreateBehaviorTreeParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'behavior',
        tags: ['behavior', 'tree', 'ai', 'create'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ treePath: string }> => {
        const params = context.params as z.infer<typeof CreateBehaviorTreeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/AIModule.Default__BehaviorTreeEditorUtils',
          'CreateBehaviorTree',
          {
            PackagePath: params.packagePath,
            TreeName: params.treeName,
            Description: params.description,
            RootType: params.rootType,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new BehaviorTreeError(
            params.treeName,
            'create',
            result.error || 'Failed to create behavior tree'
          );
        }

        return { treePath: result.data.ReturnValue };
      },
    },

    {
      name: 'add_bt_node',
      description: 'Add a node to a behavior tree',
      inputSchema: AddBTNodeParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'behavior',
        tags: ['behavior', 'node', 'add'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ nodeId: string; nodeType: string }> => {
        const params = context.params as z.infer<typeof AddBTNodeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { NodeId: string; NodeType: string };
        }>(
          '/Script/AIModule.Default__BehaviorTreeEditorUtils',
          'AddBTNode',
          {
            TreePath: params.treePath,
            ParentNode: params.parentNode,
            NodeType: params.nodeType,
            NodeName: params.nodeName,
            Settings: params.settings,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new BehaviorTreeError(
            params.treePath,
            'add_node',
            result.error || 'Failed to add node'
          );
        }

        return {
          nodeId: result.data.ReturnValue.NodeId,
          nodeType: result.data.ReturnValue.NodeType,
        };
      },
    },

    {
      name: 'set_blackboard_key',
      description: 'Set a value in an AI blackboard',
      inputSchema: SetBlackboardKeyParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'behavior',
        tags: ['blackboard', 'ai', 'set'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ keySet: boolean }> => {
        const params = context.params as z.infer<typeof SetBlackboardKeyParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          params.aiControllerPath,
          'SetBlackboardValue',
          {
            KeyName: params.keyName,
            KeyType: params.keyType,
            Value: params.value,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'set_blackboard_key',
            result.error || 'Failed to set blackboard key',
            { keyName: params.keyName }
          );
        }

        return { keySet: true };
      },
    },

    {
      name: 'run_behavior_tree',
      description: 'Run a behavior tree on an AI controller',
      inputSchema: RunBehaviorTreeParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'behavior',
        tags: ['behavior', 'run', 'ai'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ running: boolean }> => {
        const params = context.params as z.infer<typeof RunBehaviorTreeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          params.aiControllerPath,
          'RunBehaviorTree',
          {
            TreePath: params.treePath,
            StartImmediately: params.startImmediately,
          }
        );

        if (!result.success) {
          throw new BehaviorTreeError(
            params.treePath,
            'run',
            result.error || 'Failed to run behavior tree'
          );
        }

        return { running: result.data?.ReturnValue || false };
      },
    },

    // ========================================================================
    // AI Controller Commands
    // ========================================================================
    {
      name: 'create_ai_controller',
      description: 'Create a new AI controller Blueprint',
      inputSchema: CreateAIControllerParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'ai',
        tags: ['controller', 'ai', 'create'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ controllerPath: string }> => {
        const params = context.params as z.infer<typeof CreateAIControllerParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/AIModule.Default__AIBlueprintHelperLibrary',
          'CreateAIController',
          {
            PackagePath: params.packagePath,
            ControllerName: params.controllerName,
            ParentClass: params.parentClass,
            BehaviorTree: params.behaviorTree,
            BlackboardAsset: params.blackboardAsset,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'create_ai_controller',
            result.error || 'Failed to create AI controller',
            { controllerName: params.controllerName }
          );
        }

        return { controllerPath: result.data.ReturnValue };
      },
    },

    {
      name: 'spawn_ai_character',
      description: 'Spawn an AI-controlled character',
      inputSchema: SpawnAICharacterParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'ai',
        tags: ['spawn', 'character', 'ai', 'npc'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{
        characterPath: string;
        controllerPath: string;
      }> => {
        const params = context.params as z.infer<typeof SpawnAICharacterParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { CharacterPath: string; ControllerPath: string };
        }>(
          '/Script/AIModule.Default__AIBlueprintHelperLibrary',
          'SpawnAIFromClass',
          {
            CharacterClass: params.characterClass,
            Location: params.location,
            Rotation: params.rotation,
            AIController: params.aiController,
            BehaviorTree: params.behaviorTree,
            TeamId: params.teamId,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'spawn_ai_character',
            result.error || 'Failed to spawn AI character',
            { characterClass: params.characterClass }
          );
        }

        // Set display name if provided
        if (params.displayName) {
          await bridge.remoteControl.setProperty(
            result.data.ReturnValue.CharacterPath,
            'DisplayName',
            params.displayName
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: result.data.ReturnValue.CharacterPath,
          changeType: 'create',
          newValue: { type: 'AICharacter', class: params.characterClass },
          source: 'local',
          undoable: true,
        });

        return {
          characterPath: result.data.ReturnValue.CharacterPath,
          controllerPath: result.data.ReturnValue.ControllerPath,
        };
      },
    },

    {
      name: 'configure_perception',
      description: 'Configure AI perception senses',
      inputSchema: ConfigurePerceptionParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'ai',
        tags: ['perception', 'senses', 'ai'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ configured: string[] }> => {
        const params = context.params as z.infer<typeof ConfigurePerceptionParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { ConfiguredSenses: string[] };
        }>(
          params.aiControllerPath,
          'ConfigurePerception',
          {
            Senses: params.senses,
            DominantSense: params.dominantSense,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'configure_perception',
            result.error || 'Failed to configure perception',
            { aiControllerPath: params.aiControllerPath }
          );
        }

        return { configured: result.data?.ReturnValue.ConfiguredSenses || [] };
      },
    },

    {
      name: 'query_ai_decision',
      description: 'Query an AI for a decision based on context',
      inputSchema: QueryAIDecisionParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'ai',
        tags: ['decision', 'query', 'ai'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<AIDecisionResult> => {
        const params = context.params as z.infer<typeof QueryAIDecisionParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Decision: string;
            Confidence: number;
            Alternatives: Array<{ Action: string; Score: number }>;
            UsedONNX: boolean;
          };
        }>(
          params.aiControllerPath,
          'QueryDecision',
          {
            Context: params.decisionContext,
            UseONNX: params.useONNX,
            ModelName: params.modelName,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'query_ai_decision',
            result.error || 'Failed to query AI decision',
            { aiControllerPath: params.aiControllerPath }
          );
        }

        return {
          decision: result.data.ReturnValue.Decision,
          confidence: result.data.ReturnValue.Confidence,
          alternatives: result.data.ReturnValue.Alternatives.map((a) => ({
            action: a.Action,
            score: a.Score,
          })),
          usedONNX: result.data.ReturnValue.UsedONNX,
        };
      },
    },

    // ========================================================================
    // EQS Commands
    // ========================================================================
    {
      name: 'create_eqs_query',
      description: 'Create an Environment Query System query',
      inputSchema: CreateEQSQueryParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'eqs',
        tags: ['eqs', 'query', 'environment', 'ai'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ queryPath: string }> => {
        const params = context.params as z.infer<typeof CreateEQSQueryParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/AIModule.Default__EnvQueryManager',
          'CreateEQSQuery',
          {
            PackagePath: params.packagePath,
            QueryName: params.queryName,
            Generators: params.generators,
            Tests: params.tests,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'create_eqs_query',
            result.error || 'Failed to create EQS query',
            { queryName: params.queryName }
          );
        }

        return { queryPath: result.data.ReturnValue };
      },
    },

    {
      name: 'run_eqs_query',
      description: 'Run an EQS query and get results',
      inputSchema: RunEQSQueryParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'eqs',
        tags: ['eqs', 'run', 'query', 'ai'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<EQSQueryResult> => {
        const params = context.params as z.infer<typeof RunEQSQueryParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Items: Array<{
              Location: { X: number; Y: number; Z: number };
              Score: number;
              Actor?: string;
            }>;
            BestItem: {
              Location: { X: number; Y: number; Z: number };
              Score: number;
              Actor?: string;
            } | null;
          };
        }>(
          params.aiControllerPath,
          'RunEQSQuery',
          {
            QueryPath: params.queryPath,
            QueryParams: params.queryParams,
            ResultLimit: params.resultLimit,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'run_eqs_query',
            result.error || 'Failed to run EQS query',
            { queryPath: params.queryPath }
          );
        }

        return {
          items: result.data.ReturnValue.Items.map((i) => ({
            location: { x: i.Location.X, y: i.Location.Y, z: i.Location.Z },
            score: i.Score,
            actor: i.Actor,
          })),
          bestItem: result.data.ReturnValue.BestItem
            ? {
                location: {
                  x: result.data.ReturnValue.BestItem.Location.X,
                  y: result.data.ReturnValue.BestItem.Location.Y,
                  z: result.data.ReturnValue.BestItem.Location.Z,
                },
                score: result.data.ReturnValue.BestItem.Score,
                actor: result.data.ReturnValue.BestItem.Actor,
              }
            : null,
        };
      },
    },
  ];
}

// ============================================================================
// Plugin Factory
// ============================================================================

export function createNPCPlugin(bridge: BridgeManager, logger: Logger): AegisPlugin {
  const allCommands = createNPCCommands(bridge);

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
      name: 'AEGIS NPC/AI',
      version: PLUGIN_VERSION,
      description: 'AI behavior system with ONNX integration, behavior trees, and EQS',
      author: 'AEGIS Team',
      namespace: PLUGIN_NAMESPACE,
      tags: ['npc', 'ai', 'behavior', 'onnx', 'eqs', 'ml'],
      dependencies: [
        {
          pluginId: 'aegis.core',
          minVersion: '1.0.0',
          optional: false,
        },
      ],
    },

    commands: commandsWithLogger,

    onLoad: async (context: PluginLoadContext) => {
      logger.info('AEGIS NPC/AI Plugin loaded', {
        version: PLUGIN_VERSION,
        commandCount: allCommands.length,
      });
    },

    onUnload: async () => {
      logger.info('AEGIS NPC/AI Plugin unloading');
    },

    healthCheck: async () => {
      return {
        healthy: true,
        message: 'NPC/AI systems ready',
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
    name: 'AEGIS NPC/AI',
    version: PLUGIN_VERSION,
    description: 'AI behavior system with ONNX integration',
    author: 'AEGIS Team',
    namespace: PLUGIN_NAMESPACE,
    tags: ['npc', 'ai', 'behavior', 'onnx'],
  },
  commands: [],
  onLoad: async () => console.log('AEGIS NPC/AI Plugin loaded'),
  onUnload: async () => console.log('AEGIS NPC/AI Plugin unloaded'),
};
