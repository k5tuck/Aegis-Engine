/**
 * AEGIS Custom Error Classes
 * Provides structured error handling with context for AI feedback loops
 */

export class AegisError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context: Record<string, unknown> = {},
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = 'AegisError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      recoverable: this.recoverable,
      stack: this.stack,
    };
  }

  toAIFeedback(): {
    error: string;
    code: string;
    suggestion: string;
    recoverable: boolean;
  } {
    return {
      error: this.message,
      code: this.code,
      suggestion: this.getSuggestion(),
      recoverable: this.recoverable,
    };
  }

  protected getSuggestion(): string {
    return 'Please check the error details and try again.';
  }
}

export class UnrealConnectionError extends AegisError {
  constructor(endpoint: string, cause?: Error) {
    super(
      `Failed to connect to Unreal Engine at ${endpoint}`,
      'UE_CONNECTION_FAILED',
      { endpoint, cause: cause?.message },
      true
    );
    this.name = 'UnrealConnectionError';
  }

  protected getSuggestion(): string {
    return 'Verify Unreal Engine is running and Remote Control API plugin is enabled. Check firewall settings for port 30020.';
  }
}

export class CommandValidationError extends AegisError {
  constructor(command: string, violations: string[]) {
    super(
      `Invalid command "${command}": ${violations.join(', ')}`,
      'COMMAND_VALIDATION_FAILED',
      { command, violations },
      true
    );
    this.name = 'CommandValidationError';
  }

  protected getSuggestion(): string {
    const violations = this.context.violations as string[];
    return `Fix the following validation errors: ${violations.join('; ')}`;
  }
}

export class SecurityViolationError extends AegisError {
  constructor(action: string, reason: string) {
    super(
      `Security violation: ${reason}`,
      'SECURITY_VIOLATION',
      { action, reason },
      false
    );
    this.name = 'SecurityViolationError';
  }

  protected getSuggestion(): string {
    return 'This action is blocked by security policy. Contact administrator to adjust settings.';
  }
}

export class ExecutionError extends AegisError {
  constructor(action: string, details: string, rollbackAvailable: boolean) {
    super(
      `Execution failed for "${action}": ${details}`,
      'EXECUTION_FAILED',
      { action, details, rollbackAvailable },
      rollbackAvailable
    );
    this.name = 'ExecutionError';
  }

  protected getSuggestion(): string {
    const rollback = this.context.rollbackAvailable;
    return rollback
      ? 'You can use the rollback command to undo partial changes.'
      : 'Review the error details and retry with corrected parameters.';
  }
}

export class ActorNotFoundError extends AegisError {
  constructor(actorPath: string) {
    super(
      `Actor not found: ${actorPath}`,
      'ACTOR_NOT_FOUND',
      { actorPath },
      true
    );
    this.name = 'ActorNotFoundError';
  }

  protected getSuggestion(): string {
    return 'Use aegis.core.query_actors to list available actors. Verify the path is case-sensitive and correct.';
  }
}

export class BlueprintCompileError extends AegisError {
  constructor(blueprintPath: string, errors: string[]) {
    super(
      `Blueprint compilation failed: ${blueprintPath}`,
      'BLUEPRINT_COMPILE_ERROR',
      { blueprintPath, errors },
      true
    );
    this.name = 'BlueprintCompileError';
  }

  protected getSuggestion(): string {
    return 'Check the Output Log in Unreal Engine for detailed compilation errors.';
  }
}

export class AssetImportError extends AegisError {
  constructor(sourcePath: string, reason: string) {
    super(
      `Failed to import asset from "${sourcePath}": ${reason}`,
      'ASSET_IMPORT_FAILED',
      { sourcePath, reason },
      true
    );
    this.name = 'AssetImportError';
  }

  protected getSuggestion(): string {
    return 'Verify the source file exists and is in a supported format.';
  }
}

