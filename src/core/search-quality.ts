import type { SearchResult } from '../types/index.js';
import { isTestingRelatedQuery } from '../preflight/query-scope.js';

export interface SearchQualityAssessment {
  status: 'ok' | 'low_confidence';
  confidence: number;
  signals: string[];
  nextSteps?: string[];
}

export function isTestArtifactPath(filePath: string): boolean {
  const normalized = filePath.toLowerCase().replace(/\\/g, '/');
  return (
    normalized.includes('.spec.') ||
    normalized.includes('.test.') ||
    normalized.includes('/e2e/') ||
    normalized.includes('/__tests__/')
  );
}

export function assessSearchQuality(
  query: string,
  results: SearchResult[]
): SearchQualityAssessment {
  if (results.length === 0) {
    return {
      status: 'low_confidence',
      confidence: 0,
      signals: ['no results returned'],
      nextSteps: [
        'Try a narrower query with one concrete symbol, route, or file hint.',
        'Apply search filters (framework/language/componentType/layer).',
        'Use get_component_usage for dependency or wiring lookups.'
      ]
    };
  }

  const topSlice = results.slice(0, Math.min(3, results.length));
  const topScore = results[0].score;
  const secondScore = results[1]?.score ?? topScore;
  const topAverage = topSlice.reduce((sum, result) => sum + result.score, 0) / topSlice.length;
  const topSeparation = Math.max(0, topScore - secondScore);
  const testRatio =
    topSlice.filter((result) => isTestArtifactPath(result.filePath)).length / topSlice.length;
  const queryIsTesting = isTestingRelatedQuery(query);

  const signals: string[] = [];
  if (topScore < 0.3) {
    signals.push(`low top score (${topScore.toFixed(2)})`);
  }
  if (topAverage < 0.32) {
    signals.push(`weak top-${topSlice.length} average (${topAverage.toFixed(2)})`);
  }
  if (topSlice.length > 1 && topSeparation < 0.03) {
    signals.push(`tight top spread (${topSeparation.toFixed(2)})`);
  }
  if (!queryIsTesting && testRatio >= 0.67) {
    signals.push(
      `test artifacts dominate top-${topSlice.length} (${Math.round(testRatio * 100)}%)`
    );
  }

  let confidence = topScore;
  if (topAverage < 0.32) confidence -= 0.08;
  if (topSlice.length > 1 && topSeparation < 0.03) confidence -= 0.05;
  if (!queryIsTesting && testRatio >= 0.67) confidence -= 0.15;
  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));

  const lowConfidence = signals.length >= 2 || confidence < 0.35;

  return {
    status: lowConfidence ? 'low_confidence' : 'ok',
    confidence,
    signals,
    ...(lowConfidence && {
      nextSteps: [
        'Add one or two concrete symbols, routes, or file hints to the query.',
        'Apply filters (framework/language/componentType/layer) to narrow candidates.',
        'Use get_component_usage when the question is about wiring or usages.'
      ]
    })
  };
}
