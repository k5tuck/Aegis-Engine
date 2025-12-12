/**
 * AEGIS State Synchronization
 * Maintains synchronized state between MCP server and Unreal Engine
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { RemoteControlClient, ActorInfo, AssetInfo } from './remote-control.js';
import { UnrealWebSocketClient, WebSocketEvent, WebSocketEventType } from './websocket.js';

// ============================================================================
// Types
// ============================================================================

export interface StateSyncConfig {
  /** Enable automatic state synchronization */
  autoSync: boolean;

  /** Sync interval in ms */
  syncIntervalMs: number;

  /** Cache TTL in ms */
  cacheTtlMs: number;

  /** Maximum cached actors */
  maxCachedActors: number;

  /** Maximum cached assets */
  maxCachedAssets: number;

  /** Enable change tracking */
  enableChangeTracking: boolean;

  /** Maximum tracked changes */
  maxTrackedChanges: number;
}

export interface SyncedActor {
  info: ActorInfo;
  lastSyncedAt: Date;
  dirty: boolean;
  localChanges?: Partial<ActorInfo>;
}

export interface SyncedAsset {
  info: AssetInfo;
  lastSyncedAt: Date;
  loaded: boolean;
}

export interface TrackedChange {
  id: string;
  type: 'actor' | 'asset' | 'property' | 'level';
  target: string;
  changeType: 'create' | 'modify' | 'delete';
  timestamp: Date;
  previousValue?: unknown;
  newValue?: unknown;
  source: 'local' | 'remote';
  undoable: boolean;
}

export interface LevelState {
  name: string;
  path: string;
  actors: string[];
  lastSyncedAt: Date;
  dirty: boolean;
}

export interface EditorState {
  selectedActors: string[];
  viewportCamera?: {
    location: { x: number; y: number; z: number };
    rotation: { pitch: number; yaw: number; roll: number };
  };
  isPlaying: boolean;
  isPaused: boolean;
}

export interface SyncStatus {
  connected: boolean;
  lastSyncTime: Date | null;
  pendingChanges: number;
  actorsCached: number;
  assetsCached: number;
  changeHistory: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: StateSyncConfig = {
  autoSync: true,
  syncIntervalMs: 5000,
  cacheTtlMs: 60000,
  maxCachedActors: 1000,
  maxCachedAssets: 500,
  enableChangeTracking: true,
  maxTrackedChanges: 100,
};

// ============================================================================
// State Synchronization Manager
// ============================================================================

export class StateSyncManager extends EventEmitter {
  private config: StateSyncConfig;
  private logger: Logger;
  private remoteControl: RemoteControlClient;
  private webSocket: UnrealWebSocketClient;

  // State caches
  private actorCache: Map<string, SyncedActor> = new Map();
  private assetCache: Map<string, SyncedAsset> = new Map();
  private levelState: LevelState | null = null;
  private editorState: EditorState | null = null;

  // Change tracking
  private changeHistory: TrackedChange[] = [];
  private pendingChanges: Map<string, TrackedChange> = new Map();

  // Sync management
  private syncTimer: NodeJS.Timeout | null = null;
  private lastSyncTime: Date | null = null;
  private syncInProgress: boolean = false;

  // Event subscriptions
  private unsubscribers: Array<() => void> = [];

  constructor(
    config: Partial<StateSyncConfig>,
    remoteControl: RemoteControlClient,
    webSocket: UnrealWebSocketClient,
    logger: Logger
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.remoteControl = remoteControl;
    this.webSocket = webSocket;
    this.logger = logger.child({ component: 'StateSyncManager' });
  }

