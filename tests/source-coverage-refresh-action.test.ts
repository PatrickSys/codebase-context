import { describe, expect, it } from 'vitest';
import {
  presentSourceCoverage,
  sourceCoverageRefreshAction
} from '../src/core/source-coverage-action.js';

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

  it('replaces a refresh instruction when the only gap is the candidate budget', () => {
    const presented = presentSourceCoverage({
      skippedFiles: 0,
      candidateBudgetExhausted: true,
      refreshAction:
        'Run refresh_index with incrementalOnly=true to refresh changed or unavailable sources, then retry.'
    });
    expect(presented.refreshAction).toMatch(/candidate budget/i);
    expect(presented.refreshAction).not.toMatch(/refresh_index/);
  });
});
