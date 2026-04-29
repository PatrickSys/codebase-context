import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import correctionsFixture from './fixtures/contextbench-corrections.json';
import lanesFixture from './fixtures/contextbench-lanes.json';
import manifestFixture from './fixtures/contextbench-task-manifest.json';
import protocolFixture from './fixtures/contextbench-benchmark-protocol.json';
import selectionExclusionsFixture from './fixtures/contextbench-selection-exclusions.json';
import smokePackFixture from './fixtures/contextbench-smoke-pack.json';

type ContextBenchTask = {
  instance_id: string;
  original_inst_id: string;
  source: string;
  language: string;
  repo: string;
  repo_url: string;
  base_commit: string;
  problem_statement_ref: string;
  problem_statement_hash: string;
  gold_context_ref: string;
  gold_context_hash: string;
  patch_hash: string;
  test_patch_hash: string;
  f2p_hash: string;
  p2p_hash: string;
  gold_context_span_count: number;
  hash_canonicalization_version: string;
  hardness_signal_status: string;
  hardness_signal_source: string;
  hardness_proxy_used: boolean;
  inclusion_rationale: string;
  deterministic_rank: string;
};

type ContextBenchManifest = {
  name: string;
  protocolVersion: string;
  dataset: string;
  datasetConfig: string;
  split: string;
  claimBearing: boolean;
  selectedInPhase: number;
  selection_algorithm: string;
  selection_seed_or_deterministic_order: string;
  selection_timestamp: string;
  task_pool_hash: string;
  exclusion_log_path: string;
  hash_canonicalization_version: string;
  evaluator_success_status: string;
  hardness_signal_status: string;
  hardness_signal_source: string;
  hardness_proxy_used: boolean;
  forbidden_selection_sources: string[];
  no_lane_outputs_observed_attestation: string;
  summary: {
    task_count: number;
    language_distribution: Record<string, number>;
    source_distribution: Record<string, number>;
    repo_distribution: Record<string, number>;
    repo_count: number;
    language_count: number;
  };
  tasks: ContextBenchTask[];
  manifest_hash: string;
};

type SelectionExclusions = {
  protocolVersion: string;
  dataset: string;
  datasetConfig: string;
  selection_algorithm: string;
  selection_seed_or_deterministic_order: string;
  selection_timestamp: string;
  task_pool_hash: string;
  hash_canonicalization_version: string;
  hardness_signal_status: string;
  hardness_proxy_used: boolean;
  no_lane_outputs_observed_attestation: string;
  input_row_count: number;
  eligible_row_count: number;
  selected_row_count: number;
  excluded_rows: Array<Record<string, string | string[] | number>>;
  non_selected_eligible_rows: Array<{
    instance_id: string;
    reason: string;
    deterministic_rank: string;
  }>;
};

type ProtocolFixture = {
  claimAllowed: boolean;
  phaseBoundary: { phase36MustNotFreeze: string[]; phase37Freezes: string[] };
  taskSlicePolicy: {
    coverageConstraints: {
      minRepos: number;
      minLanguages: number;
      selectionBeforeOutputs: boolean;
    };
    hardnessSignalPolicy: {
      required: boolean;
      status: string;
      proxyAllowed: boolean;
      selectionMustRecordAbsence: boolean;
    };
    forbiddenSources: string[];
  };
  smokeOnlyCorpora: Array<{ name: string; claimBearing: boolean; purpose: string }>;
  blockedClaims: string[];
};

type CorrectionsFixture = {
  corrections: Array<{ correction_id: string; reason_category: string; affected_fields: string[] }>;
  policy: { allowedReasonCategories: string[]; forbiddenReasons: string[] };
};

type LanesFixture = {
  laneContaminationRules: {
    oneContextToolPerLane: boolean;
    mixedLaneContextInvalidatesRun: boolean;
  };
  lanes: Array<{
    laneId: string;
    contextTool: string;
    allowedTools: string[];
    disallowedTools: string[];
  }>;
};

type SmokePack = {
  claimBearing: boolean;
  purpose: string;
  executionStatus: string;
  mustNotContributeTo: string[];
  corpora: Array<{
    name: string;
    claimBearing: boolean;
    purpose: string;
    phase37RunnableTasks: boolean;
  }>;
};

const manifest = manifestFixture as ContextBenchManifest;
const exclusions = selectionExclusionsFixture as SelectionExclusions;
const protocol = protocolFixture as ProtocolFixture;
const corrections = correctionsFixture as CorrectionsFixture;
const lanes = lanesFixture as LanesFixture;
const smokePack = smokePackFixture as SmokePack;

