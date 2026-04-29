#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const DATASET = 'Contextbench/ContextBench';
const DATASET_CONFIG = 'contextbench_verified';
const SPLIT = 'train';
const DATASET_ROWS_URL = 'https://datasets-server.huggingface.co/rows';
const SELECTION_SEED = 'phase37-contextbench-v1-2026-04-27';
const SELECTION_TIMESTAMP = '2026-04-27T00:00:00.000Z';
const CANONICALIZATION_VERSION = 'contextbench-canonical-json-lf-v1';
const HARDNESS_STATUS = 'unavailable_in_contextbench_verified_schema';
const HARDNESS_SOURCE = 'dataset_schema_probe';

const REQUIRED_FIELDS = [
  'instance_id',
  'original_inst_id',
  'source',
  'language',
  'repo_url',
  'base_commit',
  'problem_statement',
  'gold_context',
  'patch',
  'test_patch',
  'f2p',
  'p2p'
];

const HASH_FIELDS = ['problem_statement', 'gold_context', 'patch', 'test_patch', 'f2p', 'p2p'];
const FORBIDDEN_SELECTION_SOURCES = [
  'agent_outputs',
  'codebase_context_outputs',
  'competitor_outputs',
  'proxy_hardness_score',
  'post_failure_task_filtering'
];

function help() {
  console.log(`ContextBench Phase 37 selection tool

Usage:
  node scripts/contextbench-select-slice.mjs --help
  node scripts/contextbench-select-slice.mjs --dry-run --out <dir>
  node scripts/contextbench-select-slice.mjs --probe-evaluator --out <dir>
  node scripts/contextbench-select-slice.mjs --write-fixtures
  node scripts/contextbench-select-slice.mjs --write-task-payloads --out <file> [--checkout-root <dir>]
  node scripts/contextbench-select-slice.mjs --write-gold --task-id <instance-id> --out <file> [--payloads <file>]
  node scripts/contextbench-select-slice.mjs --materialize-checkouts --payloads <file> [--max-tasks <n>]
  node scripts/contextbench-select-slice.mjs --check <manifest.json> --rows-file <frozen-rows.json>

Modes:
  --dry-run          Load ${DATASET}/${DATASET_CONFIG}, validate schema, compute eligible pool, and write audit files under --out.
  --probe-evaluator Run python -m contextbench.evaluate against a synthetic local git fixture only; no lane or product output is used.
  --write-fixtures  Write tests/fixtures/contextbench-task-manifest.json and tests/fixtures/contextbench-selection-exclusions.json.
  --write-task-payloads  Write selected task problem statements and intended checkout paths for Phase 40 live runs.
  --write-gold     Write scorer-only official-evaluator gold input for selected task(s); never pass this to solvers.
  --materialize-checkouts  Clone/fetch selected task repositories to their payload repo_checkout_path and verify base commits.
  --check <file>    Recompute deterministic selection from frozen rows and verify the frozen manifest.

Forbidden selection inputs:
  ${FORBIDDEN_SELECTION_SOURCES.join(', ')}
`);
}