export class RateLimitError extends AegisError {
  constructor(limit: number, windowMs: number) {
    super(
      `Rate limit exceeded: ${limit} actions per ${windowMs / 1000}s`,
      'RATE_LIMIT_EXCEEDED',
      { limit, windowMs },
      true
    );
    this.name = 'RateLimitError';
  }

  protected getSuggestion(): string {
    return 'Wait before sending more commands or batch operations into fewer requests.';
  }
}

export class PreviewExpiredError extends AegisError {
  constructor(previewId: string) {
    super(
      `Action preview has expired: ${previewId}`,
      'PREVIEW_EXPIRED',
      { previewId },
      true
    );
    this.name = 'PreviewExpiredError';
  }

  protected getSuggestion(): string {
    return 'Create a new preview by re-sending the command.';
  }
}

export class ModelAdapterError extends AegisError {
  constructor(modelId: string, reason: string, cause?: Error) {
    super(
      `Model adapter error (${modelId}): ${reason}`,
      'MODEL_ADAPTER_ERROR',
      { modelId, reason, cause: cause?.message },
      true
    );
    this.name = 'ModelAdapterError';
  }

  protected getSuggestion(): string {
    return 'Check API key configuration and model availability. A fallback model may be used.';
  }
}

export class PluginLoadError extends AegisError {
  constructor(pluginId: string, reason: string) {
    super(
      `Failed to load plugin "${pluginId}": ${reason}`,
      'PLUGIN_LOAD_ERROR',
      { pluginId, reason },
      true
    );
    this.name = 'PluginLoadError';
  }

  protected getSuggestion(): string {
    return 'Check plugin configuration and dependencies. Review the plugin documentation.';
  }
}

export class SeedProtocolError extends AegisError {
  constructor(operation: string, reason: string) {
    super(
      `Seed Protocol error during ${operation}: ${reason}`,
      'SEED_PROTOCOL_ERROR',
      { operation, reason },
      true
    );
    this.name = 'SeedProtocolError';
  }

  protected getSuggestion(): string {
    return 'Check the Seed Protocol configuration and connector status.';
  }
}

