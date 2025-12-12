/**
 * AEGIS DeepSeek Adapter
 * AI model adapter for DeepSeek models
 * DeepSeek uses an OpenAI-compatible API
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
} from './base-adapter.js';
import { Logger } from '../utils/logger.js';
import { ModelAdapterError } from '../utils/errors.js';

// ============================================================================
// Types
// ============================================================================

export interface DeepSeekAdapterConfig extends ModelAdapterConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

interface DeepSeekTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: DeepSeekToolCall[];
  tool_call_id?: string;
}

interface DeepSeekToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepSeekChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface DeepSeekChoice {
  index: number;
  message: DeepSeekMessage;
  finish_reason: string | null;
}

interface DeepSeekStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepSeekStreamChoice[];
}

interface DeepSeekStreamChoice {
  index: number;
  delta: Partial<DeepSeekMessage>;
  finish_reason: string | null;
}

// ============================================================================
// DeepSeek Adapter Implementation
// ============================================================================

export class DeepSeekAdapter extends BaseModelAdapter {
  private baseUrl: string;

  constructor(config: DeepSeekAdapterConfig, logger: Logger) {
    super(
      {
        ...config,
        model: config.model || 'deepseek-chat',
        maxTokens: config.maxTokens || 4096,
        temperature: config.temperature || 0.7,
      },
      logger
    );

    this.baseUrl = config.baseUrl || 'https://api.deepseek.com';
    this.validateConfig();
  }

  getModelId(): string {
    return this.config.model;
  }

  getAdapterType(): string {
    return 'deepseek';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      return response.ok;
    } catch (error) {
      this.logger.warn('DeepSeek adapter availability check failed', { error });
      return false;
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const timer = this.logger.startTimer();
    this.logRequest(request);

    try {
      const messages = this.formatMessages(request.messages, request.systemPrompt);
      const tools = request.tools ? this.formatTools(request.tools) : undefined;

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: request.maxTokens || this.config.maxTokens,
          temperature: request.temperature ?? this.config.temperature,
          messages,
          tools,
          stop: request.stopSequences,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as DeepSeekResponse;
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
      const messages = this.formatMessages(request.messages, request.systemPrompt);
      const tools = request.tools ? this.formatTools(request.tools) : undefined;

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: request.maxTokens || this.config.maxTokens,
          temperature: request.temperature ?? this.config.temperature,
          messages,
          tools,
          stop: request.stopSequences,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let content = '';
      const toolCalls: Map<number, Partial<ToolCall>> = new Map();
      let finishReason: ModelResponse['finishReason'] = 'stop';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6)) as DeepSeekStreamChunk;
            const delta = data.choices[0]?.delta;

            if (delta?.content) {
              content += delta.content;
              callback({
                type: 'text',
                content: delta.content,
              });
            }

            if (delta?.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.id ? 0 : toolCalls.size;

                if (!toolCalls.has(index)) {
                  toolCalls.set(index, {
                    id: toolCallDelta.id || '',
                    name: toolCallDelta.function?.name || '',
                    arguments: {},
                  });
                  callback({
                    type: 'tool_call_start',
                    toolCall: toolCalls.get(index),
                  });
                }

                if (toolCallDelta.function?.arguments) {
                  callback({
                    type: 'tool_call_delta',
                    content: toolCallDelta.function.arguments,
                  });
                }
              }
            }

            if (data.choices[0]?.finish_reason) {
              finishReason = this.mapFinishReason(data.choices[0].finish_reason);
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Finalize tool calls
      const parsedToolCalls: ToolCall[] = [];
      for (const [, toolCall] of toolCalls) {
        callback({
          type: 'tool_call_end',
          toolCall,
        });
        if (toolCall.id && toolCall.name) {
          parsedToolCalls.push(toolCall as ToolCall);
        }
      }

      callback({ type: 'done' });

      const result: ModelResponse = {
        content,
        toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
        finishReason,
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

  protected formatTools(tools: ToolDefinition[]): DeepSeekTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  protected parseToolCalls(response: DeepSeekResponse): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const message = response.choices[0]?.message;

    if (message?.tool_calls) {
      for (const toolCall of message.tool_calls) {
        toolCalls.push({
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: this.parseArguments(toolCall.function.arguments),
        });
      }
    }

    return toolCalls;
  }

  private formatMessages(
    messages: { role: string; content: string }[],
    systemPrompt?: string
  ): DeepSeekMessage[] {
    const formatted: DeepSeekMessage[] = [];

    if (systemPrompt) {
      formatted.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    for (const msg of messages) {
      if (msg.role === 'system' && !systemPrompt) {
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

  private parseResponse(response: DeepSeekResponse): ModelResponse {
    const choice = response.choices[0];
    const message = choice?.message;

    return {
      content: message?.content || '',
      toolCalls:
        message?.tool_calls && message.tool_calls.length > 0
          ? this.parseToolCalls(response)
          : undefined,
      finishReason: this.mapFinishReason(choice?.finish_reason),
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
      modelId: this.config.model,
    };
  }

  private parseArguments(args: string): Record<string, unknown> {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }

  private mapFinishReason(
    reason: string | null
  ): ModelResponse['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'length';
      default:
        return 'stop';
    }
  }

  protected override validateConfig(): void {
    super.validateConfig();
    if (!this.config.apiKey) {
      throw new Error('DeepSeek adapter requires an API key');
    }
  }

  protected override getHeaders(): Record<string, string> {
    return {
      ...super.getHeaders(),
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }
}
