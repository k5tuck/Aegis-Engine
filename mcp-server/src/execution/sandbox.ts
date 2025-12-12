/**
 * AEGIS Security Sandbox
 * Validates actions against security policies and enforces rate limiting
 */

import { Logger } from '../utils/logger.js';
import { SecurityViolationError, RateLimitError } from '../utils/errors.js';
import { createPatternMatcher } from '../utils/helpers.js';

// ============================================================================
// Types
// ============================================================================

export interface SecurityPolicy {
  // Intent filtering
  allowedIntents: string[];
  deniedIntents: string[];

  // Rate limiting
  maxActionsPerMinute: number;
  maxActionsPerHour: number;

  // Approval requirements
  requireApprovalFor: string[];
  autoApproveLevel: 'none' | 'low' | 'medium';

  // Asset path restrictions
  allowedAssetPaths: string[];
  deniedAssetPaths: string[];

  // Destructive operation limits
  maxDeletesPerSession: number;
  requireBackupBeforeDelete: boolean;

  // File system and network
  allowFileSystemAccess: boolean;
  allowNetworkAccess: boolean;
  allowedNetworkHosts: string[];

  // Blueprint restrictions
  allowBlueprintModification: boolean;
  allowBlueprintCreation: boolean;

  // Level restrictions
  protectedLevels: string[];
  allowLevelDeletion: boolean;

  // Session limits
  maxSessionDuration: number; // in milliseconds
  maxTotalActions: number;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  requiresApproval?: boolean;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  riskFactors?: string[];
  warnings?: string[];
}

export interface ActionRecord {
  timestamp: Date;
  action: string;
  target: string;
  approved: boolean;
  sessionId: string;
}

export interface SessionStats {
  totalActions: number;
  deleteCount: number;
  createCount: number;
  modifyCount: number;
  startTime: Date;
  lastActionTime: Date;
}

// ============================================================================
// Default Policy
// ============================================================================

const DEFAULT_POLICY: SecurityPolicy = {
  // Intent filtering
  allowedIntents: ['*'],
  deniedIntents: [
    'delete_project',
    'format_drive',
    'execute_shell',
    'execute_system_command',
    'modify_engine_files',
  ],

  // Rate limiting
  maxActionsPerMinute: 60,
  maxActionsPerHour: 1000,

  // Approval requirements
  requireApprovalFor: [
    'delete_actor',
    'delete_actors',
    'delete_blueprint',
    'delete_asset',
    'clear_level',
    'delete_level',
  ],
  autoApproveLevel: 'low',

  // Asset path restrictions
  allowedAssetPaths: ['/Game/*'],
  deniedAssetPaths: ['/Engine/*', '/Script/*', '/Temp/*'],

  // Destructive operation limits
  maxDeletesPerSession: 100,
  requireBackupBeforeDelete: true,

  // File system and network
  allowFileSystemAccess: false,
  allowNetworkAccess: false,
  allowedNetworkHosts: [],

  // Blueprint restrictions
  allowBlueprintModification: true,
  allowBlueprintCreation: true,

  // Level restrictions
  protectedLevels: [],
  allowLevelDeletion: true,

  // Session limits
  maxSessionDuration: 8 * 60 * 60 * 1000, // 8 hours
  maxTotalActions: 10000,
};

// ============================================================================
// Security Sandbox Implementation
// ============================================================================

export class SecuritySandbox {
  private policy: SecurityPolicy;
  private actionHistory: ActionRecord[] = [];
  private sessionStats: Map<string, SessionStats> = new Map();
  private logger: Logger;

  // Pre-compiled pattern matchers
  private allowedIntentMatchers: ((value: string) => boolean)[];
  private deniedIntentMatchers: ((value: string) => boolean)[];
  private allowedPathMatchers: ((value: string) => boolean)[];
  private deniedPathMatchers: ((value: string) => boolean)[];
  private approvalRequiredMatchers: ((value: string) => boolean)[];

  constructor(policy: Partial<SecurityPolicy> = {}, logger: Logger) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.logger = logger.child({ component: 'SecuritySandbox' });

    // Compile pattern matchers for performance
    this.allowedIntentMatchers = this.policy.allowedIntents.map(createPatternMatcher);
    this.deniedIntentMatchers = this.policy.deniedIntents.map(createPatternMatcher);
    this.allowedPathMatchers = this.policy.allowedAssetPaths.map(createPatternMatcher);
    this.deniedPathMatchers = this.policy.deniedAssetPaths.map(createPatternMatcher);
    this.approvalRequiredMatchers = this.policy.requireApprovalFor.map(createPatternMatcher);

