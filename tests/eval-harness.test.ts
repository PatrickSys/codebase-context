/**
 * Evaluation Harness for Search Quality
 *
 * Tests search quality against ground-truth queries defined in
 * tests/fixtures/eval-angular-spotify.json. Uses pattern-based matching
 * against a public codebase for reproducible evaluation.
 *
 * Metrics:
 * - Top-1 accuracy: Is the correct file the top result? (unique files)
 * - Top-3 recall: Is the correct file in the top 3 unique files?
 * - Spec contamination: Are test/spec files incorrectly dominating results?
 *
 * Gate: 14/20 correct top-1 results (70% threshold)
 *
 * Usage: This test is designed to work with MOCKED search results for unit testing.
 * For live evaluation against a real index, use the `evaluateSearchQuality()` function
 * directly with a CodebaseSearcher instance.
 */

import { describe, it, expect, vi } from 'vitest';
import type { CodeChunk, SearchResult } from '../src/types/index.js';
import { CodebaseSearcher } from '../src/core/search.js';
import evalFixture from './fixtures/eval-angular-spotify.json';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EvalQuery {
  id: number;
  query: string;
  category: string;
  expectedPatterns: string[];
  expectedNotPatterns: string[];
  notes: string;
}

interface EvalResult {
  queryId: number;
  query: string;
  category: string;
  topFile: string | null;
  top3Files: string[];
  top1Correct: boolean;
  top3Recall: boolean;
  specContaminated: boolean;
  score: number;
}

interface EvalSummary {
  total: number;
  top1Correct: number;
  top1Accuracy: number;
  top3Recall: number;
  specContaminationRate: number;
  avgTopScore: number;
  results: EvalResult[];
  passesGate: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isTestFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase().replace(/\\/g, '/');
  return (
    normalized.includes('.spec.') ||
    normalized.includes('.test.') ||
    normalized.includes('/e2e/') ||
    normalized.includes('/__tests__/')
  );
}

