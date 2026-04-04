import crypto from 'crypto';
import type { SearchResult } from '../types/index.js';
import type {
  EvalGate,
  EvalQuery,
  EvalResult,
  EvalSummary,
  EvaluateFixtureParams,
  FormatEvalReportParams
} from './types.js';

function normalizePath(filePath: string): string {
  return filePath.toLowerCase().replace(/\\/g, '/');
}

function isTestFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    normalized.includes('.spec.') ||
    normalized.includes('.test.') ||
    normalized.includes('/e2e/') ||
    normalized.includes('/__tests__/')
  );
}

function matchesPattern(filePath: string, patterns: string[]): boolean {
  const normalized = normalizePath(filePath);
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function dedupeByFile(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    const key = normalizePath(result.filePath);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

function getExpectedPatterns(query: EvalQuery): string[] {
  return query.expectedPatterns ?? query.expectedTopFiles ?? [];
}

function getExpectedNotPatterns(query: EvalQuery): string[] {
  return query.expectedNotPatterns ?? query.expectedNotTopFiles ?? [];
}

function evaluateQuery(query: EvalQuery, results: SearchResult[]): EvalResult {
  const uniqueResults = dedupeByFile(results);
  const topFile = uniqueResults.length > 0 ? uniqueResults[0].filePath : null;
  const top3Files = uniqueResults.slice(0, 3).map((result) => result.filePath);

  const expectedPatterns = getExpectedPatterns(query);
  const expectedNotPatterns = getExpectedNotPatterns(query);

  const top1Correct =
    topFile !== null &&
    matchesPattern(topFile, expectedPatterns) &&
    !matchesPattern(topFile, expectedNotPatterns);

  const top3Recall = top3Files.some(
    (filePath) =>
      matchesPattern(filePath, expectedPatterns) && !matchesPattern(filePath, expectedNotPatterns)
  );

  const specCount = top3Files.filter((filePath) => isTestFile(filePath)).length;
  const specContaminated = specCount >= 2;

  return {
    queryId: query.id,
    query: query.query,
    category: query.category,
    expectedPatterns,
    expectedNotPatterns,
    topFile,
    top3Files,
    top1Correct,
    top3Recall,
    specContaminated,
    score: uniqueResults.length > 0 ? uniqueResults[0].score : 0
  };
}

function resolveGateThreshold(total: number, gate: EvalGate): number {
  if (gate <= 1) {
    return Math.ceil(total * gate);
  }

  return Math.ceil(gate);
}

function hashPath(filePath: string): string {
  return crypto.createHash('sha1').update(normalizePath(filePath)).digest('hex').slice(0, 8);
}

export function countUtf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf-8');
}

export function estimateTokenCountFromBytes(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 4));
}

function formatPath(filePath: string | null, redactPaths: boolean): string {
  if (!filePath) {
    return 'none';
  }

  const normalized = filePath.replace(/\\/g, '/');
  if (!redactPaths) {
    return normalized;
  }

  const base = normalized.split('/').pop() || normalized;
  return `path#${hashPath(normalized)}/${base}`;
}

export async function evaluateFixture({
  fixture,
  searcher,
  limit = 5,
  searchOptions
}: EvaluateFixtureParams): Promise<EvalSummary> {
  const results: EvalResult[] = [];

  for (const query of fixture.queries) {
    const searchResults = await searcher.search(query.query, limit, undefined, searchOptions);
    results.push(evaluateQuery(query, searchResults));
  }

  return summarizeEvaluation(results);
}

export function summarizeEvaluation(results: EvalResult[], gate: EvalGate = 0.7): EvalSummary {
  const total = results.length;
  const top1Correct = results.filter((result) => result.top1Correct).length;
  const top3RecallCount = results.filter((result) => result.top3Recall).length;
  const specContaminatedCount = results.filter((result) => result.specContaminated).length;
  const avgTopScore =
    total > 0 ? results.reduce((sum, result) => sum + result.score, 0) / total : 0;
  const gateThreshold = resolveGateThreshold(total, gate);

  return {
    total,
    top1Correct,
    top1Accuracy: total > 0 ? top1Correct / total : 0,
    top3RecallCount,
    top3Recall: total > 0 ? top3RecallCount / total : 0,
    specContaminatedCount,
    specContaminationRate: total > 0 ? specContaminatedCount / total : 0,
    avgTopScore,
    gateThreshold,
    passesGate: total > 0 && top1Correct >= gateThreshold,
    results
  };
}

export function formatEvalReport({
  codebaseLabel,
  fixturePath,
  summary,
  redactPaths = true
}: FormatEvalReportParams): string {
  const lines: string[] = [];
  const wins = summary.results.filter((result) => result.top1Correct);
  const failures = summary.results.filter((result) => !result.top1Correct);

  lines.push(`\n=== Eval Report: ${codebaseLabel} ===`);
  lines.push(`Fixture: ${fixturePath}`);
  lines.push(
    `Top-1 Accuracy: ${summary.top1Correct}/${summary.total} (${(summary.top1Accuracy * 100).toFixed(0)}%)`
  );
  lines.push(
    `Top-3 Recall:   ${summary.top3RecallCount}/${summary.total} (${(summary.top3Recall * 100).toFixed(0)}%)`
  );
  lines.push(
    `Spec Contamination: ${summary.specContaminatedCount}/${summary.total} (${(summary.specContaminationRate * 100).toFixed(0)}%)`
  );
  lines.push(
    `Gate (${summary.gateThreshold}/${summary.total}): ${summary.passesGate ? 'PASS' : 'FAIL'}`
  );
  lines.push(`Wins: ${wins.length} | Failures: ${failures.length}`);

  lines.push('\nWins:');
  if (wins.length === 0) {
    lines.push('  (none)');
  } else {
    for (const result of wins) {
      lines.push(
        `  PASS #${result.queryId} [${result.category}] "${result.query}" -> ${formatPath(result.topFile, redactPaths)} (${result.score.toFixed(3)})`
      );
    }
  }

  lines.push('\nFailures:');
  if (failures.length === 0) {
    lines.push('  (none)');
  } else {
    for (const result of failures) {
      lines.push(
        `  FAIL #${result.queryId} [${result.category}] "${result.query}" -> ${formatPath(result.topFile, redactPaths)} (${result.score.toFixed(3)})`
      );
      lines.push(`    expected: ${result.expectedPatterns.join(' | ') || '(none)'}`);
      lines.push(`    expected-not: ${result.expectedNotPatterns.join(' | ') || '(none)'}`);
      lines.push('    top-3 actual:');
      if (result.top3Files.length === 0) {
        lines.push('      1. none');
      } else {
        for (let index = 0; index < result.top3Files.length; index++) {
          lines.push(`      ${index + 1}. ${formatPath(result.top3Files[index], redactPaths)}`);
        }
      }
    }
  }

  lines.push('\n================================');
  return lines.join('\n');
}
