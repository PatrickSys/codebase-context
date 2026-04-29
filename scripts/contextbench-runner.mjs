#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const RUNNER_SOURCE_PATH = fileURLToPath(import.meta.url);

const FIXTURES = {
  protocol: 'tests/fixtures/contextbench-benchmark-protocol.json',
  lanes: 'tests/fixtures/contextbench-lanes.json',
  corrections: 'tests/fixtures/contextbench-corrections.json',
  manifest: 'tests/fixtures/contextbench-task-manifest.json',
  laneToolCards: 'tests/fixtures/contextbench-lane-tool-cards.json',
  laneSetupEvidence: 'tests/fixtures/contextbench-lane-setup-evidence.json',
  codebaseContextBaselineArms: 'tests/fixtures/contextbench-codebase-context-baseline-arms.json'
};

const TERMINAL_LANE_SETUP_STATUSES = new Set([
  'ready_for_phase40',
  'setup_failed',
  'index_failed',
  'tool_error',
  'invasive_setup_blocked'
]);

const CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS = [
  'answer',
  'confidence',
  'evidence',
  'filesReferenced',
  'symbolsReferenced',
  'unsupportedClaims',
  'readyToEdit'
];

const CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS,
  properties: {
    answer: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'lineRange', 'reason'],
        properties: {
          file: { type: 'string', minLength: 1 },
          lineRange: {
            type: 'object',
            additionalProperties: false,
            required: ['start', 'end'],
            properties: {
              start: { type: 'integer', minimum: 1 },
              end: { type: 'integer', minimum: 1 }
            }
          },
          reason: { type: 'string', minLength: 1 }
        }
      }
    },
    filesReferenced: { type: 'array', items: { type: 'string' } },
    symbolsReferenced: { type: 'array', items: { type: 'string' } },
    unsupportedClaims: { type: 'array', items: { type: 'string' } },
    readyToEdit: { type: 'boolean' }
  }
};

const EVIDENCE_REFERENCE_FIELDS = ['file', 'lineRange', 'reason'];
const LINE_RANGE_FIELDS = ['start', 'end'];

function diagnosticFallbackScoring(fixtures, fallbackReason, extra = {}) {
  return {
    officialEvaluatorFirst: false,
    officialEvaluatorAttempted: false,
    officialEvaluatorInvoked: false,
    command: fixtures.protocol.benchmarkTarget.officialEvaluatorCommand,
    claimBearing: false,
    fallbackReason,
    ...extra
  };
}

function officialEvaluatorCommandParts() {
  const override = process.env.CONTEXTBENCH_OFFICIAL_EVALUATOR_COMMAND;
  if (!override) return { command: 'python', prefixArgs: ['-m', 'contextbench.evaluate'] };
  let parts;
  try {
    parts = JSON.parse(override);
  } catch {
    throw new Error('CONTEXTBENCH_OFFICIAL_EVALUATOR_COMMAND must be a JSON array');
  }
  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    parts.some((part) => typeof part !== 'string')
  ) {
    throw new Error('CONTEXTBENCH_OFFICIAL_EVALUATOR_COMMAND must be a non-empty JSON string array');
  }
  return { command: parts[0], prefixArgs: parts.slice(1) };
}

const BLOCKED_LANE_SETUP_STATUSES = new Set([
  'setup_failed',
  'index_failed',
  'tool_error',
  'invasive_setup_blocked'
]);

function help() {
  console.log(`ContextBench Phase 38/39/40 runner

Usage:
  node scripts/contextbench-runner.mjs --help
  node scripts/contextbench-runner.mjs --validate-fixtures
  node scripts/contextbench-runner.mjs --validate-lane-setup
  node scripts/contextbench-runner.mjs --baseline-snapshot --out benchmark-runs/contextbench/phase40/<session_id>
  node scripts/contextbench-runner.mjs --baseline-snapshot --out benchmark-runs/contextbench/phase41/<session_id>
  node scripts/contextbench-runner.mjs --baseline-run --session benchmark-runs/contextbench/phase40/<session_id> --executor fake --lane <lane-id> --task-id <instance-id> --repeat <n>
  node scripts/contextbench-runner.mjs --baseline-run --session benchmark-runs/contextbench/phase41/<session_id> --executor claude --task-payloads <task-payloads.json> --lane <lane-id> --task-id <instance-id> --repeat <n>
  node scripts/contextbench-runner.mjs --baseline-refresh --session benchmark-runs/contextbench/phase41/<session_id>
  node scripts/contextbench-runner.mjs --baseline-validate --session benchmark-runs/contextbench/phase41/<session_id>
  node scripts/contextbench-runner.mjs --baseline-seal --session benchmark-runs/contextbench/phase41/<session_id>
  node scripts/contextbench-runner.mjs --phase42-verify --session benchmark-runs/contextbench/phase41/<session_id> [--out report.json] [--quiet]
  node scripts/contextbench-runner.mjs --setup-index-measure --session benchmark-runs/contextbench/phase41/<session_id> --lane raw-native
  node scripts/contextbench-runner.mjs --setup-index-import --session benchmark-runs/contextbench/phase41/<session_id> --lane <lane-id> --input setup-index.json
  node scripts/contextbench-runner.mjs --baseline-validate-arms tests/fixtures/contextbench-codebase-context-baseline-arms.json
  node scripts/contextbench-runner.mjs --print-claude-args --model haiku
  node scripts/contextbench-runner.mjs --print-answer-schema
  node scripts/contextbench-runner.mjs --dry-run --executor fake --lane <lane-id> --task-id <instance-id> --repeat <n> --out <dir>
  node scripts/contextbench-runner.mjs --score-probe --out <dir>

Modes:
  --validate-fixtures  Validate frozen protocol, task manifest, lane governance, and lane tool cards.
  --validate-lane-setup  Validate Phase 39 setup/index readiness or terminal blocker evidence only.
  --baseline-snapshot  Capture dirty-worktree state before any Phase 40 baseline attempt.
  --baseline-run       Write a baseline attempt row and artifacts. Fake executor is test-only; live executors require task payloads and materialized checkouts.
  --baseline-refresh   Re-hash an interrupted Phase 40/41 session without running live agents.
  --baseline-validate  Validate a Phase 40/41 session root, hashes, reservations, rows, and artifact paths.
  --baseline-seal      Seal only after terminal evidence and the Phase 42 evidence gate both pass.
  --phase42-verify     Read-only Phase 42 evidence gate over a Phase 40/41 session; exits non-zero unless claim-pass.
  --quiet              With --phase42-verify, write only the concise pass/fail line to stdout.
  --setup-index-measure  Capture safe setup/index measurement artifacts before task execution.
  --setup-index-import   Import pre-captured setup/index evidence without running setup commands.
  --baseline-validate-arms  Validate diagnostic codebase-context baseline arm metadata.
  --print-claude-args  Print the Claude CLI args used for schema-gated live attempts.
  --print-answer-schema  Print the structured answer JSON Schema used by live attempts.
  --dry-run            Write non-claim-bearing fake-executor smoke artifacts and one append-only manifest row.
  --score-probe        Write a synthetic non-claim-bearing diagnostic fallback artifact without live Claude.

Phase 39 boundary:
  Lane setup validation and probes are readiness/blocker evidence only, always claimBearing=false.
  Phase 40 owns dirty-worktree baseline capture, task x repeat execution, and non-claim-bearing baseline artifacts while claimAllowed=false.

Anti-scripting boundary:
  This runner standardizes prompt, lane card, budgets, traces, structured answer JSON, trajectory, and score artifacts.
  It must not script agent decisions, file selection, query rewrites, answer content, or evidence selection.
`);
}

