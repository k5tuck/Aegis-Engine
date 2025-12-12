/**
 * AEGIS Interpretability Module
 * Provides developer-friendly explanations and messages
 */

import { Logger } from '../utils/logger.js';
import { ErrorFeedback } from './error-handler.js';
import { ChangePreview, RiskAssessment } from '../execution/safe-mode.js';

// ============================================================================
// Types
// ============================================================================

export interface InterpretedAction {
  summary: string;
  details: string[];
  humanReadable: string;
  technicalDetails: string;
  warnings: string[];
  suggestions: string[];
}

export interface InterpretedError {
  summary: string;
  explanation: string;
  technicalCause: string;
  userActions: string[];
  developerNotes?: string;
}

export interface InterpretedPreview {
  title: string;
  summary: string;
  changeDescriptions: string[];
  riskExplanation: string;
  approvalGuidance: string;
  rollbackInfo: string;
}

export interface InterpretedResult {
  successMessage: string;
  changesApplied: string[];
  nextSteps: string[];
  relatedCommands: string[];
}

export interface ExplanationContext {
  userExpertise?: 'beginner' | 'intermediate' | 'expert';
  includeCodeReferences?: boolean;
  includeDocLinks?: boolean;
  verbose?: boolean;
}

// ============================================================================
// Command Explanations
// ============================================================================

const COMMAND_EXPLANATIONS: Record<string, { action: string; description: string }> = {
  spawn_actor: {
    action: 'Create a new actor',
    description: 'Places a new actor instance in the level at the specified location',
  },
  modify_actor: {
    action: 'Modify an actor',
    description: 'Changes properties or transform of an existing actor',
  },
  delete_actor: {
    action: 'Delete an actor',
    description: 'Removes an actor from the level permanently',
  },
  query_actors: {
    action: 'Search for actors',
    description: 'Finds actors in the level matching the specified criteria',
  },
  create_blueprint: {
    action: 'Create a Blueprint',
    description: 'Creates a new Blueprint asset with the specified configuration',
  },
  modify_blueprint: {
    action: 'Modify a Blueprint',
    description: 'Updates components, variables, or settings of an existing Blueprint',
  },
  compile_blueprint: {
    action: 'Compile a Blueprint',
    description: 'Validates and compiles the Blueprint to check for errors',
  },
  create_material: {
    action: 'Create a Material',
    description: 'Creates a new Material or Material Instance asset',
  },
  modify_material: {
    action: 'Modify a Material',
    description: 'Updates parameters or settings of an existing Material',
  },
  open_level: {
    action: 'Open a level',
    description: 'Loads the specified level into the editor',
  },
  save_level: {
    action: 'Save the level',
    description: 'Saves the current level and all its changes',
  },
};

// ============================================================================
// Interpretability Service
// ============================================================================

export class InterpretabilityService {
  private logger: Logger;
  private defaultContext: ExplanationContext;

  constructor(logger: Logger, defaultContext?: ExplanationContext) {
    this.logger = logger.child({ component: 'Interpretability' });
    this.defaultContext = {
      userExpertise: 'intermediate',
      includeCodeReferences: true,
      includeDocLinks: true,
      verbose: false,
      ...defaultContext,
    };
  }

  /**
   * Interpret an action before execution
   */
  interpretAction(
    command: string,
    params: Record<string, unknown>,
    context?: ExplanationContext
  ): InterpretedAction {
    const ctx = { ...this.defaultContext, ...context };
    const commandInfo = this.getCommandInfo(command);

    const summary = `${commandInfo.action}: ${this.getTargetDescription(params)}`;
    const details = this.generateActionDetails(command, params, ctx);
    const humanReadable = this.generateHumanReadableDescription(command, params, ctx);
    const technicalDetails = this.generateTechnicalDetails(command, params);
    const warnings = this.generateActionWarnings(command, params);
    const suggestions = this.generateActionSuggestions(command, params);

    return {
      summary,
      details,
      humanReadable,
      technicalDetails,
      warnings,
      suggestions,
    };
  }

