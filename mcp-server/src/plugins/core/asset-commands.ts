/**
 * AEGIS Core Plugin - Asset Commands
 * Commands for managing assets (import, search, export, etc.)
 */

import { z } from 'zod';
import { CommandDefinition, CommandContext } from '../../registry/plugin-types.js';
import { BridgeManager } from '../../bridge/index.js';
import { AssetImportError, ExecutionError } from '../../utils/errors.js';

// ============================================================================
// Schemas
// ============================================================================

const SearchAssetsParamsSchema = z.object({
  searchPath: z.string().optional().describe('Path to search in (e.g., /Game/Meshes)'),
  searchQuery: z.string().optional().describe('Search query string'),
  assetTypes: z.array(z.string()).optional().describe('Filter by asset types (e.g., StaticMesh, Material)'),
  limit: z.number().int().positive().optional().default(50).describe('Maximum results'),
  recursive: z.boolean().optional().default(true).describe('Search subdirectories'),
});

const LoadAssetParamsSchema = z.object({
  assetPath: z.string().describe('Path to the asset to load'),
  forceReload: z.boolean().optional().default(false).describe('Force reload even if already loaded'),
});

const ImportAssetParamsSchema = z.object({
  sourcePath: z.string().describe('Source file path on disk'),
  destinationPath: z.string().describe('Destination path in project (e.g., /Game/Meshes)'),
  assetName: z.string().describe('Name for the imported asset'),
  importOptions: z.record(z.unknown()).optional().describe('Import-specific options'),
});

const ExportAssetParamsSchema = z.object({
  assetPath: z.string().describe('Path to the asset to export'),
  destinationPath: z.string().describe('Destination file path on disk'),
  exportOptions: z.record(z.unknown()).optional().describe('Export-specific options'),
});

const DuplicateAssetParamsSchema = z.object({
  assetPath: z.string().describe('Path to the asset to duplicate'),
  newName: z.string().describe('Name for the duplicated asset'),
  newPath: z.string().optional().describe('Destination path (defaults to same folder)'),
});

const RenameAssetParamsSchema = z.object({
  assetPath: z.string().describe('Path to the asset to rename'),
  newName: z.string().describe('New name for the asset'),
});

const DeleteAssetParamsSchema = z.object({
  assetPath: z.string().describe('Path to the asset to delete'),
  force: z.boolean().optional().default(false).describe('Force delete even if asset has references'),
});

const GetAssetReferencesParamsSchema = z.object({
  assetPath: z.string().describe('Path to the asset'),
  includeReferencers: z.boolean().optional().default(true).describe('Include assets that reference this one'),
  includeDependencies: z.boolean().optional().default(true).describe('Include assets this one depends on'),
});

const CreateFolderParamsSchema = z.object({
  folderPath: z.string().describe('Path for the new folder (e.g., /Game/NewFolder)'),
});

const GetAssetInfoParamsSchema = z.object({
  assetPath: z.string().describe('Path to the asset'),
  includeMetadata: z.boolean().optional().default(true).describe('Include asset metadata'),
  includeThumbnail: z.boolean().optional().default(false).describe('Include thumbnail data'),
});

// ============================================================================
// Response Types
// ============================================================================

interface SearchAssetsResult {
  assets: Array<{
    path: string;
    name: string;
    type: string;
    package: string;
    diskSize?: number;
  }>;
  totalCount: number;
}

interface LoadAssetResult {
  assetPath: string;
  objectPath: string;
  loaded: boolean;
}

interface ImportAssetResult {
  assetPath: string;
  assetType: string;
  importedObjects: string[];
}

interface DuplicateAssetResult {
  newAssetPath: string;
  originalPath: string;
}

interface GetAssetReferencesResult {
  assetPath: string;
  referencers: string[];
  dependencies: string[];
}

interface GetAssetInfoResult {
  path: string;
  name: string;
  type: string;
  package: string;
  diskSize?: number;
  memorySize?: number;
  metadata?: Record<string, unknown>;
  thumbnail?: string; // Base64 encoded
}

// ============================================================================
// Command Implementations
// ============================================================================

