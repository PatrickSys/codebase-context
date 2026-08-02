import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
    scorerScriptSha256: string;
    localRunRootTracked: boolean;
    localSummarySha256: string;
  };
  publicationReadiness: {
    status: string;
    claimBearingPublicationAllowed: boolean;
    blockedClaimTypes: string[];
    claimScope: string;
    publicUseLevel: string;
  };
  rows: {
    evaluatorFailedRows: number;
    evaluatorCompletedRows: number;
    retrievalOverlapRows: number;
    repeatsPerTaskLane: number;
    lanes: number;
    tasks: number;
    sameDenominatorRowsPresent: boolean;
  };
  qualitySnapshot: Array<{
    laneId: string;
    rows: number;
    evaluatorCompletedRows: number;
    status: string;
    fileCoverageMean: number;
    symbolCoverageMean: number;
    spanCoverageMean: number;
    lineCoverageMean: number;
  }>;
  costSnapshot: Array<{
    laneId: string;
    indexMedianSeconds: number;
    indexSumMinutes: number;
    rowWallSumMinutes: number;
    peakPrivateGb: number;
    modelEvidence: string;
  }>;
  failedRows: Array<{
    officialResults: string;
    trajectory: string;
  }>;
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

function sha256File(relPath: string): string {
  return `sha256:${createHash('sha256').update(readText(relPath), 'utf8').digest('hex')}`;
}