  /**
   * Interpret an error for the user
   */
  interpretError(
    error: ErrorFeedback,
    context?: ExplanationContext
  ): InterpretedError {
    const ctx = { ...this.defaultContext, ...context };

    const summary = this.generateErrorSummary(error, ctx);
    const explanation = this.generateErrorExplanation(error, ctx);
    const technicalCause = this.generateTechnicalCause(error);
    const userActions = this.generateUserActions(error, ctx);
    const developerNotes = ctx.userExpertise === 'expert'
      ? this.generateDeveloperNotes(error)
      : undefined;

    return {
      summary,
      explanation,
      technicalCause,
      userActions,
      developerNotes,
    };
  }

  /**
   * Interpret a preview for approval decision
   */
  interpretPreview(
    command: string,
    changes: ChangePreview[],
    riskAssessment: RiskAssessment,
    context?: ExplanationContext
  ): InterpretedPreview {
    const ctx = { ...this.defaultContext, ...context };
    const commandInfo = this.getCommandInfo(command);

    const title = `Preview: ${commandInfo.action}`;
    const summary = this.generatePreviewSummary(changes, riskAssessment);
    const changeDescriptions = this.generateChangeDescriptions(changes, ctx);
    const riskExplanation = this.generateRiskExplanation(riskAssessment, ctx);
    const approvalGuidance = this.generateApprovalGuidance(riskAssessment, ctx);
    const rollbackInfo = this.generateRollbackInfo(riskAssessment);

    return {
      title,
      summary,
      changeDescriptions,
      riskExplanation,
      approvalGuidance,
      rollbackInfo,
    };
  }

  /**
   * Interpret a successful result
   */
  interpretResult(
    command: string,
    result: Record<string, unknown>,
    context?: ExplanationContext
  ): InterpretedResult {
    const ctx = { ...this.defaultContext, ...context };
    const commandInfo = this.getCommandInfo(command);

    const successMessage = `${commandInfo.action} completed successfully`;
    const changesApplied = this.generateChangesApplied(command, result);
    const nextSteps = this.generateNextSteps(command, result, ctx);
    const relatedCommands = this.generateRelatedCommands(command);

    return {
      successMessage,
      changesApplied,
      nextSteps,
      relatedCommands,
    };
  }

  /**
   * Format a message for display
   */
  formatMessage(
    type: 'info' | 'success' | 'warning' | 'error',
    message: string,
    details?: string[]
  ): string {
    const prefix = {
      info: '[INFO]',
      success: '[SUCCESS]',
      warning: '[WARNING]',
      error: '[ERROR]',
    }[type];

    let formatted = `${prefix} ${message}`;

    if (details && details.length > 0) {
      formatted += '\n' + details.map((d) => `  - ${d}`).join('\n');
    }

    return formatted;
  }

