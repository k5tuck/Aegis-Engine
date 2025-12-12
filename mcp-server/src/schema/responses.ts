/**
 * AEGIS Response Type Definitions
 * Standardized response structures for all commands
 */

import { z } from 'zod';
import { Vector3DSchema, RotatorSchema, TransformSchema, LinearColorSchema } from './commands.js';

// ============================================================================
// Base Response Schemas
// ============================================================================

/**
 * Standard success response
 */
export const SuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  timestamp: z.string().datetime(),
});

/**
 * Standard error response
 */
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    suggestion: z.string().optional(),
    recoverable: z.boolean(),
  }),
  timestamp: z.string().datetime(),
});

/**
 * Base response union
 */
export const BaseResponseSchema = z.discriminatedUnion('success', [
  SuccessResponseSchema,
  ErrorResponseSchema,
]);

// ============================================================================
// Preview Response Schemas
// ============================================================================

export const ChangeTypeSchema = z.enum(['create', 'modify', 'delete', 'move']);

export const ChangePreviewSchema = z.object({
  type: ChangeTypeSchema,
  target: z.string(),
  description: z.string(),
  before: z.record(z.unknown()).optional(),
  after: z.record(z.unknown()).optional(),
});

export const RiskAssessmentSchema = z.object({
  level: z.enum(['low', 'medium', 'high', 'critical']),
  factors: z.array(z.string()),
  reversible: z.boolean(),
  estimatedImpact: z.string(),
});

export const ActionPreviewResponseSchema = z.object({
  success: z.literal(true),
  requiresApproval: z.literal(true),
  previewId: z.string().uuid(),
  command: z.string(),
  params: z.record(z.unknown()),
  changes: z.array(ChangePreviewSchema),
  riskAssessment: RiskAssessmentSchema,
  expiresAt: z.string().datetime(),
  timestamp: z.string().datetime(),
});

export const PreviewApprovalResponseSchema = z.object({
  success: z.literal(true),
  previewId: z.string().uuid(),
  approved: z.boolean(),
  executed: z.boolean().optional(),
  result: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime(),
});

// ============================================================================
// Actor Response Schemas
// ============================================================================

export const ActorInfoSchema = z.object({
  path: z.string(),
  label: z.string(),
  class: z.string(),
  tags: z.array(z.string()).optional(),
  folder: z.string().optional(),
  transform: TransformSchema.optional(),
  properties: z.record(z.unknown()).optional(),
  children: z.array(z.string()).optional(),
  parent: z.string().optional(),
});

export const SpawnActorResponseSchema = SuccessResponseSchema.extend({
  actor: ActorInfoSchema,
});

export const ModifyActorResponseSchema = SuccessResponseSchema.extend({
  actor: ActorInfoSchema,
  modifiedProperties: z.array(z.string()),
});

export const DeleteActorResponseSchema = SuccessResponseSchema.extend({
  deletedPath: z.string(),
  deletedChildren: z.array(z.string()).optional(),
});

export const QueryActorsResponseSchema = SuccessResponseSchema.extend({
  actors: z.array(ActorInfoSchema),
  total: z.number().int(),
  truncated: z.boolean().optional(),
});

export const MoveActorResponseSchema = SuccessResponseSchema.extend({
  actor: ActorInfoSchema,
  previousTransform: TransformSchema,
});

export const DuplicateActorResponseSchema = SuccessResponseSchema.extend({
  originalPath: z.string(),
  duplicatePath: z.string(),
  duplicateActor: ActorInfoSchema,
});

// ============================================================================
// Blueprint Response Schemas
// ============================================================================

export const BlueprintComponentInfoSchema = z.object({
  name: z.string(),
  class: z.string(),
  parent: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
});

export const BlueprintVariableInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
  category: z.string().optional(),
  defaultValue: z.unknown().optional(),
});

export const BlueprintInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  parentClass: z.string(),
  components: z.array(BlueprintComponentInfoSchema).optional(),
  variables: z.array(BlueprintVariableInfoSchema).optional(),
  isCompiled: z.boolean(),
  hasErrors: z.boolean(),
});

export const CreateBlueprintResponseSchema = SuccessResponseSchema.extend({
  blueprint: BlueprintInfoSchema,
});

export const CompileBlueprintResponseSchema = SuccessResponseSchema.extend({
  blueprintPath: z.string(),
  compiled: z.boolean(),
  errors: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
});

export const ModifyBlueprintResponseSchema = SuccessResponseSchema.extend({
  blueprint: BlueprintInfoSchema,
  modifications: z.object({
    addedComponents: z.array(z.string()).optional(),
    removedComponents: z.array(z.string()).optional(),
    modifiedComponents: z.array(z.string()).optional(),
    addedVariables: z.array(z.string()).optional(),
    removedVariables: z.array(z.string()).optional(),
  }),
});

