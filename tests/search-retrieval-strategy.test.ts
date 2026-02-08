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
});
