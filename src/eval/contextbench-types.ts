export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonSchemaPrimitiveType =
  | 'array'
  | 'boolean'
  | 'integer'
  | 'null'
  | 'number'
  | 'object'
  | 'string';

export interface JsonSchemaDefinition {
  type?: JsonSchemaPrimitiveType | JsonSchemaPrimitiveType[];
  properties?: Record<string, JsonSchemaDefinition>;
  items?: JsonSchemaDefinition;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaDefinition;
  enum?: JsonValue[];
  minLength?: number;
  minimum?: number;
}

export type ContextBenchTerminalStatus =
  | 'completed'
  | 'setup_failed'
  | 'task_setup_failed'
  | 'index_failed'
  | 'timeout'
  | 'invalid_schema'
  | 'no_answer'
  | 'wrong_answer'
  | 'wrong_evidence'
  | 'unsupported_claim'
  | 'false_ready'
  | 'tool_error'
  | 'judge_failed';

export const CONTEXTBENCH_TERMINAL_STATUSES: readonly ContextBenchTerminalStatus[] = [
  'completed',
  'setup_failed',
  'task_setup_failed',
  'index_failed',
  'timeout',
  'invalid_schema',
  'no_answer',
  'wrong_answer',
  'wrong_evidence',
  'unsupported_claim',
  'false_ready',
  'tool_error',
  'judge_failed'
];

export interface ContextBenchTaskIdentity {
  instance_id: string;
  original_inst_id: string;
  source: string;
  language: string;
  repo: string;
  repo_url: string;
  base_commit: string;
  problem_statement_ref: string;
  problem_statement_hash: string;
  gold_context_ref: string;
  gold_context_hash: string;
  patch_hash: string;
  test_patch_hash: string;
  f2p_hash: string;
  p2p_hash: string;
  gold_context_span_count: number;
  hash_canonicalization_version: string;
  hardness_signal_status: string;
  hardness_signal_source: string;
  hardness_proxy_used: boolean;
  inclusion_rationale: string;
  deterministic_rank: string;
}

export interface ContextBenchTaskManifest {
  name: string;
  protocolVersion: string;
  dataset: string;
  datasetConfig: string;
  split: string;
  claimBearing: boolean;
  selectedInPhase: number;
  selection_algorithm: string;
  selection_seed_or_deterministic_order: string;
  selection_timestamp: string;
  task_pool_hash: string;
  exclusion_log_path: string;
  hash_canonicalization_version: string;
  evaluator_success_status: string;
  hardness_signal_status: string;
  hardness_signal_source: string;
  hardness_proxy_used: boolean;
  forbidden_selection_sources: string[];
  no_lane_outputs_observed_attestation: string;
  tasks: ContextBenchTaskIdentity[];
  manifest_hash: string;
}

export interface ContextBenchProtocol {
  protocolVersion: string;
  claimAllowed: boolean;
  benchmarkTarget: {
    officialEvaluatorFirst: boolean;
    officialEvaluatorCommand: string;
    fallbackScorerPolicy: {
      claimBearing: boolean;
    };
  };
  structuredAnswerSchema: {
    requiredFields: string[];
    confidenceValues: string[];
    evidenceFields: string[];
    invalidSchemaStatus: 'invalid_schema';
  };
  budgets: {
    setupAndIndexingReportedSeparately: boolean;
    defaults: {
      maxContextTokens: number;
      maxAnswerTokens: number;
      timeoutSeconds: number;
    };
  };
  failureTaxonomy: ContextBenchTerminalStatus[];
  runManifestSchema: {
    appendOnly: boolean;
    requiredFields: string[];
    terminalStatuses: ContextBenchTerminalStatus[];
    failedRunsIncludedInAggregates: boolean;
  };
}

export interface ContextBenchLane {
  laneId: string;
  displayName: string;
  contextTool: string;
  allowedTools: string[];
  disallowedTools: string[];
  nativeToolsAllowed: boolean;
  setupCostReportedSeparately: boolean;
  indexCostReportedSeparately: boolean;
  cacheIsolationRequired: boolean;
}

