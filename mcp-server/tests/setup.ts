/**
 * AEGIS MCP Server - Test Setup
 * Global test configuration and mocks
 */

import { vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Global Test Configuration
// ============================================================================

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.AEGIS_LOG_LEVEL = 'error'; // Suppress logs during tests
process.env.AEGIS_BRIDGE_HOST = 'localhost';
process.env.AEGIS_BRIDGE_HTTP_PORT = '30010';
process.env.AEGIS_BRIDGE_WS_PORT = '30020';
process.env.AEGIS_ENABLE_SANDBOX = 'true';
process.env.AEGIS_ENABLE_SAFE_MODE = 'true';

// ============================================================================
// Mock Implementations
// ============================================================================

// Mock fetch for HTTP requests
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock WebSocket
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate connection after a tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  send(data: string): void {
    // Mock send - can be spied on
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code: code || 1000, reason }));
    }
  }
}

(global as any).WebSocket = MockWebSocket;

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock bridge response
 */
export function createMockBridgeResponse(success: boolean, data?: any, error?: string) {
  return {
    success,
    data,
    error,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Setup mock fetch to return specific responses
 */
export function setupMockFetch(responses: Map<string, any>) {
  mockFetch.mockImplementation(async (url: string, options?: any) => {
    const response = responses.get(url);
    if (response) {
      return {
        ok: true,
        status: 200,
        json: async () => response,
        text: async () => JSON.stringify(response),
      };
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
      text: async () => 'Not found',
    };
  });
}

/**
 * Clear all mocks and reset state
 */
export function clearMocks() {
  mockFetch.mockClear();
}

/**
 * Wait for async operations to complete
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Create a mock logger
 */
export function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  };
}

/**
 * Create a mock bridge manager
 */
export function createMockBridge() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    remoteControl: {
      callFunction: vi.fn().mockResolvedValue({ success: true, data: {} }),
      getActors: vi.fn().mockResolvedValue([]),
      spawnActor: vi.fn().mockResolvedValue({ success: true, actorPath: '/Game/Test' }),
      setProperty: vi.fn().mockResolvedValue({ success: true }),
    },
    websocket: {
      send: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
    },
    stateSync: {
      captureState: vi.fn().mockResolvedValue({}),
      restoreState: vi.fn().mockResolvedValue(true),
    },
  };
}

/**
 * Create a mock command context
 */
export function createMockCommandContext(overrides: any = {}) {
  return {
    bridge: createMockBridge(),
    logger: createMockLogger(),
    sandbox: {
      validatePath: vi.fn().mockReturnValue(true),
      checkRateLimit: vi.fn().mockReturnValue(true),
    },
    safeMode: {
      isEnabled: vi.fn().mockReturnValue(false),
      requiresConfirmation: vi.fn().mockReturnValue(false),
    },
    rollback: {
      captureState: vi.fn().mockResolvedValue('snapshot-123'),
      restoreState: vi.fn().mockResolvedValue(true),
    },
    ...overrides,
  };
}

// ============================================================================
// Global Hooks
// ============================================================================

beforeAll(() => {
  // Global setup before all tests
  console.log('Starting AEGIS MCP Server tests...');
});

afterAll(() => {
  // Global cleanup after all tests
  console.log('AEGIS MCP Server tests completed.');
});

beforeEach(() => {
  // Reset mocks before each test
  clearMocks();
});

afterEach(() => {
  // Cleanup after each test
  vi.clearAllTimers();
});

// ============================================================================
// Exports
// ============================================================================

export { mockFetch, MockWebSocket };
