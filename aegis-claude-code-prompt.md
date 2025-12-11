# Claude Code Prompt: Unreal Engine AI Assistant (MCP-Powered)

## Project Codename: **AEGIS** (AI Engine Game Intelligence System)

---

## 🎯 Project Vision

Build a **production-ready MCP-powered Unreal Engine AI Assistant** that combines:
- Epic's official AI Assistant's **suggestion quality and UX**
- Open-source MCP projects' **action execution capabilities**
- A **"safe mode"** with preview-before-execution
- **Claude-first** architecture with multi-model support
- **Unified AI command schema** for consistent intents across models
- Enterprise-grade **security and sandboxing**

**Target Audience**: Indie UE developers who want an AI assistant that doesn't just advise—it *executes*.

---

## 📦 Phase 0: Project Setup & Reference Cloning

### Step 1: Clone Reference MCP Projects

```bash
# Create workspace
mkdir -p ~/projects/aegis
cd ~/projects/aegis

# Clone reference MCP implementations
mkdir -p references
cd references

# 1. ChiR24/Unreal_mcp - General MCP server (Remote Control API)
git clone https://github.com/ChiR24/Unreal_mcp.git

# 2. chongdashu/unreal-mcp - Natural language control (spawn, blueprints, camera)
git clone https://github.com/chongdashu/unreal-mcp.git

# 3. flopperam/unreal-engine-mcp - Advanced world/scene generation
git clone https://github.com/flopperam/unreal-engine-mcp.git

# 4. kevinpbuckley/VibeUE - Most comprehensive (167 actions)
git clone https://github.com/kevinpbuckley/VibeUE.git

cd ..
```

### Step 2: Clone Forked Unreal Engine

```bash
# Clone your UE fork (requires Epic Games account linked to GitHub)
git clone https://github.com/k5tuck/UnrealEngine.git --branch 5.4 --single-branch

# Note: This is a large repo (~20GB). If bandwidth is limited:
# git clone --depth 1 https://github.com/k5tuck/UnrealEngine.git --branch 5.4
```

### Step 3: Initialize AEGIS Project Structure

```bash
cd ~/projects/aegis

# Create project structure
mkdir -p mcp-server/src/{adapters,tools,schema,execution,feedback,ue-bridge,utils,config,registry,plugins,seed-protocol}
mkdir -p mcp-server/tests/{unit,integration,e2e}
mkdir -p ue-plugin/Source/{AegisEditor/{Public,Private},AegisRuntime/{Public,Private}}
mkdir -p ue-plugin/{Resources,Config}
mkdir -p docs/{api,guides,architecture}
mkdir -p shared/schemas
```


---

## 🏗️ Phase 1: Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AEGIS ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Unreal Engine Editor                        │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │              AEGIS Editor Plugin (C++)                  │  │  │
│  │  │  ┌──────────┐  ┌───────────┐  ┌─────────────────────┐ │  │  │
│  │  │  │ Chat     │  │ Preview   │  │ Settings Panel      │ │  │  │
│  │  │  │ Interface│  │ Panel     │  │ (Safe Mode Toggle)  │ │  │  │
│  │  │  └──────────┘  └───────────┘  └─────────────────────┘ │  │  │
│  │  │           │           │                │               │  │  │
│  │  │           └───────────┴────────────────┘               │  │  │
│  │  │                       │                                 │  │  │
│  │  │                       ▼                                 │  │  │
│  │  │              ┌─────────────────┐                       │  │  │
│  │  │              │ MCP HTTP Client │                       │  │  │
│  │  │              └─────────────────┘                       │  │  │
│  │  └────────────────────────│───────────────────────────────┘  │  │
│  │                           │                                   │  │
│  │  ┌────────────────────────▼───────────────────────────────┐  │  │
│  │  │              Remote Control API Plugin                  │  │  │
│  │  │         (Built-in UE5 - Enable in Project Settings)     │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                │                                     │
│                                │ HTTP/WebSocket (:30020)             │
│                                ▼                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    AEGIS MCP Server (TypeScript)              │  │
│  │                                                                │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │                    Tool Registry                         │ │  │
│  │  │  ┌───────┐ ┌─────────┐ ┌───────┐ ┌────────┐ ┌────────┐ │ │  │
│  │  │  │ Actor │ │Blueprint│ │ Asset │ │ Level  │ │Material│ │ │  │
│  │  │  │ Tools │ │  Tools  │ │ Tools │ │ Tools  │ │ Tools  │ │ │  │
│  │  │  └───────┘ └─────────┘ └───────┘ └────────┘ └────────┘ │ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
│  │                           │                                   │  │
│  │  ┌────────────────────────▼────────────────────────────────┐ │  │
│  │  │              Unified Command Schema (Zod)                │ │  │
│  │  │  (Model-agnostic, versioned, extensible)                 │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │                    Model Adapters                         │ │  │
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐ │ │  │
│  │  │  │ Claude  │  │  GPT    │  │ DeepSeek│  │ Local       │ │ │  │
│  │  │  │ (Primary)│  │         │  │         │  │ (Ollama)    │ │ │  │
│  │  │  └─────────┘  └─────────┘  └─────────┘  └─────────────┘ │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Components to Build

1. **MCP Server (TypeScript)**: Handles AI model communication and action orchestration
2. **UE Plugin (C++)**: In-editor UI panel with Slate, connects to MCP via HTTP
3. **Shared Command Schema**: JSON Schema definitions for all AI commands
4. **Model Adapters**: Claude-first, with OpenAI/DeepSeek/Ollama support
5. **Safe Mode System**: Preview → Approve → Execute pipeline
6. **Security Sandbox**: Permission system, action allowlisting, rollback capability
7. **Error Feedback Loop**: Structured error responses for AI refinement


---

## 🔧 Phase 2: MCP Server Implementation

### Directory Structure

```
aegis/mcp-server/
├── src/
│   ├── index.ts                 # Server entry point
│   ├── server.ts                # MCP server setup (streamable HTTP)
│   ├── config/
│   │   ├── index.ts
│   │   └── environment.ts       # Environment configuration
│   ├── adapters/
│   │   ├── index.ts             # Adapter exports
│   │   ├── base-adapter.ts      # Abstract adapter interface
│   │   ├── claude-adapter.ts    # Claude API integration (primary)
│   │   ├── openai-adapter.ts    # OpenAI compatibility
│   │   ├── deepseek-adapter.ts  # DeepSeek support
│   │   └── ollama-adapter.ts    # Local model support
│   ├── tools/
│   │   ├── index.ts             # Tool registry
│   │   ├── actor-tools.ts       # Spawn, modify, delete actors
│   │   ├── blueprint-tools.ts   # Blueprint operations
│   │   ├── asset-tools.ts       # Asset management
│   │   ├── level-tools.ts       # Level operations
│   │   ├── material-tools.ts    # Material system
│   │   ├── sequencer-tools.ts   # Sequencer control
│   │   └── project-tools.ts     # Project queries
│   ├── schema/
│   │   ├── commands.ts          # Unified command definitions
│   │   ├── validators.ts        # Zod schemas for validation
│   │   └── responses.ts         # Response type definitions
│   ├── execution/
│   │   ├── executor.ts          # Action execution engine
│   │   ├── safe-mode.ts         # Preview/approval pipeline
│   │   ├── rollback.ts          # Undo/rollback system
│   │   └── sandbox.ts           # Security sandbox
│   ├── feedback/
│   │   ├── error-handler.ts     # Structured error handling
│   │   ├── loop-manager.ts      # AI refinement loop
│   │   └── interpretability.ts  # Developer-friendly messages
│   ├── ue-bridge/
│   │   ├── remote-control.ts    # UE Remote Control API client
│   │   ├── websocket.ts         # Real-time UE connection
│   │   └── state-sync.ts        # Editor state synchronization
│   ├── registry/
│   │   ├── index.ts             # Registry exports
│   │   ├── command-registry.ts  # Core registry implementation
│   │   ├── plugin-loader.ts     # Hot-reload plugin system
│   │   ├── namespace-router.ts  # Namespace resolution
│   │   ├── validation-pipeline.ts # Unified Zod pipeline
│   │   └── plugin-types.ts      # Plugin interface definitions
│   ├── plugins/
│   │   ├── core/                # aegis.core.* commands
│   │   ├── worldgen/            # aegis.worldgen.* commands
│   │   ├── director/            # aegis.director.* commands
│   │   ├── security/            # aegis.security.* commands
│   │   ├── npc/                 # aegis.npc.* commands
│   │   ├── economy/             # aegis.economy.* commands
│   │   ├── narrative/           # aegis.narrative.* commands
│   │   └── custom/              # User plugins loaded here
│   ├── seed-protocol/
│   │   ├── index.ts             # Protocol exports
│   │   ├── identity/            # GUID system
│   │   ├── schemas/             # Data schemas
│   │   ├── connector/           # Platform connectors
│   │   ├── sync/                # Data synchronization
│   │   └── telemetry/           # Event emission
│   └── utils/
│       ├── logger.ts            # Structured logging (pino)
│       ├── errors.ts            # Custom error classes
│       └── helpers.ts           # Utility functions
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── package.json
├── tsconfig.json
└── README.md
```

### Key Implementation: Custom Error Classes (src/utils/errors.ts)

```typescript
export class AegisError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context: Record<string, unknown> = {},
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = 'AegisError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      recoverable: this.recoverable,
      stack: this.stack,
    };
  }
}

export class UnrealConnectionError extends AegisError {
  constructor(endpoint: string, cause?: Error) {
    super(
      `Failed to connect to Unreal Engine at ${endpoint}`,
      'UE_CONNECTION_FAILED',
      { endpoint, cause: cause?.message },
      true
    );
    this.name = 'UnrealConnectionError';
  }
}

export class CommandValidationError extends AegisError {
  constructor(command: string, violations: string[]) {
    super(
      `Invalid command "${command}": ${violations.join(', ')}`,
      'COMMAND_VALIDATION_FAILED',
      { command, violations },
      true
    );
    this.name = 'CommandValidationError';
  }
}

export class SecurityViolationError extends AegisError {
  constructor(action: string, reason: string) {
    super(`Security violation: ${reason}`, 'SECURITY_VIOLATION', { action, reason }, false);
    this.name = 'SecurityViolationError';
  }
}

export class ExecutionError extends AegisError {
  constructor(action: string, details: string, rollbackAvailable: boolean) {
    super(`Execution failed for "${action}": ${details}`, 'EXECUTION_FAILED', 
      { action, details, rollbackAvailable }, rollbackAvailable);
    this.name = 'ExecutionError';
  }
}

export class ActorNotFoundError extends AegisError {
  constructor(actorPath: string) {
    super(`Actor not found: ${actorPath}`, 'ACTOR_NOT_FOUND', { actorPath }, true);
    this.name = 'ActorNotFoundError';
  }
}

export class BlueprintCompileError extends AegisError {
  constructor(blueprintPath: string, errors: string[]) {
    super(`Blueprint compilation failed: ${blueprintPath}`, 'BLUEPRINT_COMPILE_ERROR',
      { blueprintPath, errors }, true);
    this.name = 'BlueprintCompileError';
  }
}

export class AssetImportError extends AegisError {
  constructor(sourcePath: string, reason: string) {
    super(`Failed to import asset from "${sourcePath}": ${reason}`, 'ASSET_IMPORT_FAILED',
      { sourcePath, reason }, true);
    this.name = 'AssetImportError';
  }
}

export class RateLimitError extends AegisError {
  constructor(limit: number, windowMs: number) {
    super(`Rate limit exceeded: ${limit} actions per ${windowMs / 1000}s`, 'RATE_LIMIT_EXCEEDED',
      { limit, windowMs }, true);
    this.name = 'RateLimitError';
  }
}

export class PreviewExpiredError extends AegisError {
  constructor(previewId: string) {
    super(`Action preview has expired: ${previewId}`, 'PREVIEW_EXPIRED', { previewId }, true);
    this.name = 'PreviewExpiredError';
  }
}

export class ModelAdapterError extends AegisError {
  constructor(modelId: string, reason: string, cause?: Error) {
    super(`Model adapter error (${modelId}): ${reason}`, 'MODEL_ADAPTER_ERROR',
      { modelId, reason, cause: cause?.message }, true);
    this.name = 'ModelAdapterError';
  }
}

export class PluginLoadError extends AegisError {
  constructor(pluginId: string, reason: string) {
    super(`Failed to load plugin "${pluginId}": ${reason}`, 'PLUGIN_LOAD_ERROR',
      { pluginId, reason }, true);
    this.name = 'PluginLoadError';
  }
}

export class SeedProtocolError extends AegisError {
  constructor(operation: string, reason: string) {
    super(`Seed Protocol error during ${operation}: ${reason}`, 'SEED_PROTOCOL_ERROR',
      { operation, reason }, true);
    this.name = 'SeedProtocolError';
  }
}
```

### Logger Setup (src/utils/logger.ts)

```typescript
import pino from 'pino';
import { AegisError } from './errors';

export interface LogContext {
  requestId?: string;
  sessionId?: string;
  conversationId?: string;
  tool?: string;
  action?: string;
  [key: string]: unknown;
}

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' 
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  base: { service: 'aegis-mcp', version: process.env.npm_package_version || '1.0.0' },
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export class Logger {
  private logger: pino.Logger;
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = context;
    this.logger = baseLogger.child(context);
  }

  child(additionalContext: LogContext): Logger {
    return new Logger({ ...this.context, ...additionalContext });
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.logger.info(data, message);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.logger.warn(data, message);
  }

  error(message: string, error?: Error | AegisError, data?: Record<string, unknown>): void {
    const errorData = error instanceof AegisError ? error.toJSON()
      : error ? { message: error.message, stack: error.stack } : undefined;
    this.logger.error({ ...data, error: errorData }, message);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.logger.debug(data, message);
  }

  startTimer(): () => number {
    const start = process.hrtime.bigint();
    return () => Number(process.hrtime.bigint() - start) / 1_000_000;
  }
}

export const logger = new Logger();
```

### Unified Command Schema (src/schema/commands.ts)