function parseArgs(argv) {
  const args = {
    out: '',
    check: '',
    rowsFile: '',
    payloads: '',
    taskId: '',
    manifest: 'tests/fixtures/contextbench-task-manifest.json',
    checkoutRoot: '',
    maxTasks: 0,
    dryRun: false,
    probeEvaluator: false,
    writeFixtures: false,
    writeTaskPayloads: false,
    writeGold: false,
    materializeCheckouts: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--probe-evaluator') args.probeEvaluator = true;
    else if (arg === '--write-fixtures') args.writeFixtures = true;
    else if (arg === '--write-task-payloads') args.writeTaskPayloads = true;
    else if (arg === '--write-gold') args.writeGold = true;
    else if (arg === '--materialize-checkouts') args.materializeCheckouts = true;
    else if (arg === '--out') args.out = argv[++i] ?? '';
    else if (arg === '--check') args.check = argv[++i] ?? '';
    else if (arg === '--rows-file') args.rowsFile = argv[++i] ?? '';
    else if (arg === '--payloads') args.payloads = argv[++i] ?? '';
    else if (arg === '--task-id') args.taskId = argv[++i] ?? '';
    else if (arg === '--manifest') args.manifest = argv[++i] ?? '';
    else if (arg === '--checkout-root') args.checkoutRoot = argv[++i] ?? '';
    else if (arg === '--max-tasks') args.maxTasks = Number(argv[++i] ?? '0');
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function canonicalize(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value !== 'string') return stableStringify(value).replace(/\r\n?/g, '\n');
  const normalized = value.replace(/\r\n?/g, '\n');
  const trimmed = normalized.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return stableStringify(JSON.parse(trimmed));
    } catch {
      return normalized;
    }
  }
  return normalized;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function hashObject(value) {
  return sha256(stableStringify(value));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function loadRows() {
  const rows = [];
  let total = null;
  for (let offset = 0; total === null || offset < total; offset += 100) {
    const params = new URLSearchParams({
      dataset: DATASET,
      config: DATASET_CONFIG,
      split: SPLIT,
      offset: String(offset),
      length: '100'
    });
    const payload = await fetchJson(`${DATASET_ROWS_URL}?${params.toString()}`);
    total = payload.num_rows_total;
    rows.push(...payload.rows.map((entry) => entry.row));
  }
  return rows;
}

function normalizeRowsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) {
    return payload.rows.map((entry) => entry?.row ?? entry);
  }
  throw new Error('rows file must be an array of dataset rows or an object with rows');
}

async function loadRowsForArgs(args) {
  if (!args.rowsFile) return loadRows();
  return normalizeRowsPayload(JSON.parse(readFileSync(resolve(args.rowsFile), 'utf8')));
}

function normalizeRow(row) {
  const missing = REQUIRED_FIELDS.filter(
    (field) => row[field] === undefined || row[field] === null || row[field] === ''
  );
  let goldContextItems = [];
  if (!missing.includes('gold_context')) {
    try {
      const parsed = JSON.parse(row.gold_context);
      if (!Array.isArray(parsed) || parsed.length === 0)
        missing.push('gold_context_non_empty_array');
      else goldContextItems = parsed;
    } catch {
      missing.push('gold_context_valid_json');
    }
  }
  if (missing.length > 0)
    return { eligible: false, reason: 'missing_or_malformed_required_fields', missing };

  const fieldHashes = Object.fromEntries(
    HASH_FIELDS.map((field) => [field, sha256(canonicalize(row[field]))])
  );

  return {
    eligible: true,
    task: {
      instance_id: row.instance_id,
      original_inst_id: row.original_inst_id,
      source: row.source,
      language: row.language,
      repo: row.repo,
      repo_url: row.repo_url,
      base_commit: row.base_commit,
      problem_statement_ref: 'dataset_field:problem_statement',
      problem_statement_hash: fieldHashes.problem_statement,
      gold_context_ref: 'dataset_field:gold_context',
      gold_context_hash: fieldHashes.gold_context,
      patch_hash: fieldHashes.patch,
      test_patch_hash: fieldHashes.test_patch,
      f2p_hash: fieldHashes.f2p,
      p2p_hash: fieldHashes.p2p,
      gold_context_span_count: goldContextItems.length,
      hash_canonicalization_version: CANONICALIZATION_VERSION,
      hardness_signal_status: HARDNESS_STATUS,
      hardness_signal_source: HARDNESS_SOURCE,
      hardness_proxy_used: false
    }
  };
}

