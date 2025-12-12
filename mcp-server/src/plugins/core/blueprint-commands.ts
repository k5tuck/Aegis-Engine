/**
 * AEGIS Core Plugin - Blueprint Commands
 * Commands for creating, modifying, and compiling Blueprints
 */

import { z } from 'zod';
import { CommandDefinition, CommandContext } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { BlueprintCompileError, ExecutionError } from '../../utils/errors.js';

// ============================================================================
// Schemas
// ============================================================================

const CreateBlueprintParamsSchema = z.object({
  packagePath: z.string().describe('Package path (e.g., /Game/Blueprints)'),
  blueprintName: z.string().describe('Name for the new Blueprint'),
  parentClass: z.string().describe('Parent class path (e.g., /Script/Engine.Actor)'),
  description: z.string().optional().describe('Blueprint description'),
  category: z.string().optional().describe('Blueprint category for organization'),
});

const CompileBlueprintParamsSchema = z.object({
  blueprintPath: z.string().describe('Path to the Blueprint to compile'),
  saveAfterCompile: z.boolean().optional().default(true).describe('Save the Blueprint after compiling'),
});

const AddBlueprintVariableParamsSchema = z.object({
  blueprintPath: z.string().describe('Path to the Blueprint'),
  variableName: z.string().describe('Name of the variable'),
  variableType: z.string().describe('Type of the variable (e.g., Float, Vector, Object)'),
  defaultValue: z.unknown().optional().describe('Default value for the variable'),
  isExposed: z.boolean().optional().default(false).describe('Expose variable to editor'),
  isEditable: z.boolean().optional().default(true).describe('Allow editing in instances'),
  category: z.string().optional().describe('Variable category'),
  tooltip: z.string().optional().describe('Tooltip for the variable'),
});

const AddBlueprintFunctionParamsSchema = z.object({
  blueprintPath: z.string().describe('Path to the Blueprint'),
  functionName: z.string().describe('Name of the function'),
  inputs: z.array(z.object({
    name: z.string(),
    type: z.string(),
  })).optional().describe('Function input parameters'),
  outputs: z.array(z.object({
    name: z.string(),
    type: z.string(),
  })).optional().describe('Function output parameters'),
  isPure: z.boolean().optional().default(false).describe('Is this a pure function (no side effects)'),
  isStatic: z.boolean().optional().default(false).describe('Is this a static function'),
  category: z.string().optional().describe('Function category'),
  description: z.string().optional().describe('Function description'),
});

const AddBlueprintEventParamsSchema = z.object({
  blueprintPath: z.string().describe('Path to the Blueprint'),
  eventName: z.string().describe('Name of the event'),
  eventType: z.enum(['custom', 'beginplay', 'tick', 'overlap', 'hit', 'input']).describe('Type of event'),
  parameters: z.array(z.object({
    name: z.string(),
    type: z.string(),
  })).optional().describe('Event parameters (for custom events)'),
});

const AddBlueprintComponentParamsSchema = z.object({
  blueprintPath: z.string().describe('Path to the Blueprint'),
  componentName: z.string().describe('Name for the component'),
  componentClass: z.string().describe('Component class (e.g., StaticMeshComponent)'),
  attachToComponent: z.string().optional().describe('Parent component to attach to'),
  relativeTransform: z.object({
    location: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
    rotation: z.object({ pitch: z.number(), yaw: z.number(), roll: z.number() }).optional(),
    scale: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
  }).optional().describe('Relative transform'),
  properties: z.record(z.unknown()).optional().describe('Component properties to set'),
});

const AddBlueprintNodeParamsSchema = z.object({
  blueprintPath: z.string().describe('Path to the Blueprint'),
  graphName: z.string().describe('Name of the graph (e.g., EventGraph, function name)'),
  nodeType: z.string().describe('Type of node to add'),
  nodeClass: z.string().optional().describe('Node class for K2 nodes'),
  position: z.object({ x: z.number(), y: z.number() }).optional().describe('Node position in graph'),
  properties: z.record(z.unknown()).optional().describe('Node properties'),
});

