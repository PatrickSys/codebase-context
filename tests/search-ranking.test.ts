import { describe, it, expect, vi } from 'vitest';
import type { CodeChunk } from '../src/types/index.js';
import { CodebaseSearcher } from '../src/core/search.js';
import {
  asSearcherTestHarness,
  materializeSourceSnapshot,
  type SourceSnapshot
} from './helpers/source-snapshot.js';

function createChunk(
  id: string,
  filePath: string,
  content: string,
  metadata: CodeChunk['metadata'] = {}
): CodeChunk {
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
    metadata
  };
}

function setupSemanticOnlySearcher(
  results: { chunk: CodeChunk; score: number }[],
  snapshot: SourceSnapshot
): CodebaseSearcher {
  const searcher = new CodebaseSearcher(snapshot.rootPath);
  const harness = asSearcherTestHarness(searcher);
  harness.initialized = true;
  harness.sourceManifest = snapshot.manifest;
  harness.embeddingProvider = {
    embed: vi.fn(async () => [0.1, 0.2])
  };
  harness.storageProvider = {
    search: vi.fn(async () => results),
    count: vi.fn(async () => results.length)
  };
  harness.fuseIndex = null;
  harness.patternIntelligence = null;
  return searcher;
}

describe('CodebaseSearcher query-aware ranking', () => {
  it('keeps same-named symbols from different files and deduplicates chunks within each file', async () => {
    const symbolPath = ['readTargetDefaultsForTarget'];
    const metadata = {
      symbolName: 'readTargetDefaultsForTarget',
      symbolPath,
      symbolAware: true
    };
    const firstFileBest = createChunk(
      'target-best',
      'C:/repo/packages/nx/target-defaults.ts',
      'export function readTargetDefaultsForTarget() { return "nx"; }',
      metadata
    );
    const firstFileDuplicate = createChunk(
      'target-duplicate',
      'C:/repo/packages/nx/target-defaults.ts',
      'export function readTargetDefaultsForTarget() { return "nx"; }',
      metadata
    );
    const secondFile = createChunk(
      'wrapper',
      'C:/repo/packages/devkit/target-defaults.ts',
      'export function readTargetDefaultsForTarget() { return "devkit"; }',
      metadata
    );

    const snapshot = await materializeSourceSnapshot(
      [firstFileBest, firstFileDuplicate, secondFile],
      'search-symbol-file-identity-'
    );
    try {
      const searcher = setupSemanticOnlySearcher(
        [
          { chunk: firstFileBest, score: 0.9 },
          { chunk: firstFileDuplicate, score: 0.85 },
          { chunk: secondFile, score: 0.8 }
        ],
        snapshot
      );

      const results = await searcher.search('readTargetDefaultsForTarget', 2);

      expect(results).toHaveLength(2);
      expect(results.map((result) => result.filePath)).toEqual([
        firstFileBest.filePath,
        secondFile.filePath
      ]);
      expect(results[0].score).toBeGreaterThan(results[1].score);
    } finally {
      await snapshot.cleanup();
    }
  });

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

    const snapshot = await materializeSourceSnapshot(
      [specChunk, implChunk],
      'search-ranking-source-'
    );
    try {
      const searcher = setupSemanticOnlySearcher(
        [
          { chunk: specChunk, score: 0.75 },
          { chunk: implChunk, score: 0.68 }
        ],
        snapshot
      );
      const results = await searcher.search('Refactor session management flow', 2);
      expect(results[0].filePath).toContain('session-manager.ts');
      expect(results[0].filePath).not.toContain('.spec.ts');
    } finally {
      await snapshot.cleanup();
    }
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

    const snapshot = await materializeSourceSnapshot(
      [specChunk, implChunk],
      'search-ranking-source-'
    );
    try {
      const searcher = setupSemanticOnlySearcher(
        [
          { chunk: specChunk, score: 0.75 },
          { chunk: implChunk, score: 0.68 }
        ],
        snapshot
      );
      const results = await searcher.search('Update unit tests for session manager with mocks', 2);
      expect(results[0].filePath).toContain('.spec.ts');
    } finally {
      await snapshot.cleanup();
    }
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

    const snapshot = await materializeSourceSnapshot(
      [e2eChunk, implChunk],
      'search-ranking-source-'
    );
    try {
      const searcher = setupSemanticOnlySearcher(
        [
          { chunk: e2eChunk, score: 0.75 },
          { chunk: implChunk, score: 0.72 }
        ],
        snapshot
      );
      const results = await searcher.search('session login flow', 2);
      expect(results[0].filePath.toLowerCase()).toContain('session-manager.ts');
    } finally {
      await snapshot.cleanup();
    }
  });
});
