import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const targetTaskId = process.env.TARGET_TASK_ID || 'SWE-Bench-Pro__go__maintenance__bugfix__4df06349';
const root = process.env.ROOT || '/tmp/contextbench-five-lane-score';
const officialContextBench = process.env.OFFICIAL_CONTEXTBENCH;
const selectionsPath = process.env.SELECTIONS_PATH || 'scripts/contextbench-five-lane-selections.json';
const requiredLanes = (process.env.REQUIRED_LANES || 'raw-native,codebase-context,codebase-memory-mcp,grepai,codegraphcontext')
  .split(',')
  .map((lane) => lane.trim())
  .filter(Boolean);
const payloads = JSON.parse(readFileSync(process.env.TASK_PAYLOADS, 'utf8'));
const task = payloads.tasks.find((candidate) => candidate.instance_id === targetTaskId);
if (!task) throw new Error(`target task ${targetTaskId} missing from payloads`);
if (!officialContextBench) throw new Error('OFFICIAL_CONTEXTBENCH is required');
if (!existsSync(selectionsPath)) throw new Error(`selection file missing: ${selectionsPath}`);
const selections = JSON.parse(readFileSync(selectionsPath, 'utf8'));
const laneSelections = selections.laneSelections || [];
if (laneSelections.length === 0) throw new Error('selection file has no laneSelections');

const laneCounts = new Map();
for (const selection of laneSelections) {
  const lane = selection.lane_id || selection.lane;
  laneCounts.set(lane, (laneCounts.get(lane) || 0) + 1);
}
const missingLanes = requiredLanes.filter((lane) => !laneCounts.has(lane));
const duplicateLanes = [...laneCounts.entries()].filter(([, count]) => count > 1).map(([lane]) => lane);
const extraLanes = [...laneCounts.keys()].filter((lane) => !requiredLanes.includes(lane));
if (missingLanes.length > 0 || duplicateLanes.length > 0 || extraLanes.length > 0) {
  throw new Error(
    `lane selection set invalid: missing=${missingLanes.join(',') || 'none'} duplicate=${duplicateLanes.join(',') || 'none'} extra=${extraLanes.join(',') || 'none'}`,
  );
}