const ConnectBlueprintNodesParamsSchema = z.object({
  blueprintPath: z.string().describe('Path to the Blueprint'),
  graphName: z.string().describe('Name of the graph'),
  sourceNode: z.string().describe('Source node identifier'),
  sourcePin: z.string().describe('Source pin name'),
  targetNode: z.string().describe('Target node identifier'),
  targetPin: z.string().describe('Target pin name'),
});

const GetBlueprintInfoParamsSchema = z.object({
  blueprintPath: z.string().describe('Path to the Blueprint'),
  includeVariables: z.boolean().optional().default(true),
  includeFunctions: z.boolean().optional().default(true),
  includeComponents: z.boolean().optional().default(true),
  includeGraph: z.boolean().optional().default(false),
});

// ============================================================================
// Response Types
// ============================================================================

interface CreateBlueprintResult {
  blueprintPath: string;
  generatedClass: string;
}

interface CompileBlueprintResult {
  success: boolean;
  blueprintPath: string;
  errors: string[];
  warnings: string[];
}

interface AddVariableResult {
  variableName: string;
  variableGuid: string;
}

interface AddFunctionResult {
  functionName: string;
  functionGuid: string;
}

interface AddComponentResult {
  componentName: string;
  componentPath: string;
}

interface AddNodeResult {
  nodeId: string;
  nodeClass: string;
}

interface GetBlueprintInfoResult {
  path: string;
  name: string;
  parentClass: string;
  generatedClass: string;
  variables?: Array<{
    name: string;
    type: string;
    defaultValue?: unknown;
    isExposed: boolean;
  }>;
  functions?: Array<{
    name: string;
    inputs: Array<{ name: string; type: string }>;
    outputs: Array<{ name: string; type: string }>;
  }>;
  components?: Array<{
    name: string;
    class: string;
    parent?: string;
  }>;
}

// ============================================================================
// Command Implementations
// ============================================================================

