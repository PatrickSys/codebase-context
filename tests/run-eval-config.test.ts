import path from 'path';
import { describe, expect, it } from 'vitest';
import { getDefaultFixturePaths, resolveEvalMode } from '../src/eval/run-config.js';

describe('run-eval mode config', () => {
  it('recognizes edit-preflight as a first-class eval mode', () => {
    expect(resolveEvalMode('edit-preflight')).toBe('edit-preflight');
    expect(resolveEvalMode('discovery')).toBe('discovery');
    expect(resolveEvalMode('retrieval')).toBe('retrieval');
  });

  it('keeps retrieval as the fallback mode for unknown values', () => {
    expect(resolveEvalMode('unknown-mode')).toBe('retrieval');
    expect(resolveEvalMode(undefined)).toBe('retrieval');
  });

  it('returns dedicated frozen default fixtures for edit-preflight mode', () => {
    const defaults = getDefaultFixturePaths('C:/repo', 'edit-preflight');

    expect(defaults).toEqual({
      fixtureA: path.join('C:/repo', 'tests', 'fixtures', 'edit-preflight-angular-spotify.json'),
      fixtureB: path.join('C:/repo', 'tests', 'fixtures', 'edit-preflight-excalidraw.json')
    });
  });
});
