import { describe, it, expect, vi } from 'vitest';
import type { CodeChunk } from '../src/types/index.js';
import { CodebaseSearcher } from '../src/core/search.js';

function createChunk(id: string, filePath: string, content: string): CodeChunk {
  return {
    id,
    content,
    filePath,
    relativePath: filePath.replace(/^.*?Repos\//, ''),
    startLine: 1,
    endLine: 40,
    language: 'typescript',
    framework: 'generic',
    componentType: 'service',
    layer: 'core',
    dependencies: [],
    imports: [],
    exports: [],
    tags: [],
    metadata: {}
  };
}

function setupSemanticOnlySearcher(
  results: { chunk: CodeChunk; score: number }[]
): CodebaseSearcher {
  const searcher = new CodebaseSearcher('C:/repo') as any;
  searcher.initialized = true;
  searcher.embeddingProvider = {
    embed: vi.fn(async () => [0.1, 0.2])
  };
  searcher.storageProvider = {
    search: vi.fn(async () => results),
    count: vi.fn(async () => results.length)
  };
  searcher.fuseIndex = null;
  searcher.patternIntelligence = null;
  return searcher as CodebaseSearcher;
}

describe('CodebaseSearcher query-aware ranking', () => {
  it('de-prioritizes spec files for non-testing queries', async () => {
    const specChunk = createChunk(
      'spec',
      'C:/repo/src/domain/session/session-manager.spec.ts',
      "describe('SessionManager', () => {})"
    );
    const implChunk = createChunk(
      'impl',
      'C:/repo/src/domain/session/session-manager.ts',
      'export class SessionManager {}'
    );

    const searcher = setupSemanticOnlySearcher([
      { chunk: specChunk, score: 0.75 },
      { chunk: implChunk, score: 0.68 }
    ]);

    const results = await searcher.search('Refactor session management flow', 2);
    expect(results[0].filePath).toContain('session-manager.ts');
    expect(results[0].filePath).not.toContain('.spec.ts');
  });

  it('keeps spec files prioritized for testing queries', async () => {
    const specChunk = createChunk(
      'spec',
      'C:/repo/src/domain/session/session-manager.spec.ts',
      "describe('SessionManager', () => {})"
    );
    const implChunk = createChunk(
      'impl',
      'C:/repo/src/domain/session/session-manager.ts',
      'export class SessionManager {}'
    );

    const searcher = setupSemanticOnlySearcher([
      { chunk: specChunk, score: 0.75 },
      { chunk: implChunk, score: 0.68 }
    ]);

    const results = await searcher.search('Update unit tests for session manager with mocks', 2);
    expect(results[0].filePath).toContain('.spec.ts');
  });

  it('de-prioritizes Windows e2e paths for non-testing queries', async () => {
    const e2eChunk = createChunk(
      'e2e',
      'C:\\repo\\apps\\app\\e2e\\src\\tests\\session-setup.ts',
      "describe('session setup', () => {})"
    );
    const implChunk = createChunk(
      'impl',
      'C:\\repo\\src\\domain\\session\\session-manager.ts',
      'export class SessionManager {}'
    );

    const searcher = setupSemanticOnlySearcher([
      { chunk: e2eChunk, score: 0.75 },
      { chunk: implChunk, score: 0.72 }
    ]);

    const results = await searcher.search('session login flow', 2);
    expect(results[0].filePath.toLowerCase()).toContain('session-manager.ts');
  });
});
