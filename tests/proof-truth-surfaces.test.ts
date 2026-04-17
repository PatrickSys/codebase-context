import { readFileSync } from 'node:fs';
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

function readJson<T>(relPath: string): T {
  return JSON.parse(readText(relPath)) as T;
}

function expectContains(text: string, snippets: string[]): void {
  for (const snippet of snippets) {
    expect(text).toContain(snippet);
  }
}

describe('proof truth surfaces', () => {
  const gateArtifact = readJson<GateArtifact>('results/gate-evaluation.json');
  const comparatorEvidence = readJson<ComparatorEvidence>('results/comparator-evidence.json');
  const benchmarkDoc = readText('docs/benchmark.md');
  const comparisonDoc = readText('docs/comparison-table.md');
  const registryChecklist = readText('docs/registry-sync-checklist.md');
  const readme = readText('README.md');
  const capabilities = readText('docs/capabilities.md');
  const demo = readText('docs/demo.md');

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
      gateArtifact.gate.status
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
      `claimAllowed: ${String(gateArtifact.gate.claimAllowed)}`
    ]);
    expectContains(demo, [gateArtifact.gate.status, 'claimAllowed']);
  });
});
