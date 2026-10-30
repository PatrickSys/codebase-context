import { describe, expect, it } from 'vitest';
import { sourceCoverageRefreshAction } from '../src/core/search.js';

describe('sourceCoverageRefreshAction', () => {
  it('asks for a narrower query when only the candidate budget is exhausted', () => {
    const action = sourceCoverageRefreshAction({
      skippedFiles: 0,
      candidateBudgetExhausted: true,
      candidateRetrievalFailed: false
    });
    expect(action).toMatch(/candidate budget/i);
    expect(action).not.toMatch(/refresh_index/);
  });

  it('keeps refresh guidance when nominated sources were skipped', () => {
    const action = sourceCoverageRefreshAction({
      skippedFiles: 2,
      candidateBudgetExhausted: true,
      candidateRetrievalFailed: false
    });
    expect(action).toMatch(/refresh_index/);
  });
});