const gateArtifact = readJson<GateArtifact>('results/gate-evaluation.json');
const comparatorEvidence = readJson<ComparatorEvidence>('results/comparator-evidence.json');
const contextBenchSummaryText = readText('results/contextbench-engineering-note-summary.json');
const contextBenchSummary = JSON.parse(contextBenchSummaryText) as ContextBenchSummary;
const benchmarkDoc = readText('docs/benchmark.md');
const comparisonDoc = readText('docs/comparison-table.md');
const registryChecklist = readText('docs/registry-sync-checklist.md');
const readme = readText('README.md');
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
      'discovery benchmark',
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

  it('keeps package-facing proof mentions secondary and discovery-only', () => {
    expectContains(readme, ['discovery-only proof', gateArtifact.gate.status, 'claimAllowed']);
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
      '20-task retrieval-overlap engineering note',
      'not a benchmark win'
    ]);
  });

  it('keeps the local ContextBench case study framed as narrow retrieval-overlap evidence', () => {
    expect(contextBenchSummary.source.localRunRootTracked).toBe(false);
    expect(contextBenchSummary.source.scorerScriptSha256).toBe(
      sha256File('scripts/contextbench-score-retrieval-gate-artifacts.mjs')
    );
    expect(contextBenchSummary.publicationReadiness.status).toBe(
      'engineering_note_ready_with_claim_blocks'
    );
    expect(contextBenchSummary.publicationReadiness.claimBearingPublicationAllowed).toBe(false);
    expect(contextBenchSummary.publicationReadiness.claimScope).toBe('20x1_retrieval_overlap_only');
    expect(contextBenchSummary.publicationReadiness.publicUseLevel).toBe(
      'narrow_retrieval_overlap_case_study'
    );
    expect(contextBenchSummary.rows.retrievalOverlapRows).toBe(100);
    expect(contextBenchSummary.rows.evaluatorCompletedRows).toBe(99);
    expect(contextBenchSummary.rows.evaluatorFailedRows).toBe(1);
    expect(contextBenchSummary.rows.tasks).toBe(20);
    expect(contextBenchSummary.rows.lanes).toBe(5);
    expect(contextBenchSummary.rows.repeatsPerTaskLane).toBe(1);
    expect(contextBenchSummary.rows.sameDenominatorRowsPresent).toBe(true);
    expect(contextBenchSummary.publicationReadiness.blockedClaimTypes).toContain(
      'benchmark winner'
    );
    expect(contextBenchSummary.publicationReadiness.blockedClaimTypes).toContain(
      'paper-grade benchmark'
    );

    const codebaseContext = contextBenchSummary.qualitySnapshot.find(
      (lane) => lane.laneId === 'codebase-context'
    );
    const jCodeMunch = contextBenchSummary.qualitySnapshot.find(
      (lane) => lane.laneId === 'jcodemunch-full-mcp'
    );
    const repowise = contextBenchSummary.qualitySnapshot.find(
      (lane) => lane.laneId === 'repowise-selfhosted-mcp'
    );
    const codebaseContextCost = contextBenchSummary.costSnapshot.find(
      (lane) => lane.laneId === 'codebase-context'
    );

    expect(codebaseContext?.rows).toBe(20);
    expect(codebaseContext?.evaluatorCompletedRows).toBe(20);
    expect(codebaseContext?.fileCoverageMean).toBeCloseTo(0.2572, 4);
    expect(jCodeMunch?.fileCoverageMean).toBeCloseTo(0.2714, 4);
    expect(repowise?.status).toBe('completed:19,judge_failed:1');
    expect(codebaseContextCost?.indexMedianSeconds).toBeCloseTo(750.8, 1);
    expect(codebaseContextCost?.modelEvidence).toContain('Xenova/bge-small-en-v1.5');

    expectContains(benchmarkDoc, [
      'not a benchmark-win claim',
      '20 tasks x 1 repeat x 5 lanes = 100 retrieval rows',
      '99 rows',
      '`no_context_extracted`',
      'failure-inclusive metric view',
      '`jcodemunch-full-mcp`',
      '27.1%',
      '`codebase-context`',
      '25.7%',
      '750.8 s',
      'winner, best-tool, leaderboard, or paper-grade claims',
      'results/contextbench-engineering-note-summary.json',
      'The summary records the source hashes'
    ]);
    expect(benchmarkDoc).not.toContain('scoreable');
    expect(benchmarkDoc).not.toContain('unscoreable');
    expectContains(readme, [
      'documented in the benchmark page',
      'It is not a benchmark-win claim',
      'raw-native, codebase-context, jCodeMunch full MCP, Repowise',
      'context-mode',
      '100 retrieval-overlap rows',
      '99 official-evaluator completed rows',
      'Repowise `no_context_extracted` row',
      'jCodeMunch and codebase-context are close',
      'Winner, leaderboard, paper-grade'
    ]);
    expect(readme).not.toContain('Track A');
    expect(readme).not.toContain('case study is in progress');
    expectContains(capabilities, [
      'summarized as an engineering note',
      '100 rows across 20 frozen open-source tasks',
      '99 official-evaluator completed rows',
      'setup/index time',
      'process memory telemetry',
      'does not measure patch correctness'
    ]);
    expectContains(benchmarkDoc, [
      'Separate ContextBench Case Study',
      'What this supports',
      'What remains blocked',
      'Do not mix the benchmark tracks',
      'ContextBench implementation pilot above is a one-task official-evaluator pilot',
      'resource-efficiency claims',
      'one repeat per lane/task',
      'claims that setup failures or no-context rows are competitor quality losses'
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
    const caseStudyStart = benchmarkDoc.indexOf('## Separate ContextBench Case Study');
    const discoveryStart = benchmarkDoc.indexOf('## Discovery Benchmark');
    expect(caseStudyStart).toBeGreaterThanOrEqual(0);
    expect(discoveryStart).toBeGreaterThan(caseStudyStart);
    const contextBenchCaseStudy = benchmarkDoc.slice(caseStudyStart, discoveryStart);
    expect(benchmarkDoc).not.toContain('CHECKPOINT-GATE');
    expect(publicSurfaceText).not.toContain('CHECKPOINT-GATE');
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
    expect(registryChecklist).toContain('public winner-claim gate is closed');
    expectContains(registryChecklist, [
      '20-task, 100-row retrieval-overlap engineering note',
      '99 evaluator-completed rows',
      'Repowise `no_context_extracted` row'
    ]);
    expect(registryChecklist).toContain('setup/readiness failures as competitor quality losses');
    expect(registryChecklist).toContain('current material is only a narrow engineering note');
    expect(registryChecklist).toContain('repeat/stability study is required');
    expect(publicSurfaceText).not.toMatch(/[A-Z]:[\\/]/);
    expect(publicSurfaceText).not.toContain('C:\\\\Users\\\\');
    expect(publicSurfaceText).not.toContain('C:\\Users\\');
    for (const failedRow of contextBenchSummary.failedRows) {
      expect(failedRow.officialResults).toMatch(/^benchmark-runs\//);
      expect(failedRow.trajectory).toMatch(/^benchmark-runs\//);
    }
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