export interface ContextBenchLaneToolCard {
  laneId: string;
  displayName: string;
  phase38Status: string;
  phase39Status?: ContextBenchLaneReadinessStatus;
  executableInPhase38: boolean;
  contextTools: string[];
  allowedTools: string[];
  disallowedTools: string[];
  setupCommand: string;
  indexCommand: string;
  queryCommand: string;
  versionCommand: string;
  cachePath: string;
  artifactPaths: {
    setup: string;
    rawTrace: string;
    structuredAnswer: string;
    trajectory: string;
    score: string;
  };
  setupCostReportedSeparately: boolean;
  indexCostReportedSeparately: boolean;
  claimBearing: boolean;
}

export type ContextBenchLaneReadinessStatus =
  | 'ready_for_phase40'
  | 'setup_failed'
  | 'index_failed'
  | 'tool_error'
  | 'invasive_setup_blocked'
  | 'pending';

export const CONTEXTBENCH_LANE_READINESS_STATUSES: readonly ContextBenchLaneReadinessStatus[] = [
  'ready_for_phase40',
  'setup_failed',
  'index_failed',
  'tool_error',
  'invasive_setup_blocked',
  'pending'
];

export type ContextBenchLaneCommandKind = 'setup' | 'index' | 'query' | 'version';

export interface ContextBenchLaneCommandEvidence {
  kind: ContextBenchLaneCommandKind;
  command: string;
  cwd: string;
  safeToRunAutomatically: boolean;
  exitCode: number | null;
  status: 'not_required' | 'not_run_documented' | 'succeeded' | 'failed' | 'blocked';
  durationMs: number | null;
  stdoutLogPath: string | null;
  stderrLogPath: string | null;
  outputHash: string | null;
}

export interface ContextBenchLaneSetupEvidenceRecord {
  laneId: string;
  readinessStatus: ContextBenchLaneReadinessStatus;
  docsUrl: string;
  sourceUrl: string;
  workingDirectory: string;
  platform: {
    os: string;
    shell: string;
    runtime: string;
  };
  redactedEnvVars: string[];
  commands: ContextBenchLaneCommandEvidence[];
  setupDurationMs: number | null;
  indexDurationMs: number | null;
  setupStatus: 'not_required' | 'ready' | 'failed' | 'blocked' | 'pending';
  indexStatus: 'not_required' | 'ready' | 'failed' | 'blocked' | 'pending';
  logReference: string | null;
  evidenceHash: string;
  nextHumanAction: string;
  claimBearing: false;
}

export interface ContextBenchLaneSetupEvidenceFixture {
  name: string;
  protocolVersion: string;
  phase: 39;
  claimBearing: false;
  generatedOutputsPolicy: string;
  records: ContextBenchLaneSetupEvidenceRecord[];
}

export type ContextBenchBaselineSlotStatus = 'reserved' | 'attempted' | 'terminal_missing_evidence';

export interface ContextBenchArtifactIndexEntry {
  path: string;
  hash: string;
  bytes: number;
}

export interface ContextBenchCommandTranscriptEntry {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdoutPath: string | null;
  stderrPath: string | null;
  outputHash: string | null;
}

export interface ContextBenchUntrackedSnapshotEntry {
  path: string;
  bytes: number | null;
  mtimeMs: number | null;
  hash: string | null;
  disposition: 'hashed' | 'excluded';
  exclusionReason: string | null;
}

export interface ContextBenchDirtyWorktreeSnapshot {
  branch: string;
  head: string;
  divergence: {
    status: 'unavailable' | 'available';
    reason: string;
  };
  gitStatusPath: string;
  trackedDiffPath: string;
  stagedDiffPath: string;
  diffStatPath: string;
  untracked: ContextBenchUntrackedSnapshotEntry[];
  lockfiles: ContextBenchArtifactIndexEntry[];
  redactedEnvVarNames: string[];
  versions: Record<string, string>;
  fixtureHashes: Record<string, string>;
  commandTranscript: ContextBenchCommandTranscriptEntry[];
  snapshotHash: string;
}

export interface ContextBenchBaselineSlotReservation {
  laneId: string;
  taskId: string;
  repeatIndex: number;
  status: ContextBenchBaselineSlotStatus;
  terminalStatus: ContextBenchTerminalStatus | null;
  reason: string | null;
}