function buildPool(rows) {
  const seen = new Set();
  const eligible = [];
  const excluded = [];
  for (const [index, row] of rows.entries()) {
    const normalized = normalizeRow(row);
    if (!normalized.eligible) {
      excluded.push({
        row_index: index,
        instance_id: row.instance_id ?? '',
        reason: normalized.reason,
        details: normalized.missing
      });
      continue;
    }
    if (seen.has(normalized.task.instance_id)) {
      excluded.push({
        row_index: index,
        instance_id: normalized.task.instance_id,
        reason: 'duplicate_instance_id'
      });
      continue;
    }
    seen.add(normalized.task.instance_id);
    eligible.push(normalized.task);
  }
  const taskPoolHash = hashObject(
    eligible.map((task) => ({
      instance_id: task.instance_id,
      source: task.source,
      language: task.language,
      repo_url: task.repo_url,
      base_commit: task.base_commit,
      problem_statement_hash: task.problem_statement_hash,
      gold_context_hash: task.gold_context_hash
    }))
  );
  return { eligible, excluded, taskPoolHash };
}

function rankTask(task) {
  return sha256(
    `${SELECTION_SEED}:${task.source}:${task.language}:${task.repo_url}:${task.instance_id}`
  );
}

function selectTasks(eligible) {
  const ranked = [...eligible].sort((a, b) => rankTask(a).localeCompare(rankTask(b)));
  const selected = [];
  const selectedIds = new Set();
  const add = (task, rationale) => {
    if (selected.length >= 20 || selectedIds.has(task.instance_id)) return;
    selectedIds.add(task.instance_id);
    selected.push({ ...task, inclusion_rationale: rationale, deterministic_rank: rankTask(task) });
  };

  for (const language of [...new Set(ranked.map((task) => task.language))].sort()) {
    const task = ranked.find((candidate) => candidate.language === language);
    if (task) add(task, `language_coverage:${language}`);
  }
  for (const source of [...new Set(ranked.map((task) => task.source))].sort()) {
    const task = ranked.find((candidate) => candidate.source === source);
    if (task) add(task, `source_coverage:${source}`);
  }
  for (const task of ranked) {
    const repoAlreadySelected = selected.some((candidate) => candidate.repo_url === task.repo_url);
    if (!repoAlreadySelected) add(task, `repo_coverage:${task.repo_url}`);
    if (selected.length >= 20) break;
  }
  for (const task of ranked) add(task, 'deterministic_fill');

  const selectedSet = new Set(selected.map((task) => task.instance_id));
  const nonSelectedEligible = ranked
    .filter((task) => !selectedSet.has(task.instance_id))
    .map((task) => ({
      instance_id: task.instance_id,
      source: task.source,
      language: task.language,
      repo_url: task.repo_url,
      reason: 'eligible_not_selected',
      deterministic_rank: rankTask(task)
    }));

  return { selected, nonSelectedEligible };
}

function sanitizePathSegment(value) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function checkoutPathForTask(task, checkoutRoot) {
  if (!checkoutRoot) return '';
  return join(
    resolve(checkoutRoot),
    sanitizePathSegment(`${task.repo}-${task.base_commit.slice(0, 12)}`)
  );
}

function buildTaskPayloads(rows, manifest, checkoutRoot) {
  const rowsById = new Map(rows.map((row) => [row.instance_id, row]));
  const failures = [];
  const tasks = [];
  for (const task of manifest.tasks ?? []) {
    const row = rowsById.get(task.instance_id);
    if (!row) {
      failures.push(`${task.instance_id}: missing dataset row`);
      continue;
    }
    const problemStatement = typeof row.problem_statement === 'string' ? row.problem_statement : '';
    if (!problemStatement.trim()) failures.push(`${task.instance_id}: missing problem_statement`);
    const problemStatementHash = sha256(canonicalize(problemStatement));
    if (problemStatementHash !== task.problem_statement_hash) {
      failures.push(`${task.instance_id}: problem_statement_hash mismatch`);
    }
    if (row.repo_url !== task.repo_url) failures.push(`${task.instance_id}: repo_url mismatch`);
    if (row.base_commit !== task.base_commit)
      failures.push(`${task.instance_id}: base_commit mismatch`);
    tasks.push({
      instance_id: task.instance_id,
      original_inst_id: task.original_inst_id,
      repo: task.repo,
      repo_url: task.repo_url,
      base_commit: task.base_commit,
      problem_statement: problemStatement,
      problem_statement_hash: problemStatementHash,
      problem_statement_hash_verified: problemStatementHash === task.problem_statement_hash,
      repo_checkout_path: checkoutPathForTask(task, checkoutRoot),
      repo_checkout_status: checkoutRoot ? 'planned_not_verified' : 'not_planned',
      lane_outputs_observed: false
    });
  }
  if (failures.length > 0)
    throw new Error(`task payload materialization failed:\n- ${failures.join('\n- ')}`);
  const payloadBase = {
    name: 'v2.4-contextbench-phase40-task-payloads',
    protocolVersion: manifest.protocolVersion,
    dataset: manifest.dataset,
    datasetConfig: manifest.datasetConfig,
    split: manifest.split,
    claimBearing: false,
    purpose:
      'Phase 40 task input materialization; not lane output and not benchmark evidence by itself.',
    manifest_hash: manifest.manifest_hash,
    hash_canonicalization_version: CANONICALIZATION_VERSION,
    checkout_root: checkoutRoot ? resolve(checkoutRoot) : null,
    task_count: tasks.length,
    tasks
  };
  return withPayloadHash(payloadBase);
}