function run(cmd, args, opts = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || process.cwd(),
    env: opts.env || process.env,
    encoding: 'utf8',
    timeout: opts.timeoutMs || 600000,
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    command: [cmd, ...args].join(' '),
    cwd: opts.cwd || process.cwd(),
    status: typeof r.status === 'number' ? r.status : null,
    signal: r.signal,
    error: r.error?.message || null,
    durationMs: Date.now() - started,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function cleanPath(path) {
  return String(path || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function addSpan(map, file, start, end) {
  const clean = cleanPath(file);
  if (!clean) return;
  const s = Math.max(1, Number(start) || 1);
  const e = Math.max(s, Number(end) || s);
  const list = map.get(clean) || [];
  list.push({ start: s, end: e });
  map.set(clean, list);
}

function estimateTokensFromBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  return Math.ceil(bytes / 4);
}

function measuredNumber(value, unit, source, unavailableReason = 'not captured in source artifact') {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return { value: numeric, unit, source };
  return { value: null, unit, source, unavailableReason };
}

function byteCount(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

function buildTimeMetrics(readiness, evaluator, rowWallDurationMs, evaluatorSkippedReason = null) {
  const setupIndex = readiness.setupIndex || {};
  return {
    setupDurationMs: measuredNumber(setupIndex.setupDurationMs, 'ms', 'lane readiness setupIndex', 'readiness artifact did not report setupDurationMs'),
    indexDurationMs: measuredNumber(setupIndex.indexDurationMs, 'ms', 'lane readiness setupIndex', 'readiness artifact did not report indexDurationMs'),
    queryDurationMs: measuredNumber(setupIndex.queryDurationMs, 'ms', 'lane readiness setupIndex', 'readiness artifact did not report queryDurationMs'),
    selectorDurationMs: measuredNumber(null, 'ms', 'selector stage', 'selector ran before scoring and did not emit wall-clock telemetry'),
    evaluatorDurationMs: evaluator
      ? measuredNumber(evaluator.durationMs, 'ms', 'official ContextBench evaluator command')
      : measuredNumber(null, 'ms', 'official ContextBench evaluator command', evaluatorSkippedReason || 'evaluator did not run'),
    rowWallDurationMs: measuredNumber(rowWallDurationMs, 'ms', 'scorer per-lane wall clock'),
  };
}

function buildTokenMetrics(selection, prediction) {
  const candidateMetrics = selection.candidateMetrics || selection.readiness?.candidateMetrics || {};
  const candidateBytes = Number(candidateMetrics.bytes);
  const candidateEstimatedTokens = Number(candidateMetrics.estimatedTokens);
  const predictionBytes = byteCount(JSON.stringify(prediction || {}));
  const selectorUsage = selection.selectorUsage || {};
  return {
    estimator: 'ceil(utf8_bytes/4); cost estimate only, not provider billing telemetry',
    candidatePack: {
      candidateCount: Number(selection.readiness?.candidateCount ?? selection.candidateCount ?? candidateMetrics.candidateCount ?? 0),
      fileCount: Number.isFinite(Number(candidateMetrics.fileCount)) ? Number(candidateMetrics.fileCount) : null,
      spanCount: Number.isFinite(Number(candidateMetrics.spanCount)) ? Number(candidateMetrics.spanCount) : null,
      bytes: Number.isFinite(candidateBytes)
        ? measuredNumber(candidateBytes, 'bytes', candidateMetrics.source || 'candidate pack artifact')
        : measuredNumber(null, 'bytes', candidateMetrics.source || 'candidate pack artifact', candidateMetrics.unavailableReason || 'candidate pack bytes were not emitted for this lane'),
      estimatedTokens: Number.isFinite(candidateEstimatedTokens)
        ? measuredNumber(candidateEstimatedTokens, 'tokens', candidateMetrics.source || 'candidate pack artifact')
        : measuredNumber(null, 'tokens', candidateMetrics.source || 'candidate pack artifact', candidateMetrics.unavailableReason || 'candidate pack token estimate was not emitted for this lane'),
    },
    prediction: {
      bytes: measuredNumber(predictionBytes, 'bytes', 'official evaluator prediction JSON'),
      estimatedTokens: measuredNumber(estimateTokensFromBytes(predictionBytes), 'tokens', 'official evaluator prediction JSON'),
    },
    selectorUsage: {
      model: selection.selectorModel || selections.model || 'gpt-5.4-mini-high',
      inputTokens: measuredNumber(selectorUsage.inputTokens, 'tokens', 'selector provider usage', 'selector usage telemetry was not captured for this proof artifact'),
      outputTokens: measuredNumber(selectorUsage.outputTokens, 'tokens', 'selector provider usage', 'selector usage telemetry was not captured for this proof artifact'),
      cachedInputTokens: measuredNumber(selectorUsage.cachedInputTokens, 'tokens', 'selector provider usage', 'selector usage telemetry was not captured for this proof artifact'),
      reasoningTokens: measuredNumber(selectorUsage.reasoningTokens, 'tokens', 'selector provider usage', 'selector usage telemetry was not captured for this proof artifact'),
      totalTokens: measuredNumber(selectorUsage.totalTokens, 'tokens', 'selector provider usage', 'selector usage telemetry was not captured for this proof artifact'),
    },
  };
}

function reliabilityFor(selection, rowBase, status, scoreable) {
  return {
    status,
    officialEvaluatorScoreable: scoreable,
    setupStatus: rowBase.setupStatus,
    indexStatus: rowBase.indexStatus,
    toolCallable: rowBase.toolCallable,
    nonEmptyPrediction: rowBase.nonEmptyPrediction,
    candidateCount: rowBase.candidateCount,
    sourceRun: selection.readiness?.sourceRun || selection.sourceRun || null,
    sourceJob: selection.readiness?.sourceJob || selection.sourceJob || null,
    sourceArtifact: selection.readiness?.sourceArtifact || selection.sourceArtifact || null,
    sourceDigest: selection.readiness?.sourceDigest || selection.sourceDigest || null,
  };
}

function resultTableRow(row) {
  const final = row.score?.final || {};
  return {
    lane: row.lane_id,
    task: row.task_id,
    fileCoverage: final.file?.coverage ?? null,
    filePrecision: final.file?.precision ?? null,
    symbolCoverage: final.symbol?.coverage ?? null,
    symbolPrecision: final.symbol?.precision ?? null,
    spanCoverage: final.span?.coverage ?? null,
    spanPrecision: final.span?.precision ?? null,
    lineCoverage: final.line?.coverage ?? null,
    linePrecision: final.line?.precision ?? null,
    editlocRecall: row.score?.editloc?.recall ?? null,
    editlocPrecision: row.score?.editloc?.precision ?? null,
    setupDurationMs: row.timeMetrics?.setupDurationMs?.value ?? null,
    indexDurationMs: row.timeMetrics?.indexDurationMs?.value ?? null,
    queryDurationMs: row.timeMetrics?.queryDurationMs?.value ?? null,
    evaluatorDurationMs: row.timeMetrics?.evaluatorDurationMs?.value ?? null,
    rowWallDurationMs: row.timeMetrics?.rowWallDurationMs?.value ?? null,
    candidateEstimatedTokens: row.tokenMetrics?.candidatePack?.estimatedTokens?.value ?? null,
    predictionEstimatedTokens: row.tokenMetrics?.prediction?.estimatedTokens?.value ?? null,
  };
}

const runStarted = Date.now();
const runDir = join(root, 'lane-score');
mkdirSync(runDir, { recursive: true });
writeFileSync(join(runDir, 'selections.json'), JSON.stringify(selections, null, 2));

const goldPath = join(runDir, 'gold.json');
const gold = run(
  'node',
  [
    'scripts/contextbench-select-slice.mjs',
    '--write-gold',
    '--task-id',
    task.instance_id,
    '--out',
    goldPath,
    '--payloads',
    process.env.TASK_PAYLOADS,
  ],
  { timeoutMs: 600000 },
);
writeFileSync(join(runDir, 'gold-command.json'), JSON.stringify(gold, null, 2));
if (gold.status !== 0) throw new Error(`gold materialization failed: ${gold.stderr || gold.stdout}`);

const rows = [];
for (const selection of laneSelections) {
  const rowStarted = Date.now();
  const lane = selection.lane_id || selection.lane;
  const laneDir = join(runDir, lane);
  mkdirSync(laneDir, { recursive: true });
  const spans = Array.isArray(selection.spans) ? selection.spans : [];
  const files = Array.isArray(selection.files) ? selection.files : [];
  const spanMap = new Map();
  for (const span of spans) addSpan(spanMap, span.file, span.start, span.end);
  const predFiles = [...new Set([...files, ...spans.map((span) => cleanPath(span.file))])].filter(Boolean);
  const predSpans = Object.fromEntries(spanMap.entries());
  const nonEmptyPrediction = predFiles.length > 0 || spans.length > 0;
  const readiness = selection.readiness || {};
  const rowBase = {
    lane_id: lane,
    task_id: task.instance_id,
    model: selections.model || 'gpt-5.4-mini-high',
    predictionSource: selection.predictionSource || selections.predictionSource || 'gpt-5.4-mini-high subagent over real lane candidate pack',
    setupStatus: readiness.setupStatus || selection.setupStatus || 'unknown',
    indexStatus: readiness.indexStatus || selection.indexStatus || 'unknown',
    toolCallable: Boolean(readiness.toolCallable ?? selection.toolCallable),
    candidateCount: Number(readiness.candidateCount ?? selection.candidateCount ?? 0),
    setupIndex: readiness.setupIndex || selection.setupIndex || null,
    nonEmptyPrediction,
    predFiles: predFiles.length,
    predSpans: spans.length,
    rationale: selection.rationale || null,
  };

  writeFileSync(join(laneDir, 'selection.json'), JSON.stringify(selection, null, 2));
  if (!nonEmptyPrediction) {
    const timeMetrics = buildTimeMetrics(readiness, null, Date.now() - rowStarted, 'prediction was empty');
    const row = {
      ...rowBase,
      status: 'empty_prediction',
      officialEvaluatorScoreable: false,
      score: null,
      timeMetrics,
      tokenMetrics: buildTokenMetrics(selection, null),
    };
    row.reliability = reliabilityFor(selection, rowBase, row.status, row.officialEvaluatorScoreable);
    rows.push(row);
    continue;
  }

  const prediction = {
    instance_id: task.instance_id,
    repo_url: task.repo_checkout_path,
    commit: task.base_commit,
    traj_data: {
      pred_steps: [{ files: predFiles, spans: predSpans }],
      pred_files: predFiles,
      pred_spans: predSpans,
    },
    model_patch: '',
  };
  const predictionPath = join(laneDir, 'prediction.json');
  writeFileSync(predictionPath, JSON.stringify(prediction, null, 2));

  const scorePath = join(laneDir, 'official-score.jsonl');
  const evaluator = run(
    'python',
    [
      '-m',
      'contextbench.evaluate',
      '--gold',
      goldPath,
      '--pred',
      predictionPath,
      '--cache',
      join(laneDir, 'repo-cache'),
      '--out',
      scorePath,
    ],
    { cwd: officialContextBench, timeoutMs: 1200000 },
  );
  writeFileSync(join(laneDir, 'evaluator-command.json'), JSON.stringify(evaluator, null, 2));
  let score = null;
  if (existsSync(scorePath)) {
    const lines = readFileSync(scorePath, 'utf8').trim().split(/\n+/).filter(Boolean);
    if (lines.length > 0) score = JSON.parse(lines.at(-1));
  }
  const scoreable = evaluator.status === 0 && Boolean(score);
  const row = {
    ...rowBase,
    status: scoreable ? 'completed' : 'judge_failed',
    officialEvaluatorScoreable: scoreable,
    score,
    timeMetrics: buildTimeMetrics(readiness, evaluator, Date.now() - rowStarted),
    tokenMetrics: buildTokenMetrics(selection, prediction),
  };
  row.reliability = reliabilityFor(selection, rowBase, row.status, row.officialEvaluatorScoreable);
  rows.push(row);
}

const scoreableRows = rows.filter((row) => row.officialEvaluatorScoreable);
const summary = {
  createdAt: new Date().toISOString(),
  attemptedRows: rows.length,
  scoreableRows: scoreableRows.length,
  requiredCompetitors: requiredLanes.length,
  requiredLanes,
  setupIndexCostReportedSeparately: true,
  officialEvaluatorQualityRowsOnly: true,
  model: selections.model || 'gpt-5.4-mini-high',
  predictionSource: selections.predictionSource || 'gpt-5.4-mini-high subagent selections over real lane candidate packs',
  caveats: selections.caveats || [],
  runMetrics: {
    goldMaterializationDurationMs: gold.durationMs,
    totalWallDurationMs: Date.now() - runStarted,
  },
  resultsTable: scoreableRows.map(resultTableRow),
  rows,
};

writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(root, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('CONTEXTBENCH_LANE_SCORE_JSON_START');
console.log(JSON.stringify(summary, null, 2));
console.log('CONTEXTBENCH_LANE_SCORE_JSON_END');
if (scoreableRows.length !== rows.length || scoreableRows.length < requiredLanes.length) process.exitCode = 1;