function matchesExpected(filePath: string, expectedPatterns: string[]): boolean {
  const normalized = filePath.toLowerCase().replace(/\\/g, '/');
  return expectedPatterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function matchesNotExpected(filePath: string, notExpectedPatterns: string[]): boolean {
  const normalized = filePath.toLowerCase().replace(/\\/g, '/');
  return notExpectedPatterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

/**
 * Deduplicate results to unique file paths (keep best-scored chunk per file).
 * Search already dedupes, but this makes the harness robust if called directly.
 */
function dedupeByFile(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const r of results) {
    const key = r.filePath.toLowerCase().replace(/\\/g, '/');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  return deduped;
}

/**
 * Evaluate a single query result against ground truth.
 * Results are deduplicated to unique files before scoring.
 */
function evaluateQuery(query: EvalQuery, results: SearchResult[]): EvalResult {
  const uniqueResults = dedupeByFile(results);
  const topFile = uniqueResults.length > 0 ? uniqueResults[0].filePath : null;
  const top3Files = uniqueResults.slice(0, 3).map((r) => r.filePath);

  const top1Correct = topFile !== null && matchesExpected(topFile, query.expectedPatterns) &&
    !matchesNotExpected(topFile, query.expectedNotPatterns);

  const top3Recall = top3Files.some(
    (f) => matchesExpected(f, query.expectedPatterns) && !matchesNotExpected(f, query.expectedNotPatterns)
  );

  const specCount = top3Files.filter((f) => isTestFile(f)).length;
  const specContaminated = specCount >= 2; // 2+ spec files in top 3 = contaminated

  return {
    queryId: query.id,
    query: query.query,
    category: query.category,
    topFile,
    top3Files,
    top1Correct,
    top3Recall,
    specContaminated,
    score: uniqueResults.length > 0 ? uniqueResults[0].score : 0
  };
}

/**
 * Run full evaluation and return summary.
 * This is the main function that both agents use to measure delta.
 */
export function summarizeEvaluation(results: EvalResult[]): EvalSummary {
  const total = results.length;
  const top1Correct = results.filter((r) => r.top1Correct).length;
  const top3RecallCount = results.filter((r) => r.top3Recall).length;
  const specContaminated = results.filter((r) => r.specContaminated).length;
  const avgTopScore =
    results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0;

  return {
    total,
    top1Correct,
    top1Accuracy: top1Correct / total,
    top3Recall: top3RecallCount / total,
    specContaminationRate: specContaminated / total,
    avgTopScore,
    results,
    passesGate: top1Correct >= 14 // 14/20 = 70% gate
  };
}

/**
 * Run evaluation against a live CodebaseSearcher instance.
 * This is the function to use for real measurement runs.
 */
export async function evaluateSearchQuality(
  searcher: CodebaseSearcher,
  limit: number = 5
): Promise<EvalSummary> {
  const queries = evalFixture.queries as EvalQuery[];
  const results: EvalResult[] = [];

  for (const query of queries) {
    const searchResults = await searcher.search(query.query, limit);
    results.push(evaluateQuery(query, searchResults));
  }

  return summarizeEvaluation(results);
}

/**
 * Pretty-print evaluation summary for console output
 */
export function printEvalSummary(summary: EvalSummary): string {
  const lines: string[] = [
    `\n=== Search Quality Evaluation ===`,
    `Top-1 Accuracy: ${summary.top1Correct}/${summary.total} (${(summary.top1Accuracy * 100).toFixed(0)}%)`,
    `Top-3 Recall:   ${(summary.top3Recall * 100).toFixed(0)}%`,
    `Spec Contamination: ${(summary.specContaminationRate * 100).toFixed(0)}%`,
    `Avg Top Score:  ${summary.avgTopScore.toFixed(3)}`,
    `Gate (14/20):   ${summary.passesGate ? 'PASS' : 'FAIL'}`,
    ``,
    `Per-query breakdown:`
  ];

  for (const r of summary.results) {
    const status = r.top1Correct ? 'PASS' : 'FAIL';
    const specNote = r.specContaminated ? ' [SPEC CONTAMINATED]' : '';
    const topFileShort = r.topFile ? r.topFile.split(/[\\/]/).pop() : 'none';
    lines.push(
      `  ${status} [${r.category}] "${r.query}" -> ${topFileShort} (${r.score.toFixed(3)})${specNote}`
    );
  }

  lines.push(`\n================================\n`);
  return lines.join('\n');
}

// ─── Unit Tests (mocked) ─────────────────────────────────────────────────────

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

function setupSearcherWithResults(
  results: { chunk: CodeChunk; score: number }[]
): CodebaseSearcher {
  const searcher = new CodebaseSearcher('C:/repo') as any;
  searcher.initialized = true;
  searcher.embeddingProvider = {
    embed: vi.fn(async () => new Array(384).fill(0.01))
  };
  searcher.storageProvider = {
    search: vi.fn(async () => results),
    count: vi.fn(async () => results.length)
  };
  searcher.fuseIndex = null;
  searcher.patternIntelligence = null;
  return searcher as CodebaseSearcher;
}

describe('Eval Harness - fixtures loaded', () => {
  it('has 20 evaluation queries', () => {
    expect(evalFixture.queries).toHaveLength(20);
  });

  it('covers all four categories', () => {
    const categories = new Set(evalFixture.queries.map((q: EvalQuery) => q.category));
    expect(categories.has('exact-name')).toBe(true);
    expect(categories.has('conceptual')).toBe(true);
    expect(categories.has('multi-concept')).toBe(true);
    expect(categories.has('structural')).toBe(true);
  });

  it('each query has expectedPatterns', () => {
    for (const q of evalFixture.queries as EvalQuery[]) {
      expect(q.expectedPatterns.length).toBeGreaterThan(0);
    }
  });
});

describe('Eval Harness - scoring logic', () => {
  it('marks correct top-1 when implementation file is first', () => {
    const query: EvalQuery = {
      id: 7,
      query: 'authentication login',
      category: 'conceptual',
      expectedPatterns: ['auth.service'],
      expectedNotPatterns: ['.spec.', '/e2e/'],
      notes: ''
    };
    const results: SearchResult[] = [
      { filePath: 'src/services/auth/auth.service.ts', score: 0.65 } as SearchResult,
      { filePath: 'src/e2e/setup.ts', score: 0.55 } as SearchResult
    ];

    const evalResult = evaluateQuery(query, results);
    expect(evalResult.top1Correct).toBe(true);
    expect(evalResult.specContaminated).toBe(false);
  });

  it('marks FAIL when spec file is top-1 for non-test query', () => {
    const query: EvalQuery = {
      id: 4,
      query: 'add authorization token to API requests',
      category: 'conceptual',
      expectedPatterns: ['auth', 'interceptor'],
      expectedNotPatterns: ['.spec.', '.test.'],
      notes: ''
    };
    const results: SearchResult[] = [
      { filePath: 'src/interceptors/auth.interceptor.spec.ts', score: 0.45 } as SearchResult,
      { filePath: 'src/interceptors/error.interceptor.spec.ts', score: 0.42 } as SearchResult,
      { filePath: 'src/services/api.service.spec.ts', score: 0.39 } as SearchResult
    ];

    const evalResult = evaluateQuery(query, results);
    expect(evalResult.top1Correct).toBe(false);
    expect(evalResult.specContaminated).toBe(true);
  });

  it('detects spec contamination when 2+ spec files in top 3', () => {
    const query: EvalQuery = {
      id: 3,
      query: 'persist data across browser sessions',
      category: 'conceptual',
      expectedPatterns: ['storage'],
      expectedNotPatterns: ['.spec.'],
      notes: ''
    };
    const results: SearchResult[] = [
      { filePath: 'src/services/local-storage.service.ts', score: 0.5 } as SearchResult,
      { filePath: 'src/services/local-storage.service.spec.ts', score: 0.48 } as SearchResult,
      { filePath: 'src/services/session.service.spec.ts', score: 0.45 } as SearchResult
    ];

    const evalResult = evaluateQuery(query, results);
    expect(evalResult.top1Correct).toBe(true); // implementation is top-1
    expect(evalResult.specContaminated).toBe(true); // but 2/3 are specs
  });

  it('summarizeEvaluation calculates gate correctly', () => {
    const passing: EvalResult[] = Array(14).fill(null).map((_, i) => ({
      queryId: i + 1, query: `q${i}`, category: 'conceptual',
      topFile: 'correct.ts', top3Files: ['correct.ts'], top1Correct: true,
      top3Recall: true, specContaminated: false, score: 0.6
    }));
    const failing: EvalResult[] = Array(6).fill(null).map((_, i) => ({
      queryId: i + 15, query: `q${i + 14}`, category: 'multi-concept',
      topFile: 'wrong.spec.ts', top3Files: ['wrong.spec.ts'], top1Correct: false,
      top3Recall: false, specContaminated: true, score: 0.3
    }));

    const summary = summarizeEvaluation([...passing, ...failing]);
    expect(summary.total).toBe(20);
    expect(summary.top1Correct).toBe(14);
    expect(summary.passesGate).toBe(true);
    expect(summary.top1Accuracy).toBeCloseTo(14 / 20, 2);
  });

  it('fails gate when only 13/20 pass', () => {
    const results: EvalResult[] = Array(20).fill(null).map((_, i) => ({
      queryId: i + 1, query: `q${i}`, category: 'conceptual',
      topFile: i < 13 ? 'correct.ts' : 'wrong.ts', top3Files: [],
      top1Correct: i < 13, top3Recall: i < 13, specContaminated: false, score: 0.5
    }));

    const summary = summarizeEvaluation(results);
    expect(summary.top1Correct).toBe(13);
    expect(summary.passesGate).toBe(false);
  });
});

describe('Eval Harness - integration with CodebaseSearcher (mocked)', () => {
  it('runs the auth service query correctly through searcher', async () => {
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

    const searcher = setupSearcherWithResults([
      { chunk: authServiceChunk, score: 0.65 },
      { chunk: e2eChunk, score: 0.55 }
    ]);

    const results = await searcher.search('AuthService', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].filePath).toContain('auth.service.ts');
  });
});
