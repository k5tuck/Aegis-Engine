/**
 * AEGIS Agent Coordinator
 * Orchestrates the Researcher → Mentor → Builder workflow
 */

import { v4 as uuidv4 } from 'uuid';
import {
  AgentRole,
  AgentConfig,
  DefaultAgentConfigs,
  AgentWorkflow,
  WorkflowStep,
  ResearcherResponse,
  MentorResponse,
  BuilderResponse,
  ResearcherPrompt,
  MentorPrompt,
  BuilderPrompt,
} from './agent-roles.js';
import { ModelAdapterFactory } from '../adapters/index.js';
import { ContextProvider } from '../feedback/context-provider.js';
import { CommandExecutor } from '../execution/executor.js';
import { Logger } from '../utils/logger.js';

// ============================================================================
// Coordinator Configuration
// ============================================================================

export interface CoordinatorConfig {
  maxIterations: number;
  requireMentorApproval: boolean;
  autoExecute: boolean;
  modelFactory: ModelAdapterFactory;
  contextProvider: ContextProvider;
  executor: CommandExecutor;
  logger: Logger;
  agentConfigs?: Partial<Record<AgentRole, Partial<AgentConfig>>>;
}

// ============================================================================
// Agent Coordinator Class
// ============================================================================

export class AgentCoordinator {
  private config: CoordinatorConfig;
  private workflows = new Map<string, AgentWorkflow>();
  private agentConfigs: Record<AgentRole, AgentConfig>;

  constructor(config: CoordinatorConfig) {
    this.config = config;

    // Merge default configs with overrides
    this.agentConfigs = { ...DefaultAgentConfigs };
    if (config.agentConfigs) {
      for (const [role, overrides] of Object.entries(config.agentConfigs)) {
        this.agentConfigs[role as AgentRole] = {
          ...this.agentConfigs[role as AgentRole],
          ...overrides,
        };
      }
    }
  }

  // ============================================================================
  // Main Workflow Entry Point
  // ============================================================================

  /**
   * Process a task through the three-tier AI system
   */
  async processTask(task: string, options?: {
    skipResearch?: boolean;
    skipMentor?: boolean;
    context?: Record<string, any>;
  }): Promise<AgentWorkflow> {
    const workflowId = uuidv4();

    const workflow: AgentWorkflow = {
      id: workflowId,
      task,
      status: 'pending',
      iterations: 0,
      maxIterations: this.config.maxIterations,
      history: [],
    };

    this.workflows.set(workflowId, workflow);

    this.config.logger.info('Starting agent workflow', {
      workflowId,
      task: task.substring(0, 100),
    });

    try {
      // Phase 1: Research
      if (!options?.skipResearch && this.agentConfigs[AgentRole.RESEARCHER].enabled) {
        workflow.status = 'researching';
        workflow.research = await this.runResearchPhase(workflow, options?.context);
      }

      // Phase 2: Mentor Review (with iteration loop)
      let mentorApproved = options?.skipMentor || !this.config.requireMentorApproval;

      while (!mentorApproved && workflow.iterations < workflow.maxIterations) {
        workflow.status = 'mentoring';
        workflow.mentorReview = await this.runMentorPhase(workflow);

        if (workflow.mentorReview.decision === 'approved') {
          mentorApproved = true;
        } else if (workflow.mentorReview.decision === 'reject') {
          workflow.status = 'failed';
          return workflow;
        } else {
          // Revise - run research again with feedback
          workflow.iterations++;
          if (workflow.iterations < workflow.maxIterations) {
            workflow.research = await this.runResearchPhase(workflow, {
              ...options?.context,
              mentorFeedback: workflow.mentorReview.feedback,
            });
          }
        }
      }

      // Phase 3: Build
      if (this.agentConfigs[AgentRole.BUILDER].enabled) {
        workflow.status = 'building';
        workflow.implementation = await this.runBuildPhase(workflow);

        // Execute commands if auto-execute is enabled
        if (this.config.autoExecute && workflow.implementation.status === 'complete') {
          await this.executeCommands(workflow);
        }
      }

      workflow.status = 'complete';

    } catch (error) {
      workflow.status = 'failed';
      this.config.logger.error('Workflow failed', { workflowId, error });
      throw error;
    }

    return workflow;
  }

