#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_GOLD_DIR = 'benchmark-runs/contextbench/phase41/official-gold-inputs-hf-20260511';
const DEFAULT_EVALUATOR_CWD =
  'benchmark-runs/contextbench/phase40/evaluator-probe-20260427/ContextBench-official';

function help() {
  console.log(`Score existing retrieval-gate artifacts with official ContextBench gold.

Usage:
  node scripts/contextbench-score-retrieval-gate-artifacts.mjs --session <run-root> --gate <gate-name> [options]

Options:
  --gold-dir <dir>       Directory containing <task-id>.gold.json files.
  --evaluator-cwd <dir>  Checkout containing contextbench/evaluate.py.
  --out <dir>            Output directory for sidecar scores and summary.
  --limit <n>            Score only the first n rows, for smoke testing.
  --force                Replace an existing output directory.

Rules:
  - Reads existing trajectories only.
  - Does not rerun retrieval lanes.
  - Does not overwrite original retrieval-gate score.json files.
  - Emits retrieval-overlap evidence, not patch-quality evidence.
`);
}

function parseArgs(argv) {
  const args = {
    session: '',
    gate: '',
    goldDir: DEFAULT_GOLD_DIR,
    evaluatorCwd: DEFAULT_EVALUATOR_CWD,
    out: '',
    limit: 0,
    force: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--session') args.session = argv[++index] ?? '';
    else if (arg === '--gate') args.gate = argv[++index] ?? '';
    else if (arg === '--gold-dir') args.goldDir = argv[++index] ?? DEFAULT_GOLD_DIR;
    else if (arg === '--evaluator-cwd') args.evaluatorCwd = argv[++index] ?? DEFAULT_EVALUATOR_CWD;
    else if (arg === '--out') args.out = argv[++index] ?? '';
    else if (arg === '--limit') args.limit = Number(argv[++index] ?? '0');
    else if (arg === '--force') args.force = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readJsonIfPresent(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  return readJson(filePath);
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function appendJsonl(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'a' });
}

function sha256Buffer(buffer) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

function fileBytes(filePath) {
  return existsSync(filePath) ? statSync(filePath).size : null;
}

function sanitize(value) {
  return String(value)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function progressPath(sessionRoot, gate) {
  return join(sessionRoot, `${gate.toUpperCase()}-PROGRESS.json`);
}

function laneRowsFromProgress(progress) {
  const rows = [];
  for (const record of progress.completed ?? []) {
    for (const row of record.summary?.rows ?? []) {
      rows.push({
        progressRecord: record,
        row
      });
    }
  }
  return rows;
}

function metric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function officialMetrics(officialResult) {
  const final = officialResult?.final ?? {};
  return {
    fileCoverage: metric(final.file?.coverage),
    filePrecision: metric(final.file?.precision),
    symbolCoverage: metric(final.symbol?.coverage),
    symbolPrecision: metric(final.symbol?.precision),
    spanCoverage: metric(final.span?.coverage),
    spanPrecision: metric(final.span?.precision),
    lineCoverage: metric(final.line?.coverage),
    linePrecision: metric(final.line?.precision),
    editlocRecall: metric(officialResult?.editloc?.recall),
    editlocPrecision: metric(officialResult?.editloc?.precision)
  };
}

function mean(values) {
  const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function median(values) {
  const numbers = values
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (numbers.length === 0) return null;
  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2 === 1) return numbers[middle];
  return (numbers[middle - 1] + numbers[middle]) / 2;
}

function sum(values) {
  const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return numbers.reduce((total, value) => total + value, 0);
}

function maxOrNull(values) {
  const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return Math.max(...numbers);
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function summarizeMetrics(rows) {
  const names = [
    'fileCoverage',
    'filePrecision',
    'symbolCoverage',
    'symbolPrecision',
    'spanCoverage',
    'spanPrecision',
    'lineCoverage',
    'linePrecision',
    'editlocRecall',
    'editlocPrecision'
  ];
  return Object.fromEntries(
    names.map((name) => [
      name,
      {
        mean: mean(rows.map((row) => row.metrics?.[name])),
        median: median(rows.map((row) => row.metrics?.[name])),
        measuredRows: rows.filter((row) => row.metrics?.[name] != null).length
      }
    ])
  );
}

function zeroFilledMetrics(row) {
  if (row.metrics) return row.metrics;
  return {
    fileCoverage: 0,
    filePrecision: 0,
    symbolCoverage: 0,
    symbolPrecision: 0,
    spanCoverage: 0,
    spanPrecision: 0,
    lineCoverage: 0,
    linePrecision: 0,
    editlocRecall: 0,
    editlocPrecision: 0
  };
}

function summarizeMetricsWithFailures(rows) {
  return summarizeMetrics(rows.map((row) => ({ metrics: zeroFilledMetrics(row) })));
}

function telemetrySummary(telemetryPath) {
  const telemetry = readJsonIfPresent(telemetryPath);
  const summary = telemetry?.telemetry?.summary ?? {};
  return {
    durationMs: typeof telemetry?.durationMs === 'number' ? telemetry.durationMs : null,
    peakWorkingSetBytes:
      typeof summary.peakWorkingSetBytes === 'number' ? summary.peakWorkingSetBytes : null,
    peakPrivateBytes:
      typeof summary.peakPrivateBytes === 'number' ? summary.peakPrivateBytes : null,
    minFreeMemoryBytes:
      typeof summary.minFreeMemoryBytes === 'number' ? summary.minFreeMemoryBytes : null,
    cpuSecondsMaxObserved:
      typeof summary.cpuSecondsMaxObserved === 'number' ? summary.cpuSecondsMaxObserved : null,
    peakProcessCount:
      typeof summary.peakProcessCount === 'number' ? summary.peakProcessCount : null,
    processNames: Array.isArray(summary.processNames) ? summary.processNames : [],
    gpuAvailable: telemetry?.gpuTelemetry?.summary?.available ?? null,
    gpuMethod: telemetry?.gpuTelemetry?.summary?.method ?? null,
    gpuReason: telemetry?.gpuTelemetry?.summary?.reason ?? null
  };
}

function costEvidence(row, progressRecord) {
  const setup = readJsonIfPresent(row.setup_index_path) ?? {};
  const rawTrace = readJsonIfPresent(row.raw_trace_path) ?? {};
  const telemetry = telemetrySummary(progressRecord.telemetryPath);
  return {
    setupStatus: setup.setupStatus ?? null,
    indexStatus: setup.indexStatus ?? null,
    setupDurationMs: setup.setupDurationMs ?? null,
    indexDurationMs: setup.indexDurationMs ?? null,
    queryDurationMs: setup.queryDurationMs ?? rawTrace.trace?.durationMs ?? null,
    indexExitStatus: setup.indexExitStatus ?? null,
    postIndexExitReason: setup.postIndexExitReason ?? null,
    setupCommand: setup.setupCommand ?? null,
    indexCommand: setup.indexCommand ?? null,
    embeddingProvider: setup.embeddingProvider ?? null,
    embeddingModel: setup.embeddingModel ?? null,
    indexMode: setup.indexMode ?? null,
    indexBackend: setup.indexBackend ?? null,
    isolatedContextDir: setup.isolatedContextDir ?? null,
    paidProviderAttempted: setup.paidProviderAttempted ?? null,
    hostedCallAttempted: setup.hostedCallAttempted ?? null,
    apiKeysCleared: setup.apiKeysCleared ?? null,
    indexedFiles: setup.indexedFiles ?? setup.filesIndexed ?? null,
    indexedBytes: setup.indexedBytes ?? null,
    maxIndexedBytes: setup.maxIndexedBytes ?? null,
    skippedByCap: setup.skippedByCap ?? null,
    truncatedIndex: setup.truncatedIndex ?? null,
    filesIndexed: setup.filesIndexed ?? null,
    symbolsIndexed: setup.symbolsIndexed ?? null,
    graphNodes: setup.graphNodes ?? null,
    graphEdges: setup.graphEdges ?? null,
    repowiseDirBytes: setup.repowiseDirBytes ?? null,
    uvCacheBytes: setup.uvCacheBytes ?? null,
    retrievedItemCount: Array.isArray(rawTrace.retrievedItems)
      ? rawTrace.retrievedItems.length
      : null,
    telemetry
  };
}

function summarizeCosts(rows) {
  const costs = rows.map((row) => row.cost ?? {});
  const telemetry = costs.map((cost) => cost.telemetry ?? {});
  const statusValues = (field) => countBy(costs.map((cost) => String(cost[field] ?? 'unknown')));
  const booleanValues = (field) => countBy(costs.map((cost) => String(cost[field] ?? 'unknown')));
  return {
    setupStatusCounts: statusValues('setupStatus'),
    indexStatusCounts: statusValues('indexStatus'),
    indexExitStatusCounts: statusValues('indexExitStatus'),
    postIndexExitReasonCounts: statusValues('postIndexExitReason'),
    embeddingProviders: statusValues('embeddingProvider'),
    embeddingModels: statusValues('embeddingModel'),
    indexModes: statusValues('indexMode'),
    paidProviderAttemptedCounts: booleanValues('paidProviderAttempted'),
    hostedCallAttemptedCounts: booleanValues('hostedCallAttempted'),
    apiKeysClearedCounts: booleanValues('apiKeysCleared'),
    setupDurationMs: {
      sum: sum(costs.map((cost) => cost.setupDurationMs)),
      median: median(costs.map((cost) => cost.setupDurationMs)),
      mean: mean(costs.map((cost) => cost.setupDurationMs))
    },
    indexDurationMs: {
      sum: sum(costs.map((cost) => cost.indexDurationMs)),
      median: median(costs.map((cost) => cost.indexDurationMs)),
      mean: mean(costs.map((cost) => cost.indexDurationMs))
    },
    queryDurationMs: {
      sum: sum(costs.map((cost) => cost.queryDurationMs)),
      median: median(costs.map((cost) => cost.queryDurationMs)),
      mean: mean(costs.map((cost) => cost.queryDurationMs))
    },
    rowWallDurationMs: {
      sum: sum(telemetry.map((item) => item.durationMs)),
      median: median(telemetry.map((item) => item.durationMs)),
      mean: mean(telemetry.map((item) => item.durationMs))
    },
    peakWorkingSetBytesMax: maxOrNull(telemetry.map((item) => item.peakWorkingSetBytes)),
    peakPrivateBytesMax: maxOrNull(telemetry.map((item) => item.peakPrivateBytes)),
    cpuSecondsMaxObservedMax: maxOrNull(telemetry.map((item) => item.cpuSecondsMaxObserved)),
    peakProcessCountMax: maxOrNull(telemetry.map((item) => item.peakProcessCount)),
    indexedFiles: {
      median: median(costs.map((cost) => cost.indexedFiles)),
      mean: mean(costs.map((cost) => cost.indexedFiles))
    },
    indexedBytes: {
      median: median(costs.map((cost) => cost.indexedBytes)),
      mean: mean(costs.map((cost) => cost.indexedBytes))
    },
    retrievedItemCount: {
      median: median(costs.map((cost) => cost.retrievedItemCount)),
      mean: mean(costs.map((cost) => cost.retrievedItemCount))
    },
    gpuAvailableCounts: countBy(telemetry.map((item) => String(item.gpuAvailable ?? 'unknown'))),
    gpuReasonCounts: countBy(telemetry.map((item) => String(item.gpuReason ?? 'unknown')))
  };
}

function officialEvaluatorEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  env.GOMAXPROCS = env.GOMAXPROCS || '2';
  env.RAYON_NUM_THREADS = env.RAYON_NUM_THREADS || '2';
  env.UV_THREADPOOL_SIZE = env.UV_THREADPOOL_SIZE || '2';
  env.OMP_NUM_THREADS = env.OMP_NUM_THREADS || '2';
  env.MKL_NUM_THREADS = env.MKL_NUM_THREADS || '2';
  env.OPENBLAS_NUM_THREADS = env.OPENBLAS_NUM_THREADS || '2';
  env.TOKENIZERS_PARALLELISM = env.TOKENIZERS_PARALLELISM || 'false';
  const configCount = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
  const nextConfigIndex = Number.isFinite(configCount) && configCount >= 0 ? configCount : 0;
  env[`GIT_CONFIG_KEY_${nextConfigIndex}`] = 'core.longpaths';
  env[`GIT_CONFIG_VALUE_${nextConfigIndex}`] = 'true';
  env.GIT_CONFIG_COUNT = String(nextConfigIndex + 1);
  if (!env.CONTEXTBENCH_TMP_ROOT && process.platform === 'win32') {
    env.CONTEXTBENCH_TMP_ROOT = 'C:\\tmp\\contextbench-worktrees';
  }
  return env;
}

function validateInputs(args) {
  if (args.help) return;
  if (!args.session) throw new Error('--session is required');
  if (!args.gate) throw new Error('--gate is required');
  if (!Number.isInteger(args.limit) || args.limit < 0)
    throw new Error('--limit must be a non-negative integer');
}

function assertForceRemovalInsideSession({ outputRoot, sessionRoot }) {
  const rel = relative(sessionRoot, outputRoot);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `refusing to --force remove output outside session root: output=${outputRoot} session=${sessionRoot}`
    );
  }
}