const shaPattern = /^sha256:[a-f0-9]{64}$/;
const canonicalizationVersion = 'contextbench-canonical-json-lf-v1';
const hardnessStatus = 'unavailable_in_contextbench_verified_schema';
const childGitEnv = (() => {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  return env;
})();

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function hashObject(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')}`;
}

function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

describe('ContextBench Phase 37 task manifest', () => {
  it('freezes exactly 20 claim-bearing ContextBench tasks with required metadata', () => {
    expect(manifest.dataset).toBe('Contextbench/ContextBench');
    expect(manifest.datasetConfig).toBe('contextbench_verified');
    expect(manifest.claimBearing).toBe(true);
    expect(manifest.selectedInPhase).toBe(37);
    expect(manifest.tasks).toHaveLength(20);
    expect(new Set(manifest.tasks.map((task) => task.instance_id)).size).toBe(20);
    expect(manifest.selection_algorithm).toBe('deterministic_seeded_coverage_then_rank_fill_v1');
    expect(manifest.selection_seed_or_deterministic_order).toBe(
      'phase37-contextbench-v1-2026-04-27'
    );
    expect(manifest.selection_timestamp).toBeTruthy();
    expect(manifest.task_pool_hash).toMatch(shaPattern);
    expect(manifest.exclusion_log_path).toBe(
      'tests/fixtures/contextbench-selection-exclusions.json'
    );
    expect(manifest.evaluator_success_status).toBe('passed_synthetic_official_evaluator_probe');
  });

  it('meets repo, language, and source coverage without proxy hardness', () => {
    expect(manifest.summary.repo_count).toBeGreaterThanOrEqual(
      protocol.taskSlicePolicy.coverageConstraints.minRepos
    );
    expect(manifest.summary.language_count).toBeGreaterThanOrEqual(
      protocol.taskSlicePolicy.coverageConstraints.minLanguages
    );
    expect(Object.keys(manifest.summary.source_distribution).length).toBeGreaterThanOrEqual(2);
    expect(manifest.hardness_signal_status).toBe(hardnessStatus);
    expect(manifest.hardness_signal_source).toBe('dataset_schema_probe');
    expect(manifest.hardness_proxy_used).toBe(false);
    expect(protocol.taskSlicePolicy.hardnessSignalPolicy).toMatchObject({
      required: false,
      status: hardnessStatus,
      proxyAllowed: false,
      selectionMustRecordAbsence: true
    });
  });

  it('records stable identity, source, repo pin, and hash fields for every task', () => {
    for (const task of manifest.tasks) {
      expect(task.instance_id).toBeTruthy();
      expect(task.original_inst_id).toBeTruthy();
      expect(task.source).toBeTruthy();
      expect(task.language).toBeTruthy();
      expect(task.repo_url).toMatch(/^https:\/\/github\.com\/.+\.git$/);
      expect(task.base_commit).toMatch(/^[a-f0-9]{40}$/);
      expect(task.problem_statement_ref).toBe('dataset_field:problem_statement');
      expect(task.gold_context_ref).toBe('dataset_field:gold_context');
      expect(task.problem_statement_hash).toMatch(shaPattern);
      expect(task.gold_context_hash).toMatch(shaPattern);
      expect(task.patch_hash).toMatch(shaPattern);
      expect(task.test_patch_hash).toMatch(shaPattern);
      expect(task.f2p_hash).toMatch(shaPattern);
      expect(task.p2p_hash).toMatch(shaPattern);
      expect(task.gold_context_span_count).toBeGreaterThan(0);
      expect(task.hash_canonicalization_version).toBe(canonicalizationVersion);
      expect(task.hardness_proxy_used).toBe(false);
      expect(task.deterministic_rank).toMatch(shaPattern);
      expect(task.inclusion_rationale).toMatch(
        /^(language_coverage|source_coverage|repo_coverage|deterministic_fill)/
      );
    }
  });

  it('self-verifies manifest hashing and metadata determinism', () => {
    const withoutHash: Record<string, unknown> = { ...manifest };
    delete withoutHash.manifest_hash;
    expect(manifest.manifest_hash).toBe(hashObject(withoutHash));
    expect(manifest.hash_canonicalization_version).toBe(canonicalizationVersion);
    expect(hashObject({ a: 1, b: ['x', 'y'] })).toBe(hashObject({ b: ['x', 'y'], a: 1 }));
  });
});