  /**
   * Initialize state synchronization
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing state sync manager');

    // Subscribe to WebSocket events
    this.setupEventSubscriptions();

    // Perform initial sync
    await this.performFullSync();

    // Start auto-sync if enabled
    if (this.config.autoSync) {
      this.startAutoSync();
    }

    this.logger.info('State sync manager initialized');
  }

  /**
   * Shutdown state synchronization
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down state sync manager');

    // Stop auto-sync
    this.stopAutoSync();

    // Unsubscribe from events
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    // Clear caches
    this.actorCache.clear();
    this.assetCache.clear();
    this.changeHistory = [];
    this.pendingChanges.clear();

    this.logger.info('State sync manager shutdown complete');
  }

  /**
   * Get synchronization status
   */
  getStatus(): SyncStatus {
    return {
      connected: this.remoteControl.isConnected() && this.webSocket.isConnected(),
      lastSyncTime: this.lastSyncTime,
      pendingChanges: this.pendingChanges.size,
      actorsCached: this.actorCache.size,
      assetsCached: this.assetCache.size,
      changeHistory: this.changeHistory.length,
    };
  }

  // ============================================================================
  // Actor Operations
  // ============================================================================

  /**
   * Get actor from cache or fetch from UE
   */
  async getActor(actorPath: string, forceRefresh: boolean = false): Promise<SyncedActor | null> {
    const cached = this.actorCache.get(actorPath);

    // Return cached if fresh
    if (cached && !forceRefresh && !this.isCacheStale(cached.lastSyncedAt)) {
      return cached;
    }

    // Fetch from UE
    const result = await this.remoteControl.getActorInfo(actorPath);
    if (!result.success || !result.data) {
      // Remove from cache if actor no longer exists
      if (cached) {
        this.actorCache.delete(actorPath);
      }
      return null;
    }

    // Update cache
    const synced: SyncedActor = {
      info: result.data,
      lastSyncedAt: new Date(),
      dirty: false,
    };

    this.actorCache.set(actorPath, synced);
    this.enforceActorCacheLimit();

    return synced;
  }

