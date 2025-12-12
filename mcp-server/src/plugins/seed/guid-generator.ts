/**
 * AEGIS Seed Protocol - GUID Generator
 * Deterministic GUID generation for reproducible world states
 */

import { CommandDefinition } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { z } from 'zod';
import * as crypto from 'crypto';

// ============================================================================
// GUID Schemas
// ============================================================================

const GUIDNamespaceSchema = z.enum([
  'actor',
  'component',
  'asset',
  'blueprint',
  'material',
  'landscape',
  'foliage',
  'pcg',
  'ai',
  'custom',
]);

const GenerateGUIDParamsSchema = z.object({
  namespace: GUIDNamespaceSchema.describe('The namespace for GUID generation'),
  seed: z.string().optional().describe('Optional seed for deterministic generation'),
  entityType: z.string().describe('Type of entity (e.g., StaticMeshActor, Blueprint)'),
  entityName: z.string().optional().describe('Name of the entity'),
  parentGUID: z.string().optional().describe('Parent entity GUID for hierarchy'),
  metadata: z.record(z.any()).optional().describe('Additional metadata for GUID generation'),
});

const BatchGenerateGUIDParamsSchema = z.object({
  namespace: GUIDNamespaceSchema,
  seed: z.string().optional(),
  count: z.number().min(1).max(10000).describe('Number of GUIDs to generate'),
  entityType: z.string(),
  prefix: z.string().optional().describe('Optional prefix for entity names'),
});

const ValidateGUIDParamsSchema = z.object({
  guid: z.string().describe('GUID to validate'),
  expectedNamespace: GUIDNamespaceSchema.optional(),
});

const ResolveGUIDParamsSchema = z.object({
  guid: z.string().describe('GUID to resolve to entity'),
});

const RegisterGUIDParamsSchema = z.object({
  guid: z.string().describe('GUID to register'),
  entityPath: z.string().describe('Path to the entity in UE'),
  entityType: z.string(),
  metadata: z.record(z.any()).optional(),
});

// ============================================================================
// GUID Registry State
// ============================================================================

interface GUIDEntry {
  guid: string;
  namespace: string;
  entityType: string;
  entityPath: string;
  entityName: string;
  parentGUID?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  version: number;
}

const guidRegistry = new Map<string, GUIDEntry>();
const pathToGuidMap = new Map<string, string>();
let currentSeed: string = '';
let seedCounter: number = 0;

// ============================================================================
// GUID Generation Functions
// ============================================================================

/**
 * Generate a deterministic GUID based on seed and inputs
 */
function generateDeterministicGUID(
  namespace: string,
  entityType: string,
  seed: string,
  counter: number,
  entityName?: string,
  parentGUID?: string
): string {
  // Create deterministic input string
  const inputParts = [
    namespace,
    entityType,
    seed,
    counter.toString(),
    entityName || '',
    parentGUID || '',
  ];

  const inputString = inputParts.join(':');

  // Use SHA-256 to generate deterministic hash
  const hash = crypto.createHash('sha256').update(inputString).digest('hex');

  // Format as UUID-like string with namespace prefix
  const namespaceCode = getNamespaceCode(namespace);
  const guid = `${namespaceCode}-${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 28)}`;

  return guid.toUpperCase();
}

/**
 * Get short namespace code for GUID prefix
 */
function getNamespaceCode(namespace: string): string {
  const codes: Record<string, string> = {
    actor: 'ACT',
    component: 'CMP',
    asset: 'AST',
    blueprint: 'BPT',
    material: 'MAT',
    landscape: 'LND',
    foliage: 'FOL',
    pcg: 'PCG',
    ai: 'AIN',
    custom: 'CUS',
  };
  return codes[namespace] || 'UNK';
}

/**
 * Validate GUID format
 */
function validateGUIDFormat(guid: string): {
  valid: boolean;
  namespace?: string;
  error?: string;
} {
  const pattern = /^([A-Z]{3})-([A-F0-9]{8})-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{12})$/;
  const match = guid.match(pattern);

  if (!match) {
    return {
      valid: false,
      error: 'Invalid GUID format. Expected: XXX-XXXXXXXX-XXXX-XXXX-XXXXXXXXXXXX',
    };
  }

  const namespaceCode = match[1];
  const namespaceMap: Record<string, string> = {
    ACT: 'actor',
    CMP: 'component',
    AST: 'asset',
    BPT: 'blueprint',
    MAT: 'material',
    LND: 'landscape',
    FOL: 'foliage',
    PCG: 'pcg',
    AIN: 'ai',
    CUS: 'custom',
  };

  const namespace = namespaceMap[namespaceCode];
  if (!namespace) {
    return {
      valid: false,
      error: `Unknown namespace code: ${namespaceCode}`,
    };
  }

  return {
    valid: true,
    namespace,
  };
}

