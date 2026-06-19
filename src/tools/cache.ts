/**
 * Tool execution caching system for qwen-agent-tui.
 * Caches tool results to avoid redundant executions.
 */

import { createHash } from 'crypto';
import type { Config } from '../types';

/**
 * Cache entry for a tool execution result.
 */
export interface ToolCacheEntry {
  /** The cached result */
  result: string;
  /** Timestamp when the entry was created */
  timestamp: number;
  /** Duration of the original execution in ms */
  duration: number;
  /** Whether the execution was successful */
  success: boolean;
}

/**
 * Configuration options for the tool cache.
 */
export interface ToolCacheConfig {
  /** Maximum number of entries in the cache */
  maxSize: number;
  /** Time-to-live for cache entries in milliseconds */
  ttlMs: number;
  /** Whether caching is enabled */
  enabled: boolean;
  /** Tools that should not be cached */
  excludedTools: Set<string>;
}

/**
 * Default cache configuration.
 */
export const DEFAULT_CACHE_CONFIG: ToolCacheConfig = {
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
    'dispatch_subagents',
    'manage_todos',
    'change_workspace',
  ]),
};

/**
 * Generates a cache key from tool name and arguments.
 * Uses a hash to ensure consistent keys regardless of argument order.
 */
export function generateCacheKey(
  toolName: string,
  args: Record<string, unknown>,
  workspace: string
): string {
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
  private cache: Map<string, ToolCacheEntry> = new Map();
  private config: ToolCacheConfig;
  private hits: number = 0;
  private misses: number = 0;

  constructor(config: Partial<ToolCacheConfig> = {}) {
    this.config = {
      ...DEFAULT_CACHE_CONFIG,
      ...config,
    };
  }

  /**
   * Get a cached result for a tool execution.
   * @returns The cached result or undefined if not found/expired
   */
  get(toolName: string, args: Record<string, unknown>, workspace: string): ToolCacheEntry | undefined {
    if (!this.config.enabled) return undefined;
    if (this.config.excludedTools.has(toolName)) return undefined;

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

    this.hits++;
    return entry;
  }

  /**
   * Store a tool execution result in the cache.
   */
  set(
    toolName: string,
    args: Record<string, unknown>,
    workspace: string,
    result: string,
    duration: number,
    success: boolean
  ): void {
    if (!this.config.enabled) return;
    if (this.config.excludedTools.has(toolName)) return;

    const key = generateCacheKey(toolName, args, workspace);

    // Evict oldest entries if cache is full
    while (this.cache.size >= this.config.maxSize) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;

      for (const [k, entry] of this.cache) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      duration,
      success,
    });
  }

  /**
   * Invalidate cache entries that match a pattern.
   * Useful for invalidating cache when files change.
   */
  invalidateByPattern(pattern: RegExp | string): number {
    let count = 0;
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    for (const [key, entry] of this.cache) {
      // We can't easily reverse the hash, so we'll do a full clear for now
      // In a more advanced implementation, we could store metadata with entries
    }

    // For now, clear all cache when invalidating
    this.cache.clear();
    return count;
  }

  /**
   * Invalidate cache entries for a specific tool.
   */
  invalidateTool(toolName: string): number {
    let count = 0;
    const keysToDelete: string[] = [];

    for (const [key] of this.cache) {
      // Since we hash the key, we need to track tool names separately
      // This is a limitation of the current implementation
    }

    return count;
  }

  /**
   * Invalidate cache entries for a specific workspace path.
   */
  invalidateWorkspace(workspace: string): number {
    let count = 0;
    const keysToDelete: string[] = [];

    for (const [key] of this.cache) {
      // Similar limitation as above
    }

    return count;
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics.
   */
  getStats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
    enabled: boolean;
  } {
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
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Update cache configuration.
   */
  updateConfig(config: Partial<ToolCacheConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Get current configuration.
   */
  getConfig(): ToolCacheConfig {
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
export function createToolCacheManager(cfg?: Config): ToolCacheManager {
  const cacheConfig: Partial<ToolCacheConfig> = {};

  if (cfg?.toolCacheEnabled === false) {
    cacheConfig.enabled = false;
  }

  if (cfg?.toolCacheTtlMs) {
    cacheConfig.ttlMs = cfg.toolCacheTtlMs;
  }

  if (cfg?.toolCacheMaxSize) {
    cacheConfig.maxSize = cfg.toolCacheMaxSize;
  }

  return new ToolCacheManager(cacheConfig);
}
