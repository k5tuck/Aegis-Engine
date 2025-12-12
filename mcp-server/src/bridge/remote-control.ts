/**
 * AEGIS Remote Control Client
 * HTTP client for Unreal Engine's Remote Control API
 */

import { Logger } from '../utils/logger.js';
import { UnrealConnectionError, ActorNotFoundError, ExecutionError } from '../utils/errors.js';
import { retryWithBackoff } from '../utils/helpers.js';

// ============================================================================
// Types
// ============================================================================

export interface RemoteControlConfig {
  /** Unreal Engine host */
  host: string;

  /** HTTP port for Remote Control API */
  httpPort: number;

  /** Connection timeout in ms */
  connectionTimeoutMs: number;

  /** Request timeout in ms */
  requestTimeoutMs: number;

  /** Enable request retries */
  enableRetries: boolean;

  /** Maximum retry attempts */
  maxRetries: number;

  /** Base retry delay in ms */
  retryDelayMs: number;

  /** Enable request/response logging */
  enableLogging: boolean;
}

export interface RemoteControlRequest {
  objectPath: string;
  functionName?: string;
  propertyName?: string;
  parameters?: Record<string, unknown>;
  access?: 'READ_ACCESS' | 'WRITE_ACCESS';
  generateTransaction?: boolean;
}

export interface RemoteControlResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  requestId?: string;
  executionTimeMs?: number;
}

export interface BatchRequest {
  requestId: string;
  request: RemoteControlRequest;
}

export interface BatchResponse {
  requestId: string;
  response: RemoteControlResponse;
}

export interface PropertyValue {
  propertyName: string;
  propertyValue: unknown;
}

export interface ActorInfo {
  path: string;
  name: string;
  class: string;
  label?: string;
  tags?: string[];
  transform?: {
    location: { x: number; y: number; z: number };
    rotation: { pitch: number; yaw: number; roll: number };
    scale: { x: number; y: number; z: number };
  };
}

export interface AssetInfo {
  path: string;
  name: string;
  class: string;
  package: string;
}

export interface RemoteControlPreset {
  name: string;
  id: string;
  groups: Array<{
    name: string;
    exposedProperties: Array<{
      displayName: string;
      underlyingProperty: string;
      ownerObject: string;
    }>;
    exposedFunctions: Array<{
      displayName: string;
      underlyingFunction: string;
      ownerObject: string;
    }>;
  }>;
}

export interface EditorCommand {
  command: string;
  parameters?: string[];
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: RemoteControlConfig = {
  host: 'localhost',
  httpPort: 30020,
  connectionTimeoutMs: 5000,
  requestTimeoutMs: 30000,
  enableRetries: true,
  maxRetries: 3,
  retryDelayMs: 1000,
  enableLogging: true,
};

// ============================================================================
// Remote Control Client Implementation
// ============================================================================

export class RemoteControlClient {
  private config: RemoteControlConfig;
  private logger: Logger;
  private baseUrl: string;
  private connected: boolean = false;
  private lastPingTime: Date | null = null;

  constructor(config: Partial<RemoteControlConfig>, logger: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger.child({ component: 'RemoteControlClient' });
    this.baseUrl = `http://${this.config.host}:${this.config.httpPort}`;
  }

  /**
   * Check connection to Unreal Engine
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/remote/info`, {
        method: 'GET',
      });

      if (response.ok) {
        this.connected = true;
        this.lastPingTime = new Date();
        return true;
      }

      this.connected = false;
      return false;
    } catch (error) {
      this.connected = false;
      return false;
    }
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get last successful ping time
   */
  getLastPingTime(): Date | null {
    return this.lastPingTime;
  }

  /**
   * Get Unreal Engine info
   */
  async getInfo(): Promise<{
    version: string;
    projectName: string;
    engineVersion: string;
  }> {
    const response = await this.request<{
      version: string;
      projectName: string;
      engineVersion: string;
    }>('/remote/info', 'GET');

    return response.data!;
  }

  /**
   * List all available presets
   */
  async listPresets(): Promise<RemoteControlPreset[]> {
    const response = await this.request<{ presets: RemoteControlPreset[] }>(
      '/remote/presets',
      'GET'
    );

    return response.data?.presets || [];
  }

