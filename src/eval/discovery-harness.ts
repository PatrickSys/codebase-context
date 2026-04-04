import { createProjectState, type ProjectState } from '../project-state.js';
import { handle as searchCodebaseHandle } from '../tools/search-codebase.js';
import { handle as getCodebaseMetadataHandle } from '../tools/get-codebase-metadata.js';
import { handle as getTeamPatternsHandle } from '../tools/get-team-patterns.js';
import type {
  SearchResponse,
  PatternResponse
} from '../tools/types.js';
import type {
  DiscoveryBenchmarkProtocol,
  DiscoveryComparatorEvidence,
  DiscoveryComparatorGateResult,
  DiscoveryGateEvaluation,
  DiscoveryMetricComparison,
  DiscoveryMetricName,
  DiscoverySummary as DiscoverySummaryType,
  DiscoverySurface,
  DiscoverySurfaceResult as DiscoverySurfaceResultType,
  DiscoverySurfaceRunner,
  DiscoveryTask as DiscoveryTaskType,
  DiscoveryTaskResult as DiscoveryTaskResultEval,
  EvaluateDiscoveryFixtureParams,
  FormatDiscoveryReportParams
} from './types.js';
import { countUtf8Bytes, estimateTokenCountFromBytes } from './harness.js';
import { generateCodebaseIntelligence } from '../resources/codebase-intelligence.js';

type JsonRecord = Record<string, unknown>;

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\\/g, '/');
}

function parseJsonPayload(payload: string): JsonRecord {
  const parsed = JSON.parse(payload) as unknown;
  if (typeof parsed === 'object' && parsed !== null) {
    return parsed as JsonRecord;
  }
  return {};
}

function createToolProject(rootPath: string): ProjectState {
  const project = createProjectState(rootPath);
  project.indexState.status = 'ready';
  return project;
}

async function runSearchCodebase(task: DiscoveryTaskType, rootPath: string): Promise<DiscoverySurfaceResultType> {
  const project = createToolProject(rootPath);
  const response = await searchCodebaseHandle(task.args ?? { query: task.prompt }, {
    indexState: project.indexState,
    paths: project.paths,
    rootPath: project.rootPath,
    performIndexing: () => undefined
  });
  const payload = response.content?.[0]?.text ?? '{}';
  const parsed = parseJsonPayload(payload) as SearchResponse & JsonRecord;
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  const topFiles = results
    .map((entry) => (typeof entry.file === 'string' ? entry.file.split(':')[0] : ''))
    .filter((entry): entry is string => Boolean(entry));
  const preflight = parsed.preflight;
  const bestExample =
    preflight && typeof preflight === 'object' && preflight !== null && 'bestExample' in preflight
      ? (preflight.bestExample as string | undefined) ?? null
      : null;

  return {
    payload,
    topFiles,
    bestExample
  };
}

async function runCodebaseMetadata(
  _task: DiscoveryTaskType,
  rootPath: string
): Promise<DiscoverySurfaceResultType> {
  const project = createToolProject(rootPath);
  const response = await getCodebaseMetadataHandle({}, {
    indexState: project.indexState,
    paths: project.paths,
    rootPath: project.rootPath,
    performIndexing: () => undefined
  });
  return { payload: response.content?.[0]?.text ?? '{}' };
}

async function runTeamPatterns(
  task: DiscoveryTaskType,
  rootPath: string
): Promise<DiscoverySurfaceResultType> {
  const project = createToolProject(rootPath);
  const response = await getTeamPatternsHandle(task.args ?? { category: 'all' }, {
    indexState: project.indexState,
    paths: project.paths,
    rootPath: project.rootPath,
    performIndexing: () => undefined
  });
  const payload = response.content?.[0]?.text ?? '{}';
  const parsed = parseJsonPayload(payload) as PatternResponse & JsonRecord;
  const goldenFiles = Array.isArray(parsed.goldenFiles) ? parsed.goldenFiles : [];
  return {
    payload,
    bestExample:
      goldenFiles.length > 0 && typeof goldenFiles[0]?.file === 'string'
        ? goldenFiles[0].file
        : null
  };
}

async function runCodebaseContext(
  _task: DiscoveryTaskType,
  rootPath: string
): Promise<DiscoverySurfaceResultType> {
  const project = createToolProject(rootPath);
  return {
    payload: await generateCodebaseIntelligence(project)
  };
}

