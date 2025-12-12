/**
 * AEGIS WebSocket Client
 * Real-time communication with Unreal Engine via WebSocket
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { UnrealConnectionError } from '../utils/errors.js';

// ============================================================================
// Types
// ============================================================================

export interface WebSocketConfig {
  /** Unreal Engine host */
  host: string;

  /** WebSocket port */
  wsPort: number;

  /** Reconnect automatically on disconnect */
  autoReconnect: boolean;

  /** Maximum reconnect attempts */
  maxReconnectAttempts: number;

  /** Reconnect delay in ms */
  reconnectDelayMs: number;

  /** Reconnect delay multiplier for backoff */
  reconnectBackoffMultiplier: number;

  /** Maximum reconnect delay */
  maxReconnectDelayMs: number;

  /** Ping interval in ms */
  pingIntervalMs: number;

  /** Pong timeout in ms */
  pongTimeoutMs: number;

  /** Message queue size when disconnected */
  messageQueueSize: number;
}

export interface WebSocketMessage {
  type: string;
  requestId?: string;
  payload?: unknown;
  timestamp?: number;
}

export interface WebSocketEvent {
  type: string;
  data: unknown;
  timestamp: Date;
}

export type WebSocketEventType =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error'
  | 'message'
  | 'actor_spawned'
  | 'actor_deleted'
  | 'actor_modified'
  | 'property_changed'
  | 'level_loaded'
  | 'level_saved'
  | 'selection_changed'
  | 'blueprint_compiled'
  | 'asset_imported'
  | 'pcg_executed'
  | 'transaction_started'
  | 'transaction_ended';

export interface PendingRequest {
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: WebSocketConfig = {
  host: 'localhost',
  wsPort: 30021,
  autoReconnect: true,
  maxReconnectAttempts: 10,
  reconnectDelayMs: 1000,
  reconnectBackoffMultiplier: 1.5,
  maxReconnectDelayMs: 30000,
  pingIntervalMs: 30000,
  pongTimeoutMs: 10000,
  messageQueueSize: 100,
};

// ============================================================================
// WebSocket Client Implementation
// ============================================================================

export class UnrealWebSocketClient extends EventEmitter {
  private config: WebSocketConfig;
  private logger: Logger;
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private messageQueue: WebSocketMessage[] = [];
  private eventSubscriptions: Map<string, Set<(event: WebSocketEvent) => void>> = new Map();
  private lastMessageTime: Date | null = null;

  constructor(config: Partial<WebSocketConfig>, logger: Logger) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger.child({ component: 'UnrealWebSocket' });
    this.wsUrl = `ws://${this.config.host}:${this.config.wsPort}`;
  }