    this.logger.info('Security sandbox initialized', {
      allowedIntents: this.policy.allowedIntents.length,
      deniedIntents: this.policy.deniedIntents.length,
      maxActionsPerMinute: this.policy.maxActionsPerMinute,
    });
  }

  /**
   * Validate an action against security policies
   */
  validateAction(
    intent: string,
    target: string,
    params: Record<string, unknown>,
    sessionId: string
  ): ValidationResult {
    const riskFactors: string[] = [];
    const warnings: string[] = [];

    // 1. Check denied intents (blocklist)
    if (this.isIntentDenied(intent)) {
      this.logger.warn('Action blocked by deny list', { intent, sessionId });
      throw new SecurityViolationError(intent, `Action "${intent}" is not permitted by security policy`);
    }

    // 2. Check allowed intents (allowlist)
    if (!this.isIntentAllowed(intent)) {
      return {
        valid: false,
        reason: `Action "${intent}" is not in the allowed actions list`,
        riskLevel: 'high',
      };
    }

    // 3. Check rate limiting
    this.checkRateLimits(sessionId);

    // 4. Check session limits
    const sessionValidation = this.checkSessionLimits(sessionId);
    if (!sessionValidation.valid) {
      return sessionValidation;
    }

    // 5. Check asset path restrictions
    if (target) {
      const pathValidation = this.validateAssetPath(target);
      if (!pathValidation.valid) {
        return pathValidation;
      }
    }

    // 6. Check delete limits
    if (this.isDeleteOperation(intent)) {
      const stats = this.getSessionStats(sessionId);
      if (stats.deleteCount >= this.policy.maxDeletesPerSession) {
        return {
          valid: false,
          reason: `Delete limit reached (${this.policy.maxDeletesPerSession} per session)`,
          riskLevel: 'high',
        };
      }
      riskFactors.push('Destructive operation');
    }

    // 7. Check blueprint restrictions
    if (this.isBlueprintOperation(intent)) {
      const bpValidation = this.validateBlueprintOperation(intent);
      if (!bpValidation.valid) {
        return bpValidation;
      }
    }

    // 8. Check level restrictions
    if (this.isLevelOperation(intent, target)) {
      const levelValidation = this.validateLevelOperation(intent, target);
      if (!levelValidation.valid) {
        return levelValidation;
      }
    }

    // 9. Check if approval is required
    const requiresApproval = this.requiresApproval(intent);
    if (requiresApproval) {
      riskFactors.push('Requires explicit approval');
    }

    // 10. Assess risk level
    const riskLevel = this.assessRiskLevel(intent, target, params, riskFactors);

    // Add warnings for potentially dangerous operations
    if (this.isBatchOperation(params)) {
      warnings.push('This is a batch operation affecting multiple objects');
    }

    return {
      valid: true,
      requiresApproval,
      riskLevel,
      riskFactors: riskFactors.length > 0 ? riskFactors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Record a completed action
   */
  recordAction(
    action: string,
    target: string,
    approved: boolean,
    sessionId: string
  ): void {
    const record: ActionRecord = {
      timestamp: new Date(),
      action,
      target,
      approved,
      sessionId,
    };

    this.actionHistory.push(record);

    // Update session stats
    let stats = this.sessionStats.get(sessionId);
    if (!stats) {
      stats = {
        totalActions: 0,
        deleteCount: 0,
        createCount: 0,
        modifyCount: 0,
        startTime: new Date(),
        lastActionTime: new Date(),
      };
      this.sessionStats.set(sessionId, stats);
    }

    stats.totalActions++;
    stats.lastActionTime = new Date();

    if (this.isDeleteOperation(action)) {
      stats.deleteCount++;
    } else if (this.isCreateOperation(action)) {
      stats.createCount++;
    } else if (this.isModifyOperation(action)) {
      stats.modifyCount++;
    }

    // Trim old history (keep last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.actionHistory = this.actionHistory.filter((r) => r.timestamp > oneDayAgo);

    this.logger.debug('Action recorded', {
      action,
      sessionId,
      totalActions: stats.totalActions,
    });
  }

  /**
   * Reset session state
   */
  resetSession(sessionId: string): void {
    this.sessionStats.delete(sessionId);
    this.actionHistory = this.actionHistory.filter((r) => r.sessionId !== sessionId);
    this.logger.info('Session reset', { sessionId });
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId: string): SessionStats {
    return (
      this.sessionStats.get(sessionId) || {
        totalActions: 0,
        deleteCount: 0,
        createCount: 0,
        modifyCount: 0,
        startTime: new Date(),
        lastActionTime: new Date(),
      }
    );
  }

  /**
   * Get current policy
   */
  getPolicy(): SecurityPolicy {
    return { ...this.policy };
  }

  /**
   * Update policy
   */
  updatePolicy(updates: Partial<SecurityPolicy>): void {
    this.policy = { ...this.policy, ...updates };

    // Recompile pattern matchers
    this.allowedIntentMatchers = this.policy.allowedIntents.map(createPatternMatcher);
    this.deniedIntentMatchers = this.policy.deniedIntents.map(createPatternMatcher);
    this.allowedPathMatchers = this.policy.allowedAssetPaths.map(createPatternMatcher);
    this.deniedPathMatchers = this.policy.deniedAssetPaths.map(createPatternMatcher);
    this.approvalRequiredMatchers = this.policy.requireApprovalFor.map(createPatternMatcher);

    this.logger.info('Security policy updated');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private isIntentDenied(intent: string): boolean {
    return this.deniedIntentMatchers.some((matcher) => matcher(intent));
  }

  private isIntentAllowed(intent: string): boolean {
    return this.allowedIntentMatchers.some((matcher) => matcher(intent));
  }

  private requiresApproval(intent: string): boolean {
    return this.approvalRequiredMatchers.some((matcher) => matcher(intent));
  }

  private checkRateLimits(sessionId: string): void {
    const now = Date.now();
    const oneMinuteAgo = new Date(now - 60000);
    const oneHourAgo = new Date(now - 3600000);

    const recentActions = this.actionHistory.filter(
      (r) => r.sessionId === sessionId && r.timestamp > oneMinuteAgo
    );
    if (recentActions.length >= this.policy.maxActionsPerMinute) {
      throw new RateLimitError(this.policy.maxActionsPerMinute, 60000);
    }

    const hourlyActions = this.actionHistory.filter(
      (r) => r.sessionId === sessionId && r.timestamp > oneHourAgo
    );
    if (hourlyActions.length >= this.policy.maxActionsPerHour) {
      throw new RateLimitError(this.policy.maxActionsPerHour, 3600000);
    }
  }

  private checkSessionLimits(sessionId: string): ValidationResult {
    const stats = this.getSessionStats(sessionId);

    // Check session duration
    const sessionDuration = Date.now() - stats.startTime.getTime();
    if (sessionDuration > this.policy.maxSessionDuration) {
      return {
        valid: false,
        reason: 'Session duration limit exceeded. Please start a new session.',
        riskLevel: 'medium',
      };
    }

    // Check total actions
    if (stats.totalActions >= this.policy.maxTotalActions) {
      return {
        valid: false,
        reason: `Total actions limit reached (${this.policy.maxTotalActions} per session)`,
        riskLevel: 'medium',
      };
    }

    return { valid: true };
  }

  private validateAssetPath(path: string): ValidationResult {
    // Check denied paths first
    if (this.deniedPathMatchers.some((matcher) => matcher(path))) {
      return {
        valid: false,
        reason: `Asset path "${path}" is restricted`,
        riskLevel: 'high',
      };
    }

    // Check allowed paths
    if (!this.allowedPathMatchers.some((matcher) => matcher(path))) {
      return {
        valid: false,
        reason: `Asset path "${path}" is not in the allowed paths list`,
        riskLevel: 'medium',
      };
    }

    return { valid: true };
  }

  private validateBlueprintOperation(intent: string): ValidationResult {
    if (intent.includes('create_blueprint') && !this.policy.allowBlueprintCreation) {
      return {
        valid: false,
        reason: 'Blueprint creation is not permitted',
        riskLevel: 'medium',
      };
    }

    if (intent.includes('modify_blueprint') && !this.policy.allowBlueprintModification) {
      return {
        valid: false,
        reason: 'Blueprint modification is not permitted',
        riskLevel: 'medium',
      };
    }

    return { valid: true };
  }

  private validateLevelOperation(intent: string, target: string): ValidationResult {
    // Check protected levels
    if (this.policy.protectedLevels.some((level) => target.includes(level))) {
      return {
        valid: false,
        reason: `Level "${target}" is protected and cannot be modified`,
        riskLevel: 'critical',
      };
    }

    // Check level deletion
    if (intent.includes('delete_level') && !this.policy.allowLevelDeletion) {
      return {
        valid: false,
        reason: 'Level deletion is not permitted',
        riskLevel: 'critical',
      };
    }

    return { valid: true };
  }

  private assessRiskLevel(
    intent: string,
    target: string,
    params: Record<string, unknown>,
    riskFactors: string[]
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Critical operations
    if (
      intent.includes('delete_level') ||
      intent.includes('clear_world') ||
      intent.includes('reset_project')
    ) {
      return 'critical';
    }

    // High risk operations
    if (this.isDeleteOperation(intent) || intent.includes('delete_blueprint')) {
      riskFactors.push('Destructive operation');
      return 'high';
    }

    // Medium risk for batch operations
    if (this.isBatchOperation(params)) {
      riskFactors.push('Batch operation');
      return 'medium';
    }

    // Medium risk for blueprint modifications
    if (this.isBlueprintOperation(intent)) {
      return 'medium';
    }

    return 'low';
  }

  private isDeleteOperation(intent: string): boolean {
    return intent.includes('delete') || intent.includes('remove') || intent.includes('clear');
  }

  private isCreateOperation(intent: string): boolean {
    return intent.includes('create') || intent.includes('spawn') || intent.includes('add');
  }

  private isModifyOperation(intent: string): boolean {
    return intent.includes('modify') || intent.includes('update') || intent.includes('set');
  }

  private isBlueprintOperation(intent: string): boolean {
    return intent.includes('blueprint');
  }

  private isLevelOperation(intent: string, target: string): boolean {
    return intent.includes('level') || target.toLowerCase().includes('/maps/');
  }

  private isBatchOperation(params: Record<string, unknown>): boolean {
    // Check for common batch operation indicators
    if (Array.isArray(params.actors) && params.actors.length > 5) return true;
    if (Array.isArray(params.targets) && params.targets.length > 5) return true;
    if (params.recursive === true) return true;
    if (typeof params.count === 'number' && params.count > 10) return true;
    return false;
  }
}
