import { createProjectState } from '../project-state.js';
import { handle as searchCodebaseHandle } from '../tools/search-codebase.js';
import type {
  EditPreflightFixture,
  EditPreflightResponse,
  EditPreflightRunner,
  EditPreflightSummary,
  EditPreflightTask,
  EditPreflightTaskResult,
  EvaluateEditPreflightFixtureParams,
  FormatEditPreflightReportParams
} from './types.js';

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\\/g, '/');
}

function stripLocationSuffix(fileRef: string): string {
  return fileRef.replace(/:(\d+)(?:-\d+)?$/, '');
}

function matchesPatterns(candidate: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }

  const normalizedCandidate = normalizeText(candidate);
  return patterns.some((pattern) => normalizedCandidate.includes(normalizeText(pattern)));
}

function findFirstRelevantHit(topFiles: string[], patterns: string[] | undefined): number | null {
  if (!patterns || patterns.length === 0) {
    return null;
  }

  for (let index = 0; index < topFiles.length; index++) {
    if (matchesPatterns(topFiles[index], patterns)) {
      return index + 1;
    }
  }

  return null;
}

function summarizeEditPreflightResults(results: EditPreflightTaskResult[]): EditPreflightSummary {
  const totalTasks = results.length;
  const safeResults = results.filter((result) => result.risk === 'safe');
  const unsafeResults = results.filter((result) => result.risk === 'unsafe');
  const targetableResults = results.filter((result) => result.topTargetInTop3 !== null);
  const bestExampleResults = results.filter((result) => result.bestExampleHit !== null);
  const firstRelevantHits = results
    .map((result) => result.firstRelevantHit)
    .filter((value): value is number => typeof value === 'number');

  const topTargetInTop3Count = targetableResults.filter((result) => result.topTargetInTop3).length;
  const bestExampleHitCount = bestExampleResults.filter((result) => result.bestExampleHit).length;
  const safeTaskReadyCount = safeResults.filter((result) => result.ready).length;
  const unsafeTaskAbstainCount = unsafeResults.filter((result) => result.abstain).length;
  const unsafeReadyFalsePositiveCount = unsafeResults.filter((result) => result.ready).length;

  return {
    totalTasks,
    safeTasks: safeResults.length,
    unsafeTasks: unsafeResults.length,
    targetableTasks: targetableResults.length,
    bestExampleTasks: bestExampleResults.length,
    topTargetInTop3Count,
    topTargetInTop3Rate:
      targetableResults.length > 0 ? topTargetInTop3Count / targetableResults.length : null,
    averageFirstRelevantHit:
      firstRelevantHits.length > 0
        ? firstRelevantHits.reduce((sum, value) => sum + value, 0) / firstRelevantHits.length
        : null,
    bestExampleHitCount,
    bestExampleHitRate:
      bestExampleResults.length > 0 ? bestExampleHitCount / bestExampleResults.length : null,
    safeTaskReadyCount,
    safeTaskReadyRate: safeResults.length > 0 ? safeTaskReadyCount / safeResults.length : null,
    unsafeTaskAbstainCount,
    unsafeTaskAbstainRate:
      unsafeResults.length > 0 ? unsafeTaskAbstainCount / unsafeResults.length : null,
    unsafeReadyFalsePositiveCount,
    unsafeReadyFalsePositiveRate:
      unsafeResults.length > 0 ? unsafeReadyFalsePositiveCount / unsafeResults.length : null,
    results
  };
}

function evaluateTask(
  task: EditPreflightTask,
  response: EditPreflightResponse
): EditPreflightTaskResult {
  const topFiles = (response.results ?? [])
    .map((result) => (typeof result.file === 'string' ? stripLocationSuffix(result.file) : ''))
    .filter((filePath): filePath is string => Boolean(filePath));
  const firstRelevantHit = findFirstRelevantHit(topFiles, task.expectedTargetPatterns);
  const bestExample =
    typeof response.preflight?.bestExample === 'string' ? response.preflight.bestExample : null;
  const bestExampleHit =
    task.expectedBestExamplePatterns && task.expectedBestExamplePatterns.length > 0
      ? bestExample !== null && matchesPatterns(bestExample, task.expectedBestExamplePatterns)
      : null;

  return {
    taskId: task.id,
    title: task.title,
    query: task.query,
    risk: task.risk,
    ready: response.preflight?.ready === true,
    abstain: response.preflight?.abstain === true,
    searchQualityStatus: response.searchQuality?.status ?? 'unknown',
    topFiles,
    firstRelevantHit,
    topTargetInTop3:
      task.expectedTargetPatterns && task.expectedTargetPatterns.length > 0
        ? firstRelevantHit !== null && firstRelevantHit <= 3
        : null,
    bestExample,
    bestExampleHit,
    ...(typeof response.preflight?.nextAction === 'string' && {
      nextAction: response.preflight.nextAction
    }),
    ...(Array.isArray(response.preflight?.warnings) &&
      response.preflight.warnings.length > 0 && { warnings: response.preflight.warnings }),
    ...(Array.isArray(response.preflight?.whatWouldHelp) &&
      response.preflight.whatWouldHelp.length > 0 && {
        whatWouldHelp: response.preflight.whatWouldHelp
      })
  };
}

