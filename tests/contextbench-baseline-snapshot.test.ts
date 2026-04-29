import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type BaselineSession = {
  claimBearing: boolean;
  sealed: boolean;
  sessionHash: string;
  snapshot: {
    branch: string;
    head: string;
    divergence: { status: string };
    gitStatusPath: string;
    trackedDiffPath: string;
    stagedDiffPath: string;
    diffStatPath: string;
    untracked: Array<{ path: string; disposition: string; hash: string | null; exclusionReason: string | null }>;
    lockfiles: Array<{ path: string; hash: string }>;
    redactedEnvVarNames: string[];
    versions: Record<string, string>;
    fixtureHashes: Record<string, string>;
    commandTranscript: Array<{ command: string; stdoutPath: string | null; stderrPath: string | null }>;
    snapshotHash: string;
  };
  artifactIndex: Array<{ path: string; hash: string }>;
};

vi.setConfig({ testTimeout: 30000 });

for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key];
}

function tempSessionRoot(phase: 'phase40' | 'phase41' = 'phase40'): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), `contextbench-${phase}-`)),
    'benchmark-runs',
    'contextbench',
    phase,
    'snapshot-smoke'
  );
}

describe('ContextBench Phase 40 dirty-worktree snapshot', () => {
  it('captures the current checkout before baseline runs with hashes and validation metadata', () => {
    const sessionRoot = tempSessionRoot();
    try {
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot],
        { encoding: 'utf8' }
      );
      const validateOutput = execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-validate', '--session', sessionRoot],
        { encoding: 'utf8' }
      );
      expect(validateOutput).toContain('baseline session validation passed');

      const session = JSON.parse(
        readFileSync(path.join(sessionRoot, 'BASELINE-SESSION.json'), 'utf8')
      ) as BaselineSession & { phase: number };
      expect(session.phase).toBe(40);
      expect(session.claimBearing).toBe(false);
      expect(session.sealed).toBe(false);
      expect(session.sessionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(session.snapshot.branch.length).toBeGreaterThan(0);
      expect(session.snapshot.head).toMatch(/^[a-f0-9]{40}$/);
      expect(session.snapshot.divergence.status).toBe('unavailable');
      expect(session.snapshot.snapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(session.snapshot.gitStatusPath).toBe('snapshot/git/status-porcelain-v2.txt');
      expect(session.snapshot.trackedDiffPath).toBe('snapshot/git/tracked.diff');
      expect(session.snapshot.stagedDiffPath).toBe('snapshot/git/staged.diff');
      expect(session.snapshot.diffStatPath).toBe('snapshot/git/diff-stat.txt');
      expect(session.snapshot.lockfiles.map((entry) => entry.path)).toContain(
        path.relative(sessionRoot, path.resolve('pnpm-lock.yaml')).replace(/\\/g, '/')
      );
      expect(session.snapshot.fixtureHashes.protocol).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(session.snapshot.commandTranscript.map((entry) => entry.command)).toEqual(
        expect.arrayContaining(['git status --porcelain=v2 --branch --untracked-files=all', 'git diff --no-ext-diff'])
      );
      expect(session.artifactIndex.map((entry) => entry.path)).toEqual(
        expect.arrayContaining(['slot-reservations.json', 'run-manifest.jsonl'])
      );
      expect(JSON.stringify(session)).not.toContain(process.env.OPENAI_API_KEY ?? 'definitely-not-present');
    } finally {
      rmSync(path.dirname(path.dirname(path.dirname(path.dirname(sessionRoot)))), {
        recursive: true,
        force: true
      });
    }
  });

  it('captures Phase 41 baseline snapshots with Phase 41 metadata', () => {
    const sessionRoot = tempSessionRoot('phase41');
    try {
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot],
        { encoding: 'utf8' }
      );
      const validateOutput = execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-validate', '--session', sessionRoot],
        { encoding: 'utf8' }
      );
      expect(validateOutput).toContain('baseline session validation passed');

      const session = JSON.parse(
        readFileSync(path.join(sessionRoot, 'BASELINE-SESSION.json'), 'utf8')
      ) as BaselineSession & { phase: number };
      expect(session.phase).toBe(41);
      expect(session.sessionRoot).toContain('/phase41/');
    } finally {
      rmSync(path.dirname(path.dirname(path.dirname(path.dirname(sessionRoot)))), {
        recursive: true,
        force: true
      });
    }
  });

  it('refuses raw baseline artifacts outside the ignored benchmark-runs root', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'contextbench-invalid-out-'));
    try {
      expect(() =>
        execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', outDir], {
          encoding: 'utf8',
          stdio: 'pipe'
        })
      ).toThrow(/benchmark-runs\/contextbench\/phase40/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