function parseArgs(argv) {
  const args = { repeat: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--validate-fixtures') args.validateFixtures = true;
    else if (arg === '--validate-lane-setup') args.validateLaneSetup = true;
    else if (arg === '--baseline-snapshot') args.baselineSnapshot = true;
    else if (arg === '--baseline-run') args.baselineRun = true;
    else if (arg === '--baseline-refresh') args.baselineRefresh = true;
    else if (arg === '--baseline-validate') args.baselineValidate = true;
    else if (arg === '--baseline-seal') args.baselineSeal = true;
    else if (arg === '--phase42-verify') args.phase42Verify = true;
    else if (arg === '--setup-index-measure') args.setupIndexMeasure = true;
    else if (arg === '--setup-index-import') args.setupIndexImport = true;
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--baseline-validate-arms') args.baselineValidateArms = argv[++i] ?? '';
    else if (arg === '--baseline-run-codebase-context-arms')
      args.baselineRunCodebaseContextArms = true;
    else if (arg === '--print-claude-args') args.printClaudeArgs = true;
    else if (arg === '--print-answer-schema') args.printAnswerSchema = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--score-probe') args.scoreProbe = true;
    else if (arg === '--executor') args.executor = argv[++i] ?? '';
    else if (arg === '--model') args.model = argv[++i] ?? '';
    else if (arg === '--lane') args.lane = argv[++i] ?? '';
    else if (arg === '--task-id') args.taskId = argv[++i] ?? '';
    else if (arg === '--repeat') args.repeat = Number(argv[++i] ?? '1');
    else if (arg === '--repeats') args.repeats = Number(argv[++i] ?? '1');
    else if (arg === '--max-attempts') args.maxAttempts = Number(argv[++i] ?? '0');
    else if (arg === '--timeout-ms') args.timeoutMs = Number(argv[++i] ?? '0');
    else if (arg === '--task-payloads') args.taskPayloads = argv[++i] ?? '';
    else if (arg === '--input') args.input = argv[++i] ?? '';
    else if (arg === '--fake-answer-mode') args.fakeAnswerMode = argv[++i] ?? 'valid';
    else if (arg === '--all-ready-lanes') args.allReadyLanes = true;
    else if (arg === '--out') args.out = argv[++i] ?? '';
    else if (arg === '--session') args.session = argv[++i] ?? '';
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

function sha256(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function canonicalizeDatasetField(value) {
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

function sha256Buffer(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function hashFile(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

function runnerSourceHash() {
  return hashFile(RUNNER_SOURCE_PATH);
}

function hashObject(value) {
  return sha256(stableStringify(value));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readTaskPayloads(payloadPath) {
  if (!payloadPath) return new Map();
  const absolutePath = isAbsolute(payloadPath) ? payloadPath : resolve(process.cwd(), payloadPath);
  const payload = readJson(absolutePath);
  const entries = Array.isArray(payload?.tasks)
    ? payload.tasks
    : Object.entries(payload?.tasksById ?? payload ?? {}).map(([instanceId, value]) => ({
        instance_id: instanceId,
        ...value
      }));
  return new Map(
    entries
      .filter((entry) => entry && typeof entry.instance_id === 'string')
      .map((entry) => [entry.instance_id, entry])
  );
}

function executorCommandIsOverridden(executor) {
  if (executor === 'claude') return Boolean(process.env.CONTEXTBENCH_CLAUDE_COMMAND);
  if (executor === 'codex') return Boolean(process.env.CONTEXTBENCH_CODEX_COMMAND);
  if (executor === 'gemini') return Boolean(process.env.CONTEXTBENCH_GEMINI_COMMAND);
  if (executor === 'opencode') return Boolean(process.env.CONTEXTBENCH_OPENCODE_COMMAND);
  return false;
}

function gitOutput(cwd, args) {
  try {
    return execFileSync('git', ['-c', 'core.longpaths=true', '-c', 'core.autocrlf=false', ...args], {
      cwd,
      encoding: 'utf8',
      input: '',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function resolveTaskContext(task, payloads, executor) {
  if (executor === 'fake') return { materialized: false, errors: [] };
  const payload = payloads.get(task.instance_id);
  const errors = [];
  if (!payload) errors.push('missing_task_payload');
  const problemStatement =
    typeof payload?.problem_statement === 'string' ? payload.problem_statement : '';
  if (!problemStatement.trim()) errors.push('missing_problem_statement');
  const repoCheckoutPath =
    typeof payload?.repo_checkout_path === 'string' ? payload.repo_checkout_path : '';
  if (!repoCheckoutPath.trim()) errors.push('missing_repo_checkout_path');
  const absoluteCheckoutPath = repoCheckoutPath
    ? isAbsolute(repoCheckoutPath)
      ? repoCheckoutPath
      : resolve(process.cwd(), repoCheckoutPath)
    : '';
  if (absoluteCheckoutPath && !existsSync(absoluteCheckoutPath))
    errors.push('repo_checkout_missing');
  const actualHead = absoluteCheckoutPath
    ? gitOutput(absoluteCheckoutPath, ['rev-parse', 'HEAD'])
    : null;
  const statusShort = absoluteCheckoutPath
    ? gitOutput(absoluteCheckoutPath, ['status', '--short'])
    : null;
  const remoteUrl = absoluteCheckoutPath
    ? gitOutput(absoluteCheckoutPath, ['remote', 'get-url', 'origin'])
    : null;
  if (absoluteCheckoutPath && !actualHead) errors.push('repo_checkout_not_git');
  if (actualHead && statusShort) errors.push('repo_checkout_dirty');
  const problemStatementHash = problemStatement
    ? sha256(canonicalizeDatasetField(problemStatement))
    : null;
  const overridden = executorCommandIsOverridden(executor);
  const problemStatementHashVerified = problemStatementHash === task.problem_statement_hash;
  const baseCommitVerified = actualHead === task.base_commit;
  if (!overridden && problemStatement && !problemStatementHashVerified)
    errors.push('problem_statement_hash_mismatch');
  if (!overridden && actualHead && !baseCommitVerified) errors.push('base_commit_mismatch');
  return {
    materialized: errors.length === 0,
    errors,
    problemStatement,
    problemStatementHash,
    problemStatementHashVerified,
    repoCheckoutPath: absoluteCheckoutPath || null,
    actualHead,
    statusShort,
    baseCommitVerified,
    remoteUrl,
    verificationStrict: !overridden
  };
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function artifactEntry(filePath, rootDir) {
  const stats = statSync(filePath);
  return {
    path: normalizePath(relative(rootDir, filePath)),
    hash: hashFile(filePath),
    bytes: stats.size
  };
}

function writeTextArtifact(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

function sanitize(value) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function loadFixtures() {
  return {
    protocol: readJson(FIXTURES.protocol),
    lanes: readJson(FIXTURES.lanes),
    corrections: readJson(FIXTURES.corrections),
    manifest: readJson(FIXTURES.manifest),
    laneToolCards: readJson(FIXTURES.laneToolCards),
    laneSetupEvidence: readJson(FIXTURES.laneSetupEvidence)
  };
}

function hasPendingPhase39Placeholder(card) {
  return [card.setupCommand, card.indexCommand, card.queryCommand, card.versionCommand].some(
    (command) => String(command).toLowerCase().includes('pending phase 39')
  );
}

function validateCommandEvidence(record, errors) {
  const commandKinds = new Set(record.commands?.map((command) => command.kind));
  for (const kind of ['setup', 'index', 'query', 'version']) {
    if (!commandKinds.has(kind))
      errors.push(`lane ${record.laneId} missing ${kind} command evidence`);
  }
  for (const command of record.commands ?? []) {
    if (!command.command || !command.cwd || !command.status) {
      errors.push(
        `lane ${record.laneId} has incomplete ${command.kind ?? 'unknown'} command evidence`
      );
    }
    if (
      command.durationMs !== null &&
      (!Number.isFinite(command.durationMs) || command.durationMs < 0)
    ) {
      errors.push(`lane ${record.laneId} has invalid ${command.kind} duration`);
    }
  }
}

function validateTerminalBlockedEvidence(record, errors) {
  if (!record.logReference && !(record.commands ?? []).some((command) => command.outputHash)) {
    errors.push(
      `lane ${record.laneId} blocked/failed evidence needs a log reference or output hash`
    );
  }
  if (!record.nextHumanAction || record.nextHumanAction.length < 20) {
    errors.push(`lane ${record.laneId} blocked/failed evidence needs next human action`);
  }
  const hasBlockedCommand = (record.commands ?? []).some((command) =>
    ['blocked', 'failed'].includes(command.status)
  );
  if (!hasBlockedCommand)
    errors.push(`lane ${record.laneId} blocked/failed evidence needs blocked or failed command`);
}

function validateLaneSetupEvidence(fixtures = loadFixtures()) {
  const errors = [];
  if (fixtures.laneSetupEvidence.claimBearing !== false)
    errors.push('lane setup evidence must be non-claim-bearing');
  if (
    !String(fixtures.laneSetupEvidence.generatedOutputsPolicy ?? '').includes(
      'not Phase 40 baseline artifacts'
    )
  ) {
    errors.push(
      'lane setup evidence must keep generated outputs outside Phase 40 baseline artifacts'
    );
  }

  const cardsByLane = new Map(fixtures.laneToolCards.cards.map((card) => [card.laneId, card]));
  const evidenceByLane = new Map(
    fixtures.laneSetupEvidence.records.map((record) => [record.laneId, record])
  );

  for (const lane of fixtures.lanes.lanes) {
    const card = cardsByLane.get(lane.laneId);
    const record = evidenceByLane.get(lane.laneId);
    if (!card) {
      errors.push(`missing lane tool card for ${lane.laneId}`);
      continue;
    }
    if (!record) {
      errors.push(`missing lane setup evidence for ${lane.laneId}`);
      continue;
    }
    if (record.readinessStatus === 'pending') errors.push(`lane ${lane.laneId} remains pending`);
    if (!TERMINAL_LANE_SETUP_STATUSES.has(record.readinessStatus)) {
      errors.push(`lane ${lane.laneId} has non-terminal setup status ${record.readinessStatus}`);
    }
    if (card.phase39Status !== record.readinessStatus) {
      errors.push(`lane ${lane.laneId} card/evidence status mismatch`);
    }
    if (
      hasPendingPhase39Placeholder(card) &&
      !BLOCKED_LANE_SETUP_STATUSES.has(record.readinessStatus)
    ) {
      errors.push(
        `lane ${lane.laneId} has unresolved pending Phase 39 command without terminal blocker evidence`
      );
    }
    if (hasPendingPhase39Placeholder(card))
      errors.push(`lane ${lane.laneId} still has pending Phase 39 command text`);
    if (record.claimBearing !== false)
      errors.push(`lane ${lane.laneId} setup evidence must be non-claim-bearing`);
    if (
      lane.laneId !== 'raw-native' &&
      (card.contextTools.length !== 1 || card.allowedTools.length !== 1)
    ) {
      errors.push(`lane ${lane.laneId} must expose exactly one context tool`);
    }
    if (lane.laneId !== 'raw-native') {
      for (const nativeTool of ['native-read', 'native-search', 'native-shell-readonly']) {
        if (!card.disallowedTools.includes(nativeTool))
          errors.push(`lane ${lane.laneId} must disallow ${nativeTool}`);
      }
    }
    if (card.setupCostReportedSeparately !== true || card.indexCostReportedSeparately !== true) {
      errors.push(`lane ${lane.laneId} must separate setup/index cost`);
    }
    if ('taskWallTimeMs' in record)
      errors.push(`lane ${lane.laneId} setup evidence must not include task wall time`);
    if (
      record.setupDurationMs !== null &&
      (!Number.isFinite(record.setupDurationMs) || record.setupDurationMs < 0)
    ) {
      errors.push(`lane ${lane.laneId} has invalid setup duration`);
    }
    if (
      record.indexDurationMs !== null &&
      (!Number.isFinite(record.indexDurationMs) || record.indexDurationMs < 0)
    ) {
      errors.push(`lane ${lane.laneId} has invalid index duration`);
    }
    validateCommandEvidence(record, errors);
    if (BLOCKED_LANE_SETUP_STATUSES.has(record.readinessStatus))
      validateTerminalBlockedEvidence(record, errors);
  }

  if (errors.length > 0) throw new Error(`lane setup validation failed:\n- ${errors.join('\n- ')}`);
  return fixtures;
}

function validateFixtures() {
  const fixtures = loadFixtures();
  const errors = [];
  const manifestWithoutHash = { ...fixtures.manifest };
  delete manifestWithoutHash.manifest_hash;
  if (fixtures.manifest.manifest_hash !== hashObject(manifestWithoutHash))
    errors.push('task manifest hash mismatch');
  if (fixtures.manifest.tasks.length !== 20)
    errors.push('task manifest must contain exactly 20 tasks');
  if (fixtures.protocol.claimAllowed !== false)
    errors.push('protocol claimAllowed must remain false');
  if (!fixtures.protocol.benchmarkTarget.officialEvaluatorFirst)
    errors.push('official evaluator must be first');
  if (!fixtures.protocol.budgets.setupAndIndexingReportedSeparately)
    errors.push('setup/indexing must be separate');

  const cardsByLane = new Map(fixtures.laneToolCards.cards.map((card) => [card.laneId, card]));
  for (const laneId of fixtures.lanes.broadClaimLaneSet) {
    if (!cardsByLane.has(laneId)) errors.push(`missing lane tool card for ${laneId}`);
  }
  for (const lane of fixtures.lanes.lanes) {
    const card = cardsByLane.get(lane.laneId);
    if (!card) continue;
    for (const field of fixtures.lanes.laneToolCardRequiredFields) {
      if (card[field] === undefined || card[field] === '')
        errors.push(`lane ${lane.laneId} missing ${field}`);
    }
    if (card.setupCostReportedSeparately !== true || card.indexCostReportedSeparately !== true) {
      errors.push(`lane ${lane.laneId} must separate setup/index cost`);
    }
    if (card.disallowedTools.includes(lane.contextTool))
      errors.push(`lane ${lane.laneId} disallows its own context tool`);
    if (lane.laneId !== 'raw-native' && card.contextTools.length !== 1)
      errors.push(`lane ${lane.laneId} must expose one context tool`);
    if (lane.laneId !== 'raw-native' && card.allowedTools.length !== 1)
      errors.push(`lane ${lane.laneId} must allow only its context tool`);
    if (lane.phase36Status === 'deferred_to_phase39' && card.executableInPhase38) {
      errors.push(`lane ${lane.laneId} must remain pending Phase 39`);
    }
  }
  for (const status of fixtures.protocol.failureTaxonomy) {
    if (!fixtures.protocol.runManifestSchema.terminalStatuses.includes(status)) {
      errors.push(`failure status ${status} missing from terminal statuses`);
    }
  }
  if (errors.length > 0) throw new Error(`fixture validation failed:\n- ${errors.join('\n- ')}`);
  validateLaneSetupEvidence(fixtures);
  return fixtures;
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function isPathInside(parentPath, candidatePath) {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function buildTrajectory(task, answer) {
  const spans = {};
  const files = new Set();
  for (const evidence of answer.evidence) {
    const file = normalizePath(evidence.file);
    files.add(file);
    spans[file] = [
      ...(spans[file] ?? []),
      { start: evidence.lineRange.start, end: evidence.lineRange.end, full_file: false }
    ];
  }
  for (const fileRef of answer.filesReferenced) {
    const file = normalizePath(fileRef);
    files.add(file);
    if (!spans[file]) spans[file] = [{ start: 1, end: null, full_file: true }];
  }
  const predFiles = [...files].sort();
  return {
    instance_id: task.instance_id,
    repo_url: task.repo_url,
    commit: task.base_commit,
    traj_data: {
      pred_steps: [{ files: predFiles, spans }],
      pred_files: predFiles,
      pred_spans: spans
    },
    model_patch: ''
  };
}

function baselineSessionPhase(sessionRoot) {
  const resolved = resolve(sessionRoot);
  const normalized = normalizePath(resolved);
  const match = normalized.match(/\/benchmark-runs\/contextbench\/phase(40|41)\//);
  if (!match) {
    throw new Error(
      'Phase 40/41 baseline artifacts must be written under benchmark-runs/contextbench/phase40/<session_id> or benchmark-runs/contextbench/phase41/<session_id>'
    );
  }
  if (normalized.includes('/outputs/')) {
    throw new Error('Phase 40/41 baseline artifacts must not be written under outputs/');
  }
  return Number(match[1]);
}

function ensureBaselineSessionRoot(sessionRoot) {
  const resolved = resolve(sessionRoot);
  baselineSessionPhase(resolved);
  return resolved;
}

function commandLabel(command, args = []) {
  return [command, ...args].join(' ');
}

function safeExec(command, args = []) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    return stderr.trim() || 'unavailable';
  }
}

function captureCommand(command, args, cwd, logsDir, label) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', input: '' });
  const durationMs = Date.now() - startedAt;
  const stdoutPath = join(logsDir, `${label}.stdout.log`);
  const stderrPath = join(logsDir, `${label}.stderr.log`);
  writeTextArtifact(stdoutPath, result.stdout ?? '');
  writeTextArtifact(stderrPath, result.stderr ?? '');
  return {
    command: commandLabel(command, args),
    cwd,
    exitCode: typeof result.status === 'number' ? result.status : null,
    durationMs,
    stdoutPath,
    stderrPath,
    outputHash: sha256(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  };
}

function fixtureHashes() {
  return Object.fromEntries(
    Object.entries(FIXTURES)
      .filter(([, filePath]) => existsSync(filePath))
      .map(([name, filePath]) => [name, hashFile(filePath)])
  );
}

function redactedEnvVarNames() {
  return Object.keys(process.env)
    .filter((name) => /TOKEN|KEY|SECRET|PASSWORD|AUTH|OPENAI|ANTHROPIC|CLAUDE/i.test(name))
    .sort();
}

function versionSnapshot() {
  return {
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    shell: process.env.SHELL ?? process.env.ComSpec ?? 'unknown',
    node: process.version,
    npm: safeExec('npm', ['--version']),
    pnpm: safeExec('pnpm', ['--version']),
    git: safeExec('git', ['--version']),
    python: safeExec('python', ['--version']),
    uv: safeExec('uv', ['--version']),
    claude: safeExec('claude', ['--version'])
  };
}

function listFilesRecursive(rootDir) {
  if (!existsSync(rootDir)) return [];
  const entries = [];
  for (const name of readdirSync(rootDir)) {
    const filePath = join(rootDir, name);
    const stats = statSync(filePath);
    if (stats.isDirectory()) entries.push(...listFilesRecursive(filePath));
    else entries.push(filePath);
  }
  return entries;
}

function shouldExcludeUntracked(filePath, bytes) {
  const normalized = normalizePath(filePath);
  if (normalized.startsWith('benchmark-runs/')) return 'generated_phase40_or_benchmark_output';
  if (normalized.startsWith('outputs/')) return 'generated_output_path';
  if (normalized.startsWith('node_modules/') || normalized.includes('/node_modules/'))
    return 'dependency_cache';
  if (normalized.startsWith('.pnpm-store/') || normalized.includes('/.pnpm-store/'))
    return 'dependency_cache';
  if (normalized.startsWith('.git/') || normalized.includes('/.git/')) return 'git_internal';
  if (normalized.startsWith('.playwright-mcp/') || normalized.includes('/.playwright-mcp/'))
    return 'tool_cache';
  if (bytes > 256 * 1024) return 'large_untracked_file';
  return null;
}

function parseUntrackedFromStatus(statusText) {
  return statusText
    .split('\n')
    .filter((line) => line.startsWith('? '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function captureUntrackedEntries(statusText, repoRoot) {
  return parseUntrackedFromStatus(statusText).map((filePath) => {
    const absolutePath = resolve(repoRoot, filePath);
    if (!existsSync(absolutePath)) {
      return {
        path: normalizePath(filePath),
        bytes: null,
        mtimeMs: null,
        hash: null,
        disposition: 'excluded',
        exclusionReason: 'missing_at_snapshot_time'
      };
    }
    const stats = statSync(absolutePath);
    if (!stats.isFile()) {
      return {
        path: normalizePath(filePath),
        bytes: stats.size,
        mtimeMs: stats.mtimeMs,
        hash: null,
        disposition: 'excluded',
        exclusionReason: 'not_regular_file'
      };
    }
    const exclusionReason = shouldExcludeUntracked(filePath, stats.size);
    if (exclusionReason) {
      return {
        path: normalizePath(filePath),
        bytes: stats.size,
        mtimeMs: stats.mtimeMs,
        hash: null,
        disposition: 'excluded',
        exclusionReason
      };
    }
    return {
      path: normalizePath(filePath),
      bytes: stats.size,
      mtimeMs: stats.mtimeMs,
      hash: hashFile(absolutePath),
      disposition: 'hashed',
      exclusionReason: null
    };
  });
}

function lockfileArtifacts(repoRoot, sessionRoot) {
  const lockfiles = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'];
  return lockfiles
    .map((name) => resolve(repoRoot, name))
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => ({
      path: normalizePath(relative(sessionRoot, filePath)),
      hash: hashFile(filePath),
      bytes: statSync(filePath).size
    }));
}

function runGitCapture(args, repoRoot, logsDir, label) {
  const captured = captureCommand('git', args, repoRoot, logsDir, label);
  const stdout = readFileSync(captured.stdoutPath, 'utf8');
  return { ...captured, stdout };
}

function createReservations(fixtures) {
  const repeats =
    fixtures.protocol.runPolicy?.claimBearingRunsPerTaskLane ??
    fixtures.protocol.thresholds?.claimBearingRunsPerTaskLane ??
    3;
  const evidenceByLane = new Map(
    fixtures.laneSetupEvidence.records.map((record) => [record.laneId, record])
  );
  const reservations = [];
  for (const task of fixtures.manifest.tasks) {
    for (const laneId of fixtures.lanes.broadClaimLaneSet) {
      const evidence = evidenceByLane.get(laneId);
      const blocked = evidence && BLOCKED_LANE_SETUP_STATUSES.has(evidence.readinessStatus);
      for (let repeatIndex = 1; repeatIndex <= repeats; repeatIndex += 1) {
        reservations.push({
          laneId,
          taskId: task.instance_id,
          repeatIndex,
          status: blocked ? 'terminal_missing_evidence' : 'reserved',
          terminalStatus: blocked ? 'setup_failed' : null,
          reason: blocked ? evidence.readinessStatus : null
        });
      }
    }
  }
  return reservations;
}

function buildRunPaths(sessionRoot, runId) {
  const runDir = join(sessionRoot, 'runs', runId);
  return {
    runDir,
    prompt: join(runDir, 'prompt.txt'),
    laneCard: join(runDir, 'lane-card.json'),
    setupIndex: join(runDir, 'setup-index.json'),
    rawTrace: join(runDir, 'raw-trace.json'),
    structuredAnswer: join(runDir, 'structured-answer.json'),
    trajectory: join(runDir, 'trajectory.json'),
    score: join(runDir, 'score.json'),
    manifest: join(sessionRoot, 'run-manifest.jsonl')
  };
}

function buildSetupIndexMeasurementPaths(sessionRoot, laneId) {
  const root = join(sessionRoot, 'setup-index', laneId);
  const logs = join(root, 'logs');
  return {
    root,
    logs,
    artifact: join(root, 'setup-index.json'),
    setupStdout: join(logs, 'setup.stdout.log'),
    setupStderr: join(logs, 'setup.stderr.log'),
    indexStdout: join(logs, 'index.stdout.log'),
    indexStderr: join(logs, 'index.stderr.log')
  };
}

function artifactHashesForPaths(paths) {
  return {
    prompt: hashFile(paths.prompt),
    laneToolCard: hashFile(paths.laneCard),
    setupIndex: hashFile(paths.setupIndex),
    rawTrace: hashFile(paths.rawTrace),
    structuredAnswer: hashFile(paths.structuredAnswer),
    trajectory: hashFile(paths.trajectory),
    score: hashFile(paths.score),
    runnerSourceHash: runnerSourceHash()
  };
}

function optionalHashFile(filePath) {
  return existsSync(filePath) ? hashFile(filePath) : null;
}

function commandEvidenceForKind(record, kind) {
  return (record?.commands ?? []).find((command) => command.kind === kind) ?? null;
}

function outputHashForLogs(stdoutPath, stderrPath) {
  return sha256(`${readFileSync(stdoutPath, 'utf8')}\n${readFileSync(stderrPath, 'utf8')}`);
}

function normalizeMeasurementLogPath(sessionRoot, filePath) {
  if (!filePath) return null;
  return isAbsolute(filePath) ? filePath : join(sessionRoot, filePath);
}

function validateMeasuredSetupIndex(sessionRoot, laneCard, measurement) {
  const errors = [];
  if (!measurement || typeof measurement !== 'object') errors.push('measurement must be an object');
  if (measurement?.laneId !== laneCard.laneId) errors.push('measurement laneId mismatch');
  if (measurement?.claimBearing !== false) errors.push('measurement must be non-claim-bearing');
  const setupStatus = measurement?.setupStatus;
  const indexStatus = measurement?.indexStatus;
  if (!['completed', 'not_required', 'setup_failed'].includes(setupStatus))
    errors.push('invalid setupStatus');
  if (!['completed', 'not_required', 'index_failed'].includes(indexStatus))
    errors.push('invalid indexStatus');
  for (const [field, status] of [
    ['setupDurationMs', setupStatus],
    ['indexDurationMs', indexStatus]
  ]) {
    const duration = measurement?.[field];
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
      errors.push(`${field} must be a finite non-negative number`);
    }
    if (status === 'completed' && duration <= 0) errors.push(`${field} must be positive when completed`);
  }
  for (const field of ['setupLogPath', 'indexLogPath']) {
    const logPath = normalizeMeasurementLogPath(sessionRoot, measurement?.[field]);
    if (!logPath) {
      errors.push(`${field} missing`);
      continue;
    }
    if (!isPathInside(sessionRoot, logPath)) {
      errors.push(`${field} must stay inside session root`);
    } else if (!existsSync(logPath)) {
      errors.push(`${field} missing artifact`);
    }
  }
  return errors;
}

function rowSetupIndexFromMeasurement(measurement) {
  return {
    setupCommand: measurement.setupCommand,
    indexCommand: measurement.indexCommand,
    setupDurationMs: measurement.setupDurationMs,
    indexDurationMs: measurement.indexDurationMs,
    setupLogPath: measurement.setupLogPath,
    indexLogPath: measurement.indexLogPath,
    setupStatus: measurement.setupStatus,
    indexStatus: measurement.indexStatus
  };
}

function readMeasuredSetupIndex(sessionRoot, laneCard) {
  const paths = buildSetupIndexMeasurementPaths(sessionRoot, laneCard.laneId);
  if (!existsSync(paths.artifact)) return null;
  const measurement = readJson(paths.artifact);
  const errors = validateMeasuredSetupIndex(sessionRoot, laneCard, measurement);
  if (errors.length > 0) throw new Error(`setup/index measurement invalid for ${laneCard.laneId}:\n- ${errors.join('\n- ')}`);
  return rowSetupIndexFromMeasurement(measurement);
}

function defaultRawNativeSetupIndex(sessionRoot, laneCard) {
  const paths = buildSetupIndexMeasurementPaths(sessionRoot, laneCard.laneId);
  mkdirSync(paths.logs, { recursive: true });
  writeTextArtifact(paths.setupStdout, 'raw-native setup not required\n');
  writeTextArtifact(paths.setupStderr, '');
  writeTextArtifact(paths.indexStdout, 'raw-native index not required\n');
  writeTextArtifact(paths.indexStderr, '');
  return {
    laneId: laneCard.laneId,
    claimBearing: false,
    measuredAt: new Date().toISOString(),
    measurementMode: 'not_required',
    setupCommand: laneCard.setupCommand,
    indexCommand: laneCard.indexCommand,
    setupDurationMs: 0,
    indexDurationMs: 0,
    setupLogPath: paths.setupStdout,
    indexLogPath: paths.indexStdout,
    setupStatus: 'not_required',
    indexStatus: 'not_required',
    commands: [
      {
        kind: 'setup',
        command: laneCard.setupCommand,
        executed: false,
        exitCode: 0,
        durationMs: 0,
        stdoutLogPath: paths.setupStdout,
        stderrLogPath: paths.setupStderr,
        outputHash: outputHashForLogs(paths.setupStdout, paths.setupStderr)
      },
      {
        kind: 'index',
        command: laneCard.indexCommand,
        executed: false,
        exitCode: 0,
        durationMs: 0,
        stdoutLogPath: paths.indexStdout,
        stderrLogPath: paths.indexStderr,
        outputHash: outputHashForLogs(paths.indexStdout, paths.indexStderr)
      }
    ]
  };
}

function laneTelemetryOverrides() {
  const raw = process.env.CONTEXTBENCH_LANE_TELEMETRY_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('CONTEXTBENCH_LANE_TELEMETRY_JSON must be a JSON object');
  }
}

function buildLaneIsolationEvidence(laneCard) {
  const telemetry = laneTelemetryOverrides()[laneCard.laneId];
  const observedTools = Array.isArray(telemetry?.observedTools)
    ? telemetry.observedTools.filter((tool) => typeof tool === 'string')
    : [];
  const disallowedObserved = observedTools.filter((tool) => laneCard.disallowedTools.includes(tool));
  const unknownObserved = observedTools.filter((tool) => !laneCard.allowedTools.includes(tool));
  const expectedContextTool = laneCard.contextTools[0] ?? laneCard.laneId;
  const rawNative = laneCard.laneId === 'raw-native';
  const expectedObserved = rawNative
    ? observedTools.length > 0 && unknownObserved.length === 0
    : observedTools.length === 1 && observedTools[0] === expectedContextTool;
  const violations = [...disallowedObserved, ...unknownObserved].map((tool) => `unexpected_tool_${tool}`);
  const proven = Boolean(telemetry?.proofSource) && expectedObserved && violations.length === 0;
  return {
    laneId: laneCard.laneId,
    proven,
    sourceKind: telemetry?.proofSource ? 'env_override' : 'not_captured',
    proofSource: typeof telemetry?.proofSource === 'string' ? telemetry.proofSource : 'not_captured',
    expectedContextTool,
    allowedTools: laneCard.allowedTools,
    disallowedTools: laneCard.disallowedTools,
    observedTools,
    violations
  };
}

function runOfficialEvaluatorForAttempt(fixtures, paths, task, executor, status) {
  if (executor === 'fake') {
    return {
      status,
      mode: 'diagnostic_fallback',
      ...diagnosticFallbackScoring(fixtures, 'fake_executor_smoke_only')
    };
  }
  if (status !== 'completed') {
    return {
      status,
      mode: 'diagnostic_fallback',
      ...diagnosticFallbackScoring(fixtures, 'agent_attempt_not_completed')
    };
  }
  if (executorCommandIsOverridden(executor) && !process.env.CONTEXTBENCH_OFFICIAL_EVALUATOR_COMMAND) {
    return {
      status,
      mode: 'diagnostic_fallback',
      ...diagnosticFallbackScoring(fixtures, 'overridden_executor_smoke_no_official_evaluator')
    };
  }

  const officialGoldPath = join(paths.runDir, 'official-gold-input.json');
  const officialOutputPath = join(paths.runDir, 'official-results.jsonl');
  const stdoutPath = join(paths.runDir, 'official-evaluator.stdout.log');
  const stderrPath = join(paths.runDir, 'official-evaluator.stderr.log');
  writeJson(officialGoldPath, {
    instance_id: task.instance_id,
    gold_context_ref: task.gold_context_ref,
    gold_context_hash: task.gold_context_hash,
    hash_canonicalization_version: task.hash_canonicalization_version
  });

  const evaluator = officialEvaluatorCommandParts();
  const evaluatorArgs = [
    ...evaluator.prefixArgs,
    '--gold',
    officialGoldPath,
    '--pred',
    paths.trajectory,
    '--out',
    officialOutputPath
  ];
  const result = spawnSync(evaluator.command, evaluatorArgs, {
    encoding: 'utf8',
    cwd: paths.runDir,
    timeout: fixtures.protocol.budgets.defaults.timeoutSeconds * 1000
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  writeTextArtifact(stdoutPath, stdout);
  writeTextArtifact(stderrPath, stderr);
  const exitStatus = typeof result.status === 'number' ? result.status : null;
  const command = `${evaluator.command} ${evaluatorArgs.join(' ')}`;
  const outputValidation = validateOfficialEvaluatorOutputEnvelope(officialOutputPath, task);
  if (exitStatus === 0 && outputValidation.valid) {
    return {
      status: 'completed',
      mode: 'official_evaluator',
      officialEvaluatorFirst: true,
      officialEvaluatorAttempted: true,
      officialEvaluatorInvoked: true,
      command,
      claimBearing: fixtures.protocol.claimAllowed === true,
      stdoutPath,
      stderrPath,
      outputPath: officialOutputPath,
      outputHash: hashFile(officialOutputPath),
      stdoutHash: hashFile(stdoutPath),
      stderrHash: hashFile(stderrPath),
      exitCode: exitStatus,
      exitStatus
    };
  }
  return {
    status: 'judge_failed',
    mode: 'diagnostic_fallback',
    officialEvaluatorFirst: true,
    officialEvaluatorAttempted: true,
    officialEvaluatorInvoked: true,
    command,
    claimBearing: false,
    fallbackReason: outputValidation.reason ?? 'official_evaluator_failed',
    stdoutPath,
    stderrPath,
    outputPath: officialOutputPath,
    outputHash: optionalHashFile(officialOutputPath),
    stdoutHash: hashFile(stdoutPath),
    stderrHash: hashFile(stderrPath),
    exitCode: exitStatus,
    exitStatus,
    spawnError: result.error?.message ?? null
  };
}

function validateOfficialEvaluatorOutputEnvelope(outputPath, task) {
  if (!existsSync(outputPath)) return { valid: false, reason: 'official_evaluator_missing_output' };
  const content = readFileSync(outputPath, 'utf8');
  if (!content.trim()) return { valid: false, reason: 'official_evaluator_empty_output' };
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const expectedTaskIds = new Set([task.instance_id, task.original_inst_id].filter(Boolean));
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { valid: false, reason: 'official_evaluator_malformed_jsonl' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, reason: 'official_evaluator_non_object_jsonl' };
    }
    const declaredTaskId = parsed.instance_id ?? parsed.task_id ?? parsed.taskId ?? parsed.id;
    if (typeof declaredTaskId === 'string' && expectedTaskIds.size > 0 && !expectedTaskIds.has(declaredTaskId)) {
      return { valid: false, reason: 'official_evaluator_task_mismatch' };
    }
  }
  return { valid: true, reason: null };
}

function appendRunManifestRow(sessionRoot, row) {
  appendFileSync(join(sessionRoot, 'run-manifest.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
}

function buildManifestRowForArtifacts(params) {
  return {
    run_id: params.runId,
    protocol_version: params.fixtures.protocol.protocolVersion,
    protocol_hash: hashObject(params.fixtures.protocol),
    task_manifest_hash: params.fixtures.manifest.manifest_hash,
    lane_id: params.laneCard.laneId,
    task_id: params.task.instance_id,
    repeat_index: params.repeatIndex,
    status: params.status,
    started_at: params.startedAt,
    completed_at: params.completedAt,
    raw_trace_path: params.paths.rawTrace,
    structured_answer_path: params.paths.structuredAnswer,
    trajectory_path: params.paths.trajectory,
    score_path: params.paths.score,
    setup_index_path: params.paths.setupIndex,
    prompt_path: params.paths.prompt,
    lane_tool_card_path: params.paths.laneCard,
    setupIndex: params.setupIndex,
    taskExecution: {
      model: params.model,
      timeoutSeconds: params.fixtures.protocol.budgets.defaults.timeoutSeconds,
      maxContextTokens: params.fixtures.protocol.budgets.defaults.maxContextTokens,
      maxAnswerTokens: params.fixtures.protocol.budgets.defaults.maxAnswerTokens,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
      taskWallTimeMs: new Date(params.completedAt).getTime() - new Date(params.startedAt).getTime(),
      executor: params.executor
    },
    scoring: params.scoring,
    hashes: artifactHashesForPaths(params.paths)
  };
}

function writeBlockedRunRows(sessionRoot, fixtures, reservations) {
  const cardsByLane = new Map(fixtures.laneToolCards.cards.map((card) => [card.laneId, card]));
  const evidenceByLane = new Map(
    fixtures.laneSetupEvidence.records.map((record) => [record.laneId, record])
  );
  const tasksById = new Map(fixtures.manifest.tasks.map((task) => [task.instance_id, task]));
  for (const reservation of reservations.filter(
    (slot) => slot.status === 'terminal_missing_evidence'
  )) {
    const laneCard = cardsByLane.get(reservation.laneId);
    const task = tasksById.get(reservation.taskId);
    const evidence = evidenceByLane.get(reservation.laneId);
    if (!laneCard || !task || !evidence) continue;
    const runId = sanitize(
      `${laneCard.laneId}-${task.instance_id}-${reservation.repeatIndex}-missing-evidence`
    );
    const paths = buildRunPaths(sessionRoot, runId);
    const startedAt = new Date().toISOString();
    const completedAt = startedAt;
    const setupIndex = {
      setupCommand: laneCard.setupCommand,
      indexCommand: laneCard.indexCommand,
      setupDurationMs: evidence.setupDurationMs ?? 0,
      indexDurationMs: evidence.indexDurationMs ?? 0,
      setupLogPath: evidence.logReference ?? paths.setupIndex,
      indexLogPath: evidence.logReference ?? paths.setupIndex,
      setupStatus: 'setup_failed',
      indexStatus: evidence.readinessStatus === 'index_failed' ? 'index_failed' : 'not_required'
    };
    const prompt = `Terminal missing evidence for ${task.instance_id} in ${laneCard.laneId}; no agent task prompt executed.`;
    writeTextArtifact(paths.prompt, prompt);
    writeJson(paths.laneCard, laneCard);
    writeJson(paths.setupIndex, { ...setupIndex, evidence });
    writeJson(paths.rawTrace, {
      executor: 'none',
      runnerHash: runnerSourceHash(),
      claimBearing: false,
      status: 'setup_failed',
      laneReadinessStatus: evidence.readinessStatus,
      reason: reservation.reason,
      laneIsolation: buildLaneIsolationEvidence(laneCard),
      scriptedAgentDecisions: false
    });
    writeJson(paths.structuredAnswer, {
      status: 'not_attempted_missing_evidence',
      claimBearing: false
    });
    writeJson(paths.trajectory, { status: 'not_attempted_missing_evidence', pred_files: [] });
    writeJson(paths.score, {
      status: 'setup_failed',
      mode: 'missing_evidence',
      claimBearing: false,
      reason: reservation.reason
    });
    appendRunManifestRow(
      sessionRoot,
      buildManifestRowForArtifacts({
        runId,
        fixtures,
        laneCard,
        task,
        repeatIndex: reservation.repeatIndex,
        status: 'setup_failed',
        startedAt,
        completedAt,
        paths,
        setupIndex,
        executor: 'fake',
        model: 'not-run-missing-evidence',
        scoring: diagnosticFallbackScoring(
          fixtures,
          `terminal_missing_evidence:${reservation.reason}`
        )
      })
    );
  }
}

function computeSessionHash(session) {
  return hashObject({ ...session, sessionHash: '' });
}

function writeSession(sessionRoot, session) {
  const nextSession = { ...session, updatedAt: new Date().toISOString() };
  nextSession.sessionHash = computeSessionHash(nextSession);
  writeJson(join(sessionRoot, 'BASELINE-SESSION.json'), nextSession);
  return nextSession;
}

function readSession(sessionRoot) {
  return readJson(join(sessionRoot, 'BASELINE-SESSION.json'));
}

function refreshArtifactIndex(sessionRoot) {
  return listFilesRecursive(sessionRoot)
    .filter((filePath) => !filePath.endsWith('BASELINE-SESSION.json'))
    .map((filePath) => artifactEntry(filePath, sessionRoot))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function createBaselineSnapshot(args) {
  if (!args.out) throw new Error('--baseline-snapshot requires --out <session-root>');
  const fixtures = validateFixtures();
  const repoRoot = process.cwd();
  const sessionRoot = ensureBaselineSessionRoot(args.out);
  const phase = baselineSessionPhase(sessionRoot);
  const sessionId = sessionRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? 'phase40-session';
  const snapshotDir = join(sessionRoot, 'snapshot');
  const gitDir = join(snapshotDir, 'git');
  const logsDir = join(snapshotDir, 'commands');
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const status = runGitCapture(
    ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
    repoRoot,
    logsDir,
    'git-status'
  );
  const trackedDiff = runGitCapture(['diff', '--no-ext-diff'], repoRoot, logsDir, 'git-diff');
  const stagedDiff = runGitCapture(
    ['diff', '--cached', '--no-ext-diff'],
    repoRoot,
    logsDir,
    'git-diff-staged'
  );
  const diffStat = runGitCapture(['diff', '--stat'], repoRoot, logsDir, 'git-diff-stat');
  const statusPath = join(gitDir, 'status-porcelain-v2.txt');
  const trackedDiffPath = join(gitDir, 'tracked.diff');
  const stagedDiffPath = join(gitDir, 'staged.diff');
  const diffStatPath = join(gitDir, 'diff-stat.txt');
  writeTextArtifact(statusPath, status.stdout);
  writeTextArtifact(trackedDiffPath, trackedDiff.stdout);
  writeTextArtifact(stagedDiffPath, stagedDiff.stdout);
  writeTextArtifact(diffStatPath, diffStat.stdout);

  const reservations = createReservations(fixtures);
  const reservationsPath = join(sessionRoot, 'slot-reservations.json');
  writeJson(reservationsPath, { claimBearing: false, reservations });
  writeBlockedRunRows(sessionRoot, fixtures, reservations);

  const snapshotWithoutHash = {
    branch: safeExec('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    head: safeExec('git', ['rev-parse', 'HEAD']),
    divergence: {
      status: 'unavailable',
      reason:
        'Phase 40 plan records main as unavailable locally; divergence is captured as unavailable instead of inferred.'
    },
    gitStatusPath: normalizePath(relative(sessionRoot, statusPath)),
    trackedDiffPath: normalizePath(relative(sessionRoot, trackedDiffPath)),
    stagedDiffPath: normalizePath(relative(sessionRoot, stagedDiffPath)),
    diffStatPath: normalizePath(relative(sessionRoot, diffStatPath)),
    untracked: captureUntrackedEntries(status.stdout, repoRoot),
    lockfiles: lockfileArtifacts(repoRoot, sessionRoot),
    redactedEnvVarNames: redactedEnvVarNames(),
    versions: versionSnapshot(),
    fixtureHashes: fixtureHashes(),
    commandTranscript: [status, trackedDiff, stagedDiff, diffStat].map((entry) => ({
      command: entry.command,
      cwd: entry.cwd,
      exitCode: entry.exitCode,
      stdoutPath: normalizePath(relative(sessionRoot, entry.stdoutPath)),
      stderrPath: normalizePath(relative(sessionRoot, entry.stderrPath)),
      outputHash: entry.outputHash
    }))
  };
  const snapshot = { ...snapshotWithoutHash, snapshotHash: hashObject(snapshotWithoutHash) };
  let session = {
    sessionId,
    phase,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionRoot: normalizePath(sessionRoot),
    claimBearing: false,
    sealed: false,
    snapshot,
    reservationsPath: normalizePath(relative(sessionRoot, reservationsPath)),
    runManifestPath: 'run-manifest.jsonl',
    artifactIndex: [],
    sessionHash: ''
  };
  session.artifactIndex = refreshArtifactIndex(sessionRoot);
  session = writeSession(sessionRoot, session);
  console.log(`baseline snapshot wrote ${join(sessionRoot, 'BASELINE-SESSION.json')}`);
}

function validateBaselineArms(filePath) {
  if (!filePath) throw new Error('--baseline-validate-arms requires a fixture path');
  const fixture = readJson(filePath);
  const errors = [];
  if (fixture.phase !== 40) errors.push('baseline arms fixture must be Phase 40 metadata');
  if (fixture.claimBearing !== false) errors.push('baseline arms must be non-claim-bearing');
  if (!String(fixture.denominatorPolicy ?? '').includes('separate')) {
    errors.push('baseline arms must stay separate from required competitor denominators');
  }
  const seen = new Set();
  for (const arm of fixture.arms ?? []) {
    if (!arm.baselineArmId || seen.has(arm.baselineArmId))
      errors.push(`invalid duplicate baseline arm ${arm.baselineArmId}`);
    seen.add(arm.baselineArmId);
    if (arm.laneId !== 'codebase-context')
      errors.push(`arm ${arm.baselineArmId} must stay under codebase-context`);
    if (arm.claimBearing !== false)
      errors.push(`arm ${arm.baselineArmId} must be non-claim-bearing`);
    if (!Array.isArray(arm.allowedToolSurfaces) || arm.allowedToolSurfaces.length === 0) {
      errors.push(`arm ${arm.baselineArmId} needs existing tool surfaces`);
    }
    if (arm.failurePolicy !== 'record_terminal_diagnostic_failure') {
      errors.push(`arm ${arm.baselineArmId} must record failures instead of patching products`);
    }
  }
  if (errors.length > 0)
    throw new Error(`baseline arm validation failed:\n- ${errors.join('\n- ')}`);
  console.log('baseline arm validation passed');
}

function runSetupIndexMeasure(args) {
  if (!args.session) throw new Error('--setup-index-measure requires --session <session-root>');
  const sessionRoot = ensureBaselineSessionRoot(args.session);
  if (!existsSync(join(sessionRoot, 'BASELINE-SESSION.json')))
    throw new Error('baseline session snapshot missing');
  const fixtures = validateFixtures();
  const cardsByLane = new Map(fixtures.laneToolCards.cards.map((card) => [card.laneId, card]));
  const lanes = args.allReadyLanes ? fixtures.lanes.broadClaimLaneSet : [args.lane];
  let measured = 0;
  for (const laneId of lanes) {
    const laneCard = cardsByLane.get(laneId);
    if (!laneCard) throw new Error(`unknown lane: ${laneId}`);
    if (laneCard.laneId !== 'raw-native') {
      if (args.allReadyLanes) continue;
      throw new Error(
        `setup/index measurement for ${laneCard.laneId} requires --setup-index-import until safe isolated command execution is implemented`
      );
    }
    const paths = buildSetupIndexMeasurementPaths(sessionRoot, laneCard.laneId);
    const measurement = defaultRawNativeSetupIndex(sessionRoot, laneCard);
    writeJson(paths.artifact, measurement);
    measured += 1;
  }
  const session = readSession(sessionRoot);
  session.artifactIndex = refreshArtifactIndex(sessionRoot);
  writeSession(sessionRoot, session);
  console.log(`setup/index measurement wrote ${measured} lane artifact(s)`);
}

function runSetupIndexImport(args) {
  if (!args.session || !args.lane || !args.input)
    throw new Error('--setup-index-import requires --session, --lane, and --input');
  const sessionRoot = ensureBaselineSessionRoot(args.session);
  if (!existsSync(join(sessionRoot, 'BASELINE-SESSION.json')))
    throw new Error('baseline session snapshot missing');
  const fixtures = validateFixtures();
  const laneCard = fixtures.laneToolCards.cards.find((card) => card.laneId === args.lane);
  if (!laneCard) throw new Error(`unknown lane: ${args.lane}`);
  const inputPath = isAbsolute(args.input) ? args.input : resolve(process.cwd(), args.input);
  const imported = readJson(inputPath);
  if (imported.laneId !== laneCard.laneId)
    throw new Error(`setup/index import laneId mismatch: expected ${laneCard.laneId}`);
  if (imported.claimBearing !== false)
    throw new Error('setup/index import must be non-claim-bearing');
  const measurement = {
    ...imported,
    setupCommand: imported.setupCommand ?? laneCard.setupCommand,
    indexCommand: imported.indexCommand ?? laneCard.indexCommand,
    setupLogPath: normalizeMeasurementLogPath(sessionRoot, imported.setupLogPath),
    indexLogPath: normalizeMeasurementLogPath(sessionRoot, imported.indexLogPath),
    importedFrom: normalizePath(inputPath),
    importedAt: new Date().toISOString()
  };
  const errors = validateMeasuredSetupIndex(sessionRoot, laneCard, measurement);
  if (errors.length > 0)
    throw new Error(`setup/index import invalid for ${laneCard.laneId}:\n- ${errors.join('\n- ')}`);
  const paths = buildSetupIndexMeasurementPaths(sessionRoot, laneCard.laneId);
  writeJson(paths.artifact, measurement);
  const session = readSession(sessionRoot);
  session.artifactIndex = refreshArtifactIndex(sessionRoot);
  writeSession(sessionRoot, session);
  console.log(`setup/index import wrote ${paths.artifact}`);
}

function makePrompt(task, laneCard, taskContext = null) {
  const lines = [
    `ContextBench task: ${task.instance_id}`,
    `Repository: ${task.repo_url}`,
    `Base commit: ${task.base_commit}`,
    taskContext?.problemStatement
      ? `Problem statement hash: ${task.problem_statement_hash}`
      : `Problem statement reference: ${task.problem_statement_ref}`,
    `Gold context reference is hidden from the solver; do not infer from fixture answers.`,
    `Lane: ${laneCard.laneId}`,
    `Allowed context tools: ${laneCard.allowedTools.join(', ')}`,
    `Disallowed context tools: ${laneCard.disallowedTools.join(', ')}`,
    'Return only JSON with fields: answer, confidence, evidence, filesReferenced, symbolsReferenced, unsupportedClaims, readyToEdit.',
    'Do not use tools outside the lane card. Do not fabricate files or line spans.'
  ];
  if (taskContext?.repoCheckoutPath) {
    lines.splice(3, 0, `Local checkout: ${taskContext.repoCheckoutPath}`);
  }
  if (taskContext?.problemStatement) {
    lines.push('', 'Problem statement:', taskContext.problemStatement);
  }
  return lines.join('\n');
}

function parseAnswerForBaseline(stdout) {
  const trimmed = String(stdout ?? '').trim();
  if (!trimmed) return { answer: null, errors: ['missing_json'] };
  try {
    const parsed = JSON.parse(trimmed);
    return validateStructuredAnswerObject(parsed);
  } catch {
    return { answer: null, errors: ['invalid_json'] };
  }
}

function classifyClaudeCliDiagnostic(stdout, stderr) {
  const text = `${stdout ?? ''}\n${stderr ?? ''}`.toLowerCase();
  if (text.includes("you've hit your limit") || text.includes('rate limit'))
    return 'claude_rate_limit';
  if (text.includes('not authenticated') || text.includes('please run') || text.includes('login')) {
    return 'claude_auth_required';
  }
  return null;
}

function parseClaudeAnswerForBaseline(stdout, stderr) {
  const trimmed = String(stdout ?? '').trim();
  const diagnostic = classifyClaudeCliDiagnostic(stdout, stderr);
  if (!trimmed) {
    return {
      answer: null,
      errors: diagnostic ? ['missing_json', diagnostic] : ['missing_json'],
      toolError: diagnostic !== null
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      answer: null,
      errors: diagnostic ? ['invalid_json', diagnostic] : ['invalid_json'],
      toolError: diagnostic !== null
    };
  }

  if (!isRecord(parsed) || parsed.type !== 'result') {
    return { ...validateStructuredAnswerObject(parsed), toolError: false };
  }

  if (parsed.is_error === true) {
    return {
      answer: null,
      errors: [`claude_error_${parsed.api_error_status ?? 'unknown'}`],
      toolError: true
    };
  }

  if (parsed.subtype === 'error_max_structured_output_retries') {
    return { answer: null, errors: ['error_max_structured_output_retries'], toolError: false };
  }

  if ('structured_output' in parsed) {
    return { ...validateStructuredAnswerObject(parsed.structured_output), toolError: false };
  }

  if (typeof parsed.result === 'string') {
    return { ...parseAnswerForBaseline(parsed.result), toolError: false };
  }

  return { answer: null, errors: ['missing_structured_output'], toolError: false };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function findAdditionalFields(value, allowedFields, prefix) {
  return Object.keys(value)
    .filter((field) => !allowedFields.includes(field))
    .map((field) => `additional_${prefix}_${field}`);
}

function isJsonValue(value) {
  if (value === null) return true;
  if (['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isValidEvidenceReference(value) {
  if (!isRecord(value)) return false;
  if (findAdditionalFields(value, EVIDENCE_REFERENCE_FIELDS, 'evidence_field').length > 0)
    return false;
  if (!isRecord(value.lineRange)) return false;
  if (findAdditionalFields(value.lineRange, LINE_RANGE_FIELDS, 'line_range_field').length > 0)
    return false;
  const { start, end } = value.lineRange;
  return (
    typeof value.file === 'string' &&
    value.file.trim().length > 0 &&
    typeof value.reason === 'string' &&
    value.reason.trim().length > 0 &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start > 0 &&
    end >= start
  );
}

function validateStructuredAnswerObject(value) {
  const errors = [];
  if (!isRecord(value)) return { answer: null, errors: ['answer_root_not_object'] };
  for (const field of CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS) {
    if (!(field in value)) errors.push(`missing_${field}`);
  }
  errors.push(
    ...findAdditionalFields(
      value,
      CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS,
      'root_field'
    )
  );
  if (!isJsonValue(value.answer)) errors.push('answer_not_json_value');
  if (
    typeof value.confidence !== 'string' ||
    !['low', 'medium', 'high'].includes(value.confidence)
  ) {
    errors.push('invalid_confidence');
  }
  if (!Array.isArray(value.evidence)) errors.push('evidence_not_array');
  if (!isStringArray(value.filesReferenced)) errors.push('files_referenced_not_string_array');
  if (!isStringArray(value.symbolsReferenced)) errors.push('symbols_referenced_not_string_array');
  if (!isStringArray(value.unsupportedClaims)) errors.push('unsupported_claims_not_string_array');
  if (typeof value.readyToEdit !== 'boolean') errors.push('ready_to_edit_not_boolean');
  const evidence = Array.isArray(value.evidence) ? value.evidence : [];
  for (const entry of evidence) {
    if (!isRecord(entry)) continue;
    errors.push(...findAdditionalFields(entry, EVIDENCE_REFERENCE_FIELDS, 'evidence_field'));
    if (isRecord(entry.lineRange)) {
      errors.push(...findAdditionalFields(entry.lineRange, LINE_RANGE_FIELDS, 'line_range_field'));
    }
  }
  if (evidence.some((entry) => !isValidEvidenceReference(entry)))
    errors.push('malformed_evidence_reference');
  if (errors.length > 0) return { answer: null, errors };
  return { answer: value, errors: [] };
}

function defaultFakeAnswer(task) {
  return {
    answer: { smoke: true, taskId: task.instance_id },
    confidence: 'medium',
    evidence: [
      {
        file: 'SMOKE_ONLY.md',
        lineRange: { start: 1, end: 1 },
        reason: 'fake executor non-claim-bearing smoke evidence'
      }
    ],
    filesReferenced: ['SMOKE_ONLY.md'],
    symbolsReferenced: [],
    unsupportedClaims: [],
    readyToEdit: false
  };
}

function claudeArgsForModel(model) {
  const args = ['--print', '--output-format', 'json'];
  if (model) args.push('--model', model);
  args.push('--json-schema', JSON.stringify(CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA));
  return args;
}

function claudeCommandParts() {
  return commandPartsForExecutor('claude');
}

function commandPartsForExecutor(executor) {
  const envVars = {
    claude: 'CONTEXTBENCH_CLAUDE_COMMAND',
    codex: 'CONTEXTBENCH_CODEX_COMMAND',
    gemini: 'CONTEXTBENCH_GEMINI_COMMAND',
    opencode: 'CONTEXTBENCH_OPENCODE_COMMAND'
  };
  const defaults = {
    claude: 'claude',
    codex: 'codex',
    gemini: 'gemini',
    opencode: 'opencode'
  };
  const envVar = envVars[executor];
  if (!envVar) throw new Error(`unsupported executor: ${executor}`);
  const override = process.env[envVar];
  if (!override) return { command: defaults[executor], prefixArgs: [] };
  let parts;
  try {
    parts = JSON.parse(override);
  } catch {
    throw new Error(`${envVar} must be a JSON array`);
  }
  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    parts.some((part) => typeof part !== 'string')
  ) {
    throw new Error(`${envVar} must be a non-empty JSON string array`);
  }
  return { command: parts[0], prefixArgs: parts.slice(1) };
}

function externalExecutorInvocation(executor, model, prompt, paths) {
  const schemaPath = join(paths.runDir, 'answer-schema.json');
  const answerPath = join(paths.runDir, 'executor-answer.json');
  writeJson(schemaPath, structuredAnswerSchemaForExecutor(executor));
  if (executor === 'claude') {
    return {
      ...commandPartsForExecutor(executor),
      args: claudeArgsForModel(model),
      input: prompt,
      schemaPath,
      answerPath: null,
      schemaMode: 'native_schema',
      outputMode: 'json'
    };
  }
  if (executor === 'codex') {
    const args = [
      'exec',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--json',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      answerPath
    ];
    if (model) args.push('--model', model);
    args.push('-');
    return {
      ...commandPartsForExecutor(executor),
      args,
      input: prompt,
      schemaPath,
      answerPath,
      schemaMode: 'native_schema',
      outputMode: 'jsonl'
    };
  }
  if (executor === 'gemini') {
    const args = ['--output-format', 'json'];
    if (model) args.push('--model', model);
    args.push('--prompt', prompt);
    return {
      ...commandPartsForExecutor(executor),
      args,
      input: '',
      schemaPath,
      answerPath: null,
      schemaMode: 'prompt_only',
      outputMode: 'json'
    };
  }
  if (executor === 'opencode') {
    const args = ['run', '--format', 'json'];
    if (model) args.push('--model', model);
    args.push(prompt);
    return {
      ...commandPartsForExecutor(executor),
      args,
      input: '',
      schemaPath,
      answerPath: null,
      schemaMode: 'prompt_only',
      outputMode: 'jsonl'
    };
  }
  throw new Error(`unsupported executor: ${executor}`);
}

function structuredAnswerSchemaForExecutor(executor) {
  if (executor !== 'codex') return CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA;
  return {
    ...CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA,
    properties: {
      ...CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA.properties,
      answer: { type: 'string' }
    }
  };
}

function parseExternalAnswerForBaseline(executor, stdout, stderr, answerPath) {
  if (executor === 'claude') return parseClaudeAnswerForBaseline(stdout, stderr);
  if (executor === 'codex' && answerPath && existsSync(answerPath)) {
    const parsed = parseAnswerForBaseline(readFileSync(answerPath, 'utf8'));
    if (parsed.answer) return { ...parsed, toolError: false };
    const eventDiagnostic = classifyJsonEventDiagnostic(executor, stdout);
    if (eventDiagnostic)
      return { answer: null, errors: [...parsed.errors, eventDiagnostic], toolError: true };
    return { ...parsed, toolError: false };
  }
  const diagnostic = classifyExternalCliDiagnostic(executor, stdout, stderr);
  if (diagnostic) return { answer: null, errors: [diagnostic], toolError: true };
  if (executor === 'gemini') return parseGeminiAnswer(stdout);
  if (executor === 'opencode' || executor === 'codex') return parseJsonEventAnswer(stdout);
  return { ...parseAnswerForBaseline(stdout), toolError: false };
}

function classifyJsonEventDiagnostic(executor, stdout) {
  const lines = String(stdout ?? '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed) && (parsed.type === 'error' || parsed.error)) return `${executor}_error`;
    } catch {
      // Non-JSON lines are handled by normal structured-answer parsing.
    }
  }
  return null;
}

function classifyExternalCliDiagnostic(executor, stdout, stderr) {
  const text = `${stdout ?? ''}\n${stderr ?? ''}`.toLowerCase();
  if (
    text.includes('not authenticated') ||
    text.includes('login') ||
    text.includes('auth required')
  ) {
    return `${executor}_auth_required`;
  }
  if (text.includes('rate limit') || text.includes('quota') || text.includes('limit exceeded')) {
    return `${executor}_rate_limit`;
  }
  return null;
}

function parseGeminiAnswer(stdout) {
  const trimmed = String(stdout ?? '').trim();
  if (!trimmed) return { answer: null, errors: ['missing_json'], toolError: false };
  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed) && parsed.error)
      return { answer: null, errors: ['gemini_error'], toolError: true };
    if (isRecord(parsed) && typeof parsed.response === 'string') {
      return { ...parseAnswerForBaseline(parsed.response), toolError: false };
    }
    if (isRecord(parsed) && typeof parsed.text === 'string') {
      return { ...parseAnswerForBaseline(parsed.text), toolError: false };
    }
    return { ...validateStructuredAnswerObject(parsed), toolError: false };
  } catch {
    return { answer: null, errors: ['invalid_json'], toolError: false };
  }
}

function parseJsonEventAnswer(stdout) {
  const trimmed = String(stdout ?? '').trim();
  if (!trimmed) return { answer: null, errors: ['missing_json'], toolError: false };
  const diagnostic = classifyJsonEventDiagnostic('json_event', trimmed);
  if (diagnostic) return { answer: null, errors: [diagnostic], toolError: true };
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  for (const line of [...lines].reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed)) {
        for (const key of ['content', 'message', 'text', 'response']) {
          if (typeof parsed[key] === 'string')
            return { ...parseAnswerForBaseline(parsed[key]), toolError: false };
        }
        if (isRecord(parsed.part) && typeof parsed.part.text === 'string') {
          return { ...parseAnswerForBaseline(parsed.part.text), toolError: false };
        }
        const direct = validateStructuredAnswerObject(parsed);
        if (direct.answer) return { ...direct, toolError: false };
      }
    } catch {
      // Continue scanning earlier JSONL events before declaring the stream invalid.
    }
  }
  return parseAnswerForBaseline(trimmed);
}

function fakeStdoutForMode(mode, task) {
  if (mode === 'invalid_schema') return 'not json';
  return JSON.stringify(defaultFakeAnswer(task));
}

function runKey(laneId, taskId, repeatIndex, prefix = '') {
  return `${prefix}${laneId}:${taskId}:${repeatIndex}`;
}

function existingRunKeys(sessionRoot) {
  return new Set(
    readManifestRowsIfPresent(sessionRoot).map((row) =>
      runKey(row.lane_id, row.task_id, row.repeat_index, row.scoring?.baselineArmId ?? '')
    )
  );
}

function runOneBaselineAttempt(
  sessionRoot,
  fixtures,
  laneCard,
  task,
  repeatIndex,
  executor,
  model,
  timeoutMs,
  fakeAnswerMode,
  taskContext = null,
  setupIndexOverride = null
) {
  const runId = sanitize(`${laneCard.laneId}-${task.instance_id}-${repeatIndex}-${executor}`);
  const paths = buildRunPaths(sessionRoot, runId);
  const startedAt = new Date().toISOString();
  const prompt = makePrompt(task, laneCard, taskContext);
  let stdout = '';
  let stderr = '';
  let answer;
  let parseErrors = [];
  let processMetadata = { exitStatus: null, signal: null, spawnError: null };
  let externalInvocation = null;
  let status = 'completed';
  if (executor === 'fake') {
    stdout = fakeStdoutForMode(fakeAnswerMode, task);
    const parsed = parseAnswerForBaseline(stdout);
    answer = parsed.answer;
    parseErrors = parsed.errors;
    if (!answer) status = stdout.trim() ? 'invalid_schema' : 'no_answer';
  } else if (['claude', 'codex', 'gemini', 'opencode'].includes(executor)) {
    externalInvocation = externalExecutorInvocation(executor, model, prompt, paths);
    const result = spawnSync(
      externalInvocation.command,
      [...externalInvocation.prefixArgs, ...externalInvocation.args],
      {
        input: externalInvocation.input,
        encoding: 'utf8',
        timeout: timeoutMs,
        cwd: taskContext?.repoCheckoutPath ?? undefined
      }
    );
    stdout = result.stdout ?? '';
    stderr = result.stderr ?? '';
    processMetadata = {
      exitStatus: typeof result.status === 'number' ? result.status : null,
      signal: result.signal ?? null,
      spawnError: result.error?.message ?? null
    };
    if (result.error && result.error.message.includes('ETIMEDOUT')) {
      status = 'timeout';
      stderr = `${stderr}\n${executor} invocation timed out after ${timeoutMs}ms`.trim();
    } else if (result.status !== 0 && !stdout.trim()) {
      status = 'tool_error';
    }
    const parsed = parseExternalAnswerForBaseline(
      executor,
      stdout,
      stderr,
      externalInvocation.answerPath
    );
    answer = parsed.answer;
    parseErrors = parsed.errors;
    if (parsed.toolError) status = 'tool_error';
    if (!answer && status === 'completed') status = stdout.trim() ? 'invalid_schema' : 'no_answer';
  } else {
    throw new Error('--baseline-run executor must be fake, claude, codex, gemini, or opencode');
  }
  if (!answer) {
    answer = {
      answer: null,
      confidence: 'low',
      evidence: [],
      filesReferenced: [],
      symbolsReferenced: [],
      unsupportedClaims: ['missing_or_invalid_structured_answer'],
      readyToEdit: false
    };
  }
  const trajectory = buildTrajectory(task, answer);
  const setupIndex = setupIndexOverride ?? {
    setupCommand: laneCard.setupCommand,
    indexCommand: laneCard.indexCommand,
    setupDurationMs: 0,
    indexDurationMs: 0,
    setupLogPath: paths.setupIndex,
    indexLogPath: paths.setupIndex,
    setupStatus: laneCard.setupCommand === 'none' ? 'not_required' : 'completed',
    indexStatus: laneCard.indexCommand === 'none' ? 'not_required' : 'completed'
  };
  const rawTrace = {
    executor,
    model: executor === 'claude' ? model : 'fake-executor',
    runnerHash: runnerSourceHash(),
    claimBearing: false,
    stdout,
    stderr,
    timeoutMs,
    workingDirectory: taskContext?.repoCheckoutPath ?? process.cwd(),
    taskContext: taskContext
      ? {
          materialized: taskContext.materialized,
          errors: taskContext.errors,
          repoCheckoutPath: taskContext.repoCheckoutPath,
          actualHead: taskContext.actualHead,
          statusShort: taskContext.statusShort,
          baseCommitVerified: taskContext.baseCommitVerified,
          remoteUrl: taskContext.remoteUrl,
          problemStatementHash: taskContext.problemStatementHash,
          problemStatementHashVerified: taskContext.problemStatementHashVerified,
          verificationStrict: taskContext.verificationStrict
        }
      : null,
    exitStatus: processMetadata.exitStatus,
    signal: processMetadata.signal,
    spawnError: processMetadata.spawnError,
    claudeDiagnostic: executor === 'claude' ? classifyClaudeCliDiagnostic(stdout, stderr) : null,
    executorDiagnostic:
      executor !== 'fake' ? classifyExternalCliDiagnostic(executor, stdout, stderr) : null,
    executorArgs: externalInvocation?.args ?? [],
    executorCommand: externalInvocation?.command ?? null,
    executorSchemaMode: externalInvocation?.schemaMode ?? null,
    executorOutputMode: externalInvocation?.outputMode ?? null,
    executorSchemaPath: externalInvocation?.schemaPath ?? null,
    executorAnswerPath: externalInvocation?.answerPath ?? null,
    toolCalls: [],
    laneIsolation: buildLaneIsolationEvidence(laneCard),
    claudeArgs:
      executor === 'claude' ? (externalInvocation?.args ?? claudeArgsForModel(model)) : [],
    claudeCommand:
      executor === 'claude' ? (externalInvocation?.command ?? claudeCommandParts().command) : null,
    structuredAnswerParseErrors: parseErrors,
    scriptedAgentDecisions: false,
    antiScriptingBoundary: fixtures.protocol.minimalRunnerBehavior.mustNotScript
  };
  writeTextArtifact(paths.prompt, prompt);
  writeJson(paths.laneCard, laneCard);
  writeJson(paths.setupIndex, setupIndex);
  writeJson(paths.rawTrace, rawTrace);
  writeJson(paths.structuredAnswer, answer);
  writeJson(paths.trajectory, trajectory);
  const score = runOfficialEvaluatorForAttempt(fixtures, paths, task, executor, status);
  writeJson(paths.score, score);
  const completedAt = new Date().toISOString();
  appendRunManifestRow(
    sessionRoot,
    buildManifestRowForArtifacts({
      runId,
      fixtures,
      laneCard,
      task,
      repeatIndex,
      status: status === 'completed' && score.status === 'judge_failed' ? 'judge_failed' : status,
      startedAt,
      completedAt,
      paths,
      setupIndex,
      executor,
      model: executor === 'fake' ? 'fake-executor' : model,
      scoring: {
        officialEvaluatorFirst: score.officialEvaluatorFirst,
        officialEvaluatorAttempted: score.officialEvaluatorAttempted,
        officialEvaluatorInvoked: score.officialEvaluatorInvoked,
        command: score.command,
        claimBearing: score.claimBearing,
        ...(score.fallbackReason ? { fallbackReason: score.fallbackReason } : {}),
        ...(score.stdoutPath ? { stdoutPath: score.stdoutPath } : {}),
        ...(score.stderrPath ? { stderrPath: score.stderrPath } : {})
      }
    })
  );
}

function writeTaskSetupFailedAttempt(
  sessionRoot,
  fixtures,
  laneCard,
  task,
  repeatIndex,
  executor,
  model,
  timeoutMs,
  taskContext
) {
  const runId = sanitize(`${laneCard.laneId}-${task.instance_id}-${repeatIndex}-${executor}`);
  const paths = buildRunPaths(sessionRoot, runId);
  const startedAt = new Date().toISOString();
  const completedAt = startedAt;
  const prompt = makePrompt(task, laneCard, taskContext);
  const setupIndex = {
    setupCommand: laneCard.setupCommand,
    indexCommand: laneCard.indexCommand,
    setupDurationMs: 0,
    indexDurationMs: 0,
    setupLogPath: paths.setupIndex,
    indexLogPath: paths.setupIndex,
    setupStatus: 'setup_failed',
    indexStatus: 'not_required',
    taskMaterializationStatus: 'failed',
    taskMaterializationErrors: taskContext.errors
  };
  const fallbackAnswer = {
    answer: null,
    confidence: 'low',
    evidence: [],
    filesReferenced: [],
    symbolsReferenced: [],
    unsupportedClaims: ['missing_or_invalid_task_context'],
    readyToEdit: false
  };
  writeTextArtifact(paths.prompt, prompt);
  writeJson(paths.laneCard, laneCard);
  writeJson(paths.setupIndex, setupIndex);
  writeJson(paths.rawTrace, {
    executor,
    model: executor === 'fake' ? 'fake-executor' : model,
    runnerHash: runnerSourceHash(),
    claimBearing: false,
    status: 'task_setup_failed',
    timeoutMs,
    workingDirectory: process.cwd(),
    taskContext: {
      materialized: false,
      errors: taskContext.errors,
      repoCheckoutPath: taskContext.repoCheckoutPath,
      actualHead: taskContext.actualHead,
      statusShort: taskContext.statusShort,
      baseCommitVerified: taskContext.baseCommitVerified,
      remoteUrl: taskContext.remoteUrl,
      problemStatementHash: taskContext.problemStatementHash,
      problemStatementHashVerified: taskContext.problemStatementHashVerified,
      verificationStrict: taskContext.verificationStrict
    },
    stdout: '',
    stderr: `task context materialization failed: ${taskContext.errors.join(', ')}`,
    exitStatus: null,
    signal: null,
    spawnError: null,
    structuredAnswerParseErrors: ['invalid_task_context'],
    toolCalls: [],
    laneIsolation: buildLaneIsolationEvidence(laneCard),
    scriptedAgentDecisions: false,
    antiScriptingBoundary: fixtures.protocol.minimalRunnerBehavior.mustNotScript
  });
  writeJson(paths.structuredAnswer, fallbackAnswer);
  writeJson(paths.trajectory, buildTrajectory(task, fallbackAnswer));
  writeJson(paths.score, {
    status: 'task_setup_failed',
    mode: 'materialization_gate',
    ...diagnosticFallbackScoring(
      fixtures,
      `invalid_task_context:${taskContext.errors.join(',')}`
    )
  });
  appendRunManifestRow(
    sessionRoot,
    buildManifestRowForArtifacts({
      runId,
      fixtures,
      laneCard,
      task,
      repeatIndex,
      status: 'task_setup_failed',
      startedAt,
      completedAt,
      paths,
      setupIndex,
      executor,
      model: executor === 'fake' ? 'fake-executor' : model,
      scoring: diagnosticFallbackScoring(
        fixtures,
        `invalid_task_context:${taskContext.errors.join(',')}`
      )
    })
  );
}

function setupIndexForBaselineAttempt(sessionRoot, laneCard) {
  const measured = readMeasuredSetupIndex(sessionRoot, laneCard);
  if (measured) {
    if (
      ['completed', 'not_required'].includes(measured.setupStatus) &&
      ['completed', 'not_required'].includes(measured.indexStatus)
    ) {
      return measured;
    }
    return null;
  }
  if (laneCard.laneId === 'raw-native') {
    const paths = buildSetupIndexMeasurementPaths(sessionRoot, laneCard.laneId);
    const measurement = defaultRawNativeSetupIndex(sessionRoot, laneCard);
    writeJson(paths.artifact, measurement);
    return rowSetupIndexFromMeasurement(measurement);
  }
  return null;
}

function writeSetupIndexMissingAttempt(
  sessionRoot,
  fixtures,
  laneCard,
  task,
  repeatIndex,
  executor,
  model,
  timeoutMs,
  reason
) {
  const runId = sanitize(`${laneCard.laneId}-${task.instance_id}-${repeatIndex}-${executor}`);
  const paths = buildRunPaths(sessionRoot, runId);
  const startedAt = new Date().toISOString();
  const completedAt = startedAt;
  const prompt = `Setup/index measurement missing for ${task.instance_id} in ${laneCard.laneId}; no agent task prompt executed.`;
  const setupIndex = {
    setupCommand: laneCard.setupCommand,
    indexCommand: laneCard.indexCommand,
    setupDurationMs: 0,
    indexDurationMs: 0,
    setupLogPath: paths.setupIndex,
    indexLogPath: paths.setupIndex,
    setupStatus: 'setup_failed',
    indexStatus: 'not_required'
  };
  const fallbackAnswer = {
    answer: null,
    confidence: 'low',
    evidence: [],
    filesReferenced: [],
    symbolsReferenced: [],
    unsupportedClaims: ['missing_setup_index_measurement'],
    readyToEdit: false
  };
  writeTextArtifact(paths.prompt, prompt);
  writeJson(paths.laneCard, laneCard);
  writeJson(paths.setupIndex, { ...setupIndex, reason });
  writeJson(paths.rawTrace, {
    executor,
    model: executor === 'fake' ? 'fake-executor' : model,
    runnerHash: runnerSourceHash(),
    claimBearing: false,
    status: 'setup_failed',
    timeoutMs,
    workingDirectory: process.cwd(),
    stdout: '',
    stderr: reason,
    exitStatus: null,
    signal: null,
    spawnError: null,
    structuredAnswerParseErrors: ['missing_setup_index_measurement'],
    toolCalls: [],
    laneIsolation: buildLaneIsolationEvidence(laneCard),
    scriptedAgentDecisions: false,
    antiScriptingBoundary: fixtures.protocol.minimalRunnerBehavior.mustNotScript
  });
  writeJson(paths.structuredAnswer, fallbackAnswer);
  writeJson(paths.trajectory, buildTrajectory(task, fallbackAnswer));
  writeJson(paths.score, {
    status: 'setup_failed',
    mode: 'setup_index_measurement_gate',
    ...diagnosticFallbackScoring(fixtures, `missing_setup_index_measurement:${reason}`)
  });
  appendRunManifestRow(
    sessionRoot,
    buildManifestRowForArtifacts({
      runId,
      fixtures,
      laneCard,
      task,
      repeatIndex,
      status: 'setup_failed',
      startedAt,
      completedAt,
      paths,
      setupIndex,
      executor,
      model: executor === 'fake' ? 'fake-executor' : model,
      scoring: diagnosticFallbackScoring(fixtures, `missing_setup_index_measurement:${reason}`)
    })
  );
}

function runBaseline(args) {
  if (!args.session) throw new Error('--baseline-run requires --session <session-root>');
  const sessionRoot = ensureBaselineSessionRoot(args.session);
  if (!existsSync(join(sessionRoot, 'BASELINE-SESSION.json')))
    throw new Error('baseline session snapshot missing');
  const fixtures = validateFixtures();
  const cardsByLane = new Map(fixtures.laneToolCards.cards.map((card) => [card.laneId, card]));
  const tasksById = new Map(fixtures.manifest.tasks.map((task) => [task.instance_id, task]));
  const evidenceByLane = new Map(
    fixtures.laneSetupEvidence.records.map((record) => [record.laneId, record])
  );
  const repeats = args.repeats ?? args.repeat ?? 1;
  const taskPayloads = readTaskPayloads(args.taskPayloads);
  const maxAttempts =
    Number.isInteger(args.maxAttempts) && args.maxAttempts > 0 ? args.maxAttempts : Infinity;
  const timeoutMs =
    Number.isInteger(args.timeoutMs) && args.timeoutMs > 0
      ? args.timeoutMs
      : fixtures.protocol.budgets.defaults.timeoutSeconds * 1000;
  const existing = existingRunKeys(sessionRoot);
  let attempted = 0;
  const lanes = args.allReadyLanes
    ? fixtures.lanes.broadClaimLaneSet.filter(
        (laneId) => evidenceByLane.get(laneId)?.readinessStatus === 'ready_for_phase40'
      )
    : [args.lane];
  const tasks = args.taskId
    ? [args.taskId]
    : fixtures.manifest.tasks.map((task) => task.instance_id);
  for (const laneId of lanes) {
    const laneCard = cardsByLane.get(laneId);
    if (!laneCard) throw new Error(`unknown lane: ${laneId}`);
    if (BLOCKED_LANE_SETUP_STATUSES.has(evidenceByLane.get(laneId)?.readinessStatus)) continue;
    for (const taskId of tasks) {
      const task = tasksById.get(taskId);
      if (!task) throw new Error(`unknown task-id: ${taskId}`);
      for (let repeatIndex = 1; repeatIndex <= repeats; repeatIndex += 1) {
        if (existing.has(runKey(laneCard.laneId, task.instance_id, repeatIndex))) continue;
        if (attempted >= maxAttempts) break;
        const executor = args.executor ?? 'fake';
        const measuredSetupIndex = setupIndexForBaselineAttempt(sessionRoot, laneCard);
        if (!measuredSetupIndex) {
          writeSetupIndexMissingAttempt(
            sessionRoot,
            fixtures,
            laneCard,
            task,
            repeatIndex,
            executor,
            args.model ?? 'unspecified',
            timeoutMs,
            `${laneCard.laneId} requires --setup-index-import before task execution`
          );
          attempted += 1;
          continue;
        }
        const taskContext = resolveTaskContext(task, taskPayloads, executor);
        if (executor !== 'fake' && !taskContext.materialized) {
          writeTaskSetupFailedAttempt(
            sessionRoot,
            fixtures,
            laneCard,
            task,
            repeatIndex,
            executor,
            args.model ?? 'unspecified',
            timeoutMs,
            taskContext
          );
          attempted += 1;
          continue;
        }
        runOneBaselineAttempt(
          sessionRoot,
          fixtures,
          laneCard,
          task,
          repeatIndex,
          executor,
          args.model ?? 'unspecified',
          timeoutMs,
          args.fakeAnswerMode ?? 'valid',
          taskContext,
          measuredSetupIndex
        );
        attempted += 1;
      }
      if (attempted >= maxAttempts) break;
    }
    if (attempted >= maxAttempts) break;
  }
  const session = readSession(sessionRoot);
  session.artifactIndex = refreshArtifactIndex(sessionRoot);
  writeSession(sessionRoot, session);
  console.log(
    `baseline run updated ${join(sessionRoot, 'run-manifest.jsonl')} (${attempted} new attempts)`
  );
}

function runOneCodebaseContextArmAttempt(
  sessionRoot,
  fixtures,
  laneCard,
  task,
  arm,
  repeatIndex,
  executor,
  model,
  timeoutMs,
  fakeAnswerMode,
  taskContext = null
) {
  const runId = sanitize(`${arm.baselineArmId}-${task.instance_id}-${repeatIndex}-${executor}`);
  const paths = buildRunPaths(sessionRoot, runId);
  const startedAt = new Date().toISOString();
  const prompt = [
    makePrompt(task, laneCard, taskContext),
    `Diagnostic baseline arm: ${arm.baselineArmId}`,
    `Allowed existing codebase-context surfaces for this arm: ${arm.allowedToolSurfaces.join(', ')}`,
    'This diagnostic arm is not a required competitor lane denominator and is not claim-bearing.'
  ].join('\n');
  let stdout = '';
  let stderr = '';
  let answer;
  let parseErrors = [];
  let processMetadata = { exitStatus: null, signal: null, spawnError: null };
  let status = 'completed';
  if (executor !== 'fake' && taskContext && !taskContext.materialized) {
    status = 'task_setup_failed';
    stderr = `task context materialization failed: ${taskContext.errors.join(', ')}`;
    parseErrors = ['invalid_task_context'];
  } else if (executor === 'fake') {
    stdout = fakeStdoutForMode(fakeAnswerMode, task);
    const parsed = parseAnswerForBaseline(stdout);
    answer = parsed.answer;
    parseErrors = parsed.errors;
    if (!answer) status = stdout.trim() ? 'invalid_schema' : 'no_answer';
  } else if (executor === 'claude') {
    const claudeArgs = claudeArgsForModel(model);
    const claudeCommand = claudeCommandParts();
    const result = spawnSync(claudeCommand.command, [...claudeCommand.prefixArgs, ...claudeArgs], {
      input: prompt,
      encoding: 'utf8',
      timeout: timeoutMs,
      cwd: taskContext?.repoCheckoutPath ?? undefined
    });
    stdout = result.stdout ?? '';
    stderr = result.stderr ?? '';
    processMetadata = {
      exitStatus: typeof result.status === 'number' ? result.status : null,
      signal: result.signal ?? null,
      spawnError: result.error?.message ?? null
    };
    if (result.error && result.error.message.includes('ETIMEDOUT')) {
      status = 'timeout';
      stderr = `${stderr}\nClaude invocation timed out after ${timeoutMs}ms`.trim();
    } else if (result.status !== 0 && !stdout.trim()) {
      status = 'tool_error';
    }
    const parsed = parseClaudeAnswerForBaseline(stdout, stderr);
    answer = parsed.answer;
    parseErrors = parsed.errors;
    if (parsed.toolError) status = 'tool_error';
    if (!answer && status === 'completed') status = stdout.trim() ? 'invalid_schema' : 'no_answer';
  } else {
    throw new Error('--baseline-run-codebase-context-arms executor must be fake or claude');
  }
  if (!answer) {
    answer = {
      answer: null,
      confidence: 'low',
      evidence: [],
      filesReferenced: [],
      symbolsReferenced: [],
      unsupportedClaims: ['missing_or_invalid_structured_answer'],
      readyToEdit: false
    };
  }
  const setupIndex = {
    setupCommand: arm.setupCommand,
    indexCommand: laneCard.indexCommand,
    setupDurationMs: 0,
    indexDurationMs: 0,
    setupLogPath: paths.setupIndex,
    indexLogPath: paths.setupIndex,
    setupStatus: 'completed',
    indexStatus: 'completed'
  };
  const trajectory = buildTrajectory(task, answer);
  const score = {
    status: status === 'completed' ? 'judge_failed' : status,
    mode: 'diagnostic_fallback',
    ...diagnosticFallbackScoring(
      fixtures,
      executor === 'fake'
        ? 'fake_executor_diagnostic_arm_smoke_only'
        : 'official_evaluator_not_invoked_by_runner_smoke',
      { baselineArmId: arm.baselineArmId }
    )
  };
  writeTextArtifact(paths.prompt, prompt);
  writeJson(paths.laneCard, { ...laneCard, diagnosticBaselineArm: arm });
  writeJson(paths.setupIndex, { ...setupIndex, diagnosticBaselineArm: arm });
  writeJson(paths.rawTrace, {
    executor,
    model: executor === 'claude' ? model : 'fake-executor',
    runnerHash: runnerSourceHash(),
    claimBearing: false,
    baselineArmId: arm.baselineArmId,
    stdout,
    stderr,
    timeoutMs,
    workingDirectory: taskContext?.repoCheckoutPath ?? process.cwd(),
    taskContext: taskContext
      ? {
          materialized: taskContext.materialized,
          errors: taskContext.errors,
          repoCheckoutPath: taskContext.repoCheckoutPath,
          actualHead: taskContext.actualHead,
          statusShort: taskContext.statusShort,
          baseCommitVerified: taskContext.baseCommitVerified,
          remoteUrl: taskContext.remoteUrl,
          problemStatementHash: taskContext.problemStatementHash,
          problemStatementHashVerified: taskContext.problemStatementHashVerified,
          verificationStrict: taskContext.verificationStrict
        }
      : null,
    exitStatus: processMetadata.exitStatus,
    signal: processMetadata.signal,
    spawnError: processMetadata.spawnError,
    claudeDiagnostic: executor === 'claude' ? classifyClaudeCliDiagnostic(stdout, stderr) : null,
    toolCalls: [],
    laneIsolation: buildLaneIsolationEvidence(laneCard),
    claudeArgs: executor === 'claude' ? claudeArgsForModel(model) : [],
    claudeCommand: executor === 'claude' ? claudeCommandParts().command : null,
    structuredAnswerParseErrors: parseErrors,
    scriptedAgentDecisions: false,
    antiScriptingBoundary: fixtures.protocol.minimalRunnerBehavior.mustNotScript
  });
  writeJson(paths.structuredAnswer, answer);
  writeJson(paths.trajectory, trajectory);
  writeJson(paths.score, score);
  const completedAt = new Date().toISOString();
  appendRunManifestRow(
    sessionRoot,
    buildManifestRowForArtifacts({
      runId,
      fixtures,
      laneCard,
      task,
      repeatIndex,
      status,
      startedAt,
      completedAt,
      paths,
      setupIndex,
      executor,
      model: executor === 'fake' ? 'fake-executor' : model,
      scoring: diagnosticFallbackScoring(fixtures, score.fallbackReason, {
        baselineArmId: arm.baselineArmId
      })
    })
  );
}

function runBaselineCodebaseContextArms(args) {
  if (!args.session)
    throw new Error('--baseline-run-codebase-context-arms requires --session <session-root>');
  const sessionRoot = ensureBaselineSessionRoot(args.session);
  if (!existsSync(join(sessionRoot, 'BASELINE-SESSION.json')))
    throw new Error('baseline session snapshot missing');
  validateBaselineArms(FIXTURES.codebaseContextBaselineArms);
  const fixtures = validateFixtures();
  const arms = readJson(FIXTURES.codebaseContextBaselineArms).arms ?? [];
  const laneCard = fixtures.laneToolCards.cards.find((card) => card.laneId === 'codebase-context');
  if (!laneCard) throw new Error('codebase-context lane card missing');
  const tasks = args.taskId
    ? fixtures.manifest.tasks.filter((task) => task.instance_id === args.taskId)
    : fixtures.manifest.tasks;
  if (args.taskId && tasks.length === 0) throw new Error(`unknown task-id: ${args.taskId}`);
  const repeats = args.repeats ?? args.repeat ?? 1;
  const maxAttempts =
    Number.isInteger(args.maxAttempts) && args.maxAttempts > 0 ? args.maxAttempts : Infinity;
  const timeoutMs =
    Number.isInteger(args.timeoutMs) && args.timeoutMs > 0
      ? args.timeoutMs
      : fixtures.protocol.budgets.defaults.timeoutSeconds * 1000;
  const existing = existingRunKeys(sessionRoot);
  const taskPayloads = readTaskPayloads(args.taskPayloads);
  let attempted = 0;
  for (const arm of arms) {
    for (const task of tasks) {
      for (let repeatIndex = 1; repeatIndex <= repeats; repeatIndex += 1) {
        if (
          existing.has(runKey('codebase-context', task.instance_id, repeatIndex, arm.baselineArmId))
        )
          continue;
        if (attempted >= maxAttempts) break;
        const executor = args.executor ?? 'fake';
        const taskContext = resolveTaskContext(task, taskPayloads, executor);
        runOneCodebaseContextArmAttempt(
          sessionRoot,
          fixtures,
          laneCard,
          task,
          arm,
          repeatIndex,
          executor,
          args.model ?? 'unspecified',
          timeoutMs,
          args.fakeAnswerMode ?? 'valid',
          taskContext
        );
        attempted += 1;
      }
      if (attempted >= maxAttempts) break;
    }
    if (attempted >= maxAttempts) break;
  }
  const session = readSession(sessionRoot);
  session.artifactIndex = refreshArtifactIndex(sessionRoot);
  writeSession(sessionRoot, session);
  console.log(
    `baseline codebase-context diagnostic arms updated ${join(sessionRoot, 'run-manifest.jsonl')} (${attempted} new attempts)`
  );
}

function readManifestRowsIfPresent(sessionRoot) {
  const manifestPath = join(sessionRoot, 'run-manifest.jsonl');
  if (!existsSync(manifestPath)) return [];
  const content = readFileSync(manifestPath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function validateSessionPaths(sessionRoot, rows, errors) {
  for (const row of rows) {
    for (const key of [
      'raw_trace_path',
      'structured_answer_path',
      'trajectory_path',
      'score_path',
      'setup_index_path',
      'prompt_path',
      'lane_tool_card_path'
    ]) {
      const value = row[key];
      if (!value || !isAbsolute(value)) errors.push(`row ${row.run_id} ${key} must be absolute`);
      else if (!isPathInside(sessionRoot, value))
        errors.push(`row ${row.run_id} ${key} is outside session root`);
      else if (!existsSync(value)) errors.push(`row ${row.run_id} ${key} missing artifact`);
    }
    if (row.setupIndex && 'taskWallTimeMs' in row.setupIndex)
      errors.push(`row ${row.run_id} mixes task time into setupIndex`);
    if (row.scoring?.claimBearing !== false)
      errors.push(
        `row ${row.run_id} scoring must be non-claim-bearing while protocol claimAllowed=false`
      );
  }
}

function phase42RowKey(row) {
  return `${row.lane_id}\u0000${row.task_id}\u0000${row.repeat_index}`;
}

function phase42ExpectedKeys(fixtures) {
  const keys = new Set();
  const repeats = fixtures.protocol.runPolicy?.claimBearingRunsPerTaskLane ?? 3;
  for (const laneId of fixtures.lanes.broadClaimLaneSet) {
    for (const task of fixtures.manifest.tasks) {
      for (let repeatIndex = 1; repeatIndex <= repeats; repeatIndex += 1) {
        keys.add(`${laneId}\u0000${task.instance_id}\u0000${repeatIndex}`);
      }
    }
  }
  return keys;
}

function phase42LanePolicies(fixtures) {
  return Object.fromEntries(
    fixtures.laneToolCards.cards.map((card) => [
      card.laneId,
      {
        laneId: card.laneId,
        expectedContextTool: card.contextTools[0] ?? card.laneId,
        allowedTools: card.allowedTools,
        disallowedTools: card.disallowedTools,
        ...(card.laneId === 'raw-native' ? { allowMultipleObservedTools: true } : {})
      }
    ])
  );
}

function phase42ReadJsonArtifact(filePath, readErrors, runId, label) {
  if (!filePath || !existsSync(filePath)) {
    readErrors.push({ runId, path: filePath ?? '', reason: `${label}_missing` });
    return null;
  }
  try {
    return readJson(filePath);
  } catch (error) {
    readErrors.push({
      runId,
      path: filePath,
      reason: `${label}_invalid_json:${error instanceof Error ? error.message : String(error)}`
    });
    return null;
  }
}

function phase42HashArtifact(filePath, artifactHashesByPath, readErrors, runId, label) {
  if (!filePath || !existsSync(filePath)) {
    readErrors.push({ runId, path: filePath ?? '', reason: `${label}_missing` });
    return null;
  }
  const hash = hashFile(filePath);
  artifactHashesByPath[filePath] = hash;
  return hash;
}

function phase42CollectArtifactHashes(row, score, artifactHashesByPath, readErrors, integrityErrors) {
  for (const [label, filePath] of [
    ['raw_trace', row.raw_trace_path, 'rawTrace'],
    ['structured_answer', row.structured_answer_path, 'structuredAnswer'],
    ['trajectory', row.trajectory_path, 'trajectory'],
    ['score', row.score_path, 'score'],
    ['setup_index', row.setup_index_path, 'setupIndex'],
    ['prompt', row.prompt_path, 'prompt'],
    ['lane_tool_card', row.lane_tool_card_path, 'laneToolCard']
  ]) {
    const actualHash = phase42HashArtifact(filePath, artifactHashesByPath, readErrors, row.run_id, label);
    const expectedHash = row.hashes?.[label === 'lane_tool_card' ? 'laneToolCard' : label === 'setup_index' ? 'setupIndex' : label === 'raw_trace' ? 'rawTrace' : label === 'structured_answer' ? 'structuredAnswer' : label];
    if (actualHash && !expectedHash) {
      integrityErrors.push({
        runId: row.run_id,
        path: filePath,
        reason: `${label}_manifest_hash_missing`,
        expectedHash: null,
        actualHash
      });
    } else if (actualHash && expectedHash && actualHash !== expectedHash) {
      integrityErrors.push({
        runId: row.run_id,
        path: filePath,
        reason: `${label}_hash_mismatch`,
        expectedHash,
        actualHash
      });
    }
  }
  for (const [label, filePath] of [
    ['official_output', score?.outputPath],
    ['official_stdout', score?.stdoutPath],
    ['official_stderr', score?.stderrPath]
  ]) {
    if (filePath) phase42HashArtifact(filePath, artifactHashesByPath, readErrors, row.run_id, label);
  }
}

function phase42ArtifactsForRow(row, readErrors) {
  const rawTrace = phase42ReadJsonArtifact(row.raw_trace_path, readErrors, row.run_id, 'raw_trace');
  const score = phase42ReadJsonArtifact(row.score_path, readErrors, row.run_id, 'score');
  const setupIndex = phase42ReadJsonArtifact(
    row.setup_index_path,
    readErrors,
    row.run_id,
    'setup_index'
  );
  return {
    rawTrace: rawTrace
      ? {
          executor: rawTrace.executor,
          model: rawTrace.model,
          runnerHash: rawTrace.runnerHash
        }
      : undefined,
    score: score
      ? {
          status: score.status,
          mode: score.mode,
          claimBearing: score.claimBearing,
          officialEvaluatorInvoked: score.officialEvaluatorInvoked,
          command: score.command,
          exitCode: score.exitCode,
          outputPath: score.outputPath,
          outputHash: score.outputHash,
          stdoutPath: score.stdoutPath,
          stderrPath: score.stderrPath,
          stdoutHash: score.stdoutHash,
          stderrHash: score.stderrHash
        }
      : undefined,
    setupIndex: setupIndex
      ? {
          setupStatus: setupIndex.setupStatus,
          indexStatus: setupIndex.indexStatus,
          setupDurationMs: setupIndex.setupDurationMs,
          indexDurationMs: setupIndex.indexDurationMs,
          setupLogPath: setupIndex.setupLogPath,
          indexLogPath: setupIndex.indexLogPath
        }
      : undefined,
    laneIsolation: rawTrace?.laneIsolation
      ? {
          laneId: rawTrace.laneIsolation.laneId,
          proven: rawTrace.laneIsolation.proven,
          sourceKind: rawTrace.laneIsolation.sourceKind,
          expectedContextTool: rawTrace.laneIsolation.expectedContextTool,
          allowedTools: rawTrace.laneIsolation.allowedTools ?? [],
          observedTools: rawTrace.laneIsolation.observedTools ?? [],
          violations: rawTrace.laneIsolation.violations ?? []
        }
      : undefined,
    rawScore: score
  };
}

function loadPhase42SessionEvidence(sessionRoot, fixtures) {
  const sessionPath = join(sessionRoot, 'BASELINE-SESSION.json');
  const reservationPath = join(sessionRoot, 'slot-reservations.json');
  const session = existsSync(sessionPath) ? readJson(sessionPath) : null;
  const reservations = existsSync(reservationPath)
    ? (readJson(reservationPath).reservations ?? [])
    : [];
  const rows = readManifestRowsIfPresent(sessionRoot);
  const expectedKeys = phase42ExpectedKeys(fixtures);
  const requiredRows = [];
  const supplementalRows = [];
  const unexpectedRows = [];
  for (const row of rows) {
    if (row.scoring?.baselineArmId) {
      supplementalRows.push(row);
      continue;
    }
    if (expectedKeys.has(phase42RowKey(row))) requiredRows.push(row);
    else unexpectedRows.push(row);
  }

  const readErrors = [];
  const integrityErrors = [];
  const artifactHashesByPath = {};
  const artifactsByRunId = {};
  for (const row of requiredRows) {
    const artifacts = phase42ArtifactsForRow(row, readErrors);
    phase42CollectArtifactHashes(
      row,
      artifacts.rawScore,
      artifactHashesByPath,
      readErrors,
      integrityErrors
    );
    delete artifacts.rawScore;
    artifactsByRunId[row.run_id] = artifacts;
  }

  const runnerHashes = requiredRows
    .map((row) => row.hashes?.runnerSourceHash)
    .filter((hash) => typeof hash === 'string' && hash.length > 0);
  const uniqueRunnerHashes = [...new Set(runnerHashes)];
  const expectedRunnerHash = uniqueRunnerHashes.length === 1 ? uniqueRunnerHashes[0] : undefined;
  const repeats = fixtures.protocol.runPolicy?.claimBearingRunsPerTaskLane ?? 3;
  return {
    session,
    reservations,
    requiredRows,
    supplementalRows,
    unexpectedRows,
    readErrors,
    integrityErrors,
    gateInput: {
      evidenceMode: 'artifact_verified',
      protocol: {
        claimAllowed: fixtures.protocol.claimAllowed,
        benchmarkTarget: {
          officialEvaluatorFirst: fixtures.protocol.benchmarkTarget.officialEvaluatorFirst
        }
      },
      requiredLaneIds: fixtures.lanes.broadClaimLaneSet,
      requiredTaskIds: fixtures.manifest.tasks.map((task) => task.instance_id),
      requiredRepeats: repeats,
      expectedTotalRows: fixtures.lanes.broadClaimLaneSet.length * fixtures.manifest.tasks.length * repeats,
      expectedProtocolHash: hashObject(fixtures.protocol),
      expectedTaskManifestHash: fixtures.manifest.manifest_hash,
      lanePoliciesById: phase42LanePolicies(fixtures),
      rows: requiredRows,
      artifactsByRunId,
      artifactHashesByPath,
      expectedRunnerHash,
      currentRunnerHash: runnerSourceHash()
    }
  };
}

function phase42HasMeasuredSetupIndex(row, evidence) {
  if (!evidence) return false;
  const setupDuration = evidence.setupDurationMs;
  const indexDuration = evidence.indexDurationMs;
  if (typeof setupDuration !== 'number' || typeof indexDuration !== 'number') return false;
  if (!Number.isFinite(setupDuration) || !Number.isFinite(indexDuration)) return false;
  if (!evidence.setupStatus || !evidence.indexStatus) return false;
  if (!evidence.setupLogPath || !evidence.indexLogPath) return false;
  if (!['completed', 'not_required'].includes(evidence.setupStatus)) return false;
  if (!['completed', 'not_required'].includes(evidence.indexStatus)) return false;
  if (evidence.setupStatus === 'completed' && setupDuration <= 0) return false;
  if (evidence.indexStatus === 'completed' && indexDuration <= 0) return false;
  return (
    row.setupIndex.setupStatus === evidence.setupStatus &&
    row.setupIndex.indexStatus === evidence.indexStatus &&
    row.setupIndex.setupDurationMs === evidence.setupDurationMs &&
    row.setupIndex.indexDurationMs === evidence.indexDurationMs &&
    row.setupIndex.setupLogPath === evidence.setupLogPath &&
    row.setupIndex.indexLogPath === evidence.indexLogPath
  );
}

function phase42HasSha256Hash(value) {
  return /^sha256:[a-f0-9]{64}$/.test(value ?? '');
}

function phase42HasOfficialEvaluatorProof(row, score, artifactHashesByPath) {
  return (
    row.scoring.officialEvaluatorFirst === true &&
    row.scoring.officialEvaluatorAttempted === true &&
    row.scoring.officialEvaluatorInvoked === true &&
    row.scoring.claimBearing === true &&
    score?.officialEvaluatorInvoked === true &&
    score.claimBearing === true &&
    score.mode === 'official_evaluator' &&
    score.status === 'completed' &&
    score.exitCode === 0 &&
    typeof score.command === 'string' &&
    score.command.includes('contextbench.evaluate') &&
    typeof score.outputPath === 'string' &&
    score.outputPath.length > 0 &&
    phase42HasSha256Hash(score.outputHash) &&
    artifactHashesByPath[score.outputPath] === score.outputHash &&
    phase42HasSha256Hash(artifactHashesByPath[row.score_path]) &&
    typeof score.stdoutPath === 'string' &&
    score.stdoutPath.length > 0 &&
    phase42HasSha256Hash(score.stdoutHash) &&
    artifactHashesByPath[score.stdoutPath] === score.stdoutHash &&
    phase42HasSha256Hash(artifactHashesByPath[score.stdoutPath]) &&
    typeof score.stderrPath === 'string' &&
    score.stderrPath.length > 0 &&
    phase42HasSha256Hash(score.stderrHash) &&
    artifactHashesByPath[score.stderrPath] === score.stderrHash &&
    phase42HasSha256Hash(artifactHashesByPath[score.stderrPath])
  );
}

function phase42HasDiagnosticFallback(row, score) {
  return row.scoring.claimBearing === false || Boolean(row.scoring.fallbackReason) || score?.mode === 'diagnostic_fallback';
}

function phase42HasLaneIsolationProof(row, isolation, policy) {
  if (!isolation?.proven || !policy) return false;
  if (!isolation.sourceKind || ['not_captured', 'env_override'].includes(isolation.sourceKind)) return false;
  if (policy.laneId !== row.lane_id || isolation.laneId !== row.lane_id) return false;
  if (isolation.expectedContextTool !== policy.expectedContextTool) return false;
  if (isolation.allowedTools.length === 0 || isolation.observedTools.length === 0) return false;
  if (isolation.violations && isolation.violations.length > 0) return false;
  if (policy.disallowedTools.some((tool) => isolation.observedTools.includes(tool))) return false;
  if (isolation.allowedTools.some((tool) => !policy.allowedTools.includes(tool))) return false;
  if (policy.allowMultipleObservedTools) {
    return isolation.observedTools.every((tool) => policy.allowedTools.includes(tool));
  }
  if (!isolation.allowedTools.includes(policy.expectedContextTool)) return false;
  return isolation.observedTools.length === 1 && isolation.observedTools[0] === policy.expectedContextTool;
}

function phase42HasRunnerProvenance(row, rawTrace, expectedRunnerHash) {
  if (!rawTrace?.executor || !rawTrace.model || !rawTrace.runnerHash || !expectedRunnerHash)
    return false;
  return (
    rawTrace.executor === row.taskExecution.executor &&
    rawTrace.model === row.taskExecution.model &&
    rawTrace.runnerHash === expectedRunnerHash &&
    row.hashes.runnerSourceHash === expectedRunnerHash
  );
}

function phase42Failure(row, code, message) {
  return {
    code,
    runId: row.run_id,
    laneId: row.lane_id,
    taskId: row.task_id,
    repeatIndex: row.repeat_index,
    message
  };
}

function evaluatePhase42EvidenceGate(input) {
  const failures = [];
  const expectedKeys = new Set();
  if (input.evidenceMode !== 'artifact_verified') {
    failures.push({
      code: 'artifact_verification_missing',
      message: 'Synthetic shape evidence cannot produce claim-bearing benchmark pass.'
    });
  }
  if (!input.protocol.claimAllowed) {
    failures.push({
      code: 'protocol_claims_disabled',
      message: 'The protocol does not currently allow claim-bearing benchmark results.'
    });
  }
  if (input.expectedTotalRows <= 0 || input.requiredLaneIds.length === 0 || input.requiredTaskIds.length === 0) {
    failures.push({
      code: 'denominator_contract_missing',
      message: 'Claim validation requires a frozen denominator contract.'
    });
  }
  if (input.rows.length !== input.expectedTotalRows) {
    failures.push({
      code: 'denominator_count_mismatch',
      message: 'Run row count does not match the frozen expected denominator count.'
    });
  }
  for (const laneId of input.requiredLaneIds) {
    for (const taskId of input.requiredTaskIds) {
      for (let repeatIndex = 1; repeatIndex <= input.requiredRepeats; repeatIndex += 1) {
        expectedKeys.add(`${laneId}\u0000${taskId}\u0000${repeatIndex}`);
      }
    }
  }
  const rowCounts = new Map();
  for (const row of input.rows) {
    const key = phase42RowKey(row);
    rowCounts.set(key, (rowCounts.get(key) ?? 0) + 1);
    if (!expectedKeys.has(key)) {
      failures.push(
        phase42Failure(row, 'unexpected_run_row', 'Rows outside the required denominator must not be hidden from claim validation.')
      );
    }
    if (row.protocol_hash !== input.expectedProtocolHash) {
      failures.push(phase42Failure(row, 'protocol_hash_mismatch', 'Row protocol hash does not match the frozen protocol hash.'));
    }
    if (row.task_manifest_hash !== input.expectedTaskManifestHash) {
      failures.push(phase42Failure(row, 'task_manifest_hash_mismatch', 'Row task manifest hash does not match the frozen task manifest hash.'));
    }
  }
  for (const row of input.rows) {
    if ((rowCounts.get(phase42RowKey(row)) ?? 0) > 1) {
      failures.push(phase42Failure(row, 'duplicate_required_run', 'Duplicate lane/task/repeat rows make the evidence denominator ambiguous.'));
    }
  }
  if (!input.expectedRunnerHash || !input.currentRunnerHash) {
    failures.push({
      code: 'runner_provenance_missing',
      message: 'Expected and current runner hashes are required for claim-bearing validation.'
    });
  } else if (input.expectedRunnerHash !== input.currentRunnerHash) {
    failures.push({
      code: 'runner_provenance_mismatch',
      message: 'Current runner hash does not match the expected generation runner hash.'
    });
  }
  for (const laneId of input.requiredLaneIds) {
    for (const taskId of input.requiredTaskIds) {
      for (let repeatIndex = 1; repeatIndex <= input.requiredRepeats; repeatIndex += 1) {
        const row = input.rows.find(
          (candidate) =>
            candidate.lane_id === laneId &&
            candidate.task_id === taskId &&
            candidate.repeat_index === repeatIndex
        );
        if (!row) {
          failures.push({
            code: 'missing_required_run',
            laneId,
            taskId,
            repeatIndex,
            message: 'A required lane/task/repeat row is missing from the evidence denominator.'
          });
          continue;
        }
        const artifacts = input.artifactsByRunId[row.run_id];
        if (row.status !== 'completed') {
          failures.push(phase42Failure(row, 'non_completed_status', 'Claim-bearing runs must complete.'));
        }
        if (
          input.protocol.benchmarkTarget.officialEvaluatorFirst &&
          !phase42HasOfficialEvaluatorProof(row, artifacts?.score, input.artifactHashesByPath)
        ) {
          failures.push(phase42Failure(row, 'official_evaluator_missing', 'Official evaluator proof is required before this row can support claims.'));
        }
        if (phase42HasDiagnosticFallback(row, artifacts?.score)) {
          failures.push(phase42Failure(row, 'diagnostic_fallback_only', 'Diagnostic fallback scoring cannot satisfy the claim-bearing evidence gate.'));
        }
        if (!phase42HasLaneIsolationProof(row, artifacts?.laneIsolation, input.lanePoliciesById[row.lane_id])) {
          failures.push(
            phase42Failure(
              row,
              artifacts?.laneIsolation?.violations?.length ? 'lane_isolation_violation' : 'lane_isolation_missing',
              'Lane isolation must be proven by explicit allowed/observed tool evidence.'
            )
          );
        }
        if (!phase42HasMeasuredSetupIndex(row, artifacts?.setupIndex)) {
          failures.push(phase42Failure(row, 'setup_index_cost_missing', 'Setup/index statuses, durations, and log references are required.'));
        }
        if (!phase42HasRunnerProvenance(row, artifacts?.rawTrace, input.expectedRunnerHash)) {
          failures.push(phase42Failure(row, 'runner_provenance_mismatch', 'Raw trace executor/model metadata must match the manifest row.'));
        }
      }
    }
  }
  const blockingFailures = failures.filter((failure) => failure.code !== 'artifact_verification_missing');
  return {
    shapePass: blockingFailures.length === 0,
    claimPass: failures.length === 0,
    diagnosticOnly: failures.length > 0,
    failures
  };
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function phase42LoaderFailures(loaded, sessionRoot) {
  const failures = [];
  const indexedPaths = new Set((loaded.session?.artifactIndex ?? []).map((artifact) => artifact.path));
  const registeredArmIds = existsSync(FIXTURES.codebaseContextBaselineArms)
    ? new Set((readJson(FIXTURES.codebaseContextBaselineArms).arms ?? []).map((arm) => arm.baselineArmId))
    : new Set();
  if (!loaded.session) {
    failures.push({ code: 'session_missing', message: 'BASELINE-SESSION.json is required.' });
  } else {
    const expectedSessionHash = computeSessionHash(loaded.session);
    if (loaded.session.sessionHash !== expectedSessionHash) {
      failures.push({ code: 'session_hash_mismatch', message: 'Session hash does not match BASELINE-SESSION.json content.' });
    }
    if (loaded.session.sealed !== true) {
      failures.push({ code: 'session_not_sealed', message: 'Claim-bearing Phase 42 verification requires a sealed session.' });
    }
    for (const artifact of loaded.session.artifactIndex ?? []) {
      const artifactPath = join(sessionRoot, artifact.path);
      if (!existsSync(artifactPath)) {
        failures.push({ code: 'session_artifact_missing', path: artifact.path, message: 'Indexed session artifact is missing.' });
      } else {
        const actualHash = hashFile(artifactPath);
        if (actualHash !== artifact.hash) {
          failures.push({
            code: 'session_artifact_hash_mismatch',
            path: artifact.path,
            message: 'Indexed session artifact hash does not match current file content.'
          });
        }
      }
    }
  }
  for (const error of loaded.readErrors) {
    failures.push({
      code: 'artifact_read_error',
      runId: error.runId,
      path: error.path,
      message: `Required artifact could not be read: ${error.reason}`
    });
  }
  for (const error of loaded.integrityErrors) {
    failures.push({
      code: 'artifact_hash_mismatch',
      runId: error.runId,
      path: error.path,
      message: `Manifest artifact hash mismatch: ${error.reason}`
    });
  }
  for (const row of [...loaded.requiredRows, ...loaded.supplementalRows, ...loaded.unexpectedRows]) {
    for (const key of [
      'raw_trace_path',
      'structured_answer_path',
      'trajectory_path',
      'score_path',
      'setup_index_path',
      'prompt_path',
      'lane_tool_card_path'
    ]) {
      const value = row[key];
      const relativePath = value && isAbsolute(value) ? normalizePath(relative(sessionRoot, value)) : null;
      if (!value || !isAbsolute(value)) {
        failures.push(phase42Failure(row, 'artifact_path_invalid', `${key} must be absolute.`));
      } else if (!isPathInside(sessionRoot, value)) {
        failures.push(phase42Failure(row, 'artifact_path_outside_session', `${key} must stay inside the session root.`));
      } else if (!relativePath || !indexedPaths.has(relativePath)) {
        failures.push(phase42Failure(row, 'artifact_not_indexed', `${key} must be present in the sealed session artifact index.`));
      }
    }
  }
  for (const row of loaded.unexpectedRows) {
    failures.push(
      phase42Failure(
        row,
        'unexpected_run_row',
        'Rows outside the required denominator must be explicit registered diagnostic arms.'
      )
    );
  }
  for (const row of loaded.supplementalRows) {
    const baselineArmId = row.scoring?.baselineArmId;
    if (
      row.lane_id !== 'codebase-context' ||
      row.scoring?.claimBearing !== false ||
      typeof baselineArmId !== 'string' ||
      !registeredArmIds.has(baselineArmId) ||
      !row.run_id.startsWith(`${baselineArmId}-`)
    ) {
      failures.push(
        phase42Failure(
          row,
          'invalid_supplemental_row',
          'Supplemental diagnostic rows must be non-claim-bearing registered codebase-context arms.'
        )
      );
    }
  }
  return failures;
}

function verifyPhase42Session(args) {
  if (!args.session) throw new Error('--phase42-verify requires --session <session-root>');
  const sessionRoot = ensureBaselineSessionRoot(args.session);
  const fixtures = validateFixtures();
  const loaded = loadPhase42SessionEvidence(sessionRoot, fixtures);
  const gate = evaluatePhase42EvidenceGate(loaded.gateInput);
  const failures = [...gate.failures, ...phase42LoaderFailures(loaded, sessionRoot)];
  const claimPass = failures.length === 0;
  const shapePass = failures.filter((failure) => failure.code !== 'artifact_verification_missing').length === 0;
  const failureCounts = countBy(failures.map((failure) => failure.code));
  const report = {
    generatedAt: new Date().toISOString(),
    sessionRoot: normalizePath(sessionRoot),
    claimBearing: claimPass,
    claimPass,
    shapePass,
    diagnosticOnly: !claimPass,
    protocolClaimAllowed: fixtures.protocol.claimAllowed,
    expectedTotalRows: loaded.gateInput.expectedTotalRows,
    requiredRows: loaded.requiredRows.length,
    supplementalRows: loaded.supplementalRows.length,
    unexpectedRows: loaded.unexpectedRows.length,
    reservations: loaded.reservations.length,
    sessionSealed: loaded.session?.sealed ?? false,
    rowStatusCounts: countBy(loaded.requiredRows.map((row) => row.status)),
    laneStatusCounts: countBy(loaded.requiredRows.map((row) => `${row.lane_id}:${row.status}`)),
    failureCounts,
    readErrors: loaded.readErrors,
    integrityErrors: loaded.integrityErrors,
    runnerHashes: {
      expected: loaded.gateInput.expectedRunnerHash ?? null,
      current: loaded.gateInput.currentRunnerHash ?? null
    },
    fixtureHashes: {
      protocol: loaded.gateInput.expectedProtocolHash,
      taskManifest: loaded.gateInput.expectedTaskManifestHash
    },
    safeClaims: claimPass
      ? ['Phase 42 evidence gate passed for this sealed artifact set']
      : [
          'harness repair in progress',
          'diagnostic artifact',
          'non-claim-bearing provenance evidence',
          'blocked pending verifier/challenger'
        ],
    blockedClaims: [
      ...(claimPass ? [] : ['Phase 42 passed']),
      'benchmark win',
      'competitor loss',
      'agent-outcome improvement',
      'product change authorized by evidence',
      'setup_failed is a loss'
    ],
    failures
  };
  if (args.out) writeJson(resolve(args.out), report);
  if (args.quiet) {
    console.log(
      `phase42 verification ${claimPass ? 'passed' : 'failed'}: requiredRows=${report.requiredRows}/${report.expectedTotalRows}, supplementalRows=${report.supplementalRows}`
    );
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  if (!claimPass) {
    throw new Error(
      `phase42 verification failed: ${Object.entries(failureCounts)
        .map(([code, count]) => `${code}=${count}`)
        .join(', ')}`
    );
  }
}

function validateBaselineSession(args) {
  if (!args.session) throw new Error('--baseline-validate requires --session <session-root>');
  const sessionRoot = ensureBaselineSessionRoot(args.session);
  const fixtures = validateFixtures();
  const sessionPath = join(sessionRoot, 'BASELINE-SESSION.json');
  const reservationPath = join(sessionRoot, 'slot-reservations.json');
  const errors = [];
  if (!existsSync(sessionPath)) errors.push('BASELINE-SESSION.json missing');
  if (!existsSync(reservationPath)) errors.push('slot-reservations.json missing');
  if (errors.length === 0) {
    const session = readJson(sessionPath);
    const expectedHash = computeSessionHash(session);
    if (session.sessionHash !== expectedHash) errors.push('session hash mismatch');
    if (session.claimBearing !== false) errors.push('session must be non-claim-bearing');
    if (!session.snapshot?.snapshotHash) errors.push('snapshot hash missing');
    if (
      session.snapshot?.redactedEnvVarNames?.some(
        (name) =>
          String(process.env[name] ?? '').length > 0 &&
          JSON.stringify(session).includes(String(process.env[name]))
      )
    ) {
      errors.push('session appears to include an environment secret value');
    }
    for (const artifact of session.artifactIndex ?? []) {
      const artifactPath = join(sessionRoot, artifact.path);
      if (!existsSync(artifactPath)) errors.push(`indexed artifact missing: ${artifact.path}`);
      else if (hashFile(artifactPath) !== artifact.hash)
        errors.push(`indexed artifact hash mismatch: ${artifact.path}`);
    }
  }
  const reservations = existsSync(reservationPath)
    ? (readJson(reservationPath).reservations ?? [])
    : [];
  const expectedSlots =
    fixtures.manifest.tasks.length *
    fixtures.lanes.broadClaimLaneSet.length *
    (fixtures.protocol.runPolicy?.claimBearingRunsPerTaskLane ?? 3);
  if (reservations.length !== expectedSlots)
    errors.push(`expected ${expectedSlots} reserved slots, found ${reservations.length}`);
  const rows = readManifestRowsIfPresent(sessionRoot);
  validateSessionPaths(sessionRoot, rows, errors);
  const blockedReservations = reservations.filter(
    (slot) => slot.status === 'terminal_missing_evidence'
  );
  const blockedRows = rows.filter(
    (row) =>
      row.status === 'setup_failed' && ['grepai', 'codebase-memory-mcp'].includes(row.lane_id)
  );
  if (blockedRows.length !== blockedReservations.length) {
    errors.push('terminal missing-evidence rows must be present for every blocked reservation');
  }
  if (errors.length > 0)
    throw new Error(`baseline session validation failed:\n- ${errors.join('\n- ')}`);
  console.log('baseline session validation passed');
}

function sealBaselineSession(args) {
  if (!args.session) throw new Error('--baseline-seal requires --session <session-root>');
  const sessionRoot = ensureBaselineSessionRoot(args.session);
  const session = readSession(sessionRoot);
  const reservations = readJson(join(sessionRoot, 'slot-reservations.json')).reservations ?? [];
  const rows = readManifestRowsIfPresent(sessionRoot);
  const rowKeys = new Set(rows.map((row) => `${row.lane_id}:${row.task_id}:${row.repeat_index}`));
  const missing = reservations.filter(
    (slot) => !rowKeys.has(`${slot.laneId}:${slot.taskId}:${slot.repeatIndex}`)
  );
  if (missing.length > 0)
    throw new Error(`cannot seal baseline session; ${missing.length} slots lack terminal evidence`);
  session.sealed = true;
  session.artifactIndex = refreshArtifactIndex(sessionRoot);
  writeSession(sessionRoot, session);
  validateBaselineSession({ session: sessionRoot });
  try {
    verifyPhase42Session({ session: sessionRoot, quiet: true });
  } catch (error) {
    throw new Error(`baseline seal blocked by Phase 42 evidence gate: ${error.message}`);
  }
  console.log(`baseline session sealed ${join(sessionRoot, 'BASELINE-SESSION.json')}`);
}

function refreshBaselineSession(args) {
  if (!args.session) throw new Error('--baseline-refresh requires --session <session-root>');
  const sessionRoot = ensureBaselineSessionRoot(args.session);
  const session = readSession(sessionRoot);
  session.sealed = false;
  session.artifactIndex = refreshArtifactIndex(sessionRoot);
  writeSession(sessionRoot, session);
  console.log(`baseline session refreshed ${join(sessionRoot, 'BASELINE-SESSION.json')}`);
}

function runDryRun(args) {
  if (args.executor !== 'fake') throw new Error('--dry-run currently requires --executor fake');
  if (!args.lane || !args.taskId || !args.out)
    throw new Error('--dry-run requires --lane, --task-id, and --out');
  const fixtures = validateFixtures();
  const laneCard = fixtures.laneToolCards.cards.find((card) => card.laneId === args.lane);
  if (!laneCard) throw new Error(`unknown lane: ${args.lane}`);
  if (!laneCard.executableInPhase38)
    throw new Error(`lane ${args.lane} is pending Phase 39 and is not executable in Phase 38`);
  const task = fixtures.manifest.tasks.find((candidate) => candidate.instance_id === args.taskId);
  if (!task) throw new Error(`unknown task-id: ${args.taskId}`);

  const outDir = resolve(args.out);
  const repeat = Number.isInteger(args.repeat) && args.repeat > 0 ? args.repeat : 1;
  const runId = sanitize(`${laneCard.laneId}-${task.instance_id}-${repeat}-fake`);
  const runDir = join(outDir, 'runs', runId);
  const paths = {
    prompt: join(runDir, 'prompt.txt'),
    laneCard: join(runDir, 'lane-card.json'),
    setupIndex: join(runDir, 'setup-index.json'),
    rawTrace: join(runDir, 'raw-trace.json'),
    structuredAnswer: join(runDir, 'structured-answer.json'),
    trajectory: join(runDir, 'trajectory.json'),
    score: join(runDir, 'score.json'),
    manifest: join(outDir, 'run-manifest.jsonl')
  };
  const startedAt = new Date().toISOString();
  const prompt = [
    `Task: ${task.instance_id}`,
    `Lane: ${laneCard.laneId}`,
    'Return only structured JSON with answer, confidence, evidence, filesReferenced, symbolsReferenced, unsupportedClaims, readyToEdit.',
    'Do not use tools outside the lane tool card.'
  ].join('\n');
  const answer = {
    answer: { smoke: true, taskId: task.instance_id },
    confidence: 'medium',
    evidence: [
      {
        file: 'SMOKE_ONLY.md',
        lineRange: { start: 1, end: 1 },
        reason: 'fake executor non-claim-bearing smoke evidence'
      }
    ],
    filesReferenced: ['SMOKE_ONLY.md'],
    symbolsReferenced: [],
    unsupportedClaims: [],
    readyToEdit: false
  };
  const trajectory = buildTrajectory(task, answer);
  const rawTrace = {
    executor: 'fake',
    runnerHash: runnerSourceHash(),
    claimBearing: false,
    stdout: JSON.stringify(answer),
    stderr: '',
    toolCalls: [],
    laneIsolation: buildLaneIsolationEvidence(laneCard),
    scriptedAgentDecisions: false
  };
  const score = {
    status: 'completed',
    mode: 'phase38_smoke_no_official_claim',
    ...diagnosticFallbackScoring(fixtures, 'dry_run_fake_executor_smoke_only')
  };
  const setupIndex = {
    setupCommand: laneCard.setupCommand,
    indexCommand: laneCard.indexCommand,
    setupDurationMs: 0,
    indexDurationMs: 0,
    setupStatus: laneCard.setupCommand === 'none' ? 'not_required' : 'completed',
    indexStatus: laneCard.indexCommand === 'none' ? 'not_required' : 'completed'
  };
  mkdirSync(runDir, { recursive: true });
  writeFileSync(paths.prompt, prompt, 'utf8');
  writeJson(paths.laneCard, laneCard);
  writeJson(paths.setupIndex, setupIndex);
  writeJson(paths.rawTrace, rawTrace);
  writeJson(paths.structuredAnswer, answer);
  writeJson(paths.trajectory, trajectory);
  writeJson(paths.score, score);
  const completedAt = new Date().toISOString();
  const row = {
    run_id: runId,
    protocol_version: fixtures.protocol.protocolVersion,
    protocol_hash: hashObject(fixtures.protocol),
    task_manifest_hash: fixtures.manifest.manifest_hash,
    lane_id: laneCard.laneId,
    task_id: task.instance_id,
    repeat_index: repeat,
    status: 'completed',
    started_at: startedAt,
    completed_at: completedAt,
    raw_trace_path: paths.rawTrace,
    structured_answer_path: paths.structuredAnswer,
    trajectory_path: paths.trajectory,
    score_path: paths.score,
    setup_index_path: paths.setupIndex,
    prompt_path: paths.prompt,
    lane_tool_card_path: paths.laneCard,
    setupIndex,
    taskExecution: {
      model: 'fake-executor',
      timeoutSeconds: fixtures.protocol.budgets.defaults.timeoutSeconds,
      maxContextTokens: fixtures.protocol.budgets.defaults.maxContextTokens,
      maxAnswerTokens: fixtures.protocol.budgets.defaults.maxAnswerTokens,
      startedAt,
      completedAt,
      taskWallTimeMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      executor: 'fake'
    },
    scoring: diagnosticFallbackScoring(fixtures, 'dry_run_fake_executor_smoke_only'),
    hashes: {
      prompt: sha256(prompt),
      laneToolCard: hashObject(laneCard),
      structuredAnswer: hashObject(answer),
      trajectory: hashObject(trajectory),
      score: hashObject(score),
      runnerSourceHash: runnerSourceHash()
    }
  };
  mkdirSync(dirname(paths.manifest), { recursive: true });
  appendFileSync(paths.manifest, `${JSON.stringify(row)}\n`, 'utf8');
  console.log(`dry-run wrote ${runDir}`);
}

function runScoreProbe(args) {
  if (!args.out) throw new Error('--score-probe requires --out <dir>');
  const fixtures = validateFixtures();
  const outDir = resolve(args.out);
  const goldPath = join(outDir, 'synthetic-gold.json');
  const predPath = join(outDir, 'synthetic-prediction.json');
  const scorePath = join(outDir, 'score.json');
  writeJson(goldPath, { synthetic: true, claimBearing: false });
  writeJson(predPath, { synthetic: true, claimBearing: false });
  const score = {
    status: 'judge_failed',
    mode: 'diagnostic_fallback',
    stdout: '',
    stderr: 'mock official evaluator unavailable in Phase 38 score probe',
    exitStatus: 1,
    ...diagnosticFallbackScoring(
      fixtures,
      'mocked_official_evaluator_failure_for_non_claim_probe'
    )
  };
  writeJson(scorePath, score);
  console.log(`score-probe wrote ${scorePath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || process.argv.length <= 2) {
    help();
    return;
  }
  if (args.validateFixtures) {
    validateFixtures();
    console.log('fixture validation passed');
    return;
  }
  if (args.validateLaneSetup) {
    validateLaneSetupEvidence();
    console.log('lane setup validation passed');
    return;
  }
  if (args.baselineSnapshot) {
    createBaselineSnapshot(args);
    return;
  }
  if (args.setupIndexMeasure) {
    runSetupIndexMeasure(args);
    return;
  }
  if (args.setupIndexImport) {
    runSetupIndexImport(args);
    return;
  }
  if (args.baselineRun) {
    runBaseline(args);
    return;
  }
  if (args.baselineRefresh) {
    refreshBaselineSession(args);
    return;
  }
  if (args.baselineRunCodebaseContextArms) {
    runBaselineCodebaseContextArms(args);
    return;
  }
  if (args.baselineSeal) {
    sealBaselineSession(args);
    return;
  }
  if (args.baselineValidate) {
    validateBaselineSession(args);
    return;
  }
  if (args.phase42Verify) {
    verifyPhase42Session(args);
    return;
  }
  if (args.baselineValidateArms) {
    validateBaselineArms(args.baselineValidateArms);
    return;
  }
  if (args.printClaudeArgs) {
    console.log(JSON.stringify(claudeArgsForModel(args.model ?? ''), null, 2));
    return;
  }
  if (args.printAnswerSchema) {
    console.log(JSON.stringify(CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA, null, 2));
    return;
  }
  if (args.dryRun) {
    runDryRun(args);
    return;
  }
  if (args.scoreProbe) {
    runScoreProbe(args);
    return;
  }
  throw new Error('No mode selected. Use --help.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