  // ============================================================================
  // Phase Implementations
  // ============================================================================

  /**
   * Run the Researcher phase
   */
  private async runResearchPhase(
    workflow: AgentWorkflow,
    additionalContext?: Record<string, any>
  ): Promise<ResearcherResponse> {
    const startTime = Date.now();

    // Gather context from UE
    const editorContext = await this.config.contextProvider.getCurrentContext();
    const projectInfo = await this.config.contextProvider.getProjectInfo();

    // Build prompt for researcher
    const prompt = this.buildResearcherPrompt(workflow.task, {
      editorContext,
      projectInfo,
      ...additionalContext,
    });

    // Get model adapter
    const adapter = this.config.modelFactory.getAdapter(
      this.agentConfigs[AgentRole.RESEARCHER].model
    );

    // Run research query
    const response = await adapter.complete({
      systemPrompt: ResearcherPrompt,
      messages: [{ role: 'user', content: prompt }],
      temperature: this.agentConfigs[AgentRole.RESEARCHER].temperature,
    });

    // Parse response
    const researchResult = this.parseResearcherResponse(response.content);

    // Record in history
    workflow.history.push({
      timestamp: new Date(),
      agent: AgentRole.RESEARCHER,
      action: 'research',
      input: prompt,
      output: response.content,
      duration: Date.now() - startTime,
    });

    this.config.logger.info('Research phase complete', {
      workflowId: workflow.id,
      recommendationCount: researchResult.recommendations.length,
    });

    return researchResult;
  }

  /**
   * Run the Mentor phase
   */
  private async runMentorPhase(workflow: AgentWorkflow): Promise<MentorResponse> {
    const startTime = Date.now();

    // Build prompt with research results
    const prompt = this.buildMentorPrompt(workflow);

    // Get model adapter
    const adapter = this.config.modelFactory.getAdapter(
      this.agentConfigs[AgentRole.MENTOR].model
    );

    // Run mentor review
    const response = await adapter.complete({
      systemPrompt: MentorPrompt,
      messages: [{ role: 'user', content: prompt }],
      temperature: this.agentConfigs[AgentRole.MENTOR].temperature,
    });

    // Parse response
    const mentorResult = this.parseMentorResponse(response.content);

    // Record in history
    workflow.history.push({
      timestamp: new Date(),
      agent: AgentRole.MENTOR,
      action: 'review',
      input: prompt,
      output: response.content,
      duration: Date.now() - startTime,
    });

    this.config.logger.info('Mentor phase complete', {
      workflowId: workflow.id,
      decision: mentorResult.decision,
      iteration: workflow.iterations,
    });

    return mentorResult;
  }

  /**
   * Run the Builder phase
   */
  private async runBuildPhase(workflow: AgentWorkflow): Promise<BuilderResponse> {
    const startTime = Date.now();

    // Build prompt with approved plan
    const prompt = this.buildBuilderPrompt(workflow);

    // Get model adapter
    const adapter = this.config.modelFactory.getAdapter(
      this.agentConfigs[AgentRole.BUILDER].model
    );

    // Run builder
    const response = await adapter.complete({
      systemPrompt: BuilderPrompt,
      messages: [{ role: 'user', content: prompt }],
      temperature: this.agentConfigs[AgentRole.BUILDER].temperature,
    });

    // Parse response
    const builderResult = this.parseBuilderResponse(response.content);

    // Record in history
    workflow.history.push({
      timestamp: new Date(),
      agent: AgentRole.BUILDER,
      action: 'build',
      input: prompt,
      output: response.content,
      duration: Date.now() - startTime,
    });

    this.config.logger.info('Builder phase complete', {
      workflowId: workflow.id,
      commandCount: builderResult.commands.length,
      status: builderResult.status,
    });

    return builderResult;
  }