```typescript
import { z } from 'zod';

// Base schemas
export const Vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const RotatorSchema = z.object({
  pitch: z.number(),
  yaw: z.number(),
  roll: z.number(),
});

export const TransformSchema = z.object({
  location: Vector3Schema,
  rotation: RotatorSchema,
  scale: Vector3Schema.optional().default({ x: 1, y: 1, z: 1 }),
});

export const ToolAnnotationsSchema = z.object({
  readOnly: z.boolean().default(false),
  destructive: z.boolean().default(false),
  idempotent: z.boolean().default(true),
  openWorld: z.boolean().default(false),
  estimatedDuration: z.number().optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  requiresApproval: z.boolean().default(false),
  runtimeCapable: z.boolean().default(false),
});

// Actor operations
export const SpawnActorSchema = z.object({
  actorClass: z.string().describe('Blueprint or native class path'),
  transform: TransformSchema,
  label: z.string().optional(),
  folder: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

export const ModifyActorSchema = z.object({
  actorPath: z.string(),
  properties: z.record(z.unknown()),
  transform: TransformSchema.partial().optional(),
});

export const DeleteActorSchema = z.object({
  actorPath: z.string(),
  recursive: z.boolean().default(false),
});

export const QueryActorsSchema = z.object({
  filter: z.object({
    class: z.string().optional(),
    label: z.string().optional(),
    tag: z.string().optional(),
    folder: z.string().optional(),
  }).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

// Blueprint operations
export const CreateBlueprintSchema = z.object({
  name: z.string(),
  parentClass: z.string(),
  path: z.string(),
  components: z.array(z.object({
    class: z.string(),
    name: z.string(),
    attachTo: z.string().optional(),
    properties: z.record(z.unknown()).optional(),
  })).optional(),
});

export const CompileBlueprintSchema = z.object({
  blueprintPath: z.string(),
  validateOnly: z.boolean().default(false),
});

// Command registry
export const CommandSchemas = {
  'aegis.core.spawn_actor': SpawnActorSchema,
  'aegis.core.modify_actor': ModifyActorSchema,
  'aegis.core.delete_actor': DeleteActorSchema,
  'aegis.core.query_actors': QueryActorsSchema,
  'aegis.core.create_blueprint': CreateBlueprintSchema,
  'aegis.core.compile_blueprint': CompileBlueprintSchema,
} as const;

export type CommandName = keyof typeof CommandSchemas;
export type CommandParams<T extends CommandName> = z.infer<typeof CommandSchemas[T]>;
```

---

## 🎮 Phase 3: Unreal Engine Plugin (C++)

### Directory Structure

```
aegis/ue-plugin/
├── Source/
│   ├── AegisEditor/
│   │   ├── AegisEditor.Build.cs
│   │   ├── Public/
│   │   │   ├── AegisEditorModule.h
│   │   │   ├── SAegisPanel.h              # Main Slate panel
│   │   │   ├── SAegisChatView.h           # Chat interface
│   │   │   ├── SAegisPreviewPanel.h       # Safe mode preview
│   │   │   ├── SAegisSettingsPanel.h      # Configuration
│   │   │   ├── AegisMCPClient.h           # MCP HTTP client
│   │   │   ├── AegisCommandParser.h       # Command parsing
│   │   │   ├── AegisTypes.h               # Shared types
│   │   │   └── AegisStyles.h              # UI styles
│   │   └── Private/
│   │       ├── AegisEditorModule.cpp
│   │       ├── SAegisPanel.cpp
│   │       ├── SAegisChatView.cpp
│   │       ├── SAegisPreviewPanel.cpp
│   │       ├── SAegisSettingsPanel.cpp
│   │       ├── AegisMCPClient.cpp
│   │       ├── AegisCommandParser.cpp
│   │       └── AegisStyles.cpp
│   └── AegisRuntime/
│       ├── AegisRuntime.Build.cs
│       ├── Public/
│       │   ├── AegisRuntimeModule.h
│       │   ├── AegisSubsystem.h
│       │   ├── AegisAIExecutionLayer.h
│       │   ├── AegisRuleSet.h
│       │   └── SeedProtocol/
│       │       ├── SeedIdentity.h
│       │       ├── SeedSchemas.h
│       │       ├── SeedPlatformConnector.h
│       │       ├── SeedLocalConnector.h
│       │       ├── SeedCloudConnector.h
│       │       ├── SeedProtocolSubsystem.h
│       │       └── SeedTelemetry.h
│       └── Private/
│           └── [Implementation files]
├── Resources/
├── Config/
│   └── DefaultAegis.ini
├── Aegis.uplugin
└── README.md
```

### Aegis.uplugin

```json
{
  "FileVersion": 3,
  "Version": 1,
  "VersionName": "1.0.0",
  "FriendlyName": "AEGIS - AI Engine Game Intelligence System",
  "Description": "AI-powered game development assistant with MCP integration",
  "Category": "Editor",
  "CreatedBy": "AEGIS Team",
  "CreatedByURL": "https://github.com/k5tuck/aegis",
  "DocsURL": "https://aegis.dev/docs",
  "Modules": [
    {
      "Name": "AegisEditor",
      "Type": "Editor",
      "LoadingPhase": "PostEngineInit"
    },
    {
      "Name": "AegisRuntime",
      "Type": "Runtime",
      "LoadingPhase": "Default"
    }
  ],
  "Plugins": [
    {
      "Name": "RemoteControl",
      "Enabled": true
    }
  ]
}
```

### AegisTypes.h (Shared Types)

```cpp
#pragma once

#include "CoreMinimal.h"
#include "AegisTypes.generated.h"

UENUM(BlueprintType)
enum class EAegisRiskLevel : uint8
{
    Low UMETA(DisplayName = "Low"),
    Medium UMETA(DisplayName = "Medium"),
    High UMETA(DisplayName = "High"),
    Critical UMETA(DisplayName = "Critical")
};

UENUM(BlueprintType)
enum class EAegisChangeType : uint8
{
    Create UMETA(DisplayName = "Create"),
    Modify UMETA(DisplayName = "Modify"),
    Delete UMETA(DisplayName = "Delete"),
    Move UMETA(DisplayName = "Move")
};

UENUM(BlueprintType)
enum class EAegisMCPConnectionStatus : uint8
{
    Disconnected,
    Connecting,
    Connected,
    Error
};

UENUM(BlueprintType)
enum class EAegisChatRole : uint8
{
    User,
    Assistant,
    System
};

USTRUCT(BlueprintType)
struct FAegisChatMessage
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FString Id;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    EAegisChatRole Role = EAegisChatRole::User;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FString Content;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FDateTime Timestamp;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    bool bHasPreview = false;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FString PreviewId;
};

USTRUCT(BlueprintType)
struct FAegisRiskAssessment
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    EAegisRiskLevel Level = EAegisRiskLevel::Low;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    TArray<FString> Factors;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    bool bReversible = true;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FString EstimatedImpact;
};

USTRUCT(BlueprintType)
struct FAegisChangePreview
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    EAegisChangeType Type = EAegisChangeType::Create;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FString Target;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FString Description;
};

USTRUCT(BlueprintType)
struct FAegisActionPreview
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FString Id;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FString Command;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    TArray<FAegisChangePreview> Changes;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FAegisRiskAssessment RiskAssessment;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    bool bApproved = false;
};

USTRUCT(BlueprintType)
struct FAegisErrorInfo
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FString Code;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FString Message;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    FString Suggestion;

    UPROPERTY(BlueprintReadWrite, Category = "AEGIS")
    bool bRecoverable = false;
};

// Delegate declarations
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnMCPConnected);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnMCPDisconnected, FString, Reason);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnMCPResponse, FAegisChatMessage, Message);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnMCPPreview, FAegisActionPreview, Preview);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnMCPError, FAegisErrorInfo, Error);
```

### AegisMCPClient.h

```cpp
#pragma once

#include "CoreMinimal.h"
#include "Http.h"
#include "AegisTypes.h"

class AEGISEDITOR_API FAegisMCPClient : public TSharedFromThis<FAegisMCPClient>
{
public:
    FAegisMCPClient();
    ~FAegisMCPClient();

    // Connection management
    void Connect(const FString& InServerUrl);
    void Disconnect();
    bool IsConnected() const { return bIsConnected; }
    EAegisMCPConnectionStatus GetConnectionStatus() const { return ConnectionStatus; }

    // Message sending
    void SendMessage(const FString& Message, bool bUseSafeMode = true);
    
    // Preview actions
    void ApprovePreview(const FString& PreviewId);
    void RejectPreview(const FString& PreviewId);

    // Settings
    void SetSafeModeEnabled(bool bEnabled) { bSafeModeEnabled = bEnabled; }
    bool IsSafeModeEnabled() const { return bSafeModeEnabled; }

    // Delegates
    FOnMCPConnected OnConnected;
    FOnMCPDisconnected OnDisconnected;
    FOnMCPResponse OnResponseReceived;
    FOnMCPPreview OnPreviewReceived;
    FOnMCPError OnErrorReceived;

private:
    FString ServerUrl;
    FString SessionId;
    bool bIsConnected = false;
    bool bSafeModeEnabled = true;
    EAegisMCPConnectionStatus ConnectionStatus = EAegisMCPConnectionStatus::Disconnected;
    
    void SendRequest(const FString& Endpoint, const TSharedPtr<FJsonObject>& Body, 
                     TFunction<void(TSharedPtr<FJsonObject>)> OnSuccess);
    FAegisActionPreview ParsePreviewFromJson(const TSharedPtr<FJsonObject>& JsonObject);
    FAegisErrorInfo ParseErrorFromJson(const TSharedPtr<FJsonObject>& JsonObject);
    void SetConnectionStatus(EAegisMCPConnectionStatus NewStatus);
};
```
.mapStopReason(response.stop_reason),
      modelId: this.config.model,
    };
  }

  private mapStopReason(reason: string | null): ModelResponse['finishReason'] {
    switch (reason) {
      case 'end_turn': return 'stop';
      case 'tool_use': return 'tool_use';
      case 'max_tokens': return 'length';
      default: return 'stop';
    }
  }
}
```

### Adapter Manager (src/adapters/index.ts)

```typescript
import { BaseModelAdapter, ModelAdapterConfig } from './base-adapter';
import { ClaudeAdapter, ClaudeAdapterConfig } from './claude-adapter';
import { OpenAIAdapter, OpenAIAdapterConfig } from './openai-adapter';
import { DeepSeekAdapter, DeepSeekAdapterConfig } from './deepseek-adapter';
import { OllamaAdapter, OllamaAdapterConfig } from './ollama-adapter';
import { Logger } from '../utils/logger';
import { ModelAdapterError } from '../utils/errors';

export type AdapterType = 'claude' | 'openai' | 'deepseek' | 'ollama';

export interface AdapterManagerConfig {
  primary: AdapterType;
  fallback?: AdapterType[];
  adapters: {
    claude?: ClaudeAdapterConfig;
    openai?: OpenAIAdapterConfig;
    deepseek?: DeepSeekAdapterConfig;
    ollama?: OllamaAdapterConfig;
  };
}

export class AdapterManager {
  private adapters: Map<AdapterType, BaseModelAdapter> = new Map();
  private primaryAdapter: AdapterType;
  private fallbackOrder: AdapterType[];
  private logger: Logger;

  constructor(config: AdapterManagerConfig, logger: Logger) {
    this.logger = logger.child({ component: 'AdapterManager' });
    this.primaryAdapter = config.primary;
    this.fallbackOrder = config.fallback || [];

    if (config.adapters.claude) {
      this.adapters.set('claude', new ClaudeAdapter(config.adapters.claude, logger));
    }
    if (config.adapters.openai) {
      this.adapters.set('openai', new OpenAIAdapter(config.adapters.openai, logger));
    }
    if (config.adapters.deepseek) {
      this.adapters.set('deepseek', new DeepSeekAdapter(config.adapters.deepseek, logger));
    }
    if (config.adapters.ollama) {
      this.adapters.set('ollama', new OllamaAdapter(config.adapters.ollama, logger));
    }

    if (!this.adapters.has(this.primaryAdapter)) {
      throw new ModelAdapterError(this.primaryAdapter, `Primary adapter not configured`);
    }
  }

  getPrimaryAdapter(): BaseModelAdapter {
    const adapter = this.adapters.get(this.primaryAdapter);
    if (!adapter) throw new ModelAdapterError(this.primaryAdapter, 'Primary adapter not found');
    return adapter;
  }

  async getAvailableAdapter(): Promise<BaseModelAdapter> {
    const primary = this.adapters.get(this.primaryAdapter);
    if (primary && await primary.isAvailable()) return primary;

    this.logger.warn('Primary adapter unavailable, trying fallbacks');
    for (const fallbackType of this.fallbackOrder) {
      const fallback = this.adapters.get(fallbackType);
      if (fallback && await fallback.isAvailable()) {
        this.logger.info('Using fallback adapter', { adapter: fallbackType });
        return fallback;
      }
    }
    throw new ModelAdapterError(this.primaryAdapter, 'No available adapters');
  }

  async checkAllAdapters(): Promise<Map<AdapterType, boolean>> {
    const results = new Map<AdapterType, boolean>();
    for (const [type, adapter] of this.adapters) {
      try { results.set(type, await adapter.isAvailable()); }
      catch { results.set(type, false); }
    }
    return results;
  }
}
```

---

## 🔒 Phase 5: Security & Sandboxing

### Security Sandbox (src/execution/sandbox.ts)

```typescript
import { Logger } from '../utils/logger';
import { SecurityViolationError, RateLimitError } from '../utils/errors';

export interface SecurityPolicy {
  allowedIntents: string[];
  deniedIntents: string[];
  maxActionsPerMinute: number;
  requireApprovalFor: string[];
  allowedAssetPaths: string[];
  deniedAssetPaths: string[];
  maxDeletesPerSession: number;
  requireBackupBeforeDelete: boolean;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  requiresApproval?: boolean;
  riskFactors?: string[];
}

const DEFAULT_POLICY: SecurityPolicy = {
  allowedIntents: ['*'],
  deniedIntents: ['delete_project', 'format_drive', 'execute_shell'],
  maxActionsPerMinute: 60,
  requireApprovalFor: ['delete_actor', 'delete_blueprint', 'clear_level'],
  allowedAssetPaths: ['/Game/*'],
  deniedAssetPaths: ['/Engine/*', '/Script/*'],
  maxDeletesPerSession: 50,
  requireBackupBeforeDelete: true,
};

export class SecuritySandbox {
  private policy: SecurityPolicy;
  private actionHistory: Array<{ timestamp: Date; action: string }> = [];
  private deleteCount: number = 0;
  private logger: Logger;

