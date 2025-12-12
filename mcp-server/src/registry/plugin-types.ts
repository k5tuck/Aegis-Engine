/**
 * AEGIS Plugin Types
 * Defines interfaces for the plugin system
 */

import { z, ZodSchema } from 'zod';
import { Logger } from '../utils/logger.js';
import type { UnrealRemoteControl } from '../ue-bridge/remote-control.js';

// ============================================================================
// Plugin Metadata
// ============================================================================

export interface PluginMetadata {
  /** Unique plugin identifier (e.g., "aegis-worldgen") */
  id: string;

  /** Human-readable plugin name */
  name: string;

  /** Semantic version (e.g., "1.0.0") */
  version: string;

  /** Command namespace (e.g., "aegis.worldgen") */
  namespace: string;

  /** Plugin description */
  description: string;

  /** Plugin author */
  author?: string;

  /** Author website or repository URL */
  authorUrl?: string;

  /** Plugin documentation URL */
  docsUrl?: string;

  /** Plugin dependencies */
  dependencies?: PluginDependency[];

  /** Minimum AEGIS version required */
  minAegisVersion?: string;

  /** Whether the plugin supports runtime (in-game) execution */
  supportsRuntime: boolean;

  /** Plugin tags for categorization */
  tags?: string[];

  /** Plugin license */
  license?: string;

  /** Plugin icon path (relative to plugin) */
  icon?: string;
}

export interface PluginDependency {
  /** Dependent plugin ID */
  pluginId: string;

  /** Minimum version required */
  minVersion?: string;

  /** Maximum version supported */
  maxVersion?: string;

  /** Whether the dependency is optional */
  optional?: boolean;
}

// ============================================================================
// Command Definitions
// ============================================================================

export interface CommandAnnotations {
  /** Command does not modify any state */
  readOnly: boolean;

  /** Command can cause data loss or is destructive */
  destructive: boolean;

  /** Calling multiple times produces the same result */
  idempotent: boolean;

  /** Command affects external systems */
  openWorld: boolean;

  /** Estimated execution time in milliseconds */
  estimatedDuration?: number;

  /** Risk level for safe mode assessment */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  /** Requires user approval in safe mode */
  requiresApproval: boolean;

  /** Can run during gameplay (not just in editor) */
  runtimeCapable: boolean;

  /** Maximum time allowed for execution */
  timeout?: number;

  /** Custom annotations */
  custom?: Record<string, unknown>;
}

export interface CommandContext {
  /** Logger instance */
  logger: Logger;

  /** Unreal Engine client */
  ueClient: UnrealRemoteControl;

  /** Current session ID */
  sessionId: string;

  /** Current user ID (if authenticated) */
  userId?: string;

  /** Whether safe mode is enabled */
  safeModeEnabled: boolean;

  /** Request ID for tracing */
  requestId: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface CommandDefinition<TParams = unknown, TResult = unknown> {
  /** Command name (without namespace) */
  name: string;

  /** Full command description for AI */
  description: string;

  /** Short description for listings */
  shortDescription: string;

  /** Zod schema for parameter validation */
  paramsSchema: ZodSchema<TParams>;

  /** Zod schema for result validation (optional) */
  resultSchema?: ZodSchema<TResult>;

  /** Command annotations */
  annotations: CommandAnnotations;

  /** Example usage */
  examples?: CommandExample[];

  /** Aliases for this command */
  aliases?: string[];

  /** Command execution function */
  execute: (params: TParams, context: CommandContext) => Promise<TResult>;

  /** Pre-execution hook (for state capture, etc.) */
  beforeExecute?: (params: TParams, context: CommandContext) => Promise<void>;

  /** Post-execution hook */
  afterExecute?: (params: TParams, result: TResult, context: CommandContext) => Promise<void>;

  /** Change analyzer for safe mode preview */
  analyzeChanges?: (
    params: TParams,
    context: CommandContext
  ) => Promise<Array<{
    type: 'create' | 'modify' | 'delete' | 'move';
    target: string;
    description: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }>>;
}

export interface CommandExample {
  /** Example description */
  description: string;

  /** Example parameters */
  params: Record<string, unknown>;

  /** Expected result (for documentation) */
  expectedResult?: Record<string, unknown>;
}

// ============================================================================
// Plugin Interface
// ============================================================================

export interface AegisPlugin {
  /** Plugin metadata */
  metadata: PluginMetadata;

  /** Plugin commands */
  commands: CommandDefinition[];

  /** Called when plugin is loaded */
  onLoad?: (context: PluginLoadContext) => Promise<void>;

  /** Called when plugin is unloaded */
  onUnload?: (context: PluginLoadContext) => Promise<void>;

  /** Health check function */
  healthCheck?: () => Promise<PluginHealthStatus>;

  /** Called when configuration changes */
  onConfigChange?: (newConfig: Record<string, unknown>) => Promise<void>;

  /** Plugin-specific resources */
  resources?: PluginResource[];