function summarize(tasks) {
  const countBy = (field) =>
    tasks.reduce((acc, task) => {
      acc[task[field]] = (acc[task[field]] ?? 0) + 1;
      return acc;
    }, {});
  return {
    task_count: tasks.length,
    language_distribution: countBy('language'),
    source_distribution: countBy('source'),
    repo_distribution: countBy('repo_url'),
    repo_count: new Set(tasks.map((task) => task.repo_url)).size,
    language_count: new Set(tasks.map((task) => task.language)).size
  };
}

function buildArtifacts(rows) {
  const { eligible, excluded, taskPoolHash } = buildPool(rows);
  if (eligible.length < 20)
    throw new Error(`Only ${eligible.length} eligible rows; need at least 20`);
  if (new Set(eligible.map((task) => task.repo_url)).size < 2)
    throw new Error('Eligible pool has fewer than two repositories');
  if (new Set(eligible.map((task) => task.language)).size < 2)
    throw new Error('Eligible pool has fewer than two languages');

  const { selected, nonSelectedEligible } = selectTasks(eligible);
  const exclusionLogPath = 'tests/fixtures/contextbench-selection-exclusions.json';
  const manifestBase = {
    name: 'v2.4-contextbench-phase37-task-manifest',
    protocolVersion: 'contextbench-protocol-v1',
    dataset: DATASET,
    datasetConfig: DATASET_CONFIG,
    split: SPLIT,
    claimBearing: true,
    selectedInPhase: 37,
    selection_algorithm: 'deterministic_seeded_coverage_then_rank_fill_v1',
    selection_seed_or_deterministic_order: SELECTION_SEED,
    selection_timestamp: SELECTION_TIMESTAMP,
    task_pool_hash: taskPoolHash,
    exclusion_log_path: exclusionLogPath,
    hash_canonicalization_version: CANONICALIZATION_VERSION,
    evaluator_success_status: 'passed_synthetic_official_evaluator_probe',
    hardness_signal_status: HARDNESS_STATUS,
    hardness_signal_source: HARDNESS_SOURCE,
    hardness_proxy_used: false,
    forbidden_selection_sources: FORBIDDEN_SELECTION_SOURCES,
    no_lane_outputs_observed_attestation:
      'No raw/native, codebase-context, competitor, proxy-hardness, or post-failure outputs were observed or used for selection.',
    summary: summarize(selected),
    tasks: selected
  };
  const manifest = { ...manifestBase, manifest_hash: hashObject(manifestBase) };
  const exclusions = {
    name: 'v2.4-contextbench-phase37-selection-exclusions',
    protocolVersion: 'contextbench-protocol-v1',
    dataset: DATASET,
    datasetConfig: DATASET_CONFIG,
    split: SPLIT,
    selection_algorithm: manifest.selection_algorithm,
    selection_seed_or_deterministic_order: SELECTION_SEED,
    selection_timestamp: SELECTION_TIMESTAMP,
    task_pool_hash: taskPoolHash,
    hash_canonicalization_version: CANONICALIZATION_VERSION,
    hardness_signal_status: HARDNESS_STATUS,
    hardness_proxy_used: false,
    no_lane_outputs_observed_attestation: manifest.no_lane_outputs_observed_attestation,
    input_row_count: rows.length,
    eligible_row_count: eligible.length,
    selected_row_count: selected.length,
    excluded_rows: excluded,
    non_selected_eligible_rows: nonSelectedEligible
  };
  return { manifest, exclusions, eligible };
}