describe('ContextBench Phase 37 exclusion log and anti-gaming guards', () => {
  it('keeps the exclusion log aligned with the manifest and records non-selected eligible rows', () => {
    expect(exclusions.dataset).toBe(manifest.dataset);
    expect(exclusions.datasetConfig).toBe(manifest.datasetConfig);
    expect(exclusions.selection_algorithm).toBe(manifest.selection_algorithm);
    expect(exclusions.selection_seed_or_deterministic_order).toBe(
      manifest.selection_seed_or_deterministic_order
    );
    expect(exclusions.selection_timestamp).toBe(manifest.selection_timestamp);
    expect(exclusions.task_pool_hash).toBe(manifest.task_pool_hash);
    expect(exclusions.hash_canonicalization_version).toBe(canonicalizationVersion);
    expect(exclusions.hardness_signal_status).toBe(hardnessStatus);
    expect(exclusions.hardness_proxy_used).toBe(false);
    expect(exclusions.selected_row_count).toBe(20);
    expect(exclusions.eligible_row_count).toBeGreaterThanOrEqual(20);
    expect(exclusions.non_selected_eligible_rows.length).toBeGreaterThan(0);
    expect(exclusions.non_selected_eligible_rows[0].reason).toBe('eligible_not_selected');
  });

  it('blocks output-aware and proxy-hardness selection sources', () => {
    expect(manifest.forbidden_selection_sources).toEqual(
      expect.arrayContaining([
        'agent_outputs',
        'codebase_context_outputs',
        'competitor_outputs',
        'proxy_hardness_score',
        'post_failure_task_filtering'
      ])
    );
    expect(manifest.no_lane_outputs_observed_attestation).toContain('No raw/native');
    expect(exclusions.no_lane_outputs_observed_attestation).toBe(
      manifest.no_lane_outputs_observed_attestation
    );
    expect(protocol.taskSlicePolicy.forbiddenSources).toEqual(
      expect.arrayContaining(['agent_outputs', 'codebase_context_outputs', 'competitor_outputs'])
    );
  });

  it('keeps Phase 36 boundaries and correction-ledger semantics intact', () => {
    expect(protocol.phaseBoundary.phase36MustNotFreeze).toEqual(
      expect.arrayContaining(['actual_task_ids', 'actual_repo_commits'])
    );
    expect(protocol.phaseBoundary.phase37Freezes).toContain('actual_contextbench_instance_ids');
    expect(corrections.corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correction_id: 'contextbench-hardness-signal-policy-2026-04-27',
          reason_category: 'factual_erratum',
          affected_fields: expect.arrayContaining(['taskSlicePolicy.hardnessSignalPolicy'])
        })
      ])
    );
    expect(corrections.policy.allowedReasonCategories).toContain('factual_erratum');
    expect(corrections.policy.forbiddenReasons).not.toContain('factual_erratum');
  });

  it('keeps lane isolation visible without running any lane', () => {
    expect(lanes.laneContaminationRules.oneContextToolPerLane).toBe(true);
    expect(lanes.laneContaminationRules.mixedLaneContextInvalidatesRun).toBe(true);
    for (const lane of lanes.lanes) {
      if (lane.laneId === 'raw-native') {
        expect(lane.allowedTools).toEqual(expect.arrayContaining(['native-read', 'native-search']));
      } else {
        expect(lane.allowedTools).toContain(lane.contextTool);
      }
      expect(lane.disallowedTools).not.toContain(lane.contextTool);
    }
  });

  it('keeps selector implementation wired to the mandatory anti-gaming fields', () => {
    const script = readFileSync('scripts/contextbench-select-slice.mjs', 'utf8');
    for (const requiredField of [
      'selection_timestamp',
      'task_pool_hash',
      'exclusion_log_path',
      'hash_canonicalization_version',
      'hardness_proxy_used',
      'no_lane_outputs_observed_attestation'
    ]) {
      expect(script).toContain(requiredField);
      expect(stableStringify(manifest)).toContain(requiredField);
    }
    expect(script).toContain('proxy_hardness_score');
    expect(script).toContain('post_failure_task_filtering');
  });
});