  constructor(policy: Partial<SecurityPolicy> = {}, logger: Logger) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.logger = logger.child({ component: 'SecuritySandbox' });
  }

  validateAction(intent: string, target: string, params: Record<string, unknown>): ValidationResult {
    const riskFactors: string[] = [];

    // Check denied intents
    if (this.isIntentDenied(intent)) {
      this.logger.warn('Action blocked by deny list', { intent });
      return { valid: false, reason: `Action "${intent}" is not permitted` };
    }

    // Check allowed intents
    if (!this.isIntentAllowed(intent)) {
      return { valid: false, reason: `Action "${intent}" not in allowed list` };
    }

    // Rate limiting
    if (!this.checkRateLimit()) {
      throw new RateLimitError(this.policy.maxActionsPerMinute, 60000);
    }

    // Asset path restrictions
    if (target && !this.isAssetPathAllowed(target)) {
      return { valid: false, reason: `Asset path "${target}" is restricted` };
    }

    // Delete limits
    if (intent.includes('delete')) {
      if (this.deleteCount >= this.policy.maxDeletesPerSession) {
        return { valid: false, reason: `Delete limit reached` };
      }
      riskFactors.push('Destructive operation');
    }

    // Check if approval required
    const requiresApproval = this.policy.requireApprovalFor.some(p => this.matchesPattern(intent, p));
    if (requiresApproval) riskFactors.push('Requires explicit approval');

    return { valid: true, requiresApproval, riskFactors: riskFactors.length > 0 ? riskFactors : undefined };
  }

  recordAction(action: string, _target: string, _approved: boolean): void {
    this.actionHistory.push({ timestamp: new Date(), action });
    if (action.includes('delete')) this.deleteCount++;
    
    // Trim old history
    const oneHourAgo = new Date(Date.now() - 3600000);
    this.actionHistory = this.actionHistory.filter(r => r.timestamp > oneHourAgo);
  }

  resetSession(): void {
    this.deleteCount = 0;
    this.actionHistory = [];
  }

  private isIntentDenied(intent: string): boolean {
    return this.policy.deniedIntents.some(p => this.matchesPattern(intent, p));
  }

  private isIntentAllowed(intent: string): boolean {
    return this.policy.allowedIntents.some(p => this.matchesPattern(intent, p));
  }

  private isAssetPathAllowed(path: string): boolean {
    const isDenied = this.policy.deniedAssetPaths.some(p => this.matchesPattern(path, p));
    if (isDenied) return false;
    return this.policy.allowedAssetPaths.some(p => this.matchesPattern(path, p));
  }

  private checkRateLimit(): boolean {
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const recentActions = this.actionHistory.filter(r => r.timestamp > oneMinuteAgo);
    return recentActions.length < this.policy.maxActionsPerMinute;
  }

  private matchesPattern(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
    return value === pattern;
  }
}
```

### Safe Mode Manager (src/execution/safe-mode.ts)

```typescript
import { Logger } from '../utils/logger';
import { PreviewExpiredError } from '../utils/errors';
import { v4 as uuidv4 } from 'uuid';

export interface ActionPreview {
  id: string;
  command: string;
  params: Record<string, unknown>;
  timestamp: Date;
  expiresAt: Date;
  changes: ChangePreview[];
  riskAssessment: RiskAssessment;
  approved: boolean;
  executed: boolean;
}

export interface ChangePreview {
  type: 'create' | 'modify' | 'delete' | 'move';
  target: string;
  description: string;
}

export interface RiskAssessment {
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  reversible: boolean;
  estimatedImpact: string;
}

export interface SafeModeConfig {
  enabled: boolean;
  previewExpirationMs: number;
  autoApproveLevel: 'none' | 'low' | 'medium';
  requireExplicitApproval: string[];
}

export class SafeModeManager {
  private previews: Map<string, ActionPreview> = new Map();
  private config: SafeModeConfig;
  private logger: Logger;

  constructor(config: SafeModeConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'SafeModeManager' });
    setInterval(() => this.cleanupExpiredPreviews(), 60000);
  }

  async createPreview(
    command: string,
    params: Record<string, unknown>,
    analyzeChanges: () => Promise<ChangePreview[]>
  ): Promise<ActionPreview> {
    const id = uuidv4();
    const now = new Date();
    const changes = await analyzeChanges();
    
    const preview: ActionPreview = {
      id, command, params,
      timestamp: now,
      expiresAt: new Date(now.getTime() + this.config.previewExpirationMs),
      changes,
      riskAssessment: this.assessRisk(command, changes),
      approved: false,
      executed: false,
    };

    if (this.shouldAutoApprove(preview)) {
      preview.approved = true;
      this.logger.info('Auto-approved preview', { previewId: id });
    }

    this.previews.set(id, preview);
    return preview;
  }

  approvePreview(previewId: string): ActionPreview {
    const preview = this.previews.get(previewId);
    if (!preview) throw new PreviewExpiredError(previewId);
    if (new Date() > preview.expiresAt) {
      this.previews.delete(previewId);
      throw new PreviewExpiredError(previewId);
    }
    preview.approved = true;
    return preview;
  }

  rejectPreview(previewId: string): void {
    this.previews.delete(previewId);
  }

  markExecuted(previewId: string): void {
    const preview = this.previews.get(previewId);
    if (preview) preview.executed = true;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  private assessRisk(command: string, changes: ChangePreview[]): RiskAssessment {
    const factors: string[] = [];
    let level: RiskAssessment['level'] = 'low';
    let reversible = true;

    const deleteCount = changes.filter(c => c.type === 'delete').length;
    if (deleteCount > 0) {
      factors.push(`Deletes ${deleteCount} object(s)`);
      level = deleteCount > 5 ? 'high' : 'medium';
    }

    const criticalCommands = ['delete_level', 'clear_world'];
    if (criticalCommands.some(c => command.includes(c))) {
      factors.push('Critical operation');
      level = 'critical';
      reversible = false;
    }

    return { level, factors, reversible, estimatedImpact: this.describeImpact(changes) };
  }

  private describeImpact(changes: ChangePreview[]): string {
    const creates = changes.filter(c => c.type === 'create').length;
    const modifies = changes.filter(c => c.type === 'modify').length;
    const deletes = changes.filter(c => c.type === 'delete').length;
    const parts: string[] = [];
    if (creates > 0) parts.push(`create ${creates}`);
    if (modifies > 0) parts.push(`modify ${modifies}`);
    if (deletes > 0) parts.push(`delete ${deletes}`);
    return parts.length > 0 ? `Will ${parts.join(', ')} object(s)` : 'No changes';
  }

  private shouldAutoApprove(preview: ActionPreview): boolean {
    if (this.config.autoApproveLevel === 'none') return false;
    if (this.config.requireExplicitApproval.includes(preview.command)) return false;
    const levels = ['low', 'medium', 'high', 'critical'];
    return levels.indexOf(preview.riskAssessment.level) <= levels.indexOf(this.config.autoApproveLevel);
  }

  private cleanupExpiredPreviews(): void {
    const now = new Date();
    for (const [id, preview] of this.previews) {
      if (now > preview.expiresAt) this.previews.delete(id);
    }
  }
}
```

---

## 🔌 Phase 6: Extensible Command Registry

### Plugin Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMMAND REGISTRY ARCHITECTURE                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    PLUGIN LOADER                            │ │
│  │  • File watcher (hot-reload)                               │ │
│  │  • Plugin discovery (/plugins/*.plugin.ts)                 │ │
│  │  • Dependency resolution                                    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  NAMESPACE ROUTER                           │ │
│  │  aegis.core.*        → Core commands                       │ │
│  │  aegis.worldgen.*    → World generation                    │ │
│  │  aegis.director.*    → AI Director                         │ │
│  │  aegis.npc.*         → NPC behaviors                       │ │
│  │  aegis.economy.*     → Economy systems                     │ │
│  │  {project}.*         → User-defined                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              UNIFIED VALIDATION PIPELINE                    │ │
│  │  1. Namespace resolution → 2. Schema lookup (Zod)          │ │
│  │  3. Parameter validation → 4. Security check               │ │
│  │  5. Context enrichment  → 6. Execution routing             │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Plugin Interface (src/registry/plugin-types.ts)

```typescript
import { z, ZodSchema } from 'zod';
import { Logger } from '../utils/logger';
import { UnrealRemoteControl } from '../ue-bridge/remote-control';

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  namespace: string;
  description: string;
  author?: string;
  dependencies?: PluginDependency[];
  supportsRuntime: boolean;
  tags?: string[];
}

export interface PluginDependency {
  pluginId: string;
  minVersion?: string;
  optional?: boolean;
}

export interface CommandAnnotations {
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  openWorld: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  runtimeCapable: boolean;
}

export interface CommandContext {
  logger: Logger;
  ueClient: UnrealRemoteControl;
  sessionId: string;
  userId?: string;
  safeModeEnabled: boolean;
}

export interface CommandDefinition<TParams = unknown, TResult = unknown> {
  name: string;
  description: string;
  shortDescription: string;
  paramsSchema: ZodSchema<TParams>;
  annotations: CommandAnnotations;
  execute: (params: TParams, context: CommandContext) => Promise<TResult>;
}

export interface AegisPlugin {
  metadata: PluginMetadata;
  commands: CommandDefinition[];
  onLoad?: (context: CommandContext) => Promise<void>;
  onUnload?: (context: CommandContext) => Promise<void>;
  healthCheck?: () => Promise<boolean>;
}
```

### Plugin Loader (src/registry/plugin-loader.ts)

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { Logger } from '../utils/logger';
import { PluginLoadError } from '../utils/errors';
import { AegisPlugin, CommandContext } from './plugin-types';

export interface PluginLoaderOptions {
  pluginDirs: string[];
  hotReload: boolean;
  hotReloadDebounceMs: number;
}

export class PluginLoader {
  private plugins: Map<string, AegisPlugin> = new Map();
  private watcher: chokidar.FSWatcher | null = null;
  private options: PluginLoaderOptions;
  private logger: Logger;
  private context: CommandContext;
  private reloadTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: PluginLoaderOptions, context: CommandContext, logger: Logger) {
    this.options = options;
    this.context = context;
    this.logger = logger.child({ component: 'PluginLoader' });
  }

  async initialize(): Promise<void> {
    for (const dir of this.options.pluginDirs) {
      await this.loadPluginsFromDirectory(dir);
    }
    if (this.options.hotReload) this.setupHotReload();
    this.logger.info('Plugin loader initialized', { pluginCount: this.plugins.size });
  }

  async shutdown(): Promise<void> {
    if (this.watcher) await this.watcher.close();
    for (const timer of this.reloadTimers.values()) clearTimeout(timer);
    for (const id of this.plugins.keys()) await this.unloadPlugin(id);
  }

  getPlugin(id: string): AegisPlugin | undefined { return this.plugins.get(id); }
  getAllPlugins(): AegisPlugin[] { return Array.from(this.plugins.values()); }

  async loadPlugin(pluginPath: string): Promise<AegisPlugin> {
    try {
      delete require.cache[require.resolve(pluginPath)];
      const module = await import(pluginPath);
      const plugin: AegisPlugin = module.default || module;
      
      this.validatePlugin(plugin);
      await this.checkDependencies(plugin);
      if (plugin.onLoad) await plugin.onLoad(this.context);
      
      this.plugins.set(plugin.metadata.id, plugin);
      this.logger.info('Plugin loaded', {
        id: plugin.metadata.id,
        commands: plugin.commands.length,
      });
      return plugin;
    } catch (error) {
      throw new PluginLoadError(pluginPath, error instanceof Error ? error.message : String(error));
    }
  }

  async unloadPlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    if (plugin.onUnload) {
      try { await plugin.onUnload(this.context); }
      catch (e) { this.logger.warn('Plugin onUnload error', { id, error: e }); }
    }
    this.plugins.delete(id);
  }

  private async loadPluginsFromDirectory(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const indexPath = path.join(dir, entry.name, 'index.ts');
        if (fs.existsSync(indexPath)) {
          try { await this.loadPlugin(indexPath); }
          catch (e) { this.logger.error('Failed to load plugin', e as Error); }
        }
      } else if (entry.name.endsWith('.plugin.ts')) {
        try { await this.loadPlugin(path.join(dir, entry.name)); }
        catch (e) { this.logger.error('Failed to load plugin', e as Error); }
      }
    }
  }

  private setupHotReload(): void {
    this.watcher = chokidar.watch(this.options.pluginDirs, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
    });
    this.watcher.on('change', (fp) => this.debounceReload(fp));
    this.watcher.on('add', (fp) => {
      if (fp.endsWith('.plugin.ts') || fp.endsWith('index.ts')) this.debounceReload(fp);
    });
  }

  private debounceReload(filePath: string): void {
    const existing = this.reloadTimers.get(filePath);
    if (existing) clearTimeout(existing);
    this.reloadTimers.set(filePath, setTimeout(async () => {
      this.reloadTimers.delete(filePath);
      try { await this.loadPlugin(filePath); }
      catch (e) { this.logger.error('Reload failed', e as Error); }
    }, this.options.hotReloadDebounceMs));
  }

  private validatePlugin(plugin: AegisPlugin): void {
    if (!plugin.metadata?.id) throw new Error('Plugin missing id');
    if (!plugin.metadata?.namespace) throw new Error('Plugin missing namespace');
    if (!Array.isArray(plugin.commands)) throw new Error('Plugin missing commands');
    for (const cmd of plugin.commands) {
      if (!cmd.name || !cmd.paramsSchema || !cmd.execute) {
        throw new Error(`Invalid command in ${plugin.metadata.id}`);
      }
    }
  }

  private async checkDependencies(plugin: AegisPlugin): Promise<void> {
    if (!plugin.metadata.dependencies) return;
    for (const dep of plugin.metadata.dependencies) {
      if (!this.plugins.has(dep.pluginId) && !dep.optional) {
        throw new Error(`Missing dependency: ${dep.pluginId}`);
      }
    }
  }
}
```

### Command Registry (src/registry/command-registry.ts)

