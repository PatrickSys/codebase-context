import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ContextBenchArtifactIndexEntry,
  ContextBenchExecutor,
  ContextBenchLaneSetupEvidenceRecord,
  ContextBenchLaneToolCard,
  ContextBenchRunManifestRow,
  ContextBenchSetupIndexMetadata,
  ContextBenchTerminalStatus,
  ContextBenchTaskIdentity
} from './contextbench-types.js';

export interface ArtifactPathSet {
  runDir: string;
  manifestPath: string;
  promptPath: string;
  laneToolCardPath: string;
  setupIndexPath: string;
  rawTracePath: string;
  structuredAnswerPath: string;
  trajectoryPath: string;
  scorePath: string;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

export function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function sha256Buffer(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function sha256File(filePath: string): string {
  return sha256Buffer(readFileSync(filePath));
}

export function hashJson(value: unknown): string {
  return sha256Text(stableStringify(value));
}

export function hashSetupEvidenceRecord(record: ContextBenchLaneSetupEvidenceRecord): string {
  const evidenceWithoutHash: Omit<ContextBenchLaneSetupEvidenceRecord, 'evidenceHash'> = {
    ...record
  };
  delete (evidenceWithoutHash as Partial<ContextBenchLaneSetupEvidenceRecord>).evidenceHash;
  return hashJson(evidenceWithoutHash);
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function buildRunId(params: {
  laneId: string;
  taskId: string;
  repeatIndex: number;
  executor: string;
}): string {
  const base = `${params.laneId}-${params.taskId}-${params.repeatIndex}-${params.executor}`;
  return sanitize(base).slice(0, 160);
}

export function createArtifactPathSet(outDir: string, runId: string): ArtifactPathSet {
  const runDir = path.join(outDir, 'runs', runId);
  return {
    runDir,
    manifestPath: path.join(outDir, 'run-manifest.jsonl'),
    promptPath: path.join(runDir, 'prompt.txt'),
    laneToolCardPath: path.join(runDir, 'lane-card.json'),
    setupIndexPath: path.join(runDir, 'setup-index.json'),
    rawTracePath: path.join(runDir, 'raw-trace.json'),
    structuredAnswerPath: path.join(runDir, 'structured-answer.json'),
    trajectoryPath: path.join(runDir, 'trajectory.json'),
    scorePath: path.join(runDir, 'score.json')
  };
}

export function writeJsonArtifact(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function artifactIndexEntry(
  filePath: string,
  rootDir: string
): ContextBenchArtifactIndexEntry {
  const stats = statSync(filePath);
  return {
    path: path.relative(rootDir, filePath).replace(/\\/g, '/'),
    hash: sha256File(filePath),
    bytes: stats.size
  };
}

export function appendManifestRow(manifestPath: string, row: ContextBenchRunManifestRow): void {
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  appendFileSync(manifestPath, `${JSON.stringify(row)}\n`, 'utf8');
}

export function readManifestRows(manifestPath: string): ContextBenchRunManifestRow[] {
  const content = readFileSync(manifestPath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line) as ContextBenchRunManifestRow);
}

export function buildManifestRow(params: {
  runId: string;
  protocolVersion: string;
  protocolHash: string;
  taskManifestHash: string;
  laneCard: ContextBenchLaneToolCard;
  task: ContextBenchTaskIdentity;
  repeatIndex: number;
  status: ContextBenchTerminalStatus;
  startedAt: string;
  completedAt: string;
  paths: ArtifactPathSet;
  setupIndex: ContextBenchSetupIndexMetadata;
  hashes: Record<string, string>;
  executor: ContextBenchExecutor;
  model: string;
  timeoutSeconds: number;
  maxContextTokens: number;
  maxAnswerTokens: number;
}): ContextBenchRunManifestRow {
  return {
    run_id: params.runId,
    protocol_version: params.protocolVersion,
    protocol_hash: params.protocolHash,
    task_manifest_hash: params.taskManifestHash,
    lane_id: params.laneCard.laneId,
    task_id: params.task.instance_id,
    repeat_index: params.repeatIndex,
    status: params.status,
    started_at: params.startedAt,
    completed_at: params.completedAt,
    raw_trace_path: params.paths.rawTracePath,
    structured_answer_path: params.paths.structuredAnswerPath,
    trajectory_path: params.paths.trajectoryPath,
    score_path: params.paths.scorePath,
    setup_index_path: params.paths.setupIndexPath,
    prompt_path: params.paths.promptPath,
    lane_tool_card_path: params.paths.laneToolCardPath,
    setupIndex: params.setupIndex,
    taskExecution: {
      model: params.model,
      timeoutSeconds: params.timeoutSeconds,
      maxContextTokens: params.maxContextTokens,
      maxAnswerTokens: params.maxAnswerTokens,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
      taskWallTimeMs: new Date(params.completedAt).getTime() - new Date(params.startedAt).getTime(),
      executor: params.executor
    },
    scoring: {
      officialEvaluatorFirst: false,
      officialEvaluatorAttempted: false,
      officialEvaluatorInvoked: false,
      command:
        'python -m contextbench.evaluate --gold <gold.parquet> --pred <trajectory.traj.json> --out <results.jsonl>',
      claimBearing: false,
      fallbackReason: 'phase38_smoke_non_claim_bearing'
    },
    hashes: params.hashes
  };
}
