/**
 * AEGIS Unified Command Schema Definitions
 * Model-agnostic, versioned, extensible command schemas using Zod
 */

import { z } from 'zod';

// ============================================================================
// Base Schemas - Common types used across commands
// ============================================================================

export const Vector2DSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const Vector3DSchema = z.object({
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
  location: Vector3DSchema,
  rotation: RotatorSchema,
  scale: Vector3DSchema.optional().default({ x: 1, y: 1, z: 1 }),
});

export const ColorSchema = z.object({
  r: z.number().min(0).max(255),
  g: z.number().min(0).max(255),
  b: z.number().min(0).max(255),
  a: z.number().min(0).max(255).optional().default(255),
});

export const LinearColorSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
  a: z.number().min(0).max(1).optional().default(1),
});

export const BoundingBox2DSchema = z.object({
  min: Vector2DSchema,
  max: Vector2DSchema,
});

export const BoundingBox3DSchema = z.object({
  min: Vector3DSchema,
  max: Vector3DSchema,
});

// ============================================================================
// Tool Annotations Schema - Metadata for AI safety and execution
// ============================================================================

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const ToolAnnotationsSchema = z.object({
  readOnly: z.boolean().default(false).describe('Does not modify any state'),
  destructive: z.boolean().default(false).describe('Can cause data loss'),
  idempotent: z.boolean().default(true).describe('Same result on repeated calls'),
  openWorld: z.boolean().default(false).describe('Affects external systems'),
  estimatedDuration: z.number().optional().describe('Expected execution time in ms'),
  riskLevel: RiskLevelSchema.default('low'),
  requiresApproval: z.boolean().default(false).describe('Requires user approval in safe mode'),
  runtimeCapable: z.boolean().default(false).describe('Can run during gameplay'),
});

export type ToolAnnotations = z.infer<typeof ToolAnnotationsSchema>;

// ============================================================================
// Actor Operation Schemas
// ============================================================================

export const SpawnActorSchema = z.object({
  actorClass: z.string().describe('Blueprint or native class path (e.g., /Game/BP_MyActor or StaticMeshActor)'),
  transform: TransformSchema.describe('World transform for the actor'),
  label: z.string().optional().describe('Display name in World Outliner'),
  folder: z.string().optional().describe('World Outliner folder path'),
  properties: z.record(z.unknown()).optional().describe('Initial property values to set'),
  tags: z.array(z.string()).optional().describe('Actor tags'),
  attachTo: z.string().optional().describe('Parent actor path to attach to'),
  attachSocket: z.string().optional().describe('Socket name if attaching'),
});

export const ModifyActorSchema = z.object({
  actorPath: z.string().describe('Full path to the actor'),
  properties: z.record(z.unknown()).describe('Properties to modify'),
  transform: TransformSchema.partial().optional().describe('Transform changes'),
});

export const DeleteActorSchema = z.object({
  actorPath: z.string().describe('Full path to the actor'),
  recursive: z.boolean().default(false).describe('Delete attached children'),
});

export const QueryActorsSchema = z.object({
  filter: z
    .object({
      class: z.string().optional().describe('Filter by class name'),
      label: z.string().optional().describe('Filter by label pattern (supports *)'),
      tag: z.string().optional().describe('Filter by tag'),
      folder: z.string().optional().describe('Filter by folder'),
      bounds: BoundingBox3DSchema.optional().describe('Filter by location'),
    })
    .optional(),
  limit: z.number().int().min(1).max(10000).default(100).describe('Maximum results'),
  includeTransform: z.boolean().default(true).describe('Include transform data'),
  includeProperties: z.array(z.string()).optional().describe('Specific properties to include'),
});

export const MoveActorSchema = z.object({
  actorPath: z.string().describe('Full path to the actor'),
  location: Vector3DSchema.optional().describe('New world location'),
  rotation: RotatorSchema.optional().describe('New world rotation'),
  relative: z.boolean().default(false).describe('Treat as relative offset'),
});

export const DuplicateActorSchema = z.object({
  actorPath: z.string().describe('Full path to the actor to duplicate'),
  transform: TransformSchema.optional().describe('Transform for duplicate'),
  newLabel: z.string().optional().describe('Label for duplicate'),
  folder: z.string().optional().describe('Folder for duplicate'),
});

