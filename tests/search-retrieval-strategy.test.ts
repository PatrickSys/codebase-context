import { describe, it, expect, vi } from 'vitest';
import type { CodeChunk } from '../src/types/index.js';
import { CodebaseSearcher } from '../src/core/search.js';
import { asSearcherTestHarness, materializeSourceSnapshot } from './helpers/source-snapshot.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IndexCorruptedError } from '../src/errors/index.js';

function createChunk(id: string, filePath: string, content: string): CodeChunk {
  return {
    id,
    content,
    filePath,
    relativePath: filePath,
    startLine: 1,
    endLine: content.split('\n').length,
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

async function createSourceBackedSearcher(chunks: CodeChunk[]) {
  const snapshot = await materializeSourceSnapshot(chunks, 'retrieval-source-');
  const searcher = new CodebaseSearcher(snapshot.rootPath);
  const harness = asSearcherTestHarness(searcher);
  harness.initialized = true;
  harness.sourceManifest = snapshot.manifest;
  harness.embeddingProvider = {};
  harness.storageProvider = {};
  harness.fuseIndex = null;
  harness.patternIntelligence = null;
  harness.semanticSearch = vi.fn(async () => []);
  harness.keywordSearch = vi.fn(async () => []);
  return {
    searcher,
    harness,
    cleanup: snapshot.cleanup
  };
}

describe('CodebaseSearcher retrieval strategy', () => {
  it.each(['ordinary', 'integrity'] as const)(
    'preserves validated candidates on ordinary refill failure and propagates integrity failure (%s)',
    async (failure) => {
      const stale = Array.from({ length: 100 }, (_, n) =>
        createChunk(
          `stale-${n}`,
          'src/quartzBeacon.ts',
          'export function quartzBeacon() { return true; }'
        )
      );
      const support = createChunk(
        'support',
        'src/support.ts',
        'export function support() { return quartzBeacon(); }'
      );
      const chunks = [...stale, support];
      const fixture = await createSourceBackedSearcher(chunks);
      const harness = fixture.harness as typeof fixture.harness & { chunks: CodeChunk[] };
      harness.chunks = chunks;
      Reflect.deleteProperty(harness, 'semanticSearch');
      const embed = vi.fn(async () => [0.1, 0.2]);
      const vectorSearch = vi
        .fn()
        .mockResolvedValueOnce(
          [...stale.slice(0, 29), support].map((chunk) => ({ chunk, score: 0.9, distance: 0.1 }))
        )
        .mockRejectedValueOnce(
          failure === 'integrity'
            ? new IndexCorruptedError('Invalid vector index build identity')
            : new Error('Semantic refill temporarily unavailable')
        );
      harness.embeddingProvider = { embed };
      harness.storageProvider = { search: vectorSearch };
      try {
        await fs.writeFile(stale[0].filePath, 'export const changed = true;\n');
        const outcome = fixture.searcher.searchWithCoverage(
          'ordinary semantic request',
          1,
          undefined,
          {
            useKeywordSearch: false,
            useSemanticSearch: true,
            enableQueryExpansion: false,
            enableLowConfidenceRescue: false,
            enableReranker: false
          }
        );
        if (failure === 'integrity') {
          await expect(outcome).rejects.toBeInstanceOf(IndexCorruptedError);
        } else {
          const result = await outcome;
          expect(result.results.map((match) => path.basename(match.filePath))).toEqual([
            'support.ts'
          ]);
          expect(result.results[0].snippet).toContain('support');
          expect(result.sourceCoverage).toMatchObject({
            status: 'partial',
            checkedFiles: 2,
            skippedFiles: 1,
            candidateRetrievalFailed: true
          });
          expect(result.sourceCoverage.candidateBudgetExhausted).toBeUndefined();
        }
        expect(embed).toHaveBeenCalledTimes(1);
        expect(vectorSearch).toHaveBeenCalledTimes(2);
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it('discloses semantic exhaustion when widening reaches the bounded cumulative retrieval work', async () => {
    const stale = Array.from({ length: 1000 }, (_, n) =>
      createChunk(
        `stale-${n}`,
        'src/quartzBeacon.ts',
        'export function quartzBeacon() { return true; }'
      )
    );
    const support = createChunk(
      'support',
      'src/support.ts',
      'export function support() { return quartzBeacon(); }'
    );
    const chunks = [...stale, support];
    const fixture = await createSourceBackedSearcher(chunks);
    const harness = fixture.harness as typeof fixture.harness & { chunks: CodeChunk[] };
    harness.chunks = chunks;
    Reflect.deleteProperty(harness, 'semanticSearch');
    const embed = vi.fn(async () => [0.1, 0.2]);
    const vectorSearch = vi.fn(async (_vector: number[], limit: number) =>
      chunks.slice(0, limit).map((chunk) => ({ chunk, score: 0.9, distance: 0.1 }))
    );
    harness.embeddingProvider = { embed };
    harness.storageProvider = { search: vectorSearch };
    try {
      await fs.writeFile(stale[0].filePath, 'export const changed = true;\n');
      const outcome = await fixture.searcher.searchWithCoverage('quartzBeacon', 1, undefined, {
        useKeywordSearch: false,
        useSemanticSearch: true,
        enableQueryExpansion: false,
        enableLowConfidenceRescue: false,
        enableReranker: false
      });
      expect(outcome.results).toEqual([]);
      expect(outcome.sourceCoverage).toMatchObject({
        status: 'no_fresh_results',
        checkedFiles: 1,
        skippedFiles: 1,
        candidateBudgetExhausted: true
      });
      expect(embed).toHaveBeenCalledTimes(1);
      expect(vectorSearch).toHaveBeenCalledTimes(2);
      expect(
        vectorSearch.mock.calls.reduce((sum, [, limit]) => sum + limit, 0)
      ).toBeLessThanOrEqual(750);
      expect(Math.max(...vectorSearch.mock.calls.map(([, limit]) => limit))).toBeLessThanOrEqual(
        chunks.length
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([false, true])(
    'replenishes semantic stale prefixes only when needed (changed=%s) with one embedding',
    async (changed) => {
      const staleChunks = Array.from({ length: 100 }, (_, n) =>
        createChunk(
          `stale-${n}`,
          'src/quartzBeacon.ts',
          'export function quartzBeacon() { return true; }'
        )
      );
      const support = createChunk(
        'support',
        'src/support.ts',
        'export function support() { return quartzBeacon(); }'
      );
      const chunks = [...staleChunks, support];
      const fixture = await createSourceBackedSearcher(chunks);
      const harness = fixture.harness as typeof fixture.harness & { chunks: CodeChunk[] };
      harness.chunks = chunks;
      Reflect.deleteProperty(harness, 'semanticSearch');
      const embed = vi.fn(async () => [0.1, 0.2]);
      const vectorSearch = vi.fn(async (_vector: number[], limit: number) =>
        chunks.slice(0, limit).map((chunk) => ({ chunk, score: 0.9, distance: 0.1 }))
      );
      harness.embeddingProvider = { embed };
      harness.storageProvider = { search: vectorSearch };
      try {
        if (changed) await fs.writeFile(staleChunks[0].filePath, 'export const changed = true;\n');
        const outcome = await fixture.searcher.searchWithCoverage('quartzBeacon', 1, undefined, {
          useKeywordSearch: false,
          useSemanticSearch: true,
          enableQueryExpansion: false,
          enableLowConfidenceRescue: false,
          enableReranker: false
        });
        expect(outcome.results).toHaveLength(1);
        expect(path.basename(outcome.results[0].filePath)).toBe(
          changed ? 'support.ts' : 'quartzBeacon.ts'
        );
        expect(embed).toHaveBeenCalledTimes(1);
        expect(vectorSearch).toHaveBeenCalledTimes(changed ? 2 : 1);
        expect(vectorSearch.mock.calls[0][1]).toBe(30);
        if (changed) {
          expect(vectorSearch.mock.calls[1][1]).toBe(101);
          expect(outcome.sourceCoverage).toMatchObject({
            status: 'partial',
            checkedFiles: 2,
            skippedFiles: 1
          });
        }
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it('enforces candidate floor independently from user limit', async () => {
    const implChunk = createChunk(
      'impl',
      'src/core/auth-service.ts',
      'export class AuthService {}'
    );
    const { searcher, harness, cleanup } = await createSourceBackedSearcher([implChunk]);
    const semanticSearch = vi.fn(async () => [{ chunk: implChunk, score: 0.7 }]);
    harness.semanticSearch = semanticSearch;
    try {
      await searcher.search('authentication login', 1, undefined, {
        enableQueryExpansion: false,
        enableLowConfidenceRescue: false,
        candidateFloor: 30
      });
      expect(semanticSearch).toHaveBeenCalledTimes(1);
      expect(semanticSearch.mock.calls[0][1]).toBe(30);
    } finally {
      await cleanup();
    }
  });

  it('uses bounded query expansion for intent-heavy queries', async () => {
    const implChunk = createChunk(
      'impl',
      'src/core/router-service.ts',
      'export class RouterService {}'
    );
    const { searcher, harness, cleanup } = await createSourceBackedSearcher([implChunk]);
    const semanticSearch = vi.fn(async (_query: string) => [{ chunk: implChunk, score: 0.65 }]);
    harness.semanticSearch = semanticSearch;
    try {
      await searcher.search('authentication login', 3, undefined, {
        enableQueryExpansion: true,
        enableLowConfidenceRescue: false
      });
      const semanticQueries = semanticSearch.mock.calls.map(([query]) => query);
      expect(semanticQueries[0]).toBe('authentication login');
      expect(semanticQueries.length).toBeLessThanOrEqual(2);
    } finally {
      await cleanup();
    }
  });

  it('runs low-confidence rescue and can replace poor primary ranking', async () => {
    const specChunk = createChunk(
      'spec',
      'src/core/auth/auth-callback.component.spec.ts',
      "describe('auth', () => {})"
    );
    const implChunk = createChunk(
      'impl',
      'src/core/auth/auth-callback.component.ts',
      'export class AuthCallbackComponent {}'
    );

    const { searcher, harness, cleanup } = await createSourceBackedSearcher([specChunk, implChunk]);

    const semanticSearch = vi.fn(async (query: string) => {
      if (query.includes('router') || query.includes('navigation')) {
        return [
          { chunk: implChunk, score: 0.8 },
          { chunk: specChunk, score: 0.2 }
        ];
      }

      return [
        { chunk: specChunk, score: 0.5 },
        { chunk: implChunk, score: 0.35 }
      ];
    });
    harness.semanticSearch = semanticSearch;
    try {
      const results = await searcher.search('navigate to page after login redirect', 2, undefined, {
        enableQueryExpansion: false,
        enableLowConfidenceRescue: true,
        profile: 'edit'
      });
      expect(results[0].filePath).toContain('auth-callback.component.ts');
      expect(results[0].filePath).not.toContain('.spec.ts');
    } finally {
      await cleanup();
    }
  });

  it('applies intent-based keyword-heavy weights for exact-name queries', async () => {
    const implChunk = createChunk(
      'impl',
      'src/core/auth-service.ts',
      'export class AuthService { login() {} }'
    );

    const { searcher, harness, cleanup } = await createSourceBackedSearcher([implChunk]);

    let capturedSemanticWeight: number | undefined;
    let capturedKeywordWeight: number | undefined;

    // Intercept collectHybridMatches to capture the weights used
    harness.collectHybridMatches = vi.fn(
      async (
        _variants: unknown,
        _limit: unknown,
        _filters: unknown,
        _useSemantic: unknown,
        _useKeyword: unknown,
        semWeight: number,
        kwWeight: number
      ) => {
        capturedSemanticWeight = semWeight;
        capturedKeywordWeight = kwWeight;
        return {
          semantic: new Map([
            ['impl', { chunk: implChunk, ranks: [{ rank: 0, weight: semWeight }] }]
          ]),
          keyword: new Map([['impl', { chunk: implChunk, ranks: [{ rank: 0, weight: kwWeight }] }]])
        };
      }
    );

    // AuthService is PascalCase → EXACT_NAME intent → keyword: 0.6, semantic: 0.4
    try {
      await searcher.search('AuthService', 3, undefined, {
        enableQueryExpansion: false,
        enableLowConfidenceRescue: false
      });
      expect(capturedKeywordWeight).toBeGreaterThan(capturedSemanticWeight!);
      expect(capturedKeywordWeight).toBeCloseTo(0.6, 1);
      expect(capturedSemanticWeight).toBeCloseTo(0.4, 1);
    } finally {
      await cleanup();
    }
  });

  it('produces scores below 1.0 for weak single-list retrievals', async () => {
    const strongChunk = createChunk(
      'strong',
      'src/core/auth-service.ts',
      'export class AuthService { login() {} }'
    );
    const weakChunk = createChunk('weak', 'src/utils/helpers.ts', 'export function helper() {}');

    const { searcher, harness, cleanup } = await createSourceBackedSearcher([
      strongChunk,
      weakChunk
    ]);

    // Mock collectHybridMatches: strong chunk rank 0 in both channels,
    // weak chunk rank 5 in keyword only
    harness.collectHybridMatches = vi.fn(
      async (
        _variants: unknown,
        _limit: unknown,
        _filters: unknown,
        _useSemantic: unknown,
        _useKeyword: unknown,
        semWeight: number,
        kwWeight: number
      ) => ({
        semantic: new Map([
          ['strong', { chunk: strongChunk, ranks: [{ rank: 0, weight: semWeight }] }]
        ]),
        keyword: new Map([
          ['strong', { chunk: strongChunk, ranks: [{ rank: 0, weight: kwWeight }] }],
          ['weak', { chunk: weakChunk, ranks: [{ rank: 5, weight: kwWeight }] }]
        ])
      })
    );

    try {
      const results = await searcher.search('authentication login', 10, undefined, {
        enableQueryExpansion: false,
        enableLowConfidenceRescue: false
      });
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].score).toBeGreaterThan(0);
      // Key invariant: strong result (rank 0, both channels) must score
      // meaningfully higher than weak result (rank 5, keyword only).
      // With normalization-by-actual-max, the ratio collapses.
      const ratio = results[0].score / results[1].score;
      expect(ratio).toBeGreaterThan(1.5);
    } finally {
      await cleanup();
    }
  });
});
