/**
 * Tool execution caching system for qwen-agent-tui.
 * Caches tool results to avoid redundant executions.
 */
import { createHash } from 'crypto';
import { watch, existsSync, statSync, readdirSync } from 'fs';
import { resolve } from 'path';
/**
 * Default cache configuration.
 */
export const DEFAULT_CACHE_CONFIG = {
    maxSize: 1000,
    ttlMs: 30000, // 30 seconds
    enabled: true,
    excludedTools: new Set([
        'execute_command',
        'git_commit',
        'write_file',
        'edit_file',
        'edit_file_lines',
        'install_dependencies',
        'run_tests',
        'run_command',
        'typecheck',
        'explore_subagent',
        'manage_todos',
        'change_workspace',
    ]),
};
/**
 * Extract file dependencies from tool arguments.
 * Returns a set of absolute file paths that the tool result depends on.
 */
export function extractDependencies(toolName, args, workspace) {
    const dependencies = new Set();
    try {
        switch (toolName) {
            case 'read_file':
                if (args.path) {
                    const path = resolve(workspace, String(args.path));
                    if (existsSync(path)) {
                        dependencies.add(path);
                    }
                }
                break;
            case 'list_dir':
                if (args.path) {
                    const path = resolve(workspace, String(args.path));
                    if (existsSync(path)) {
                        dependencies.add(path);
                        // Also track all files in the directory
                        try {
                            const entries = readdirSync(path);
                            for (const entry of entries) {
                                const entryPath = resolve(path, entry);
                                dependencies.add(entryPath);
                            }
                        }
                        catch {
                            // Ignore errors
                        }
                    }
                }
                else {
                    // Default to workspace
                    dependencies.add(workspace);
                }
                break;
            case 'stat_path':
                if (args.path) {
                    const path = resolve(workspace, String(args.path));
                    if (existsSync(path)) {
                        dependencies.add(path);
                    }
                }
                break;
            case 'find_files':
                if (args.path) {
                    const path = resolve(workspace, String(args.path));
                    if (existsSync(path)) {
                        dependencies.add(path);
                    }
                }
                break;
            case 'grep_search':
                if (args.path) {
                    const path = resolve(workspace, String(args.path));
                    if (existsSync(path)) {
                        dependencies.add(path);
                    }
                }
                break;
            case 'search_and_view':
                if (args.path) {
                    const path = resolve(workspace, String(args.path));
                    if (existsSync(path)) {
                        dependencies.add(path);
                    }
                }
                break;
            case 'batch_read_files':
                if (args.paths && Array.isArray(args.paths)) {
                    for (const path of args.paths) {
                        const absPath = resolve(workspace, String(path));
                        if (existsSync(absPath)) {
                            dependencies.add(absPath);
                        }
                    }
                }
                break;
            case 'map_project_tree':
                if (args.path) {
                    const path = resolve(workspace, String(args.path));
                    if (existsSync(path)) {
                        dependencies.add(path);
                    }
                }
                break;
            default: {
                const pathFields = ['path', 'file', 'filePath', 'directory', 'dir'];
                for (const field of pathFields) {
                    if (args[field]) {
                        const path = resolve(workspace, String(args[field]));
                        if (existsSync(path)) {
                            dependencies.add(path);
                        }
                    }
                }
                break;
            }
        }
    }
    catch {
        // Ignore errors in dependency extraction
    }
    return dependencies;
}
/**
 * Generates a cache key from tool name and arguments.
 * Uses a hash to ensure consistent keys regardless of argument order.
 */
export function generateCacheKey(toolName, args, workspace) {
    const keyData = JSON.stringify({
        tool: toolName,
        args: args,
        workspace: workspace,
    });
    return createHash('sha256').update(keyData).digest('hex').slice(0, 16);
}
/**
 * Tool cache manager that handles caching of tool execution results.
 */
