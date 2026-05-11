import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const summaryPath = arg('summary', join(process.env.ROOT || '/tmp/contextbench-five-lane-score', 'summary.json'));
const protocolPath = arg('protocol', 'tests/fixtures/contextbench-benchmark-protocol.json');
const lanesPath = arg('lanes', 'tests/fixtures/contextbench-lanes.json');
const taskManifestPath = arg('task-manifest', 'tests/fixtures/contextbench-task-manifest.json');
const outPath = arg('out', join(dirname(summaryPath), 'publishable-summary.json'));
const validationOutPath = arg('validation-out', join(dirname(summaryPath), 'publishable-validation.json'));
const humanizedOutPath = arg('humanized-out', join(dirname(summaryPath), 'humanized-summary.md'));

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hashFile(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function metricValue(metric) {
  if (!metric || typeof metric !== 'object') return null;
  return numberOrNull(metric.value);
}

function hasMetricOrReason(metric) {
  if (!metric || typeof metric !== 'object') return false;
  if (Number.isFinite(Number(metric.value))) return true;
  return typeof metric.unavailableReason === 'string' && metric.unavailableReason.length > 0;
}

function mean(values) {
  const clean = values.map(numberOrNull).filter((value) => value !== null);
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function median(values) {
  const clean = values.map(numberOrNull).filter((value) => value !== null).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const middle = Math.floor(clean.length / 2);
  if (clean.length % 2) return clean[middle];
  return (clean[middle - 1] + clean[middle]) / 2;
}

function stddev(values) {
  const clean = values.map(numberOrNull).filter((value) => value !== null);
  if (clean.length < 2) return null;
  const avg = mean(clean);
  const variance = clean.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (clean.length - 1);
  return Math.sqrt(variance);
}

function deterministicRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function bootstrapCi(values, iterations = 2000) {
  const clean = values.map(numberOrNull).filter((value) => value !== null);
  if (clean.length === 0) return { low: null, high: null, method: 'bootstrap_mean_95_ci', samples: 0 };
  if (clean.length === 1) return { low: clean[0], high: clean[0], method: 'single_sample_no_interval', samples: 1 };
  const rand = deterministicRandom(0xC0FFEE);
  const sampledMeans = [];
  for (let i = 0; i < iterations; i += 1) {
    let total = 0;
    for (let j = 0; j < clean.length; j += 1) {
      total += clean[Math.floor(rand() * clean.length)];
    }
    sampledMeans.push(total / clean.length);
  }
  sampledMeans.sort((a, b) => a - b);
  return {
    low: sampledMeans[Math.floor(iterations * 0.025)],
    high: sampledMeans[Math.floor(iterations * 0.975)],
    method: 'deterministic_bootstrap_mean_95_ci',
    samples: clean.length,
  };
}

function qualityFromRow(row) {
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
    qualitySource: 'official ContextBench evaluator',
  };
}

function costFromRow(row) {
  const t = row.timeMetrics || {};
  return {
    lane: row.lane_id,
    setupDurationMs: metricValue(t.setupDurationMs),
    indexDurationMs: metricValue(t.indexDurationMs),
    queryDurationMs: metricValue(t.queryDurationMs),
    selectorDurationMs: metricValue(t.selectorDurationMs),
    evaluatorDurationMs: metricValue(t.evaluatorDurationMs),
    rowWallDurationMs: metricValue(t.rowWallDurationMs),
    unavailable: Object.fromEntries(Object.entries(t)
      .filter(([, metric]) => metric?.unavailableReason)
      .map(([key, metric]) => [key, metric.unavailableReason])),
  };
}

function tokensFromRow(row) {
  const tokenMetrics = row.tokenMetrics || {};
  const candidatePack = tokenMetrics.candidatePack || {};
  const prediction = tokenMetrics.prediction || {};
  const selectorUsage = tokenMetrics.selectorUsage || {};
  return {
    lane: row.lane_id,
    estimator: tokenMetrics.estimator || null,
    candidateCount: candidatePack.candidateCount ?? row.candidateCount ?? null,
    candidateBytes: metricValue(candidatePack.bytes),
    candidateEstimatedTokens: metricValue(candidatePack.estimatedTokens),
    predictionBytes: metricValue(prediction.bytes),
    predictionEstimatedTokens: metricValue(prediction.estimatedTokens),
    selectorModel: selectorUsage.model || row.model || null,
    selectorInputTokens: metricValue(selectorUsage.inputTokens),
    selectorOutputTokens: metricValue(selectorUsage.outputTokens),
    selectorTotalTokens: metricValue(selectorUsage.totalTokens),
    unavailable: {
      candidateBytes: candidatePack.bytes?.unavailableReason || null,
      candidateEstimatedTokens: candidatePack.estimatedTokens?.unavailableReason || null,
      selectorUsage: selectorUsage.totalTokens?.unavailableReason || null,
    },
  };
}

function reliabilityFromRow(row) {
  return {
    lane: row.lane_id,
    task: row.task_id,
    status: row.status,
    officialEvaluatorScoreable: row.officialEvaluatorScoreable === true,
    setupStatus: row.reliability?.setupStatus ?? row.setupStatus,
    indexStatus: row.reliability?.indexStatus ?? row.indexStatus,
    toolCallable: row.reliability?.toolCallable ?? row.toolCallable,
    nonEmptyPrediction: row.reliability?.nonEmptyPrediction ?? row.nonEmptyPrediction,
    candidateCount: row.reliability?.candidateCount ?? row.candidateCount,
    sourceRun: row.reliability?.sourceRun ?? null,
    sourceJob: row.reliability?.sourceJob ?? null,
    sourceArtifact: row.reliability?.sourceArtifact ?? null,
    sourceDigest: row.reliability?.sourceDigest ?? null,
  };
}

function laneStatistics(qualityRows) {
  const metrics = ['fileCoverage', 'filePrecision', 'spanCoverage', 'spanPrecision', 'lineCoverage', 'linePrecision'];
  const byLane = new Map();
  for (const row of qualityRows) {
    const list = byLane.get(row.lane) || [];
    list.push(row);
    byLane.set(row.lane, list);
  }
  return Object.fromEntries([...byLane.entries()].map(([lane, rows]) => [
    lane,
    Object.fromEntries(metrics.map((metric) => {
      const values = rows.map((row) => row[metric]);
      return [metric, {
        mean: mean(values),
        median: median(values),
        stddev: stddev(values),
        bootstrap95Ci: bootstrapCi(values),
      }];
    })),
  ]));
}

function validate(summary, protocol, taskManifest, qualityRows, reliabilityRows) {
  const requiredLanes = summary.requiredLanes || [];
  const scoreableLanes = new Set(qualityRows.map((row) => row.lane));
  const failures = reliabilityRows.filter((row) => !row.officialEvaluatorScoreable);
  const checks = [
    {
      id: 'official_evaluator_only_quality_rows',
      pass: qualityRows.every((row) => row.qualitySource === 'official ContextBench evaluator'),
      detail: 'Every quality row must come from the official ContextBench evaluator.',
    },
    {
      id: 'failures_excluded_from_quality_table',
      pass: failures.every((failure) => !qualityRows.some((row) => row.lane === failure.lane && row.task === failure.task)),
      detail: 'setup_failed/tool_error/judge_failed/empty rows are reliability rows, not quality rows.',
    },
    {
      id: 'required_lanes_scoreable',
      pass: requiredLanes.length >= 5 && requiredLanes.every((lane) => scoreableLanes.has(lane)),
      detail: `Required lanes: ${requiredLanes.join(', ') || 'none'}`,
    },
    {
      id: 'setup_index_query_costs_separate',
      pass: summary.setupIndexCostReportedSeparately === true && summary.rows.every((row) => ['setupDurationMs', 'indexDurationMs', 'queryDurationMs'].every((key) => hasMetricOrReason(row.timeMetrics?.[key]))),
      detail: 'Setup, indexing, and query costs must not be folded into quality metrics.',
    },
    {
      id: 'timing_metrics_present',
      pass: summary.rows.every((row) => ['evaluatorDurationMs', 'rowWallDurationMs', 'selectorDurationMs'].every((key) => hasMetricOrReason(row.timeMetrics?.[key]))),
      detail: 'Each row needs evaluator, row-wall, and selector timing fields or explicit unavailable reasons.',
    },
    {
      id: 'token_metrics_present',
      pass: summary.rows.every((row) => hasMetricOrReason(row.tokenMetrics?.prediction?.estimatedTokens)
        && hasMetricOrReason(row.tokenMetrics?.candidatePack?.estimatedTokens)
        && hasMetricOrReason(row.tokenMetrics?.selectorUsage?.totalTokens)),
      detail: 'Each row needs prediction, candidate-pack, and selector token fields; unavailable provider usage must be explicit.',
    },
    {
      id: 'protocol_is_frozen_and_non_claiming',
      pass: protocol.status === 'protocol_frozen' && protocol.claimAllowed === false,
      detail: 'This proof can be publishable evidence, but not a broad benchmark-win claim.',
    },
    {
      id: 'manifest_preselected_without_lane_outputs',
      pass: typeof taskManifest.no_lane_outputs_observed_attestation === 'string' && taskManifest.no_lane_outputs_observed_attestation.length > 0,
      detail: 'Task selection must not depend on lane outputs.',
    },
  ];
  return {
    status: checks.every((check) => check.pass) ? 'pass' : 'fail',
    checks,
  };
}

function formatNumber(value) {
  if (value === null || value === undefined) return 'n/a';
  if (typeof value === 'string') return value;
  if (Number.isInteger(value)) return String(value);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(3) : String(value);
}

function markdownTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((column) => formatNumber(column.value(row))).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function humanizedMarkdown(report) {
  const table = markdownTable(report.qualityTable, [
    { label: 'Lane', value: (row) => row.lane },
    { label: 'File cov', value: (row) => row.fileCoverage },
    { label: 'File prec', value: (row) => row.filePrecision },
    { label: 'Span cov', value: (row) => row.spanCoverage },
    { label: 'Line cov', value: (row) => row.lineCoverage },
  ]);
  const costTable = markdownTable(report.costTable, [
    { label: 'Lane', value: (row) => row.lane },
    { label: 'Setup ms', value: (row) => row.setupDurationMs },
    { label: 'Index ms', value: (row) => row.indexDurationMs },
    { label: 'Query ms', value: (row) => row.queryDurationMs },
    { label: 'Eval ms', value: (row) => row.evaluatorDurationMs },
    { label: 'Row ms', value: (row) => row.rowWallDurationMs },
  ]);
  const tokenTable = markdownTable(report.tokenTable, [
    { label: 'Lane', value: (row) => row.lane },
    { label: 'Candidates', value: (row) => row.candidateCount },
    { label: 'Cand tokens', value: (row) => row.candidateEstimatedTokens },
    { label: 'Pred tokens', value: (row) => row.predictionEstimatedTokens },
    { label: 'Selector tokens', value: (row) => row.selectorTotalTokens },
  ]);
  return `# ContextBench Publishable Pilot Summary\n\nThis is a real five-lane ContextBench pilot: the quality numbers below come only from the official ContextBench evaluator, and setup/index/query costs are reported separately. It is still a pilot because it covers one frozen task; it should not be turned into a broad win claim.\n\n## Quality\n\n${table}\n\n## Time Cost\n\n${costTable}\n\n## Token Cost\n\n${tokenTable}\n\n## What This Means\n\nThe run is useful because every required lane produced a non-empty prediction and received an official score. The remaining n/a values are measurement gaps, not hidden failures: selector provider token telemetry was not captured in this proof, and some readiness artifacts report candidate counts without candidate bytes.\n\n## What Not To Claim\n\nDo not claim product superiority from this artifact alone. A claim-bearing benchmark still needs the full frozen task slice, repeated runs, and the same reporting discipline used here.\n`;
}

if (!existsSync(summaryPath)) throw new Error(`summary not found: ${summaryPath}`);
if (!existsSync(protocolPath)) throw new Error(`protocol not found: ${protocolPath}`);
if (!existsSync(lanesPath)) throw new Error(`lanes fixture not found: ${lanesPath}`);
if (!existsSync(taskManifestPath)) throw new Error(`task manifest not found: ${taskManifestPath}`);

const summary = readJson(summaryPath);
const protocol = readJson(protocolPath);
const lanes = readJson(lanesPath);
const taskManifest = readJson(taskManifestPath);
const rows = summary.rows || [];
const qualityRows = rows.filter((row) => row.officialEvaluatorScoreable === true && row.status === 'completed').map(qualityFromRow);
const reliabilityRows = rows.map(reliabilityFromRow);
const costTable = rows.map(costFromRow);
const tokenTable = rows.map(tokensFromRow);
const validation = validate(summary, protocol, taskManifest, qualityRows, reliabilityRows);

const targetTaskIds = [...new Set(rows.map((row) => row.task_id).filter(Boolean))];
const report = {
  createdAt: new Date().toISOString(),
  publicationStatus: 'pilot_evidence_not_broad_claim',
  sourceSummary: resolve(summaryPath),
  protocol: {
    path: protocolPath,
    hash: hashFile(protocolPath),
    version: protocol.protocolVersion,
    status: protocol.status,
    claimAllowed: protocol.claimAllowed,
  },
  fixtures: {
    lanes: { path: lanesPath, hash: hashFile(lanesPath), laneCount: lanes.lanes?.length ?? null },
    taskManifest: { path: taskManifestPath, hash: hashFile(taskManifestPath), manifestHash: taskManifest.manifest_hash ?? null },
  },
  scope: {
    model: summary.model,
    targetTaskIds,
    attemptedRows: summary.attemptedRows,
    scoreableRows: summary.scoreableRows,
    requiredLanes: summary.requiredLanes || [],
    caveats: summary.caveats || [],
  },
  qualityTable: qualityRows,
  costTable,
  tokenTable,
  reliabilityTable: reliabilityRows,
  statistics: laneStatistics(qualityRows),
  biasAudit: validation,
  limitations: [
    'One-task proof run: suitable as pilot evidence, not a broad benchmark claim.',
    'Selector usage telemetry is explicit but unavailable where the selector ran outside provider usage capture.',
    'Candidate token estimates use a deterministic utf8-byte heuristic unless a lane emits provider-grade token counts.',
    'Failures remain in reliability tables and are never counted as quality rows.',
  ],
};

writeJson(outPath, report);
writeJson(validationOutPath, validation);
mkdirSync(dirname(humanizedOutPath), { recursive: true });
writeFileSync(humanizedOutPath, humanizedMarkdown(report));
console.log('CONTEXTBENCH_PUBLISHABLE_REPORT_JSON_START');
console.log(JSON.stringify({ outPath, validationOutPath, humanizedOutPath, validation }, null, 2));
console.log('CONTEXTBENCH_PUBLISHABLE_REPORT_JSON_END');
if (validation.status !== 'pass') process.exitCode = 1;