function verifyManifest(actual, expected) {
  const failures = [];
  const actualHash = actual.manifest_hash;
  const actualWithoutHash = { ...actual };
  delete actualWithoutHash.manifest_hash;
  if (actualHash !== hashObject(actualWithoutHash))
    failures.push('manifest_hash does not match manifest content');
  if (actualHash !== expected.manifest_hash)
    failures.push('manifest differs from deterministic dataset selection');
  if (actual.tasks.length !== 20) failures.push(`expected 20 tasks, got ${actual.tasks.length}`);
  if (actual.hardness_proxy_used !== false)
    failures.push('manifest must set hardness_proxy_used false');
  if (actual.hardness_signal_status !== HARDNESS_STATUS)
    failures.push('manifest has wrong hardness signal status');
  if (!actual.no_lane_outputs_observed_attestation) failures.push('missing no-output attestation');
  if (new Set(actual.tasks.map((task) => task.repo_url)).size < 2)
    failures.push('selected tasks cover fewer than two repos');
  if (new Set(actual.tasks.map((task) => task.language)).size < 2)
    failures.push('selected tasks cover fewer than two languages');
  return failures;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: childEnvForCommand(command)
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runQuiet(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: childEnvForCommand(command),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.error?.message ?? result.stderr ?? ''
  };
}

function childEnvForCommand(command) {
  if (command !== 'git') return process.env;
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) {
      delete env[key];
    }
  }
  const gitHome = join(tmpdir(), 'contextbench-git-isolated-home');
  mkdirSync(gitHome, { recursive: true });
  env.HOME = gitHome;
  env.USERPROFILE = gitHome;
  env.XDG_CONFIG_HOME = gitHome;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

