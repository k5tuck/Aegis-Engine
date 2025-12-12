/**
 * AEGIS WorldGen Plugin - PCG Commands
 * Commands for Procedural Content Generation graph management (Phase 7)
 */

import { z } from 'zod';
import { CommandDefinition, CommandContext } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { PCGGraphError, ExecutionError } from '../../utils/errors.js';

// ============================================================================
// Schemas
// ============================================================================

const PCGNodeTypeSchema = z.enum([
  'sampler_surface',
  'sampler_points',
  'sampler_volume',
  'filter_density',
  'filter_bounds',
  'filter_by_tag',
  'transform_points',
  'mesh_spawner',
  'actor_spawner',
  'spline_sampler',
  'get_landscape_data',
  'projection',
  'copy_points',
  'merge_points',
  'difference',
  'attribute_noise',
  'attribute_operation',
  'custom',
]);

const CreatePCGGraphParamsSchema = z.object({
  packagePath: z.string().describe('Package path for the PCG graph'),
  graphName: z.string().describe('Name for the PCG graph'),
  description: z.string().optional(),
  graphType: z.enum(['standard', 'subgraph', 'settings']).optional().default('standard'),
});

const AddPCGNodeParamsSchema = z.object({
  graphPath: z.string().describe('Path to the PCG graph'),
  nodeType: PCGNodeTypeSchema.describe('Type of PCG node'),
  nodeName: z.string().optional().describe('Custom name for the node'),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  settings: z.record(z.unknown()).optional().describe('Node-specific settings'),
});

const ConnectPCGNodesParamsSchema = z.object({
  graphPath: z.string().describe('Path to the PCG graph'),
  sourceNode: z.string().describe('Source node identifier'),
  sourcePin: z.string().optional().default('Out'),
  targetNode: z.string().describe('Target node identifier'),
  targetPin: z.string().optional().default('In'),
});

const ConfigurePCGNodeParamsSchema = z.object({
  graphPath: z.string().describe('Path to the PCG graph'),
  nodeId: z.string().describe('Node identifier'),
  settings: z.record(z.unknown()).describe('Settings to apply'),
});

const ExecutePCGGraphParamsSchema = z.object({
  graphPath: z.string().describe('Path to the PCG graph'),
  targetActorPath: z.string().optional().describe('Actor to execute graph on'),
  executionMode: z.enum(['full', 'incremental', 'debug']).optional().default('full'),
  seed: z.number().int().optional(),
  parameters: z.record(z.unknown()).optional().describe('Runtime parameters'),
});

const CreatePCGVolumeParamsSchema = z.object({
  name: z.string().describe('Name for the PCG volume'),
  location: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  size: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  graphPath: z.string().describe('PCG graph to use'),
  autoGenerate: z.boolean().optional().default(false),
  seed: z.number().int().optional(),
});

const GetPCGGraphInfoParamsSchema = z.object({
  graphPath: z.string().describe('Path to the PCG graph'),
  includeNodes: z.boolean().optional().default(true),
  includeConnections: z.boolean().optional().default(true),
});

const AddPCGSubgraphParamsSchema = z.object({
  graphPath: z.string().describe('Path to the parent PCG graph'),
  subgraphPath: z.string().describe('Path to the subgraph to add'),
  nodeName: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  inputMapping: z.record(z.string()).optional().describe('Map parent inputs to subgraph inputs'),
});

const SetPCGAttributeParamsSchema = z.object({
  graphPath: z.string().describe('Path to the PCG graph'),
  targetNode: z.string().describe('Node to add attribute to'),
  attributeName: z.string().describe('Name of the attribute'),
  attributeType: z.enum(['float', 'double', 'int32', 'int64', 'vector', 'rotator', 'transform', 'string', 'bool', 'name']),
  defaultValue: z.unknown().optional(),
  operation: z.enum(['set', 'add', 'multiply', 'min', 'max']).optional().default('set'),
});

const DebugPCGGraphParamsSchema = z.object({
  graphPath: z.string().describe('Path to the PCG graph'),
  nodeId: z.string().optional().describe('Specific node to debug'),
  outputPath: z.string().optional().describe('Path to save debug data'),
  visualize: z.boolean().optional().default(true),
});

