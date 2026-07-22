/**
 * Tests for parallel tool execution functionality.
 */

import { describe, it, expect } from 'bun:test';
import {
  canRunInParallel,
  mustRunSequentially,
  groupToolsForParallelExecution,
  PARALLEL_SAFE_TOOLS,
  SEQUENTIAL_ONLY_TOOLS,
} from './index.js';

describe('Parallel Tool Execution', () => {
  describe('canRunInParallel', () => {
    it('should allow read_file to run in parallel', () => {
      expect(canRunInParallel('read_file')).toBe(true);
    });

    it('should allow list_dir to run in parallel', () => {
      expect(canRunInParallel('list_dir')).toBe(true);
    });

    it('should allow grep_search to run in parallel', () => {
      expect(canRunInParallel('grep_search')).toBe(true);
    });

    it('should not allow write_file to run in parallel', () => {
      expect(canRunInParallel('write_file')).toBe(false);
    });

    it('should not allow execute_command to run in parallel', () => {
      expect(canRunInParallel('execute_command')).toBe(false);
    });

    it('should not allow git_commit to run in parallel', () => {
      expect(canRunInParallel('git_commit')).toBe(false);
    });
  });

  describe('mustRunSequentially', () => {
    it('should require write_file to run sequentially', () => {
      expect(mustRunSequentially('write_file')).toBe(true);
    });

    it('should require execute_command to run sequentially', () => {
      expect(mustRunSequentially('execute_command')).toBe(true);
    });

    it('should not require read_file to run sequentially', () => {
      expect(mustRunSequentially('read_file')).toBe(false);
    });
  });

  describe('groupToolsForParallelExecution', () => {
    it('should separate parallel and sequential tools', () => {
      const toolCalls = [
        { name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }), id: 'call_1' },
        {
          name: 'write_file',
          arguments: JSON.stringify({ path: 'b.txt', content: 'test' }),
          id: 'call_2',
        },
        { name: 'list_dir', arguments: JSON.stringify({ path: '.' }), id: 'call_3' },
        { name: 'execute_command', arguments: JSON.stringify({ command: 'ls' }), id: 'call_4' },
      ];

      const result = groupToolsForParallelExecution(toolCalls);

      expect(result.parallel.length).toBe(2);
      expect(result.sequential.length).toBe(2);
      expect(result.parallel.map((t) => t.name)).toContain('read_file');
      expect(result.parallel.map((t) => t.name)).toContain('list_dir');
      expect(result.sequential.map((t) => t.name)).toContain('write_file');
      expect(result.sequential.map((t) => t.name)).toContain('execute_command');
    });

    it('should preserve original order in indices', () => {
      const toolCalls = [
        { name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }), id: 'call_1' },
        {
          name: 'write_file',
          arguments: JSON.stringify({ path: 'b.txt', content: 'test' }),
          id: 'call_2',
        },
        { name: 'list_dir', arguments: JSON.stringify({ path: '.' }), id: 'call_3' },
      ];

      const result = groupToolsForParallelExecution(toolCalls);

      expect(result.parallel[0].index).toBe(0);
      expect(result.parallel[0].id).toBe('call_1');
      expect(result.sequential[0].index).toBe(1);
      expect(result.sequential[0].id).toBe('call_2');
      expect(result.parallel[1].index).toBe(2);
      expect(result.parallel[1].id).toBe('call_3');
    });

    it('should handle empty input', () => {
      const result = groupToolsForParallelExecution([]);
      expect(result.parallel.length).toBe(0);
      expect(result.sequential.length).toBe(0);
    });

    it('should handle all parallel tools', () => {
      const toolCalls = [
        { name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }), id: 'call_1' },
        { name: 'list_dir', arguments: JSON.stringify({ path: '.' }), id: 'call_2' },
        { name: 'grep_search', arguments: JSON.stringify({ query: 'test' }), id: 'call_3' },
      ];

      const result = groupToolsForParallelExecution(toolCalls);
      expect(result.parallel.length).toBe(3);
      expect(result.sequential.length).toBe(0);
    });

    it('should handle all sequential tools', () => {
      const toolCalls = [
        {
          name: 'write_file',
          arguments: JSON.stringify({ path: 'a.txt', content: 'test' }),
          id: 'call_1',
        },
        { name: 'execute_command', arguments: JSON.stringify({ command: 'ls' }), id: 'call_2' },
        { name: 'git_commit', arguments: JSON.stringify({ message: 'test' }), id: 'call_3' },
      ];

      const result = groupToolsForParallelExecution(toolCalls);
      expect(result.parallel.length).toBe(0);
      expect(result.sequential.length).toBe(3);
    });
  });

  describe('PARALLEL_SAFE_TOOLS', () => {
    it('should include read-only tools', () => {
      expect(PARALLEL_SAFE_TOOLS.has('read_file')).toBe(true);
      expect(PARALLEL_SAFE_TOOLS.has('list_dir')).toBe(true);
      expect(PARALLEL_SAFE_TOOLS.has('stat_path')).toBe(true);
      expect(PARALLEL_SAFE_TOOLS.has('find_files')).toBe(true);
      expect(PARALLEL_SAFE_TOOLS.has('grep_search')).toBe(true);
      expect(PARALLEL_SAFE_TOOLS.has('search_and_view')).toBe(true);
    });

    it('should not include write operations', () => {
      expect(PARALLEL_SAFE_TOOLS.has('write_file')).toBe(false);
      expect(PARALLEL_SAFE_TOOLS.has('edit_file')).toBe(false);
    });
  });

  describe('SEQUENTIAL_ONLY_TOOLS', () => {
    it('should include write operations', () => {
      expect(SEQUENTIAL_ONLY_TOOLS.has('write_file')).toBe(true);
      expect(SEQUENTIAL_ONLY_TOOLS.has('edit_file')).toBe(true);
      expect(SEQUENTIAL_ONLY_TOOLS.has('execute_command')).toBe(true);
    });

    it('should not include read-only tools', () => {
      expect(SEQUENTIAL_ONLY_TOOLS.has('read_file')).toBe(false);
      expect(SEQUENTIAL_ONLY_TOOLS.has('list_dir')).toBe(false);
    });
  });
});