```typescript
import { Logger } from '../utils/logger';
import { CommandValidationError } from '../utils/errors';
import { AegisPlugin, CommandDefinition, CommandContext } from './plugin-types';
import { PluginLoader } from './plugin-loader';
import { SecuritySandbox } from '../execution/sandbox';

export interface RegisteredCommand {
  fullName: string;
  namespace: string;
  localName: string;
  plugin: AegisPlugin;
  definition: CommandDefinition;
}

export class CommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();
  private pluginLoader: PluginLoader;
  private sandbox: SecuritySandbox;
  private logger: Logger;

  constructor(pluginLoader: PluginLoader, sandbox: SecuritySandbox, logger: Logger) {
    this.pluginLoader = pluginLoader;
    this.sandbox = sandbox;
    this.logger = logger.child({ component: 'CommandRegistry' });
  }

  async initialize(): Promise<void> {
    for (const plugin of this.pluginLoader.getAllPlugins()) {
      this.registerPluginCommands(plugin);
    }
    this.logger.info('Registry initialized', { commands: this.commands.size });
  }

  registerPluginCommands(plugin: AegisPlugin): void {
    for (const command of plugin.commands) {
      const fullName = `${plugin.metadata.namespace}.${command.name}`;
      this.commands.set(fullName, {
        fullName,
        namespace: plugin.metadata.namespace,
        localName: command.name,
        plugin,
        definition: command,
      });
    }
  }

  getCommand(fullName: string): RegisteredCommand | undefined {
    return this.commands.get(fullName);
  }

  async validateAndExecute(
    commandName: string,
    params: unknown,
    context: CommandContext
  ): Promise<unknown> {
    const command = this.commands.get(commandName);
    if (!command) throw new CommandValidationError(commandName, ['Command not found']);

    const parseResult = command.definition.paramsSchema.safeParse(params);
    if (!parseResult.success) {
      throw new CommandValidationError(commandName, 
        parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`));
    }

    const securityResult = this.sandbox.validateAction(
      commandName, JSON.stringify(parseResult.data), parseResult.data as Record<string, unknown>
    );
    if (!securityResult.valid) {
      throw new CommandValidationError(commandName, [securityResult.reason!]);
    }

    if (securityResult.requiresApproval && context.safeModeEnabled) {
      return { requiresApproval: true, command: commandName, params: parseResult.data };
    }

    const result = await command.definition.execute(parseResult.data, context);
    this.sandbox.recordAction(commandName, JSON.stringify(parseResult.data), true);
    return result;
  }

  getCommandsForAI(): Array<{ name: string; description: string; annotations: unknown }> {
    return Array.from(this.commands.values()).map(cmd => ({
      name: cmd.fullName,
      description: cmd.definition.description,
      annotations: cmd.definition.annotations,
    }));
  }
}
```

---

## 🧪 Phase 7: Testing Strategy

### Testing Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                      AEGIS TESTING PYRAMID                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                          ┌─────────────┐                           │
│                          │    E2E      │  10%                      │
│                          │  (5-10)     │  Full integration         │
│                          └─────────────┘                           │
│                      ┌─────────────────────┐                       │
│                      │   Integration       │  30%                  │
│                      │   (50-100)          │  Component combos     │
│                      └─────────────────────┘                       │
│                  ┌─────────────────────────────┐                   │
│                  │        Unit Tests           │  60%              │
│                  │        (200-500)            │  Isolated logic   │
│                  └─────────────────────────────┘                   │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Test Directory Structure

```
mcp-server/tests/
├── unit/
│   ├── adapters/
│   │   ├── claude-adapter.test.ts
│   │   ├── openai-adapter.test.ts
│   │   ├── adapter-manager.test.ts
│   │   └── base-adapter.test.ts
│   ├── schema/
│   │   ├── commands.test.ts
│   │   └── validators.test.ts
│   ├── execution/
│   │   ├── sandbox.test.ts
│   │   ├── safe-mode.test.ts
│   │   └── rollback.test.ts
│   ├── registry/
│   │   ├── plugin-loader.test.ts
│   │   └── command-registry.test.ts
│   ├── feedback/
│   │   └── loop-manager.test.ts
│   └── utils/
│       ├── errors.test.ts
│       └── logger.test.ts
├── integration/
│   ├── mcp-server.test.ts
│   ├── ue-bridge.test.ts
│   ├── adapter-switching.test.ts
│   ├── plugin-hot-reload.test.ts
│   └── safe-mode-flow.test.ts
├── e2e/
│   ├── spawn-actor.e2e.ts
│   ├── blueprint-creation.e2e.ts
│   ├── full-workflow.e2e.ts
│   └── error-recovery.e2e.ts
├── fixtures/
│   ├── mock-ue-responses.ts
│   ├── sample-commands.ts
│   └── test-plugins/
├── helpers/
│   ├── mock-ue-client.ts
│   ├── test-logger.ts
│   └── assertion-helpers.ts
└── setup.ts
```

### Unit Test Examples

#### Security Sandbox Tests (tests/unit/execution/sandbox.test.ts)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SecuritySandbox, SecurityPolicy } from '../../../src/execution/sandbox';
import { RateLimitError } from '../../../src/utils/errors';
import { createTestLogger } from '../../helpers/test-logger';

describe('SecuritySandbox', () => {
  let sandbox: SecuritySandbox;
  let logger = createTestLogger();

  beforeEach(() => {
    sandbox = new SecuritySandbox({}, logger);
  });

  describe('validateAction', () => {
    it('should allow valid actions', () => {
      const result = sandbox.validateAction('aegis.core.spawn_actor', '/Game/MyActor', {});
      expect(result.valid).toBe(true);
    });

    it('should block denied intents', () => {
      const result = sandbox.validateAction('delete_project', '', {});
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not permitted');
    });

    it('should block restricted asset paths', () => {
      const result = sandbox.validateAction('aegis.core.modify_actor', '/Engine/Internal', {});
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('restricted');
    });

    it('should require approval for destructive actions', () => {
      const result = sandbox.validateAction('delete_actor', '/Game/MyActor', {});
      expect(result.valid).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });

    it('should enforce rate limits', () => {
      // Record 60 actions
      for (let i = 0; i < 60; i++) {
        sandbox.recordAction(`action_${i}`, '', true);
      }
      
      expect(() => sandbox.validateAction('one_more', '', {}))
        .toThrow(RateLimitError);
    });

    it('should track delete count per session', () => {
      const customPolicy: Partial<SecurityPolicy> = { maxDeletesPerSession: 2 };
      sandbox = new SecuritySandbox(customPolicy, logger);
      
      sandbox.recordAction('delete_1', '', true);
      sandbox.recordAction('delete_2', '', true);
      
      const result = sandbox.validateAction('delete_3', '', {});
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('limit reached');
    });

    it('should reset session state', () => {
      sandbox.recordAction('delete_1', '', true);
      sandbox.resetSession();
      
      const result = sandbox.validateAction('delete_actor', '', {});
      expect(result.valid).toBe(true);
    });
  });

  describe('pattern matching', () => {
    it('should match wildcard patterns', () => {
      const result = sandbox.validateAction('aegis.core.anything', '/Game/MyFolder/Asset', {});
      expect(result.valid).toBe(true);
    });

    it('should match exact patterns', () => {
      const customPolicy: Partial<SecurityPolicy> = {
        allowedIntents: ['specific_action'],
        deniedIntents: [],
      };
      sandbox = new SecuritySandbox(customPolicy, logger);
      
      expect(sandbox.validateAction('specific_action', '', {}).valid).toBe(true);
      expect(sandbox.validateAction('other_action', '', {}).valid).toBe(false);
    });
  });
});
```

#### Safe Mode Tests (tests/unit/execution/safe-mode.test.ts)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SafeModeManager, SafeModeConfig, ChangePreview } from '../../../src/execution/safe-mode';
import { PreviewExpiredError } from '../../../src/utils/errors';
import { createTestLogger } from '../../helpers/test-logger';

describe('SafeModeManager', () => {
  let manager: SafeModeManager;
  const config: SafeModeConfig = {
    enabled: true,
    previewExpirationMs: 300000, // 5 minutes
    autoApproveLevel: 'low',
    requireExplicitApproval: ['delete_level'],
  };

  beforeEach(() => {
    manager = new SafeModeManager(config, createTestLogger());
  });

  describe('createPreview', () => {
    it('should create preview with risk assessment', async () => {
      const changes: ChangePreview[] = [
        { type: 'create', target: '/Game/Actor1', description: 'Spawn actor' },
      ];
      
      const preview = await manager.createPreview(
        'spawn_actor',
        { class: 'BP_MyActor' },
        async () => changes
      );

      expect(preview.id).toBeDefined();
      expect(preview.command).toBe('spawn_actor');
      expect(preview.changes).toHaveLength(1);
      expect(preview.riskAssessment.level).toBe('low');
    });

    it('should auto-approve low-risk actions', async () => {
      const preview = await manager.createPreview(
        'query_actors',
        {},
        async () => []
      );

      expect(preview.approved).toBe(true);
    });

    it('should not auto-approve destructive actions', async () => {
      const changes: ChangePreview[] = [
        { type: 'delete', target: '/Game/Actor1', description: 'Delete actor' },
        { type: 'delete', target: '/Game/Actor2', description: 'Delete actor' },
        { type: 'delete', target: '/Game/Actor3', description: 'Delete actor' },
        { type: 'delete', target: '/Game/Actor4', description: 'Delete actor' },
        { type: 'delete', target: '/Game/Actor5', description: 'Delete actor' },
        { type: 'delete', target: '/Game/Actor6', description: 'Delete actor' },
      ];
      
      const preview = await manager.createPreview(
        'delete_actors',
        {},
        async () => changes
      );

      expect(preview.approved).toBe(false);
      expect(preview.riskAssessment.level).toBe('high');
    });
  });

  describe('approvePreview', () => {
    it('should approve valid preview', async () => {
      const preview = await manager.createPreview('cmd', {}, async () => []);
      preview.approved = false; // Reset for test
      
      const approved = manager.approvePreview(preview.id);
      expect(approved.approved).toBe(true);
    });

    it('should throw for non-existent preview', () => {
      expect(() => manager.approvePreview('fake-id'))
        .toThrow(PreviewExpiredError);
    });

    it('should throw for expired preview', async () => {
      vi.useFakeTimers();
      
      const preview = await manager.createPreview('cmd', {}, async () => []);
      preview.approved = false;
      
      // Fast forward past expiration
      vi.advanceTimersByTime(400000);
      
      expect(() => manager.approvePreview(preview.id))
        .toThrow(PreviewExpiredError);
      
      vi.useRealTimers();
    });
  });

  describe('risk assessment', () => {
    it('should identify critical operations', async () => {
      const preview = await manager.createPreview(
        'delete_level',
        { level: '/Game/MainLevel' },
        async () => [{ type: 'delete', target: 'Level', description: 'Delete entire level' }]
      );

      expect(preview.riskAssessment.level).toBe('critical');
      expect(preview.riskAssessment.reversible).toBe(false);
    });

    it('should calculate impact description', async () => {
      const changes: ChangePreview[] = [
        { type: 'create', target: 'A', description: '' },
        { type: 'modify', target: 'B', description: '' },
        { type: 'modify', target: 'C', description: '' },
        { type: 'delete', target: 'D', description: '' },
      ];
      
      const preview = await manager.createPreview('cmd', {}, async () => changes);
      
      expect(preview.riskAssessment.estimatedImpact).toContain('create 1');
      expect(preview.riskAssessment.estimatedImpact).toContain('modify 2');
      expect(preview.riskAssessment.estimatedImpact).toContain('delete 1');
    });
  });
});
```

### Integration Test Examples

#### MCP Server Integration (tests/integration/mcp-server.test.ts)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server';
import { MockUnrealClient } from '../helpers/mock-ue-client';

describe('MCP Server Integration', () => {
  let server: ReturnType<typeof createServer>;
  let mockUE: MockUnrealClient;

  beforeAll(async () => {
    mockUE = new MockUnrealClient();
    await mockUE.start(30021); // Use different port for tests
    
    server = createServer({
      port: 3001,
      ueConfig: { host: 'localhost', httpPort: 30021, wsPort: 30022 },
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await mockUE.stop();
  });

  it('should handle spawn_actor tool call', async () => {
    const response = await fetch('http://localhost:3001/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'aegis.core.spawn_actor',
          arguments: {
            actorClass: '/Game/BP_TestActor',
            transform: { location: { x: 0, y: 0, z: 0 }, rotation: { pitch: 0, yaw: 0, roll: 0 } },
          },
        },
        id: 1,
      }),
    });

    const data = await response.json();
    expect(data.result).toBeDefined();
    expect(mockUE.getLastRequest().path).toBe('/remote/object/call');
  });

  it('should return preview for destructive actions in safe mode', async () => {
    const response = await fetch('http://localhost:3001/mcp', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Safe-Mode': 'true',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'aegis.core.delete_actor',
          arguments: { actorPath: '/Game/TestActor' },
        },
        id: 2,
      }),
    });

    const data = await response.json();
    expect(data.result.requiresApproval).toBe(true);
    expect(data.result.previewId).toBeDefined();
  });

  it('should handle validation errors gracefully', async () => {
    const response = await fetch('http://localhost:3001/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'aegis.core.spawn_actor',
          arguments: { /* missing required fields */ },
        },
        id: 3,
      }),
    });

    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32602); // Invalid params
  });
});
```

### E2E Test Examples

#### Full Workflow E2E (tests/e2e/full-workflow.e2e.ts)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';

describe('E2E: Full Development Workflow', () => {
  // These tests require actual UE5 running with Remote Control enabled
  const UE_AVAILABLE = process.env.UE_E2E_TESTS === 'true';

  beforeAll(async () => {
    if (!UE_AVAILABLE) {
      console.log('Skipping E2E tests - set UE_E2E_TESTS=true to run');
      return;
    }
    // Wait for UE connection
  });

  it.skipIf(!UE_AVAILABLE)('should complete actor spawn workflow', async () => {
    // 1. Send natural language request
    const chatResponse = await sendChat('Create a cube at position 100, 200, 0');
    expect(chatResponse.intent).toBe('spawn_actor');
    
    // 2. Get preview
    expect(chatResponse.preview).toBeDefined();
    expect(chatResponse.preview.changes[0].type).toBe('create');
    
    // 3. Approve preview
    const approveResponse = await approvePreview(chatResponse.preview.id);
    expect(approveResponse.executed).toBe(true);
    
    // 4. Verify actor exists in UE
    const actors = await queryActors({ label: 'Cube' });
    expect(actors.length).toBeGreaterThan(0);
  });

  it.skipIf(!UE_AVAILABLE)('should handle error recovery', async () => {
    // 1. Attempt invalid operation
    const response = await sendChat('Delete actor that does not exist');
    
    // 2. Check error feedback
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe('ACTOR_NOT_FOUND');
    expect(response.suggestion).toContain('query_actors');
    
    // 3. Follow suggestion
    const recoveryResponse = await sendChat('First show me all actors');
    expect(recoveryResponse.result).toBeDefined();
  });
});

// Helper functions
async function sendChat(message: string): Promise<any> {
  const response = await fetch('http://localhost:3000/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return response.json();
}

async function approvePreview(previewId: string): Promise<any> {
  const response = await fetch(`http://localhost:3000/preview/${previewId}/approve`, {
    method: 'POST',
  });
  return response.json();
}

async function queryActors(filter: any): Promise<any[]> {
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'aegis.core.query_actors', arguments: { filter } },
      id: Date.now(),
    }),
  });
  const data = await response.json();
  return data.result.actors || [];
}
```

### Test Configuration (vitest.config.ts)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['tests/**', 'node_modules/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    setupFiles: ['tests/setup.ts'],
  },
});
```

