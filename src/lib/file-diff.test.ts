import { describe, it, expect } from 'bun:test';
import { fileChangeDiff, formatLineChangeSummary } from './file-diff.js';

describe('file-diff', () => {
  it('counts added lines for new content', () => {
    const { added, removed, diff } = fileChangeDiff('a.txt', '', 'line1\nline2\n');
    expect(added).toBe(2);
    expect(removed).toBe(0);
    expect(diff).toContain('+line1');
  });

  it('counts removed and added lines for edits', () => {
    const { added, removed } = fileChangeDiff('a.txt', 'alpha\nbeta\n', 'alpha\ngamma\n');
    expect(added).toBe(1);
    expect(removed).toBe(1);
  });

  it('formats summary strings', () => {
    expect(formatLineChangeSummary(1, 0)).toBe('Added 1 line');
    expect(formatLineChangeSummary(18, 3)).toBe('Added 18 lines, removed 3 lines');
  });
});
