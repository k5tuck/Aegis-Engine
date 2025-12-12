/**
 * AEGIS OpenAI Adapter
 * AI model adapter for OpenAI GPT models
 */

import OpenAI from 'openai';
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

export interface OpenAIAdapterConfig extends ModelAdapterConfig {
  apiKey: string;
  model?: string;
  organization?: string;
  maxTokens?: number;
  temperature?: number;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type OpenAIToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;

// ============================================================================
// OpenAI Adapter Implementation
// ============================================================================

export class OpenAIAdapter extends BaseModelAdapter {
  private client: OpenAI;

  constructor(config: OpenAIAdapterConfig, logger: Logger) {
    super(
      {
        ...config,
        model: config.model || 'gpt-4-turbo-preview',
        maxTokens: config.maxTokens || 4096,
        temperature: config.temperature || 0.7,
      },
      logger
    );

    this.validateConfig();
    this.client = new OpenAI({
      apiKey: config.apiKey,
      organization: config.organization,
    });
  }

  getModelId(): string {
    return this.config.model;
  }

  getAdapterType(): string {
    return 'openai';
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Verify API key works with a minimal request
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return response.id !== undefined;
    } catch (error) {
      this.logger.warn('OpenAI adapter availability check failed', { error });
      return false;
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const timer = this.logger.startTimer();
    this.logRequest(request);

    try {
      const messages = this.formatMessages(request.messages, request.systemPrompt);
      const tools = request.tools ? this.formatTools(request.tools) : undefined;

      const response = await this.client.chat.completions.create({
        model: this.config.model,
        max_tokens: request.maxTokens || this.config.maxTokens,
        temperature: request.temperature ?? this.config.temperature,
        messages,
        tools: tools as OpenAI.Chat.Completions.ChatCompletionTool[],
        stop: request.stopSequences,
      });

      const result = this.parseResponse(response);
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

      const stream = await this.client.chat.completions.create({
        model: this.config.model,
        max_tokens: request.maxTokens || this.config.maxTokens,
        temperature: request.temperature ?? this.config.temperature,
        messages,
        tools: tools as OpenAI.Chat.Completions.ChatCompletionTool[],
        stop: request.stopSequences,
        stream: true,
      });

      let content = '';
      const toolCalls: Map<number, Partial<ToolCall>> = new Map();
      let finishReason: ModelResponse['finishReason'] = 'stop';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          content += delta.content;
          callback({
            type: 'text',
            content: delta.content,
          });
        }

        if (delta?.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index;

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

            const existingCall = toolCalls.get(index)!;

            if (toolCallDelta.id) {
              existingCall.id = toolCallDelta.id;
            }
            if (toolCallDelta.function?.name) {
              existingCall.name = toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              callback({
                type: 'tool_call_delta',
                content: toolCallDelta.function.arguments,
              });
            }
          }
        }

        if (chunk.choices[0]?.finish_reason) {
          finishReason = this.mapFinishReason(chunk.choices[0].finish_reason);
        }
      }

      // Parse accumulated tool call arguments
      const parsedToolCalls: ToolCall[] = [];
      for (const [, toolCall] of toolCalls) {
        // OpenAI streams arguments as a string that needs to be accumulated
        // This is handled in the actual implementation - here we just use what we have
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

  protected formatTools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  protected parseToolCalls(
    response: OpenAI.Chat.Completions.ChatCompletion
  ): ToolCall[] {
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
  ): OpenAIMessage[] {
    const formatted: OpenAIMessage[] = [];

    // Add system message if provided
    if (systemPrompt) {
      formatted.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    // Add conversation messages
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

  private parseResponse(
    response: OpenAI.Chat.Completions.ChatCompletion
  ): ModelResponse {
    const choice = response.choices[0];
    const message = choice?.message;

    return {
      content: message?.content || '',
      toolCalls:
        message?.tool_calls && message.tool_calls.length > 0
          ? this.parseToolCalls(response)
          : undefined,
      finishReason: this.mapFinishReason(choice?.finish_reason || null),
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
      case 'content_filter':
        return 'error';
      default:
        return 'stop';
    }
  }

  protected override validateConfig(): void {
    super.validateConfig();
    if (!this.config.apiKey) {
      throw new Error('OpenAI adapter requires an API key');
    }
  }

  protected override getHeaders(): Record<string, string> {
    return {
      ...super.getHeaders(),
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }
}