  /**
   * Get multiple actors
   */
  async getActors(actorPaths: string[]): Promise<Map<string, SyncedActor>> {
    const results = new Map<string, SyncedActor>();

    // Fetch in parallel
    const promises = actorPaths.map(async (path) => {
      const actor = await this.getActor(path);
      if (actor) {
        results.set(path, actor);
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Mark actor as dirty (has local changes)
   */
  markActorDirty(actorPath: string, changes: Partial<ActorInfo>): void {
    const cached = this.actorCache.get(actorPath);
    if (cached) {
      cached.dirty = true;
      cached.localChanges = { ...cached.localChanges, ...changes };
    }
  }

  /**
   * Get all cached actors
   */
  getCachedActors(): SyncedActor[] {
    return Array.from(this.actorCache.values());
  }

  /**
   * Get actors by class
   */
  getCachedActorsByClass(className: string): SyncedActor[] {
    return Array.from(this.actorCache.values()).filter(
      (a) => a.info.class === className || a.info.class.endsWith(className)
    );
  }

  /**
   * Clear actor cache
   */
  clearActorCache(): void {
    this.actorCache.clear();
    this.logger.debug('Actor cache cleared');
  }

  // ============================================================================
  // Asset Operations
  // ============================================================================

  /**
   * Get asset from cache or fetch from UE
   */
  async getAsset(assetPath: string, forceRefresh: boolean = false): Promise<SyncedAsset | null> {
    const cached = this.assetCache.get(assetPath);

    if (cached && !forceRefresh && !this.isCacheStale(cached.lastSyncedAt)) {
      return cached;
    }

    // Search for asset
    const result = await this.remoteControl.searchAssets(assetPath, { limit: 1 });
    if (!result.success || !result.data || result.data.length === 0) {
      if (cached) {
        this.assetCache.delete(assetPath);
      }
      return null;
    }

    const synced: SyncedAsset = {
      info: result.data[0],
      lastSyncedAt: new Date(),
      loaded: false,
    };

    this.assetCache.set(assetPath, synced);
    this.enforceAssetCacheLimit();

    return synced;
  }

  /**
   * Get cached assets
   */
  getCachedAssets(): SyncedAsset[] {
    return Array.from(this.assetCache.values());
  }

  /**
   * Clear asset cache
   */
  clearAssetCache(): void {
    this.assetCache.clear();
    this.logger.debug('Asset cache cleared');
  }

  // ============================================================================
  // Level State
  // ============================================================================

  /**
   * Get current level state
   */
  async getLevelState(forceRefresh: boolean = false): Promise<LevelState | null> {
    if (this.levelState && !forceRefresh && !this.isCacheStale(this.levelState.lastSyncedAt)) {
      return this.levelState;
    }

    await this.syncLevelState();
    return this.levelState;
  }

  /**
   * Sync level state from UE
   */
  async syncLevelState(): Promise<void> {
    const levelResult = await this.remoteControl.getCurrentLevelName();
    if (!levelResult.success) {
      return;
    }

    // Get all actors in level (simplified - would need proper implementation)
    const actorsResult = await this.remoteControl.findActorsByClass('AActor');

    this.levelState = {
      name: levelResult.data || 'Unknown',
      path: `/Game/Maps/${levelResult.data}`,
      actors: actorsResult.data || [],
      lastSyncedAt: new Date(),
      dirty: false,
    };

    this.emit('level_synced', this.levelState);
  }

  // ============================================================================
  // Editor State
  // ============================================================================

  /**
   * Get current editor state
   */
  async getEditorState(forceRefresh: boolean = false): Promise<EditorState | null> {
    if (this.editorState && !forceRefresh) {
      return this.editorState;
    }

    await this.syncEditorState();
    return this.editorState;
  }

  /**
   * Sync editor state from UE
   */
  async syncEditorState(): Promise<void> {
    const selectedResult = await this.remoteControl.getSelectedActors();

    this.editorState = {
      selectedActors: selectedResult.data || [],
      isPlaying: false,
      isPaused: false,
    };

    this.emit('editor_state_synced', this.editorState);
  }

  // ============================================================================
  // Change Tracking
  // ============================================================================

  /**
   * Record a change
   */
  recordChange(change: Omit<TrackedChange, 'id' | 'timestamp'>): string {
    if (!this.config.enableChangeTracking) {
      return '';
    }

    const id = `change_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const trackedChange: TrackedChange = {
      id,
      timestamp: new Date(),
      ...change,
    };

    this.changeHistory.unshift(trackedChange);

    // Enforce limit
    while (this.changeHistory.length > this.config.maxTrackedChanges) {
      this.changeHistory.pop();
    }

    this.emit('change_recorded', trackedChange);
    this.logger.debug('Change recorded', { id, type: change.type, target: change.target });

    return id;
  }

  /**
   * Get change history
   */
  getChangeHistory(limit?: number): TrackedChange[] {
    if (limit) {
      return this.changeHistory.slice(0, limit);
    }
    return [...this.changeHistory];
  }

  /**
   * Get changes for a specific target
   */
  getChangesForTarget(target: string): TrackedChange[] {
    return this.changeHistory.filter((c) => c.target === target);
  }

  /**
   * Get undoable changes
   */
  getUndoableChanges(): TrackedChange[] {
    return this.changeHistory.filter((c) => c.undoable);
  }

  /**
   * Clear change history
   */
  clearChangeHistory(): void {
    this.changeHistory = [];
    this.logger.debug('Change history cleared');
  }

  // ============================================================================
  // Synchronization
  // ============================================================================

  /**
   * Perform full state synchronization
   */
  async performFullSync(): Promise<void> {
    if (this.syncInProgress) {
      this.logger.warn('Sync already in progress');
      return;
    }

    this.syncInProgress = true;
    this.logger.info('Starting full state sync');

    try {
      // Sync level state
      await this.syncLevelState();

      // Sync editor state
      await this.syncEditorState();

      // Refresh dirty actors
      const dirtyActors = Array.from(this.actorCache.entries())
        .filter(([_, a]) => a.dirty)
        .map(([path, _]) => path);

      for (const path of dirtyActors) {
        await this.getActor(path, true);
      }

      this.lastSyncTime = new Date();
      this.emit('sync_complete', { timestamp: this.lastSyncTime });
      this.logger.info('Full state sync complete');
    } catch (error) {
      this.logger.error('Full state sync failed', error as Error);
      this.emit('sync_error', error);
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Start automatic synchronization
   */
  startAutoSync(): void {
    if (this.syncTimer) {
      return;
    }

    this.syncTimer = setInterval(async () => {
      if (!this.syncInProgress) {
        await this.performFullSync();
      }
    }, this.config.syncIntervalMs);

    this.logger.debug('Auto-sync started', { interval: this.config.syncIntervalMs });
  }

  /**
   * Stop automatic synchronization
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      this.logger.debug('Auto-sync stopped');
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupEventSubscriptions(): void {
    // Actor events
    this.unsubscribers.push(
      this.webSocket.subscribe('actor_spawned', (event) => this.handleActorSpawned(event))
    );

    this.unsubscribers.push(
      this.webSocket.subscribe('actor_deleted', (event) => this.handleActorDeleted(event))
    );

    this.unsubscribers.push(
      this.webSocket.subscribe('actor_modified', (event) => this.handleActorModified(event))
    );

    // Property events
    this.unsubscribers.push(
      this.webSocket.subscribe('property_changed', (event) => this.handlePropertyChanged(event))
    );

    // Level events
    this.unsubscribers.push(
      this.webSocket.subscribe('level_loaded', (event) => this.handleLevelLoaded(event))
    );

    this.unsubscribers.push(
      this.webSocket.subscribe('level_saved', (event) => this.handleLevelSaved(event))
    );

    // Selection events
    this.unsubscribers.push(
      this.webSocket.subscribe('selection_changed', (event) => this.handleSelectionChanged(event))
    );

    // Transaction events
    this.unsubscribers.push(
      this.webSocket.subscribe('transaction_ended', (event) => this.handleTransactionEnded(event))
    );
  }

  private handleActorSpawned(event: WebSocketEvent): void {
    const data = event.data as { actorPath: string; actorClass: string };

    this.logger.debug('Actor spawned event', { actorPath: data.actorPath });

    // Record change
    this.recordChange({
      type: 'actor',
      target: data.actorPath,
      changeType: 'create',
      newValue: data,
      source: 'remote',
      undoable: true,
    });

    // Update level state
    if (this.levelState) {
      this.levelState.actors.push(data.actorPath);
      this.levelState.dirty = true;
    }

    this.emit('actor_spawned', data);
  }

  private handleActorDeleted(event: WebSocketEvent): void {
    const data = event.data as { actorPath: string };

    this.logger.debug('Actor deleted event', { actorPath: data.actorPath });

    // Get previous value from cache
    const cached = this.actorCache.get(data.actorPath);

    // Record change
    this.recordChange({
      type: 'actor',
      target: data.actorPath,
      changeType: 'delete',
      previousValue: cached?.info,
      source: 'remote',
      undoable: true,
    });

    // Remove from cache
    this.actorCache.delete(data.actorPath);

    // Update level state
    if (this.levelState) {
      this.levelState.actors = this.levelState.actors.filter((a) => a !== data.actorPath);
      this.levelState.dirty = true;
    }

    this.emit('actor_deleted', data);
  }

  private handleActorModified(event: WebSocketEvent): void {
    const data = event.data as { actorPath: string; changes: Record<string, unknown> };

    this.logger.debug('Actor modified event', { actorPath: data.actorPath });

    // Get previous value from cache
    const cached = this.actorCache.get(data.actorPath);

    // Record change
    this.recordChange({
      type: 'actor',
      target: data.actorPath,
      changeType: 'modify',
      previousValue: cached?.info,
      newValue: data.changes,
      source: 'remote',
      undoable: true,
    });

    // Mark as dirty to refresh on next access
    if (cached) {
      cached.dirty = true;
    }

    this.emit('actor_modified', data);
  }

  private handlePropertyChanged(event: WebSocketEvent): void {
    const data = event.data as {
      objectPath: string;
      propertyName: string;
      oldValue: unknown;
      newValue: unknown;
    };

    this.logger.debug('Property changed event', {
      objectPath: data.objectPath,
      propertyName: data.propertyName,
    });

    // Record change
    this.recordChange({
      type: 'property',
      target: `${data.objectPath}.${data.propertyName}`,
      changeType: 'modify',
      previousValue: data.oldValue,
      newValue: data.newValue,
      source: 'remote',
      undoable: true,
    });

    // Mark actor as dirty if it's cached
    const cached = this.actorCache.get(data.objectPath);
    if (cached) {
      cached.dirty = true;
    }

    this.emit('property_changed', data);
  }

  private handleLevelLoaded(event: WebSocketEvent): void {
    const data = event.data as { levelName: string; levelPath: string };

    this.logger.info('Level loaded event', { levelName: data.levelName });

    // Clear caches on level change
    this.actorCache.clear();

    // Record change
    this.recordChange({
      type: 'level',
      target: data.levelPath,
      changeType: 'modify',
      newValue: data,
      source: 'remote',
      undoable: false,
    });

    // Trigger full sync
    this.performFullSync();

    this.emit('level_loaded', data);
  }

  private handleLevelSaved(event: WebSocketEvent): void {
    const data = event.data as { levelName: string };

    this.logger.info('Level saved event', { levelName: data.levelName });

    if (this.levelState) {
      this.levelState.dirty = false;
    }

    this.emit('level_saved', data);
  }

  private handleSelectionChanged(event: WebSocketEvent): void {
    const data = event.data as { selectedActors: string[] };

    this.logger.debug('Selection changed event', { count: data.selectedActors.length });

    if (this.editorState) {
      this.editorState.selectedActors = data.selectedActors;
    }

    this.emit('selection_changed', data);
  }

  private handleTransactionEnded(event: WebSocketEvent): void {
    const data = event.data as { transactionName: string; objectsModified: string[] };

    this.logger.debug('Transaction ended event', {
      transaction: data.transactionName,
      objects: data.objectsModified.length,
    });

    // Mark all modified objects as dirty
    for (const path of data.objectsModified) {
      const cached = this.actorCache.get(path);
      if (cached) {
        cached.dirty = true;
      }
    }

    this.emit('transaction_ended', data);
  }

  private isCacheStale(lastSyncedAt: Date): boolean {
    return Date.now() - lastSyncedAt.getTime() > this.config.cacheTtlMs;
  }

  private enforceActorCacheLimit(): void {
    if (this.actorCache.size <= this.config.maxCachedActors) {
      return;
    }

    // Remove oldest entries
    const entries = Array.from(this.actorCache.entries())
      .sort((a, b) => a[1].lastSyncedAt.getTime() - b[1].lastSyncedAt.getTime());

    const toRemove = entries.slice(0, this.actorCache.size - this.config.maxCachedActors);
    for (const [path] of toRemove) {
      this.actorCache.delete(path);
    }
  }

  private enforceAssetCacheLimit(): void {
    if (this.assetCache.size <= this.config.maxCachedAssets) {
      return;
    }

    const entries = Array.from(this.assetCache.entries())
      .sort((a, b) => a[1].lastSyncedAt.getTime() - b[1].lastSyncedAt.getTime());

    const toRemove = entries.slice(0, this.assetCache.size - this.config.maxCachedAssets);
    for (const [path] of toRemove) {
      this.assetCache.delete(path);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createStateSyncManager(
  config: Partial<StateSyncConfig>,
  remoteControl: RemoteControlClient,
  webSocket: UnrealWebSocketClient,
  logger: Logger
): StateSyncManager {
  return new StateSyncManager(config, remoteControl, webSocket, logger);
}