function parseOfficialResult(outputPath) {
  if (!existsSync(outputPath)) return { ok: false, reason: 'official_results_missing' };
  const content = readFileSync(outputPath, 'utf8').trim();
  if (!content) return { ok: false, reason: 'official_results_empty' };
  const firstLine = content.split(/\r?\n/)[0];
  try {
    const parsed = JSON.parse(firstLine);
    if (typeof parsed?.error === 'string' && parsed.error.length > 0) {
      return { ok: false, reason: `official_result_error:${parsed.error}`, result: parsed };
    }
    return { ok: true, result: parsed };
  } catch {
    return { ok: false, reason: 'official_results_malformed_jsonl' };
  }
}

function scoreOne({ item, index, args, paths }) {
  const { row, progressRecord } = item;
  const taskId = row.task_id;
  const laneId = row.lane_id;
  const runId = row.run_id;
  const rowOutDir = join(
    paths.outputRoot,
    'rows',
    `${String(index + 1).padStart(3, '0')}-${sanitize(taskId)}`,
    sanitize(laneId)
  );
  const goldPath = join(paths.goldDir, `${taskId}.gold.json`);
  const officialResultsPath = join(rowOutDir, 'official-results.jsonl');
  const stdoutPath = join(rowOutDir, 'official-evaluator.stdout.log');
  const stderrPath = join(rowOutDir, 'official-evaluator.stderr.log');
  const scorePath = join(rowOutDir, 'score.json');
  const startedAt = new Date();
  const missing = [];
  for (const [label, filePath] of [
    ['trajectory', row.trajectory_path],
    ['gold', goldPath],
    ['rawTrace', row.raw_trace_path],
    ['setupIndex', row.setup_index_path],
    ['telemetry', progressRecord.telemetryPath]
  ]) {
    if (!filePath || !existsSync(filePath)) missing.push(label);
  }
  let evaluator = null;
  let official = {
    ok: false,
    reason: missing.length ? `missing_artifacts:${missing.join(',')}` : null
  };
  if (missing.length === 0) {
    mkdirSync(rowOutDir, { recursive: true });
    const commandArgs = [
      '-m',
      'contextbench.evaluate',
      '--gold',
      resolve(goldPath),
      '--pred',
      resolve(row.trajectory_path),
      '--cache',
      resolve(paths.cacheDir),
      '--out',
      resolve(officialResultsPath)
    ];
    const result = spawnSync('python', commandArgs, {
      cwd: paths.evaluatorCwd,
      env: officialEvaluatorEnv(),
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    });
    writeFileSync(stdoutPath, result.stdout ?? '', 'utf8');
    writeFileSync(stderrPath, result.stderr ?? '', 'utf8');
    official = parseOfficialResult(officialResultsPath);
    evaluator = {
      command: ['python', ...commandArgs].join(' '),
      cwd: paths.evaluatorCwd,
      exitStatus: typeof result.status === 'number' ? result.status : null,
      signal: result.signal ?? null,
      error: result.error?.message ?? null,
      stdoutPath,
      stderrPath,
      stdoutHash: existsSync(stdoutPath) ? sha256File(stdoutPath) : null,
      stderrHash: existsSync(stderrPath) ? sha256File(stderrPath) : null,
      outputPath: officialResultsPath,
      outputHash: existsSync(officialResultsPath) ? sha256File(officialResultsPath) : null
    };
  }
  const completedAt = new Date();
  const status = evaluator?.exitStatus === 0 && official.ok ? 'completed' : 'judge_failed';
  const score = {
    schemaVersion: 1,
    mode: status === 'completed' ? 'official_evaluator' : 'official_evaluator_failed',
    status,
    claimBearing: false,
    retrievalOnly: true,
    evidenceKind: 'retrieval_overlap_only',
    officialEvaluatorFirst: true,
    officialEvaluatorAttempted: missing.length === 0,
    officialEvaluatorInvoked: missing.length === 0,
    fallbackReason:
      status === 'completed' ? null : (official.reason ?? 'official_evaluator_failed'),
    taskId,
    laneId,
    runId,
    goldInputSourcePath: goldPath,
    goldInputSourceHash: existsSync(goldPath) ? sha256File(goldPath) : null,
    trajectoryPath: row.trajectory_path,
    trajectoryHash: existsSync(row.trajectory_path) ? sha256File(row.trajectory_path) : null,
    officialResult: official.result ?? null,
    metrics: official.ok ? officialMetrics(official.result) : null,
    evaluator,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime()
  };
  writeJson(scorePath, score);
  return {
    taskId,
    laneId,
    runId,
    status,
    reason: score.fallbackReason,
    originalStatus: row.status,
    retrievalOnly: true,
    claimBearing: false,
    metrics: score.metrics,
    durationMs: score.durationMs,
    paths: {
      originalRawTrace: row.raw_trace_path,
      originalTrajectory: row.trajectory_path,
      originalSetupIndex: row.setup_index_path,
      originalScore: row.score_path,
      telemetry: progressRecord.telemetryPath,
      gold: goldPath,
      sidecarScore: scorePath,
      officialResults: officialResultsPath
    },
    hashes: {
      originalRawTrace: existsSync(row.raw_trace_path) ? sha256File(row.raw_trace_path) : null,
      originalTrajectory: existsSync(row.trajectory_path) ? sha256File(row.trajectory_path) : null,
      originalSetupIndex: existsSync(row.setup_index_path)
        ? sha256File(row.setup_index_path)
        : null,
      originalScore: existsSync(row.score_path) ? sha256File(row.score_path) : null,
      telemetry: existsSync(progressRecord.telemetryPath)
        ? sha256File(progressRecord.telemetryPath)
        : null,
      gold: existsSync(goldPath) ? sha256File(goldPath) : null,
      sidecarScore: sha256File(scorePath),
      officialResults: existsSync(officialResultsPath) ? sha256File(officialResultsPath) : null
    },
    bytes: {
      trajectory: fileBytes(row.trajectory_path),
      rawTrace: fileBytes(row.raw_trace_path),
      setupIndex: fileBytes(row.setup_index_path),
      telemetry: fileBytes(progressRecord.telemetryPath),
      officialResults: fileBytes(officialResultsPath)
    },
    cost: costEvidence(row, progressRecord)
  };
}