// ============================================================================
// Asset Response Schemas
// ============================================================================

export const AssetInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  class: z.string(),
  diskSize: z.number().optional(),
  isLoaded: z.boolean().optional(),
  referencers: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
});

export const QueryAssetsResponseSchema = SuccessResponseSchema.extend({
  assets: z.array(AssetInfoSchema),
  total: z.number().int(),
  truncated: z.boolean().optional(),
});

export const ImportAssetResponseSchema = SuccessResponseSchema.extend({
  asset: AssetInfoSchema,
  sourcePath: z.string(),
});

export const DeleteAssetResponseSchema = SuccessResponseSchema.extend({
  deletedPath: z.string(),
  referencersUpdated: z.array(z.string()).optional(),
});

export const RenameAssetResponseSchema = SuccessResponseSchema.extend({
  previousPath: z.string(),
  newPath: z.string(),
  asset: AssetInfoSchema,
});

export const MoveAssetResponseSchema = SuccessResponseSchema.extend({
  previousPath: z.string(),
  newPath: z.string(),
  asset: AssetInfoSchema,
});

export const DuplicateAssetResponseSchema = SuccessResponseSchema.extend({
  originalPath: z.string(),
  duplicatePath: z.string(),
  asset: AssetInfoSchema,
});

// ============================================================================
// Level Response Schemas
// ============================================================================

export const SubLevelInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  isLoaded: z.boolean(),
  isVisible: z.boolean(),
});

export const LevelInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  actorCount: z.number().int().optional(),
  subLevels: z.array(SubLevelInfoSchema).optional(),
  worldSettings: z.record(z.unknown()).optional(),
});

export const OpenLevelResponseSchema = SuccessResponseSchema.extend({
  level: LevelInfoSchema,
});

export const SaveLevelResponseSchema = SuccessResponseSchema.extend({
  savedPath: z.string(),
});

export const CreateLevelResponseSchema = SuccessResponseSchema.extend({
  level: LevelInfoSchema,
});

export const QueryLevelResponseSchema = SuccessResponseSchema.extend({
  level: LevelInfoSchema,
});

// ============================================================================
// Material Response Schemas
// ============================================================================

export const MaterialParameterInfoSchema = z.object({
  name: z.string(),
  type: z.enum(['scalar', 'vector', 'texture']),
  value: z.union([z.number(), LinearColorSchema, z.string()]),
});

export const MaterialInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  parentMaterial: z.string().optional(),
  isInstance: z.boolean(),
  parameters: z.array(MaterialParameterInfoSchema).optional(),
});

export const CreateMaterialResponseSchema = SuccessResponseSchema.extend({
  material: MaterialInfoSchema,
});

export const ModifyMaterialResponseSchema = SuccessResponseSchema.extend({
  material: MaterialInfoSchema,
  modifiedParameters: z.array(z.string()),
});

export const CreateMaterialInstanceResponseSchema = SuccessResponseSchema.extend({
  materialInstance: MaterialInfoSchema,
});

// ============================================================================
// Viewport Response Schemas
// ============================================================================

export const ViewportInfoSchema = z.object({
  index: z.number().int(),
  location: Vector3DSchema,
  rotation: RotatorSchema,
  fov: z.number().optional(),
  viewMode: z.string().optional(),
});

export const SetViewportCameraResponseSchema = SuccessResponseSchema.extend({
  viewport: ViewportInfoSchema,
  previousLocation: Vector3DSchema,
  previousRotation: RotatorSchema,
});

export const FocusActorResponseSchema = SuccessResponseSchema.extend({
  actorPath: z.string(),
  viewport: ViewportInfoSchema,
});

export const TakeScreenshotResponseSchema = SuccessResponseSchema.extend({
  outputPath: z.string(),
  resolution: z.object({
    width: z.number().int(),
    height: z.number().int(),
  }),
  fileSize: z.number().int(),
});

// ============================================================================
// Project Response Schemas
// ============================================================================

export const PluginInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  category: z.string().optional(),
});

export const ProjectInfoSchema = z.object({
  name: z.string(),
  engineVersion: z.string(),
  projectPath: z.string(),
  plugins: z.array(PluginInfoSchema).optional(),
  settings: z.record(z.unknown()).optional(),
});

export const GetProjectInfoResponseSchema = SuccessResponseSchema.extend({
  project: ProjectInfoSchema,
});

export const EditorStateSchema = z.object({
  selectedActors: z.array(z.string()).optional(),
  viewport: ViewportInfoSchema.optional(),
  currentLevel: z.string().optional(),
  contentBrowserPath: z.string().optional(),
});

export const GetEditorStateResponseSchema = SuccessResponseSchema.extend({
  state: EditorStateSchema,
});

