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

const benchmarkDoc = readText('docs/benchmark.md');
const discoveryDoc = readText('docs/benchmark-prior-public-report.md');
const comparisonDoc = readText('docs/comparison-table.md');
const registryChecklist = readText('docs/registry-sync-checklist.md');
const readme = readText('README.md');
const capabilities = readText('docs/capabilities.md');
const demo = readText('docs/demo.md');
const spec = readOptionalText('.planning/SPEC.md');
const roadmap = readOptionalText('.planning/ROADMAP.md');
const milestones = readOptionalText('.planning/MILESTONES.md');

function expectContains(text: string, snippets: string[]): void {
  for (const snippet of snippets) {
    expect(text).toContain(snippet);
  }
}

describe('proof truth surfaces', () => {
  it('reads the current blocked discovery artifacts', () => {
    expect(gateArtifact.gate.status).toBeTruthy();
    expect(typeof gateArtifact.gate.claimAllowed).toBe('boolean');
    expect(comparatorEvidence['raw Claude Code']).toBeDefined();
    expect(comparatorEvidence['codebase-memory-mcp']).toBeDefined();
  });

  it('keeps archived discovery proof aligned to its retained gate artifact', () => {
    expectContains(discoveryDoc, [
      'discovery benchmark',
      `\`${gateArtifact.gate.status}\``,
      '`claimAllowed`'
    ]);
    expect(discoveryDoc).toContain(
      `\`claimAllowed\` remains \`${String(gateArtifact.gate.claimAllowed)}\``
    );
    for (const currentDoc of [benchmarkDoc, comparisonDoc]) {
      expect(currentDoc).toContain('./benchmark-prior-public-report.md');
      expect(currentDoc).toContain('separate 24-task discovery report');
    }
    expectContains(registryChecklist, [
      `claimAllowed: ${String(gateArtifact.gate.claimAllowed)}`,
      gateArtifact.gate.status
    ]);
  });

  it('documents the raw-Claude missing-metric caveat when the artifact still lacks ranked-hit evidence', () => {
    const rawClaude = comparatorEvidence['raw Claude Code'];
    const rawClaudeGate = gateArtifact.gate.baseline;

    if (rawClaude.averageFirstRelevantHit === null) {
      expect(rawClaudeGate.status).toBe('pending_evidence');
      expect(rawClaudeGate.missingMetrics ?? []).toContain('averageFirstRelevantHit');
      expect(discoveryDoc).toMatch(/raw Claude Code[\s\S]*averageFirstRelevantHit[\s\S]*null/i);
      expect(discoveryDoc).toMatch(/raw Claude Code[\s\S]*pending_evidence/i);
      expect(registryChecklist).toContain('averageFirstRelevantHit: null');
    }
  });

  it('reflects comparator gate failures and setup failures from the checked-in evidence', () => {
    const codebaseMemoryGate = gateArtifact.gate.comparators.find(
      (comparator) => comparator.comparatorName === 'codebase-memory-mcp'
    );

    if (codebaseMemoryGate?.status === 'failed') {
      expect(discoveryDoc).toMatch(/codebase-memory-mcp[\s\S]*gate: `failed`/i);
      expect(registryChecklist).toContain('comparator artifact `ok` but gate `failed`');
    }

    const setupFailedComparators = Object.entries(comparatorEvidence)
      .filter(([, artifact]) => artifact.status === 'setup_failed')
      .map(([name]) => name);

    for (const comparatorName of setupFailedComparators) {
      expect(discoveryDoc).toContain(`\`${comparatorName}\``);
    }
  });

  it('keeps package-facing evidence scoped to retrieval and historical CLI observations', () => {
    expectContains(readme, [
      '/docs/benchmark.md',
      '/docs/benchmark-prior-public-report.md',
      'retrieval observations, not a winner or a coding-quality claim',
      'does not establish patch correctness or end-to-end coding quality'
    ]);
    expectContains(capabilities, [
      'docs/benchmark.md',
      'does not measure patch correctness or end-to-end task completion',
      'missing or failed setup and comparator runs remain visible'
    ]);
    expectContains(demo, [
      'does not verify the current package or an MCP connection',
      'machine-specific repository root is omitted',
      'not a universal performance or coding result'
    ]);
    expectContains(benchmarkDoc, [
      'does not measure patch correctness',
      'does not combine the four evidence families into a pooled score'
    ]);
    expectContains(comparisonDoc, [
      'do not establish patch correctness',
      'failed attempt is counted as zero'
    ]);
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
