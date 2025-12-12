/**
 * AEGIS Rollback System
 * Provides undo/rollback capabilities for executed actions
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/logger.js';
import { ExecutionError } from '../utils/errors.js';

// ============================================================================
// Types
// ============================================================================

export interface RollbackState {
  id: string;
  timestamp: Date;
  actionId: string;
  command: string;
  target: string;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  rollbackCommand: string;
  rollbackParams: Record<string, unknown>;
  sessionId: string;
  rolledBack: boolean;
  rolledBackAt?: Date;
}

export interface RollbackResult {
  success: boolean;
  rollbackId: string;
  restoredState?: Record<string, unknown>;
  error?: string;
}

export interface RollbackConfig {
  maxHistorySize: number;
  maxHistoryAge: number; // in milliseconds
  enableAutoCleanup: boolean;
  cleanupIntervalMs: number;
}

export interface RollbackGroup {
  id: string;
  name: string;
  timestamp: Date;
  states: RollbackState[];
  sessionId: string;
  description?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: RollbackConfig = {
  maxHistorySize: 1000,
  maxHistoryAge: 24 * 60 * 60 * 1000, // 24 hours
  enableAutoCleanup: true,
  cleanupIntervalMs: 300000, // 5 minutes
};

// ============================================================================
// Rollback Manager Implementation
// ============================================================================

export class RollbackManager {
  private history: Map<string, RollbackState> = new Map();
  private groups: Map<string, RollbackGroup> = new Map();
  private sessionHistory: Map<string, string[]> = new Map(); // sessionId -> rollbackIds
  private config: RollbackConfig;
  private logger: Logger;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<RollbackConfig> = {}, logger: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger.child({ component: 'RollbackManager' });

    if (this.config.enableAutoCleanup) {
      this.cleanupInterval = setInterval(
        () => this.cleanupOldHistory(),
        this.config.cleanupIntervalMs
      );
    }

    this.logger.info('Rollback manager initialized', {
      maxHistorySize: this.config.maxHistorySize,
      maxHistoryAge: this.config.maxHistoryAge,
    });
  }

  /**
   * Record a state for potential rollback
   */
  recordState(
    actionId: string,
    command: string,
    target: string,
    previousState: Record<string, unknown>,
    newState: Record<string, unknown>,
    sessionId: string,
    rollbackInfo?: {
      command: string;
      params: Record<string, unknown>;
    }
  ): RollbackState {
    const id = uuidv4();

    // Generate rollback command if not provided
    const rollbackCommand = rollbackInfo?.command || this.generateRollbackCommand(command);
    const rollbackParams = rollbackInfo?.params || this.generateRollbackParams(command, target, previousState);

    const state: RollbackState = {
      id,
      timestamp: new Date(),
      actionId,
      command,
      target,
      previousState,
      newState,
      rollbackCommand,
      rollbackParams,
      sessionId,
      rolledBack: false,
    };

    // Enforce max history size
    if (this.history.size >= this.config.maxHistorySize) {
      this.removeOldestEntry();
    }

    this.history.set(id, state);

    // Track by session
    if (!this.sessionHistory.has(sessionId)) {
      this.sessionHistory.set(sessionId, []);
    }
    this.sessionHistory.get(sessionId)!.push(id);

    this.logger.debug('Rollback state recorded', {
      rollbackId: id,
      actionId,
      command,
      target,
    });

    return state;
  }

  /**
   * Get rollback state by ID
   */
  getState(rollbackId: string): RollbackState | undefined {
    return this.history.get(rollbackId);
  }

  /**
   * Get rollback history for a session
   */
  getSessionHistory(sessionId: string, limit: number = 50): RollbackState[] {
    const ids = this.sessionHistory.get(sessionId) || [];
    const states: RollbackState[] = [];

    for (const id of ids.slice(-limit).reverse()) {
      const state = this.history.get(id);
      if (state && !state.rolledBack) {
        states.push(state);
      }
    }

    return states;
  }

  /**
   * Get the most recent rollback state for a target
   */
  getLatestStateForTarget(target: string, sessionId: string): RollbackState | undefined {
    const sessionStates = this.getSessionHistory(sessionId);
    return sessionStates.find((s) => s.target === target && !s.rolledBack);
  }

  /**
   * Create a rollback group for batch operations
   */
  createGroup(name: string, sessionId: string, description?: string): RollbackGroup {
    const id = uuidv4();

    const group: RollbackGroup = {
      id,
      name,
      timestamp: new Date(),
      states: [],
      sessionId,
      description,
    };

    this.groups.set(id, group);

    this.logger.debug('Rollback group created', {
      groupId: id,
      name,
    });

    return group;
  }

  /**
   * Add a state to a rollback group
   */
  addToGroup(groupId: string, state: RollbackState): void {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`Rollback group ${groupId} not found`);
    }

    group.states.push(state);
  }

  /**
   * Prepare rollback for a single state
   */
  prepareRollback(rollbackId: string): { command: string; params: Record<string, unknown> } {
    const state = this.history.get(rollbackId);

    if (!state) {
      throw new ExecutionError('rollback', `Rollback state ${rollbackId} not found`, false);
    }

    if (state.rolledBack) {
      throw new ExecutionError('rollback', 'State has already been rolled back', false);
    }

    return {
      command: state.rollbackCommand,
      params: state.rollbackParams,
    };
  }

  /**
   * Prepare rollback for a group (in reverse order)
   */
  prepareGroupRollback(
    groupId: string
  ): Array<{ command: string; params: Record<string, unknown>; stateId: string }> {
    const group = this.groups.get(groupId);

    if (!group) {
      throw new ExecutionError('rollback', `Rollback group ${groupId} not found`, false);
    }

    // Reverse order for proper rollback sequence
    return group.states
      .filter((s) => !s.rolledBack)
      .reverse()
      .map((state) => ({
        command: state.rollbackCommand,
        params: state.rollbackParams,
        stateId: state.id,
      }));
  }

  /**
   * Mark a state as rolled back
   */
  markRolledBack(rollbackId: string): void {
    const state = this.history.get(rollbackId);

    if (state) {
      state.rolledBack = true;
      state.rolledBackAt = new Date();

      this.logger.info('State rolled back', {
        rollbackId,
        command: state.command,
        target: state.target,
      });
    }
  }

  /**
   * Get the number of available rollback states for a session
   */
  getAvailableRollbackCount(sessionId: string): number {
    return this.getSessionHistory(sessionId).length;
  }

  /**
   * Check if a specific action can be rolled back
   */
  canRollback(rollbackId: string): boolean {
    const state = this.history.get(rollbackId);
    return state !== undefined && !state.rolledBack;
  }

  /**
   * Clear rollback history for a session
   */
  clearSessionHistory(sessionId: string): void {
    const ids = this.sessionHistory.get(sessionId) || [];

    for (const id of ids) {
      this.history.delete(id);
    }

    this.sessionHistory.delete(sessionId);

    this.logger.info('Session rollback history cleared', { sessionId });
  }

  /**
   * Get configuration
   */
  getConfig(): RollbackConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<RollbackConfig>): void {
    this.config = { ...this.config, ...updates };

    // Update cleanup interval if needed
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.config.enableAutoCleanup) {
      this.cleanupInterval = setInterval(
        () => this.cleanupOldHistory(),
        this.config.cleanupIntervalMs
      );
    }

    this.logger.info('Rollback configuration updated');
  }

  /**
   * Shutdown the rollback manager
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.logger.info('Rollback manager shutdown');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private generateRollbackCommand(originalCommand: string): string {
    // Map commands to their rollback equivalents
    const rollbackMap: Record<string, string> = {
      spawn_actor: 'delete_actor',
      create_actor: 'delete_actor',
      delete_actor: 'spawn_actor',
      modify_actor: 'modify_actor',
      move_actor: 'move_actor',
      create_blueprint: 'delete_blueprint',
      delete_blueprint: 'create_blueprint',
      modify_blueprint: 'modify_blueprint',
      create_material: 'delete_material',
      delete_material: 'create_material',
      modify_material: 'modify_material',
      create_level: 'delete_level',
      rename_asset: 'rename_asset',
      move_asset: 'move_asset',
      import_asset: 'delete_asset',
    };

    for (const [pattern, rollbackCmd] of Object.entries(rollbackMap)) {
      if (originalCommand.includes(pattern)) {
        return originalCommand.replace(pattern, rollbackCmd);
      }
    }

    // Default: use modify to restore previous state
    return originalCommand.replace(/create|delete|spawn/, 'modify');
  }

  private generateRollbackParams(
    command: string,
    target: string,
    previousState: Record<string, unknown>
  ): Record<string, unknown> {
    // For delete operations, we need to restore/spawn
    if (command.includes('delete') || command.includes('remove')) {
      return {
        ...previousState,
        actorPath: target,
        target,
      };
    }

    // For create/spawn operations, we need to delete
    if (command.includes('create') || command.includes('spawn')) {
      return {
        actorPath: target,
        target,
        path: target,
      };
    }

    // For modify operations, restore previous state
    if (command.includes('modify') || command.includes('update') || command.includes('set')) {
      return {
        actorPath: target,
        target,
        properties: previousState,
        ...previousState,
      };
    }

    // For move operations, reverse the move
    if (command.includes('move')) {
      return {
        actorPath: target,
        target,
        location: previousState.location,
        rotation: previousState.rotation,
        previousPath: target,
        ...previousState,
      };
    }

    // Default: return previous state
    return {
      target,
      ...previousState,
    };
  }

  private removeOldestEntry(): void {
    let oldestId: string | undefined;
    let oldestTime: Date | undefined;

    for (const [id, state] of this.history) {
      if (!oldestTime || state.timestamp < oldestTime) {
        oldestTime = state.timestamp;
        oldestId = id;
      }
    }

    if (oldestId) {
      const state = this.history.get(oldestId)!;
      this.history.delete(oldestId);

      // Also remove from session history
      const sessionIds = this.sessionHistory.get(state.sessionId);
      if (sessionIds) {
        const index = sessionIds.indexOf(oldestId);
        if (index > -1) {
          sessionIds.splice(index, 1);
        }
      }
    }
  }

  private cleanupOldHistory(): void {
    const cutoff = new Date(Date.now() - this.config.maxHistoryAge);
    let cleanedCount = 0;

    for (const [id, state] of this.history) {
      if (state.timestamp < cutoff) {
        this.history.delete(id);

        // Also remove from session history
        const sessionIds = this.sessionHistory.get(state.sessionId);
        if (sessionIds) {
          const index = sessionIds.indexOf(id);
          if (index > -1) {
            sessionIds.splice(index, 1);
          }
        }

        cleanedCount++;
      }
    }

    // Also clean up old groups
    for (const [id, group] of this.groups) {
      if (group.timestamp < cutoff) {
        this.groups.delete(id);
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug('Cleaned up old rollback history', { count: cleanedCount });
    }
  }
}