  /**
   * Generate a progress message
   */
  generateProgressMessage(step: number, total: number, description: string): string {
    const percentage = Math.round((step / total) * 100);
    return `[${step}/${total}] ${percentage}% - ${description}`;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getCommandInfo(command: string): { action: string; description: string } {
    // Extract the action part from the command name
    const parts = command.split('.');
    const actionPart = parts[parts.length - 1];

    return (
      COMMAND_EXPLANATIONS[actionPart] || {
        action: this.formatCommandName(actionPart),
        description: `Execute ${command}`,
      }
    );
  }

  private formatCommandName(name: string): string {
    return name
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .replace(/^\w/, (c) => c.toUpperCase());
  }

  private getTargetDescription(params: Record<string, unknown>): string {
    if (params.actorPath) return `actor "${params.actorPath}"`;
    if (params.blueprintPath) return `blueprint "${params.blueprintPath}"`;
    if (params.assetPath) return `asset "${params.assetPath}"`;
    if (params.materialPath) return `material "${params.materialPath}"`;
    if (params.levelPath) return `level "${params.levelPath}"`;
    if (params.actorClass) return `${params.actorClass}`;
    if (params.name) return `"${params.name}"`;
    return 'target';
  }

  private generateActionDetails(
    command: string,
    params: Record<string, unknown>,
    _ctx: ExplanationContext
  ): string[] {
    const details: string[] = [];

    if (params.transform) {
      const transform = params.transform as Record<string, unknown>;
      if (transform.location) {
        const loc = transform.location as Record<string, number>;
        details.push(`Location: (${loc.x}, ${loc.y}, ${loc.z})`);
      }
      if (transform.rotation) {
        const rot = transform.rotation as Record<string, number>;
        details.push(`Rotation: (${rot.pitch}, ${rot.yaw}, ${rot.roll})`);
      }
    }

    if (params.properties) {
      const props = Object.keys(params.properties as object);
      details.push(`Properties: ${props.join(', ')}`);
    }

    if (params.components) {
      const components = params.components as unknown[];
      details.push(`Components: ${components.length} component(s)`);
    }

    return details;
  }

  private generateHumanReadableDescription(
    command: string,
    params: Record<string, unknown>,
    _ctx: ExplanationContext
  ): string {
    const commandInfo = this.getCommandInfo(command);
    const target = this.getTargetDescription(params);

    if (command.includes('spawn') || command.includes('create')) {
      return `This will create a new ${target} in the level.`;
    }
    if (command.includes('delete') || command.includes('remove')) {
      return `This will permanently remove ${target} from the level.`;
    }
    if (command.includes('modify') || command.includes('update')) {
      return `This will update the properties of ${target}.`;
    }
    if (command.includes('query') || command.includes('get')) {
      return `This will search for and return information about ${target}.`;
    }

    return `${commandInfo.description} for ${target}.`;
  }

  private generateTechnicalDetails(
    command: string,
    params: Record<string, unknown>
  ): string {
    return `Command: ${command}\nParameters: ${JSON.stringify(params, null, 2)}`;
  }

  private generateActionWarnings(
    command: string,
    params: Record<string, unknown>
  ): string[] {
    const warnings: string[] = [];

    if (command.includes('delete')) {
      warnings.push('This action cannot be undone without rollback.');
    }

    if (params.recursive === true) {
      warnings.push('This is a recursive operation and will affect child objects.');
    }

    if (params.force === true) {
      warnings.push('Force flag is enabled - validation checks will be bypassed.');
    }

    return warnings;
  }

  private generateActionSuggestions(
    command: string,
    _params: Record<string, unknown>
  ): string[] {
    const suggestions: string[] = [];

    if (command.includes('spawn') || command.includes('create')) {
      suggestions.push('Consider querying existing objects first to avoid duplicates.');
    }

    if (command.includes('blueprint')) {
      suggestions.push('Remember to compile the Blueprint after modifications.');
    }

    return suggestions;
  }

  private generateErrorSummary(error: ErrorFeedback, _ctx: ExplanationContext): string {
    return error.message;
  }

  private generateErrorExplanation(error: ErrorFeedback, ctx: ExplanationContext): string {
    const explanations: Record<string, string> = {
      ACTOR_NOT_FOUND: 'The actor you specified does not exist in the current level. This could mean the path is incorrect or the actor was deleted.',
      COMMAND_VALIDATION_FAILED: 'The parameters provided do not match what the command expects. Check that all required fields are provided with the correct types.',
      UE_CONNECTION_FAILED: 'Unable to connect to Unreal Engine. Make sure the editor is running and the Remote Control API plugin is enabled.',
      SECURITY_VIOLATION: 'This action is blocked by the security policy configured for AEGIS.',
      RATE_LIMIT_EXCEEDED: 'You are sending commands too quickly. Please wait before sending more.',
    };

    let explanation = explanations[error.code] || error.suggestion;

    if (ctx.verbose) {
      explanation += `\n\nError Code: ${error.code}\nCategory: ${error.category}\nSeverity: ${error.severity}`;
    }

    return explanation;
  }

  private generateTechnicalCause(error: ErrorFeedback): string {
    return `[${error.code}] ${JSON.stringify(error.context)}`;
  }

  private generateUserActions(error: ErrorFeedback, _ctx: ExplanationContext): string[] {
    const actions: string[] = [];

    for (const action of error.recoveryActions) {
      actions.push(action.description);
    }

    if (actions.length === 0) {
      actions.push('Review the error details and try again.');
    }

    return actions;
  }

  private generateDeveloperNotes(error: ErrorFeedback): string {
    return `Stack trace and context available in logs. Error context: ${JSON.stringify(error.context)}`;
  }

  private generatePreviewSummary(changes: ChangePreview[], risk: RiskAssessment): string {
    const creates = changes.filter((c) => c.type === 'create').length;
    const modifies = changes.filter((c) => c.type === 'modify').length;
    const deletes = changes.filter((c) => c.type === 'delete').length;

    let summary = `This action will affect ${changes.length} object(s)`;
    if (creates > 0) summary += `, creating ${creates}`;
    if (modifies > 0) summary += `, modifying ${modifies}`;
    if (deletes > 0) summary += `, deleting ${deletes}`;
    summary += `. Risk level: ${risk.level.toUpperCase()}.`;

    return summary;
  }

  private generateChangeDescriptions(changes: ChangePreview[], _ctx: ExplanationContext): string[] {
    return changes.map((change) => {
      const prefix = {
        create: '[+]',
        modify: '[~]',
        delete: '[-]',
        move: '[>]',
      }[change.type];

      return `${prefix} ${change.description}`;
    });
  }

  private generateRiskExplanation(risk: RiskAssessment, _ctx: ExplanationContext): string {
    const levelDescriptions = {
      low: 'This is a safe operation with minimal risk.',
      medium: 'This operation has moderate risk. Review the changes before approving.',
      high: 'This is a high-risk operation. Carefully review all changes.',
      critical: 'CRITICAL: This operation may cause significant changes that are difficult to reverse.',
    };

    let explanation = levelDescriptions[risk.level];

    if (risk.factors.length > 0) {
      explanation += '\n\nRisk factors:\n' + risk.factors.map((f) => `- ${f}`).join('\n');
    }

    return explanation;
  }

  private generateApprovalGuidance(risk: RiskAssessment, _ctx: ExplanationContext): string {
    if (risk.level === 'critical') {
      return 'Consider creating a backup before approving. This action should be reviewed by a senior developer.';
    }
    if (risk.level === 'high') {
      return 'Review the changes carefully. Consider the impact on dependent assets.';
    }
    if (risk.level === 'medium') {
      return 'Review the changes and approve if they match your intent.';
    }
    return 'This action appears safe. Approve to proceed.';
  }

  private generateRollbackInfo(risk: RiskAssessment): string {
    if (risk.rollbackPossible) {
      return 'Rollback is available if needed. Use the rollback command to undo changes.';
    }
    return 'Note: This action may not be fully reversible.';
  }

  private generateChangesApplied(command: string, result: Record<string, unknown>): string[] {
    const changes: string[] = [];

    if (result.actor) {
      const actor = result.actor as Record<string, unknown>;
      changes.push(`Actor created/modified: ${actor.path || actor.label}`);
    }

    if (result.blueprint) {
      const bp = result.blueprint as Record<string, unknown>;
      changes.push(`Blueprint: ${bp.path}`);
    }

    if (result.deletedPath) {
      changes.push(`Deleted: ${result.deletedPath}`);
    }

    if (changes.length === 0) {
      changes.push(`${this.formatCommandName(command.split('.').pop() || command)} completed`);
    }

    return changes;
  }

  private generateNextSteps(
    command: string,
    _result: Record<string, unknown>,
    _ctx: ExplanationContext
  ): string[] {
    const steps: string[] = [];

    if (command.includes('spawn') || command.includes('create')) {
      steps.push('Use modify commands to adjust properties if needed');
      steps.push('Save the level to persist changes');
    }

    if (command.includes('blueprint')) {
      steps.push('Compile the Blueprint to check for errors');
      steps.push('Test the Blueprint in Play mode');
    }

    return steps;
  }

  private generateRelatedCommands(command: string): string[] {
    const related: string[] = [];

    if (command.includes('spawn') || command.includes('actor')) {
      related.push('aegis.core.query_actors', 'aegis.core.modify_actor', 'aegis.core.delete_actor');
    }

    if (command.includes('blueprint')) {
      related.push('aegis.core.compile_blueprint', 'aegis.core.query_assets');
    }

    return related.filter((r) => r !== command);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createInterpretabilityService(
  logger: Logger,
  defaultContext?: ExplanationContext
): InterpretabilityService {
  return new InterpretabilityService(logger, defaultContext);
}
