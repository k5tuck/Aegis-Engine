/**
 * AEGIS AI Module
 * Three-tier AI system: Researcher, Mentor, Builder
 */

export {
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

export {
  AgentCoordinator,
  CoordinatorConfig,
  createAgentCoordinator,
} from './agent-coordinator.js';

export { createAICommands } from './ai-commands.js';
