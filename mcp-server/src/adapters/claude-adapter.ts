/**
 * AEGIS Claude Adapter
 * Primary AI model adapter using Anthropic's Claude API
 */

import Anthropic from '@anthropic-ai/sdk';
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

export interface ClaudeAdapterConfig extends ModelAdapterConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ClaudeMessage = Anthropic.Messages.MessageParam;
type ClaudeContentBlock = Anthropic.Messages.ContentBlock;
type ClaudeToolUseBlock = Anthropic.Messages.ToolUseBlock;

// ============================================================================
// Claude Adapter Implementation
// ============================================================================

export class ClaudeAdapter extends BaseModelAdapter {
  private client: Anthropic;

  constructor(config: ClaudeAdapterConfig, logger: Logger) {
    super(
      {
        ...config,
        model: config.model || 'claude-sonnet-4-20250514',
        maxTokens: config.maxTokens || 4096,
        temperature: config.temperature || 0.7,
      },
      logger
    );

    this.validateConfig();
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }

  getModelId(): string {
    return this.config.model;
  }

  getAdapterType(): string {
    return 'claude';
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Simple check - try to list models (or just verify the API key works)
      // For Claude, we'll do a minimal completion to verify
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return response.id !== undefined;
    } catch (error) {
      this.logger.warn('Claude adapter availability check failed', { error });
      return false;
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const timer = this.logger.startTimer();
    this.logRequest(request);

    try {
      const messages = this.formatMessages(request.messages);
      const tools = request.tools ? this.formatTools(request.tools) : undefined;

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        system: request.systemPrompt,
        messages,
        tools: tools as Anthropic.Messages.Tool[],
        stop_sequences: request.stopSequences,
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
      const messages = this.formatMessages(request.messages);
      const tools = request.tools ? this.formatTools(request.tools) : undefined;

      const stream = await this.client.messages.stream({
        model: this.config.model,
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        system: request.systemPrompt,
        messages,
        tools: tools as Anthropic.Messages.Tool[],
        stop_sequences: request.stopSequences,
      });

      let content = '';
      const toolCalls: ToolCall[] = [];
      let currentToolCall: Partial<ToolCall> | null = null;
      let inputJson = '';

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            currentToolCall = {
              id: block.id,
              name: block.name,
              arguments: {},
            };
            inputJson = '';
            callback({
              type: 'tool_call_start',
              toolCall: currentToolCall,
            });
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            content += delta.text;
            callback({
              type: 'text',
              content: delta.text,
            });
          } else if (delta.type === 'input_json_delta') {
            inputJson += delta.partial_json;
            callback({
              type: 'tool_call_delta',
              content: delta.partial_json,
            });
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolCall) {
            try {
              currentToolCall.arguments = inputJson ? JSON.parse(inputJson) : {};
            } catch {
              currentToolCall.arguments = {};
            }
            toolCalls.push(currentToolCall as ToolCall);
            callback({
              type: 'tool_call_end',
              toolCall: currentToolCall,
            });
            currentToolCall = null;
            inputJson = '';
          }
        }
      }

      callback({ type: 'done' });

      const finalMessage = await stream.finalMessage();
      const result: ModelResponse = {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: this.mapStopReason(finalMessage.stop_reason),
        usage: {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
          totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
        },
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

  protected formatTools(tools: ToolDefinition[]): ClaudeTool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  protected parseToolCalls(response: Anthropic.Messages.Message): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ClaudeToolUseBlock;
        toolCalls.push({
          id: toolBlock.id,
          name: toolBlock.name,
          arguments: toolBlock.input as Record<string, unknown>,
        });
      }
    }

    return toolCalls;
  }

  private formatMessages(
    messages: { role: string; content: string }[]
  ): ClaudeMessage[] {
    return messages
      .filter((msg) => msg.role !== 'system') // System is handled separately
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));
  }

  private parseResponse(response: Anthropic.Messages.Message): ModelResponse {
    let content = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      }
    }

    const toolCalls = this.parseToolCalls(response);

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapStopReason(response.stop_reason),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      modelId: this.config.model,
    };
  }

  private mapStopReason(
    reason: string | null
  ): ModelResponse['finishReason'] {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'length';
      default:
        return 'stop';
    }
  }

  protected override validateConfig(): void {
    super.validateConfig();
    if (!this.config.apiKey) {
      throw new Error('Claude adapter requires an API key');
    }
  }

  protected override getHeaders(): Record<string, string> {
    return {
      ...super.getHeaders(),
      'x-api-key': this.config.apiKey!,
      'anthropic-version': '2023-06-01',
    };
  }
}