// ============================================================================
// Response Types
// ============================================================================

interface PCGNodeInfo {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  settings: Record<string, unknown>;
}

interface PCGConnectionInfo {
  sourceNode: string;
  sourcePin: string;
  targetNode: string;
  targetPin: string;
}

interface PCGGraphInfo {
  path: string;
  name: string;
  type: string;
  nodes?: PCGNodeInfo[];
  connections?: PCGConnectionInfo[];
  inputPins: string[];
  outputPins: string[];
}

interface PCGExecutionResult {
  executed: boolean;
  generatedActors: number;
  generatedPoints: number;
  executionTimeMs: number;
  seed: number;
  debugData?: Record<string, unknown>;
}

// ============================================================================
// Command Implementations
// ============================================================================

export function createPCGCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // create_pcg_graph
    // ========================================================================
    {
      name: 'create_pcg_graph',
      description: 'Create a new PCG (Procedural Content Generation) graph',
      inputSchema: CreatePCGGraphParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'pcg',
        tags: ['create', 'pcg', 'graph', 'procedural'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ graphPath: string }> => {
        const params = context.params as z.infer<typeof CreatePCGGraphParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/PCG.Default__PCGBlueprintHelpers',
          'CreatePCGGraph',
          {
            PackagePath: params.packagePath,
            GraphName: params.graphName,
            Description: params.description,
            GraphType: params.graphType,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new PCGGraphError(
            params.graphName,
            'create',
            result.error || 'Failed to create PCG graph'
          );
        }

        return {
          graphPath: result.data.ReturnValue,
        };
      },
    },

    // ========================================================================
    // add_pcg_node
    // ========================================================================
    {
      name: 'add_pcg_node',
      description: 'Add a node to a PCG graph',
      inputSchema: AddPCGNodeParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'pcg',
        tags: ['add', 'node', 'pcg', 'graph'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ nodeId: string; nodeType: string }> => {
        const params = context.params as z.infer<typeof AddPCGNodeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { NodeId: string; NodeType: string };
        }>(
          '/Script/PCG.Default__PCGBlueprintHelpers',
          'AddPCGNode',
          {
            GraphPath: params.graphPath,
            NodeType: params.nodeType,
            NodeName: params.nodeName,
            Position: params.position,
            Settings: params.settings,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new PCGGraphError(
            params.graphPath,
            'add_node',
            result.error || 'Failed to add PCG node'
          );
        }

        return {
          nodeId: result.data.ReturnValue.NodeId,
          nodeType: result.data.ReturnValue.NodeType,
        };
      },
    },

    // ========================================================================
    // connect_pcg_nodes
    // ========================================================================
    {
      name: 'connect_pcg_nodes',
      description: 'Connect two nodes in a PCG graph',
      inputSchema: ConnectPCGNodesParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'pcg',
        tags: ['connect', 'node', 'pcg', 'graph'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ connected: boolean }> => {
        const params = context.params as z.infer<typeof ConnectPCGNodesParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/PCG.Default__PCGBlueprintHelpers',
          'ConnectPCGNodes',
          {
            GraphPath: params.graphPath,
            SourceNode: params.sourceNode,
            SourcePin: params.sourcePin,
            TargetNode: params.targetNode,
            TargetPin: params.targetPin,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new PCGGraphError(
            params.graphPath,
            'connect',
            result.error || 'Failed to connect PCG nodes'
          );
        }

        return {
          connected: true,
        };
      },
    },

    // ========================================================================
    // configure_pcg_node
    // ========================================================================
    {
      name: 'configure_pcg_node',
      description: 'Configure settings on a PCG node',
      inputSchema: ConfigurePCGNodeParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'pcg',
        tags: ['configure', 'settings', 'pcg', 'node'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ configured: boolean; settingsApplied: string[] }> => {
        const params = context.params as z.infer<typeof ConfigurePCGNodeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { Success: boolean; SettingsApplied: string[] };
        }>(
          '/Script/PCG.Default__PCGBlueprintHelpers',
          'ConfigurePCGNode',
          {
            GraphPath: params.graphPath,
            NodeId: params.nodeId,
            Settings: params.settings,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new ExecutionError(
            'configure_pcg_node',
            result.error || 'Failed to configure PCG node',
            { nodeId: params.nodeId }
          );
        }

        return {
          configured: true,
          settingsApplied: result.data.ReturnValue.SettingsApplied,
        };
      },
    },

    // ========================================================================
    // execute_pcg_graph
    // ========================================================================
    {
      name: 'execute_pcg_graph',
      description: 'Execute a PCG graph to generate content',
      inputSchema: ExecutePCGGraphParamsSchema,
      annotations: {
        riskLevel: 'high',
        category: 'pcg',
        tags: ['execute', 'generate', 'pcg', 'procedural'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<PCGExecutionResult> => {
        const params = context.params as z.infer<typeof ExecutePCGGraphParamsSchema>;

        const seed = params.seed ?? Math.floor(Math.random() * 2147483647);

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            GeneratedActors: number;
            GeneratedPoints: number;
            ExecutionTimeMs: number;
            Seed: number;
            DebugData?: Record<string, unknown>;
          };
        }>(
          '/Script/PCG.Default__PCGBlueprintHelpers',
          'ExecutePCGGraph',
          {
            GraphPath: params.graphPath,
            TargetActorPath: params.targetActorPath,
            ExecutionMode: params.executionMode,
            Seed: seed,
            Parameters: params.parameters,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new PCGGraphError(
            params.graphPath,
            'execute',
            result.error || 'Failed to execute PCG graph'
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: params.targetActorPath || params.graphPath,
          changeType: 'modify',
          newValue: { pcgExecuted: true, seed },
          source: 'local',
          undoable: true,
        });

        return {
          executed: true,
          generatedActors: result.data.ReturnValue.GeneratedActors,
          generatedPoints: result.data.ReturnValue.GeneratedPoints,
          executionTimeMs: result.data.ReturnValue.ExecutionTimeMs,
          seed: result.data.ReturnValue.Seed,
          debugData: params.executionMode === 'debug' ? result.data.ReturnValue.DebugData : undefined,
        };
      },
    },

    // ========================================================================
    // create_pcg_volume
    // ========================================================================
    {
      name: 'create_pcg_volume',
      description: 'Create a PCG volume actor for area-based generation',
      inputSchema: CreatePCGVolumeParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'pcg',
        tags: ['create', 'volume', 'pcg', 'actor'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ volumePath: string }> => {
        const params = context.params as z.infer<typeof CreatePCGVolumeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/PCG.Default__PCGBlueprintHelpers',
          'CreatePCGVolume',
          {
            Name: params.name,
            Location: params.location,
            Size: params.size,
            GraphPath: params.graphPath,
            AutoGenerate: params.autoGenerate,
            Seed: params.seed,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'create_pcg_volume',
            result.error || 'Failed to create PCG volume',
            { name: params.name }
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'actor',
          target: result.data.ReturnValue,
          changeType: 'create',
          newValue: { type: 'PCGVolume', graph: params.graphPath },
          source: 'local',
          undoable: true,
        });

        return {
          volumePath: result.data.ReturnValue,
        };
      },
    },

    // ========================================================================
    // get_pcg_graph_info
    // ========================================================================
    {
      name: 'get_pcg_graph_info',
      description: 'Get information about a PCG graph',
      inputSchema: GetPCGGraphInfoParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'pcg',
        tags: ['info', 'pcg', 'graph'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<PCGGraphInfo> => {
        const params = context.params as z.infer<typeof GetPCGGraphInfoParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Name: string;
            Type: string;
            Nodes?: Array<{
              Id: string;
              Type: string;
              Name: string;
              Position: { X: number; Y: number };
              Settings: Record<string, unknown>;
            }>;
            Connections?: Array<{
              SourceNode: string;
              SourcePin: string;
              TargetNode: string;
              TargetPin: string;
            }>;
            InputPins: string[];
            OutputPins: string[];
          };
        }>(
          '/Script/PCG.Default__PCGBlueprintHelpers',
          'GetPCGGraphInfo',
          {
            GraphPath: params.graphPath,
            IncludeNodes: params.includeNodes,
            IncludeConnections: params.includeConnections,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'get_pcg_graph_info',
            result.error || 'Failed to get PCG graph info',
            { graphPath: params.graphPath }
          );
        }

        const data = result.data.ReturnValue;

        const info: PCGGraphInfo = {
          path: params.graphPath,
          name: data.Name,
          type: data.Type,
          inputPins: data.InputPins,
          outputPins: data.OutputPins,
        };

        if (params.includeNodes && data.Nodes) {
          info.nodes = data.Nodes.map((n) => ({
            id: n.Id,
            type: n.Type,
            name: n.Name,
            position: { x: n.Position.X, y: n.Position.Y },
            settings: n.Settings,
          }));
        }

        if (params.includeConnections && data.Connections) {
          info.connections = data.Connections.map((c) => ({
            sourceNode: c.SourceNode,
            sourcePin: c.SourcePin,
            targetNode: c.TargetNode,
            targetPin: c.TargetPin,
          }));
        }

        return info;
      },
    },

    // ========================================================================
    // add_pcg_subgraph
    // ========================================================================
    {
      name: 'add_pcg_subgraph',
      description: 'Add a subgraph to a PCG graph',
      inputSchema: AddPCGSubgraphParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'pcg',
        tags: ['subgraph', 'add', 'pcg'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ nodeId: string; subgraphPath: string }> => {
        const params = context.params as z.infer<typeof AddPCGSubgraphParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: { NodeId: string };
        }>(
          '/Script/PCG.Default__PCGBlueprintHelpers',
          'AddPCGSubgraph',
          {
            GraphPath: params.graphPath,
            SubgraphPath: params.subgraphPath,
            NodeName: params.nodeName,
            Position: params.position,
            InputMapping: params.inputMapping,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new PCGGraphError(
            params.graphPath,
            'add_subgraph',
            result.error || 'Failed to add PCG subgraph'
          );
        }

        return {
          nodeId: result.data.ReturnValue.NodeId,
          subgraphPath: params.subgraphPath,
        };
      },
    },

    // ========================================================================
    // set_pcg_attribute
    // ========================================================================
    {
      name: 'set_pcg_attribute',
      description: 'Set or modify an attribute on PCG points',
      inputSchema: SetPCGAttributeParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'pcg',
        tags: ['attribute', 'set', 'pcg'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ attributeSet: boolean }> => {
        const params = context.params as z.infer<typeof SetPCGAttributeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/PCG.Default__PCGBlueprintHelpers',
          'SetPCGAttribute',
          {
            GraphPath: params.graphPath,
            TargetNode: params.targetNode,
            AttributeName: params.attributeName,
            AttributeType: params.attributeType,
            DefaultValue: params.defaultValue,
            Operation: params.operation,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'set_pcg_attribute',
            result.error || 'Failed to set PCG attribute',
            { attributeName: params.attributeName }
          );
        }

        return {
          attributeSet: true,
        };
      },
    },

    // ========================================================================
    // debug_pcg_graph
    // ========================================================================
    {
      name: 'debug_pcg_graph',
      description: 'Debug a PCG graph and visualize intermediate results',
      inputSchema: DebugPCGGraphParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'pcg',
        tags: ['debug', 'visualize', 'pcg'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{
        debugged: boolean;
        pointCounts: Record<string, number>;
        executionOrder: string[];
        outputPath?: string;
      }> => {
        const params = context.params as z.infer<typeof DebugPCGGraphParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            PointCounts: Record<string, number>;
            ExecutionOrder: string[];
            OutputPath?: string;
          };
        }>(
          '/Script/PCG.Default__PCGBlueprintHelpers',
          'DebugPCGGraph',
          {
            GraphPath: params.graphPath,
            NodeId: params.nodeId,
            OutputPath: params.outputPath,
            Visualize: params.visualize,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new ExecutionError(
            'debug_pcg_graph',
            result.error || 'Failed to debug PCG graph',
            { graphPath: params.graphPath }
          );
        }

        return {
          debugged: true,
          pointCounts: result.data.ReturnValue.PointCounts,
          executionOrder: result.data.ReturnValue.ExecutionOrder,
          outputPath: result.data.ReturnValue.OutputPath,
        };
      },
    },
  ];
}