export class ToolCacheManager {
    cache = new Map();
    config;
    hits = 0;
    misses = 0;
    fileWatchers = new Map();
    workspace = '';
    constructor(config = {}, workspace = '') {
        this.config = {
            ...DEFAULT_CACHE_CONFIG,
            ...config,
        };
        this.workspace = workspace;
    }
    /**
     * Get a cached result for a tool execution.
     * @returns The cached result or undefined if not found/expired
     */
    get(toolName, args, workspace) {
        if (!this.config.enabled)
            return undefined;
        if (this.config.excludedTools.has(toolName))
            return undefined;
        const key = generateCacheKey(toolName, args, workspace);
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }
        // Check if entry has expired
        const age = Date.now() - entry.timestamp;
        if (age > this.config.ttlMs) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }
        // Check if any dependencies have changed
        if (entry.dependencies && entry.dependencies.size > 0) {
            for (const dep of entry.dependencies) {
                if (this.hasFileChanged(dep, entry.timestamp)) {
                    this.cache.delete(key);
                    this.misses++;
                    return undefined;
                }
            }
        }
        this.hits++;
        return entry;
    }
    /**
     * Check if a file has changed since a given timestamp.
     */
    hasFileChanged(filePath, sinceTimestamp) {
        try {
            const stats = statSync(filePath);
            return stats.mtimeMs > sinceTimestamp;
        }
        catch {
            return true; // If we can't stat the file, assume it changed
        }
    }
    /**
     * Store a tool execution result in the cache.
     */
    set(toolName, args, workspace, result, duration, success, dependencies) {
        if (!this.config.enabled)
            return;
        if (this.config.excludedTools.has(toolName))
            return;
        const key = generateCacheKey(toolName, args, workspace);
        // Auto-extract dependencies if not provided
        const depSet = dependencies
            ? new Set(dependencies)
            : extractDependencies(toolName, args, workspace);
        // Evict oldest entries if cache is full (Map preserves insertion order)
        while (this.cache.size >= this.config.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
            else {
                break;
            }
        }
        this.cache.set(key, {
            toolName,
            result,
            timestamp: Date.now(),
            duration,
            success,
            dependencies: depSet,
            workspace,
        });
        // Start watching dependencies for changes
        if (this.config.enabled && depSet && depSet.size > 0) {
            for (const dep of depSet) {
                this.watchFile(dep);
            }
        }
    }
    /**
     * Invalidate cache entries for a specific tool.
     */
    invalidateTool(toolName) {
        let count = 0;
        const keysToDelete = [];
        for (const [key, entry] of this.cache) {
            if (entry.toolName === toolName) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            this.cache.delete(key);
            count++;
        }
        return count;
    }
    /**
     * Invalidate cache entries for a specific workspace path.
     */
    invalidateWorkspace(workspace) {
        let count = 0;
        const keysToDelete = [];
        for (const [key, entry] of this.cache) {
            if (entry.workspace === workspace) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            this.cache.delete(key);
            count++;
        }
        return count;
    }
    /**
     * Clear all cache entries.
     */
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
        this.stopAllWatchers();
    }
    /**
     * Update workspace and reinitialize watchers.
     */
    setWorkspace(workspace) {
        this.workspace = workspace;
        // Stop all existing watchers
        this.stopAllWatchers();
        // Re-watch all dependencies in the cache
        for (const entry of this.cache.values()) {
            if (entry.dependencies) {
                for (const dep of entry.dependencies) {
                    this.watchFile(dep);
                }
            }
        }
    }
    /**
     * Start watching a file for changes to invalidate cache.
     */
    watchFile(filePath) {
        if (!this.config.enabled)
            return;
        const absPath = resolve(this.workspace, filePath);
        if (this.fileWatchers.has(absPath))
            return;
        try {
            const watcher = watch(absPath, (_eventType) => {
                this.invalidateByFile(absPath);
            });
            this.fileWatchers.set(absPath, watcher);
        }
        catch {
            // File watching not supported on this platform
        }
    }
    /**
     * Stop watching a specific file.
     */
    unwatchFile(filePath) {
        const absPath = resolve(this.workspace, filePath);
        const watcher = this.fileWatchers.get(absPath);
        if (watcher) {
            watcher.close();
            this.fileWatchers.delete(absPath);
        }
    }
    /**
     * Stop all file watchers.
     */
    stopAllWatchers() {
        for (const watcher of this.fileWatchers.values()) {
            try {
                watcher.close();
            }
            catch {
                // Ignore errors
            }
        }
        this.fileWatchers.clear();
    }
    /**
     * Invalidate cache entries that depend on a specific file.
     */
    invalidateByFile(filePath) {
        let count = 0;
        const absPath = resolve(filePath);
        for (const [key, entry] of this.cache) {
            if (entry.dependencies?.has(absPath)) {
                this.cache.delete(key);
                count++;
            }
        }
        // Stop watching this file
        this.unwatchFile(absPath);
        return count;
    }
    /**
     * Invalidate cache entries by pattern.
     */
    invalidateByPattern(pattern) {
        let count = 0;
        const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        for (const [key, entry] of this.cache) {
            // Check if any dependency matches the pattern
            if (entry.dependencies) {
                for (const dep of entry.dependencies) {
                    if (regex.test(dep)) {
                        this.cache.delete(key);
                        count++;
                        break;
                    }
                }
            }
        }
        return count;
    }
    /**
     * Get cache statistics.
     */
    getStats() {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
            enabled: this.config.enabled,
        };
    }
    /**
     * Enable or disable caching.
     */
    setEnabled(enabled) {
        this.config.enabled = enabled;
    }
    /**
     * Update cache configuration.
     */
    updateConfig(config) {
        this.config = {
            ...this.config,
            ...config,
        };
    }
    /**
     * Get current configuration.
     */
    getConfig() {
        return { ...this.config };
    }
}
/**
 * Global tool cache manager instance.
 */
export const globalToolCache = new ToolCacheManager();
/**
 * Create a cache manager from agent configuration.
 */
export function createToolCacheManager(cfg, workspace = '') {
    const cacheConfig = {};
    if (cfg?.toolCacheEnabled === false) {
        cacheConfig.enabled = false;
    }
    if (cfg?.toolCacheTtlMs) {
        cacheConfig.ttlMs = cfg.toolCacheTtlMs;
    }
    if (cfg?.toolCacheMaxSize) {
        cacheConfig.maxSize = cfg.toolCacheMaxSize;
    }
    return new ToolCacheManager(cacheConfig, workspace);
}
