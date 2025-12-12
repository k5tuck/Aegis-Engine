/**
 * AEGIS AI Agent Roles
 * Defines the three-tier AI system: Researcher, Mentor, Builder
 */

import { z } from 'zod';

// ============================================================================
// Agent Role Definitions
// ============================================================================

export enum AgentRole {
  RESEARCHER = 'researcher',
  MENTOR = 'mentor',
  BUILDER = 'builder',
  COORDINATOR = 'coordinator',
}

/**
 * Researcher Agent
 * - Finds best practices from documentation and web
 * - Gathers context about the current project
 * - Identifies patterns and anti-patterns
 * - Provides educational context
 */
export const ResearcherPrompt = `You are the AEGIS Researcher Agent. Your role is to:

1. **Gather Context**: Analyze the current Unreal Engine project state, existing code patterns, and assets.

2. **Research Best Practices**: Find and summarize best practices for the requested feature:
   - Unreal Engine documentation and guidelines
   - Epic Games recommended patterns
   - Community-proven approaches
   - Performance considerations

3. **Identify Patterns**: Look for:
   - Similar implementations in the codebase
   - Reusable components and systems
   - Potential conflicts or dependencies
   - Anti-patterns to avoid

4. **Educational Output**: Explain WHY certain approaches are recommended, not just WHAT to do.

Output Format:
- Context Analysis: Current project state relevant to the task
- Best Practices: Documented approaches with sources
- Existing Patterns: What's already in the project that can be leveraged
- Considerations: Performance, scalability, maintainability concerns
- Recommendations: Prioritized list of approaches with rationale`;

/**
 * Mentor Agent
 * - Challenges assumptions in the plan
 * - Reviews architecture decisions
 * - Suggests alternatives
 * - Ensures quality and best practices
 */
export const MentorPrompt = `You are the AEGIS Mentor Agent. Your role is to:

1. **Challenge Assumptions**: Question every assumption in the proposed plan:
   - Is this the right approach for this specific use case?
   - Are there edge cases not being considered?
   - What could go wrong?

2. **Review Architecture**: Evaluate the technical design:
   - Does it follow Unreal Engine best practices?
   - Is it scalable and maintainable?
   - Does it integrate well with existing systems?
   - Are there performance implications?

3. **Suggest Alternatives**: Provide different approaches when appropriate:
   - Simpler solutions that might work
   - More robust solutions for complex cases
   - Trade-offs between approaches

4. **Quality Gates**: Ensure the plan addresses:
   - Error handling
   - Edge cases
   - Testing strategy
   - Documentation needs

Output Format:
- Assumption Review: List of assumptions and whether they're valid
- Architecture Feedback: Strengths and weaknesses of the proposed design
- Alternative Approaches: Other ways to solve the problem
- Risk Assessment: What could go wrong and how to mitigate
- Recommendations: Approved/Revise/Reject with specific feedback`;

/**
 * Builder Agent
 * - Implements the approved plan
 * - Writes actual code
 * - Creates assets and configurations
 * - Tests the implementation
 */
export const BuilderPrompt = `You are the AEGIS Builder Agent. Your role is to:

1. **Implement Code**: Write production-quality code that:
   - Follows Unreal Engine coding standards
   - Is well-documented with clear comments
   - Handles errors gracefully
   - Is efficient and performant

2. **Create Assets**: Generate necessary assets:
   - Blueprints with proper inheritance
   - Data assets with sensible defaults
   - Materials with proper parameterization
   - Level configurations

3. **Integration**: Ensure the implementation:
   - Works with existing systems
   - Doesn't break other features
   - Uses appropriate APIs
   - Follows project conventions

4. **Validation**: Before completing:
   - Test the implementation
   - Verify edge cases
   - Check for compilation errors
   - Ensure it matches the approved plan

Output Format:
- Implementation Plan: Step-by-step what will be done
- Code/Commands: The actual implementation
- Integration Notes: How this connects to existing systems
- Testing: What was tested and results
- Completion Status: Done/Partial with notes`;

// ============================================================================
// Agent Configuration Schema
// ============================================================================

export const AgentConfigSchema = z.object({
  role: z.nativeEnum(AgentRole),
  model: z.string().optional().describe('Model to use for this agent'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().optional(),
  systemPrompt: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ============================================================================
// Default Agent Configurations
// ============================================================================

export const DefaultAgentConfigs: Record<AgentRole, AgentConfig> = {
  [AgentRole.RESEARCHER]: {
    role: AgentRole.RESEARCHER,
    model: 'claude', // Good at analysis and research
    temperature: 0.3, // More focused
    systemPrompt: ResearcherPrompt,
    enabled: true,
  },
  [AgentRole.MENTOR]: {
    role: AgentRole.MENTOR,
    model: 'claude', // Good at reasoning and review
    temperature: 0.5, // Balanced
    systemPrompt: MentorPrompt,
    enabled: true,
  },
  [AgentRole.BUILDER]: {
    role: AgentRole.BUILDER,
    model: 'claude', // Best for code generation
    temperature: 0.2, // More deterministic for code
    systemPrompt: BuilderPrompt,
    enabled: true,
  },
  [AgentRole.COORDINATOR]: {
    role: AgentRole.COORDINATOR,
    model: 'claude',
    temperature: 0.3,
    systemPrompt: '', // Set dynamically
    enabled: true,
  },
};

// ============================================================================
// Agent Response Types
// ============================================================================

export interface ResearcherResponse {
  contextAnalysis: {
    projectState: string;
    relevantSystems: string[];
    existingPatterns: string[];
  };
  bestPractices: Array<{
    practice: string;
    source: string;
    relevance: 'high' | 'medium' | 'low';
  }>;
  considerations: {
    performance: string[];
    scalability: string[];
    maintainability: string[];
  };
  recommendations: Array<{
    approach: string;
    rationale: string;
    priority: number;
  }>;
}

export interface MentorResponse {
  assumptionReview: Array<{
    assumption: string;
    valid: boolean;
    concern?: string;
  }>;
  architectureFeedback: {
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
  };
  alternatives: Array<{
    approach: string;
    tradeoffs: string;
    when: string;
  }>;
  riskAssessment: Array<{
    risk: string;
    likelihood: 'high' | 'medium' | 'low';
    mitigation: string;
  }>;
  decision: 'approved' | 'revise' | 'reject';
  feedback: string;
}

export interface BuilderResponse {
  implementationPlan: string[];
  commands: Array<{
    command: string;
    params: Record<string, any>;
    description: string;
  }>;
  integrationNotes: string[];
  testingResults: Array<{
    test: string;
    passed: boolean;
    notes?: string;
  }>;
  status: 'complete' | 'partial' | 'failed';
  notes: string;
}

// ============================================================================
// Workflow Types
// ============================================================================

export interface AgentWorkflow {
  id: string;
  task: string;
  status: 'pending' | 'researching' | 'mentoring' | 'building' | 'complete' | 'failed';
  iterations: number;
  maxIterations: number;
  research?: ResearcherResponse;
  mentorReview?: MentorResponse;
  implementation?: BuilderResponse;
  history: WorkflowStep[];
}

export interface WorkflowStep {
  timestamp: Date;
  agent: AgentRole;
  action: string;
  input: string;
  output: string;
  duration: number;
}
