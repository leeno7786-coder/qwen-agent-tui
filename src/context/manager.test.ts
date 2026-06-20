/**
 * Tests for context window management system.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ContextManager, createContextManager, DEFAULT_CONTEXT_CONFIG } from './manager';
import type { Config, Message } from '../types';

describe('ContextManager', () => {
  let cfg: Config;
  let contextManager: ContextManager;

  beforeEach(() => {
    cfg = {
      model: 'qwen2.5-coder-8b',
      baseURL: 'http://127.0.0.1:1234/v1',
      workspace: '/test/workspace',
      maxIterations: 10,
      temperature: 0.2,
    };
    contextManager = createContextManager(cfg);
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const config = contextManager.getConfig();
      expect(config.enabled).toBe(true);
      // Note: compactThreshold may be an absolute number or ratio depending on model
      expect(config.compactThreshold).toBeGreaterThan(0);
      expect(config.summaryReservedPercent).toBeGreaterThan(0);
      expect(config.keepCount).toBeGreaterThan(0);
    });

    it('should accept custom configuration', () => {
      const customCfg: Config = {
        ...cfg,
        contextCompactThreshold: 0.7,
        contextSummaryReservedPercent: 0.25,
        contextKeepCount: 20,
      };
      const customManager = createContextManager(customCfg);
      const config = customManager.getConfig();
      expect(config.compactThreshold).toBe(0.7);
      expect(config.summaryReservedPercent).toBe(0.25);
      expect(config.keepCount).toBe(20);
    });
  });

  describe('addMessage', () => {
    it('should add messages to the context', () => {
      const msg: Message = {
        id: '1',
        role: 'user',
        content: 'Hello, world!',
        timestamp: Date.now(),
      };
      
      contextManager.addMessage(msg);
      
      const messages = contextManager.getMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe('Hello, world!');
    });

    it('should track multiple messages', () => {
      contextManager.addMessage({ id: '1', role: 'user', content: 'First', timestamp: Date.now() });
      contextManager.addMessage({ id: '2', role: 'assistant', content: 'Second', timestamp: Date.now() });
      contextManager.addMessage({ id: '3', role: 'tool', content: 'Third', timestamp: Date.now() });
      
      const messages = contextManager.getMessages();
      expect(messages.length).toBe(3);
    });
  });

  describe('getStats', () => {
    it('should return context statistics', () => {
      contextManager.addMessage({ id: '1', role: 'user', content: 'Hello', timestamp: Date.now() });
      
      const stats = contextManager.getStats();
      
      expect(stats.currentTokens).toBeGreaterThan(0);
      expect(stats.maxTokens).toBeGreaterThan(0);
      expect(stats.usagePercent).toBeGreaterThanOrEqual(0);
      expect(stats.usagePercent).toBeLessThanOrEqual(1);
      expect(stats.messageCount).toBe(1);
      expect(stats.needsCompaction).toBe(false);
      expect(stats.compactionCount).toBe(0);
    });

    it('should update stats when messages are added', () => {
      const stats1 = contextManager.getStats();
      expect(stats1.messageCount).toBe(0);
      
      contextManager.addMessage({ id: '1', role: 'user', content: 'Test', timestamp: Date.now() });
      
      const stats2 = contextManager.getStats();
      expect(stats2.messageCount).toBe(1);
      expect(stats2.currentTokens).toBeGreaterThan(stats1.currentTokens);
    });
  });

  describe('canFitMessage', () => {
    it('should return true for small messages when context is empty', () => {
      const msg: Message = {
        id: '1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };
      
      expect(contextManager.canFitMessage(msg)).toBe(true);
    });

    it('should return false when message would exceed context', () => {
      // Use a model with small context for testing
      const smallCfg: Config = {
        ...cfg,
        model: 'test-small-model',
        modelContextLength: 100, // Very small context
      };
      const smallManager = createContextManager(smallCfg);
      
      // Add messages to fill up context
      for (let i = 0; i < 5; i++) {
        smallManager.addMessage({
          id: String(i),
          role: 'user',
          content: 'A'.repeat(50), // Each message uses ~50 tokens
          timestamp: Date.now(),
        });
      }
      
      // Try to add another large message that would exceed the small context
      const largeMsg: Message = {
        id: '101',
        role: 'user',
        content: 'A'.repeat(1000), // This would exceed 100 token context
        timestamp: Date.now(),
      };
      
      expect(smallManager.canFitMessage(largeMsg)).toBe(false);
    });
  });

  describe('needsCompaction', () => {
    it('should return false when context is not full', () => {
      expect(contextManager.needsCompaction()).toBe(false);
    });

    // Note: Testing needsCompaction with true requires complex model configuration
    // which is tested indirectly through the compact() method
  });

  describe('compact', () => {
    it('should preserve minimum number of messages', () => {
      const keepCount = contextManager.getConfig().keepCount;
      
      // Add messages
      for (let i = 0; i < keepCount + 10; i++) {
        contextManager.addMessage({
          id: String(i),
          role: 'user',
          content: `Message ${i}`,
          timestamp: Date.now(),
        });
      }
      
      // Trigger compaction
      contextManager.compact();
      
      // Should keep at least keepCount messages
      const messages = contextManager.getMessages();
      expect(messages.length).toBeGreaterThanOrEqual(keepCount);
    });

    it('should do nothing when compaction is not needed', () => {
      // Add only a few messages
      contextManager.addMessage({ id: '1', role: 'user', content: 'Test', timestamp: Date.now() });
      
      const result = contextManager.compact();
      
      expect(result.removedCount).toBe(0);
      expect(result.summary).toBeUndefined();
    });

    // Note: Testing compaction with actual removal requires complex model configuration
    // which is better tested in integration tests
  });

  describe('clear', () => {
    it('should remove all messages', () => {
      contextManager.addMessage({ id: '1', role: 'user', content: 'Test', timestamp: Date.now() });
      contextManager.addMessage({ id: '2', role: 'assistant', content: 'Response', timestamp: Date.now() });
      
      contextManager.clear();
      
      expect(contextManager.getMessages().length).toBe(0);
      expect(contextManager.getStats().compactionCount).toBe(0);
    });
  });

  describe('setEnabled', () => {
    it('should enable and disable context management', () => {
      contextManager.setEnabled(false);
      expect(contextManager.getConfig().enabled).toBe(false);
      
      contextManager.setEnabled(true);
      expect(contextManager.getConfig().enabled).toBe(true);
    });

    it('should not compact when disabled', () => {
      contextManager.setEnabled(false);
      
      // Add many messages
      for (let i = 0; i < 100; i++) {
        contextManager.addMessage({
          id: String(i),
          role: 'user',
          content: `Message ${i}`,
          timestamp: Date.now(),
        });
      }
      
      const result = contextManager.compact();
      expect(result.removedCount).toBe(0);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration dynamically', () => {
      contextManager.updateConfig({
        compactThreshold: 0.5,
        keepCount: 5,
      });
      
      const config = contextManager.getConfig();
      expect(config.compactThreshold).toBe(0.5);
      expect(config.keepCount).toBe(5);
    });
  });

  describe('getMaxContextSize', () => {
    it('should return the maximum context size for the model', () => {
      const maxSize = contextManager.getMaxContextSize();
      expect(maxSize).toBeGreaterThan(0);
    });
  });
});

describe('DEFAULT_CONTEXT_CONFIG', () => {
  it('should have reasonable defaults', () => {
    expect(DEFAULT_CONTEXT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CONTEXT_CONFIG.compactThreshold).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_CONFIG.compactThreshold).toBeLessThanOrEqual(1);
    expect(DEFAULT_CONTEXT_CONFIG.summaryReservedPercent).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_CONFIG.summaryReservedPercent).toBeLessThanOrEqual(1);
    expect(DEFAULT_CONTEXT_CONFIG.keepCount).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_CONFIG.maxHistoryTokens).toBeGreaterThan(0);
  });
});