  /**
   * Connect to Unreal Engine WebSocket server
   */
  async connect(): Promise<void> {
    if (this.ws && this.connected) {
      this.logger.warn('Already connected');
      return;
    }

    return new Promise((resolve, reject) => {
      this.logger.info('Connecting to WebSocket', { url: this.wsUrl });

      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          this.handleOpen();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          this.handleClose(code, reason.toString());
        });

        this.ws.on('error', (error: Error) => {
          this.handleError(error);
          if (!this.connected) {
            reject(error);
          }
        });

        this.ws.on('pong', () => {
          this.handlePong();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from WebSocket');

    // Stop reconnection attempts
    this.stopReconnecting();

    // Stop ping
    this.stopPing();

    // Clear pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('WebSocket disconnected'));
    }
    this.pendingRequests.clear();

    // Close connection
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.connected = false;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get last message time
   */
  getLastMessageTime(): Date | null {
    return this.lastMessageTime;
  }

  /**
   * Send a message and wait for response
   */
  async sendRequest<T = unknown>(
    type: string,
    payload?: unknown,
    timeoutMs: number = 30000
  ): Promise<T> {
    const requestId = this.generateRequestId();

    const message: WebSocketMessage = {
      type,
      requestId,
      payload,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timeout });

      this.send(message);
    });
  }

  /**
   * Send a message without waiting for response
   */
  send(message: WebSocketMessage): void {
    if (!this.isConnected()) {
      // Queue message if not connected
      if (this.messageQueue.length < this.config.messageQueueSize) {
        this.messageQueue.push(message);
        this.logger.debug('Message queued', { type: message.type, queueSize: this.messageQueue.length });
      } else {
        this.logger.warn('Message queue full, dropping message', { type: message.type });
      }
      return;
    }

    const data = JSON.stringify(message);
    this.ws!.send(data);

    this.logger.debug('Message sent', { type: message.type, requestId: message.requestId });
  }

  /**
   * Subscribe to an event type
   */
  subscribe(eventType: WebSocketEventType, handler: (event: WebSocketEvent) => void): () => void {
    let handlers = this.eventSubscriptions.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.eventSubscriptions.set(eventType, handlers);
    }

    handlers.add(handler);

    // Send subscription message to server
    this.send({
      type: 'subscribe',
      payload: { eventType },
    });

    // Return unsubscribe function
    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        this.eventSubscriptions.delete(eventType);

        // Send unsubscription message
        this.send({
          type: 'unsubscribe',
          payload: { eventType },
        });
      }
    };
  }

  /**
   * Subscribe to actor changes
   */
  subscribeToActor(actorPath: string, handler: (event: WebSocketEvent) => void): () => void {
    this.send({
      type: 'watch_actor',
      payload: { actorPath },
    });

    const actorHandler = (event: WebSocketEvent) => {
      const data = event.data as { actorPath?: string };
      if (data.actorPath === actorPath) {
        handler(event);
      }
    };

    const unsubModified = this.subscribe('actor_modified', actorHandler);
    const unsubDeleted = this.subscribe('actor_deleted', actorHandler);

    return () => {
      unsubModified();
      unsubDeleted();

      this.send({
        type: 'unwatch_actor',
        payload: { actorPath },
      });
    };
  }

  /**
   * Subscribe to property changes
   */
  subscribeToProperty(
    objectPath: string,
    propertyName: string,
    handler: (event: WebSocketEvent) => void
  ): () => void {
    this.send({
      type: 'watch_property',
      payload: { objectPath, propertyName },
    });

    const propHandler = (event: WebSocketEvent) => {
      const data = event.data as { objectPath?: string; propertyName?: string };
      if (data.objectPath === objectPath && data.propertyName === propertyName) {
        handler(event);
      }
    };

    const unsub = this.subscribe('property_changed', propHandler);

    return () => {
      unsub();

      this.send({
        type: 'unwatch_property',
        payload: { objectPath, propertyName },
      });
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private handleOpen(): void {
    this.logger.info('WebSocket connected');
    this.connected = true;
    this.reconnectAttempts = 0;

    // Start ping
    this.startPing();

    // Flush message queue
    this.flushMessageQueue();

    // Re-subscribe to events
    this.resubscribeEvents();

    // Emit connected event
    this.emit('connected');
  }

  private handleMessage(data: WebSocket.Data): void {
    this.lastMessageTime = new Date();

    try {
      const message = JSON.parse(data.toString()) as WebSocketMessage;

      this.logger.debug('Message received', { type: message.type, requestId: message.requestId });

      // Check if this is a response to a pending request
      if (message.requestId && this.pendingRequests.has(message.requestId)) {
        const pending = this.pendingRequests.get(message.requestId)!;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.requestId);

        if (message.type === 'error') {
          pending.reject(new Error(String(message.payload)));
        } else {
          pending.resolve(message.payload);
        }
        return;
      }

      // Handle event message
      const event: WebSocketEvent = {
        type: message.type,
        data: message.payload,
        timestamp: new Date(message.timestamp || Date.now()),
      };

      // Notify subscribers
      const handlers = this.eventSubscriptions.get(message.type as WebSocketEventType);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(event);
          } catch (error) {
            this.logger.error('Event handler error', error as Error, { type: message.type });
          }
        }
      }

      // Emit generic message event
      this.emit('message', event);
    } catch (error) {
      this.logger.error('Failed to parse WebSocket message', error as Error);
    }
  }

  private handleClose(code: number, reason: string): void {
    this.logger.info('WebSocket closed', { code, reason });
    this.connected = false;

    // Stop ping
    this.stopPing();

    // Emit disconnected event
    this.emit('disconnected', { code, reason });

    // Attempt reconnect if enabled
    if (this.config.autoReconnect && code !== 1000) {
      this.scheduleReconnect();
    }
  }

  private handleError(error: Error): void {
    this.logger.error('WebSocket error', error);
    this.emit('error', error);
  }

  private handlePong(): void {
    this.logger.debug('Pong received');

    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.isConnected()) {
        this.ws!.ping();

        // Set pong timeout
        this.pongTimer = setTimeout(() => {
          this.logger.warn('Pong timeout, connection may be dead');
          this.ws?.terminate();
        }, this.config.pongTimeoutMs);
      }
    }, this.config.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached');
      this.emit('error', new UnrealConnectionError(
        'Max reconnect attempts reached',
        this.config.host,
        this.config.wsPort
      ));
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.config.reconnectDelayMs *
        Math.pow(this.config.reconnectBackoffMultiplier, this.reconnectAttempts),
      this.config.maxReconnectDelayMs
    );

    this.logger.info('Scheduling reconnect', {
      attempt: this.reconnectAttempts + 1,
      maxAttempts: this.config.maxReconnectAttempts,
      delay,
    });

    this.emit('reconnecting', {
      attempt: this.reconnectAttempts + 1,
      maxAttempts: this.config.maxReconnectAttempts,
      delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;

      try {
        await this.connect();
      } catch (error) {
        this.logger.warn('Reconnect attempt failed', { attempt: this.reconnectAttempts });
        this.scheduleReconnect();
      }
    }, delay);
  }

  private stopReconnecting(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  private flushMessageQueue(): void {
    if (this.messageQueue.length === 0) {
      return;
    }

    this.logger.info('Flushing message queue', { count: this.messageQueue.length });

    const queue = [...this.messageQueue];
    this.messageQueue = [];

    for (const message of queue) {
      this.send(message);
    }
  }

  private resubscribeEvents(): void {
    // Re-send subscription messages for all subscribed event types
    for (const eventType of this.eventSubscriptions.keys()) {
      this.send({
        type: 'subscribe',
        payload: { eventType },
      });
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createUnrealWebSocketClient(
  config: Partial<WebSocketConfig>,
  logger: Logger
): UnrealWebSocketClient {
  return new UnrealWebSocketClient(config, logger);
}

// ============================================================================
// Event Types for TypeScript
// ============================================================================

export interface UnrealWebSocketEvents {
  connected: [];
  disconnected: [{ code: number; reason: string }];
  reconnecting: [{ attempt: number; maxAttempts: number; delay: number }];
  error: [Error];
  message: [WebSocketEvent];
}

declare module 'events' {
  interface EventEmitter {
    on<K extends keyof UnrealWebSocketEvents>(
      event: K,
      listener: (...args: UnrealWebSocketEvents[K]) => void
    ): this;
    emit<K extends keyof UnrealWebSocketEvents>(
      event: K,
      ...args: UnrealWebSocketEvents[K]
    ): boolean;
  }
}
