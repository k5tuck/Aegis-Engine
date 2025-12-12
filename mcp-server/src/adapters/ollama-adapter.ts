/**
 * AEGIS Ollama Adapter
 * AI model adapter for local Ollama models
 */

import {
  BaseModelAdapter,
  ModelAdapterConfig,
  ModelRequest,
  ModelResponse,
  ToolDefinition,
  ToolCall,
  StreamCallback,
  StreamChunk,
  createSystemPromptWithTools,
} from './base-adapter.js';
import { Logger } from '../utils/logger.js';
import { ModelAdapterError } from '../utils/errors.js';

// ============================================================================
// Types
// ============================================================================

export interface OllamaAdapterConfig extends ModelAdapterConfig {
  host?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  keepAlive?: string;
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    num_predict?: number;
    temperature?: number;
    stop?: string[];
  };
  keep_alive?: string;
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
    details?: {
      parent_model?: string;
      format?: string;
      family?: string;
      families?: string[];
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

// ============================================================================
// Ollama Adapter Implementation
// ============================================================================

export class OllamaAdapter extends BaseModelAdapter {
  private host: string;
  private keepAlive: string;

  constructor(config: OllamaAdapterConfig, logger: Logger) {
    super(
      {
        ...config,
        model: config.model || 'llama3.1',
        maxTokens: config.maxTokens || 4096,
        temperature: config.temperature || 0.7,
      },
      logger
    );

    this.host = config.host || 'http://localhost:11434';
    this.keepAlive = config.keepAlive || '5m';
    this.validateConfig();
  }

  getModelId(): string {
    return this.config.model;
  }

  getAdapterType(): string {
    return 'ollama';
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Ollama is running and the model is available
      const response = await fetch(`${this.host}/api/tags`);
      if (!response.ok) return false;

      const data = (await response.json()) as OllamaTagsResponse;
      const modelName = this.config.model.toLowerCase();

      // Check if model exists (handle model names with and without tags)
      return data.models.some(
        (m) =>
          m.name.toLowerCase() === modelName ||
          m.name.toLowerCase().startsWith(`${modelName}:`) ||
          m.model.toLowerCase() === modelName
      );
    } catch (error) {
      this.logger.warn('Ollama adapter availability check failed', { error });
      return false;
    }
  }

  /**
   * List available models on the Ollama instance
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.host}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }

      const data = (await response.json()) as OllamaTagsResponse;
      return data.models.map((m) => m.name);
    } catch (error) {
      this.logger.error('Failed to list Ollama models', error instanceof Error ? error : undefined);
      return [];
    }
  }

  /**
   * Pull a model from the Ollama registry
   */
  async pullModel(modelName: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.host}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
      });

      if (!response.ok) {
        throw new Error(`Failed to pull model: ${response.status}`);
      }

      // Stream the pull progress
      const reader = response.body?.getReader();
      if (!reader) return false;

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            this.logger.debug('Pull progress', data);
          } catch {
            // Ignore parse errors
          }
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to pull Ollama model', error instanceof Error ? error : undefined);
      return false;
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const timer = this.logger.startTimer();
    this.logRequest(request);

    try {
      const messages = this.formatMessages(request.messages, request.systemPrompt, request.tools);

      const ollamaRequest: OllamaChatRequest = {
        model: this.config.model,
        messages,
        stream: false,
        options: {
          num_predict: request.maxTokens || this.config.maxTokens,
          temperature: request.temperature ?? this.config.temperature,
          stop: request.stopSequences,
        },
        keep_alive: this.keepAlive,
      };

      const response = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(ollamaRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as OllamaChatResponse;
      const result = this.parseResponse(data);
      result.latencyMs = timer();

      this.logResponse(result);
      return result;
    } catch (error) {
      throw new ModelAdapterError(
        this.config.model,
        'Completion request failed',
        error instanceof Error ? error : undefined
      );
    }
  }

  async completeStream(
    request: ModelRequest,
    callback: StreamCallback
  ): Promise<ModelResponse> {
    const timer = this.logger.startTimer();
    this.logRequest(request);

    try {
      const messages = this.formatMessages(request.messages, request.systemPrompt, request.tools);

      const ollamaRequest: OllamaChatRequest = {
        model: this.config.model,
        messages,
        stream: true,
        options: {
          num_predict: request.maxTokens || this.config.maxTokens,
          temperature: request.temperature ?? this.config.temperature,
          stop: request.stopSequences,
        },
        keep_alive: this.keepAlive,
      };

      const response = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(ollamaRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let content = '';
      let finishReason: ModelResponse['finishReason'] = 'stop';
      let usage: ModelResponse['usage'];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n').filter((l) => l.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line) as OllamaChatResponse;

            if (data.message?.content) {
              content += data.message.content;
              callback({
                type: 'text',
                content: data.message.content,
              });
            }

            if (data.done) {
              finishReason = 'stop';
              if (data.prompt_eval_count !== undefined && data.eval_count !== undefined) {
                usage = {
                  inputTokens: data.prompt_eval_count,
                  outputTokens: data.eval_count,
                  totalTokens: data.prompt_eval_count + data.eval_count,
                };
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      callback({ type: 'done' });

      // Attempt to parse tool calls from response content
      const toolCalls = this.extractToolCalls(content, request.tools);

      const result: ModelResponse = {
        content: toolCalls.length > 0 ? this.removeToolCallsFromContent(content) : content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: toolCalls.length > 0 ? 'tool_use' : finishReason,
        usage,
        modelId: this.config.model,
        latencyMs: timer(),
      };

      this.logResponse(result);
      return result;
    } catch (error) {
      throw new ModelAdapterError(
        this.config.model,
        'Stream completion failed',
        error instanceof Error ? error : undefined
      );
    }
  }

  protected formatTools(tools: ToolDefinition[]): never[] {
    // Ollama doesn't have native tool support, we embed tools in the system prompt
    return [];
  }

  protected parseToolCalls(_response: OllamaChatResponse): ToolCall[] {
    // Tool calls are extracted from content for Ollama
    return [];
  }

  private formatMessages(
    messages: { role: string; content: string }[],
    systemPrompt?: string,
    tools?: ToolDefinition[]
  ): OllamaMessage[] {
    const formatted: OllamaMessage[] = [];

    // Build system prompt with tools if provided
    let finalSystemPrompt = systemPrompt || '';
    if (tools && tools.length > 0) {
      finalSystemPrompt = createSystemPromptWithTools(finalSystemPrompt, tools);
      finalSystemPrompt += `

When you want to use a tool, respond with a JSON block in this exact format:
\`\`\`tool_call
{
  "name": "tool_name",
  "arguments": {
    "param1": "value1"
  }
}
\`\`\`

After the tool result is provided, continue your response.`;
    }

    if (finalSystemPrompt) {
      formatted.push({
        role: 'system',
        content: finalSystemPrompt,
      });
    }

    for (const msg of messages) {
      if (msg.role === 'system' && !systemPrompt && !tools) {
        formatted.push({
          role: 'system',
          content: msg.content,
        });
      } else if (msg.role === 'user') {
        formatted.push({
          role: 'user',
          content: msg.content,
        });
      } else if (msg.role === 'assistant') {
        formatted.push({
          role: 'assistant',
          content: msg.content,
        });
      }
    }

    return formatted;
  }

  private parseResponse(response: OllamaChatResponse): ModelResponse {
    const content = response.message?.content || '';

    // Try to extract tool calls from the content
    const toolCalls = this.extractToolCalls(content);

    return {
      content: toolCalls.length > 0 ? this.removeToolCallsFromContent(content) : content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
      usage:
        response.prompt_eval_count !== undefined && response.eval_count !== undefined
          ? {
              inputTokens: response.prompt_eval_count,
              outputTokens: response.eval_count,
              totalTokens: response.prompt_eval_count + response.eval_count,
            }
          : undefined,
      modelId: this.config.model,
    };
  }

  /**
   * Extract tool calls from response content
   * Ollama models express tool calls in text format
   */
  private extractToolCalls(content: string, tools?: ToolDefinition[]): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    // Look for tool_call code blocks
    const toolCallRegex = /```tool_call\s*\n?([\s\S]*?)\n?```/g;
    let match;

    while ((match = toolCallRegex.exec(content)) !== null) {
      try {
        const toolCallJson = JSON.parse(match[1].trim());
        if (toolCallJson.name && typeof toolCallJson.name === 'string') {
          // Verify tool exists if tools are provided
          if (tools && !tools.some((t) => t.name === toolCallJson.name)) {
            continue;
          }

          toolCalls.push({
            id: `ollama_${Date.now()}_${toolCalls.length}`,
            name: toolCallJson.name,
            arguments: toolCallJson.arguments || {},
          });
        }
      } catch {
        // Invalid JSON, skip
      }
    }

    return toolCalls;
  }

  /**
   * Remove tool call blocks from content
   */
  private removeToolCallsFromContent(content: string): string {
    return content.replace(/```tool_call\s*\n?([\s\S]*?)\n?```/g, '').trim();
  }

  protected override validateConfig(): void {
    super.validateConfig();
    // Ollama doesn't require an API key
  }

  protected override getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }
}
