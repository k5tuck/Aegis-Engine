/**
 * AEGIS Bridge - Export Module
 * Unreal Engine communication layer
 */

// Remote Control HTTP Client
export {
  RemoteControlClient,
  RemoteControlConfig,
  RemoteControlRequest,
  RemoteControlResponse,
  BatchRequest,
  BatchResponse,
  PropertyValue,
  ActorInfo,
  AssetInfo,
  RemoteControlPreset,
  EditorCommand,
  createRemoteControlClient,
} from './remote-control.js';

// WebSocket Client
export {
  UnrealWebSocketClient,
  WebSocketConfig,
  WebSocketMessage,
  WebSocketEvent,
  WebSocketEventType,
  UnrealWebSocketEvents,
  createUnrealWebSocketClient,
} from './websocket.js';

// State Synchronization
export {
  StateSyncManager,
  StateSyncConfig,
  SyncedActor,
  SyncedAsset,
  TrackedChange,
  LevelState,
  EditorState,
  SyncStatus,
  createStateSyncManager,
} from './state-sync.js';

// ============================================================================
// Bridge Manager - Unified Interface
// ============================================================================

import { Logger } from '../utils/logger.js';
import { RemoteControlClient, RemoteControlConfig, createRemoteControlClient } from './remote-control.js';
import { UnrealWebSocketClient, WebSocketConfig, createUnrealWebSocketClient } from './websocket.js';
import { StateSyncManager, StateSyncConfig, createStateSyncManager } from './state-sync.js';

export interface BridgeManagerConfig {
  remoteControl: Partial<RemoteControlConfig>;
  webSocket: Partial<WebSocketConfig>;
  stateSync: Partial<StateSyncConfig>;
}

export interface BridgeStatus {
  httpConnected: boolean;
  wsConnected: boolean;
  lastHttpPing: Date | null;
  lastWsMessage: Date | null;
  syncStatus: {
    connected: boolean;
    lastSyncTime: Date | null;
    pendingChanges: number;
    actorsCached: number;
    assetsCached: number;
  };
}

/**
 * Unified bridge manager that coordinates all UE communication components
 */
export class BridgeManager {
  public readonly remoteControl: RemoteControlClient;
  public readonly webSocket: UnrealWebSocketClient;
  public readonly stateSync: StateSyncManager;

  private logger: Logger;
  private initialized: boolean = false;

  constructor(config: Partial<BridgeManagerConfig>, logger: Logger) {
    this.logger = logger.child({ component: 'BridgeManager' });

    const rcConfig = config.remoteControl || {};
    const wsConfig = config.webSocket || {};
    const ssConfig = config.stateSync || {};

    // Create remote control client
    this.remoteControl = createRemoteControlClient(rcConfig, logger);

    // Create WebSocket client
    this.webSocket = createUnrealWebSocketClient(wsConfig, logger);

    // Create state sync manager
    this.stateSync = createStateSyncManager(
      ssConfig,
      this.remoteControl,
      this.webSocket,
      logger
    );

    // Setup event forwarding
    this.setupEventForwarding();
  }

  /**
   * Initialize the bridge and connect to Unreal Engine
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('Bridge manager already initialized');
      return;
    }

    this.logger.info('Initializing bridge manager');

    // Check HTTP connection
    const httpConnected = await this.remoteControl.checkConnection();
    if (!httpConnected) {
      this.logger.warn('Could not connect to UE Remote Control API');
    } else {
      this.logger.info('Connected to UE Remote Control API');
    }

    // Connect WebSocket
    try {
      await this.webSocket.connect();
      this.logger.info('Connected to UE WebSocket');
    } catch (error) {
      this.logger.warn('Could not connect to UE WebSocket', { error });
    }

    // Initialize state sync
    await this.stateSync.initialize();

    this.initialized = true;
    this.logger.info('Bridge manager initialized');
  }

  /**
   * Shutdown the bridge
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.info('Shutting down bridge manager');

    // Shutdown state sync
    await this.stateSync.shutdown();

    // Disconnect WebSocket
    await this.webSocket.disconnect();

    this.initialized = false;
    this.logger.info('Bridge manager shutdown complete');
  }

  /**
   * Check if bridge is connected
   */
  isConnected(): boolean {
    return this.remoteControl.isConnected() || this.webSocket.isConnected();
  }

  /**
   * Get bridge status
   */
  getStatus(): BridgeStatus {
    const syncStatus = this.stateSync.getStatus();

    return {
      httpConnected: this.remoteControl.isConnected(),
      wsConnected: this.webSocket.isConnected(),
      lastHttpPing: this.remoteControl.getLastPingTime(),
      lastWsMessage: this.webSocket.getLastMessageTime(),
      syncStatus: {
        connected: syncStatus.connected,
        lastSyncTime: syncStatus.lastSyncTime,
        pendingChanges: syncStatus.pendingChanges,
        actorsCached: syncStatus.actorsCached,
        assetsCached: syncStatus.assetsCached,
      },
    };
  }

  /**
   * Wait for connection with timeout
   */
  async waitForConnection(timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (this.isConnected()) {
        return true;
      }

      // Try to reconnect
      if (!this.remoteControl.isConnected()) {
        await this.remoteControl.checkConnection();
      }

      if (!this.webSocket.isConnected()) {
        try {
          await this.webSocket.connect();
        } catch {
          // Ignore connection errors during retry
        }
      }

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return this.isConnected();
  }

  /**
   * Execute a command through the bridge
   */
  async executeCommand(
    objectPath: string,
    functionName: string,
    parameters?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
  }> {
    const result = await this.remoteControl.callFunction(
      objectPath,
      functionName,
      parameters
    );

    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }

  /**
   * Get a property value
   */
  async getProperty<T = unknown>(
    objectPath: string,
    propertyName: string
  ): Promise<{
    success: boolean;
    value?: T;
    error?: string;
  }> {
    const result = await this.remoteControl.getProperty<T>(objectPath, propertyName);

    return {
      success: result.success,
      value: result.data,
      error: result.error,
    };
  }

  /**
   * Set a property value
   */
  async setProperty(
    objectPath: string,
    propertyName: string,
    value: unknown
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    const result = await this.remoteControl.setProperty(objectPath, propertyName, value);

    return {
      success: result.success,
      error: result.error,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupEventForwarding(): void {
    // Forward WebSocket events
    this.webSocket.on('connected', () => {
      this.logger.info('WebSocket connected');
    });

    this.webSocket.on('disconnected', (event) => {
      this.logger.info('WebSocket disconnected', event);
    });

    this.webSocket.on('error', (error) => {
      this.logger.error('WebSocket error', error);
    });

    // Forward state sync events
    this.stateSync.on('sync_complete', (data) => {
      this.logger.debug('State sync complete', data);
    });

    this.stateSync.on('sync_error', (error) => {
      this.logger.error('State sync error', error as Error);
    });
  }
}

/**
 * Create a bridge manager with default configuration
 */
export function createBridgeManager(
  config: Partial<BridgeManagerConfig>,
  logger: Logger
): BridgeManager {
  return new BridgeManager(config, logger);
}
