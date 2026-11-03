export interface SourceCoverageActionInput {
  skippedFiles: number;
  candidateBudgetExhausted?: boolean;
  candidateRetrievalFailed?: boolean;
  refreshAction?: string;
}

const SOURCE_REFRESH_ACTION =
  'Run refresh_index with incrementalOnly=true to refresh changed or unavailable sources, then retry.';
const CANDIDATE_BUDGET_ACTION =
  'Search candidate budget was exhausted. Narrow the query to a concrete symbol or path and retry.';

/** Stale or unreadable sources need a refresh. An exhausted candidate budget does not. */
export function sourceCoverageRefreshAction(input: {
  skippedFiles: number;
  candidateBudgetExhausted: boolean;
  candidateRetrievalFailed: boolean;
}): string | undefined {
  if (input.skippedFiles > 0 || input.candidateRetrievalFailed) return SOURCE_REFRESH_ACTION;
  if (input.candidateBudgetExhausted) return CANDIDATE_BUDGET_ACTION;
  return undefined;
}

export function presentSourceCoverage<T extends SourceCoverageActionInput>(coverage: T): T {
  if (coverage.skippedFiles > 0 || coverage.candidateRetrievalFailed === true) return coverage;
  const refreshAction = sourceCoverageRefreshAction({
    skippedFiles: 0,
    candidateBudgetExhausted: coverage.candidateBudgetExhausted === true,
    candidateRetrievalFailed: false
  });
  if (!refreshAction || refreshAction === coverage.refreshAction) return coverage;
  return { ...coverage, refreshAction };
}