  // ============================================================================
  // Prompt Building
  // ============================================================================

  private buildResearcherPrompt(task: string, context: Record<string, any>): string {
    return `
# Task
${task}

# Current Project Context
${JSON.stringify(context.projectInfo || {}, null, 2)}

# Editor State
${JSON.stringify(context.editorContext || {}, null, 2)}

${context.mentorFeedback ? `
# Previous Mentor Feedback (Iteration ${context.iteration || 1})
${context.mentorFeedback}
` : ''}

Please analyze this task and provide:
1. Context analysis of the current project state
2. Best practices for implementing this feature
3. Existing patterns that can be leveraged
4. Considerations for performance, scalability, and maintainability
5. Prioritized recommendations with rationale
`;
  }

  private buildMentorPrompt(workflow: AgentWorkflow): string {
    return `
# Original Task
${workflow.task}

# Researcher's Analysis
${JSON.stringify(workflow.research, null, 2)}

# Iteration
This is iteration ${workflow.iterations + 1} of ${workflow.maxIterations}

Please review this plan and provide:
1. Assumption review - are there any invalid assumptions?
2. Architecture feedback - strengths and weaknesses
3. Alternative approaches if applicable
4. Risk assessment
5. Your decision: APPROVED, REVISE, or REJECT with specific feedback
`;
  }

  private buildBuilderPrompt(workflow: AgentWorkflow): string {
    return `
# Original Task
${workflow.task}

# Approved Research/Plan
${JSON.stringify(workflow.research, null, 2)}

# Mentor Approval
${JSON.stringify(workflow.mentorReview, null, 2)}

Please implement this feature:
1. Provide step-by-step implementation plan
2. Generate the AEGIS commands to execute
3. Note any integration considerations
4. Report testing/validation results
5. Indicate completion status

Use AEGIS commands in this format:
\`\`\`aegis
{
  "command": "aegis.core.spawn_actor",
  "params": { ... }
}
\`\`\`
`;
  }

  // ============================================================================
  // Response Parsing
  // ============================================================================

  private parseResearcherResponse(content: string): ResearcherResponse {
    // Parse structured response from researcher
    // This is simplified - production would use more robust parsing
    return {
      contextAnalysis: {
        projectState: this.extractSection(content, 'Context Analysis') || '',
        relevantSystems: this.extractList(content, 'Relevant Systems'),
        existingPatterns: this.extractList(content, 'Existing Patterns'),
      },
      bestPractices: this.extractBestPractices(content),
      considerations: {
        performance: this.extractList(content, 'Performance'),
        scalability: this.extractList(content, 'Scalability'),
        maintainability: this.extractList(content, 'Maintainability'),
      },
      recommendations: this.extractRecommendations(content),
    };
  }

  private parseMentorResponse(content: string): MentorResponse {
    const decision = content.toLowerCase().includes('approved') ? 'approved' :
                     content.toLowerCase().includes('reject') ? 'reject' : 'revise';

    return {
      assumptionReview: this.extractAssumptions(content),
      architectureFeedback: {
        strengths: this.extractList(content, 'Strengths'),
        weaknesses: this.extractList(content, 'Weaknesses'),
        suggestions: this.extractList(content, 'Suggestions'),
      },
      alternatives: this.extractAlternatives(content),
      riskAssessment: this.extractRisks(content),
      decision,
      feedback: this.extractSection(content, 'Feedback') || this.extractSection(content, 'Recommendations') || '',
    };
  }