const DEFAULT_SURFACE_RUNNERS: Record<DiscoverySurface, DiscoverySurfaceRunner> = {
  search_codebase: runSearchCodebase,
  get_codebase_metadata: runCodebaseMetadata,
  get_team_patterns: runTeamPatterns,
  'codebase://context': runCodebaseContext
};

function matchPatterns(candidates: string[], patterns: string[] | undefined): number | null {
  if (!patterns || patterns.length === 0) return null;
  const normalizedPatterns = patterns.map(normalizeText);
  for (let index = 0; index < candidates.length; index++) {
    const normalizedCandidate = normalizeText(candidates[index]);
    if (normalizedPatterns.some((pattern) => normalizedCandidate.includes(pattern))) {
      return index + 1;
    }
  }
  return null;
}

function evaluateDiscoveryTask(
  task: DiscoveryTaskType,
  result: DiscoverySurfaceResultType
): DiscoveryTaskResultEval {
  const normalizedPayload = normalizeText(result.payload);
  const matchedSignals = task.expectedSignals.filter((signal) =>
    normalizedPayload.includes(normalizeText(signal))
  );
  const missingSignals = task.expectedSignals.filter(
    (signal) => !matchedSignals.includes(signal)
  );
  const forbiddenHits = (task.forbiddenSignals ?? []).filter((signal) =>
    normalizedPayload.includes(normalizeText(signal))
  );
  const payloadBytes = countUtf8Bytes(result.payload);
  const estimatedTokens = estimateTokenCountFromBytes(payloadBytes);
  const usefulnessDenominator = Math.max(task.expectedSignals.length, 1);
  const usefulnessScore = Math.max(
    0,
    (matchedSignals.length - forbiddenHits.length) / usefulnessDenominator
  );
  const firstRelevantHit = matchPatterns(result.topFiles ?? [], task.expectedFilePatterns);
  const bestExampleUseful =
    task.expectedBestExamplePatterns && task.expectedBestExamplePatterns.length > 0
      ? task.expectedBestExamplePatterns.some((pattern) =>
          normalizeText(result.bestExample ?? '').includes(normalizeText(pattern))
        )
      : undefined;

  return {
    taskId: task.id,
    title: task.title,
    job: task.job,
    surface: task.surface,
    usefulnessScore,
    matchedSignals,
    missingSignals,
    forbiddenHits,
    payloadBytes,
    estimatedTokens,
    ...(firstRelevantHit !== null ? { firstRelevantHit } : {}),
    ...(typeof bestExampleUseful === 'boolean' ? { bestExampleUseful } : {})
  };
}

function summarizeDiscoveryResults(results: DiscoveryTaskResultEval[]): DiscoverySummaryType {
  const totalTasks = results.length;
  const averageUsefulness =
    totalTasks > 0
      ? results.reduce((sum, result) => sum + result.usefulnessScore, 0) / totalTasks
      : 0;
  const averagePayloadBytes =
    totalTasks > 0
      ? results.reduce((sum, result) => sum + result.payloadBytes, 0) / totalTasks
      : 0;
  const averageEstimatedTokens =
    totalTasks > 0
      ? results.reduce((sum, result) => sum + result.estimatedTokens, 0) / totalTasks
      : 0;
  const searchResults = results.filter((result) => result.job === 'search');
  const findResults = results.filter((result) => result.job === 'find');
  const mapResults = results.filter((result) => result.job === 'map');
  const searchHits = searchResults
    .map((result) => result.firstRelevantHit)
    .filter((value): value is number => typeof value === 'number');
  const bestExampleResults = findResults
    .map((result) => result.bestExampleUseful)
    .filter((value): value is boolean => typeof value === 'boolean');

  return {
    totalTasks,
    averageUsefulness,
    averagePayloadBytes,
    averageEstimatedTokens,
    searchTasks: searchResults.length,
    findTasks: findResults.length,
    mapTasks: mapResults.length,
    averageFirstRelevantHit:
      searchHits.length > 0
        ? searchHits.reduce((sum, value) => sum + value, 0) / searchHits.length
        : null,
    bestExampleUsefulnessRate:
      bestExampleResults.length > 0
        ? bestExampleResults.filter(Boolean).length / bestExampleResults.length
        : null,
    results
  };
}

