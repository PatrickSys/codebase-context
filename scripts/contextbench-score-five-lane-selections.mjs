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

function addSpan(map, file, start, end) {
  const clean = String(file || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!clean) return;
  const s = Math.max(1, Number(start) || 1);
  const e = Math.max(s, Number(end) || s);
  const list = map.get(clean) || [];
  list.push({ start: s, end: e });
  map.set(clean, list);
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
  };
}

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
  const lane = selection.lane_id || selection.lane;
  const laneDir = join(runDir, lane);
  mkdirSync(laneDir, { recursive: true });
  const spans = Array.isArray(selection.spans) ? selection.spans : [];
  const files = Array.isArray(selection.files) ? selection.files : [];
  const spanMap = new Map();
  for (const span of spans) addSpan(spanMap, span.file, span.start, span.end);
  const predFiles = [...new Set([...files, ...spans.map((span) => String(span.file || '').replaceAll('\\', '/').replace(/^\.\//, ''))])].filter(Boolean);
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
    rows.push({ ...rowBase, status: 'empty_prediction', officialEvaluatorScoreable: false, score: null });
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
  rows.push({
    ...rowBase,
    status: scoreable ? 'completed' : 'judge_failed',
    officialEvaluatorScoreable: scoreable,
    score,
  });
}

const scoreableRows = rows.filter((row) => row.officialEvaluatorScoreable);
const summary = {
  createdAt: new Date().toISOString(),
  attemptedRows: rows.length,
  scoreableRows: scoreableRows.length,
  requiredCompetitors: requiredLanes.length,
  requiredLanes,
  setupIndexCostReportedSeparately: true,
  model: selections.model || 'gpt-5.4-mini-high',
  predictionSource: selections.predictionSource || 'gpt-5.4-mini-high subagent selections over real lane candidate packs',
  caveats: selections.caveats || [],
  resultsTable: scoreableRows.map(resultTableRow),
  rows,
};

writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(root, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('CONTEXTBENCH_LANE_SCORE_JSON_START');
console.log(JSON.stringify(summary, null, 2));
console.log('CONTEXTBENCH_LANE_SCORE_JSON_END');
if (scoreableRows.length !== rows.length || scoreableRows.length < requiredLanes.length) process.exitCode = 1;
