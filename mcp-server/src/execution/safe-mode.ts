/**
 * AEGIS Safe Mode Manager
 * Preview-before-execution pipeline for action approval
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/logger.js';
import { PreviewExpiredError } from '../utils/errors.js';

// ============================================================================
// Types
// ============================================================================

export interface ChangePreview {
  type: 'create' | 'modify' | 'delete' | 'move';
  target: string;
  description: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  affectedDependencies?: string[];
}

export interface RiskAssessment {
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  reversible: boolean;
  estimatedImpact: string;
  rollbackPossible: boolean;
  affectedObjects: number;
}

export interface ActionPreview {
  id: string;
  command: string;
  params: Record<string, unknown>;
  timestamp: Date;
  expiresAt: Date;
  changes: ChangePreview[];
  riskAssessment: RiskAssessment;
  approved: boolean;
  rejected: boolean;
  executed: boolean;
  executedAt?: Date;
  result?: Record<string, unknown>;
  error?: string;
  sessionId: string;
  userId?: string;
}

export interface SafeModeConfig {
  enabled: boolean;
  previewExpirationMs: number;
  autoApproveLevel: 'none' | 'low' | 'medium';
  requireExplicitApproval: string[];
  maxPendingPreviews: number;
  cleanupIntervalMs: number;
}

export interface ApprovalRequest {
  previewId: string;
  approvedBy?: string;
  approvalNote?: string;
  modifiedParams?: Record<string, unknown>;
}

export interface RejectionRequest {
  previewId: string;
  rejectedBy?: string;
  rejectionReason?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SafeModeConfig = {
  enabled: true,
  previewExpirationMs: 300000, // 5 minutes
  autoApproveLevel: 'low',
  requireExplicitApproval: [
    'delete_actor',
    'delete_actors',
    'delete_blueprint',
    'delete_asset',
    'clear_level',
    'delete_level',
  ],
  maxPendingPreviews: 100,
  cleanupIntervalMs: 60000, // 1 minute
};

// ============================================================================
// Safe Mode Manager Implementation
// ============================================================================

export class SafeModeManager {
  private previews: Map<string, ActionPreview> = new Map();
  private config: SafeModeConfig;
  private logger: Logger;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<SafeModeConfig> = {}, logger: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger.child({ component: 'SafeModeManager' });

    // Start cleanup interval
    if (this.config.enabled) {
      this.cleanupInterval = setInterval(
        () => this.cleanupExpiredPreviews(),
        this.config.cleanupIntervalMs
      );
    }

    this.logger.info('Safe mode manager initialized', {
      enabled: this.config.enabled,
      expirationMs: this.config.previewExpirationMs,
      autoApproveLevel: this.config.autoApproveLevel,
    });
  }

  /**
   * Create a preview for an action
   */
  async createPreview(
    command: string,
    params: Record<string, unknown>,
    analyzeChanges: () => Promise<ChangePreview[]>,
    sessionId: string,
    userId?: string
  ): Promise<ActionPreview> {
    // Enforce max pending previews
    if (this.previews.size >= this.config.maxPendingPreviews) {
      this.cleanupExpiredPreviews();
      if (this.previews.size >= this.config.maxPendingPreviews) {
        throw new Error('Maximum pending previews limit reached');
      }
    }

    const id = uuidv4();
    const now = new Date();
    const changes = await analyzeChanges();

    const preview: ActionPreview = {
      id,
      command,
      params,
      timestamp: now,
      expiresAt: new Date(now.getTime() + this.config.previewExpirationMs),
      changes,
      riskAssessment: this.assessRisk(command, changes),
      approved: false,
      rejected: false,
      executed: false,
      sessionId,
      userId,
    };

    // Auto-approve if risk level allows
    if (this.shouldAutoApprove(preview)) {
      preview.approved = true;
      this.logger.info('Preview auto-approved', {
        previewId: id,
        command,
        riskLevel: preview.riskAssessment.level,
      });
    }

    this.previews.set(id, preview);

    this.logger.info('Preview created', {
      previewId: id,
      command,
      changesCount: changes.length,
      riskLevel: preview.riskAssessment.level,
      autoApproved: preview.approved,
    });

    return preview;
  }

  /**
   * Approve a preview for execution
   */
  approvePreview(request: ApprovalRequest): ActionPreview {
    const preview = this.previews.get(request.previewId);

    if (!preview) {
      throw new PreviewExpiredError(request.previewId);
    }

    if (new Date() > preview.expiresAt) {
      this.previews.delete(request.previewId);
      throw new PreviewExpiredError(request.previewId);
    }

    if (preview.rejected) {
      throw new Error('Cannot approve a rejected preview');
    }

    if (preview.executed) {
      throw new Error('Preview has already been executed');
    }

    // Apply any parameter modifications
    if (request.modifiedParams) {
      preview.params = { ...preview.params, ...request.modifiedParams };
    }

    preview.approved = true;

    this.logger.info('Preview approved', {
      previewId: request.previewId,
      approvedBy: request.approvedBy,
      note: request.approvalNote,
    });

    return preview;
  }

  /**
   * Reject a preview
   */
  rejectPreview(request: RejectionRequest): void {
    const preview = this.previews.get(request.previewId);

    if (!preview) {
      throw new PreviewExpiredError(request.previewId);
    }

    preview.rejected = true;

    this.logger.info('Preview rejected', {
      previewId: request.previewId,
      rejectedBy: request.rejectedBy,
      reason: request.rejectionReason,
    });

    // Optionally remove immediately or keep for audit
    // this.previews.delete(request.previewId);
  }

  /**
   * Mark a preview as executed
   */
  markExecuted(previewId: string, result?: Record<string, unknown>, error?: string): void {
    const preview = this.previews.get(previewId);

    if (preview) {
      preview.executed = true;
      preview.executedAt = new Date();
      preview.result = result;
      preview.error = error;

      this.logger.info('Preview executed', {
        previewId,
        success: !error,
        error,
      });
    }
  }

  /**
   * Get a preview by ID
   */
  getPreview(previewId: string): ActionPreview | undefined {
    const preview = this.previews.get(previewId);

    if (preview && new Date() > preview.expiresAt && !preview.executed) {
      this.previews.delete(previewId);
      return undefined;
    }

    return preview;
  }

  /**
   * Get all pending previews for a session
   */
  getPendingPreviews(sessionId: string): ActionPreview[] {
    const now = new Date();
    const pending: ActionPreview[] = [];

    for (const preview of this.previews.values()) {
      if (
        preview.sessionId === sessionId &&
        !preview.executed &&
        !preview.rejected &&
        preview.expiresAt > now
      ) {
        pending.push(preview);
      }
    }

    return pending.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get execution history for a session
   */
  getExecutionHistory(sessionId: string, limit: number = 50): ActionPreview[] {
    const history: ActionPreview[] = [];

    for (const preview of this.previews.values()) {
      if (preview.sessionId === sessionId && preview.executed) {
        history.push(preview);
      }
    }

    return history
      .sort((a, b) => (b.executedAt?.getTime() || 0) - (a.executedAt?.getTime() || 0))
      .slice(0, limit);
  }

  /**
   * Check if safe mode is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable or disable safe mode
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;

    if (enabled && !this.cleanupInterval) {
      this.cleanupInterval = setInterval(
        () => this.cleanupExpiredPreviews(),
        this.config.cleanupIntervalMs
      );
    } else if (!enabled && this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.logger.info('Safe mode status changed', { enabled });
  }

  /**
   * Get configuration
   */
  getConfig(): SafeModeConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<SafeModeConfig>): void {
    this.config = { ...this.config, ...updates };
    this.logger.info('Safe mode configuration updated');
  }

  /**
   * Shutdown the safe mode manager
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.logger.info('Safe mode manager shutdown');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private assessRisk(command: string, changes: ChangePreview[]): RiskAssessment {
    const factors: string[] = [];
    let level: RiskAssessment['level'] = 'low';
    let reversible = true;
    let rollbackPossible = true;

    // Count changes by type
    const deleteCount = changes.filter((c) => c.type === 'delete').length;
    const createCount = changes.filter((c) => c.type === 'create').length;
    const modifyCount = changes.filter((c) => c.type === 'modify').length;
    const moveCount = changes.filter((c) => c.type === 'move').length;
    const totalAffected = changes.length;

    // Assess deletions
    if (deleteCount > 0) {
      factors.push(`Deletes ${deleteCount} object(s)`);
      if (deleteCount > 10) {
        level = 'high';
        factors.push('Large-scale deletion');
      } else if (deleteCount > 5) {
        level = level === 'low' ? 'medium' : level;
      }
    }

    // Assess critical commands
    const criticalCommands = ['delete_level', 'clear_world', 'reset_project', 'clear_level'];
    if (criticalCommands.some((c) => command.includes(c))) {
      factors.push('Critical operation');
      level = 'critical';
      reversible = false;
      rollbackPossible = false;
    }

    // Assess blueprint changes
    if (command.includes('blueprint') && command.includes('delete')) {
      factors.push('Blueprint deletion');
      level = level === 'low' ? 'medium' : level;
    }

    // Assess batch operations
    if (totalAffected > 20) {
      factors.push(`Affects ${totalAffected} objects`);
      level = level === 'low' ? 'medium' : level;
    }

    // Check for dependency impacts
    const hasDependencyImpacts = changes.some(
      (c) => c.affectedDependencies && c.affectedDependencies.length > 0
    );
    if (hasDependencyImpacts) {
      factors.push('May affect dependent assets');
    }

    return {
      level,
      factors,
      reversible,
      rollbackPossible,
      estimatedImpact: this.describeImpact(createCount, modifyCount, deleteCount, moveCount),
      affectedObjects: totalAffected,
    };
  }

  private describeImpact(
    creates: number,
    modifies: number,
    deletes: number,
    moves: number
  ): string {
    const parts: string[] = [];

    if (creates > 0) parts.push(`create ${creates} object(s)`);
    if (modifies > 0) parts.push(`modify ${modifies} object(s)`);
    if (deletes > 0) parts.push(`delete ${deletes} object(s)`);
    if (moves > 0) parts.push(`move ${moves} object(s)`);

    return parts.length > 0 ? `Will ${parts.join(', ')}` : 'No changes detected';
  }

  private shouldAutoApprove(preview: ActionPreview): boolean {
    // Never auto-approve in 'none' mode
    if (this.config.autoApproveLevel === 'none') {
      return false;
    }

    // Check if explicit approval is required
    if (this.config.requireExplicitApproval.some((cmd) => preview.command.includes(cmd))) {
      return false;
    }

    // Compare risk level against auto-approve threshold
    const levelOrder = ['low', 'medium', 'high', 'critical'];
    const riskIndex = levelOrder.indexOf(preview.riskAssessment.level);
    const thresholdIndex = levelOrder.indexOf(this.config.autoApproveLevel);

    return riskIndex <= thresholdIndex;
  }

  private cleanupExpiredPreviews(): void {
    const now = new Date();
    let cleanedCount = 0;

    for (const [id, preview] of this.previews) {
      // Remove expired non-executed previews
      if (now > preview.expiresAt && !preview.executed) {
        this.previews.delete(id);
        cleanedCount++;
        continue;
      }

      // Remove old executed previews (keep for 1 hour)
      if (
        preview.executed &&
        preview.executedAt &&
        now.getTime() - preview.executedAt.getTime() > 3600000
      ) {
        this.previews.delete(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug('Cleaned up expired previews', { count: cleanedCount });
    }
  }
}