function getDiscoveryMetricValue(
  summary: DiscoverySummaryType | DiscoveryComparatorEvidence[string] | undefined,
  metric: DiscoveryMetricName
): number | null {
  if (!summary) return null;
  const value = summary[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareMetric(
  actualValue: number | null,
  comparatorValue: number | null,
  metric: DiscoveryMetricName
): DiscoveryMetricComparison {
  const lowerIsBetter =
    metric === 'averageEstimatedTokens' || metric === 'averageFirstRelevantHit';
  const passes =
    actualValue !== null &&
    comparatorValue !== null &&
    (lowerIsBetter ? actualValue <= comparatorValue : actualValue >= comparatorValue);

  return {
    metric,
    comparatorValue,
    actualValue,
    passes
  };
}

function compareMetricWithinTolerance(
  actualValue: number | null,
  comparatorValue: number | null,
  metric: DiscoveryMetricName,
  tolerancePercent: number
): DiscoveryMetricComparison {
  const lowerIsBetter = metric === 'averageFirstRelevantHit';
  const multiplier = 1 + tolerancePercent / 100;
  const passes =
    actualValue !== null &&
    comparatorValue !== null &&
    (lowerIsBetter
      ? actualValue <= comparatorValue * multiplier
      : actualValue >= comparatorValue * (1 - tolerancePercent / 100));

  return {
    metric,
    comparatorValue,
    actualValue,
    passes
  };
}

function evaluateBaselineGate(
  summary: DiscoverySummaryType,
  protocol: DiscoveryBenchmarkProtocol,
  comparatorEvidence: DiscoveryComparatorEvidence | undefined
) {
  const baselineConfig = protocol.shipGate.baseline;
  const baselineMetrics = comparatorEvidence?.[baselineConfig.comparatorName];
  const comparisons = [
    compareMetric(
      getDiscoveryMetricValue(summary, baselineConfig.payloadMetric),
      getDiscoveryMetricValue(baselineMetrics, baselineConfig.payloadMetric),
      baselineConfig.payloadMetric
    ),
    ...baselineConfig.usefulnessMetrics.map((metric) =>
      compareMetric(
        getDiscoveryMetricValue(summary, metric),
        getDiscoveryMetricValue(baselineMetrics, metric),
        metric
      )
    )
  ];
  const missingMetrics = comparisons
    .filter((comparison) => comparison.comparatorValue === null)
    .map((comparison) => comparison.metric);
  const payloadMetricPassed = comparisons[0]?.passes ?? false;
  const beatenUsefulnessMetrics = comparisons
    .slice(1)
    .filter((comparison) => comparison.passes)
    .map((comparison) => comparison.metric);

  return {
    comparatorName: baselineConfig.comparatorName,
    status:
      missingMetrics.length > 0
        ? 'pending_evidence'
        : payloadMetricPassed && beatenUsefulnessMetrics.length > 0
          ? 'passed'
          : 'failed',
    payloadMetric: baselineConfig.payloadMetric,
    payloadMetricPassed,
    beatenUsefulnessMetrics,
    missingMetrics,
    comparisons
  } as const;
}

function evaluateComparatorGate(
  summary: DiscoverySummaryType,
  comparatorName: string,
  protocol: DiscoveryBenchmarkProtocol,
  comparatorEvidence: DiscoveryComparatorEvidence | undefined
): DiscoveryComparatorGateResult {
  const tolerancePercent = protocol.shipGate.comparators.tolerancePercent;
  const comparatorMetrics = comparatorEvidence?.[comparatorName];
  const comparisons = protocol.shipGate.comparators.usefulnessMetrics.map((metric) =>
    compareMetricWithinTolerance(
      getDiscoveryMetricValue(summary, metric),
      getDiscoveryMetricValue(comparatorMetrics, metric),
      metric,
      tolerancePercent
    )
  );
  const missingMetrics = comparisons
    .filter((comparison) => comparison.comparatorValue === null)
    .map((comparison) => comparison.metric);

  return {
    comparatorName,
    status:
      missingMetrics.length > 0
        ? 'pending_evidence'
        : comparisons.every((comparison) => comparison.passes)
          ? 'passed'
          : 'failed',
    tolerancePercent,
    missingMetrics,
    comparisons
  };
}

export function combineDiscoverySummaries(
  summaries: DiscoverySummaryType[]
): DiscoverySummaryType {
  return summarizeDiscoveryResults(summaries.flatMap((summary) => summary.results));
}

export function evaluateDiscoveryGate({
  summary,
  protocol,
  comparatorEvidence,
  suiteComplete
}: {
  summary: DiscoverySummaryType;
  protocol: DiscoveryBenchmarkProtocol;
  comparatorEvidence?: DiscoveryComparatorEvidence;
  suiteComplete: boolean;
}): DiscoveryGateEvaluation {
  const baseline = evaluateBaselineGate(summary, protocol, comparatorEvidence);
  const comparators = protocol.shipGate.comparators.requiredNames.map((name) =>
    evaluateComparatorGate(summary, name, protocol, comparatorEvidence)
  );
  const missingEvidence: string[] = [];

  if (!suiteComplete) {
    missingEvidence.push('fixed public discovery suite is incomplete');
  }

  if (baseline.status === 'pending_evidence') {
    missingEvidence.push(`${baseline.comparatorName} baseline metrics missing`);
  }

  for (const comparator of comparators) {
    if (comparator.status === 'pending_evidence') {
      missingEvidence.push(`${comparator.comparatorName} comparator metrics missing`);
    }
  }

  const status =
    missingEvidence.length > 0
      ? 'pending_evidence'
      : baseline.status === 'passed' && comparators.every((comparator) => comparator.status === 'passed')
        ? 'passed'
        : 'failed';

  return {
    status,
    suiteStatus: suiteComplete ? 'complete' : 'incomplete',
    baseline,
    comparators,
    missingEvidence,
    claimAllowed: status === 'passed'
  };
}

export async function evaluateDiscoveryFixture({
  fixture,
  rootPath,
  surfaceRunners
}: EvaluateDiscoveryFixtureParams): Promise<DiscoverySummaryType> {
  const runners: Record<DiscoverySurface, DiscoverySurfaceRunner> = {
    ...DEFAULT_SURFACE_RUNNERS,
    ...(surfaceRunners ?? {})
  };
  const results: DiscoveryTaskResultEval[] = [];

  for (const task of fixture.tasks) {
    const runner = runners[task.surface];
    const payload = await runner(task, rootPath);
    results.push(evaluateDiscoveryTask(task, payload));
  }

  return summarizeDiscoveryResults(results);
}

export function formatDiscoveryReport({
  codebaseLabel,
  fixturePath,
  summary
}: FormatDiscoveryReportParams): string {
  const lines: string[] = [];
  lines.push(`\n=== Discovery Eval Report: ${codebaseLabel} ===`);
  lines.push(`Fixture: ${fixturePath}`);
  lines.push(`Tasks: ${summary.totalTasks}`);
  lines.push(`Average usefulness: ${(summary.averageUsefulness * 100).toFixed(0)}%`);
  lines.push(`Average payload: ${Math.round(summary.averagePayloadBytes)} bytes`);
  lines.push(`Average estimated tokens: ${Math.round(summary.averageEstimatedTokens)}`);
  lines.push(
    `Average first relevant hit: ${
      summary.averageFirstRelevantHit === null
        ? 'n/a'
        : summary.averageFirstRelevantHit.toFixed(2)
    }`
  );
  lines.push(
    `Best-example usefulness: ${
      summary.bestExampleUsefulnessRate === null
        ? 'n/a'
        : `${(summary.bestExampleUsefulnessRate * 100).toFixed(0)}%`
    }`
  );
  if (summary.gate) {
    lines.push(`Gate: ${summary.gate.status.toUpperCase()}`);
    lines.push(`Claim allowed: ${summary.gate.claimAllowed ? 'yes' : 'no'}`);
    if (summary.gate.missingEvidence.length > 0) {
      lines.push(`Missing evidence: ${summary.gate.missingEvidence.join('; ')}`);
    }
  }
  lines.push('');
  lines.push('Task results:');
  for (const result of summary.results) {
    lines.push(
      `- ${result.taskId} [${result.job}/${result.surface}] usefulness ${(result.usefulnessScore * 100).toFixed(0)}%, payload ${result.payloadBytes}B/${result.estimatedTokens} tok`
    );
  }
  lines.push('================================');
  return lines.join('\n');
}
