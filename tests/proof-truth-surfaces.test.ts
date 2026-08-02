import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

type GateComparator = {
  comparatorName: string;
  status: string;
};

type GateArtifact = {
  gate: {
    status: string;
    claimAllowed: boolean;
    baseline: {
      status: string;
      missingMetrics?: string[];
    };
    comparators: GateComparator[];
  };
};

type ComparatorArtifact = {
  status: string;
  averageFirstRelevantHit?: number | null;
};

type ComparatorEvidence = Record<string, ComparatorArtifact>;

type ContextBenchSummary = {
  source: {
    provenance: string;
    rawArtifactsTracked: boolean;
    boundary: string;
  };
  publicationReadiness: {
    status: string;
    claimBearingPublicationAllowed: boolean;
    blockedClaimTypes: string[];
    claimScope: string;
    publicUseLevel: string;
  };
  retrievalChecks: {
    totalChecks: number;
    checksWithNoUsableContext: number;
    checksScored: number;
    retrievalChecks: number;
    tokenMeteredChecks: number;
    observedChecksPerTaskTool: number;
    observedRetrievalChecksPerTaskTool: number;
    observedTokenChecksPerTaskTool: number;
    tools: number;
    tasks: number;
    sameDenominatorChecksPresent: boolean;
  };
  qualitySnapshot: Array<{
    toolId: string;
    checks: number;
    checksScored: number;
    status: string;
    fileCoverageMean: number;
    symbolCoverageMean: number;
    spanCoverageMean: number;
    lineCoverageMean: number;
  }>;
  costSnapshot: Array<{
    toolId: string;
    indexMedianSeconds: number;
    indexSumMinutes: number;
    elapsedSumMinutes: number;
    peakPrivateGb: number;
    modelEvidence: string;
  }>;
  perToolRuntimeTokenAccounting: {
    status: string;
    meteredChecks: number;
    meteredChecksCompleted: number;
    checksMissingTokenCounters: number;
    finalRetrievalRawTracesScanned: number;
    rawTracesWithUsageCounters: number;
    allFinalTracesRetrievalOnly: boolean;
    metaCostIsNotSubstitute: boolean;
    tokenMeteredToolResults: Array<{
      toolId: string;
      meteredChecks: number;
      tokenCountersCaptured: number;
      medianInputTokens: number;
      medianCachedInputTokens: number;
      medianOutputTokens: number;
      medianReasoningOutputTokens: number;
      providerDollarCost: string;
    }>;
  };
  failedChecks: Array<{
    publicTreatment: string;
  }>;
  metaCost: {
    tokenAccounting: {
      scope: string;
      source: string;
      totalTokensApprox: number;
      inputTokensApprox: number;
      cachedInputTokensApprox: number;
      outputTokensApprox: number;
      reasoningOutputTokensApprox: number;
      missingPerToolRuntimeTokens: boolean;
      categoryNote: string;
    };
  };
  caveats: Record<string, string>;
};

function readText(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf8');
}

function readOptionalText(relPath: string): string | null {
  const absPath = resolve(root, relPath);
  if (!existsSync(absPath)) {
    return null;
  }

  return readFileSync(absPath, 'utf8');
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readText(relPath)) as T;
}

const gateArtifact = readJson<GateArtifact>('results/gate-evaluation.json');
const comparatorEvidence = readJson<ComparatorEvidence>('results/comparator-evidence.json');
const contextBenchSummaryText = readText('results/contextbench-engineering-note-summary.json');
const contextBenchSummary = JSON.parse(contextBenchSummaryText) as ContextBenchSummary;
const benchmarkDoc = readText('docs/benchmark.md');
const comparisonDoc = readText('docs/comparison-table.md');
const registryChecklist = readText('docs/registry-sync-checklist.md');
const readme = readText('README.md');
const changelog = readText('CHANGELOG.md');
const changelogUnreleased = changelog.split('\n## [2.3.0]', 1)[0] ?? changelog;
const capabilities = readText('docs/capabilities.md');
const demo = readText('docs/demo.md');
const todoDoc = readOptionalText('docs/TODO.md');
const spec = readOptionalText('.planning/SPEC.md');
const roadmap = readOptionalText('.planning/ROADMAP.md');
const milestones = readOptionalText('.planning/MILESTONES.md');
const publicSurfaceText = [
  readme,
  benchmarkDoc,
  capabilities,
  changelogUnreleased,
  comparisonDoc,
  demo,
  registryChecklist,
  contextBenchSummaryText
].join('\n');

