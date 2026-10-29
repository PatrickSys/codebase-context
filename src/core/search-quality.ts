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

const LOW_CONFIDENCE_HINT =
  'Low confidence: this search is not evidence that the code is missing. Try one concrete symbol, file, or route, or call get_symbol_references.';

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
        LOW_CONFIDENCE_HINT,
        'Apply search filters (framework/language/componentType/layer).',
        'Use get_symbol_references to find where a specific symbol is used across the codebase.'
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
        LOW_CONFIDENCE_HINT,
        'Apply filters (framework/language/componentType/layer) to narrow candidates.',
        'Use get_symbol_references when the question is about where a symbol or function is used.'
      ]
    })
  };
}