### Test Scripts (package.json)

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "UE_E2E_TESTS=true vitest run tests/e2e",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest watch",
    "test:ui": "vitest --ui"
  }
}
```

---

## 📚 Phase 8: Documentation

### Documentation Structure

```
docs/
├── README.md                    # Project overview
├── QUICKSTART.md               # 5-minute getting started
├── CONTRIBUTING.md             # Contribution guidelines
├── CHANGELOG.md                # Version history
├── api/
│   ├── mcp-server.md           # MCP Server API reference
│   ├── commands.md             # All available commands
│   ├── schemas.md              # Zod schema documentation
│   └── error-codes.md          # Error code reference
├── guides/
│   ├── installation.md         # Detailed installation
│   ├── configuration.md        # Configuration options
│   ├── safe-mode.md            # Safe mode usage
│   ├── plugin-development.md   # Creating plugins
│   ├── model-adapters.md       # Configuring AI models
│   ├── security.md             # Security best practices
│   └── troubleshooting.md      # Common issues
└── architecture/
    ├── overview.md             # System architecture
    ├── mcp-protocol.md         # MCP implementation details
    ├── ue-integration.md       # Unreal Engine integration
    └── data-flow.md            # Request/response flow
```

### Quick Start Guide (docs/QUICKSTART.md)

```markdown
# AEGIS Quick Start

Get AEGIS running in 5 minutes.

## Prerequisites

- Node.js 20+
- Unreal Engine 5.4+
- Claude API key (or other supported AI provider)

## Installation

### 1. Clone and Setup

\`\`\`bash
git clone https://github.com/k5tuck/aegis.git
cd aegis

# Install MCP server dependencies
cd mcp-server
npm install
cp .env.example .env
\`\`\`

### 2. Configure Environment

Edit \`.env\`:

\`\`\`env
# Required
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Optional
PORT=3000
UE_HOST=localhost
UE_HTTP_PORT=30020
LOG_LEVEL=info
SAFE_MODE_ENABLED=true
\`\`\`

### 3. Enable Remote Control in UE5

1. Open your UE5 project
2. Go to Edit → Plugins
3. Search for "Remote Control API"
4. Enable it and restart the editor

### 4. Start AEGIS

\`\`\`bash
npm run dev
\`\`\`

### 5. Test Connection

\`\`\`bash
curl http://localhost:3000/health
# Should return: {"status":"ok","ue_connected":true}
\`\`\`

## First Commands

### Via CLI

\`\`\`bash
# List available commands
curl http://localhost:3000/mcp -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Spawn an actor
curl http://localhost:3000/mcp -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"aegis.core.spawn_actor",
      "arguments":{
        "actorClass":"/Engine/BasicShapes/Cube",
        "transform":{"location":{"x":0,"y":0,"z":100},"rotation":{"pitch":0,"yaw":0,"roll":0}}
      }
    },
    "id":2
  }'
\`\`\`

### Via UE Plugin

1. Install the AEGIS plugin (see [Installation Guide](guides/installation.md))
2. Open the AEGIS panel: Window → AEGIS Assistant
3. Type: "Create a cube at position 0, 0, 100"
4. Review the preview and click "Execute"

## Next Steps

- [Full Installation Guide](guides/installation.md)
- [Configuration Options](guides/configuration.md)
- [Available Commands](api/commands.md)
- [Creating Plugins](guides/plugin-development.md)
```

### Command Reference (docs/api/commands.md)

```markdown
# AEGIS Command Reference

## Namespaces

| Namespace | Description |
|-----------|-------------|
| \`aegis.core.*\` | Core actor, blueprint, and asset operations |
| \`aegis.worldgen.*\` | Procedural world generation |
| \`aegis.director.*\` | AI Director system |
| \`aegis.npc.*\` | NPC behavior management |
| \`aegis.economy.*\` | Game economy systems |
| \`aegis.narrative.*\` | Quest and dialogue systems |

---

## Core Commands

### aegis.core.spawn_actor

Spawns a new actor in the world.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| \`actorClass\` | string | ✓ | Blueprint or class path |
| \`transform.location\` | Vector3 | ✓ | World position |
| \`transform.rotation\` | Rotator | ✓ | World rotation |
| \`transform.scale\` | Vector3 | | Scale (default: 1,1,1) |
| \`label\` | string | | Actor label |
| \`folder\` | string | | World outliner folder |
| \`properties\` | object | | Initial property values |
| \`tags\` | string[] | | Actor tags |

**Annotations:**
- Risk Level: \`low\`
- Destructive: \`false\`
- Requires Approval: \`false\`

**Example:**

\`\`\`json
{
  "actorClass": "/Game/Blueprints/BP_Enemy",
  "transform": {
    "location": { "x": 100, "y": 200, "z": 0 },
    "rotation": { "pitch": 0, "yaw": 45, "roll": 0 },
    "scale": { "x": 1, "y": 1, "z": 1 }
  },
  "label": "Enemy_01",
  "folder": "Enemies",
  "properties": {
    "Health": 100,
    "Speed": 300
  },
  "tags": ["enemy", "spawned"]
}
\`\`\`

---

### aegis.core.delete_actor

Deletes an actor from the world.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| \`actorPath\` | string | ✓ | Full actor path |
| \`recursive\` | boolean | | Delete attached children |

**Annotations:**
- Risk Level: \`medium\`
- Destructive: \`true\`
- Requires Approval: \`true\` (in safe mode)

---

### aegis.core.query_actors

Query actors in the current level.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| \`filter.class\` | string | | Filter by class |
| \`filter.label\` | string | | Filter by label pattern |
| \`filter.tag\` | string | | Filter by tag |
| \`filter.folder\` | string | | Filter by folder |
| \`limit\` | number | | Max results (default: 100) |

**Returns:**

\`\`\`json
{
  "actors": [
    {
      "path": "/Game/Level/Actor_0",
      "label": "MyCube",
      "class": "StaticMeshActor",
      "location": { "x": 0, "y": 0, "z": 0 }
    }
  ],
  "total": 1
}
\`\`\`
```

### Error Codes Reference (docs/api/error-codes.md)

```markdown
# AEGIS Error Codes

## Error Code Format

All AEGIS errors follow this structure:

\`\`\`json
{
  "code": "ERROR_CODE",
  "message": "Human-readable message",
  "context": { "additional": "info" },
  "recoverable": true,
  "suggestion": "How to fix this"
}
\`\`\`

---

## Connection Errors

### UE_CONNECTION_FAILED

**Cause:** Cannot connect to Unreal Engine Remote Control API.

**Solutions:**
1. Verify UE5 is running
2. Check Remote Control API plugin is enabled
3. Confirm port 30020 is accessible
4. Check firewall settings

---

## Validation Errors

### COMMAND_VALIDATION_FAILED

**Cause:** Command parameters don't match the expected schema.

**Solutions:**
1. Check required parameters are provided
2. Verify parameter types match schema
3. Review command documentation

### ACTOR_NOT_FOUND

**Cause:** Referenced actor doesn't exist.

**Solutions:**
1. Use \`query_actors\` to list available actors
2. Verify actor path spelling (case-sensitive)
3. Check if actor is in a loaded sub-level

---

## Execution Errors

### EXECUTION_FAILED

**Cause:** Command failed during execution.

**Context includes:**
- \`action\`: The attempted action
- \`details\`: Specific failure reason
- \`rollbackAvailable\`: Whether undo is possible

### BLUEPRINT_COMPILE_ERROR

**Cause:** Blueprint failed to compile.

**Solutions:**
1. Check for missing variable references
2. Verify node connections
3. Look for deprecated nodes
4. Check Output Log in UE5

---

## Security Errors

### SECURITY_VIOLATION

**Cause:** Action blocked by security policy.

**Note:** This error is not recoverable. Contact administrator to adjust security settings.

### RATE_LIMIT_EXCEEDED

**Cause:** Too many actions in a short period.

**Solutions:**
1. Wait before sending more commands
2. Batch operations into fewer requests
3. Adjust rate limit configuration

---

## Preview Errors

### PREVIEW_EXPIRED

**Cause:** Action preview has expired (default: 5 minutes).

**Solutions:**
1. Create a new preview
2. Increase \`previewExpirationMs\` in config
```

### Plugin Development Guide (docs/guides/plugin-development.md)

```markdown
# Creating AEGIS Plugins

Extend AEGIS with custom commands for your game.

## Plugin Structure

\`\`\`
my-plugin/
├── index.ts          # Plugin entry point
├── commands/
│   ├── my-command.ts
│   └── another-command.ts
├── schemas/
│   └── my-schemas.ts
└── package.json
\`\`\`

## Basic Plugin

\`\`\`typescript
// index.ts
import { AegisPlugin, CommandDefinition } from '@aegis/registry';
import { z } from 'zod';

const MyCommandSchema = z.object({
  targetId: z.string(),
  action: z.enum(['start', 'stop', 'pause']),
});

const myCommand: CommandDefinition = {
  name: 'my_action',
  description: 'Performs a custom action on a target',
  shortDescription: 'Custom action',
  paramsSchema: MyCommandSchema,
  annotations: {
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
    riskLevel: 'low',
    requiresApproval: false,
    runtimeCapable: true,
  },
  async execute(params, context) {
    context.logger.info('Executing my_action', { targetId: params.targetId });
    
    // Call UE
    const result = await context.ueClient.callFunction(
      params.targetId,
      params.action === 'start' ? 'Start' : params.action === 'stop' ? 'Stop' : 'Pause',
      {}
    );
    
    return { success: true, result };
  },
};

const plugin: AegisPlugin = {
  metadata: {
    id: 'my-game-plugin',
    name: 'My Game Plugin',
    version: '1.0.0',
    namespace: 'mygame',
    description: 'Custom commands for My Game',
    author: 'Your Name',
    supportsRuntime: true,
    tags: ['gameplay', 'custom'],
  },
  commands: [myCommand],
  
  async onLoad(context) {
    context.logger.info('My Game Plugin loaded!');
  },
  
  async onUnload(context) {
    context.logger.info('My Game Plugin unloaded');
  },
};

export default plugin;
\`\`\`

## Installing Your Plugin

1. Place plugin in \`mcp-server/src/plugins/custom/\`
2. Restart AEGIS (or hot-reload will pick it up)
3. Verify with: \`curl http://localhost:3000/mcp -X POST -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'\`

## Best Practices

1. **Use descriptive names**: \`mygame.combat.apply_damage\` not \`damage\`
2. **Validate thoroughly**: Use Zod for all input validation
3. **Set correct annotations**: Especially \`destructive\` and \`riskLevel\`
4. **Log appropriately**: Use context.logger, not console.log
5. **Handle errors**: Throw custom AegisError subclasses
6. **Document commands**: Include clear descriptions for AI
```

---

## 📋 Implementation Checklist

### Phase 0: Setup ✓
- [ ] Clone reference MCP projects
- [ ] Clone forked Unreal Engine
- [ ] Create AEGIS directory structure
- [ ] Initialize package.json with dependencies

### Phase 1: Architecture ✓
- [ ] Review architecture diagrams
- [ ] Understand component responsibilities
- [ ] Plan data flow

### Phase 2: MCP Server
- [ ] Implement custom error classes
- [ ] Setup structured logging
- [ ] Create Zod command schemas
- [ ] Build UE Remote Control bridge
- [ ] Implement error feedback loop

### Phase 3: UE Plugin
- [ ] Create plugin module structure
- [ ] Implement AegisTypes.h
- [ ] Build MCP HTTP client
- [ ] Create Slate UI panels
- [ ] Integrate with Remote Control API

### Phase 4: Model Adapters
- [ ] Implement base adapter interface
- [ ] Build Claude adapter (primary)
- [ ] Build OpenAI adapter
- [ ] Build DeepSeek adapter
- [ ] Build Ollama adapter
- [ ] Create adapter manager with fallback

### Phase 5: Security
- [ ] Implement security sandbox
- [ ] Build safe mode manager
- [ ] Create rollback system
- [ ] Add rate limiting
- [ ] Implement permission system

### Phase 6: Plugin Registry
- [ ] Define plugin interface
- [ ] Build plugin loader with hot-reload
- [ ] Create command registry
- [ ] Implement namespace routing
- [ ] Add validation pipeline

### Phase 7: Testing
- [ ] Setup Vitest configuration
- [ ] Write unit tests (200+)
- [ ] Write integration tests (50+)
- [ ] Write E2E tests (10+)
- [ ] Achieve 80% code coverage

### Phase 8: Documentation
- [ ] Write Quick Start guide
- [ ] Document all commands
- [ ] Create error code reference
- [ ] Write plugin development guide
- [ ] Add architecture documentation

---

## 🚀 Getting Started Command

```bash
# Clone and start development
git clone https://github.com/k5tuck/aegis.git
cd aegis/mcp-server
npm install
cp .env.example .env
# Edit .env with your API keys
npm run dev
```

---

*AEGIS - AI Engine Game Intelligence System*
*Building the future of AI-assisted game development*
.mapStopReason(response.stop_reason),
      modelId: this.config.model,
    };
  }

  private mapStopReason(reason: string | null): ModelResponse['finishReason'] {
    switch (reason) {
      case 'end_turn': return 'stop';
      case 'tool_use': return 'tool_use';
      case 'max_tokens': return 'length';
      default: return 'stop';
    }
  }
}
```

### Adapter Manager (src/adapters/index.ts)

```typescript
import { BaseModelAdapter, ModelAdapterConfig } from './base-adapter';
import { ClaudeAdapter, ClaudeAdapterConfig } from './claude-adapter';
import { OpenAIAdapter, OpenAIAdapterConfig } from './openai-adapter';
import { DeepSeekAdapter, DeepSeekAdapterConfig } from './deepseek-adapter';
import { OllamaAdapter, OllamaAdapterConfig } from './ollama-adapter';
import { Logger } from '../utils/logger';
import { ModelAdapterError } from '../utils/errors';

export type AdapterType = 'claude' | 'openai' | 'deepseek' | 'ollama';

export interface AdapterManagerConfig {
  primary: AdapterType;
  fallback?: AdapterType[];
  adapters: {
    claude?: ClaudeAdapterConfig;
    openai?: OpenAIAdapterConfig;
    deepseek?: DeepSeekAdapterConfig;
    ollama?: OllamaAdapterConfig;
  };
}

export class AdapterManager {
  private adapters: Map<AdapterType, BaseModelAdapter> = new Map();
  private primaryAdapter: AdapterType;
  private fallbackOrder: AdapterType[];
  private logger: Logger;

