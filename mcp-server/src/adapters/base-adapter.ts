/**
 * AEGIS Base Model Adapter
 * Abstract interface for AI model integrations
 */

import { Logger } from '../utils/logger.js';
import { ToolAnnotations } from '../schema/commands.js';

// ============================================================================
// Types
// ============================================================================

export interface ModelAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface ModelRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface ModelResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_use' | 'length' | 'error';
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  modelId: string;
  latencyMs?: number;
}

export interface StreamChunk {
  type: 'text' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'done';
  content?: string;
  toolCall?: Partial<ToolCall>;
}

export type StreamCallback = (chunk: StreamChunk) => void;

// ============================================================================
// Base Adapter
// ============================================================================

export abstract class BaseModelAdapter {
  protected config: ModelAdapterConfig;
  protected logger: Logger;

  constructor(config: ModelAdapterConfig, logger: Logger) {
    this.config = {
      maxTokens: 4096,
      temperature: 0.7,
      timeout: 60000,
      ...config,
    };
    this.logger = logger.child({ component: 'ModelAdapter', model: config.model });
  }

  /**
   * Get the adapter's model identifier
   */
  abstract getModelId(): string;

  /**
   * Get the adapter type name
   */
  abstract getAdapterType(): string;

  /**
   * Check if the adapter is available and configured
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Send a completion request to the model
   */
  abstract complete(request: ModelRequest): Promise<ModelResponse>;

  /**
   * Send a streaming completion request
   */
  abstract completeStream(
    request: ModelRequest,
    callback: StreamCallback
  ): Promise<ModelResponse>;

  /**
   * Convert tool definitions to model-specific format
   */
  protected abstract formatTools(tools: ToolDefinition[]): unknown[];

  /**
   * Parse tool calls from model response
   */
  protected abstract parseToolCalls(response: unknown): ToolCall[];

  /**
   * Validate the adapter configuration
   */
  protected validateConfig(): void {
    if (!this.config.model) {
      throw new Error(`${this.getAdapterType()}: Model name is required`);
    }
  }

  /**
   * Get configuration value
   */
  getConfig(): ModelAdapterConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ModelAdapterConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Create headers for API requests
   */
  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }

  /**
   * Handle API errors consistently
   */
  protected handleApiError(error: unknown, operation: string): never {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`${operation} failed`, error instanceof Error ? error : undefined, {
      operation,
      model: this.config.model,
    });
    throw new Error(`${this.getAdapterType()} ${operation} failed: ${message}`);
  }

  /**
   * Log request/response for debugging
   */
  protected logRequest(request: ModelRequest): void {
    this.logger.debug('Sending request', {
      messageCount: request.messages.length,
      toolCount: request.tools?.length || 0,
      maxTokens: request.maxTokens || this.config.maxTokens,
    });
  }

  /**
   * Log response metrics
   */
  protected logResponse(response: ModelResponse): void {
    this.logger.debug('Received response', {
      finishReason: response.finishReason,
      toolCallCount: response.toolCalls?.length || 0,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      latencyMs: response.latencyMs,
    });
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert AEGIS messages to standard format
 */
export function normalizeMessages(messages: Message[]): Message[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content.trim(),
  }));
}

/**
 * Estimate token count for a string (rough approximation)
 */
export function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

/**
 * Truncate messages to fit within token limit
 */
export function truncateMessages(
  messages: Message[],
  maxTokens: number,
  preserveSystem: boolean = true
): Message[] {
  const result: Message[] = [];
  let tokenCount = 0;

  // Always include system message if present
  if (preserveSystem && messages[0]?.role === 'system') {
    result.push(messages[0]);
    tokenCount += estimateTokenCount(messages[0].content);
  }

  // Add messages from end (most recent first)
  for (let i = messages.length - 1; i >= (preserveSystem ? 1 : 0); i--) {
    const msg = messages[i];
    const msgTokens = estimateTokenCount(msg.content);

    if (tokenCount + msgTokens > maxTokens) {
      break;
    }

    result.unshift(msg);
    tokenCount += msgTokens;
  }

  return result;
}

/**
 * Format tool definition for display
 */
export function formatToolDescription(tool: ToolDefinition): string {
  let description = `${tool.name}: ${tool.description}`;

  if (tool.annotations) {
    const flags: string[] = [];
    if (tool.annotations.readOnly) flags.push('read-only');
    if (tool.annotations.destructive) flags.push('destructive');
    if (tool.annotations.requiresApproval) flags.push('requires-approval');
    if (flags.length > 0) {
      description += ` [${flags.join(', ')}]`;
    }
  }

  return description;
}

/**
 * Create a system prompt with tool information
 */
export function createSystemPromptWithTools(
  basePrompt: string,
  tools: ToolDefinition[]
): string {
  if (tools.length === 0) {
    return basePrompt;
  }

  const toolDescriptions = tools.map(formatToolDescription).join('\n');

  return `${basePrompt}

You have access to the following tools:

${toolDescriptions}

When using tools, provide the tool name and arguments in a structured format.`;
}
