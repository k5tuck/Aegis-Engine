/**
 * AEGIS AI Commands
 * Commands for the three-tier AI system
 */

import { z } from 'zod';
import { CommandDefinition } from '../registry/plugin-types.js';
import { AgentCoordinator, CoordinatorConfig } from './agent-coordinator.js';
import { AgentRole } from './agent-roles.js';

// ============================================================================
// Command Schemas
// ============================================================================

const ProcessTaskSchema = z.object({
  task: z.string().describe('The task to process through the AI system'),
  skipResearch: z.boolean().optional().default(false).describe('Skip the research phase'),
  skipMentor: z.boolean().optional().default(false).describe('Skip the mentor review phase'),
  autoExecute: z.boolean().optional().default(false).describe('Automatically execute approved commands'),
  context: z.record(z.any()).optional().describe('Additional context for the task'),
});

const GetWorkflowSchema = z.object({
  workflowId: z.string().describe('ID of the workflow to retrieve'),
});

const QuickBuildSchema = z.object({
  task: z.string().describe('Quick task to execute (Builder only)'),
  context: z.record(z.any()).optional(),
});

const ResearchOnlySchema = z.object({
  task: z.string().describe('Task to research'),
  context: z.record(z.any()).optional(),
});

const ReviewPlanSchema = z.object({
  plan: z.string().describe('Plan to review'),
  task: z.string().describe('Original task context'),
});

// ============================================================================
// Command Implementations
// ============================================================================

/**
 * Create AI commands for the MCP server
 */
