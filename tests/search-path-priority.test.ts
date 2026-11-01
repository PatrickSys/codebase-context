import { describe, expect, it } from 'vitest';
import Fuse from 'fuse.js';
import { CodebaseSearcher, extractQueryPathTokens } from '../src/core/search.js';
import type { CodeChunk } from '../src/types/index.js';
import { asSearcherTestHarness, materializeSourceSnapshot } from './helpers/source-snapshot.js';

describe('extractQueryPathTokens', () => {
  it('extracts markdown filenames from natural-language queries', () => {
    const tokens = extractQueryPathTokens('NOW.md live root entrypoint current state for routing');
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

  it('recognizes single-word filenames and relative source paths', () => {
    expect(extractQueryPathTokens('explain src/core/search.ts and parser.py')).toEqual(
      expect.arrayContaining(['src/core/search.ts', 'parser.py'])
    );
  });
});

function chunk(file: string, content: string, id = file): CodeChunk {
  return {
    id,
    filePath: file,
    relativePath: file,
    content,
    startLine: 1,
    endLine: 1,
    language: 'javascript',
    framework: 'generic',
    componentType: 'module',
    dependencies: [],
    imports: [],
    exports: [],
    tags: [],
    metadata: {}
  };
}

async function setup(chunks: CodeChunk[]) {
  const snapshot = await materializeSourceSnapshot(chunks, 'search-path-priority-');
  const searcher = new CodebaseSearcher(snapshot.rootPath);
  const harness = asSearcherTestHarness(searcher);
  harness.initialized = true;
  harness.sourceManifest = snapshot.manifest;
  harness.embeddingProvider = null;
  harness.storageProvider = null;
  harness.fuseIndex = new Fuse(chunks, {
    keys: ['content', 'relativePath'],
    includeScore: true,
    threshold: 0.4,
    useExtendedSearch: true,
    ignoreLocation: true
  });
  Object.assign(searcher, { chunks });
  return { searcher, ...snapshot };
}

describe('path nomination and candidate identity', () => {
  it('rejects a forged sibling even when another chunk is the best path witness', async () => {
    const weak = chunk('src/query-builder.js', '// original header', 'weak');
    const strong = {
      ...chunk('src/query-builder.js', 'export function buildPolicy() {}', 'strong'),
      startLine: 2,
      endLine: 2,
      metadata: { symbolName: 'buildPolicy' }
    };
    const subject = await setup([weak, strong]);
    weak.content = '// forged statement';
    try {
      await expect(
        subject.searcher.search('query-builder.js buildPolicy', 5, undefined, {
          enableReranker: false
        })
      ).rejects.toThrow('Indexed chunk body');
    } finally {
      await subject.cleanup();
    }
  });
  it('keeps the exact declaration witness when a path has an earlier weak chunk', async () => {
    const weak = chunk('src/query-builder.js', '// unrelated header', 'weak');
    const strong = {
      ...chunk('src/query-builder.js', 'export function buildPolicy() {}', 'strong'),
      startLine: 2,
      endLine: 2,
      metadata: { symbolName: 'buildPolicy' }
    };
    const subject = await setup([weak, strong]);
    try {
      const results = await subject.searcher.search('query-builder.js buildPolicy', 5, undefined, {
        enableReranker: false
      });
      expect(results[0]?.startLine).toBe(2);
      expect(results[0]?.metadata?.symbolName).toBe('buildPolicy');
    } finally {
      await subject.cleanup();
    }
  });
  it('keeps distinct files visible and reports partial coverage for a heavily chunked path', async () => {
    const chunks = [
      ...Array.from({ length: 800 }, (_, i) =>
        chunk('src/query-builder.js', '// archive policy', `exact-${i}`)
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        chunk(`src/query-builder-other-${i}.js`, '// archive policy')
      )
    ];
    const subject = await setup(chunks);
    try {
      const outcome = await subject.searcher.searchWithCoverage(
        'query-builder.js archive policy',
        5,
        undefined,
        { enableReranker: false }
      );
      const results = outcome.results;
      expect(results).toHaveLength(5);
      expect(new Set(results.map((result) => result.filePath)).size).toBe(5);
      expect(results[0]?.filePath).toBe(chunks[0].filePath);
      expect(outcome.sourceCoverage).toMatchObject({
        status: 'partial',
        candidateBudgetExhausted: true
      });
    } finally {
      await subject.cleanup();
    }
  });
  it('admits the exact filename ahead of many loose path matches', async () => {
    const chunks = [
      ...Array.from({ length: 40 }, (_, i) =>
        chunk(`src/query-builder-helper-${i}.js`, '// query builder behavior')
      ),
      chunk('src/query-builder.js', '// query builder behavior')
    ];
    const subject = await setup(chunks);
    try {
      const results = await subject.searcher.search(
        'where is query-builder.js behavior',
        5,
        undefined,
        { enableReranker: false }
      );
      expect(results[0]?.filePath).toBe(chunks.at(-1)?.filePath);
    } finally {
      await subject.cleanup();
    }
  });

  it('does not spend multiple candidate slots on the same path-rescue witness', async () => {
    const chunks = [
      chunk('src/query-builder.js', '// archive policy'),
      chunk('src/other.js', '// archive policy')
    ];
    const subject = await setup(chunks);
    try {
      const results = await subject.searcher.search(
        'query-builder.js archive policy',
        5,
        undefined,
        { enableReranker: false }
      );
      expect(new Set(results.map((r) => r.filePath)).size).toBe(results.length);
      expect(results.map((r) => r.filePath)).toContain(chunks[1].filePath);
    } finally {
      await subject.cleanup();
    }
  });
});