// ============================================================================
// Blueprint Operation Schemas
// ============================================================================

export const BlueprintComponentSchema = z.object({
  class: z.string().describe('Component class name'),
  name: z.string().describe('Component name'),
  attachTo: z.string().optional().describe('Parent component name'),
  properties: z.record(z.unknown()).optional().describe('Component properties'),
});

export const CreateBlueprintSchema = z.object({
  name: z.string().describe('Blueprint name'),
  parentClass: z.string().describe('Parent class path'),
  path: z.string().describe('Asset path (e.g., /Game/Blueprints/)'),
  components: z.array(BlueprintComponentSchema).optional().describe('Components to add'),
  variables: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        defaultValue: z.unknown().optional(),
        category: z.string().optional(),
      })
    )
    .optional()
    .describe('Variables to create'),
});

export const CompileBlueprintSchema = z.object({
  blueprintPath: z.string().describe('Full blueprint asset path'),
  validateOnly: z.boolean().default(false).describe('Only validate without saving'),
});

export const ModifyBlueprintSchema = z.object({
  blueprintPath: z.string().describe('Full blueprint asset path'),
  addComponents: z.array(BlueprintComponentSchema).optional(),
  removeComponents: z.array(z.string()).optional(),
  modifyComponents: z
    .array(
      z.object({
        name: z.string(),
        properties: z.record(z.unknown()),
      })
    )
    .optional(),
  addVariables: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        defaultValue: z.unknown().optional(),
      })
    )
    .optional(),
  removeVariables: z.array(z.string()).optional(),
});

// ============================================================================
// Asset Operation Schemas
// ============================================================================

export const QueryAssetsSchema = z.object({
  path: z.string().optional().describe('Asset path to search (supports wildcards)'),
  class: z.string().optional().describe('Filter by asset class'),
  recursive: z.boolean().default(true).describe('Search subdirectories'),
  limit: z.number().int().min(1).max(10000).default(100),
});

export const ImportAssetSchema = z.object({
  sourcePath: z.string().describe('Source file path'),
  destinationPath: z.string().describe('Destination asset path'),
  assetName: z.string().optional().describe('Asset name (defaults to filename)'),
  importSettings: z.record(z.unknown()).optional().describe('Import settings'),
});

export const DeleteAssetSchema = z.object({
  assetPath: z.string().describe('Full asset path'),
  force: z.boolean().default(false).describe('Delete even if referenced'),
});

export const RenameAssetSchema = z.object({
  assetPath: z.string().describe('Current asset path'),
  newName: z.string().describe('New asset name'),
});

export const MoveAssetSchema = z.object({
  assetPath: z.string().describe('Current asset path'),
  destinationPath: z.string().describe('New directory path'),
});

export const DuplicateAssetSchema = z.object({
  assetPath: z.string().describe('Asset to duplicate'),
  newPath: z.string().describe('Path for duplicate'),
  newName: z.string().optional().describe('Name for duplicate'),
});

// ============================================================================
// Level Operation Schemas
// ============================================================================

export const OpenLevelSchema = z.object({
  levelPath: z.string().describe('Level asset path'),
});

export const SaveLevelSchema = z.object({
  levelPath: z.string().optional().describe('Level to save (current if omitted)'),
});

export const CreateLevelSchema = z.object({
  levelPath: z.string().describe('New level asset path'),
  template: z.string().optional().describe('Template level to use'),
});

export const QueryLevelSchema = z.object({
  levelPath: z.string().optional().describe('Level to query (current if omitted)'),
  includeActorCount: z.boolean().default(true),
  includeSublevels: z.boolean().default(true),
});

// ============================================================================
// Material Operation Schemas
// ============================================================================

export const CreateMaterialSchema = z.object({
  name: z.string().describe('Material name'),
  path: z.string().describe('Asset path'),
  parentMaterial: z.string().optional().describe('Parent material to inherit from'),
  parameters: z
    .object({
      scalars: z.record(z.number()).optional(),
      vectors: z.record(LinearColorSchema).optional(),
      textures: z.record(z.string()).optional(),
    })
    .optional(),
});