export interface ContextBenchBaselineSession {
  sessionId: string;
  phase: 40;
  createdAt: string;
  updatedAt: string;
  sessionRoot: string;
  claimBearing: false;
  sealed: boolean;
  snapshot: ContextBenchDirtyWorktreeSnapshot;
  reservationsPath: string;
  runManifestPath: string;
  artifactIndex: ContextBenchArtifactIndexEntry[];
  sessionHash: string;
}

export interface ContextBenchCodebaseContextBaselineArm {
  baselineArmId: string;
  laneId: 'codebase-context';
  sourceIdentity: string;
  allowedToolSurfaces: string[];
  versionOrSourceRef: string;
  setupCommand: string;
  claimBearing: false;
  failurePolicy: 'record_terminal_diagnostic_failure';
}

export interface ContextBenchCodebaseContextBaselineArmsFixture {
  name: string;
  protocolVersion: string;
  phase: 40;
  claimBearing: false;
  denominatorPolicy: string;
  arms: ContextBenchCodebaseContextBaselineArm[];
}

export interface ContextBenchEvidenceReference {
  file: string;
  lineRange: {
    start: number;
    end: number;
  };
  reason: string;
}

export type ContextBenchConfidence = 'low' | 'medium' | 'high';

export interface ContextBenchStructuredAnswer {
  answer: JsonValue;
  confidence: ContextBenchConfidence;
  evidence: ContextBenchEvidenceReference[];
  filesReferenced: string[];
  symbolsReferenced: string[];
  unsupportedClaims: string[];
  readyToEdit: boolean;
}

export interface ContextBenchSetupIndexMetadata {
  setupCommand: string;
  indexCommand: string;
  setupDurationMs: number;
  indexDurationMs: number;
  setupLogPath: string;
  indexLogPath: string;
  setupStatus: 'not_required' | 'completed' | 'setup_failed';
  indexStatus: 'not_required' | 'completed' | 'index_failed';
  taskMaterializationStatus?: 'not_required' | 'completed' | 'failed';
  taskMaterializationErrors?: string[];
}

export type ContextBenchExecutor = 'fake' | 'claude' | 'codex' | 'gemini' | 'opencode';

export interface ContextBenchTaskExecutionMetadata {
  model: string;
  timeoutSeconds: number;
  maxContextTokens: number;
  maxAnswerTokens: number;
  startedAt: string;
  completedAt: string;
  taskWallTimeMs: number;
  executor: ContextBenchExecutor;
}

export interface ContextBenchScoringMetadata {
  officialEvaluatorFirst: boolean;
  officialEvaluatorAttempted?: boolean;
  officialEvaluatorInvoked?: boolean;
  command: string;
  claimBearing: boolean;
  fallbackReason?: string;
  stdoutPath?: string;
  stderrPath?: string;
}

export interface ContextBenchRunManifestRow {
  run_id: string;
  protocol_version: string;
  protocol_hash: string;
  task_manifest_hash: string;
  lane_id: string;
  task_id: string;
  repeat_index: number;
  status: ContextBenchTerminalStatus;
  started_at: string;
  completed_at: string;
  raw_trace_path: string;
  structured_answer_path: string;
  trajectory_path: string;
  score_path: string;
  setup_index_path: string;
  prompt_path: string;
  lane_tool_card_path: string;
  setupIndex: ContextBenchSetupIndexMetadata;
  taskExecution: ContextBenchTaskExecutionMetadata;
  scoring: ContextBenchScoringMetadata;
  hashes: Record<string, string>;
}

export interface ContextBenchPredSpan {
  start: number;
  end: number | null;
  full_file: boolean;
}

export interface ContextBenchTrajectoryRecord {
  instance_id: string;
  repo_url: string;
  commit: string;
  traj_data: {
    pred_steps: Array<{
      files: string[];
      spans: Record<string, ContextBenchPredSpan[]>;
    }>;
    pred_files: string[];
    pred_spans: Record<string, ContextBenchPredSpan[]>;
  };
  model_patch: string;
}

export function isContextBenchTerminalStatus(value: string): value is ContextBenchTerminalStatus {
  return CONTEXTBENCH_TERMINAL_STATUSES.includes(value as ContextBenchTerminalStatus);
}