export function createAICommands(coordinator: AgentCoordinator): CommandDefinition[] {
  return [
    // ========================================================================
    // process_with_ai - Full three-tier workflow
    // ========================================================================
    {
      name: 'process_with_ai',
      description: 'Process a task through the three-tier AI system (Researcher → Mentor → Builder)',
      category: 'ai',
      parameters: ProcessTaskSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = ProcessTaskSchema.parse(params);

        logger?.info('Starting AI workflow', { task: validatedParams.task.substring(0, 50) });

        const workflow = await coordinator.processTask(validatedParams.task, {
          skipResearch: validatedParams.skipResearch,
          skipMentor: validatedParams.skipMentor,
          context: validatedParams.context,
        });

        return {
          success: workflow.status === 'complete',
          workflowId: workflow.id,
          status: workflow.status,
          iterations: workflow.iterations,
          phases: {
            research: workflow.research ? {
              recommendations: workflow.research.recommendations.length,
              considerations: Object.keys(workflow.research.considerations).length,
            } : null,
            mentor: workflow.mentorReview ? {
              decision: workflow.mentorReview.decision,
              risks: workflow.mentorReview.riskAssessment.length,
            } : null,
            builder: workflow.implementation ? {
              commands: workflow.implementation.commands.length,
              status: workflow.implementation.status,
            } : null,
          },
          workflow,
        };
      },
    },

    // ========================================================================
    // quick_build - Skip research and mentor, go straight to builder
    // ========================================================================
    {
      name: 'quick_build',
      description: 'Quickly execute a task using only the Builder agent (no research or review)',
      category: 'ai',
      parameters: QuickBuildSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = QuickBuildSchema.parse(params);

        logger?.info('Starting quick build', { task: validatedParams.task.substring(0, 50) });

        const workflow = await coordinator.processTask(validatedParams.task, {
          skipResearch: true,
          skipMentor: true,
          context: validatedParams.context,
        });

        return {
          success: workflow.status === 'complete',
          workflowId: workflow.id,
          status: workflow.status,
          commands: workflow.implementation?.commands || [],
          notes: workflow.implementation?.notes,
        };
      },
    },

    // ========================================================================
    // research_task - Research only, no implementation
    // ========================================================================
    {
      name: 'research_task',
      description: 'Research a task and provide recommendations (Researcher agent only)',
      category: 'ai',
      parameters: ResearchOnlySchema,
      handler: async ({ params, logger }) => {
        const validatedParams = ResearchOnlySchema.parse(params);

        logger?.info('Starting research', { task: validatedParams.task.substring(0, 50) });

        const workflow = await coordinator.processTask(validatedParams.task, {
          skipMentor: true,
          context: {
            ...validatedParams.context,
            researchOnly: true,
          },
        });

        // Don't proceed to builder
        return {
          success: true,
          workflowId: workflow.id,
          research: workflow.research,
          contextAnalysis: workflow.research?.contextAnalysis,
          bestPractices: workflow.research?.bestPractices,
          considerations: workflow.research?.considerations,
          recommendations: workflow.research?.recommendations,
        };
      },
    },

    // ========================================================================
    // review_plan - Have the Mentor review a plan
    // ========================================================================
    {
      name: 'review_plan',
      description: 'Have the Mentor agent review and critique a plan',
      category: 'ai',
      parameters: ReviewPlanSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = ReviewPlanSchema.parse(params);

        logger?.info('Starting plan review');

        // Create a workflow with pre-populated research
        const workflow = await coordinator.processTask(validatedParams.task, {
          skipResearch: false,
          context: {
            prebuiltPlan: validatedParams.plan,
          },
        });

        return {
          success: true,
          workflowId: workflow.id,
          decision: workflow.mentorReview?.decision,
          feedback: workflow.mentorReview?.feedback,
          assumptions: workflow.mentorReview?.assumptionReview,
          architectureFeedback: workflow.mentorReview?.architectureFeedback,
          alternatives: workflow.mentorReview?.alternatives,
          risks: workflow.mentorReview?.riskAssessment,
        };
      },
    },

    // ========================================================================
    // get_workflow - Get workflow status/results
    // ========================================================================
    {
      name: 'get_workflow',
      description: 'Get the status and results of an AI workflow',
      category: 'ai',
      parameters: GetWorkflowSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = GetWorkflowSchema.parse(params);

        const workflow = coordinator.getWorkflow(validatedParams.workflowId);

        if (!workflow) {
          return {
            success: false,
            error: `Workflow not found: ${validatedParams.workflowId}`,
          };
        }

        return {
          success: true,
          workflow: {
            id: workflow.id,
            task: workflow.task,
            status: workflow.status,
            iterations: workflow.iterations,
            research: workflow.research,
            mentorReview: workflow.mentorReview,
            implementation: workflow.implementation,
            historyLength: workflow.history.length,
          },
        };
      },
    },

    // ========================================================================
    // list_workflows - List all workflows
    // ========================================================================
    {
      name: 'list_workflows',
      description: 'List all AI workflows',
      category: 'ai',
      parameters: z.object({
        status: z.enum(['pending', 'researching', 'mentoring', 'building', 'complete', 'failed']).optional(),
        limit: z.number().optional().default(20),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z.object({
          status: z.string().optional(),
          limit: z.number().optional().default(20),
        }).parse(params);

        let workflows = coordinator.listWorkflows();

        if (validatedParams.status) {
          workflows = workflows.filter(w => w.status === validatedParams.status);
        }

        workflows = workflows.slice(0, validatedParams.limit);

        return {
          success: true,
          workflows: workflows.map(w => ({
            id: w.id,
            task: w.task.substring(0, 100),
            status: w.status,
            iterations: w.iterations,
          })),
          total: workflows.length,
        };
      },
    },

    // ========================================================================
    // cancel_workflow - Cancel a running workflow
    // ========================================================================
    {
      name: 'cancel_workflow',
      description: 'Cancel a running AI workflow',
      category: 'ai',
      parameters: z.object({
        workflowId: z.string(),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z.object({
          workflowId: z.string(),
        }).parse(params);

        const cancelled = coordinator.cancelWorkflow(validatedParams.workflowId);

        return {
          success: cancelled,
          workflowId: validatedParams.workflowId,
          message: cancelled ? 'Workflow cancelled' : 'Workflow not found or already complete',
        };
      },
    },

    // ========================================================================
    // explain_ai_system - Explain how the AI system works
    // ========================================================================
    {
      name: 'explain_ai_system',
      description: 'Get an explanation of the three-tier AI system',
      category: 'ai',
      parameters: z.object({}),
      handler: async () => {
        return {
          success: true,
          system: {
            name: 'AEGIS Three-Tier AI System',
            description: 'A collaborative AI workflow for content creation',
            tiers: [
              {
                name: 'Researcher',
                role: AgentRole.RESEARCHER,
                responsibilities: [
                  'Gathers context about the current project',
                  'Researches best practices and documentation',
                  'Identifies existing patterns to leverage',
                  'Provides educational context',
                ],
                outputs: ['Context Analysis', 'Best Practices', 'Recommendations'],
              },
              {
                name: 'Mentor',
                role: AgentRole.MENTOR,
                responsibilities: [
                  'Challenges assumptions in the plan',
                  'Reviews architecture decisions',
                  'Suggests alternatives when appropriate',
                  'Ensures quality and best practices',
                ],
                outputs: ['Assumption Review', 'Architecture Feedback', 'Risk Assessment', 'Decision'],
              },
              {
                name: 'Builder',
                role: AgentRole.BUILDER,
                responsibilities: [
                  'Implements the approved plan',
                  'Writes production-quality code',
                  'Creates necessary assets',
                  'Tests the implementation',
                ],
                outputs: ['Implementation Plan', 'Commands', 'Testing Results'],
              },
            ],
            workflow: [
              '1. User submits a task',
              '2. Researcher analyzes and gathers context',
              '3. Mentor reviews the plan (may request revisions)',
              '4. Builder implements the approved plan',
              '5. Commands are executed in Unreal Engine',
            ],
          },
        };
      },
    },
  ];
}