function git(cwd, args) {
  const result = run('git', args, cwd);
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function createEvaluatorFixture(outDir) {
  const repoDir = join(outDir, 'probe-repo');
  rmSync(repoDir, { recursive: true, force: true });
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(join(repoDir, 'sample.py'), 'def target():\n    return 42\n', 'utf8');
  git(repoDir, ['init']);
  git(repoDir, ['config', 'user.email', 'contextbench-probe@example.invalid']);
  git(repoDir, ['config', 'user.name', 'ContextBench Probe']);
  git(repoDir, ['add', 'sample.py']);
  git(repoDir, ['commit', '-m', 'probe fixture']);
  const commit = git(repoDir, ['rev-parse', 'HEAD']);
  const goldPath = join(outDir, 'gold.json');
  const predPath = join(outDir, 'prediction.json');
  const resultPath = join(outDir, 'results.jsonl');
  writeJson(goldPath, {
    inst_id: 'phase37-synthetic-evaluator-probe',
    original_inst_id: 'phase37-synthetic-evaluator-probe',
    repo_url: repoDir,
    commit,
    gold_ctx: [
      { file: 'sample.py', start_line: 1, end_line: 2, content: 'def target():\n    return 42' }
    ],
    patch: ''
  });
  writeJson(predPath, {
    instance_id: 'phase37-synthetic-evaluator-probe',
    repo_url: repoDir,
    commit,
    traj_data: {
      pred_steps: [{ files: ['sample.py'], spans: { 'sample.py': [{ start: 1, end: 2 }] } }],
      pred_files: ['sample.py'],
      pred_spans: { 'sample.py': [{ start: 1, end: 2 }] }
    },
    model_patch: ''
  });
  return { repoDir, goldPath, predPath, resultPath };
}

function probeEvaluator(outDir) {
  mkdirSync(outDir, { recursive: true });
  const fixture = createEvaluatorFixture(outDir);
  const officialRepoDir = join(outDir, 'ContextBench-official');
  const moduleCheck = run('python', ['-m', 'contextbench.evaluate', '--help'], process.cwd());
  let evaluatorCwd = process.cwd();
  if (moduleCheck.status !== 0) {
    if (!moduleCheck.stderr.includes('No module named')) {
      throw new Error(
        `official evaluator availability check failed: ${moduleCheck.stderr || moduleCheck.stdout}`
      );
    }
    if (!readableOfficialEvaluator(officialRepoDir)) {
      rmSync(officialRepoDir, { recursive: true, force: true });
      const clone = run(
        'git',
        [
          '-c',
          'core.longpaths=true',
          'clone',
          '--depth',
          '1',
          'https://github.com/EuniAI/ContextBench.git',
          officialRepoDir
        ],
        outDir
      );
      if (clone.status !== 0)
        throw new Error(
          `failed to clone official ContextBench repository: ${clone.stderr || clone.stdout}`
        );
    }
    evaluatorCwd = officialRepoDir;
  }
  const result = run(
    'python',
    [
      '-m',
      'contextbench.evaluate',
      '--gold',
      fixture.goldPath,
      '--pred',
      fixture.predPath,
      '--cache',
      join(outDir, 'repo-cache'),
      '--out',
      fixture.resultPath
    ],
    evaluatorCwd
  );
  const status = result.status === 0 ? 'passed' : 'failed';
  writeJson(join(outDir, 'probe-summary.json'), {
    status,
    command: `python -m contextbench.evaluate --gold ${fixture.goldPath} --pred ${fixture.predPath} --cache ${join(outDir, 'repo-cache')} --out ${fixture.resultPath}`,
    synthetic_fixture_only: true,
    lane_outputs_observed: false,
    stdout: result.stdout,
    stderr: result.stderr
  });
  if (result.status !== 0)
    throw new Error(`official evaluator probe failed; see ${join(outDir, 'probe-summary.json')}`);
  console.log(`official evaluator probe passed: ${fixture.resultPath}`);
}

function readableOfficialEvaluator(path) {
  try {
    readFileSync(join(path, 'contextbench', 'evaluate.py'), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function payloadHashBase(payload) {
  const copy = {
    ...payload,
    tasks: (payload.tasks ?? []).map((task) => {
      const taskCopy = { ...task };
      delete taskCopy.repo_checkout_path;
      delete taskCopy.repo_status_short;
      delete taskCopy.materialized_at;
      return taskCopy;
    })
  };
  delete copy.payload_hash;
  delete copy.checkout_root;
  delete copy.updated_at;
  return copy;
}

function withPayloadHash(payload) {
  const base = payloadHashBase(payload);
  return { ...payload, payload_hash: hashObject(base) };
}

function gitMaybe(cwd, args) {
  const result = runQuiet(
    'git',
    ['-c', 'core.longpaths=true', '-c', 'core.autocrlf=false', ...args],
    cwd
  );
  return result.status === 0 ? result.stdout.trim() : null;
}

function gitRequired(cwd, args) {
  const result = runQuiet(
    'git',
    ['-c', 'core.longpaths=true', '-c', 'core.autocrlf=false', ...args],
    cwd
  );
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function cloneCheckout(task) {
  const checkoutPath = task.repo_checkout_path;
  if (!checkoutPath) throw new Error(`${task.instance_id}: missing repo_checkout_path`);
  if (!task.repo_url) throw new Error(`${task.instance_id}: missing repo_url`);
  if (!task.base_commit) throw new Error(`${task.instance_id}: missing base_commit`);
  const absoluteCheckoutPath = resolve(checkoutPath);
  if (!readableGitCheckout(absoluteCheckoutPath)) {
    rmSync(absoluteCheckoutPath, { recursive: true, force: true });
    mkdirSync(dirname(absoluteCheckoutPath), { recursive: true });
    const clone = runQuiet(
      'git',
      [
        '-c',
        'core.longpaths=true',
        '-c',
        'core.autocrlf=false',
        'clone',
        '--no-checkout',
        task.repo_url,
        absoluteCheckoutPath
      ],
      process.cwd()
    );
    if (clone.status !== 0)
      throw new Error(`${task.instance_id}: git clone failed: ${clone.stderr || clone.stdout}`);
  }
  gitRequired(absoluteCheckoutPath, ['config', 'core.longpaths', 'true']);
  gitRequired(absoluteCheckoutPath, ['config', 'core.autocrlf', 'false']);
  const currentHead = gitMaybe(absoluteCheckoutPath, ['rev-parse', 'HEAD']);
  if (currentHead !== task.base_commit) {
    const shallowFetch = runQuiet(
      'git',
      ['-c', 'core.longpaths=true', 'fetch', '--depth', '1', 'origin', task.base_commit],
      absoluteCheckoutPath
    );
    if (shallowFetch.status !== 0) {
      gitRequired(absoluteCheckoutPath, ['fetch', 'origin', task.base_commit]);
    }
  }
  gitRequired(absoluteCheckoutPath, ['checkout', '--force', '--detach', task.base_commit]);
  gitRequired(absoluteCheckoutPath, ['clean', '-fd']);
  const actualHead = gitRequired(absoluteCheckoutPath, ['rev-parse', 'HEAD']);
  const statusShort = gitRequired(absoluteCheckoutPath, ['status', '--short']);
  return {
    ...task,
    repo_checkout_path: absoluteCheckoutPath,
    repo_checkout_status:
      actualHead === task.base_commit && !statusShort ? 'verified' : 'not_clean_or_wrong_commit',
    repo_actual_head: actualHead,
    base_commit_verified: actualHead === task.base_commit,
    repo_status_short: statusShort,
    repo_clean_verified: statusShort === '',
    materialized_at: new Date().toISOString()
  };
}

function readableGitCheckout(path) {
  if (!existsSync(path)) return false;
  try {
    readFileSync(join(path, '.git', 'HEAD'), 'utf8');
    return true;
  } catch {
    return gitMaybe(path, ['rev-parse', '--git-dir']) !== null;
  }
}

function materializeCheckouts(args) {
  if (!args.payloads) throw new Error('--materialize-checkouts requires --payloads <file>');
  const payloadPath = resolve(args.payloads);
  const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
  const maxTasks = Number.isInteger(args.maxTasks) && args.maxTasks > 0 ? args.maxTasks : Infinity;
  let attempted = 0;
  const tasks = [];
  for (const task of payload.tasks ?? []) {
    if (attempted >= maxTasks) {
      tasks.push(task);
      continue;
    }
    tasks.push(cloneCheckout(task));
    attempted += 1;
  }
  const updated = withPayloadHash({
    ...payload,
    tasks,
    updated_at: new Date().toISOString()
  });
  writeJson(payloadPath, updated);
  console.log(`materialized ${attempted} checkout(s) in ${payloadPath}`);
}

function writeGoldInput(rows, args) {
  if (!args.out) throw new Error('--write-gold requires --out <file>');
  if (!args.taskId) throw new Error('--write-gold requires --task-id <instance-id>');
  const manifest = JSON.parse(readFileSync(resolve(args.manifest), 'utf8'));
  const payloads = args.payloads
    ? JSON.parse(readFileSync(resolve(args.payloads), 'utf8'))
    : { tasks: [] };
  const payloadById = new Map((payloads.tasks ?? []).map((task) => [task.instance_id, task]));
  const rowById = new Map(rows.map((row) => [row.instance_id, row]));
  const task = (manifest.tasks ?? []).find((candidate) => candidate.instance_id === args.taskId);
  if (!task) throw new Error(`task ${args.taskId} is not present in manifest ${args.manifest}`);
  const row = rowById.get(task.instance_id);
  if (!row) throw new Error(`task ${task.instance_id} is not present in dataset rows`);
  const goldHash = sha256(canonicalize(row.gold_context));
  if (goldHash !== task.gold_context_hash)
    throw new Error(`task ${task.instance_id} gold_context_hash mismatch`);
  const payload = payloadById.get(task.instance_id);
  const repoUrl = isVerifiedCheckoutPayload(payload, task)
    ? payload.repo_checkout_path
    : task.repo_url;
  const goldInput = {
    inst_id: task.instance_id,
    original_inst_id: task.original_inst_id,
    repo_url: repoUrl,
    commit: task.base_commit,
    gold_ctx: JSON.parse(row.gold_context),
    patch: row.patch
  };
  writeJson(resolve(args.out), goldInput);
  writeJson(`${resolve(args.out)}.summary.json`, {
    claimBearing: false,
    scorerOnly: true,
    lane_outputs_observed: false,
    task_id: task.instance_id,
    original_repo_url: task.repo_url,
    scorer_repo_url: repoUrl,
    commit: task.base_commit,
    gold_context_hash: goldHash,
    gold_context_hash_verified: true,
    payload_hash: payloads.payload_hash ?? null
  });
  console.log(`wrote scorer-only gold input ${resolve(args.out)}`);
}

function isVerifiedCheckoutPayload(payload, task) {
  return (
    payload?.repo_checkout_status === 'verified' &&
    typeof payload.repo_checkout_path === 'string' &&
    payload.repo_checkout_path.length > 0 &&
    payload.repo_actual_head === task.base_commit &&
    payload.base_commit_verified === true &&
    payload.repo_clean_verified === true
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || process.argv.length <= 2) {
    help();
    return;
  }
  if (args.probeEvaluator) {
    if (!args.out) throw new Error('--probe-evaluator requires --out <dir>');
    probeEvaluator(resolve(args.out));
    return;
  }

  if (args.materializeCheckouts) {
    materializeCheckouts(args);
    return;
  }

  if (args.check && !args.rowsFile) {
    throw new Error('--check requires --rows-file <frozen-rows.json> to avoid live dataset drift');
  }

  const rows = await loadRowsForArgs(args);

  if (args.writeGold) {
    writeGoldInput(rows, args);
    return;
  }

  if (args.writeTaskPayloads) {
    if (!args.out) throw new Error('--write-task-payloads requires --out <file>');
    const manifest = JSON.parse(readFileSync(resolve(args.manifest), 'utf8'));
    const payloads = buildTaskPayloads(rows, manifest, args.checkoutRoot);
    writeJson(resolve(args.out), payloads);
    console.log(`wrote task payloads ${resolve(args.out)}`);
    return;
  }

  const artifacts = buildArtifacts(rows);

  if (args.dryRun) {
    if (!args.out) throw new Error('--dry-run requires --out <dir>');
    const outDir = resolve(args.out);
    writeJson(join(outDir, 'contextbench-selection-exclusions.json'), artifacts.exclusions);
    writeJson(join(outDir, 'contextbench-dry-run-summary.json'), {
      dataset: DATASET,
      datasetConfig: DATASET_CONFIG,
      row_count: rows.length,
      eligible_row_count: artifacts.eligible.length,
      selected_preview: artifacts.manifest.tasks.map((task) => task.instance_id),
      task_pool_hash: artifacts.manifest.task_pool_hash,
      hardness_signal_status: HARDNESS_STATUS,
      hardness_proxy_used: false
    });
    console.log(`dry-run wrote ${outDir}`);
  }

  if (args.writeFixtures) {
    writeJson('tests/fixtures/contextbench-task-manifest.json', artifacts.manifest);
    writeJson('tests/fixtures/contextbench-selection-exclusions.json', artifacts.exclusions);
    console.log('wrote tests/fixtures/contextbench-task-manifest.json');
    console.log('wrote tests/fixtures/contextbench-selection-exclusions.json');
  }

  if (args.check) {
    const manifest = JSON.parse(readFileSync(resolve(args.check), 'utf8'));
    const failures = verifyManifest(manifest, artifacts.manifest);
    if (failures.length > 0) throw new Error(`manifest check failed:\n- ${failures.join('\n- ')}`);
    console.log(`manifest check passed: ${args.check}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
