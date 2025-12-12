/**
 * AEGIS Plugin Loader
 * Handles plugin discovery, loading, and hot-reloading
 */

import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { Logger } from '../utils/logger.js';
import { PluginLoadError } from '../utils/errors.js';
import {
  AegisPlugin,
  PluginMetadata,
  RegisteredPlugin,
  PluginStatus,
  PluginLoadContext,
  PluginMetadataSchema,
  isAegisPlugin,
  isCommandDefinition,
} from './plugin-types.js';

// ============================================================================
// Types
// ============================================================================

export interface PluginLoaderConfig {
  /** Directories to search for plugins */
  pluginDirs: string[];

  /** Enable hot-reload of plugins */
  hotReload: boolean;

  /** Debounce time for hot-reload (ms) */
  hotReloadDebounceMs: number;

  /** File patterns to watch for plugins */
  filePatterns: string[];

  /** Ignore patterns */
  ignorePatterns: string[];

  /** Maximum plugin load time (ms) */
  loadTimeoutMs: number;

  /** Enable strict mode (fail on any error) */
  strictMode: boolean;
}

export interface PluginLoadResult {
  success: boolean;
  plugin?: AegisPlugin;
  error?: string;
  loadTimeMs: number;
}

export interface PluginLoaderEvents {
  onPluginLoaded?: (plugin: RegisteredPlugin) => void;
  onPluginUnloaded?: (pluginId: string) => void;
  onPluginError?: (pluginId: string, error: Error) => void;
  onPluginReloaded?: (plugin: RegisteredPlugin) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: PluginLoaderConfig = {
  pluginDirs: ['./plugins'],
  hotReload: true,
  hotReloadDebounceMs: 1000,
  filePatterns: ['*.plugin.ts', '*.plugin.js', 'index.ts', 'index.js'],
  ignorePatterns: ['node_modules', '.git', '*.test.ts', '*.spec.ts'],
  loadTimeoutMs: 30000,
  strictMode: false,
};

// ============================================================================
// Plugin Loader Implementation
// ============================================================================

export class PluginLoader {
  private plugins: Map<string, RegisteredPlugin> = new Map();
  private watcher: chokidar.FSWatcher | null = null;
  private config: PluginLoaderConfig;
  private logger: Logger;
  private context: PluginLoadContext;
  private events: PluginLoaderEvents;
  private reloadTimers: Map<string, NodeJS.Timeout> = new Map();
  private loadOrder: string[] = [];

  constructor(
    config: Partial<PluginLoaderConfig>,
    context: PluginLoadContext,
    logger: Logger,
    events?: PluginLoaderEvents
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.context = context;
    this.logger = logger.child({ component: 'PluginLoader' });
    this.events = events || {};
  }

  /**
   * Initialize the plugin loader and load all plugins
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing plugin loader', {
      pluginDirs: this.config.pluginDirs,
      hotReload: this.config.hotReload,
    });

    // Load plugins from all directories
    for (const dir of this.config.pluginDirs) {
      const absoluteDir = path.resolve(dir);
      if (fs.existsSync(absoluteDir)) {
        await this.loadPluginsFromDirectory(absoluteDir);
      } else {
        this.logger.warn('Plugin directory does not exist', { dir: absoluteDir });
      }
    }

    // Setup hot-reload if enabled
    if (this.config.hotReload) {
      this.setupHotReload();
    }

    this.logger.info('Plugin loader initialized', {
      pluginCount: this.plugins.size,
      loadOrder: this.loadOrder,
    });
  }

  /**
   * Shutdown the plugin loader
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down plugin loader');

    // Stop watching
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // Clear reload timers
    for (const timer of this.reloadTimers.values()) {
      clearTimeout(timer);
    }
    this.reloadTimers.clear();

    // Unload all plugins in reverse order
    for (const pluginId of [...this.loadOrder].reverse()) {
      try {
        await this.unloadPlugin(pluginId);
      } catch (error) {
        this.logger.error('Error unloading plugin during shutdown', error as Error, { pluginId });
      }
    }

    this.logger.info('Plugin loader shutdown complete');
  }

  /**
   * Load a plugin from a file path
   */
  async loadPlugin(pluginPath: string): Promise<PluginLoadResult> {
    const startTime = Date.now();

    try {
      this.logger.debug('Loading plugin', { path: pluginPath });

      // Clear module cache for hot-reload
      const absolutePath = path.resolve(pluginPath);
      delete require.cache[require.resolve(absolutePath)];

      // Import the plugin module
      const module = await import(absolutePath);
      const plugin: AegisPlugin = module.default || module;

      // Validate plugin structure
      if (!isAegisPlugin(plugin)) {
        throw new Error('Invalid plugin structure: missing required properties');
      }

      // Validate metadata
      const metadataResult = PluginMetadataSchema.safeParse(plugin.metadata);
      if (!metadataResult.success) {
        throw new Error(`Invalid plugin metadata: ${metadataResult.error.message}`);
      }

      // Validate commands
      for (const command of plugin.commands) {
        if (!isCommandDefinition(command)) {
          throw new Error(`Invalid command definition: ${command.name || 'unknown'}`);
        }
      }

      // Check dependencies
      await this.checkDependencies(plugin);

      // Unload existing version if present
      const existingPlugin = this.plugins.get(plugin.metadata.id);
      if (existingPlugin) {
        await this.unloadPlugin(plugin.metadata.id);
      }

      // Call onLoad hook
      if (plugin.onLoad) {
        await Promise.race([
          plugin.onLoad({
            ...this.context,
            pluginPath: path.dirname(absolutePath),
          }),
          this.createTimeout(this.config.loadTimeoutMs, 'Plugin onLoad timed out'),
        ]);
      }

      // Register the plugin
      const registered: RegisteredPlugin = {
        plugin,
        path: absolutePath,
        loadedAt: new Date(),
        status: 'loaded',
        commandCount: plugin.commands.length,
      };

      this.plugins.set(plugin.metadata.id, registered);
      this.loadOrder.push(plugin.metadata.id);

      // Notify listeners
      if (this.events.onPluginLoaded) {
        this.events.onPluginLoaded(registered);
      }

      const loadTimeMs = Date.now() - startTime;
      this.logger.info('Plugin loaded', {
        id: plugin.metadata.id,
        version: plugin.metadata.version,
        commands: plugin.commands.length,
        loadTimeMs,
      });

      return {
        success: true,
        plugin,
        loadTimeMs,
      };
    } catch (error) {
      const loadTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error('Failed to load plugin', error as Error, { path: pluginPath });

      if (this.config.strictMode) {
        throw new PluginLoadError(pluginPath, errorMessage);
      }

      return {
        success: false,
        error: errorMessage,
        loadTimeMs,
      };
    }
  }