  constructor(config: AdapterManagerConfig, logger: Logger) {
    this.logger = logger.child({ component: 'AdapterManager' });
    this.primaryAdapter = config.primary;
    this.fallbackOrder = config.fallback || [];

    if (config.adapters.claude) {
      this.adapters.set('claude', new ClaudeAdapter(config.adapters.claude, logger));
    }
    if (config.adapters.openai) {
      this.adapters.set('openai', new OpenAIAdapter(config.adapters.openai, logger));
    }
    if (config.adapters.deepseek) {
      this.adapters.set('deepseek', new DeepSeekAdapter(config.adapters.deepseek, logger));
    }
    if (config.adapters.ollama) {
      this.adapters.set('ollama', new OllamaAdapter(config.adapters.ollama, logger));
    }

    if (!this.adapters.has(this.primaryAdapter)) {
      throw new ModelAdapterError(this.primaryAdapter, `Primary adapter not configured`);
    }
  }

  getPrimaryAdapter(): BaseModelAdapter {
    const adapter = this.adapters.get(this.primaryAdapter);
    if (!adapter) throw new ModelAdapterError(this.primaryAdapter, 'Primary adapter not found');
    return adapter;
  }

  async getAvailableAdapter(): Promise<BaseModelAdapter> {
    const primary = this.adapters.get(this.primaryAdapter);
    if (primary && await primary.isAvailable()) return primary;

    this.logger.warn('Primary adapter unavailable, trying fallbacks', { primary: this.primaryAdapter });

    for (const fallbackType of this.fallbackOrder) {
      const fallback = this.adapters.get(fallbackType);
      if (fallback && await fallback.isAvailable()) {
        this.logger.info('Using fallback adapter', { adapter: fallbackType });
        return fallback;
      }
    }

    throw new ModelAdapterError(this.primaryAdapter, 'No available adapters');
  }

  async checkAllAdapters(): Promise<Map<AdapterType, boolean>> {
    const results = new Map<AdapterType, boolean>();
    for (const [type, adapter] of this.adapters) {
      try { results.set(type, await adapter.isAvailable()); } 
      catch { results.set(type, false); }
    }
    return results;
  }
}
```

---

## 🔒 Phase 5: Security & Sandboxing

### Security Sandbox (src/execution/sandbox.ts)

```typescript
import { Logger } from '../utils/logger';
import { SecurityViolationError, RateLimitError } from '../utils/errors';

export interface SecurityPolicy {
  allowedIntents: string[];
  deniedIntents: string[];
  maxActionsPerMinute: number;
  requireApprovalFor: string[];
  allowedAssetPaths: string[];
  deniedAssetPaths: string[];
  maxDeletesPerSession: number;
  requireBackupBeforeDelete: boolean;
  allowFileSystemAccess: boolean;
  allowNetworkAccess: boolean;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  requiresApproval?: boolean;
  riskFactors?: string[];
}

const DEFAULT_POLICY: SecurityPolicy = {
  allowedIntents: ['*'],
  deniedIntents: ['delete_project', 'format_drive', 'execute_shell'],
  maxActionsPerMinute: 60,
  requireApprovalFor: ['delete_actor', 'delete_blueprint', 'clear_level'],
  allowedAssetPaths: ['/Game/*'],
  deniedAssetPaths: ['/Engine/*', '/Script/*'],
  maxDeletesPerSession: 50,
  requireBackupBeforeDelete: true,
  allowFileSystemAccess: false,
  allowNetworkAccess: false,
};

export class SecuritySandbox {
  private policy: SecurityPolicy;
  private actionHistory: Array<{ timestamp: Date; action: string }> = [];
  private deleteCount: number = 0;
  private logger: Logger;

  constructor(policy: Partial<SecurityPolicy> = {}, logger: Logger) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.logger = logger.child({ component: 'SecuritySandbox' });
  }

  validateAction(intent: string, target: string, params: Record<string, unknown>): ValidationResult {
    const riskFactors: string[] = [];

    // Check denied intents (blocklist)
    if (this.isIntentDenied(intent)) {
      this.logger.warn('Action blocked by deny list', { intent });
      return { valid: false, reason: `Action "${intent}" is not permitted by security policy` };
    }

    // Check allowed intents (allowlist)
    if (!this.isIntentAllowed(intent)) {
      return { valid: false, reason: `Action "${intent}" is not in the allowed actions list` };
    }

    // Check rate limiting
    if (!this.checkRateLimit()) {
      throw new RateLimitError(this.policy.maxActionsPerMinute, 60000);
    }

    // Check asset path restrictions
    if (target && !this.isAssetPathAllowed(target)) {
      return { valid: false, reason: `Asset path "${target}" is restricted` };
    }

    // Check delete limits
    if (intent.includes('delete')) {
      if (this.deleteCount >= this.policy.maxDeletesPerSession) {
        return { valid: false, reason: `Delete limit reached (${this.policy.maxDeletesPerSession} per session)` };
      }
      riskFactors.push('Destructive operation');
    }

    // Check if approval is required
    const requiresApproval = this.policy.requireApprovalFor.some(pattern =>
      this.matchesPattern(intent, pattern)
    );

    return { valid: true, requiresApproval, riskFactors: riskFactors.length > 0 ? riskFactors : undefined };
  }

  recordAction(action: string, target: string, approved: boolean): void {
    this.actionHistory.push({ timestamp: new Date(), action });
    if (action.includes('delete')) this.deleteCount++;
    
    // Trim old history (keep last hour)
    const oneHourAgo = new Date(Date.now() - 3600000);
    this.actionHistory = this.actionHistory.filter(r => r.timestamp > oneHourAgo);
  }

  private isIntentDenied(intent: string): boolean {
    return this.policy.deniedIntents.some(pattern => this.matchesPattern(intent, pattern));
  }

  private isIntentAllowed(intent: string): boolean {
    return this.policy.allowedIntents.some(pattern => this.matchesPattern(intent, pattern));
  }

  private isAssetPathAllowed(path: string): boolean {
    const isDenied = this.policy.deniedAssetPaths.some(p => this.matchesPattern(path, p));
    if (isDenied) return false;
    return this.policy.allowedAssetPaths.some(p => this.matchesPattern(path, p));
  }

  private checkRateLimit(): boolean {
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const recentActions = this.actionHistory.filter(r => r.timestamp > oneMinuteAgo);
    return recentActions.length < this.policy.maxActionsPerMinute;
  }

  private matchesPattern(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
    return value === pattern;
  }

  resetSession(): void {
    this.deleteCount = 0;
    this.actionHistory = [];
  }
}
```

### Safe Mode Manager (src/execution/safe-mode.ts)

```typescript
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/logger';
import { PreviewExpiredError } from '../utils/errors';

export interface ActionPreview {
  id: string;
  command: string;
  params: Record<string, unknown>;
  timestamp: Date;
  expiresAt: Date;
  changes: ChangePreview[];
  riskAssessment: RiskAssessment;
  approved: boolean;
  executed: boolean;
}

export interface ChangePreview {
  type: 'create' | 'modify' | 'delete' | 'move';
  target: string;
  description: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface RiskAssessment {
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  reversible: boolean;
  estimatedImpact: string;
}

export interface SafeModeConfig {
  enabled: boolean;
  previewExpirationMs: number;
  autoApproveLevel: 'none' | 'low' | 'medium';
  requireExplicitApproval: string[];
}

export class SafeModeManager {
  private previews: Map<string, ActionPreview> = new Map();
  private config: SafeModeConfig;
  private logger: Logger;

  constructor(config: SafeModeConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'SafeModeManager' });
    setInterval(() => this.cleanupExpiredPreviews(), 60000);
  }

  async createPreview(
    command: string,
    params: Record<string, unknown>,
    analyzeChanges: () => Promise<ChangePreview[]>
  ): Promise<ActionPreview> {
    const id = uuidv4();
    const now = new Date();
    const changes = await analyzeChanges();
    
    const preview: ActionPreview = {
      id, command, params, timestamp: now,
      expiresAt: new Date(now.getTime() + this.config.previewExpirationMs),
      changes, riskAssessment: this.assessRisk(command, changes),
      approved: false, executed: false,
    };

    if (this.shouldAutoApprove(preview)) {
      preview.approved = true;
      this.logger.info('Auto-approved preview', { previewId: id, riskLevel: preview.riskAssessment.level });
    }

    this.previews.set(id, preview);
    return preview;
  }

  approvePreview(previewId: string): ActionPreview {
    const preview = this.previews.get(previewId);
    if (!preview) throw new PreviewExpiredError(previewId);
    if (new Date() > preview.expiresAt) {
      this.previews.delete(previewId);
      throw new PreviewExpiredError(previewId);
    }
    preview.approved = true;
    return preview;
  }

  rejectPreview(previewId: string): void {
    this.previews.delete(previewId);
  }

  markExecuted(previewId: string): void {
    const preview = this.previews.get(previewId);
    if (preview) preview.executed = true;
  }

  isEnabled(): boolean { return this.config.enabled; }

  private assessRisk(command: string, changes: ChangePreview[]): RiskAssessment {
    const factors: string[] = [];
    let level: RiskAssessment['level'] = 'low';
    let reversible = true;

    const deleteCount = changes.filter(c => c.type === 'delete').length;
    if (deleteCount > 0) {
      factors.push(`Deletes ${deleteCount} object(s)`);
      level = deleteCount > 5 ? 'high' : 'medium';
    }

    const criticalCommands = ['delete_level', 'clear_world', 'reset_project'];
    if (criticalCommands.some(c => command.includes(c))) {
      factors.push('Critical operation');
      level = 'critical';
      reversible = false;
    }

    return { level, factors, reversible, estimatedImpact: this.describeImpact(changes) };
  }

  private describeImpact(changes: ChangePreview[]): string {
    const parts: string[] = [];
    const creates = changes.filter(c => c.type === 'create').length;
    const modifies = changes.filter(c => c.type === 'modify').length;
    const deletes = changes.filter(c => c.type === 'delete').length;
    if (creates > 0) parts.push(`create ${creates} object(s)`);
    if (modifies > 0) parts.push(`modify ${modifies} object(s)`);
    if (deletes > 0) parts.push(`delete ${deletes} object(s)`);
    return parts.length > 0 ? `Will ${parts.join(', ')}` : 'No changes detected';
  }

  private shouldAutoApprove(preview: ActionPreview): boolean {
    if (this.config.autoApproveLevel === 'none') return false;
    if (this.config.requireExplicitApproval.includes(preview.command)) return false;
    const levels = ['low', 'medium', 'high', 'critical'];
    return levels.indexOf(preview.riskAssessment.level) <= levels.indexOf(this.config.autoApproveLevel);
  }

  private cleanupExpiredPreviews(): void {
    const now = new Date();
    for (const [id, preview] of this.previews) {
      if (now > preview.expiresAt) this.previews.delete(id);
    }
  }
}
```

---

## 🔌 Phase 6: Extensible Command Registry

### Plugin Interface (src/registry/plugin-types.ts)

```typescript
import { z, ZodSchema } from 'zod';
import { Logger } from '../utils/logger';
import { UnrealRemoteControl } from '../ue-bridge/remote-control';

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  namespace: string;
  description: string;
  author?: string;
  dependencies?: PluginDependency[];
  minAegisVersion?: string;
  supportsRuntime: boolean;
  tags?: string[];
}

export interface PluginDependency {
  pluginId: string;
  minVersion?: string;
  optional?: boolean;
}

export interface CommandAnnotations {
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  openWorld: boolean;
  estimatedDuration?: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  runtimeCapable: boolean;
}

export interface CommandContext {
  logger: Logger;
  ueClient: UnrealRemoteControl;
  sessionId: string;
  userId?: string;
  safeModeEnabled: boolean;
}

export interface CommandDefinition<TParams = unknown, TResult = unknown> {
  name: string;
  description: string;
  shortDescription: string;
  paramsSchema: ZodSchema<TParams>;
  annotations: CommandAnnotations;
  execute: (params: TParams, context: CommandContext) => Promise<TResult>;
}

export interface AegisPlugin {
  metadata: PluginMetadata;
  commands: CommandDefinition[];
  onLoad?: (context: CommandContext) => Promise<void>;
  onUnload?: (context: CommandContext) => Promise<void>;
  healthCheck?: () => Promise<boolean>;
}
```

### Plugin Loader (src/registry/plugin-loader.ts)

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { Logger } from '../utils/logger';
import { PluginLoadError } from '../utils/errors';
import { AegisPlugin, CommandContext } from './plugin-types';

export interface PluginLoaderOptions {
  pluginDirs: string[];
  hotReload: boolean;
  hotReloadDebounceMs: number;
}

export class PluginLoader {
  private plugins: Map<string, AegisPlugin> = new Map();
  private watcher: chokidar.FSWatcher | null = null;
  private options: PluginLoaderOptions;
  private logger: Logger;
  private context: CommandContext;
  private reloadTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: PluginLoaderOptions, context: CommandContext, logger: Logger) {
    this.options = options;
    this.context = context;
    this.logger = logger.child({ component: 'PluginLoader' });
  }

  async initialize(): Promise<void> {
    for (const dir of this.options.pluginDirs) {
      await this.loadPluginsFromDirectory(dir);
    }
    if (this.options.hotReload) this.setupHotReload();
    this.logger.info('Plugin loader initialized', { pluginCount: this.plugins.size });
  }

  async loadPlugin(pluginPath: string): Promise<AegisPlugin> {
    try {
      delete require.cache[require.resolve(pluginPath)];
      const module = await import(pluginPath);
      const plugin: AegisPlugin = module.default || module;

      this.validatePlugin(plugin);
      await this.checkDependencies(plugin);
      if (plugin.onLoad) await plugin.onLoad(this.context);

      this.plugins.set(plugin.metadata.id, plugin);
      this.logger.info('Plugin loaded', {
        id: plugin.metadata.id, name: plugin.metadata.name,
        version: plugin.metadata.version, commandCount: plugin.commands.length,
      });
      return plugin;
    } catch (error) {
      throw new PluginLoadError(pluginPath, error instanceof Error ? error.message : String(error));
    }
  }

  async unloadPlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    if (plugin.onUnload) {
      try { await plugin.onUnload(this.context); } catch (e) { this.logger.warn('Plugin onUnload error', { id, error: e }); }
    }
    this.plugins.delete(id);
  }

  getPlugin(id: string): AegisPlugin | undefined { return this.plugins.get(id); }
  getAllPlugins(): AegisPlugin[] { return Array.from(this.plugins.values()); }

  private async loadPluginsFromDirectory(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const indexPath = path.join(dir, entry.name, 'index.ts');
        if (fs.existsSync(indexPath)) {
          try { await this.loadPlugin(indexPath); } catch (e) { this.logger.error('Failed to load plugin', e as Error); }
        }
      } else if (entry.name.endsWith('.plugin.ts')) {
        try { await this.loadPlugin(path.join(dir, entry.name)); } catch (e) { this.logger.error('Failed to load plugin', e as Error); }
      }
    }
  }

  private setupHotReload(): void {
    this.watcher = chokidar.watch(this.options.pluginDirs, { ignored: /(^|[\/\\])\./, persistent: true, ignoreInitial: true });
    this.watcher.on('change', (filePath) => this.handleFileChange(filePath));
    this.watcher.on('add', (filePath) => {
      if (filePath.endsWith('.plugin.ts') || filePath.endsWith('index.ts')) this.handleFileChange(filePath);
    });
  }

  private handleFileChange(filePath: string): void {
    const existing = this.reloadTimers.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      this.reloadTimers.delete(filePath);
      this.logger.info('Reloading plugin', { filePath });
      try {
        const existingPlugin = Array.from(this.plugins.values()).find(p => 
          p.metadata.id === path.basename(filePath, '.plugin.ts'));
        if (existingPlugin) await this.unloadPlugin(existingPlugin.metadata.id);
        await this.loadPlugin(filePath);
      } catch (e) { this.logger.error('Failed to reload plugin', e as Error); }
    }, this.options.hotReloadDebounceMs);
    this.reloadTimers.set(filePath, timer);
  }

  private validatePlugin(plugin: AegisPlugin): void {
    if (!plugin.metadata) throw new Error('Plugin missing metadata');
    if (!plugin.metadata.id) throw new Error('Plugin missing id');
    if (!plugin.metadata.namespace) throw new Error('Plugin missing namespace');
    if (!Array.isArray(plugin.commands)) throw new Error('Plugin missing commands array');
    for (const cmd of plugin.commands) {
      if (!cmd.name || !cmd.paramsSchema || !cmd.execute) {
        throw new Error(`Invalid command in plugin ${plugin.metadata.id}`);
      }
    }
  }

  private async checkDependencies(plugin: AegisPlugin): Promise<void> {
    if (!plugin.metadata.dependencies) return;
    for (const dep of plugin.metadata.dependencies) {
      const depPlugin = this.plugins.get(dep.pluginId);
      if (!depPlugin && !dep.optional) throw new Error(`Required dependency not found: ${dep.pluginId}`);
    }
  }
}
```

