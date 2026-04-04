import { describe, expect, it, vi } from 'vitest';
import { CodebaseSearcher } from '../src/core/search.js';
import type { CodeChunk, SearchResult } from '../src/types/index.js';
import type { EvalFixture, EvalQuery } from '../src/eval/types.js';
import {
  countUtf8Bytes,
  estimateTokenCountFromBytes,
  evaluateFixture,
  summarizeEvaluation,
  formatEvalReport
} from '../src/eval/harness.js';
import angularFixture from './fixtures/eval-angular-spotify.json';
import controlledFixture from './fixtures/eval-controlled.json';

function createChunk(
  id: string,
  filePath: string,
  content: string,
  overrides?: Partial<CodeChunk>
): CodeChunk {
  return {
    id,
    content,
    filePath,
    relativePath: filePath.replace(/^.*?[/\\](?:src|libs|apps)[/\\]/, ''),
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
    metadata: {},
    ...overrides
  };
}

function makeSearchResult(filePath: string, score: number): SearchResult {
  return {
    filePath,
    score
  } as SearchResult;
}

function setupSearcherWithResultsByQuery(
  byQuery: Record<string, SearchResult[]>,
  fallback: SearchResult[] = []
): CodebaseSearcher {
  const searcher = new CodebaseSearcher('C:/repo') as any;
  searcher.initialized = true;
  searcher.search = vi.fn(async (query: string) => byQuery[query] ?? fallback);
  return searcher as CodebaseSearcher;
}

function fixtureForSingleQuery(query: EvalQuery): EvalFixture {
  return {
    description: 'single query fixture',
    codebase: 'unit-test',
    repository: 'in-memory',
    frozenDate: '2026-02-20',
    notes: 'test fixture',
    queries: [query]
  };
}

describe('Eval Harness - fixtures loaded', () => {
  it('keeps angular-spotify fixture frozen at exactly 20 queries', () => {
    expect(angularFixture.queries).toHaveLength(20);
  });

  it('keeps angular-spotify fixture category coverage intact', () => {
    const categories = new Set(angularFixture.queries.map((query) => query.category));
    expect(categories.has('exact-name')).toBe(true);
    expect(categories.has('conceptual')).toBe(true);
    expect(categories.has('multi-concept')).toBe(true);
    expect(categories.has('structural')).toBe(true);
  });

  it('keeps controlled fixture frozen metadata and minimum size', () => {
    expect(controlledFixture).toBeDefined();
    expect(controlledFixture.frozenDate).toBeTypeOf('string');
    expect(controlledFixture.frozenDate.length).toBeGreaterThan(0);
    expect(controlledFixture.queries.length).toBeGreaterThanOrEqual(20);
  });
});

