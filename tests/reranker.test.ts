import { describe, it, expect } from 'vitest';
import { isAmbiguous } from '../src/core/reranker.js';
import type { SearchResult } from '../src/types/index.js';

function makeResult(score: number, filePath: string): SearchResult {
  return {
    summary: `Result from ${filePath}`,
    snippet: 'export class Foo {}',
    filePath,
    startLine: 1,
    endLine: 10,
    score,
    language: 'typescript',
    metadata: {}
  } as SearchResult;
}

describe('Reranker ambiguity detection', () => {
  it('detects ambiguous results when top scores are clustered', () => {
    const results = [
      makeResult(0.85, '/a.ts'),
      makeResult(0.83, '/b.ts'),
      makeResult(0.82, '/c.ts')
    ];
    expect(isAmbiguous(results)).toBe(true);
  });

  it('returns false when there is a clear winner', () => {
    const results = [
      makeResult(0.95, '/a.ts'),
      makeResult(0.75, '/b.ts'),
      makeResult(0.60, '/c.ts')
    ];
    expect(isAmbiguous(results)).toBe(false);
  });

  it('returns false for fewer than 3 results', () => {
    const results = [
      makeResult(0.85, '/a.ts'),
      makeResult(0.84, '/b.ts')
    ];
    expect(isAmbiguous(results)).toBe(false);
  });

  it('correctly handles edge case at threshold boundary', () => {
    // Gap of exactly 0.08 is NOT below the < 0.08 threshold
    const results = [
      makeResult(0.90, '/a.ts'),
      makeResult(0.85, '/b.ts'),
      makeResult(0.82, '/c.ts')
    ];
    expect(isAmbiguous(results)).toBe(false); // 0.90 - 0.82 = 0.08, not < threshold

    // Gap of 0.07 IS below the threshold
    const ambiguous = [
      makeResult(0.90, '/a.ts'),
      makeResult(0.86, '/b.ts'),
      makeResult(0.83, '/c.ts')
    ];
    expect(isAmbiguous(ambiguous)).toBe(true); // 0.90 - 0.83 = 0.07, below threshold
  });
});

describe('File-level dedupe in search results', () => {
  it('removes duplicate files keeping best score via CodebaseSearcher', async () => {
    // This is tested via the integration in search-ranking.test.ts
    // The dedupe logic is in scoreAndSortResults — tested indirectly by
    // ensuring results contain unique file paths
    const { CodebaseSearcher } = await import('../src/core/search.js');
    const { vi } = await import('vitest');

    const searcher = new CodebaseSearcher('C:/repo') as any;
    searcher.initialized = true;
    searcher.embeddingProvider = {
      embed: vi.fn(async () => [0.1, 0.2])
    };
    searcher.storageProvider = {
      search: vi.fn(async () => [
        {
          chunk: {
            id: 'chunk1',
            content: 'class Foo {}',
            filePath: 'C:/repo/src/foo.ts',
            relativePath: 'src/foo.ts',
            startLine: 1,
            endLine: 10,
            language: 'typescript',
            framework: 'generic',
            componentType: 'service',
            layer: 'core',
            dependencies: [],
            imports: [],
            exports: [],
            tags: [],
            metadata: {}
          },
          score: 0.9
        },
        {
          chunk: {
            id: 'chunk2',
            content: 'class Bar extends Foo {}',
            filePath: 'C:/repo/src/foo.ts', // same file, different chunk
            relativePath: 'src/foo.ts',
            startLine: 11,
            endLine: 20,
            language: 'typescript',
            framework: 'generic',
            componentType: 'service',
            layer: 'core',
            dependencies: [],
            imports: [],
            exports: [],
            tags: [],
            metadata: {}
          },
          score: 0.85
        },
        {
          chunk: {
            id: 'chunk3',
            content: 'class Baz {}',
            filePath: 'C:/repo/src/baz.ts', // different file
            relativePath: 'src/baz.ts',
            startLine: 1,
            endLine: 10,
            language: 'typescript',
            framework: 'generic',
            componentType: 'service',
            layer: 'core',
            dependencies: [],
            imports: [],
            exports: [],
            tags: [],
            metadata: {}
          },
          score: 0.80
        }
      ]),
      count: vi.fn(async () => 3)
    };
    searcher.fuseIndex = null;
    searcher.patternIntelligence = null;

    const results = await (searcher as any).search('Foo class', 5, undefined, {
      useSemanticSearch: true,
      useKeywordSearch: false,
      enableReranker: false,
      enableLowConfidenceRescue: false,
      enableQueryExpansion: false
    });

    // Should have 2 unique files, not 3 results (two from foo.ts)
    const filePaths = results.map((r: any) => r.filePath);
    expect(filePaths.length).toBe(2);
    expect(filePaths[0]).toContain('foo.ts');
    expect(filePaths[1]).toContain('baz.ts');
  });
});