describe('ContextBench Phase 37 smoke pack separation', () => {
  it('keeps Excalidraw and FastAPI metadata-only and non-claim-bearing', () => {
    expect(smokePack.claimBearing).toBe(false);
    expect(smokePack.purpose).toBe('local_harness_smoke_only');
    expect(smokePack.executionStatus).toBe('metadata_only_not_executed_in_phase37');
    expect(smokePack.mustNotContributeTo).toEqual(
      expect.arrayContaining(['contextbench_claim_bearing_aggregates', 'public_benchmark_claims'])
    );
    expect(smokePack.corpora).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Excalidraw',
          claimBearing: false,
          phase37RunnableTasks: false
        }),
        expect.objectContaining({
          name: 'FastAPI',
          claimBearing: false,
          phase37RunnableTasks: false
        })
      ])
    );
    expect(protocol.smokeOnlyCorpora).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Excalidraw', claimBearing: false }),
        expect.objectContaining({ name: 'FastAPI', claimBearing: false })
      ])
    );
  });

  it('does not mix smoke corpora into the claim-bearing ContextBench manifest or claims', () => {
    const taskText = stableStringify(manifest.tasks);
    expect(taskText).not.toContain('Excalidraw');
    expect(taskText).not.toContain('FastAPI');
    expect(protocol.claimAllowed).toBe(false);
    expect(protocol.blockedClaims).toEqual(
      expect.arrayContaining([
        'codebase_context_beats_competitors',
        'codebase_context_improves_productivity',
        'focus_mode_improves_agent_outcomes',
        'token_savings_superiority'
      ])
    );
  });
});

