import type {
  ContextBenchPredSpan,
  ContextBenchStructuredAnswer,
  ContextBenchTaskIdentity,
  ContextBenchTrajectoryRecord
} from './contextbench-types.js';

export interface NormalizeTrajectoryParams {
  task: Pick<ContextBenchTaskIdentity, 'instance_id' | 'repo_url' | 'base_commit'>;
  answer: ContextBenchStructuredAnswer;
  repoRoot?: string;
  rawTraceSteps?: Array<{ files?: string[] }>;
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

export function normalizeContextBenchPath(filePath: string, repoRoot?: string): string {
  let normalized = normalizeSlashes(filePath).replace(/^\.\//, '');
  if (repoRoot) {
    const root = normalizeSlashes(repoRoot).replace(/\/$/, '');
    if (normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      normalized = normalized.slice(root.length + 1);
    }
  }
  return normalized.replace(/^\/+/, '');
}

function spanFromEvidence(
  lineRange: ContextBenchStructuredAnswer['evidence'][number]['lineRange']
): ContextBenchPredSpan {
  return { start: lineRange.start, end: lineRange.end, full_file: false };
}

export function fullFileSpan(): ContextBenchPredSpan {
  return { start: 1, end: null, full_file: true };
}

export function normalizeTrajectory(
  params: NormalizeTrajectoryParams
): ContextBenchTrajectoryRecord {
  const spans: Record<string, ContextBenchPredSpan[]> = {};
  const files = new Set<string>();

  for (const evidence of params.answer.evidence) {
    const file = normalizeContextBenchPath(evidence.file, params.repoRoot);
    files.add(file);
    spans[file] = [...(spans[file] ?? []), spanFromEvidence(evidence.lineRange)];
  }

  for (const fileRef of params.answer.filesReferenced) {
    const file = normalizeContextBenchPath(fileRef, params.repoRoot);
    if (file.length === 0) continue;
    files.add(file);
    if (!spans[file]) spans[file] = [fullFileSpan()];
  }

  const predFiles = [...files].sort();
  const traceFiles = (params.rawTraceSteps ?? [])
    .flatMap((step) => step.files ?? [])
    .map((file) => normalizeContextBenchPath(file, params.repoRoot))
    .filter((file) => file.length > 0);
  const stepFiles = [...new Set([...traceFiles, ...predFiles])].sort();

  return {
    instance_id: params.task.instance_id,
    repo_url: params.task.repo_url,
    commit: params.task.base_commit,
    traj_data: {
      pred_steps: [{ files: stepFiles, spans }],
      pred_files: predFiles,
      pred_spans: spans
    },
    model_patch: ''
  };
}
