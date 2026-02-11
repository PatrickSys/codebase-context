import { describe, it, expect, vi } from 'vitest';
import type { CodeChunk } from '../src/types/index.js';
import { CodebaseSearcher } from '../src/core/search.js';

function createChunk(id: string, filePath: string, content: string): CodeChunk {
  return {
    id,
    content,
    filePath,
    relativePath: filePath,
    startLine: 1,
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
  };
}

describe('CodebaseSearcher retrieval strategy', () => {
  it('enforces candidate floor independently from user limit', async () => {
    const implChunk = createChunk(
      'impl',
      'src/core/auth-service.ts',
      'export class AuthService {}'
    );
    const searcher = new CodebaseSearcher('C:/repo') as any;

    searcher.initialized = true;
    searcher.embeddingProvider = {};
    searcher.storageProvider = {};
    searcher.fuseIndex = null;
    searcher.patternIntelligence = null;
    searcher.semanticSearch = vi.fn(async () => [{ chunk: implChunk, score: 0.7 }]);
    searcher.keywordSearch = vi.fn(async () => []);

    await searcher.search('authentication login', 1, undefined, {
      enableQueryExpansion: false,
      enableLowConfidenceRescue: false,
      candidateFloor: 30
    });

    expect(searcher.semanticSearch).toHaveBeenCalledTimes(1);
    expect(searcher.semanticSearch.mock.calls[0][1]).toBe(30);
  });

  it('uses bounded query expansion for intent-heavy queries', async () => {
    const implChunk = createChunk(
      'impl',
      'src/core/router-service.ts',
      'export class RouterService {}'
    );
    const searcher = new CodebaseSearcher('C:/repo') as any;

    searcher.initialized = true;
    searcher.embeddingProvider = {};
    searcher.storageProvider = {};
    searcher.fuseIndex = null;
    searcher.patternIntelligence = null;
    searcher.semanticSearch = vi.fn(async () => [{ chunk: implChunk, score: 0.65 }]);
    searcher.keywordSearch = vi.fn(async () => []);

    await searcher.search('authentication login', 3, undefined, {
      enableQueryExpansion: true,
      enableLowConfidenceRescue: false
    });

    const semanticQueries = searcher.semanticSearch.mock.calls.map((call: any[]) => call[0]);
    expect(semanticQueries[0]).toBe('authentication login');
    expect(semanticQueries.length).toBeLessThanOrEqual(2);
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

    const searcher = new CodebaseSearcher('C:/repo') as any;
    searcher.initialized = true;
    searcher.embeddingProvider = {};
    searcher.storageProvider = {};
    searcher.fuseIndex = null;
    searcher.patternIntelligence = null;

    searcher.semanticSearch = vi.fn(async (query: string) => {
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
    searcher.keywordSearch = vi.fn(async () => []);

    const results = await searcher.search('navigate to page after login redirect', 2, undefined, {
      enableQueryExpansion: false,
      enableLowConfidenceRescue: true,
      profile: 'edit'
    });

    expect(results[0].filePath).toContain('auth-callback.component.ts');
    expect(results[0].filePath).not.toContain('.spec.ts');
  });

  it('applies intent-based keyword-heavy weights for exact-name queries', async () => {
    const implChunk = createChunk(
      'impl',
      'src/core/auth-service.ts',
      'export class AuthService { login() {} }'
    );

    const searcher = new CodebaseSearcher('C:/repo') as any;
    searcher.initialized = true;
    searcher.embeddingProvider = {};
    searcher.storageProvider = {};
    searcher.fuseIndex = null;
    searcher.patternIntelligence = null;

    let capturedSemanticWeight: number | undefined;
    let capturedKeywordWeight: number | undefined;

    // Intercept collectHybridMatches to capture the weights used
    searcher.collectHybridMatches = vi.fn(
      async (
        _variants: any,
        _limit: any,
        _filters: any,
        _useSemantic: any,
        _useKeyword: any,
        semWeight: number,
        kwWeight: number
      ) => {
        capturedSemanticWeight = semWeight;
        capturedKeywordWeight = kwWeight;
        return {
          semantic: new Map([
            ['impl', { chunk: implChunk, ranks: [{ rank: 0, weight: semWeight }] }]
          ]),
          keyword: new Map([
            ['impl', { chunk: implChunk, ranks: [{ rank: 0, weight: kwWeight }] }]
          ])
        };
      }
    );

    // AuthService is PascalCase → EXACT_NAME intent → keyword: 0.6, semantic: 0.4
    await searcher.search('AuthService', 3, undefined, {
      enableQueryExpansion: false,
      enableLowConfidenceRescue: false
    });

    expect(capturedKeywordWeight).toBeGreaterThan(capturedSemanticWeight!);
    expect(capturedKeywordWeight).toBeCloseTo(0.6, 1);
    expect(capturedSemanticWeight).toBeCloseTo(0.4, 1);
  });

  it('produces scores below 1.0 for weak single-list retrievals', async () => {
    const strongChunk = createChunk(
      'strong',
      'src/core/auth-service.ts',
      'export class AuthService { login() {} }'
    );
    const weakChunk = createChunk('weak', 'src/utils/helpers.ts', 'export function helper() {}');

    const searcher = new CodebaseSearcher('C:/repo') as any;
    searcher.initialized = true;
    searcher.embeddingProvider = {};
    searcher.storageProvider = {};
    searcher.fuseIndex = null;
    searcher.patternIntelligence = null;

    // Mock collectHybridMatches: strong chunk rank 0 in both channels,
    // weak chunk rank 5 in keyword only
    searcher.collectHybridMatches = vi.fn(
      async (
        _variants: any,
        _limit: any,
        _filters: any,
        _useSemantic: any,
        _useKeyword: any,
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
  });
});