describe('ContextBench Phase 40 task payload materialization', () => {
  it('writes selected problem statements without observing lane outputs', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'contextbench-task-payloads-'));
    try {
      const problemStatement = 'Fix the parser when the input contains nested groups.';
      const task = {
        instance_id: 'fixture-task-1',
        original_inst_id: 'owner__repo-1',
        repo: 'owner/repo',
        repo_url: 'https://github.com/owner/repo.git',
        base_commit: '1234567890abcdef1234567890abcdef12345678',
        problem_statement_hash: sha256Text(problemStatement)
      };
      const manifestPath = path.join(tempRoot, 'manifest.json');
      const rowsPath = path.join(tempRoot, 'rows.json');
      const payloadPath = path.join(tempRoot, 'payloads.json');
      const checkoutRoot = path.join(tempRoot, 'checkouts');
      writeFileSync(
        manifestPath,
        `${JSON.stringify(
          {
            protocolVersion: 'contextbench-protocol-v1',
            dataset: 'Contextbench/ContextBench',
            datasetConfig: 'contextbench_verified',
            split: 'train',
            manifest_hash: 'sha256:test-manifest',
            tasks: [task]
          },
          null,
          2
        )}\n`,
        'utf8'
      );
      writeFileSync(
        rowsPath,
        `${JSON.stringify(
          {
            rows: [
              {
                row: {
                  instance_id: task.instance_id,
                  repo_url: task.repo_url,
                  base_commit: task.base_commit,
                  problem_statement: problemStatement
                }
              }
            ]
          },
          null,
          2
        )}\n`,
        'utf8'
      );
      execFileSync(
        'node',
        [
          'scripts/contextbench-select-slice.mjs',
          '--write-task-payloads',
          '--rows-file',
          rowsPath,
          '--manifest',
          manifestPath,
          '--checkout-root',
          checkoutRoot,
          '--out',
          payloadPath
        ],
        { encoding: 'utf8' }
      );

      const payload = JSON.parse(readFileSync(payloadPath, 'utf8')) as {
        claimBearing: boolean;
        task_count: number;
        payload_hash: string;
        tasks: Array<{
          instance_id: string;
          problem_statement: string;
          problem_statement_hash_verified: boolean;
          repo_checkout_path: string;
          repo_checkout_status: string;
          lane_outputs_observed: boolean;
        }>;
      };
      expect(payload.claimBearing).toBe(false);
      expect(payload.task_count).toBe(1);
      expect(payload.payload_hash).toMatch(shaPattern);
      expect(payload.tasks[0]).toMatchObject({
        instance_id: task.instance_id,
        problem_statement: problemStatement,
        problem_statement_hash_verified: true,
        repo_checkout_status: 'planned_not_verified',
        lane_outputs_observed: false
      });
      expect(payload.tasks[0].repo_checkout_path).toContain('owner-repo-1234567890ab');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('materializes planned checkout paths and records verified base commits', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'contextbench-checkout-materializer-'));
    try {
      const sourceRepo = path.join(tempRoot, 'source-repo');
      const checkoutPath = path.join(tempRoot, 'checkout-repo');
      execFileSync('git', ['-c', 'core.autocrlf=false', 'init', sourceRepo], {
        encoding: 'utf8',
        env: childGitEnv
      });
      writeFileSync(path.join(sourceRepo, 'README.md'), 'fixture\n', 'utf8');
      execFileSync('git', ['-c', 'core.autocrlf=false', 'add', 'README.md'], {
        cwd: sourceRepo,
        env: childGitEnv,
        encoding: 'utf8'
      });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=ContextBench Test',
          '-c',
          'user.email=contextbench@example.invalid',
          'commit',
          '-m',
          'fixture'
        ],
        { cwd: sourceRepo, encoding: 'utf8', env: childGitEnv }
      );
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: sourceRepo,
        env: childGitEnv,
        encoding: 'utf8'
      }).trim();
      const payloadPath = path.join(tempRoot, 'payloads.json');
      writeFileSync(
        payloadPath,
        `${JSON.stringify(
          {
            name: 'test-payloads',
            protocolVersion: 'contextbench-protocol-v1',
            claimBearing: false,
            tasks: [
              {
                instance_id: 'fixture-task-1',
                repo_url: sourceRepo,
                base_commit: commit,
                repo_checkout_path: checkoutPath,
                repo_checkout_status: 'planned_not_verified'
              }
            ]
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      execFileSync(
        'node',
        [
          'scripts/contextbench-select-slice.mjs',
          '--materialize-checkouts',
          '--payloads',
          payloadPath,
          '--max-tasks',
          '1'
        ],
        { encoding: 'utf8' }
      );

      const payload = JSON.parse(readFileSync(payloadPath, 'utf8')) as {
        payload_hash: string;
        tasks: Array<{
          repo_checkout_status: string;
          repo_actual_head: string;
          base_commit_verified: boolean;
        }>;
      };
      expect(payload.payload_hash).toMatch(shaPattern);
      expect(payload.tasks[0]).toMatchObject({
        repo_checkout_status: 'verified',
        repo_actual_head: commit,
        base_commit_verified: true
      });
      expect(
        execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: checkoutPath,
          encoding: 'utf8',
          env: childGitEnv
        }).trim()
      ).toBe(commit);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('writes scorer-only gold input without mixing it into solver payloads', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'contextbench-gold-input-'));
    try {
      const goldContext = JSON.stringify([
        { file: 'src/a.ts', start_line: 1, end_line: 2, content: 'export const a = 1;' }
      ]);
      const task = {
        instance_id: 'fixture-task-1',
        original_inst_id: 'owner__repo-1',
        repo: 'owner/repo',
        repo_url: 'https://github.com/owner/repo.git',
        base_commit: '1234567890abcdef1234567890abcdef12345678',
        gold_context_hash: sha256Text(stableStringify(JSON.parse(goldContext) as unknown))
      };
      const manifestPath = path.join(tempRoot, 'manifest.json');
      const rowsPath = path.join(tempRoot, 'rows.json');
      const payloadPath = path.join(tempRoot, 'payloads.json');
      const goldPath = path.join(tempRoot, 'gold.json');
      const checkoutPath = path.join(tempRoot, 'checkout');
      writeFileSync(
        manifestPath,
        `${JSON.stringify(
          {
            protocolVersion: 'contextbench-protocol-v1',
            manifest_hash: 'sha256:test-manifest',
            tasks: [task]
          },
          null,
          2
        )}\n`,
        'utf8'
      );
      writeFileSync(
        rowsPath,
        `${JSON.stringify(
          {
            rows: [
              {
                row: {
                  instance_id: task.instance_id,
                  gold_context: goldContext,
                  patch: 'diff --git a/src/a.ts b/src/a.ts'
                }
              }
            ]
          },
          null,
          2
        )}\n`,
        'utf8'
      );
      writeFileSync(
        payloadPath,
        `${JSON.stringify(
          {
            payload_hash: 'sha256:test-payload',
            tasks: [
              {
                instance_id: task.instance_id,
                repo_checkout_path: checkoutPath,
                repo_checkout_status: 'verified'
              }
            ]
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      execFileSync(
        'node',
        [
          'scripts/contextbench-select-slice.mjs',
          '--write-gold',
          '--rows-file',
          rowsPath,
          '--manifest',
          manifestPath,
          '--payloads',
          payloadPath,
          '--task-id',
          task.instance_id,
          '--out',
          goldPath
        ],
        { encoding: 'utf8' }
      );

      const gold = JSON.parse(readFileSync(goldPath, 'utf8')) as {
        inst_id: string;
        repo_url: string;
        gold_ctx: unknown[];
      };
      const summary = JSON.parse(readFileSync(`${goldPath}.summary.json`, 'utf8')) as {
        scorerOnly: boolean;
        lane_outputs_observed: boolean;
        gold_context_hash_verified: boolean;
      };
      expect(gold.inst_id).toBe(task.instance_id);
      expect(gold.repo_url).toBe(checkoutPath);
      expect(gold.gold_ctx).toHaveLength(1);
      expect(summary).toMatchObject({
        scorerOnly: true,
        lane_outputs_observed: false,
        gold_context_hash_verified: true
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