  /**
   * Get a specific preset
   */
  async getPreset(presetName: string): Promise<RemoteControlPreset | null> {
    try {
      const response = await this.request<RemoteControlPreset>(
        `/remote/preset/${encodeURIComponent(presetName)}`,
        'GET'
      );

      return response.data || null;
    } catch (error) {
      return null;
    }
  }

  // ============================================================================
  // Object Operations
  // ============================================================================

  /**
   * Call a function on an object
   */
  async callFunction<T = unknown>(
    objectPath: string,
    functionName: string,
    parameters?: Record<string, unknown>,
    generateTransaction: boolean = true
  ): Promise<RemoteControlResponse<T>> {
    return this.request<T>('/remote/object/call', 'PUT', {
      objectPath,
      functionName,
      parameters: parameters || {},
      generateTransaction,
    });
  }

  /**
   * Get a property value from an object
   */
  async getProperty<T = unknown>(
    objectPath: string,
    propertyName: string
  ): Promise<RemoteControlResponse<T>> {
    return this.request<T>('/remote/object/property', 'PUT', {
      objectPath,
      propertyName,
      access: 'READ_ACCESS',
    });
  }

  /**
   * Set a property value on an object
   */
  async setProperty(
    objectPath: string,
    propertyName: string,
    propertyValue: unknown,
    generateTransaction: boolean = true
  ): Promise<RemoteControlResponse<void>> {
    return this.request<void>('/remote/object/property', 'PUT', {
      objectPath,
      propertyName,
      propertyValue,
      access: 'WRITE_ACCESS',
      generateTransaction,
    });
  }

  /**
   * Set multiple properties at once
   */
  async setProperties(
    objectPath: string,
    properties: PropertyValue[],
    generateTransaction: boolean = true
  ): Promise<RemoteControlResponse<void>> {
    // Use batch for efficiency
    const requests: BatchRequest[] = properties.map((prop, index) => ({
      requestId: `prop_${index}`,
      request: {
        objectPath,
        propertyName: prop.propertyName,
        propertyValue: prop.propertyValue,
        access: 'WRITE_ACCESS' as const,
        generateTransaction,
      },
    }));

    const responses = await this.batch(requests);
    const failed = responses.filter((r) => !r.response.success);

    if (failed.length > 0) {
      return {
        success: false,
        error: failed.map((f) => f.response.error).join('; '),
      };
    }

    return { success: true };
  }

  /**
   * Describe an object (get metadata)
   */
  async describeObject(objectPath: string): Promise<RemoteControlResponse<{
    name: string;
    class: string;
    properties: Array<{
      name: string;
      type: string;
      metadata: Record<string, string>;
    }>;
    functions: Array<{
      name: string;
      parameters: Array<{ name: string; type: string }>;
      returnType: string;
    }>;
  }>> {
    return this.request('/remote/object/describe', 'PUT', {
      objectPath,
    });
  }

  // ============================================================================
  // Actor Operations
  // ============================================================================

