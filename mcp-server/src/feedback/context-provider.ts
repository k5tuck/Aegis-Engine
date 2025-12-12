/**
 * AEGIS Context Provider
 * Gathers context from Unreal Engine and AI Assistant for informed planning
 */

import { Logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface UnrealContext {
  // Current level/scene information
  currentLevel: LevelContext | null;

  // Selected objects
  selection: SelectionContext;

  // Editor state
  editorState: EditorStateContext;

  // Project information
  project: ProjectContext;

  // Recent changes
  recentChanges: RecentChangeContext[];

  // AI Assistant insights (if available)
  aiAssistantInsights?: AIAssistantContext;

  // Timestamp
  timestamp: string;
}

export interface LevelContext {
  name: string;
  path: string;
  actorCount: number;
  subLevels: string[];
  worldSettings: Record<string, unknown>;
  bounds?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

export interface SelectionContext {
  actors: Array<{
    path: string;
    label: string;
    class: string;
    location?: { x: number; y: number; z: number };
  }>;
  assets: Array<{
    path: string;
    name: string;
    class: string;
  }>;
}

export interface EditorStateContext {
  isPlaying: boolean;
  isSimulating: boolean;
  isPaused: boolean;
  viewportMode: string;
  activeViewportIndex: number;
  contentBrowserPath: string;
}

export interface ProjectContext {
  name: string;
  engineVersion: string;
  projectPath: string;
  targetPlatforms: string[];
  enabledPlugins: string[];
  projectSettings: Record<string, unknown>;
}

export interface RecentChangeContext {
  type: 'create' | 'modify' | 'delete' | 'move';
  target: string;
  timestamp: string;
  user?: string;
}

export interface AIAssistantContext {
  available: boolean;
  version?: string;
  capabilities?: string[];
  suggestions?: AIAssistantSuggestion[];
  contextualInfo?: string;
  relevantDocumentation?: DocumentationReference[];
}

export interface AIAssistantSuggestion {
  type: 'warning' | 'recommendation' | 'best_practice' | 'optimization';
  message: string;
  target?: string;
  action?: string;
  priority: 'low' | 'medium' | 'high';
}

export interface DocumentationReference {
  title: string;
  url: string;
  section?: string;
  relevance: number;
}

export interface ContextQuery {
  includeLevel?: boolean;
  includeSelection?: boolean;
  includeEditorState?: boolean;
  includeProject?: boolean;
  includeRecentChanges?: boolean;
  includeAIAssistant?: boolean;
  recentChangesLimit?: number;
  aiAssistantQuery?: string;
}

// ============================================================================
// AI Assistant Integration
// ============================================================================

export interface AIAssistantClient {
  isAvailable(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  getCapabilities(): Promise<string[]>;
  querySuggestions(context: string): Promise<AIAssistantSuggestion[]>;
  getContextualInfo(query: string): Promise<string | null>;
  getRelevantDocumentation(topic: string): Promise<DocumentationReference[]>;
  analyzeBlueprint(blueprintPath: string): Promise<AIAssistantSuggestion[]>;
  analyzeLevel(levelPath: string): Promise<AIAssistantSuggestion[]>;
}

// ============================================================================
// Mock AI Assistant Client (for when Unreal AI Assistant is not available)
// ============================================================================

class MockAIAssistantClient implements AIAssistantClient {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async getVersion(): Promise<string | null> {
    return null;
  }

  async getCapabilities(): Promise<string[]> {
    return [];
  }

  async querySuggestions(_context: string): Promise<AIAssistantSuggestion[]> {
    return [];
  }

  async getContextualInfo(_query: string): Promise<string | null> {
    return null;
  }

  async getRelevantDocumentation(_topic: string): Promise<DocumentationReference[]> {
    return [];
  }

  async analyzeBlueprint(_blueprintPath: string): Promise<AIAssistantSuggestion[]> {
    return [];
  }

  async analyzeLevel(_levelPath: string): Promise<AIAssistantSuggestion[]> {
    return [];
  }
}

// ============================================================================
// Context Provider Implementation
// ============================================================================

export class ContextProvider {
  private logger: Logger;
  private unrealClient: UnrealContextClient | null = null;
  private aiAssistant: AIAssistantClient;
  private contextCache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private cacheTTL: number = 5000; // 5 seconds

  constructor(logger: Logger, aiAssistant?: AIAssistantClient) {
    this.logger = logger.child({ component: 'ContextProvider' });
    this.aiAssistant = aiAssistant || new MockAIAssistantClient();
  }

  /**
   * Set the Unreal client for context queries
   */
  setUnrealClient(client: UnrealContextClient): void {
    this.unrealClient = client;
  }

  /**
   * Set the AI Assistant client
   */
  setAIAssistantClient(client: AIAssistantClient): void {
    this.aiAssistant = client;
  }

  /**
   * Gather context for planning and implementation
   */
  async gatherContext(query: ContextQuery = {}): Promise<UnrealContext> {
    const {
      includeLevel = true,
      includeSelection = true,
      includeEditorState = true,
      includeProject = true,
      includeRecentChanges = true,
      includeAIAssistant = true,
      recentChangesLimit = 10,
      aiAssistantQuery,
    } = query;

    this.logger.debug('Gathering context', { query });

    const context: UnrealContext = {
      currentLevel: null,
      selection: { actors: [], assets: [] },
      editorState: {
        isPlaying: false,
        isSimulating: false,
        isPaused: false,
        viewportMode: 'Unknown',
        activeViewportIndex: 0,
        contentBrowserPath: '/Game',
      },
      project: {
        name: 'Unknown',
        engineVersion: 'Unknown',
        projectPath: '',
        targetPlatforms: [],
        enabledPlugins: [],
        projectSettings: {},
      },
      recentChanges: [],
      timestamp: new Date().toISOString(),
    };

    if (!this.unrealClient) {
      this.logger.warn('No Unreal client available for context gathering');
      return context;
    }

    // Gather context in parallel where possible
    const promises: Promise<void>[] = [];

    if (includeLevel) {
      promises.push(
        this.gatherLevelContext().then((level) => {
          context.currentLevel = level;
        })
      );
    }

    if (includeSelection) {
      promises.push(
        this.gatherSelectionContext().then((selection) => {
          context.selection = selection;
        })
      );
    }

    if (includeEditorState) {
      promises.push(
        this.gatherEditorState().then((state) => {
          context.editorState = state;
        })
      );
    }

    if (includeProject) {
      promises.push(
        this.gatherProjectContext().then((project) => {
          context.project = project;
        })
      );
    }

    if (includeRecentChanges) {
      promises.push(
        this.gatherRecentChanges(recentChangesLimit).then((changes) => {
          context.recentChanges = changes;
        })
      );
    }

    if (includeAIAssistant) {
      promises.push(
        this.gatherAIAssistantContext(aiAssistantQuery).then((aiContext) => {
          context.aiAssistantInsights = aiContext;
        })
      );
    }

    await Promise.allSettled(promises);

    this.logger.debug('Context gathered', {
      hasLevel: !!context.currentLevel,
      selectionCount: context.selection.actors.length + context.selection.assets.length,
      hasAIInsights: !!context.aiAssistantInsights?.available,
    });

    return context;
  }

  /**
   * Query the AI Assistant for planning context
   */
  async queryAIAssistantForPlanning(
    taskDescription: string,
    currentContext?: UnrealContext
  ): Promise<{
    suggestions: AIAssistantSuggestion[];
    relevantInfo: string | null;
    documentation: DocumentationReference[];
    contextSummary: string;
  }> {
    this.logger.info('Querying AI Assistant for planning context', { taskDescription });

    const [suggestions, relevantInfo, documentation] = await Promise.all([
      this.aiAssistant.querySuggestions(taskDescription),
      this.aiAssistant.getContextualInfo(taskDescription),
      this.aiAssistant.getRelevantDocumentation(taskDescription),
    ]);

    // Generate context summary
    const contextSummary = this.generateContextSummary(taskDescription, currentContext);

    return {
      suggestions,
      relevantInfo,
      documentation,
      contextSummary,
    };
  }

  /**
   * Get pre-planning context - should be called before creating todos
   */
  async getPrePlanningContext(taskDescription: string): Promise<{
    context: UnrealContext;
    aiInsights: {
      suggestions: AIAssistantSuggestion[];
      relevantInfo: string | null;
      documentation: DocumentationReference[];
    };
    warnings: string[];
    recommendations: string[];
  }> {
    // Gather full context
    const context = await this.gatherContext({
      includeLevel: true,
      includeSelection: true,
      includeEditorState: true,
      includeProject: true,
      includeRecentChanges: true,
      includeAIAssistant: true,
      aiAssistantQuery: taskDescription,
    });

    // Query AI Assistant
    const { suggestions, relevantInfo, documentation } = await this.queryAIAssistantForPlanning(
      taskDescription,
      context
    );

    // Analyze for warnings and recommendations
    const warnings: string[] = [];
    const recommendations: string[] = [];

    // Check editor state warnings
    if (context.editorState.isPlaying) {
      warnings.push('Editor is currently in Play mode. Some modifications may not persist.');
    }

    if (context.editorState.isSimulating) {
      warnings.push('Editor is in Simulation mode. Consider stopping simulation before making changes.');
    }

    // Check selection-based recommendations
    if (context.selection.actors.length === 0 && taskDescription.toLowerCase().includes('selected')) {
      warnings.push('No actors are currently selected. You may need to select actors first.');
    }

    // Add AI Assistant suggestions as recommendations
    for (const suggestion of suggestions) {
      if (suggestion.type === 'warning') {
        warnings.push(suggestion.message);
      } else if (suggestion.type === 'recommendation' || suggestion.type === 'best_practice') {
        recommendations.push(suggestion.message);
      }
    }

    return {
      context,
      aiInsights: {
        suggestions,
        relevantInfo,
        documentation,
      },
      warnings,
      recommendations,
    };
  }

  /**
   * Analyze a target before modification
   */
  async analyzeTargetBeforeChange(
    target: string,
    targetType: 'actor' | 'blueprint' | 'asset' | 'level'
  ): Promise<{
    exists: boolean;
    currentState: Record<string, unknown>;
    dependencies: string[];
    aiSuggestions: AIAssistantSuggestion[];
  }> {
    let exists = false;
    let currentState: Record<string, unknown> = {};
    let dependencies: string[] = [];
    let aiSuggestions: AIAssistantSuggestion[] = [];

    if (this.unrealClient) {
      // Check if target exists and get current state
      try {
        const info = await this.unrealClient.getTargetInfo(target, targetType);
        exists = !!info;
        currentState = info || {};
        dependencies = info?.dependencies || [];
      } catch (error) {
        this.logger.debug('Target not found or error', { target, error });
      }
    }

    // Get AI Assistant analysis
    if (targetType === 'blueprint') {
      aiSuggestions = await this.aiAssistant.analyzeBlueprint(target);
    } else if (targetType === 'level') {
      aiSuggestions = await this.aiAssistant.analyzeLevel(target);
    }

    return {
      exists,
      currentState,
      dependencies,
      aiSuggestions,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async gatherLevelContext(): Promise<LevelContext | null> {
    const cached = this.getFromCache('level');
    if (cached) return cached as LevelContext;

    try {
      const level = await this.unrealClient!.getCurrentLevel();
      this.setCache('level', level);
      return level;
    } catch (error) {
      this.logger.debug('Failed to gather level context', { error });
      return null;
    }
  }

  private async gatherSelectionContext(): Promise<SelectionContext> {
    const cached = this.getFromCache('selection');
    if (cached) return cached as SelectionContext;

    try {
      const selection = await this.unrealClient!.getSelection();
      this.setCache('selection', selection);
      return selection;
    } catch (error) {
      this.logger.debug('Failed to gather selection context', { error });
      return { actors: [], assets: [] };
    }
  }

  private async gatherEditorState(): Promise<EditorStateContext> {
    const cached = this.getFromCache('editorState');
    if (cached) return cached as EditorStateContext;

    try {
      const state = await this.unrealClient!.getEditorState();
      this.setCache('editorState', state);
      return state;
    } catch (error) {
      this.logger.debug('Failed to gather editor state', { error });
      return {
        isPlaying: false,
        isSimulating: false,
        isPaused: false,
        viewportMode: 'Unknown',
        activeViewportIndex: 0,
        contentBrowserPath: '/Game',
      };
    }
  }

  private async gatherProjectContext(): Promise<ProjectContext> {
    const cached = this.getFromCache('project');
    if (cached) return cached as ProjectContext;

    try {
      const project = await this.unrealClient!.getProjectInfo();
      this.setCache('project', project);
      return project;
    } catch (error) {
      this.logger.debug('Failed to gather project context', { error });
      return {
        name: 'Unknown',
        engineVersion: 'Unknown',
        projectPath: '',
        targetPlatforms: [],
        enabledPlugins: [],
        projectSettings: {},
      };
    }
  }

  private async gatherRecentChanges(limit: number): Promise<RecentChangeContext[]> {
    try {
      return await this.unrealClient!.getRecentChanges(limit);
    } catch (error) {
      this.logger.debug('Failed to gather recent changes', { error });
      return [];
    }
  }

  private async gatherAIAssistantContext(query?: string): Promise<AIAssistantContext> {
    const available = await this.aiAssistant.isAvailable();

    if (!available) {
      return { available: false };
    }

    try {
      const [version, capabilities, suggestions, contextualInfo] = await Promise.all([
        this.aiAssistant.getVersion(),
        this.aiAssistant.getCapabilities(),
        query ? this.aiAssistant.querySuggestions(query) : Promise.resolve([]),
        query ? this.aiAssistant.getContextualInfo(query) : Promise.resolve(null),
      ]);

      return {
        available: true,
        version: version || undefined,
        capabilities,
        suggestions,
        contextualInfo: contextualInfo || undefined,
      };
    } catch (error) {
      this.logger.debug('Failed to gather AI Assistant context', { error });
      return { available: true };
    }
  }

  private generateContextSummary(taskDescription: string, context?: UnrealContext): string {
    const parts: string[] = [];

    parts.push(`Task: ${taskDescription}`);

    if (context?.currentLevel) {
      parts.push(`Current Level: ${context.currentLevel.name} (${context.currentLevel.actorCount} actors)`);
    }

    if (context?.selection.actors.length) {
      parts.push(`Selected: ${context.selection.actors.length} actor(s)`);
    }

    if (context?.editorState.isPlaying) {
      parts.push('Note: Editor is in Play mode');
    }

    if (context?.project) {
      parts.push(`Project: ${context.project.name} (UE ${context.project.engineVersion})`);
    }

    return parts.join('\n');
  }

  private getFromCache(key: string): unknown | null {
    const cached = this.contextCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    return null;
  }

  private setCache(key: string, data: unknown): void {
    this.contextCache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Clear the context cache
   */
  clearCache(): void {
    this.contextCache.clear();
  }
}

// ============================================================================
// Interface for Unreal Context Client (implemented in UE Bridge)
// ============================================================================

export interface UnrealContextClient {
  getCurrentLevel(): Promise<LevelContext | null>;
  getSelection(): Promise<SelectionContext>;
  getEditorState(): Promise<EditorStateContext>;
  getProjectInfo(): Promise<ProjectContext>;
  getRecentChanges(limit: number): Promise<RecentChangeContext[]>;
  getTargetInfo(target: string, type: string): Promise<Record<string, unknown> | null>;
}

// ============================================================================
// Factory Function
// ============================================================================

export function createContextProvider(
  logger: Logger,
  aiAssistant?: AIAssistantClient
): ContextProvider {
  return new ContextProvider(logger, aiAssistant);
}