export function createAssetCommands(bridge: BridgeManager): CommandDefinition[] {
  return [
    // ========================================================================
    // search_assets
    // ========================================================================
    {
      name: 'search_assets',
      description: 'Search for assets in the project',
      inputSchema: SearchAssetsParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'asset',
        tags: ['search', 'find', 'asset', 'content'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<SearchAssetsResult> => {
        const params = context.params as z.infer<typeof SearchAssetsParamsSchema>;

        const searchPath = params.searchPath || '/Game';

        const result = await bridge.remoteControl.searchAssets(searchPath, {
          classNames: params.assetTypes,
          limit: params.limit,
        });

        if (!result.success) {
          throw new ExecutionError(
            'search_assets',
            result.error || 'Failed to search assets',
            { searchPath }
          );
        }

        let assets = result.data || [];

        // Apply search query filter
        if (params.searchQuery) {
          const query = params.searchQuery.toLowerCase();
          assets = assets.filter(
            (a) =>
              a.name.toLowerCase().includes(query) ||
              a.path.toLowerCase().includes(query)
          );
        }

        return {
          assets: assets.map((a) => ({
            path: a.path,
            name: a.name,
            type: a.class,
            package: a.package,
          })),
          totalCount: assets.length,
        };
      },
    },

    // ========================================================================
    // load_asset
    // ========================================================================
    {
      name: 'load_asset',
      description: 'Load an asset into memory',
      inputSchema: LoadAssetParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'asset',
        tags: ['load', 'asset', 'memory'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<LoadAssetResult> => {
        const params = context.params as z.infer<typeof LoadAssetParamsSchema>;

        const result = await bridge.remoteControl.loadAsset(params.assetPath);

        if (!result.success || !result.data) {
          throw new ExecutionError(
            'load_asset',
            result.error || 'Failed to load asset',
            { assetPath: params.assetPath }
          );
        }

        return {
          assetPath: params.assetPath,
          objectPath: result.data.objectPath,
          loaded: true,
        };
      },
    },

    // ========================================================================
    // import_asset
    // ========================================================================
    {
      name: 'import_asset',
      description: 'Import an asset from disk into the project',
      inputSchema: ImportAssetParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'asset',
        tags: ['import', 'asset', 'file'],
        estimatedDuration: 'slow',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<ImportAssetResult> => {
        const params = context.params as z.infer<typeof ImportAssetParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{
          ReturnValue: {
            Success: boolean;
            ImportedAssets: string[];
            AssetType: string;
            Error?: string;
          };
        }>(
          '/Script/UnrealEd.Default__AssetToolsHelpers',
          'ImportAssets',
          {
            SourceFilename: params.sourcePath,
            DestinationPath: params.destinationPath,
            AssetName: params.assetName,
            ImportOptions: params.importOptions,
          }
        );

        if (!result.success || !result.data?.ReturnValue.Success) {
          throw new AssetImportError(
            params.sourcePath,
            result.data?.ReturnValue.Error || result.error || 'Import failed'
          );
        }

        const assetPath = `${params.destinationPath}/${params.assetName}`;

        // Record change
        bridge.stateSync.recordChange({
          type: 'asset',
          target: assetPath,
          changeType: 'create',
          newValue: { sourcePath: params.sourcePath },
          source: 'local',
          undoable: true,
        });

        return {
          assetPath,
          assetType: result.data.ReturnValue.AssetType,
          importedObjects: result.data.ReturnValue.ImportedAssets,
        };
      },
    },

    // ========================================================================
    // export_asset
    // ========================================================================
    {
      name: 'export_asset',
      description: 'Export an asset to disk',
      inputSchema: ExportAssetParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'asset',
        tags: ['export', 'asset', 'file'],
        estimatedDuration: 'medium',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ exported: boolean; exportPath: string }> => {
        const params = context.params as z.infer<typeof ExportAssetParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/UnrealEd.Default__AssetToolsHelpers',
          'ExportAssets',
          {
            AssetPath: params.assetPath,
            ExportFilename: params.destinationPath,
            ExportOptions: params.exportOptions,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'export_asset',
            result.error || 'Failed to export asset',
            { assetPath: params.assetPath }
          );
        }

        return {
          exported: true,
          exportPath: params.destinationPath,
        };
      },
    },

    // ========================================================================
    // duplicate_asset
    // ========================================================================
    {
      name: 'duplicate_asset',
      description: 'Duplicate an existing asset',
      inputSchema: DuplicateAssetParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'asset',
        tags: ['duplicate', 'copy', 'asset'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<DuplicateAssetResult> => {
        const params = context.params as z.infer<typeof DuplicateAssetParamsSchema>;

        // Extract original folder if newPath not provided
        const originalFolder = params.assetPath.substring(0, params.assetPath.lastIndexOf('/'));
        const destinationPath = params.newPath || originalFolder;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: string }>(
          '/Script/UnrealEd.Default__EditorAssetSubsystem',
          'DuplicateAsset',
          {
            SourceAssetPath: params.assetPath,
            DestinationAssetPath: `${destinationPath}/${params.newName}`,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'duplicate_asset',
            result.error || 'Failed to duplicate asset',
            { assetPath: params.assetPath }
          );
        }

        const newAssetPath = result.data.ReturnValue;

        // Record change
        bridge.stateSync.recordChange({
          type: 'asset',
          target: newAssetPath,
          changeType: 'create',
          newValue: { duplicatedFrom: params.assetPath },
          source: 'local',
          undoable: true,
        });

        return {
          newAssetPath,
          originalPath: params.assetPath,
        };
      },
    },

    // ========================================================================
    // rename_asset
    // ========================================================================
    {
      name: 'rename_asset',
      description: 'Rename an asset',
      inputSchema: RenameAssetParamsSchema,
      annotations: {
        riskLevel: 'medium',
        category: 'asset',
        tags: ['rename', 'asset'],
        estimatedDuration: 'fast',
        requiresPreview: true,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ oldPath: string; newPath: string }> => {
        const params = context.params as z.infer<typeof RenameAssetParamsSchema>;

        const folder = params.assetPath.substring(0, params.assetPath.lastIndexOf('/'));
        const newPath = `${folder}/${params.newName}`;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/UnrealEd.Default__EditorAssetSubsystem',
          'RenameAsset',
          {
            SourceAssetPath: params.assetPath,
            DestinationAssetPath: newPath,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'rename_asset',
            result.error || 'Failed to rename asset',
            { assetPath: params.assetPath }
          );
        }

        // Record change
        bridge.stateSync.recordChange({
          type: 'asset',
          target: params.assetPath,
          changeType: 'modify',
          previousValue: { path: params.assetPath },
          newValue: { path: newPath },
          source: 'local',
          undoable: true,
        });

        return {
          oldPath: params.assetPath,
          newPath,
        };
      },
    },

    // ========================================================================
    // delete_asset
    // ========================================================================
    {
      name: 'delete_asset',
      description: 'Delete an asset from the project',
      inputSchema: DeleteAssetParamsSchema,
      annotations: {
        riskLevel: 'critical',
        category: 'asset',
        tags: ['delete', 'remove', 'asset'],
        estimatedDuration: 'fast',
        requiresPreview: true,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<{ deleted: boolean; assetPath: string }> => {
        const params = context.params as z.infer<typeof DeleteAssetParamsSchema>;

        // Check for references first
        if (!params.force) {
          const refsResult = await bridge.remoteControl.callFunction<{
            ReturnValue: { Referencers: string[] };
          }>(
            '/Script/UnrealEd.Default__EditorAssetSubsystem',
            'GetReferencers',
            { AssetPath: params.assetPath }
          );

          if (refsResult.success && refsResult.data?.ReturnValue.Referencers.length > 0) {
            throw new ExecutionError(
              'delete_asset',
              `Asset has ${refsResult.data.ReturnValue.Referencers.length} references. Use force=true to delete anyway.`,
              { assetPath: params.assetPath, referencers: refsResult.data.ReturnValue.Referencers }
            );
          }
        }

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/UnrealEd.Default__EditorAssetSubsystem',
          'DeleteAsset',
          {
            AssetPath: params.assetPath,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'delete_asset',
            result.error || 'Failed to delete asset',
            { assetPath: params.assetPath }
          );
        }

        // Record change (not undoable for deletes)
        bridge.stateSync.recordChange({
          type: 'asset',
          target: params.assetPath,
          changeType: 'delete',
          source: 'local',
          undoable: false,
        });

        return {
          deleted: true,
          assetPath: params.assetPath,
        };
      },
    },

    // ========================================================================
    // get_asset_references
    // ========================================================================
    {
      name: 'get_asset_references',
      description: 'Get references to and from an asset',
      inputSchema: GetAssetReferencesParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'asset',
        tags: ['references', 'dependencies', 'asset'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<GetAssetReferencesResult> => {
        const params = context.params as z.infer<typeof GetAssetReferencesParamsSchema>;

        const result: GetAssetReferencesResult = {
          assetPath: params.assetPath,
          referencers: [],
          dependencies: [],
        };

        if (params.includeReferencers) {
          const refsResult = await bridge.remoteControl.callFunction<{
            ReturnValue: string[];
          }>(
            '/Script/AssetRegistry.Default__AssetRegistryHelpers',
            'GetReferencers',
            { PackageName: params.assetPath }
          );

          if (refsResult.success && refsResult.data) {
            result.referencers = refsResult.data.ReturnValue;
          }
        }

        if (params.includeDependencies) {
          const depsResult = await bridge.remoteControl.callFunction<{
            ReturnValue: string[];
          }>(
            '/Script/AssetRegistry.Default__AssetRegistryHelpers',
            'GetDependencies',
            { PackageName: params.assetPath }
          );

          if (depsResult.success && depsResult.data) {
            result.dependencies = depsResult.data.ReturnValue;
          }
        }

        return result;
      },
    },

    // ========================================================================
    // create_folder
    // ========================================================================
    {
      name: 'create_folder',
      description: 'Create a new folder in the content browser',
      inputSchema: CreateFolderParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'asset',
        tags: ['folder', 'create', 'content'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: true,
      },
      handler: async (context: CommandContext): Promise<{ folderPath: string; created: boolean }> => {
        const params = context.params as z.infer<typeof CreateFolderParamsSchema>;

        const result = await bridge.remoteControl.callFunction<{ ReturnValue: boolean }>(
          '/Script/UnrealEd.Default__EditorAssetSubsystem',
          'MakeDirectory',
          {
            DirectoryPath: params.folderPath,
          }
        );

        if (!result.success || !result.data?.ReturnValue) {
          throw new ExecutionError(
            'create_folder',
            result.error || 'Failed to create folder',
            { folderPath: params.folderPath }
          );
        }

        return {
          folderPath: params.folderPath,
          created: true,
        };
      },
    },

    // ========================================================================
    // get_asset_info
    // ========================================================================
    {
      name: 'get_asset_info',
      description: 'Get detailed information about an asset',
      inputSchema: GetAssetInfoParamsSchema,
      annotations: {
        riskLevel: 'low',
        category: 'asset',
        tags: ['info', 'details', 'asset'],
        estimatedDuration: 'fast',
        requiresPreview: false,
        supportsUndo: false,
      },
      handler: async (context: CommandContext): Promise<GetAssetInfoResult> => {
        const params = context.params as z.infer<typeof GetAssetInfoParamsSchema>;

        // Get cached asset or fetch
        const cachedAsset = await bridge.stateSync.getAsset(params.assetPath, true);

        const result: GetAssetInfoResult = {
          path: params.assetPath,
          name: cachedAsset?.info.name || params.assetPath.split('/').pop() || '',
          type: cachedAsset?.info.class || 'Unknown',
          package: cachedAsset?.info.package || '',
        };

        if (params.includeMetadata) {
          const metaResult = await bridge.remoteControl.callFunction<{
            ReturnValue: Record<string, unknown>;
          }>(
            '/Script/UnrealEd.Default__EditorAssetSubsystem',
            'GetAssetMetaData',
            { AssetPath: params.assetPath }
          );

          if (metaResult.success && metaResult.data) {
            result.metadata = metaResult.data.ReturnValue;
          }
        }

        if (params.includeThumbnail) {
          const thumbResult = await bridge.remoteControl.callFunction<{
            ReturnValue: string;
          }>(
            '/Script/UnrealEd.Default__ThumbnailManager',
            'GetThumbnailAsBase64',
            { AssetPath: params.assetPath }
          );

          if (thumbResult.success && thumbResult.data) {
            result.thumbnail = thumbResult.data.ReturnValue;
          }
        }

        return result;
      },
    },
  ];
}