  private parseBuilderResponse(content: string): BuilderResponse {
    const status = content.toLowerCase().includes('complete') ? 'complete' :
                   content.toLowerCase().includes('partial') ? 'partial' : 'failed';

    return {
      implementationPlan: this.extractList(content, 'Implementation Plan'),
      commands: this.extractCommands(content),
      integrationNotes: this.extractList(content, 'Integration'),
      testingResults: this.extractTestResults(content),
      status,
      notes: this.extractSection(content, 'Notes') || '',
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private extractSection(content: string, sectionName: string): string | null {
    const regex = new RegExp(`#+ *${sectionName}[:\\s]*([\\s\\S]*?)(?=#|$)`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : null;
  }

  private extractList(content: string, sectionName: string): string[] {
    const section = this.extractSection(content, sectionName);
    if (!section) return [];

    return section
      .split('\n')
      .map((line) => line.replace(/^[-*•]\s*/, '').trim())
      .filter((line) => line.length > 0);
  }

  private extractBestPractices(content: string): ResearcherResponse['bestPractices'] {
    const section = this.extractSection(content, 'Best Practices');
    if (!section) return [];

    return this.extractList(content, 'Best Practices').map((practice) => ({
      practice,
      source: 'Unreal Engine Documentation',
      relevance: 'high' as const,
    }));
  }

  private extractRecommendations(content: string): ResearcherResponse['recommendations'] {
    return this.extractList(content, 'Recommendations').map((rec, index) => ({
      approach: rec,
      rationale: '',
      priority: index + 1,
    }));
  }

  private extractAssumptions(content: string): MentorResponse['assumptionReview'] {
    return this.extractList(content, 'Assumptions').map((assumption) => ({
      assumption,
      valid: !assumption.toLowerCase().includes('invalid'),
    }));
  }

  private extractAlternatives(content: string): MentorResponse['alternatives'] {
    return this.extractList(content, 'Alternatives').map((alt) => ({
      approach: alt,
      tradeoffs: '',
      when: '',
    }));
  }

  private extractRisks(content: string): MentorResponse['riskAssessment'] {
    return this.extractList(content, 'Risks').map((risk) => ({
      risk,
      likelihood: 'medium' as const,
      mitigation: '',
    }));
  }

  private extractCommands(content: string): BuilderResponse['commands'] {
    const commands: BuilderResponse['commands'] = [];
    const regex = /```aegis\s*([\s\S]*?)```/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        commands.push({
          command: parsed.command,
          params: parsed.params || {},
          description: parsed.description || '',
        });
      } catch {
        // Skip invalid JSON
      }
    }

    return commands;
  }

  private extractTestResults(content: string): BuilderResponse['testingResults'] {
    return this.extractList(content, 'Testing').map((test) => ({
      test,
      passed: test.toLowerCase().includes('pass') || test.toLowerCase().includes('✓'),
    }));
  }

  // ============================================================================
  // Command Execution
  // ============================================================================

  private async executeCommands(workflow: AgentWorkflow): Promise<void> {
    if (!workflow.implementation?.commands) return;

    for (const cmd of workflow.implementation.commands) {
      try {
        this.config.logger.info('Executing command', {
          workflowId: workflow.id,
          command: cmd.command,
        });

        await this.config.executor.execute(cmd.command, cmd.params);
      } catch (error) {
        this.config.logger.error('Command execution failed', {
          workflowId: workflow.id,
          command: cmd.command,
          error,
        });
      }
    }
  }

  // ============================================================================
  // Workflow Management
  // ============================================================================

  getWorkflow(workflowId: string): AgentWorkflow | undefined {
    return this.workflows.get(workflowId);
  }

  listWorkflows(): AgentWorkflow[] {
    return Array.from(this.workflows.values());
  }

  cancelWorkflow(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (workflow && workflow.status !== 'complete' && workflow.status !== 'failed') {
      workflow.status = 'failed';
      return true;
    }
    return false;
  }
}

// ============================================================================
// Export Factory Function
// ============================================================================

export function createAgentCoordinator(config: CoordinatorConfig): AgentCoordinator {
  return new AgentCoordinator(config);
}