### Command Registry (src/registry/command-registry.ts)

```typescript
import { z } from 'zod';
import { Logger } from '../utils/logger';
import { CommandValidationError } from '../utils/errors';
import { AegisPlugin, CommandDefinition, CommandContext, CommandAnnotations } from './plugin-types';
import { PluginLoader } from './plugin-loader';
import { SecuritySandbox } from '../execution/sandbox';

export interface RegisteredCommand {
  fullName: string;
  namespace: string;
  localName: string;
  plugin: AegisPlugin;
  definition: CommandDefinition;
}

export class CommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();
  private pluginLoader: PluginLoader;
  private sandbox: SecuritySandbox;
  private logger: Logger;

  constructor(pluginLoader: PluginLoader, sandbox: SecuritySandbox, logger: Logger) {
    this.pluginLoader = pluginLoader;
    this.sandbox = sandbox;
    this.logger = logger.child({ component: 'CommandRegistry' });
  }

  async initialize(): Promise<void> {
    for (const plugin of this.pluginLoader.getAllPlugins()) {
      this.registerPluginCommands(plugin);
    }
    this.logger.info('Command registry initialized', { commandCount: this.commands.size });
  }

  registerPluginCommands(plugin: AegisPlugin): void {
    for (const command of plugin.commands) {
      const fullName = `${plugin.metadata.namespace}.${command.name}`;
      this.commands.set(fullName, {
        fullName, namespace: plugin.metadata.namespace,
        localName: command.name, plugin, definition: command,
      });
    }
  }

  getCommand(fullName: string): RegisteredCommand | undefined {
    return this.commands.get(fullName);
  }

  findCommands(query: { namespace?: string; runtimeCapable?: boolean }): RegisteredCommand[] {
    let results = Array.from(this.commands.values());
    if (query.namespace) results = results.filter(cmd => cmd.namespace === query.namespace);
    if (query.runtimeCapable !== undefined) {
      results = results.filter(cmd => cmd.definition.annotations.runtimeCapable === query.runtimeCapable);
    }
    return results;
  }

  async validateAndExecute(commandName: string, params: unknown, context: CommandContext): Promise<unknown> {
    const command = this.commands.get(commandName);
    if (!command) throw new CommandValidationError(commandName, ['Command not found']);

    const parseResult = command.definition.paramsSchema.safeParse(params);
    if (!parseResult.success) {
      const violations = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      throw new CommandValidationError(commandName, violations);
    }

    const securityResult = this.sandbox.validateAction(
      commandName, JSON.stringify(parseResult.data), parseResult.data as Record<string, unknown>
    );
    if (!securityResult.valid) throw new CommandValidationError(commandName, [securityResult.reason!]);

    if (securityResult.requiresApproval && context.safeModeEnabled) {
      return { requiresApproval: true, command: commandName, params: parseResult.data, riskFactors: securityResult.riskFactors };
    }

    const result = await command.definition.execute(parseResult.data, context);
    this.sandbox.recordAction(commandName, JSON.stringify(parseResult.data), true);
    return result;
  }

  getCommandsForAI(): Array<{ name: string; description: string; annotations: CommandAnnotations }> {
    return Array.from(this.commands.values()).map(cmd => ({
      name: cmd.fullName, description: cmd.definition.description, annotations: cmd.definition.annotations,
    }));
  }
}
```

---

## 🧪 Phase 7: Testing Strategy

### Testing Philosophy

AEGIS uses a comprehensive testing pyramid with emphasis on:
1. **Unit tests** for core logic (schema validation, error handling, adapters)
2. **Integration tests** for component interactions (registry + sandbox, adapters + tools)
3. **E2E tests** for full workflows (chat → preview → execute → rollback)
4. **MCP Evaluation tests** for AI effectiveness (per MCP best practices)

### Directory Structure

```
aegis/mcp-server/tests/
├── unit/
│   ├── schema/
│   │   ├── commands.test.ts       # Zod schema validation
│   │   └── validators.test.ts     # Custom validator logic
│   ├── utils/
│   │   ├── errors.test.ts         # Error class behavior
│   │   └── logger.test.ts         # Logger functionality
│   ├── adapters/
│   │   ├── claude-adapter.test.ts # Claude adapter unit tests
│   │   ├── adapter-manager.test.ts
│   │   └── mocks/                 # Mock API responses
│   ├── execution/
│   │   ├── sandbox.test.ts        # Security sandbox logic
│   │   ├── safe-mode.test.ts      # Preview/approval pipeline
│   │   └── rollback.test.ts       # Undo system
│   ├── registry/
│   │   ├── command-registry.test.ts
│   │   └── plugin-loader.test.ts
│   └── feedback/
│       └── loop-manager.test.ts
├── integration/
│   ├── ue-bridge/
│   │   ├── remote-control.test.ts # With mocked UE responses
│   │   └── state-sync.test.ts
│   ├── workflows/
│   │   ├── spawn-actor.test.ts    # Full spawn workflow
│   │   ├── blueprint-creation.test.ts
│   │   └── safe-mode-approval.test.ts
│   └── adapters/
│       └── multi-adapter-fallback.test.ts
├── e2e/
│   ├── scenarios/
│   │   ├── simple-spawn.e2e.ts
│   │   ├── complex-blueprint.e2e.ts
│   │   ├── error-recovery.e2e.ts
│   │   └── plugin-hot-reload.e2e.ts
│   └── fixtures/
│       └── test-plugins/
├── evaluation/
│   ├── questions.xml              # MCP evaluation questions
│   └── run-evaluation.ts          # Evaluation runner
├── setup.ts                       # Global test setup
├── teardown.ts                    # Global teardown
└── jest.config.ts                 # Jest configuration
```

### Unit Test Example (tests/unit/execution/sandbox.test.ts)

```typescript
import { SecuritySandbox, SecurityPolicy, ValidationResult } from '../../../src/execution/sandbox';
import { Logger } from '../../../src/utils/logger';
import { RateLimitError } from '../../../src/utils/errors';

describe('SecuritySandbox', () => {
  let sandbox: SecuritySandbox;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    sandbox = new SecuritySandbox({}, mockLogger);
  });

  afterEach(() => {
    sandbox.resetSession();
  });

  describe('validateAction', () => {
    it('should allow actions in the allowlist', () => {
      const result = sandbox.validateAction('aegis.core.spawn_actor', '/Game/Test', {});
      expect(result.valid).toBe(true);
    });

    it('should deny actions in the denylist', () => {
      const result = sandbox.validateAction('delete_project', '/Game/Test', {});
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not permitted');
    });

    it('should require approval for destructive actions', () => {
      const result = sandbox.validateAction('delete_actor', '/Game/Actor', {});
      expect(result.valid).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });

    it('should block restricted asset paths', () => {
      const result = sandbox.validateAction('aegis.core.modify_actor', '/Engine/Test', {});
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('restricted');
    });

    it('should enforce delete limits per session', () => {
      const customSandbox = new SecuritySandbox({ maxDeletesPerSession: 2 }, mockLogger);
      
      customSandbox.recordAction('delete_actor', '/Game/A', true);
      customSandbox.recordAction('delete_actor', '/Game/B', true);
      
      const result = customSandbox.validateAction('delete_actor', '/Game/C', {});
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Delete limit reached');
    });

    it('should enforce rate limiting', () => {
      const customSandbox = new SecuritySandbox({ maxActionsPerMinute: 2 }, mockLogger);
      
      customSandbox.recordAction('action1', '/Game/A', true);
      customSandbox.recordAction('action2', '/Game/B', true);
      
      expect(() => {
        customSandbox.validateAction('action3', '/Game/C', {});
      }).toThrow(RateLimitError);
    });
  });

  describe('resetSession', () => {
    it('should reset delete count and action history', () => {
      sandbox.recordAction('delete_actor', '/Game/A', true);
      sandbox.recordAction('delete_actor', '/Game/B', true);
      
      sandbox.resetSession();
      
      // After reset, delete limit should be available again
      const result = sandbox.validateAction('delete_actor', '/Game/C', {});
      expect(result.valid).toBe(true);
    });
  });
});
```

### Integration Test Example (tests/integration/workflows/spawn-actor.test.ts)

```typescript
import { CommandRegistry } from '../../../src/registry/command-registry';
import { PluginLoader } from '../../../src/registry/plugin-loader';
import { SecuritySandbox } from '../../../src/execution/sandbox';
import { SafeModeManager } from '../../../src/execution/safe-mode';
import { Logger } from '../../../src/utils/logger';
import { CommandContext } from '../../../src/registry/plugin-types';

// Mock UE Remote Control
const mockUEClient = {
  callFunction: jest.fn().mockResolvedValue({ success: true }),
  setProperty: jest.fn().mockResolvedValue(undefined),
  searchActors: jest.fn().mockResolvedValue([]),
  isConnected: jest.fn().mockReturnValue(true),
};

describe('Spawn Actor Workflow', () => {
  let registry: CommandRegistry;
  let safeMode: SafeModeManager;
  let context: CommandContext;

  beforeAll(async () => {
    const logger = new Logger({ component: 'test' });
    const sandbox = new SecuritySandbox({}, logger);
    const pluginLoader = new PluginLoader({
      pluginDirs: ['./src/plugins/core'],
      hotReload: false,
      hotReloadDebounceMs: 0,
    }, context, logger);

    await pluginLoader.initialize();
    registry = new CommandRegistry(pluginLoader, sandbox, logger);
    await registry.initialize();

    safeMode = new SafeModeManager({
      enabled: true,
      previewExpirationMs: 300000,
      autoApproveLevel: 'low',
      requireExplicitApproval: ['delete_actor'],
    }, logger);

    context = {
      logger,
      ueClient: mockUEClient as any,
      sessionId: 'test-session',
      safeModeEnabled: true,
    };
  });

  it('should create preview for spawn_actor command', async () => {
    const params = {
      actorClass: '/Game/Blueprints/BP_TestActor',
      transform: {
        location: { x: 100, y: 200, z: 0 },
        rotation: { pitch: 0, yaw: 0, roll: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      label: 'TestActor',
    };

    const preview = await safeMode.createPreview(
      'aegis.core.spawn_actor',
      params,
      async () => [{
        type: 'create' as const,
        target: '/Game/Maps/TestLevel.TestActor',
        description: 'Spawn BP_TestActor at (100, 200, 0)',
      }]
    );

    expect(preview.id).toBeDefined();
    expect(preview.command).toBe('aegis.core.spawn_actor');
    expect(preview.changes).toHaveLength(1);
    expect(preview.riskAssessment.level).toBe('low');
    expect(preview.approved).toBe(true); // Auto-approved because risk is low
  });

  it('should execute approved spawn command', async () => {
    const command = registry.getCommand('aegis.core.spawn_actor');
    expect(command).toBeDefined();

    const params = {
      actorClass: '/Game/Blueprints/BP_TestActor',
      transform: {
        location: { x: 100, y: 200, z: 0 },
        rotation: { pitch: 0, yaw: 0, roll: 0 },
      },
    };

    const result = await registry.validateAndExecute('aegis.core.spawn_actor', params, context);
    
    expect(mockUEClient.callFunction).toHaveBeenCalled();
  });
});
```