describe('Eval Harness - scoring logic', () => {
  it('estimates payload cost with a fixed bytes-to-token heuristic', () => {
    const bytes = countUtf8Bytes('auth interceptor');
    expect(bytes).toBeGreaterThan(0);
    expect(estimateTokenCountFromBytes(bytes)).toBe(Math.ceil(bytes / 4));
  });

  it('marks correct top-1 when implementation file is first', async () => {
    const query: EvalQuery = {
      id: 7,
      query: 'authentication login',
      category: 'conceptual',
      expectedPatterns: ['auth.service'],
      expectedNotPatterns: ['.spec.', '/e2e/']
    };

    const searcher = setupSearcherWithResultsByQuery({
      'authentication login': [
        makeSearchResult('src/services/auth/auth.service.ts', 0.65),
        makeSearchResult('src/e2e/setup.ts', 0.55)
      ]
    });

    const summary = await evaluateFixture({
      fixture: fixtureForSingleQuery(query),
      searcher
    });

    expect(summary.results[0].top1Correct).toBe(true);
    expect(summary.results[0].specContaminated).toBe(false);
  });

  it('marks FAIL when spec file is top-1 for non-test query', async () => {
    const query: EvalQuery = {
      id: 4,
      query: 'add authorization token to API requests',
      category: 'conceptual',
      expectedPatterns: ['auth', 'interceptor'],
      expectedNotPatterns: ['.spec.', '.test.']
    };

    const searcher = setupSearcherWithResultsByQuery({
      'add authorization token to API requests': [
        makeSearchResult('src/interceptors/auth.interceptor.spec.ts', 0.45),
        makeSearchResult('src/interceptors/error.interceptor.spec.ts', 0.42),
        makeSearchResult('src/services/api.service.spec.ts', 0.39)
      ]
    });

    const summary = await evaluateFixture({
      fixture: fixtureForSingleQuery(query),
      searcher
    });

    expect(summary.results[0].top1Correct).toBe(false);
    expect(summary.results[0].specContaminated).toBe(true);
  });

  it('detects spec contamination when 2+ spec files appear in top 3', async () => {
    const query: EvalQuery = {
      id: 3,
      query: 'persist data across browser sessions',
      category: 'conceptual',
      expectedPatterns: ['storage'],
      expectedNotPatterns: ['.spec.']
    };

    const searcher = setupSearcherWithResultsByQuery({
      'persist data across browser sessions': [
        makeSearchResult('src/services/local-storage.service.ts', 0.5),
        makeSearchResult('src/services/local-storage.service.spec.ts', 0.48),
        makeSearchResult('src/services/session.service.spec.ts', 0.45)
      ]
    });

    const summary = await evaluateFixture({
      fixture: fixtureForSingleQuery(query),
      searcher
    });

    expect(summary.results[0].top1Correct).toBe(true);
    expect(summary.results[0].specContaminated).toBe(true);
  });

  it('summarizeEvaluation applies gate threshold correctly', () => {
    const passing = Array.from({ length: 14 }, (_, index) => ({
      queryId: index + 1,
      query: `q${index}`,
      category: 'conceptual',
      expectedPatterns: ['correct.ts'],
      expectedNotPatterns: ['.spec.'],
      topFile: 'correct.ts',
      top3Files: ['correct.ts'],
      top1Correct: true,
      top3Recall: true,
      specContaminated: false,
      score: 0.6
    }));

    const failing = Array.from({ length: 6 }, (_, index) => ({
      queryId: index + 15,
      query: `q${index + 14}`,
      category: 'multi-concept',
      expectedPatterns: ['correct.ts'],
      expectedNotPatterns: ['.spec.'],
      topFile: 'wrong.spec.ts',
      top3Files: ['wrong.spec.ts'],
      top1Correct: false,
      top3Recall: false,
      specContaminated: true,
      score: 0.3
    }));

    const summary = summarizeEvaluation([...passing, ...failing], 14);
    expect(summary.total).toBe(20);
    expect(summary.top1Correct).toBe(14);
    expect(summary.passesGate).toBe(true);
    expect(summary.top1Accuracy).toBeCloseTo(14 / 20, 2);
  });

  it('formatEvalReport includes wins and failures sections', () => {
    const summary = summarizeEvaluation(
      [
        {
          queryId: 1,
          query: 'AuthService',
          category: 'exact-name',
          expectedPatterns: ['auth.service.ts'],
          expectedNotPatterns: ['.spec.'],
          topFile: 'src/services/auth.service.ts',
          top3Files: ['src/services/auth.service.ts'],
          top1Correct: true,
          top3Recall: true,
          specContaminated: false,
          score: 0.9
        },
        {
          queryId: 2,
          query: 'album selectors',
          category: 'structural',
          expectedPatterns: ['selector'],
          expectedNotPatterns: ['.spec.'],
          topFile: 'src/services/album.service.ts',
          top3Files: ['src/services/album.service.ts', 'src/store/album.selector.ts'],
          top1Correct: false,
          top3Recall: true,
          specContaminated: false,
          score: 0.4
        }
      ],
      1
    );

    const report = formatEvalReport({
      codebaseLabel: 'fixture-repo',
      fixturePath: 'tests/fixtures/eval-controlled.json',
      summary,
      redactPaths: false
    });

    expect(report).toContain('Wins:');
    expect(report).toContain('Failures:');
    expect(report).toContain('expected: selector');
  });
});

describe('Eval Harness - integration with CodebaseSearcher (mocked)', () => {
  it('keeps mocked searcher network-free', async () => {
    const authServiceChunk = createChunk(
      'auth-svc',
      'C:/repo/src/services/auth/auth.service.ts',
      'export class AuthService { login() {} isLoggedIn$ = new BehaviorSubject(false); }',
      { componentType: 'service', metadata: { componentName: 'AuthService' } }
    );
    const e2eChunk = createChunk(
      'e2e-auth',
      'C:/repo/src/e2e/setup.ts',
      'export async function authenticate() { await page.fill(username); }',
      { componentType: 'unknown' }
    );

    const searcher = new CodebaseSearcher('C:/repo') as any;
    searcher.initialized = true;
    searcher.embeddingProvider = {
      embed: vi.fn(async () => new Array(384).fill(0.01))
    };
    searcher.storageProvider = {
      search: vi.fn(async () => [
        { chunk: authServiceChunk, score: 0.65 },
        { chunk: e2eChunk, score: 0.55 }
      ]),
      count: vi.fn(async () => 2)
    };
    searcher.fuseIndex = null;
    searcher.patternIntelligence = null;

    const results = await (searcher as CodebaseSearcher).search('AuthService', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].filePath).toContain('auth.service.ts');
  });
});