  /** Event handlers */
  eventHandlers?: PluginEventHandler[];
}

export interface PluginLoadContext {
  /** Logger instance */
  logger: Logger;

  /** Unreal Engine client */
  ueClient?: UnrealRemoteControl;

  /** Plugin configuration */
  config?: Record<string, unknown>;

  /** AEGIS version */
  aegisVersion: string;

  /** Plugin directory path */
  pluginPath: string;
}

export interface PluginHealthStatus {
  /** Overall health status */
  healthy: boolean;

  /** Status message */
  message?: string;

  /** Component-level status */
  components?: Record<string, boolean>;

  /** Last check timestamp */
  checkedAt: string;
}

export interface PluginResource {
  /** Resource type */
  type: 'asset' | 'schema' | 'template' | 'documentation';

  /** Resource name */
  name: string;

  /** Resource path (relative to plugin) */
  path: string;

  /** Resource description */
  description?: string;
}

export interface PluginEventHandler {
  /** Event name */
  event: string;

  /** Handler function */
  handler: (eventData: unknown, context: CommandContext) => Promise<void>;
}

// ============================================================================
// Registration Types
// ============================================================================

export interface RegisteredCommand {
  /** Full command name (namespace.name) */
  fullName: string;

  /** Command namespace */
  namespace: string;

  /** Local command name */
  localName: string;

  /** Source plugin */
  plugin: AegisPlugin;

  /** Command definition */
  definition: CommandDefinition;

  /** Registration timestamp */
  registeredAt: Date;

  /** Whether the command is enabled */
  enabled: boolean;
}

export interface RegisteredPlugin {
  /** Plugin instance */
  plugin: AegisPlugin;

  /** Plugin file path */
  path: string;

  /** Load timestamp */
  loadedAt: Date;

  /** Last reload timestamp */
  lastReloadedAt?: Date;

  /** Plugin status */
  status: PluginStatus;

  /** Error message if status is error */
  error?: string;

  /** Registered commands count */
  commandCount: number;
}

export type PluginStatus = 'loading' | 'loaded' | 'unloading' | 'unloaded' | 'error' | 'disabled';

// ============================================================================
// Plugin Configuration Schema
// ============================================================================

export const PluginMetadataSchema = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/i),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  namespace: z.string().min(1).regex(/^[a-z][a-z0-9.]*$/i),
  description: z.string(),
  author: z.string().optional(),
  authorUrl: z.string().url().optional(),
  docsUrl: z.string().url().optional(),
  dependencies: z
    .array(
      z.object({
        pluginId: z.string(),
        minVersion: z.string().optional(),
        maxVersion: z.string().optional(),
        optional: z.boolean().optional(),
      })
    )
    .optional(),
  minAegisVersion: z.string().optional(),
  supportsRuntime: z.boolean(),
  tags: z.array(z.string()).optional(),
  license: z.string().optional(),
  icon: z.string().optional(),
});

export const CommandAnnotationsSchema = z.object({
  readOnly: z.boolean().default(false),
  destructive: z.boolean().default(false),
  idempotent: z.boolean().default(true),
  openWorld: z.boolean().default(false),
  estimatedDuration: z.number().positive().optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  requiresApproval: z.boolean().default(false),
  runtimeCapable: z.boolean().default(false),
  timeout: z.number().positive().optional(),
  custom: z.record(z.unknown()).optional(),
});

// ============================================================================
// Type Guards
// ============================================================================

export function isAegisPlugin(obj: unknown): obj is AegisPlugin {
  if (!obj || typeof obj !== 'object') return false;
  const plugin = obj as AegisPlugin;
  return (
    typeof plugin.metadata === 'object' &&
    typeof plugin.metadata.id === 'string' &&
    typeof plugin.metadata.namespace === 'string' &&
    Array.isArray(plugin.commands)
  );
}

export function isCommandDefinition(obj: unknown): obj is CommandDefinition {
  if (!obj || typeof obj !== 'object') return false;
  const cmd = obj as CommandDefinition;
  return (
    typeof cmd.name === 'string' &&
    typeof cmd.description === 'string' &&
    typeof cmd.execute === 'function' &&
    cmd.paramsSchema !== undefined &&
    typeof cmd.annotations === 'object'
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

export function createCommandAnnotations(
  overrides?: Partial<CommandAnnotations>
): CommandAnnotations {
  return {
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
    riskLevel: 'low',
    requiresApproval: false,
    runtimeCapable: false,
    ...overrides,
  };
}

export function getFullCommandName(namespace: string, commandName: string): string {
  return `${namespace}.${commandName}`;
}

export function parseCommandName(fullName: string): { namespace: string; localName: string } {
  const lastDot = fullName.lastIndexOf('.');
  if (lastDot === -1) {
    return { namespace: '', localName: fullName };
  }
  return {
    namespace: fullName.substring(0, lastDot),
    localName: fullName.substring(lastDot + 1),
  };
}