function buildSummary({ rows, args, paths, startedAt }) {
  const laneIds = [...new Set(rows.map((row) => row.laneId))].sort();
  const taskIds = [...new Set(rows.map((row) => row.taskId))].sort();
  const lanes = laneIds.map((laneId) => {
    const laneRows = rows.filter((row) => row.laneId === laneId);
    return {
      laneId,
      rowCount: laneRows.length,
      completedRows: laneRows.filter((row) => row.status === 'completed').length,
      statusCounts: countBy(laneRows.map((row) => row.status)),
      metrics: summarizeMetrics(laneRows),
      metricsFailureInclusive: summarizeMetricsWithFailures(laneRows),
      cost: summarizeCosts(laneRows),
      evaluatorDurationMs: {
        sum: sum(laneRows.map((row) => row.durationMs)),
        median: median(laneRows.map((row) => row.durationMs))
      }
    };
  });
  const completedAt = new Date();
  const summaryWithoutHash = {
    schemaVersion: 1,
    generatedAt: completedAt.toISOString(),
    evidenceKind: 'official_contextbench_retrieval_overlap_sidecar',
    claimBearing: false,
    retrievalOnly: true,
    publicationBoundary:
      'This scores existing retrieval trajectories against official ContextBench gold. It does not measure patch correctness or free-form agent coding quality.',
    session: paths.sessionRoot,
    gate: args.gate,
    progressPath: paths.progressPath,
    goldDir: paths.goldDir,
    evaluatorCwd: paths.evaluatorCwd,
    outputRoot: paths.outputRoot,
    script: {
      path: SCRIPT_PATH,
      hash: sha256File(SCRIPT_PATH),
      nodeVersion: process.version
    },
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    rowCount: rows.length,
    taskCount: taskIds.length,
    laneCount: laneIds.length,
    expectedSameDenominatorRows: taskIds.length * laneIds.length,
    sameDenominatorRowsPresent: rows.length === taskIds.length * laneIds.length,
    taskIds,
    laneIds,
    statusCounts: countBy(rows.map((row) => row.status)),
    metricViews: {
      completedOnly: 'Means and medians over rows where the official evaluator produced metrics.',
      failureInclusiveZeroFilled:
        'Same metrics with judge_failed/no_context rows counted as zero to prevent hiding missing evidence.'
    },
    lanes,
    caveats: [
      'Rows were generated without reading scorer gold during retrieval.',
      'Original retrieval artifacts are left unchanged; scores are sidecar artifacts.',
      'Metrics are retrieval overlap against gold context, not patch success.',
      'One repeat per lane/task cannot support paper-grade stability or confidence claims.'
    ]
  };
  return {
    ...summaryWithoutHash,
    summaryHash: sha256Buffer(Buffer.from(JSON.stringify(summaryWithoutHash), 'utf8'))
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }
  validateInputs(args);
  const sessionRoot = resolve(args.session);
  const gate = args.gate;
  const progressFile = progressPath(sessionRoot, gate);
  const evaluatorCwd = resolve(args.evaluatorCwd);
  const goldDir = resolve(args.goldDir);
  const outputRoot = resolve(args.out || join(sessionRoot, 'gate5-official-retrieval-scoring'));
  const cacheDir = join(outputRoot, 'official-evaluator-cache');
  if (!existsSync(progressFile)) throw new Error(`progress file missing: ${progressFile}`);
  if (!existsSync(join(evaluatorCwd, 'contextbench', 'evaluate.py'))) {
    throw new Error(`evaluator cwd missing contextbench/evaluate.py: ${evaluatorCwd}`);
  }
  if (!existsSync(goldDir)) throw new Error(`gold dir missing: ${goldDir}`);
  if (existsSync(outputRoot)) {
    if (!args.force) throw new Error(`output dir exists; pass --force to replace: ${outputRoot}`);
    assertForceRemovalInsideSession({ outputRoot, sessionRoot });
    rmSync(outputRoot, { recursive: true, force: true });
  }
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  const progress = readJson(progressFile);
  const allRows = laneRowsFromProgress(progress);
  const rowsToScore = args.limit > 0 ? allRows.slice(0, args.limit) : allRows;
  const paths = {
    sessionRoot,
    progressPath: progressFile,
    evaluatorCwd,
    goldDir,
    outputRoot,
    cacheDir
  };
  const manifestPath = join(outputRoot, 'GATE5-SCORING-MANIFEST.jsonl');
  const startedAt = new Date();
  const scoredRows = [];
  rowsToScore.forEach((item, index) => {
    const row = scoreOne({ item, index, args, paths });
    scoredRows.push(row);
    appendJsonl(manifestPath, row);
    console.log(`${index + 1}/${rowsToScore.length} ${row.laneId} ${row.taskId} ${row.status}`);
  });
  const summary = buildSummary({ rows: scoredRows, args, paths, startedAt });
  writeJson(join(outputRoot, 'GATE5-SCORING-SUMMARY.json'), summary);
  console.log(`gate5 scoring summary wrote ${join(outputRoot, 'GATE5-SCORING-SUMMARY.json')}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