  /**
   * Unload a plugin by ID
   */
  async unloadPlugin(pluginId: string): Promise<boolean> {
    const registered = this.plugins.get(pluginId);
    if (!registered) {
      return false;
    }

    try {
      this.logger.debug('Unloading plugin', { id: pluginId });

      registered.status = 'unloading';

      // Call onUnload hook
      if (registered.plugin.onUnload) {
        try {
          await Promise.race([
            registered.plugin.onUnload({
              ...this.context,
              pluginPath: path.dirname(registered.path),
            }),
            this.createTimeout(5000, 'Plugin onUnload timed out'),
          ]);
        } catch (error) {
          this.logger.warn('Error in plugin onUnload', { id: pluginId, error });
        }
      }

      // Remove from registry
      this.plugins.delete(pluginId);
      this.loadOrder = this.loadOrder.filter((id) => id !== pluginId);

      // Notify listeners
      if (this.events.onPluginUnloaded) {
        this.events.onPluginUnloaded(pluginId);
      }

      this.logger.info('Plugin unloaded', { id: pluginId });
      return true;
    } catch (error) {
      this.logger.error('Error unloading plugin', error as Error, { id: pluginId });
      registered.status = 'error';
      registered.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * Reload a plugin
   */
  async reloadPlugin(pluginId: string): Promise<PluginLoadResult> {
    const registered = this.plugins.get(pluginId);
    if (!registered) {
      return {
        success: false,
        error: `Plugin ${pluginId} not found`,
        loadTimeMs: 0,
      };
    }

    const result = await this.loadPlugin(registered.path);

    if (result.success) {
      const reloaded = this.plugins.get(pluginId);
      if (reloaded) {
        reloaded.lastReloadedAt = new Date();
        if (this.events.onPluginReloaded) {
          this.events.onPluginReloaded(reloaded);
        }
      }
    }

    return result;
  }

  /**
   * Get a plugin by ID
   */
  getPlugin(pluginId: string): RegisteredPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get all loaded plugins
   */
  getAllPlugins(): RegisteredPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugins by namespace
   */
  getPluginsByNamespace(namespace: string): RegisteredPlugin[] {
    return Array.from(this.plugins.values()).filter((p) =>
      p.plugin.metadata.namespace.startsWith(namespace)
    );
  }

  /**
   * Check if a plugin is loaded
   */
  isPluginLoaded(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    return plugin?.status === 'loaded';
  }

  /**
   * Get plugin health status
   */
  async getPluginHealth(pluginId: string): Promise<{
    status: PluginStatus;
    healthy: boolean;
    message?: string;
  }> {
    const registered = this.plugins.get(pluginId);
    if (!registered) {
      return { status: 'unloaded', healthy: false, message: 'Plugin not loaded' };
    }

    if (registered.plugin.healthCheck) {
      try {
        const health = await registered.plugin.healthCheck();
        return {
          status: registered.status,
          healthy: health.healthy,
          message: health.message,
        };
      } catch (error) {
        return {
          status: registered.status,
          healthy: false,
          message: error instanceof Error ? error.message : 'Health check failed',
        };
      }
    }

    return {
      status: registered.status,
      healthy: registered.status === 'loaded',
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async loadPluginsFromDirectory(dir: string): Promise<void> {
    this.logger.debug('Scanning directory for plugins', { dir });

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      // Check if should be ignored
      if (this.shouldIgnore(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        // Check for index.ts/js in directory
        for (const pattern of ['index.ts', 'index.js']) {
          const indexPath = path.join(entryPath, pattern);
          if (fs.existsSync(indexPath)) {
            await this.loadPlugin(indexPath);
            break;
          }
        }
      } else if (this.matchesPattern(entry.name)) {
        await this.loadPlugin(entryPath);
      }
    }
  }

  private setupHotReload(): void {
    this.logger.debug('Setting up hot-reload', { dirs: this.config.pluginDirs });

    this.watcher = chokidar.watch(this.config.pluginDirs, {
      ignored: this.config.ignorePatterns.map((p) => `**/${p}`),
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', (filePath) => {
      if (this.matchesPattern(path.basename(filePath))) {
        this.debounceReload(filePath);
      }
    });

    this.watcher.on('add', (filePath) => {
      if (this.matchesPattern(path.basename(filePath))) {
        this.debounceReload(filePath);
      }
    });

    this.watcher.on('unlink', (filePath) => {
      // Find and unload the plugin
      for (const [id, registered] of this.plugins) {
        if (registered.path === path.resolve(filePath)) {
          this.unloadPlugin(id);
          break;
        }
      }
    });

    this.watcher.on('error', (error) => {
      this.logger.error('Hot-reload watcher error', error);
    });
  }

  private debounceReload(filePath: string): void {
    const absolutePath = path.resolve(filePath);

    // Clear existing timer
    const existing = this.reloadTimers.get(absolutePath);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new timer
    const timer = setTimeout(async () => {
      this.reloadTimers.delete(absolutePath);

      this.logger.info('Hot-reloading plugin', { path: absolutePath });

      try {
        await this.loadPlugin(absolutePath);
      } catch (error) {
        this.logger.error('Hot-reload failed', error as Error, { path: absolutePath });
        if (this.events.onPluginError) {
          // Find plugin ID
          for (const [id, registered] of this.plugins) {
            if (registered.path === absolutePath) {
              this.events.onPluginError(id, error as Error);
              break;
            }
          }
        }
      }
    }, this.config.hotReloadDebounceMs);

    this.reloadTimers.set(absolutePath, timer);
  }

  private async checkDependencies(plugin: AegisPlugin): Promise<void> {
    const deps = plugin.metadata.dependencies || [];

    for (const dep of deps) {
      const depPlugin = this.plugins.get(dep.pluginId);

      if (!depPlugin) {
        if (!dep.optional) {
          throw new Error(`Missing required dependency: ${dep.pluginId}`);
        }
        continue;
      }

      // Check version constraints
      if (dep.minVersion && !this.satisfiesVersion(depPlugin.plugin.metadata.version, dep.minVersion, '>=')) {
        throw new Error(
          `Dependency ${dep.pluginId} version ${depPlugin.plugin.metadata.version} does not meet minimum ${dep.minVersion}`
        );
      }

      if (dep.maxVersion && !this.satisfiesVersion(depPlugin.plugin.metadata.version, dep.maxVersion, '<=')) {
        throw new Error(
          `Dependency ${dep.pluginId} version ${depPlugin.plugin.metadata.version} exceeds maximum ${dep.maxVersion}`
        );
      }
    }
  }

  private satisfiesVersion(version: string, constraint: string, operator: '>=' | '<='): boolean {
    const vParts = version.split('.').map(Number);
    const cParts = constraint.split('.').map(Number);

    for (let i = 0; i < Math.max(vParts.length, cParts.length); i++) {
      const v = vParts[i] || 0;
      const c = cParts[i] || 0;

      if (operator === '>=') {
        if (v > c) return true;
        if (v < c) return false;
      } else {
        if (v < c) return true;
        if (v > c) return false;
      }
    }

    return true;
  }

  private shouldIgnore(name: string): boolean {
    return this.config.ignorePatterns.some((pattern) => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(name);
      }
      return name === pattern;
    });
  }

  private matchesPattern(filename: string): boolean {
    return this.config.filePatterns.some((pattern) => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(filename);
      }
      return filename === pattern;
    });
  }

  private createTimeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createPluginLoader(
  config: Partial<PluginLoaderConfig>,
  context: PluginLoadContext,
  logger: Logger,
  events?: PluginLoaderEvents
): PluginLoader {
  return new PluginLoader(config, context, logger, events);
}