  /**
   * Spawn an actor in the level
   */
  async spawnActor(
    classPath: string,
    label?: string,
    transform?: {
      location?: { x: number; y: number; z: number };
      rotation?: { pitch: number; yaw: number; roll: number };
      scale?: { x: number; y: number; z: number };
    }
  ): Promise<RemoteControlResponse<{ actorPath: string }>> {
    const editorSubsystem = '/Script/UnrealEd.Default__EditorActorSubsystem';

    const spawnParams: Record<string, unknown> = {
      ActorClass: classPath,
    };

    if (transform?.location) {
      spawnParams.Location = transform.location;
    }

    if (transform?.rotation) {
      spawnParams.Rotation = transform.rotation;
    }

    const result = await this.callFunction<{ ReturnValue: string }>(
      editorSubsystem,
      'SpawnActorFromClass',
      spawnParams
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const actorPath = result.data?.ReturnValue;
    if (!actorPath) {
      return { success: false, error: 'Failed to get spawned actor path' };
    }

    // Set label if provided
    if (label && actorPath) {
      await this.setProperty(actorPath, 'ActorLabel', label);
    }

    // Set scale if provided
    if (transform?.scale && actorPath) {
      await this.setProperty(actorPath, 'RelativeScale3D', transform.scale);
    }

    return {
      success: true,
      data: { actorPath },
    };
  }

  /**
   * Delete an actor from the level
   */
  async deleteActor(actorPath: string): Promise<RemoteControlResponse<void>> {
    const editorSubsystem = '/Script/UnrealEd.Default__EditorActorSubsystem';

    return this.callFunction<void>(editorSubsystem, 'DestroyActor', {
      ActorToDestroy: actorPath,
    });
  }

  /**
   * Get actor information
   */
  async getActorInfo(actorPath: string): Promise<RemoteControlResponse<ActorInfo>> {
    try {
      // Get basic info
      const describeResult = await this.describeObject(actorPath);
      if (!describeResult.success) {
        return { success: false, error: describeResult.error };
      }

      // Get transform
      const transformResult = await this.getProperty<{
        Translation: { X: number; Y: number; Z: number };
        Rotation: { Pitch: number; Yaw: number; Roll: number };
        Scale3D: { X: number; Y: number; Z: number };
      }>(actorPath, 'ActorTransform');

      // Get label
      const labelResult = await this.getProperty<string>(actorPath, 'ActorLabel');

      // Get tags
      const tagsResult = await this.getProperty<string[]>(actorPath, 'Tags');

      const transform = transformResult.data;

      return {
        success: true,
        data: {
          path: actorPath,
          name: describeResult.data!.name,
          class: describeResult.data!.class,
          label: labelResult.data,
          tags: tagsResult.data,
          transform: transform
            ? {
                location: {
                  x: transform.Translation.X,
                  y: transform.Translation.Y,
                  z: transform.Translation.Z,
                },
                rotation: {
                  pitch: transform.Rotation.Pitch,
                  yaw: transform.Rotation.Yaw,
                  roll: transform.Rotation.Roll,
                },
                scale: {
                  x: transform.Scale3D.X,
                  y: transform.Scale3D.Y,
                  z: transform.Scale3D.Z,
                },
              }
            : undefined,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Find actors by class
   */
  async findActorsByClass(className: string): Promise<RemoteControlResponse<string[]>> {
    const gameplayStatics = '/Script/Engine.Default__GameplayStatics';

    const result = await this.callFunction<{ ReturnValue: string[] }>(
      gameplayStatics,
      'GetAllActorsOfClass',
      {
        WorldContextObject: '/Game/Maps/MainLevel',
        ActorClass: className,
      }
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: result.data?.ReturnValue || [],
    };
  }

  /**
   * Find actors by tag
   */
  async findActorsByTag(tag: string): Promise<RemoteControlResponse<string[]>> {
    const gameplayStatics = '/Script/Engine.Default__GameplayStatics';

    const result = await this.callFunction<{ ReturnValue: string[] }>(
      gameplayStatics,
      'GetAllActorsWithTag',
      {
        WorldContextObject: '/Game/Maps/MainLevel',
        Tag: tag,
      }
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: result.data?.ReturnValue || [],
    };
  }

  /**
   * Set actor transform
   */
  async setActorTransform(
    actorPath: string,
    transform: {
      location?: { x: number; y: number; z: number };
      rotation?: { pitch: number; yaw: number; roll: number };
      scale?: { x: number; y: number; z: number };
    }
  ): Promise<RemoteControlResponse<void>> {
    const properties: PropertyValue[] = [];

    if (transform.location) {
      properties.push({
        propertyName: 'RelativeLocation',
        propertyValue: {
          X: transform.location.x,
          Y: transform.location.y,
          Z: transform.location.z,
        },
      });
    }

    if (transform.rotation) {
      properties.push({
        propertyName: 'RelativeRotation',
        propertyValue: {
          Pitch: transform.rotation.pitch,
          Yaw: transform.rotation.yaw,
          Roll: transform.rotation.roll,
        },
      });
    }

    if (transform.scale) {
      properties.push({
        propertyName: 'RelativeScale3D',
        propertyValue: {
          X: transform.scale.x,
          Y: transform.scale.y,
          Z: transform.scale.z,
        },
      });
    }

    return this.setProperties(actorPath, properties);
  }

  // ============================================================================
  // Asset Operations
  // ============================================================================

  /**
   * Search for assets
   */
  async searchAssets(
    searchQuery: string,
    options?: {
      classNames?: string[];
      packagePaths?: string[];
      limit?: number;
    }
  ): Promise<RemoteControlResponse<AssetInfo[]>> {
    const assetRegistry = '/Script/AssetRegistry.Default__AssetRegistryHelpers';

    const filter: Record<string, unknown> = {};
    if (options?.classNames) {
      filter.ClassNames = options.classNames;
    }
    if (options?.packagePaths) {
      filter.PackagePaths = options.packagePaths;
    }

    const result = await this.callFunction<{ ReturnValue: AssetInfo[] }>(
      assetRegistry,
      'GetAssetsByPath',
      {
        PackagePath: searchQuery,
        bRecursive: true,
        Filter: filter,
      }
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    let assets = result.data?.ReturnValue || [];

    if (options?.limit && assets.length > options.limit) {
      assets = assets.slice(0, options.limit);
    }

    return { success: true, data: assets };
  }

  /**
   * Load an asset
   */
  async loadAsset(assetPath: string): Promise<RemoteControlResponse<{ objectPath: string }>> {
    const result = await this.callFunction<{ ReturnValue: string }>(
      '/Script/Engine.Default__KismetSystemLibrary',
      'LoadAsset_Blocking',
      {
        AssetPath: assetPath,
      }
    );

    if (!result.success || !result.data?.ReturnValue) {
      return { success: false, error: result.error || 'Failed to load asset' };
    }

    return {
      success: true,
      data: { objectPath: result.data.ReturnValue },
    };
  }

  // ============================================================================
  // Blueprint Operations
  // ============================================================================

  /**
   * Create a new Blueprint
   */
  async createBlueprint(
    packagePath: string,
    blueprintName: string,
    parentClass: string
  ): Promise<RemoteControlResponse<{ blueprintPath: string }>> {
    const editorBlueprintLibrary =
      '/Script/UnrealEd.Default__EditorAssetSubsystem';

    const result = await this.callFunction<{ ReturnValue: string }>(
      editorBlueprintLibrary,
      'CreateBlueprintAsset',
      {
        AssetPath: `${packagePath}/${blueprintName}`,
        ParentClass: parentClass,
      }
    );

    if (!result.success || !result.data?.ReturnValue) {
      return { success: false, error: result.error || 'Failed to create blueprint' };
    }

    return {
      success: true,
      data: { blueprintPath: result.data.ReturnValue },
    };
  }

  /**
   * Compile a Blueprint
   */
  async compileBlueprint(blueprintPath: string): Promise<RemoteControlResponse<{
    success: boolean;
    errors?: string[];
    warnings?: string[];
  }>> {
    const kismetEditorUtilities =
      '/Script/UnrealEd.Default__KismetEditorUtilities';

    const result = await this.callFunction<{
      ReturnValue: boolean;
      CompileLog: string[];
    }>(kismetEditorUtilities, 'CompileBlueprint', {
      Blueprint: blueprintPath,
    });

    return {
      success: result.success && result.data?.ReturnValue === true,
      data: {
        success: result.data?.ReturnValue === true,
        errors: result.data?.CompileLog?.filter((l) => l.includes('Error')),
        warnings: result.data?.CompileLog?.filter((l) => l.includes('Warning')),
      },
    };
  }

  // ============================================================================
  // Editor Operations
  // ============================================================================

  /**
   * Execute an editor command
   */
  async executeEditorCommand(command: EditorCommand): Promise<RemoteControlResponse<string>> {
    const editorEngine = '/Script/UnrealEd.Default__EditorEngine';

    const cmdString = command.parameters
      ? `${command.command} ${command.parameters.join(' ')}`
      : command.command;

    return this.callFunction<string>(editorEngine, 'Exec', {
      Command: cmdString,
    });
  }

  /**
   * Get selected actors in editor
   */
  async getSelectedActors(): Promise<RemoteControlResponse<string[]>> {
    const editorSubsystem = '/Script/UnrealEd.Default__EditorActorSubsystem';

    const result = await this.callFunction<{ ReturnValue: string[] }>(
      editorSubsystem,
      'GetSelectedLevelActors'
    );

    return {
      success: result.success,
      data: result.data?.ReturnValue || [],
      error: result.error,
    };
  }

  /**
   * Select actors in editor
   */
  async selectActors(actorPaths: string[]): Promise<RemoteControlResponse<void>> {
    const editorSubsystem = '/Script/UnrealEd.Default__EditorActorSubsystem';

    // Clear selection first
    await this.callFunction(editorSubsystem, 'ClearActorSelectionSet');

    // Select new actors
    for (const path of actorPaths) {
      await this.callFunction(editorSubsystem, 'SetActorSelectionState', {
        Actor: path,
        bShouldBeSelected: true,
      });
    }

    return { success: true };
  }

  /**
   * Focus camera on actor
   */
  async focusOnActor(actorPath: string): Promise<RemoteControlResponse<void>> {
    const editorSubsystem = '/Script/UnrealEd.Default__EditorActorSubsystem';

    return this.callFunction<void>(editorSubsystem, 'SetSelectedLevelActors', {
      ActorsToSelect: [actorPath],
    }).then(async () => {
      // Execute focus command
      return this.executeEditorCommand({ command: 'CAMERA ALIGN ACTIVEVIEWPORTONLY' });
    }).then(() => ({ success: true }));
  }

  /**
   * Get current level name
   */
  async getCurrentLevelName(): Promise<RemoteControlResponse<string>> {
    const gameplayStatics = '/Script/Engine.Default__GameplayStatics';

    const result = await this.callFunction<{ ReturnValue: string }>(
      gameplayStatics,
      'GetCurrentLevelName',
      {
        WorldContextObject: '/Game/Maps/MainLevel',
      }
    );

    return {
      success: result.success,
      data: result.data?.ReturnValue,
      error: result.error,
    };
  }

  /**
   * Open a level
   */
  async openLevel(levelPath: string): Promise<RemoteControlResponse<void>> {
    const editorLoadingAndSavingUtils =
      '/Script/UnrealEd.Default__EditorLoadingAndSavingUtils';

    return this.callFunction<void>(
      editorLoadingAndSavingUtils,
      'LoadMap',
      {
        Filename: levelPath,
      }
    );
  }

  /**
   * Save current level
   */
  async saveCurrentLevel(): Promise<RemoteControlResponse<void>> {
    const editorLoadingAndSavingUtils =
      '/Script/UnrealEd.Default__EditorLoadingAndSavingUtils';

    return this.callFunction<void>(editorLoadingAndSavingUtils, 'SaveCurrentLevel');
  }

  /**
   * Undo last action
   */
  async undo(): Promise<RemoteControlResponse<void>> {
    return this.executeEditorCommand({ command: 'TRANSACTION UNDO' }).then(() => ({
      success: true,
    }));
  }

  /**
   * Redo last undone action
   */
  async redo(): Promise<RemoteControlResponse<void>> {
    return this.executeEditorCommand({ command: 'TRANSACTION REDO' }).then(() => ({
      success: true,
    }));
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  /**
   * Execute multiple requests in a batch
   */
  async batch(requests: BatchRequest[]): Promise<BatchResponse[]> {
    const response = await this.request<{ responses: BatchResponse[] }>(
      '/remote/batch',
      'PUT',
      { requests }
    );

    return response.data?.responses || [];
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async request<T>(
    endpoint: string,
    method: string,
    body?: unknown
  ): Promise<RemoteControlResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const startTime = Date.now();

    const executeRequest = async (): Promise<RemoteControlResponse<T>> => {
      if (this.config.enableLogging) {
        this.logger.debug('Remote control request', {
          method,
          endpoint,
          body: body ? JSON.stringify(body).substring(0, 500) : undefined,
        });
      }

      const response = await this.fetchWithTimeout(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const executionTimeMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new UnrealConnectionError(
          `HTTP ${response.status}: ${errorText}`,
          this.config.host,
          this.config.httpPort
        );
      }

      const data = await response.json();

      if (this.config.enableLogging) {
        this.logger.debug('Remote control response', {
          endpoint,
          executionTimeMs,
          success: true,
        });
      }

      this.connected = true;
      this.lastPingTime = new Date();

      return {
        success: true,
        data,
        executionTimeMs,
      };
    };

    if (this.config.enableRetries) {
      try {
        return await retryWithBackoff(
          executeRequest,
          this.config.maxRetries,
          this.config.retryDelayMs
        );
      } catch (error) {
        this.connected = false;
        throw error;
      }
    }

    try {
      return await executeRequest();
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs
    );

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new UnrealConnectionError(
          'Request timed out',
          this.config.host,
          this.config.httpPort
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createRemoteControlClient(
  config: Partial<RemoteControlConfig>,
  logger: Logger
): RemoteControlClient {
  return new RemoteControlClient(config, logger);
}