async function runSearchPreflight(
  task: EditPreflightTask,
  rootPath: string
): Promise<EditPreflightResponse> {
  const project = createProjectState(rootPath);
  project.indexState.status = 'ready';

  const response = await searchCodebaseHandle(
    {
      query: task.query,
      intent: 'edit',
      limit: task.limit ?? 5
    },
    {
      indexState: project.indexState,
      paths: project.paths,
      rootPath: project.rootPath,
      performIndexing: () => undefined
    }
  );
  const payload = response.content?.[0]?.text ?? '{}';
  const parsed = JSON.parse(payload) as unknown;

  if (typeof parsed === 'object' && parsed !== null) {
    return parsed as EditPreflightResponse;
  }

  return {};
}

export async function evaluateEditPreflightFixture({
  fixture,
  rootPath,
  runner = runSearchPreflight
}: EvaluateEditPreflightFixtureParams): Promise<EditPreflightSummary> {
  const results: EditPreflightTaskResult[] = [];

  for (const task of fixture.tasks) {
    const response = await runner(task, rootPath);
    results.push(evaluateTask(task, response));
  }

  return summarizeEditPreflightResults(results);
}

export function combineEditPreflightSummaries(
  summaries: EditPreflightSummary[]
): EditPreflightSummary {
  return summarizeEditPreflightResults(summaries.flatMap((summary) => summary.results));
}

function formatRate(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }

  return `${(value * 100).toFixed(0)}%`;
}

function formatHit(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

export function formatEditPreflightReport({
  codebaseLabel,
  fixturePath,
  summary
}: FormatEditPreflightReportParams): string {
  const lines: string[] = [];
  const unsafeFalsePositives = summary.results.filter(
    (result) => result.risk === 'unsafe' && result.ready
  );
  const safeMisses = summary.results.filter((result) => result.risk === 'safe' && !result.ready);

  lines.push(`\n=== Edit Preflight Eval Report: ${codebaseLabel} ===`);
  lines.push(`Fixture: ${fixturePath}`);
  lines.push(
    `Tasks: ${summary.totalTasks} (${summary.safeTasks} safe, ${summary.unsafeTasks} unsafe)`
  );
  lines.push(
    `Top-target in top-3: ${summary.topTargetInTop3Count}/${summary.targetableTasks} (${formatRate(summary.topTargetInTop3Rate)})`
  );
  lines.push(`Average first relevant hit: ${formatHit(summary.averageFirstRelevantHit)}`);
  lines.push(
    `Best-example hit rate: ${summary.bestExampleHitCount}/${summary.bestExampleTasks} (${formatRate(summary.bestExampleHitRate)})`
  );
  lines.push(
    `Safe-task ready rate: ${summary.safeTaskReadyCount}/${summary.safeTasks} (${formatRate(summary.safeTaskReadyRate)})`
  );
  lines.push(
    `Unsafe-task abstain rate: ${summary.unsafeTaskAbstainCount}/${summary.unsafeTasks} (${formatRate(summary.unsafeTaskAbstainRate)})`
  );
  lines.push(
    `Unsafe ready=true false-positive rate: ${summary.unsafeReadyFalsePositiveCount}/${summary.unsafeTasks} (${formatRate(summary.unsafeReadyFalsePositiveRate)})`
  );
  lines.push('');
  lines.push('Task results:');

  for (const result of summary.results) {
    const taskLine = [
      `- ${result.taskId}`,
      `[${result.risk}]`,
      `ready=${result.ready ? 'yes' : 'no'}`,
      `abstain=${result.abstain ? 'yes' : 'no'}`,
      `firstRelevant=${result.firstRelevantHit ?? 'n/a'}`,
      `top3=${result.topTargetInTop3 === null ? 'n/a' : result.topTargetInTop3 ? 'hit' : 'miss'}`,
      `bestExample=${result.bestExampleHit === null ? 'n/a' : result.bestExampleHit ? 'hit' : 'miss'}`,
      `quality=${result.searchQualityStatus}`
    ];
    lines.push(taskLine.join(' '));
  }

  lines.push('');
  lines.push('Unsafe false positives:');
  if (unsafeFalsePositives.length === 0) {
    lines.push('  (none)');
  } else {
    for (const result of unsafeFalsePositives) {
      lines.push(`  - ${result.taskId}: "${result.query}"`);
    }
  }

  lines.push('');
  lines.push('Safe misses:');
  if (safeMisses.length === 0) {
    lines.push('  (none)');
  } else {
    for (const result of safeMisses) {
      lines.push(`  - ${result.taskId}: "${result.query}"`);
      if (result.nextAction) {
        lines.push(`    next: ${result.nextAction}`);
      }
    }
  }

  lines.push('================================');
  return lines.join('\n');
}

export type { EditPreflightRunner };