### MCP Evaluation File (tests/evaluation/questions.xml)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<evaluation>
  <qa_pair>
    <question>Create a StaticMeshActor at position (500, 300, 0) with the cube mesh from the engine starter content. What is the actor path after creation?</question>
    <answer>/Game/Maps/TestLevel.StaticMeshActor_0</answer>
  </qa_pair>
  
  <qa_pair>
    <question>Query all actors in the level that have the tag "Interactive". How many actors have this tag?</question>
    <answer>3</answer>
  </qa_pair>
  
  <qa_pair>
    <question>Create a new Blueprint class named BP_RotatingPlatform that inherits from Actor and has a StaticMesh component named "Platform" and a RotatingMovement component. What is the full asset path?</question>
    <answer>/Game/Blueprints/BP_RotatingPlatform</answer>
  </qa_pair>
  
  <qa_pair>
    <question>What is the risk level assessment for deleting all actors in the folder "Environment/Trees"?</question>
    <answer>high</answer>
  </qa_pair>
  
  <qa_pair>
    <question>Spawn 5 PointLight actors in a line starting at (0,0,200) with 100 unit spacing along the X axis. What are the X coordinates of all lights?</question>
    <answer>0, 100, 200, 300, 400</answer>
  </qa_pair>
  
  <qa_pair>
    <question>Create a Dynamic Material Instance from M_Basic and set the BaseColor parameter to red (1,0,0). What is the material instance path?</question>
    <answer>/Game/Materials/MI_Basic_Inst</answer>
  </qa_pair>
  
  <qa_pair>
    <question>What commands are available in the aegis.core namespace that support runtime execution?</question>
    <answer>modify_actor, query_actors</answer>
  </qa_pair>
  
  <qa_pair>
    <question>Using Safe Mode, request deletion of an actor. What fields are included in the preview response?</question>
    <answer>id, command, params, changes, riskAssessment, approved</answer>
  </qa_pair>
  
  <qa_pair>
    <question>What is the maximum number of delete operations allowed per session by the default security policy?</question>
    <answer>50</answer>
  </qa_pair>
  
  <qa_pair>
    <question>If the Claude adapter fails, what is the first fallback adapter that will be tried according to the default configuration?</question>
    <answer>openai</answer>
  </qa_pair>
</evaluation>
```

### Jest Configuration (tests/jest.config.ts)

```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '**/*.test.ts',
    '**/*.e2e.ts',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  globalTeardown: '<rootDir>/tests/teardown.ts',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testTimeout: 30000,
  verbose: true,
};

export default config;
```

---

## 📚 Phase 8: Documentation

### Documentation Structure

```
aegis/docs/
├── README.md                      # Project overview
├── CONTRIBUTING.md                # Contribution guidelines
├── CHANGELOG.md                   # Version history
├── api/
│   ├── commands.md                # Full command reference
│   ├── schemas.md                 # Data type definitions
│   ├── errors.md                  # Error codes and handling
│   └── events.md                  # Event system reference
├── guides/
│   ├── getting-started.md         # Quick start guide
│   ├── installation.md            # Detailed installation
│   ├── configuration.md           # Config options
│   ├── safe-mode.md               # Using Safe Mode
│   ├── writing-plugins.md         # Plugin development
│   ├── model-adapters.md          # Configuring AI models
│   ├── security.md                # Security best practices
│   └── troubleshooting.md         # Common issues
└── architecture/
    ├── overview.md                # System architecture
    ├── mcp-server.md              # MCP server internals
    ├── ue-plugin.md               # UE plugin design
    ├── command-flow.md            # Request lifecycle
    └── extension-points.md        # Extensibility guide
```

### README.md

```markdown
# AEGIS - AI Engine Game Intelligence System

> An AI-powered game development assistant for Unreal Engine with MCP integration

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)]()
[![UE5](https://img.shields.io/badge/UE5-5.4+-green.svg)]()
[![License](https://img.shields.io/badge/license-MIT-yellow.svg)]()

## ✨ Features

- **🤖 AI-Powered Development**: Natural language commands translated to UE actions
- **🔒 Safe Mode**: Preview changes before execution with risk assessment
- **🔌 Multi-Model Support**: Claude (primary), OpenAI, DeepSeek, Ollama
- **📦 Plugin Architecture**: Extensible command system with hot-reload
- **🛡️ Enterprise Security**: Sandboxing, rate limiting, audit logging
- **🎮 Runtime Support**: Some commands work during gameplay

## 🚀 Quick Start

### Prerequisites

- Unreal Engine 5.4+
- Node.js 20+
- Git

### Installation

```bash
# Clone AEGIS
git clone https://github.com/k5tuck/aegis.git
cd aegis

# Install MCP server dependencies
cd mcp-server
npm install

# Configure API keys
cp .env.example .env
# Edit .env with your API keys

# Start MCP server
npm run dev
```

### Enable in Unreal Engine

1. Enable **Remote Control API** plugin (Edit > Plugins > Remote Control)
2. Copy `ue-plugin` folder to your project's Plugins directory
3. Restart editor
4. Open **Window > AEGIS Assistant**

## 📖 Usage

### Basic Commands

```
"Spawn a cube at (0, 0, 100)"
"Create a Blueprint called BP_Enemy that extends Character"
"Delete all actors with tag 'Temporary'"
"Set the material of PlayerStart to M_Glowing"
```

### Safe Mode

Safe Mode previews changes before execution:

1. Send command → Receive preview with changes list
2. Review risk assessment (low/medium/high/critical)
3. Approve or reject
4. Changes applied only after approval

### Configuration

Edit `config/aegis.config.ts`:

```typescript
export default {
  model: {
    primary: 'claude',
    fallback: ['openai', 'ollama'],
  },
  safeMode: {
    enabled: true,
    autoApproveLevel: 'low',
  },
  security: {
    maxActionsPerMinute: 60,
    maxDeletesPerSession: 50,
  },
};
```

## 🔌 Extending AEGIS

### Writing Plugins

Create `my-plugin.plugin.ts`:

```typescript
import { AegisPlugin, CommandDefinition } from '@aegis/registry';
import { z } from 'zod';

const myCommand: CommandDefinition = {
  name: 'my_action',
  description: 'Does something cool',
  shortDescription: 'Cool action',
  paramsSchema: z.object({
    target: z.string(),
  }),
  annotations: {
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
    riskLevel: 'low',
    requiresApproval: false,
    runtimeCapable: false,
  },
  execute: async (params, context) => {
    context.logger.info('Executing my action', { target: params.target });
    // Your logic here
    return { success: true };
  },
};

export default {
  metadata: {
    id: 'my-plugin',
    name: 'My Plugin',
    version: '1.0.0',
    namespace: 'myplugin',
    description: 'My custom AEGIS plugin',
    supportsRuntime: false,
  },
  commands: [myCommand],
} satisfies AegisPlugin;
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- --testPathPattern=sandbox

# Run with coverage
npm test -- --coverage

# Run E2E tests (requires UE running)
npm run test:e2e
```

## 📊 Architecture

```
┌──────────────────┐     ┌──────────────────┐
│   UE Editor      │     │   MCP Server     │
│  ┌────────────┐  │     │  ┌────────────┐  │
│  │ AEGIS      │◄─┼─────┼─►│ Adapters   │  │
│  │ Plugin     │  │HTTP │  │ (Claude+)  │  │
│  └────────────┘  │     │  └────────────┘  │
│        │         │     │        │         │
│        ▼         │     │        ▼         │
│  ┌────────────┐  │     │  ┌────────────┐  │
│  │ Remote     │◄─┼─────┼─►│ Tools &    │  │
│  │ Control    │  │     │  │ Registry   │  │
│  └────────────┘  │     │  └────────────┘  │
└──────────────────┘     └──────────────────┘
```

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
```

### Getting Started Guide (docs/guides/getting-started.md)

```markdown
# Getting Started with AEGIS

This guide walks you through your first AEGIS session.

## Prerequisites

Before starting, ensure you have:
- Unreal Engine 5.4+ installed
- Node.js 20+ installed
- A Claude API key (recommended) or OpenAI API key

## Step 1: Set Up the MCP Server

```bash
cd aegis/mcp-server
npm install
cp .env.example .env
```

Edit `.env`:
```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...  # Optional fallback
UE_HOST=localhost
UE_PORT=30020
LOG_LEVEL=info
```

Start the server:
```bash
npm run dev
```

## Step 2: Configure Unreal Engine

1. Open your UE project
2. Go to **Edit > Plugins**
3. Search for "Remote Control"
4. Enable **Remote Control API**
5. Restart the editor

## Step 3: Install the UE Plugin

Copy the plugin:
```bash
cp -r aegis/ue-plugin ~/UnrealProjects/MyProject/Plugins/Aegis
```

Rebuild the project or restart the editor.

## Step 4: Open AEGIS Assistant

1. Go to **Window > AEGIS Assistant**
2. The panel should show "Connected" status
3. If disconnected, check that the MCP server is running

## Step 5: Try Your First Command

In the AEGIS chat panel, type:

```
Spawn a cube at the center of the level
```

AEGIS will:
1. Interpret your request
2. Show a preview (if Safe Mode is on)
3. Create a StaticMeshActor with a cube mesh

## Step 6: Explore More Commands

Try these:
- "List all actors in the level"
- "Create a Blueprint called BP_Pickup"
- "Delete all temporary actors"
- "Set the sky light intensity to 2.0"

## Next Steps

- Read [Configuration Guide](configuration.md) for customization
- Learn about [Safe Mode](safe-mode.md) for production use
- Write your own [Plugins](writing-plugins.md)
```

### Error Reference (docs/api/errors.md)

```markdown
# AEGIS Error Reference

## Error Codes

### UE_CONNECTION_FAILED
**Cause**: Cannot connect to Unreal Engine Remote Control API

**Solutions**:
- Verify UE is running
- Check Remote Control API plugin is enabled
- Confirm port 30020 is accessible
- Check firewall settings

### COMMAND_VALIDATION_FAILED
**Cause**: Command parameters don't match schema

**Solutions**:
- Review command documentation
- Check parameter types
- Ensure required fields are provided

### ACTOR_NOT_FOUND
**Cause**: Referenced actor doesn't exist

**Solutions**:
- Use `query_actors` to list available actors
- Verify actor path spelling (case-sensitive)
- Check if actor is in loaded sub-level

### BLUEPRINT_COMPILE_ERROR
**Cause**: Blueprint has compilation errors

**Solutions**:
- Check Output Log for details
- Fix broken node connections
- Update deprecated nodes

### SECURITY_VIOLATION
**Cause**: Action blocked by security policy

**Solutions**:
- Review security settings
- Request policy adjustment from admin
- Use alternative approach

### RATE_LIMIT_EXCEEDED
**Cause**: Too many actions in time window

**Solutions**:
- Wait before sending more commands
- Batch operations together
- Adjust rate limit in config

### PREVIEW_EXPIRED
**Cause**: Action preview timed out

**Solutions**:
- Create a new preview
- Increase preview timeout in config
- Approve previews more quickly

### MODEL_ADAPTER_ERROR
**Cause**: AI model API error

**Solutions**:
- Verify API key is valid
- Check API quota/credits
- Try fallback adapter

### PLUGIN_LOAD_ERROR
**Cause**: Plugin failed to load

**Solutions**:
- Check plugin syntax
- Verify dependencies are installed
- Review plugin version compatibility
```

---

## 📋 Implementation Checklist

### Phase 0: Setup ✅
- [ ] Clone reference MCP projects
- [ ] Fork and clone UE5.4
- [ ] Initialize project structure
- [ ] Set up development environment

### Phase 1: Architecture ✅
- [ ] Finalize component design
- [ ] Define API contracts
- [ ] Document data flows

### Phase 2: MCP Server 🔧
- [ ] Custom error classes
- [ ] Logger with pino
- [ ] Unified command schema (Zod)
- [ ] UE Remote Control bridge
- [ ] Tool implementations
- [ ] Feedback loop manager

### Phase 3: UE Plugin 🔧
- [ ] AegisTypes.h definitions
- [ ] MCP HTTP client
- [ ] SAegisPanel (main UI)
- [ ] SAegisChatView
- [ ] SAegisPreviewPanel
- [ ] SAegisSettingsPanel
- [ ] Plugin module setup

### Phase 4: Model Adapters 🔧
- [ ] Base adapter interface
- [ ] Claude adapter (PRIMARY)
- [ ] OpenAI adapter
- [ ] DeepSeek adapter
- [ ] Ollama adapter
- [ ] Adapter manager with fallback

### Phase 5: Security 🔧
- [ ] Security sandbox
- [ ] Safe mode manager
- [ ] Rate limiting
- [ ] Action audit logging
- [ ] Permission system

### Phase 6: Command Registry 🔧
- [ ] Plugin interface
- [ ] Plugin loader (hot-reload)
- [ ] Command registry
- [ ] Namespace router
- [ ] Validation pipeline

### Phase 7: Testing 🔧
- [ ] Unit test suite
- [ ] Integration tests
- [ ] E2E test scenarios
- [ ] MCP evaluation questions
- [ ] CI/CD pipeline

### Phase 8: Documentation 🔧
- [ ] README.md
- [ ] API reference
- [ ] User guides
- [ ] Architecture docs
- [ ] Plugin development guide

---

## 🎯 Success Criteria

### Minimum Viable Product (MVP)
1. ✅ Chat interface in UE Editor
2. ✅ Basic actor operations (spawn, modify, delete, query)
3. ✅ Safe Mode with preview/approve workflow
4. ✅ Claude adapter working
5. ✅ Basic error handling with feedback

### Production Ready
1. ✅ All model adapters functional
2. ✅ Plugin system with hot-reload
3. ✅ 80%+ test coverage
4. ✅ Complete documentation
5. ✅ Security audit passed
6. ✅ Performance benchmarks met

### Enterprise Scale
1. ✅ Multi-user support
2. ✅ Audit logging
3. ✅ Role-based permissions
4. ✅ Seed Protocol integration
5. ✅ Cloud deployment option

---

## 🔑 Key Design Decisions

### Why Claude as Primary?
- Best tool use capabilities among current models
- Strongest reasoning for complex UE tasks
- Most reliable structured output
- Excellent at following schemas

### Why TypeScript for MCP Server?
- Official MCP SDK has best TypeScript support
- Good for streaming HTTP transport
- AI models generate quality TS code
- Strong typing catches errors early

### Why Hot-Reload Plugins?
- Rapid iteration during development
- No server restart needed
- Live debugging of plugin logic
- Better developer experience

### Why Safe Mode by Default?
- Prevents accidental destructive actions
- Gives developers confidence
- Audit trail for changes
- Essential for production use

---

## 📝 Notes for Implementation

1. **Start with core commands**: spawn_actor, modify_actor, delete_actor, query_actors
2. **Test with simple scenarios** before adding complexity
3. **Keep the UE plugin thin**: Most logic should be in MCP server
4. **Document as you build**: Don't leave docs for later
5. **Write tests alongside features**: Easier to maintain coverage
6. **Use the reference projects**: VibeUE has the most comprehensive action list
7. **Follow MCP best practices**: Read the evaluation guide for quality checks

---

## 🚀 Getting Started Command

```bash
# Quick start for development
cd ~/projects/aegis
./scripts/setup.sh  # Run setup script (creates dirs, installs deps)
./scripts/dev.sh    # Start MCP server in dev mode with hot-reload
```

Then open Unreal Engine and connect the AEGIS plugin!

---

*Document Version: 1.0.0*
*Last Updated: 2024*
*Author: AEGIS Development Team*