// ============================================================================
// Response Type Registry
// ============================================================================

export const ResponseSchemas = {
  // Actor responses
  'aegis.core.spawn_actor': SpawnActorResponseSchema,
  'aegis.core.modify_actor': ModifyActorResponseSchema,
  'aegis.core.delete_actor': DeleteActorResponseSchema,
  'aegis.core.query_actors': QueryActorsResponseSchema,
  'aegis.core.move_actor': MoveActorResponseSchema,
  'aegis.core.duplicate_actor': DuplicateActorResponseSchema,

  // Blueprint responses
  'aegis.core.create_blueprint': CreateBlueprintResponseSchema,
  'aegis.core.compile_blueprint': CompileBlueprintResponseSchema,
  'aegis.core.modify_blueprint': ModifyBlueprintResponseSchema,

  // Asset responses
  'aegis.core.query_assets': QueryAssetsResponseSchema,
  'aegis.core.import_asset': ImportAssetResponseSchema,
  'aegis.core.delete_asset': DeleteAssetResponseSchema,
  'aegis.core.rename_asset': RenameAssetResponseSchema,
  'aegis.core.move_asset': MoveAssetResponseSchema,
  'aegis.core.duplicate_asset': DuplicateAssetResponseSchema,

  // Level responses
  'aegis.core.open_level': OpenLevelResponseSchema,
  'aegis.core.save_level': SaveLevelResponseSchema,
  'aegis.core.create_level': CreateLevelResponseSchema,
  'aegis.core.query_level': QueryLevelResponseSchema,

  // Material responses
  'aegis.core.create_material': CreateMaterialResponseSchema,
  'aegis.core.modify_material': ModifyMaterialResponseSchema,
  'aegis.core.create_material_instance': CreateMaterialInstanceResponseSchema,

  // Viewport responses
  'aegis.core.set_viewport_camera': SetViewportCameraResponseSchema,
  'aegis.core.focus_actor': FocusActorResponseSchema,
  'aegis.core.take_screenshot': TakeScreenshotResponseSchema,

  // Project responses
  'aegis.core.get_project_info': GetProjectInfoResponseSchema,
  'aegis.core.get_editor_state': GetEditorStateResponseSchema,

  // Preview responses
  preview: ActionPreviewResponseSchema,
  'preview.approval': PreviewApprovalResponseSchema,
} as const;

export type ResponseName = keyof typeof ResponseSchemas;
export type ResponseType<T extends ResponseName> = z.infer<(typeof ResponseSchemas)[T]>;

// ============================================================================
// Response Builders
// ============================================================================

/**
 * Create a success response with timestamp
 */
export function createSuccessResponse<T extends Record<string, unknown>>(
  data: T,
  message?: string
): T & { success: true; timestamp: string; message?: string } {
  return {
    ...data,
    success: true as const,
    timestamp: new Date().toISOString(),
    ...(message && { message }),
  };
}

/**
 * Create an error response
 */
export function createErrorResponse(
  code: string,
  message: string,
  options?: {
    details?: Record<string, unknown>;
    suggestion?: string;
    recoverable?: boolean;
  }
): z.infer<typeof ErrorResponseSchema> {
  return {
    success: false as const,
    error: {
      code,
      message,
      details: options?.details,
      suggestion: options?.suggestion,
      recoverable: options?.recoverable ?? false,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a preview response
 */
export function createPreviewResponse(
  previewId: string,
  command: string,
  params: Record<string, unknown>,
  changes: z.infer<typeof ChangePreviewSchema>[],
  riskAssessment: z.infer<typeof RiskAssessmentSchema>,
  expiresAt: Date
): z.infer<typeof ActionPreviewResponseSchema> {
  return {
    success: true as const,
    requiresApproval: true as const,
    previewId,
    command,
    params,
    changes,
    riskAssessment,
    expiresAt: expiresAt.toISOString(),
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Type Exports
// ============================================================================

export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type BaseResponse = z.infer<typeof BaseResponseSchema>;
export type ChangePreview = z.infer<typeof ChangePreviewSchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
export type ActionPreviewResponse = z.infer<typeof ActionPreviewResponseSchema>;
export type ActorInfo = z.infer<typeof ActorInfoSchema>;
export type BlueprintInfo = z.infer<typeof BlueprintInfoSchema>;
export type AssetInfo = z.infer<typeof AssetInfoSchema>;
export type LevelInfo = z.infer<typeof LevelInfoSchema>;
export type MaterialInfo = z.infer<typeof MaterialInfoSchema>;
export type ViewportInfo = z.infer<typeof ViewportInfoSchema>;
export type ProjectInfo = z.infer<typeof ProjectInfoSchema>;
export type EditorState = z.infer<typeof EditorStateSchema>;