export function createBlueprintCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // create_blueprint
    // ========================================================================
    {
      name: 'create_blueprint',
      description: 'Create a new Blueprint asset',
      inputSchema: CreateBlueprintParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'blueprint',
        tags: ['create', 'blueprint', 'asset'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<CreateBlueprintResult> => {
        const params = context.params as z.infer<typeof CreateBlueprintParamsSchema>;

        const result = await bridge.remoteControl.createBlueprint(
          params.packagePath,
          params.blueprintName,
          params.parentClass
        );

        if (!result.success || !result.data) {
          throw new ExecutionError(
            'create_blueprint',
            result.error || 'Failed to create Blueprint',
            { packagePath: params.packagePath, blueprintName: params.blueprintName }
          );
        }

        // Set description if provided
        if (params.description) {
          await bridge.remoteControl.setProperty(
            result.data.blueprintPath,
            'BlueprintDescription',
            params.description
          );
        }

        // Set category if provided
        if (params.category) {
          await bridge.remoteControl.setProperty(
            result.data.blueprintPath,
            'BlueprintCategory',
            params.category
          );
        }

        // Compile the new Blueprint
        await bridge.remoteControl.compileBlueprint(result.data.blueprintPath);

        // Record change
        bridge.stateSync.recordChange({
          type: 'asset',
          target: result.data.blueprintPath,
          changeType: 'create',
          newValue: { name: params.blueprintName, parentClass: params.parentClass },
          source: 'local',
          undoable: true,
        });

        return {
          blueprintPath: result.data.blueprintPath,
          generatedClass: `${result.data.blueprintPath}.${params.blueprintName}_C`,
        };
      },
    },

    // ========================================================================
    // compile_blueprint
    // ========================================================================
    {
      name: 'compile_blueprint',
      description: 'Compile a Blueprint and report any errors or warnings',
      inputSchema: CompileBlueprintParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'blueprint',
        tags: ['compile', 'blueprint', 'build'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<CompileBlueprintResult> => {
        const params = context.params as z.infer<typeof CompileBlueprintParamsSchema>;

        const result = await bridge.remoteControl.compileBlueprint(params.blueprintPath);

        if (!result.success) {
          throw new BlueprintCompileError(
            params.blueprintPath,
            result.data?.errors || [result.error || 'Unknown compilation error']
          );
        }

        // Save if requested
        if (params.saveAfterCompile && result.data?.success) {
          await bridge.remoteControl.callFunction(
            '/Script/UnrealEd.Default__EditorAssetSubsystem',
            'SaveAsset',
            { AssetPath: params.blueprintPath }
          );
        }

        return {
          success: result.data?.success || false,
          blueprintPath: params.blueprintPath,
          errors: result.data?.errors || [],
          warnings: result.data?.warnings || [],
        };
      },
    },

    // ========================================================================
    // add_blueprint_variable
    // ========================================================================
    {
      name: 'add_blueprint_variable',
      description: 'Add a variable to a Blueprint',
      inputSchema: AddBlueprintVariableParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'blueprint',
        tags: ['variable', 'blueprint', 'property'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<AddVariableResult> => {
        const params = context.params as z.infer<typeof AddBlueprintVariableParamsSchema>;

        // Call Blueprint editor function to add variable
        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/BlueprintGraph.Default__K2Node_Variable',
          'AddMemberVariable',
          {
            Blueprint: params.blueprintPath,
            VariableName: params.variableName,
            VariableType: params.variableType,
            DefaultValue: params.defaultValue,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'add_blueprint_variable',
            result.error || 'Failed to add variable',
            { blueprintPath: params.blueprintPath, variableName: params.variableName }
          );
        }

        // Set variable metadata
        if (params.isExposed) {
          await bridge.remoteControl.setProperty(
            `${params.blueprintPath}:${params.variableName}`,
            'bExposeOnSpawn',
            true
          );
        }

        if (params.category) {
          await bridge.remoteControl.setProperty(
            `${params.blueprintPath}:${params.variableName}`,
            'Category',
            params.category
          );
        }

        if (params.tooltip) {
          await bridge.remoteControl.setProperty(
            `${params.blueprintPath}:${params.variableName}`,
            'ToolTip',
            params.tooltip
          );
        }

        // Recompile
        await bridge.remoteControl.compileBlueprint(params.blueprintPath);

        return {
          variableName: params.variableName,
          variableGuid: result.data?.ReturnValue || '',
        };
      },
    },

    // ========================================================================
    // add_blueprint_function
    // ========================================================================
    {
      name: 'add_blueprint_function',
      description: 'Add a function to a Blueprint',
      inputSchema: AddBlueprintFunctionParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'blueprint',
        tags: ['function', 'blueprint', 'method'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<AddFunctionResult> => {
        const params = context.params as z.infer<typeof AddBlueprintFunctionParamsSchema>;

        // Call Blueprint editor function to add function graph
        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/BlueprintGraph.Default__BlueprintEditorUtils',
          'AddFunction',
          {
            Blueprint: params.blueprintPath,
            FunctionName: params.functionName,
            IsPure: params.isPure,
            IsStatic: params.isStatic,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'add_blueprint_function',
            result.error || 'Failed to add function',
            { blueprintPath: params.blueprintPath, functionName: params.functionName }
          );
        }

        // Add input parameters
        if (params.inputs) {
          for (const input of params.inputs) {
            await bridge.remoteControl.callFunction(
              '/Script/BlueprintGraph.Default__BlueprintEditorUtils',
              'AddFunctionParameter',
              {
                Blueprint: params.blueprintPath,
                FunctionName: params.functionName,
                ParameterName: input.name,
                ParameterType: input.type,
                IsOutput: false,
              }
            );
          }
        }

        // Add output parameters
        if (params.outputs) {
          for (const output of params.outputs) {
            await bridge.remoteControl.callFunction(
              '/Script/BlueprintGraph.Default__BlueprintEditorUtils',
              'AddFunctionParameter',
              {
                Blueprint: params.blueprintPath,
                FunctionName: params.functionName,
                ParameterName: output.name,
                ParameterType: output.type,
                IsOutput: true,
              }
            );
          }
        }

        // Recompile
        await bridge.remoteControl.compileBlueprint(params.blueprintPath);

        return {
          functionName: params.functionName,
          functionGuid: result.data?.ReturnValue || '',
        };
      },
    },

    // ========================================================================
    // add_blueprint_event
    // ========================================================================
    {
      name: 'add_blueprint_event',
      description: 'Add an event to a Blueprint',
      inputSchema: AddBlueprintEventParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'blueprint',
        tags: ['event', 'blueprint'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ eventName: string; nodeId: string }> => {
        const params = context.params as z.infer<typeof AddBlueprintEventParamsSchema>;

        // Map event type to node class
        const eventNodeMap: Record<string, string> = {
          custom: 'K2Node_CustomEvent',
          beginplay: 'K2Node_Event:ReceiveBeginPlay',
          tick: 'K2Node_Event:ReceiveTick',
          overlap: 'K2Node_Event:ReceiveActorBeginOverlap',
          hit: 'K2Node_Event:ReceiveHit',
          input: 'K2Node_InputAction',
        };

        const nodeClass = eventNodeMap[params.eventType] || 'K2Node_CustomEvent';

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/BlueprintGraph.Default__BlueprintEditorUtils',
          'AddEventNode',
          {
            Blueprint: params.blueprintPath,
            EventName: params.eventName,
            NodeClass: nodeClass,
            Parameters: params.parameters,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'add_blueprint_event',
            result.error || 'Failed to add event',
            { blueprintPath: params.blueprintPath, eventName: params.eventName }
          );
        }

        // Recompile
        await bridge.remoteControl.compileBlueprint(params.blueprintPath);

        return {
          eventName: params.eventName,
          nodeId: result.data?.ReturnValue || '',
        };
      },
    },

    // ========================================================================
    // add_blueprint_component
    // ========================================================================
    {
      name: 'add_blueprint_component',
      description: 'Add a component to a Blueprint',
      inputSchema: AddBlueprintComponentParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'blueprint',
        tags: ['component', 'blueprint'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<AddComponentResult> => {
        const params = context.params as z.infer<typeof AddBlueprintComponentParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/BlueprintGraph.Default__BlueprintEditorUtils',
          'AddComponent',
          {
            Blueprint: params.blueprintPath,
            ComponentName: params.componentName,
            ComponentClass: params.componentClass,
            AttachTo: params.attachToComponent,
          }
        );

        if (!result.success || !result.data) {
          throw new ExecutionError(
            'add_blueprint_component',
            result.error || 'Failed to add component',
            { blueprintPath: params.blueprintPath, componentName: params.componentName }
          );
        }

        const componentPath = result.data.ReturnValue;

        // Set relative transform if provided
        if (params.relativeTransform) {
          if (params.relativeTransform.location) {
            await bridge.remoteControl.setProperty(
              componentPath,
              'RelativeLocation',
              params.relativeTransform.location
            );
          }
          if (params.relativeTransform.rotation) {
            await bridge.remoteControl.setProperty(
              componentPath,
              'RelativeRotation',
              params.relativeTransform.rotation
            );
          }
          if (params.relativeTransform.scale) {
            await bridge.remoteControl.setProperty(
              componentPath,
              'RelativeScale3D',
              params.relativeTransform.scale
            );
          }
        }

        // Set additional properties
        if (params.properties) {
          for (const [propName, propValue] of Object.entries(params.properties)) {
            await bridge.remoteControl.setProperty(componentPath, propName, propValue);
          }
        }

        // Recompile
        await bridge.remoteControl.compileBlueprint(params.blueprintPath);

        return {
          componentName: params.componentName,
          componentPath,
        };
      },
    },

    // ========================================================================
    // add_blueprint_node
    // ========================================================================
    {
      name: 'add_blueprint_node',
      description: 'Add a node to a Blueprint graph',
      inputSchema: AddBlueprintNodeParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'blueprint',
        tags: ['node', 'graph', 'blueprint'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<AddNodeResult> => {
        const params = context.params as z.infer<typeof AddBlueprintNodeParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/BlueprintGraph.Default__BlueprintEditorUtils',
          'AddNode',
          {
            Blueprint: params.blueprintPath,
            GraphName: params.graphName,
            NodeType: params.nodeType,
            NodeClass: params.nodeClass,
            Position: params.position || { x: 0, y: 0 },
            Properties: params.properties,
          }
        );

        if (!result.success) {
          throw new ExecutionError(
            'add_blueprint_node',
            result.error || 'Failed to add node',
            { blueprintPath: params.blueprintPath, nodeType: params.nodeType }
          );
        }

        return {
          nodeId: result.data?.ReturnValue || '',
          nodeClass: params.nodeClass || params.nodeType,
        };
      },
    },

    // ========================================================================
    // connect_blueprint_nodes
    // ========================================================================
    {
      name: 'connect_blueprint_nodes',
      description: 'Connect two nodes in a Blueprint graph',
      inputSchema: ConnectBlueprintNodesParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'blueprint',
        tags: ['connect', 'node', 'graph', 'blueprint'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ connected: boolean }> => {
        const params = context.params as z.infer<typeof ConnectBlueprintNodesParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/BlueprintGraph.Default__BlueprintEditorUtils',
          'ConnectNodes',
          {
            Blueprint: params.blueprintPath,
            GraphName: params.graphName,
            SourceNode: params.sourceNode,
            SourcePin: params.sourcePin,
            TargetNode: params.targetNode,
            TargetPin: params.targetPin,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'connect_blueprint_nodes',
            result.error || 'Failed to connect nodes',
            params
          );
        }

        // Recompile after connection
        await bridge.remoteControl.compileBlueprint(params.blueprintPath);

        return {
          connected: result.data.ReturnValue,
        };
      },
    },

    // ========================================================================
    // get_blueprint_info
    // ========================================================================
    {
      name: 'get_blueprint_info',
      description: 'Get detailed information about a Blueprint',
      inputSchema: GetBlueprintInfoParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'blueprint',
        tags: ['info', 'blueprint', 'inspect'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<GetBlueprintInfoResult> => {
        const params = context.params as z.infer<typeof GetBlueprintInfoParamsSchema>;

        // Get basic blueprint info
        const descResult = await bridge.remoteControl.describeObject(params.blueprintPath);
        if (!descResult.success || !descResult.data) {
          throw new ExecutionError(
            'get_blueprint_info',
            descResult.error || 'Failed to get Blueprint info',
            { blueprintPath: params.blueprintPath }
          );
        }

        const result: GetBlueprintInfoResult = {
          path: params.blueprintPath,
          name: descResult.data.name,
          parentClass: descResult.data.class,
          generatedClass: `${params.blueprintPath}.${descResult.data.name}_C`,
        };

        // Get variables
        if (params.includeVariables) {
          const varsResult = await bridge.remoteControl.callFunction<{
            ReturnValue: Array<{
              name: string;
              type: string;
              defaultValue: unknown;
              isExposed: boolean;
            }>;
          }>(
            '/Script/BlueprintGraph.Default__BlueprintEditorUtils',
            'GetBlueprintVariables',
            { Blueprint: params.blueprintPath }
          );

          if (varsResult.success && varsResult.data) {
            result.variables = varsResult.data.ReturnValue;
          }
        }

        // Get functions
        if (params.includeFunctions) {
          const funcsResult = await bridge.remoteControl.callFunction<{
            ReturnValue: Array<{
              name: string;
              inputs: Array<{ name: string; type: string }>;
              outputs: Array<{ name: string; type: string }>;
            }>;
          }>(
            '/Script/BlueprintGraph.Default__BlueprintEditorUtils',
            'GetBlueprintFunctions',
            { Blueprint: params.blueprintPath }
          );

          if (funcsResult.success && funcsResult.data) {
            result.functions = funcsResult.data.ReturnValue;
          }
        }

        // Get components
        if (params.includeComponents) {
          const compsResult = await bridge.remoteControl.callFunction<{
            ReturnValue: Array<{
              name: string;
              class: string;
              parent?: string;
            }>;
          }>(
            '/Script/BlueprintGraph.Default__BlueprintEditorUtils',
            'GetBlueprintComponents',
            { Blueprint: params.blueprintPath }
          );

          if (compsResult.success && compsResult.data) {
            result.components = compsResult.data.ReturnValue;
          }
        }

        return result;
      },
    },
  ];
}