export const ModifyMaterialSchema = z.object({
  materialPath: z.string().describe('Material asset path'),
  parameters: z.object({
    scalars: z.record(z.number()).optional(),
    vectors: z.record(LinearColorSchema).optional(),
    textures: z.record(z.string()).optional(),
  }),
});

export const CreateMaterialInstanceSchema = z.object({
  name: z.string().describe('Instance name'),
  path: z.string().describe('Asset path'),
  parentMaterial: z.string().describe('Parent material path'),
  parameters: z
    .object({
      scalars: z.record(z.number()).optional(),
      vectors: z.record(LinearColorSchema).optional(),
      textures: z.record(z.string()).optional(),
    })
    .optional(),
});

// ============================================================================
// Camera and Viewport Schemas
// ============================================================================

export const SetViewportCameraSchema = z.object({
  location: Vector3DSchema,
  rotation: RotatorSchema,
  viewportIndex: z.number().int().min(0).default(0),
});

export const FocusActorSchema = z.object({
  actorPath: z.string().describe('Actor to focus on'),
  instant: z.boolean().default(false).describe('Instant or animated transition'),
});

export const TakeScreenshotSchema = z.object({
  outputPath: z.string().describe('Output file path'),
  resolution: z
    .object({
      width: z.number().int().min(1).max(8192),
      height: z.number().int().min(1).max(8192),
    })
    .optional(),
  viewportIndex: z.number().int().min(0).default(0),
});

// ============================================================================
// Project Query Schemas
// ============================================================================

export const GetProjectInfoSchema = z.object({
  includePlugins: z.boolean().default(false),
  includeSettings: z.boolean().default(false),
});

export const GetEditorStateSchema = z.object({
  includeSelection: z.boolean().default(true),
  includeViewport: z.boolean().default(true),
  includeContentBrowser: z.boolean().default(false),
});

// ============================================================================
// Command Registry - Maps command names to schemas
// ============================================================================

export const CommandSchemas = {
  // Actor commands
  'aegis.core.spawn_actor': SpawnActorSchema,
  'aegis.core.modify_actor': ModifyActorSchema,
  'aegis.core.delete_actor': DeleteActorSchema,
  'aegis.core.query_actors': QueryActorsSchema,
  'aegis.core.move_actor': MoveActorSchema,
  'aegis.core.duplicate_actor': DuplicateActorSchema,

  // Blueprint commands
  'aegis.core.create_blueprint': CreateBlueprintSchema,
  'aegis.core.compile_blueprint': CompileBlueprintSchema,
  'aegis.core.modify_blueprint': ModifyBlueprintSchema,

  // Asset commands
  'aegis.core.query_assets': QueryAssetsSchema,
  'aegis.core.import_asset': ImportAssetSchema,
  'aegis.core.delete_asset': DeleteAssetSchema,
  'aegis.core.rename_asset': RenameAssetSchema,
  'aegis.core.move_asset': MoveAssetSchema,
  'aegis.core.duplicate_asset': DuplicateAssetSchema,

  // Level commands
  'aegis.core.open_level': OpenLevelSchema,
  'aegis.core.save_level': SaveLevelSchema,
  'aegis.core.create_level': CreateLevelSchema,
  'aegis.core.query_level': QueryLevelSchema,

  // Material commands
  'aegis.core.create_material': CreateMaterialSchema,
  'aegis.core.modify_material': ModifyMaterialSchema,
  'aegis.core.create_material_instance': CreateMaterialInstanceSchema,

  // Viewport commands
  'aegis.core.set_viewport_camera': SetViewportCameraSchema,
  'aegis.core.focus_actor': FocusActorSchema,
  'aegis.core.take_screenshot': TakeScreenshotSchema,

  // Project commands
  'aegis.core.get_project_info': GetProjectInfoSchema,
  'aegis.core.get_editor_state': GetEditorStateSchema,
} as const;

export type CommandName = keyof typeof CommandSchemas;
export type CommandParams<T extends CommandName> = z.infer<(typeof CommandSchemas)[T]>;

// Type helper for getting schema by command name
export function getCommandSchema<T extends CommandName>(
  commandName: T
): (typeof CommandSchemas)[T] {
  return CommandSchemas[commandName];
}

// Validate command exists
export function isValidCommand(commandName: string): commandName is CommandName {
  return commandName in CommandSchemas;
}
