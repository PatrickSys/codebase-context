import { describe, expect, it } from 'vitest';
import { extractQueryPathTokens } from '../src/core/search.js';

describe('extractQueryPathTokens', () => {
  it('extracts markdown filenames from natural-language queries', () => {
    const tokens = extractQueryPathTokens(
      'NOW.md live root entrypoint current state for routing'
    );
    expect(tokens).toContain('now.md');
  });

  it('extracts script paths and hyphenated stems', () => {
    const tokens = extractQueryPathTokens(
      'what must I check before editing AGENTS.md protected agent instructions'
    );
    expect(tokens).toContain('agents.md');
  });

  it('extracts explicit script module names', () => {
    const tokens = extractQueryPathTokens('run check-agent-instructions before commit');
    expect(tokens).toContain('check-agent-instructions');
  });
});
