import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const targetTaskId = 'SWE-Bench-Pro__go__maintenance__bugfix__4df06349';
const root = process.env.ROOT;
const officialContextBench = process.env.OFFICIAL_CONTEXTBENCH;
const payloads = JSON.parse(readFileSync(process.env.TASK_PAYLOADS, 'utf8'));
const task = payloads.tasks.find((candidate) => candidate.instance_id === targetTaskId);
if (!task) throw new Error(`target task ${targetTaskId} missing from payloads`);
const runDir = join(root, 'selected-codebase-memory-mcp');
mkdirSync(runDir, { recursive: true });

const selection = {
  files: ['core/metrics/prometheus.go', 'cmd/root.go', 'server/subsonic/helpers.go'],
  spans: [
    { file: 'core/metrics/prometheus.go', start: 15, end: 17 },
    { file: 'core/metrics/prometheus.go', start: 19, end: 25 },
    { file: 'core/metrics/prometheus.go', start: 33, end: 38 },
    { file: 'core/metrics/prometheus.go', start: 40, end: 49 },
    { file: 'core/metrics/prometheus.go', start: 51, end: 100 },
    { file: 'core/metrics/prometheus.go', start: 102, end: 123 },
    { file: 'cmd/root.go', start: 194, end: 201 },
    { file: 'cmd/root.go', start: 204, end: 220 },
    { file: 'server/subsonic/helpers.go', start: 129, end: 187 },
    { file: 'server/subsonic/helpers.go', start: 189, end: 201 },
    { file: 'server/subsonic/helpers.go', start: 256, end: 268 },
  ],
  rationale:
    'These spans cover the startup metrics writer path and the Subsonic auth-header/Bearer-token parsing path where the two reported behaviors most likely live.',
};

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
    status: r.status,
    signal: r.signal,
    error: r.error?.message || null,
    durationMs: Date.now() - started,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function addSpan(map, file, start, end) {
  const s = Math.max(1, Number(start) || 1);
  const e = Math.max(s, Number(end) || s);
  const list = map.get(file) || [];
  list.push({ start: s, end: e });
  map.set(file, list);
}

const spanMap = new Map();
for (const span of selection.spans) addSpan(spanMap, span.file, span.start, span.end);
const predFiles = [...new Set([...selection.files, ...selection.spans.map((span) => span.file)])];
const predSpans = Object.fromEntries(spanMap.entries());
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

writeFileSync(join(runDir, 'selection.json'), JSON.stringify(selection, null, 2));
writeFileSync(join(runDir, 'prediction.json'), JSON.stringify(prediction, null, 2));

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
if (gold.status !== 0) {
  throw new Error(`gold materialization failed: ${gold.stderr || gold.stdout}`);
}

const scorePath = join(runDir, 'official-score.jsonl');
const evaluator = run(
  'python',
  [
    '-m',
    'contextbench.evaluate',
    '--gold',
    goldPath,
    '--pred',
    join(runDir, 'prediction.json'),
    '--cache',
    join(runDir, 'repo-cache'),
    '--out',
    scorePath,
  ],
  { cwd: officialContextBench, timeoutMs: 1200000 },
);
writeFileSync(join(runDir, 'evaluator-command.json'), JSON.stringify(evaluator, null, 2));

let score = null;
if (existsSync(scorePath)) {
  const lines = readFileSync(scorePath, 'utf8').trim().split(/\n+/).filter(Boolean);
  if (lines.length > 0) score = JSON.parse(lines.at(-1));
}

const scoreable = evaluator.status === 0 && Boolean(score);
const final = score?.final || {};
const row = {
  lane_id: 'codebase-memory-mcp',
  task_id: task.instance_id,
  model: 'gpt-5.4-mini-high',
  predictionSource: 'gpt-5.4-mini-high subagent over real codebase-memory-mcp candidate pack',
  status: scoreable ? 'completed' : 'judge_failed',
  setupStatus: 'completed',
  indexStatus: 'completed',
  toolCallable: true,
  candidateCount: 100,
  nonEmptyPrediction: predFiles.length > 0 && selection.spans.length > 0,
  predFiles: predFiles.length,
  predSpans: selection.spans.length,
  officialEvaluatorScoreable: scoreable,
  setupIndex: { setupDurationMs: 4, indexDurationMs: 2038, queryDurationMs: 365 },
  score,
};
const summary = {
  createdAt: new Date().toISOString(),
  attemptedRows: 1,
  scoreableRows: scoreable ? 1 : 0,
  setupIndexCostReportedSeparately: true,
  model: row.model,
  caveat: 'Prediction was selected by a Codex gpt-5.4-mini-high subagent because GitHub Actions has no OpenAI API key for direct CI inference.',
  resultsTable: scoreable
    ? [
        {
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
          editlocRecall: score.editloc?.recall ?? null,
          editlocPrecision: score.editloc?.precision ?? null,
        },
      ]
    : [],
  rows: [row],
};

writeFileSync(join(runDir, 'row.json'), JSON.stringify(row, null, 2));
writeFileSync(join(root, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('CONTEXTBENCH_SELECTED_SCORE_JSON_START');
console.log(JSON.stringify(summary, null, 2));
console.log('CONTEXTBENCH_SELECTED_SCORE_JSON_END');
if (!scoreable) process.exitCode = 1;