// Phase 7: WorldGen Errors
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

  protected getSuggestion(): string {
    return 'Check terrain generation parameters and available memory.';
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

  protected getSuggestion(): string {
    return 'Review biome configuration parameters and ensure all required fields are provided.';
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

  protected getSuggestion(): string {
    return 'Verify both biomes exist and have compatible transition settings.';
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

  protected getSuggestion(): string {
    return 'Check mesh asset paths and scatter bounds. Reduce density if exceeding limits.';
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

  protected getSuggestion(): string {
    return 'Check PCG graph configuration and node connections in Unreal Editor.';
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

  protected getSuggestion(): string {
    return 'Verify output path is writable and format is supported.';
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

  protected getSuggestion(): string {
    return 'Use a non-negative integer for the seed value.';
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

  protected getSuggestion(): string {
    return 'Verify the asset path is correct and the asset is imported in the project.';
  }
}

// Phase 7 Addendum: Houdini Errors
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
      true
    );
    this.name = 'HoudiniNotAvailableError';
  }

  protected getSuggestion(): string {
    return 'A PCG-based fallback will be used automatically if available.';
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

  protected getSuggestion(): string {
    return 'Verify the HDA file exists in one of the search paths or register it in the catalog.';
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

  protected getSuggestion(): string {
    return 'Check HDA parameters and input geometry. Review Houdini Engine logs.';
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

  protected getSuggestion(): string {
    return 'Review parameter documentation and provide valid values.';
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

  protected getSuggestion(): string {
    return 'Check heightfield format compatibility and landscape configuration.';
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

  protected getSuggestion(): string {
    return 'Review Houdini Engine error logs. Consider increasing cook timeout.';
  }
}

export class FallbackNotAvailableError extends AegisError {
  constructor(originalCapability: string, reason: string) {
    super(
      `No fallback available for "${originalCapability}": ${reason}`,
      'FALLBACK_NOT_AVAILABLE',
      { originalCapability, reason },
      false
    );
    this.name = 'FallbackNotAvailableError';
  }

  protected getSuggestion(): string {
    return 'Install Houdini Engine or implement a custom PCG fallback.';
  }
}

// Phase 8: AI Execution Layer Errors
export class ONNXModelError extends AegisError {
  constructor(modelId: string, operation: string, reason: string) {
    super(
      `ONNX model "${modelId}" ${operation} failed: ${reason}`,
      'ONNX_MODEL_ERROR',
      { modelId, operation, reason },
      true
    );
    this.name = 'ONNXModelError';
  }

  protected getSuggestion(): string {
    return 'Verify model file exists and is compatible with ONNX Runtime version.';
  }
}

export class BehaviorTreeError extends AegisError {
  constructor(treeId: string, nodeId: string | undefined, reason: string) {
    super(
      `Behavior tree "${treeId}"${nodeId ? ` at node ${nodeId}` : ''} error: ${reason}`,
      'BEHAVIOR_TREE_ERROR',
      { treeId, nodeId, reason },
      true
    );
    this.name = 'BehaviorTreeError';
  }

  protected getSuggestion(): string {
    return 'Review behavior tree configuration and node connections.';
  }
}

export class DecisionPipelineError extends AegisError {
  constructor(pipelineId: string, stage: string, reason: string) {
    super(
      `Decision pipeline "${pipelineId}" failed at ${stage}: ${reason}`,
      'DECISION_PIPELINE_ERROR',
      { pipelineId, stage, reason },
      true
    );
    this.name = 'DecisionPipelineError';
  }

  protected getSuggestion(): string {
    return 'Check pipeline configuration and available inference modes.';
  }
}

export class PerformanceBudgetError extends AegisError {
  constructor(component: string, budgetMs: number, actualMs: number) {
    super(
      `Performance budget exceeded for "${component}": ${actualMs.toFixed(2)}ms > ${budgetMs}ms budget`,
      'PERFORMANCE_BUDGET_EXCEEDED',
      { component, budgetMs, actualMs },
      true
    );
    this.name = 'PerformanceBudgetError';
  }

  protected getSuggestion(): string {
    return 'Reduce workload or increase budget allocation for this component.';
  }
}

// Phase 9: Seed Protocol Errors
export class GUIDGenerationError extends AegisError {
  constructor(entityType: string, reason: string) {
    super(
      `Failed to generate GUID for ${entityType}: ${reason}`,
      'GUID_GENERATION_FAILED',
      { entityType, reason },
      true
    );
    this.name = 'GUIDGenerationError';
  }

  protected getSuggestion(): string {
    return 'Check entity configuration and parent GUID if applicable.';
  }
}

export class StateSerializationError extends AegisError {
  constructor(stateId: string, direction: 'serialize' | 'deserialize', reason: string) {
    super(
      `Failed to ${direction} state "${stateId}": ${reason}`,
      'STATE_SERIALIZATION_ERROR',
      { stateId, direction, reason },
      true
    );
    this.name = 'StateSerializationError';
  }

  protected getSuggestion(): string {
    return 'Verify state data integrity and schema compatibility.';
  }
}

export class MergeConflictError extends AegisError {
  constructor(entityGuid: string, propertyPath: string, baseValue: string, ourValue: string, theirValue: string) {
    super(
      `Merge conflict at ${entityGuid}.${propertyPath}`,
      'MERGE_CONFLICT',
      { entityGuid, propertyPath, baseValue, ourValue, theirValue },
      true
    );
    this.name = 'MergeConflictError';
  }

  protected getSuggestion(): string {
    return 'Resolve conflict manually using "ours", "theirs", or provide a manual resolution.';
  }
}

export class ConnectorSyncError extends AegisError {
  constructor(connectorType: string, operation: string, reason: string) {
    super(
      `${connectorType} connector ${operation} failed: ${reason}`,
      'CONNECTOR_SYNC_ERROR',
      { connectorType, operation, reason },
      true
    );
    this.name = 'ConnectorSyncError';
  }

  protected getSuggestion(): string {
    return 'Check connector configuration and network connectivity.';
  }
}
