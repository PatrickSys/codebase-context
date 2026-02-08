import { describe, expect, it } from 'vitest';
import type { SearchResult } from '../src/types/index.js';
import { assessSearchQuality } from '../src/core/search-quality.js';

function makeResult(filePath: string, score: number): SearchResult {
  return {
    summary: 'summary',
    snippet: 'snippet',
    filePath,
    startLine: 1,
    endLine: 10,
    score,
    relevanceReason: 'match',
    language: 'typescript',
    framework: 'generic',
    componentType: 'service',
    layer: 'core',
    metadata: {}
  };
}

describe('assessSearchQuality', () => {
  it('returns low confidence when no results are returned', () => {
    const quality = assessSearchQuality('find authentication flow', []);

    expect(quality.status).toBe('low_confidence');
    expect(quality.confidence).toBe(0);
    expect(quality.signals).toContain('no results returned');
    expect(quality.nextSteps?.length).toBeGreaterThan(0);
  });

  it('flags test-artifact dominance for non-testing queries', () => {
    const quality = assessSearchQuality('find login redirect implementation', [
      makeResult('src/features/login/login.service.spec.ts', 0.31),
      makeResult('tests/e2e/login-flow.test.ts', 0.29),
      makeResult('src/features/login/login-helpers.spec.ts', 0.28)
    ]);

    expect(quality.status).toBe('low_confidence');
    expect(quality.signals.some((signal) => signal.includes('test artifacts dominate'))).toBe(true);
  });

  it('returns ok when top results are strong and separated', () => {
    const quality = assessSearchQuality('where is order validation implemented', [
      makeResult('src/domain/orders/order-validation.service.ts', 0.78),
      makeResult('src/domain/orders/order-rules.ts', 0.61),
      makeResult('src/domain/orders/order-types.ts', 0.53)
    ]);

    expect(quality.status).toBe('ok');
    expect(quality.confidence).toBeGreaterThanOrEqual(0.5);
  });
});