// ============================================================================
// Command Implementations
// ============================================================================

/**
 * Create GUID generator commands
 */
export function createGUIDCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // generate_guid - Generate deterministic GUID
    // ========================================================================
    {
      name: 'generate_guid',
      description: 'Generate a deterministic GUID for an entity based on seed and parameters',
      category: 'seed',
      parameters: GenerateGUIDParamsSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = GenerateGUIDParamsSchema.parse(params);

        // Set seed if provided, otherwise use current
        if (validatedParams.seed) {
          if (validatedParams.seed !== currentSeed) {
            currentSeed = validatedParams.seed;
            seedCounter = 0;
          }
        } else if (!currentSeed) {
          // Generate random seed if none set
          currentSeed = crypto.randomBytes(16).toString('hex');
          seedCounter = 0;
        }

        // Generate GUID
        const guid = generateDeterministicGUID(
          validatedParams.namespace,
          validatedParams.entityType,
          currentSeed,
          seedCounter++,
          validatedParams.entityName,
          validatedParams.parentGUID
        );

        logger?.info('Generated GUID', {
          guid,
          namespace: validatedParams.namespace,
          entityType: validatedParams.entityType,
        });

        return {
          success: true,
          guid,
          namespace: validatedParams.namespace,
          entityType: validatedParams.entityType,
          seed: currentSeed,
          counter: seedCounter - 1,
          metadata: validatedParams.metadata,
        };
      },
    },

    // ========================================================================
    // batch_generate_guids - Generate multiple GUIDs
    // ========================================================================
    {
      name: 'batch_generate_guids',
      description: 'Generate multiple deterministic GUIDs in a batch',
      category: 'seed',
      parameters: BatchGenerateGUIDParamsSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = BatchGenerateGUIDParamsSchema.parse(params);

        // Set seed if provided
        if (validatedParams.seed) {
          if (validatedParams.seed !== currentSeed) {
            currentSeed = validatedParams.seed;
            seedCounter = 0;
          }
        } else if (!currentSeed) {
          currentSeed = crypto.randomBytes(16).toString('hex');
          seedCounter = 0;
        }

        const guids: Array<{
          guid: string;
          entityName: string;
          counter: number;
        }> = [];

        const startCounter = seedCounter;

        for (let i = 0; i < validatedParams.count; i++) {
          const entityName = validatedParams.prefix
            ? `${validatedParams.prefix}_${i}`
            : `${validatedParams.entityType}_${i}`;

          const guid = generateDeterministicGUID(
            validatedParams.namespace,
            validatedParams.entityType,
            currentSeed,
            seedCounter++,
            entityName
          );

          guids.push({
            guid,
            entityName,
            counter: seedCounter - 1,
          });
        }

        logger?.info('Batch generated GUIDs', {
          count: validatedParams.count,
          namespace: validatedParams.namespace,
        });

        return {
          success: true,
          guids,
          namespace: validatedParams.namespace,
          entityType: validatedParams.entityType,
          seed: currentSeed,
          startCounter,
          endCounter: seedCounter - 1,
          totalGenerated: guids.length,
        };
      },
    },

    // ========================================================================
    // validate_guid - Validate GUID format and lookup
    // ========================================================================
    {
      name: 'validate_guid',
      description: 'Validate a GUID format and optionally check its registration',
      category: 'seed',
      parameters: ValidateGUIDParamsSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = ValidateGUIDParamsSchema.parse(params);

        // Validate format
        const formatResult = validateGUIDFormat(validatedParams.guid);

        if (!formatResult.valid) {
          return {
            success: false,
            valid: false,
            error: formatResult.error,
          };
        }

        // Check namespace if expected
        if (
          validatedParams.expectedNamespace &&
          formatResult.namespace !== validatedParams.expectedNamespace
        ) {
          return {
            success: true,
            valid: false,
            error: `Namespace mismatch. Expected: ${validatedParams.expectedNamespace}, Got: ${formatResult.namespace}`,
            actualNamespace: formatResult.namespace,
          };
        }

        // Check registration
        const entry = guidRegistry.get(validatedParams.guid);

        return {
          success: true,
          valid: true,
          guid: validatedParams.guid,
          namespace: formatResult.namespace,
          registered: !!entry,
          entry: entry
            ? {
                entityPath: entry.entityPath,
                entityType: entry.entityType,
                entityName: entry.entityName,
                createdAt: entry.createdAt.toISOString(),
                version: entry.version,
              }
            : null,
        };
      },
    },

    // ========================================================================
    // resolve_guid - Resolve GUID to entity
    // ========================================================================
    {
      name: 'resolve_guid',
      description: 'Resolve a GUID to its corresponding entity in Unreal Engine',
      category: 'seed',
      parameters: ResolveGUIDParamsSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = ResolveGUIDParamsSchema.parse(params);

        // Check local registry first
        const entry = guidRegistry.get(validatedParams.guid);

        if (entry) {
          // Verify entity still exists in UE
          try {
            const result = await bridge.remoteControl.callFunction(
              '/Script/AegisBridge.AegisSeedSubsystem',
              'VerifyGUIDEntity',
              {
                GUID: validatedParams.guid,
                EntityPath: entry.entityPath,
              }
            );

            const exists = result.success && result.data?.exists;

            return {
              success: true,
              found: true,
              verified: exists,
              guid: validatedParams.guid,
              entity: {
                path: entry.entityPath,
                type: entry.entityType,
                name: entry.entityName,
                metadata: entry.metadata,
              },
              warning: !exists ? 'Entity may have been deleted or moved' : undefined,
            };
          } catch {
            // Can't verify, return cached data
            return {
              success: true,
              found: true,
              verified: false,
              guid: validatedParams.guid,
              entity: {
                path: entry.entityPath,
                type: entry.entityType,
                name: entry.entityName,
                metadata: entry.metadata,
              },
              warning: 'Could not verify entity existence',
            };
          }
        }

        // Try to resolve from UE
        try {
          const result = await bridge.remoteControl.callFunction(
            '/Script/AegisBridge.AegisSeedSubsystem',
            'ResolveGUID',
            { GUID: validatedParams.guid }
          );

          if (result.success && result.data?.found) {
            return {
              success: true,
              found: true,
              verified: true,
              guid: validatedParams.guid,
              entity: result.data.entity,
            };
          }
        } catch (error) {
          logger?.warn('Failed to resolve GUID from UE', { guid: validatedParams.guid, error });
        }

        return {
          success: true,
          found: false,
          guid: validatedParams.guid,
          error: 'GUID not found in registry or Unreal Engine',
        };
      },
    },

    // ========================================================================
    // register_guid - Register GUID with entity
    // ========================================================================
    {
      name: 'register_guid',
      description: 'Register a GUID with its corresponding entity',
      category: 'seed',
      parameters: RegisterGUIDParamsSchema,
      handler: async ({ params, logger }) => {
        const validatedParams = RegisterGUIDParamsSchema.parse(params);

        // Validate GUID format
        const formatResult = validateGUIDFormat(validatedParams.guid);
        if (!formatResult.valid) {
          return {
            success: false,
            error: formatResult.error,
          };
        }

        // Check for existing registration
        const existingEntry = guidRegistry.get(validatedParams.guid);
        const existingPath = pathToGuidMap.get(validatedParams.entityPath);

        if (existingEntry && existingEntry.entityPath !== validatedParams.entityPath) {
          return {
            success: false,
            error: 'GUID already registered to different entity',
            existingPath: existingEntry.entityPath,
          };
        }

        if (existingPath && existingPath !== validatedParams.guid) {
          return {
            success: false,
            error: 'Entity path already has different GUID',
            existingGUID: existingPath,
          };
        }

        // Extract entity name from path
        const pathParts = validatedParams.entityPath.split('/');
        const entityName = pathParts[pathParts.length - 1] || validatedParams.entityPath;

        // Create entry
        const entry: GUIDEntry = {
          guid: validatedParams.guid,
          namespace: formatResult.namespace!,
          entityType: validatedParams.entityType,
          entityPath: validatedParams.entityPath,
          entityName,
          metadata: validatedParams.metadata || {},
          createdAt: new Date(),
          version: existingEntry ? existingEntry.version + 1 : 1,
        };

        // Register in local cache
        guidRegistry.set(validatedParams.guid, entry);
        pathToGuidMap.set(validatedParams.entityPath, validatedParams.guid);

        // Register in UE
        try {
          await bridge.remoteControl.callFunction(
            '/Script/AegisBridge.AegisSeedSubsystem',
            'RegisterGUID',
            {
              GUID: validatedParams.guid,
              EntityPath: validatedParams.entityPath,
              EntityType: validatedParams.entityType,
              Metadata: JSON.stringify(validatedParams.metadata || {}),
            }
          );
        } catch (error) {
          logger?.warn('Failed to register GUID in UE (cached locally)', { error });
        }

        logger?.info('Registered GUID', {
          guid: validatedParams.guid,
          entityPath: validatedParams.entityPath,
        });

        return {
          success: true,
          registered: true,
          guid: validatedParams.guid,
          entry: {
            namespace: entry.namespace,
            entityType: entry.entityType,
            entityPath: entry.entityPath,
            entityName: entry.entityName,
            version: entry.version,
          },
        };
      },
    },

    // ========================================================================
    // set_seed - Set the global seed for GUID generation
    // ========================================================================
    {
      name: 'set_seed',
      description: 'Set the global seed for deterministic GUID generation',
      category: 'seed',
      parameters: z.object({
        seed: z.string().describe('The seed string for deterministic generation'),
        resetCounter: z.boolean().optional().default(true).describe('Reset the counter to 0'),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z
          .object({
            seed: z.string(),
            resetCounter: z.boolean().optional().default(true),
          })
          .parse(params);

        const previousSeed = currentSeed;
        const previousCounter = seedCounter;

        currentSeed = validatedParams.seed;
        if (validatedParams.resetCounter) {
          seedCounter = 0;
        }

        // Propagate to UE
        try {
          await bridge.remoteControl.callFunction(
            '/Script/AegisBridge.AegisSeedSubsystem',
            'SetGlobalSeed',
            {
              Seed: currentSeed,
              ResetCounter: validatedParams.resetCounter,
            }
          );
        } catch (error) {
          logger?.warn('Failed to set seed in UE', { error });
        }

        logger?.info('Set global seed', { seed: currentSeed, counter: seedCounter });

        return {
          success: true,
          seed: currentSeed,
          counter: seedCounter,
          previous: {
            seed: previousSeed,
            counter: previousCounter,
          },
        };
      },
    },

    // ========================================================================
    // get_seed_info - Get current seed information
    // ========================================================================
    {
      name: 'get_seed_info',
      description: 'Get current seed and counter information',
      category: 'seed',
      parameters: z.object({}),
      handler: async ({ logger }) => {
        return {
          success: true,
          seed: currentSeed || null,
          counter: seedCounter,
          registeredGUIDs: guidRegistry.size,
          registeredPaths: pathToGuidMap.size,
        };
      },
    },

    // ========================================================================
    // list_guids - List registered GUIDs
    // ========================================================================
    {
      name: 'list_guids',
      description: 'List registered GUIDs with optional filtering',
      category: 'seed',
      parameters: z.object({
        namespace: GUIDNamespaceSchema.optional(),
        entityType: z.string().optional(),
        limit: z.number().min(1).max(1000).optional().default(100),
        offset: z.number().min(0).optional().default(0),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z
          .object({
            namespace: GUIDNamespaceSchema.optional(),
            entityType: z.string().optional(),
            limit: z.number().optional().default(100),
            offset: z.number().optional().default(0),
          })
          .parse(params);

        let entries = Array.from(guidRegistry.values());

        // Filter by namespace
        if (validatedParams.namespace) {
          entries = entries.filter((e) => e.namespace === validatedParams.namespace);
        }

        // Filter by entity type
        if (validatedParams.entityType) {
          entries = entries.filter((e) => e.entityType === validatedParams.entityType);
        }

        const total = entries.length;

        // Apply pagination
        entries = entries.slice(
          validatedParams.offset,
          validatedParams.offset + validatedParams.limit
        );

        return {
          success: true,
          guids: entries.map((e) => ({
            guid: e.guid,
            namespace: e.namespace,
            entityType: e.entityType,
            entityPath: e.entityPath,
            entityName: e.entityName,
            createdAt: e.createdAt.toISOString(),
          })),
          total,
          offset: validatedParams.offset,
          limit: validatedParams.limit,
        };
      },
    },

    // ========================================================================
    // clear_guid_registry - Clear the local GUID registry
    // ========================================================================
    {
      name: 'clear_guid_registry',
      description: 'Clear all GUIDs from the local registry',
      category: 'seed',
      parameters: z.object({
        confirm: z.boolean().describe('Must be true to confirm clearing'),
        clearUE: z.boolean().optional().default(false).describe('Also clear UE registry'),
      }),
      handler: async ({ params, logger }) => {
        const validatedParams = z
          .object({
            confirm: z.boolean(),
            clearUE: z.boolean().optional().default(false),
          })
          .parse(params);

        if (!validatedParams.confirm) {
          return {
            success: false,
            error: 'Must confirm clearing with confirm: true',
          };
        }

        const clearedCount = guidRegistry.size;

        guidRegistry.clear();
        pathToGuidMap.clear();

        if (validatedParams.clearUE) {
          try {
            await bridge.remoteControl.callFunction(
              '/Script/AegisBridge.AegisSeedSubsystem',
              'ClearGUIDRegistry'
            );
          } catch (error) {
            logger?.warn('Failed to clear UE GUID registry', { error });
          }
        }

        logger?.info('Cleared GUID registry', { clearedCount });

        return {
          success: true,
          clearedCount,
          clearedUE: validatedParams.clearUE,
        };
      },
    },
  ];
}

// ============================================================================
// Exports
// ============================================================================

export {
  generateDeterministicGUID,
  validateGUIDFormat,
  guidRegistry,
  pathToGuidMap,
  GUIDNamespaceSchema,
};