function expectContains(text: string, snippets: string[]): void {
  const normalizedText = text.replace(/\s+/g, ' ');
  for (const snippet of snippets) {
    expect(normalizedText).toContain(snippet.replace(/\s+/g, ' '));
  }
}

describe('proof truth surfaces', () => {
  it('reads the current blocked discovery artifacts', () => {
    expect(gateArtifact.gate.status).toBeTruthy();
    expect(typeof gateArtifact.gate.claimAllowed).toBe('boolean');
    expect(comparatorEvidence['raw Claude Code']).toBeDefined();
    expect(comparatorEvidence['codebase-memory-mcp']).toBeDefined();
  });

  it('keeps the proof docs aligned to the current gate artifact', () => {
    expectContains(benchmarkDoc, [
      'older checked-in discovery gate',
      `\`${gateArtifact.gate.status}\``,
      '`claimAllowed`'
    ]);
    expectContains(comparisonDoc, [
      'Comparator Summary',
      `\`${gateArtifact.gate.status}\``,
      `claimAllowed\` stays \`${String(gateArtifact.gate.claimAllowed)}\``
    ]);
    expectContains(registryChecklist, [
      `claimAllowed: ${String(gateArtifact.gate.claimAllowed)}`,
      gateArtifact.gate.status,
      'separate local ContextBench case-study boundary',
      'Do not mix the newer local ContextBench case study into the older discovery gate'
    ]);
  });

  it('documents the raw-Claude missing-metric caveat when the artifact still lacks ranked-hit evidence', () => {
    const rawClaude = comparatorEvidence['raw Claude Code'];
    const rawClaudeGate = gateArtifact.gate.baseline;

    if (rawClaude.averageFirstRelevantHit === null) {
      expect(rawClaudeGate.status).toBe('pending_evidence');
      expect(rawClaudeGate.missingMetrics ?? []).toContain('averageFirstRelevantHit');
      expect(benchmarkDoc).toMatch(/raw Claude Code[\s\S]*averageFirstRelevantHit[\s\S]*null/i);
      expect(comparisonDoc).toMatch(/raw Claude Code[\s\S]*pending_evidence/i);
      expect(registryChecklist).toContain('averageFirstRelevantHit: null');
    }
  });

  it('reflects comparator gate failures and setup failures from the checked-in evidence', () => {
    const codebaseMemoryGate = gateArtifact.gate.comparators.find(
      (comparator) => comparator.comparatorName === 'codebase-memory-mcp'
    );

    if (codebaseMemoryGate?.status === 'failed') {
      expect(benchmarkDoc).toMatch(/codebase-memory-mcp[\s\S]*gate: `failed`/i);
      expect(comparisonDoc).toMatch(/codebase-memory-mcp[\s\S]*gate: `failed`/i);
      expect(registryChecklist).toContain('comparator artifact `ok` but gate `failed`');
    }

    const setupFailedComparators = Object.entries(comparatorEvidence)
      .filter(([, artifact]) => artifact.status === 'setup_failed')
      .map(([name]) => name);

    for (const comparatorName of setupFailedComparators) {
      expect(benchmarkDoc).toContain(`\`${comparatorName}\``);
      expect(comparisonDoc).toContain(`\`${comparatorName}\``);
    }
  });

  it('keeps package-facing proof mentions secondary and separates the evidence tracks', () => {
    expectContains(readme, [
      'benchmark evidence page',
      'keeps two tracks separate',
      'older checked-in discovery gate',
      'local ContextBench case study',
      gateArtifact.gate.status,
      'claimAllowed'
    ]);
    expectContains(capabilities, [
      'discovery-only',
      gateArtifact.gate.status,
      `claimAllowed: ${String(gateArtifact.gate.claimAllowed)}`,
      'evidence records, not a winner scoreboard',
      'must not be mixed into that discovery gate'
    ]);
    expectContains(comparisonDoc, [
      'older discovery gate',
      'not a marketing scoreboard',
      'not a quality loss'
    ]);
    expectContains(demo, [gateArtifact.gate.status, 'claimAllowed']);
    expectContains(demo, [
      'separate local ContextBench case study',
      '20-task, 500-check practical case study',
      'not a benchmark win'
    ]);
  });

  it('keeps the local ContextBench case study framed as narrow retrieval-overlap evidence', () => {
    expect(contextBenchSummary.source.rawArtifactsTracked).toBe(false);
    expect(contextBenchSummary.source.provenance).toContain(
      'local retrieval scoring artifacts'
    );
    expect(contextBenchSummary.source.provenance).toContain(
      'local token-metered replay'
    );
    expect(contextBenchSummary.publicationReadiness.status).toBe(
      'engineering_note_ready_with_claim_blocks'
    );
    expect(contextBenchSummary.publicationReadiness.claimBearingPublicationAllowed).toBe(false);
    expect(contextBenchSummary.publicationReadiness.claimScope).toBe(
      '500_check_practical_code_context_case_study'
    );
    expect(contextBenchSummary.publicationReadiness.publicUseLevel).toBe(
      'narrow_code_context_case_study'
    );
    expect(contextBenchSummary.retrievalChecks.totalChecks).toBe(500);
    expect(contextBenchSummary.retrievalChecks.retrievalChecks).toBe(400);
    expect(contextBenchSummary.retrievalChecks.tokenMeteredChecks).toBe(100);
    expect(contextBenchSummary.retrievalChecks.checksScored).toBe(387);
    expect(contextBenchSummary.retrievalChecks.checksWithNoUsableContext).toBe(13);
    expect(contextBenchSummary.retrievalChecks.tasks).toBe(20);
    expect(contextBenchSummary.retrievalChecks.tools).toBe(5);
    expect(contextBenchSummary.retrievalChecks.observedChecksPerTaskTool).toBe(5);
    expect(contextBenchSummary.retrievalChecks.observedRetrievalChecksPerTaskTool).toBe(4);
    expect(contextBenchSummary.retrievalChecks.observedTokenChecksPerTaskTool).toBe(1);
    expect(contextBenchSummary.retrievalChecks.sameDenominatorChecksPresent).toBe(true);
    expect(contextBenchSummary.publicationReadiness.blockedClaimTypes).toContain(
      'benchmark winner'
    );
    expect(contextBenchSummary.publicationReadiness.blockedClaimTypes).toContain(
      'research-paper benchmark'
    );

    const codebaseContext = contextBenchSummary.qualitySnapshot.find(
      (tool) => tool.toolId === 'codebase-context'
    );
    const jCodeMunch = contextBenchSummary.qualitySnapshot.find(
      (tool) => tool.toolId === 'jcodemunch-full-mcp'
    );
    const repowise = contextBenchSummary.qualitySnapshot.find(
      (tool) => tool.toolId === 'repowise-selfhosted-mcp'
    );
    const codebaseContextCost = contextBenchSummary.costSnapshot.find(
      (tool) => tool.toolId === 'codebase-context'
    );

    expect(codebaseContext?.checks).toBe(80);
    expect(codebaseContext?.checksScored).toBe(80);
    expect(codebaseContext?.fileCoverageMean).toBeCloseTo(0.2656, 4);
    expect(jCodeMunch?.fileCoverageMean).toBeCloseTo(0.2714, 4);
    expect(repowise?.status).toBe('completed:67,failed_or_no_context:13');
    expect(codebaseContextCost?.indexMedianSeconds).toBeCloseTo(736.2, 1);
    expect(codebaseContextCost?.modelEvidence).toContain('Xenova/bge-small-en-v1.5');
    expect(contextBenchSummary.metaCost.tokenAccounting.totalTokensApprox).toBe(3330000000);
    expect(contextBenchSummary.metaCost.tokenAccounting.inputTokensApprox).toBe(3318000000);
    expect(contextBenchSummary.metaCost.tokenAccounting.cachedInputTokensApprox).toBe(3179000000);
    expect(contextBenchSummary.metaCost.tokenAccounting.outputTokensApprox).toBe(11300000);
    expect(contextBenchSummary.metaCost.tokenAccounting.reasoningOutputTokensApprox).toBe(3270000);
    expect(contextBenchSummary.metaCost.tokenAccounting.missingPerToolRuntimeTokens).toBe(false);
    expect(contextBenchSummary.perToolRuntimeTokenAccounting.status).toBe(
      'captured_in_100_check_metered_context_consumption_replay'
    );
    expect(contextBenchSummary.perToolRuntimeTokenAccounting.meteredChecks).toBe(100);
    expect(contextBenchSummary.perToolRuntimeTokenAccounting.meteredChecksCompleted).toBe(100);
    expect(contextBenchSummary.perToolRuntimeTokenAccounting.checksMissingTokenCounters).toBe(0);
    expect(contextBenchSummary.perToolRuntimeTokenAccounting.finalRetrievalRawTracesScanned).toBe(
      400
    );
    expect(contextBenchSummary.perToolRuntimeTokenAccounting.rawTracesWithUsageCounters).toBe(0);
    expect(contextBenchSummary.perToolRuntimeTokenAccounting.allFinalTracesRetrievalOnly).toBe(
      true
    );
    expect(contextBenchSummary.perToolRuntimeTokenAccounting.metaCostIsNotSubstitute).toBe(true);
    const codebaseContextTokens =
      contextBenchSummary.perToolRuntimeTokenAccounting.tokenMeteredToolResults.find(
        (result) => result.toolId === 'codebase-context'
      );
    const jCodeMunchTokens =
      contextBenchSummary.perToolRuntimeTokenAccounting.tokenMeteredToolResults.find(
        (result) => result.toolId === 'jcodemunch-full-mcp'
      );
    expect(codebaseContextTokens).toMatchObject({
      meteredChecks: 20,
      tokenCountersCaptured: 20,
      medianInputTokens: 19345,
      medianCachedInputTokens: 16256,
      medianOutputTokens: 2494,
      medianReasoningOutputTokens: 2348,
      providerDollarCost: 'not_calculated'
    });
    expect(jCodeMunchTokens).toMatchObject({
      meteredChecks: 20,
      tokenCountersCaptured: 20,
      medianInputTokens: 18162,
      medianOutputTokens: 692,
      medianReasoningOutputTokens: 516,
      providerDollarCost: 'not_calculated'
    });

    expectContains(benchmarkDoc, [
      'does not name a benchmark winner',
      '500 checks total',
      '400 retrieval/resource checks plus 100 checks with token counters',
      '387 checks',
      'checks with no usable context',
      'failure-inclusive metric view',
      '`jcodemunch-full-mcp`',
      '27.1%',
      '`codebase-context`',
      '26.6%',
      '736.2 s',
      'Token accounting',
      '100 metered checks',
      '20 tasks x 5 tools',
      'Median input tokens',
      '19,345',
      '2,494',
      'Model-provider bill',
      '~3.33B',
      '~3.318B',
      '~3.179B',
      '~11.3M',
      '~3.27M',
      'winner, best-tool, leaderboard, or research-paper benchmark claims',
      'token-savings claims',
      'results/contextbench-engineering-note-summary.json',
      'failed-check counts',
      'without publishing ignored local run paths'
    ]);
    expectContains(readme, [
      'separate local ContextBench case study',
      'It does not name a benchmark winner',
      'raw-native, codebase-context, jCodeMunch full MCP, Repowise',
      'context-mode',
      '500 checks total',
      '400 retrieval/resource checks plus 100 checks with token counters',
      'Repowise kept 13 checks with no usable context',
      '100/100',
      'reading returned context',
      '~3.33B Codex orchestration cost',
      'not a per-tool runtime score',
      'jCodeMunch and codebase-context are close',
      'winner, leaderboard, research-paper benchmark'
    ]);
    expectContains(changelogUnreleased, [
      '20-task, 500-check practical case study',
      '400 retrieval/resource checks plus 100 token-metered context-consumption checks',
      '387 retrieval checks scored',
      '13 retained Repowise checks with no usable context',
      'no claim that it names a winner',
      'patch-quality, token-savings, model-provider bill, research-paper benchmark, and winner claims blocked',
      'live npm metadata',
      'live GitHub metadata',
      'per-client MCP setup guards'
    ]);
    expect(readme).not.toContain('Track A');
    expect(readme).not.toContain('case study is in progress');
    expectContains(capabilities, [
      'summarized as a practical case study',
      '500 checks across 20 frozen open-source tasks',
      '400 retrieval/resource checks plus 100 checks with token counters',
      '387 checks scored',
      '13 retained Repowise checks with no usable context',
      '100/100',
      'reading each tool',
      '3.33B total tokens',
      '3.318B input',
      '3.179B cached input',
      '11.3M output',
      '3.27M reasoning output',
      'setup/index time',
      'process memory telemetry',
      'median input, cached input, output, and reasoning output tokens',
      'does not measure patch correctness'
    ]);
    expectContains(benchmarkDoc, [
      'Separate ContextBench Case Study',
      'What this supports',
      'What remains blocked',
      'Do not mix the two benchmark tracks',
      'resource-efficiency claims',
      'combines local evidence sets',
      'claims that setup failures or checks with no usable context are competitor quality losses'
    ]);
    expect(readme).not.toContain('publicationReadiness.status=not_publication_ready');
    expect(capabilities).not.toContain('publicationReadiness.status=not_publication_ready');
    expect(capabilities).not.toContain(
      'being prepared for a readiness/setup/cost engineering note'
    );
    expect(benchmarkDoc).not.toContain('case study in preparation');
    expect(benchmarkDoc).not.toContain('being prepared for publication');
    expect(benchmarkDoc).not.toContain('4 judged quality rows');
    expect(benchmarkDoc).not.toContain('gold files');
    expect(benchmarkDoc).not.toContain('scoreable');
    expect(benchmarkDoc).not.toContain('CHECKPOINT-GATE');
    expect(benchmarkDoc).not.toContain('publicationReadiness.status=');
    expect(benchmarkDoc).not.toContain('benchmark-runs/contextbench/phase41');
    expect(benchmarkDoc).not.toContain(
      'outputs/contextbench-vnext-report-rollup-plus-jcodemunch-repowise-fair-20260530T2309.json'
    );
    expect(benchmarkDoc).not.toContain(
      '55ef3a4306c554a8656a23ee55c8a96439accb59d953788b526920d52f6353fd'
    );
    expect(todoDoc ?? '').not.toContain('Track A');
    expect(todoDoc ?? '').not.toContain('Track B');
    expect(registryChecklist).toContain('case study does not name a winner');
    expectContains(registryChecklist, [
      '20-task, 500-check',
      '400 retrieval/resource checks plus 100 checks with token counters',
      '387 checks scored',
      '13 retained Repowise checks with no usable context',
      '100 token-metered',
      'reading returned context',
      '3.33B total tokens',
      '3.318B input',
      '3.179B cached input',
      '11.3M output',
      '3.27M reasoning output'
    ]);
    expect(registryChecklist).toContain(
      'Do not let the Codex orchestration/meta-token total imply per-tool token savings'
    );
    expect(registryChecklist).toContain('setup/readiness failures as competitor quality losses');
    expect(registryChecklist).toContain('current material is only a narrow practical case study');
    expect(registryChecklist).toContain('repeat/stability study is required');
    expect(publicSurfaceText).not.toMatch(/[A-Z]:[\\/]/);
    expect(publicSurfaceText).not.toContain('C:\\\\Users\\\\');
    expect(publicSurfaceText).not.toContain('C:\\Users\\');
    expect(publicSurfaceText).not.toContain('100 retrieval-overlap rows');
    expect(publicSurfaceText).not.toContain('20 tasks x 1 repeat x 5 lanes = 100 retrieval rows');
    expect(publicSurfaceText).not.toContain('99 official-evaluator completed rows');
    expect(publicSurfaceText).not.toContain('25.7%');
    expect(publicSurfaceText).not.toContain('750.8 s');
    const bannedPublicBenchmarkPhrases = [
      'deterministic lexical baseline',
      'gold context',
      'ContextBench Phase',
      'sealed 100',
      'sealed 500',
      'with the cost included',
      'golden files',
      'golden file',
      'produce more familiar output',
      'separate tool lane',
      'each lane',
      'lane score',
      'laneId',
      'appendixOnlyLanes',
      'missingTokenRows',
      'tokenRows',
      'not_captured_in_final_400',
      'per-task median tool token cost was not captured',
      'blocked: not captured',
      'Why the page shows 400'
    ];
    for (const phrase of bannedPublicBenchmarkPhrases) {
      expect(publicSurfaceText).not.toContain(phrase);
    }
    for (const failedCheck of contextBenchSummary.failedChecks) {
      expect(failedCheck.publicTreatment).toContain('Retained in the denominator');
      expect(failedCheck.publicTreatment).not.toContain('benchmark-runs/');
    }
    expect(contextBenchSummaryText).not.toContain('benchmark-runs/');
    expect(contextBenchSummaryText).not.toContain('CHECKPOINT-GATE');
    expect(contextBenchSummaryText).not.toContain('sha256:');
  });

  it('keeps shared planning summaries aligned to the same proof posture', () => {
    if (!spec || !roadmap || !milestones) {
      return;
    }

    expectContains(spec, ['[PROOF-02]', 'discovery benchmark', 'claimAllowed: false']);
    expectContains(roadmap, [
      'Phase 28: Keep Discovery Proof Honest and Align Truth Surfaces',
      'claimAllowed: false'
    ]);
    expectContains(milestones, ['What Phase 28 aligned:', 'claimAllowed: false']);
  });
});
