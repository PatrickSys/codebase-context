import type { ContextBenchRunManifestRow } from './contextbench-types.js';

export type ContextBenchEvidenceGateFailureCode =
  | 'summary_not_claim_pass'
  | 'artifact_verification_missing'
  | 'protocol_claims_disabled'
  | 'denominator_contract_missing'
  | 'denominator_count_mismatch'
  | 'protocol_hash_mismatch'
  | 'task_manifest_hash_mismatch'
  | 'missing_required_run'
  | 'duplicate_required_run'
  | 'unexpected_run_row'
  | 'non_completed_status'
  | 'official_evaluator_missing'
  | 'diagnostic_fallback_only'
  | 'lane_isolation_missing'
  | 'lane_isolation_violation'
  | 'setup_index_cost_missing'
  | 'runner_provenance_missing'
  | 'runner_provenance_mismatch';

export interface ContextBenchEvidenceGateFailure {
  code: ContextBenchEvidenceGateFailureCode;
  runId?: string;
  laneId?: string;
  taskId?: string;
  repeatIndex?: number;
  message: string;
}

export interface ContextBenchEvidenceGateResult {
  shapePass: boolean;
  claimPass: boolean;
  diagnosticOnly: boolean;
  failures: ContextBenchEvidenceGateFailure[];
}

export type ContextBenchEvidenceMode = 'synthetic_shape' | 'artifact_verified';

export interface ContextBenchLaneEvidencePolicy {
  laneId: string;
  expectedContextTool: string;
  allowedTools: string[];
  disallowedTools: string[];
  allowMultipleObservedTools?: boolean;
}

export interface ContextBenchLaneIsolationEvidence {
  laneId: string;
  proven: boolean;
  sourceKind?: 'not_captured' | 'env_override' | 'transcript' | 'proxy';
  expectedContextTool: string;
  allowedTools: string[];
  observedTools: string[];
  violations?: string[];
}

export interface ContextBenchRawTraceEvidence {
  executor?: string;
  model?: string;
  runnerHash?: string;
}

export interface ContextBenchScoreEvidence {
  status?: string;
  mode?: string;
  claimBearing?: boolean;
  officialEvaluatorInvoked?: boolean;
  command?: string;
  exitCode?: number;
  outputPath?: string;
  outputHash?: string;
  stdoutPath?: string;
  stderrPath?: string;
}

export interface ContextBenchSetupIndexEvidence {
  setupStatus?: string;
  indexStatus?: string;
  setupDurationMs?: number;
  indexDurationMs?: number;
  setupLogPath?: string;
  indexLogPath?: string;
}

export interface ContextBenchRunEvidenceArtifacts {
  rawTrace?: ContextBenchRawTraceEvidence;
  score?: ContextBenchScoreEvidence;
  setupIndex?: ContextBenchSetupIndexEvidence;
  laneIsolation?: ContextBenchLaneIsolationEvidence;
}

export interface ContextBenchEvidenceGateInput {
  evidenceMode: ContextBenchEvidenceMode;
  protocol: {
    claimAllowed: boolean;
    benchmarkTarget: {
      officialEvaluatorFirst: boolean;
    };
  };
  requiredLaneIds: string[];
  requiredTaskIds: string[];
  requiredRepeats: number;
  expectedTotalRows: number;
  expectedProtocolHash: string;
  expectedTaskManifestHash: string;
  lanePoliciesById: Record<string, ContextBenchLaneEvidencePolicy>;
  rows: ContextBenchRunManifestRow[];
  artifactsByRunId: Record<string, ContextBenchRunEvidenceArtifacts>;
  artifactHashesByPath: Record<string, string>;
  expectedRunnerHash?: string;
  currentRunnerHash?: string;
}

function makeFailure(
  row: Pick<ContextBenchRunManifestRow, 'run_id' | 'lane_id' | 'task_id' | 'repeat_index'>,
  code: ContextBenchEvidenceGateFailureCode,
  message: string
): ContextBenchEvidenceGateFailure {
  return {
    code,
    runId: row.run_id,
    laneId: row.lane_id,
    taskId: row.task_id,
    repeatIndex: row.repeat_index,
    message
  };
}

function hasMeasuredSetupIndex(
  row: ContextBenchRunManifestRow,
  evidence: ContextBenchSetupIndexEvidence | undefined
): boolean {
  if (!evidence) return false;
  const setupDuration = evidence.setupDurationMs;
  const indexDuration = evidence.indexDurationMs;
  if (typeof setupDuration !== 'number' || typeof indexDuration !== 'number') return false;
  if (!Number.isFinite(setupDuration) || !Number.isFinite(indexDuration)) return false;
  if (!evidence.setupStatus || !evidence.indexStatus) return false;
  if (!evidence.setupLogPath || !evidence.indexLogPath) return false;
  if (!['completed', 'not_required'].includes(evidence.setupStatus)) return false;
  if (!['completed', 'not_required'].includes(evidence.indexStatus)) return false;
  if (evidence.setupStatus === 'completed' && setupDuration <= 0) return false;
  if (evidence.indexStatus === 'completed' && indexDuration <= 0) return false;
  if (row.setupIndex.setupStatus !== evidence.setupStatus) return false;
  if (row.setupIndex.indexStatus !== evidence.indexStatus) return false;
  if (row.setupIndex.setupDurationMs !== evidence.setupDurationMs) return false;
  if (row.setupIndex.indexDurationMs !== evidence.indexDurationMs) return false;
  if (row.setupIndex.setupLogPath !== evidence.setupLogPath) return false;
  if (row.setupIndex.indexLogPath !== evidence.indexLogPath) return false;
  return true;
}

function hasSha256Hash(value: string | undefined): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value ?? '');
}

function hasOfficialEvaluatorProof(
  row: ContextBenchRunManifestRow,
  score: ContextBenchScoreEvidence | undefined,
  artifactHashesByPath: Record<string, string>
): boolean {
  return (
    row.scoring.officialEvaluatorFirst === true &&
    row.scoring.officialEvaluatorAttempted === true &&
    row.scoring.officialEvaluatorInvoked === true &&
    row.scoring.claimBearing === true &&
    score?.officialEvaluatorInvoked === true &&
    score.claimBearing === true &&
    score.mode === 'official_evaluator' &&
    score.status === 'completed' &&
    score.exitCode === 0 &&
    typeof score.command === 'string' &&
    score.command.includes('contextbench.evaluate') &&
    typeof score.outputPath === 'string' &&
    score.outputPath.length > 0 &&
    hasSha256Hash(score.outputHash) &&
    artifactHashesByPath[score.outputPath] === score.outputHash &&
    hasSha256Hash(artifactHashesByPath[row.score_path]) &&
    typeof score.stdoutPath === 'string' &&
    score.stdoutPath.length > 0 &&
    hasSha256Hash(artifactHashesByPath[score.stdoutPath]) &&
    typeof score.stderrPath === 'string' &&
    score.stderrPath.length > 0 &&
    hasSha256Hash(artifactHashesByPath[score.stderrPath])
  );
}

function hasDiagnosticFallback(row: ContextBenchRunManifestRow, score: ContextBenchScoreEvidence | undefined): boolean {
  return row.scoring.claimBearing === false || Boolean(row.scoring.fallbackReason) || score?.mode === 'diagnostic_fallback';
}

function hasLaneIsolationProof(
  row: ContextBenchRunManifestRow,
  isolation: ContextBenchLaneIsolationEvidence | undefined,
  policy: ContextBenchLaneEvidencePolicy | undefined
): boolean {
  if (!isolation?.proven) return false;
  if (!policy) return false;
  if (!isolation.sourceKind || ['not_captured', 'env_override'].includes(isolation.sourceKind)) return false;
  if (policy.laneId !== row.lane_id) return false;
  if (isolation.laneId !== row.lane_id) return false;
  if (isolation.expectedContextTool !== policy.expectedContextTool) return false;
  if (isolation.allowedTools.length === 0 || isolation.observedTools.length === 0) return false;
  if (isolation.violations && isolation.violations.length > 0) return false;
  if (policy.disallowedTools.some((tool) => isolation.observedTools.includes(tool))) return false;
  if (isolation.allowedTools.some((tool) => !policy.allowedTools.includes(tool))) return false;
  if (policy.allowMultipleObservedTools) {
    return isolation.observedTools.every((tool) => policy.allowedTools.includes(tool));
  }
  if (!isolation.allowedTools.includes(policy.expectedContextTool)) return false;
  if (isolation.observedTools.length !== 1) return false;
  return isolation.observedTools[0] === policy.expectedContextTool;
}

function hasRunnerProvenance(
  row: ContextBenchRunManifestRow,
  rawTrace: ContextBenchRawTraceEvidence | undefined,
  expectedRunnerHash: string | undefined
): boolean {
  if (!rawTrace?.executor || !rawTrace.model || !rawTrace.runnerHash || !expectedRunnerHash) return false;
  return (
    rawTrace.executor === row.taskExecution.executor &&
    rawTrace.model === row.taskExecution.model &&
    rawTrace.runnerHash === expectedRunnerHash &&
    row.hashes.runnerSourceHash === expectedRunnerHash
  );
}

function rowKey(row: Pick<ContextBenchRunManifestRow, 'lane_id' | 'task_id' | 'repeat_index'>): string {
  return `${row.lane_id}\u0000${row.task_id}\u0000${row.repeat_index}`;
}

export function evaluateContextBenchEvidenceGate(
  input: ContextBenchEvidenceGateInput
): ContextBenchEvidenceGateResult {
  const failures: ContextBenchEvidenceGateFailure[] = [];
  const expectedKeys = new Set<string>();

  if (input.evidenceMode !== 'artifact_verified') {
    failures.push({
      code: 'artifact_verification_missing',
      message: 'Synthetic shape evidence cannot produce claim-bearing benchmark pass.'
    });
  }

  if (!input.protocol.claimAllowed) {
    failures.push({
      code: 'protocol_claims_disabled',
      message: 'The protocol does not currently allow claim-bearing benchmark results.'
    });
  }

  if (input.expectedTotalRows <= 0 || input.requiredLaneIds.length === 0 || input.requiredTaskIds.length === 0) {
    failures.push({
      code: 'denominator_contract_missing',
      message: 'Claim validation requires a frozen denominator contract.'
    });
  }

  if (input.rows.length !== input.expectedTotalRows) {
    failures.push({
      code: 'denominator_count_mismatch',
      message: 'Run row count does not match the frozen expected denominator count.'
    });
  }

  for (const laneId of input.requiredLaneIds) {
    for (const taskId of input.requiredTaskIds) {
      for (let repeatIndex = 1; repeatIndex <= input.requiredRepeats; repeatIndex += 1) {
        expectedKeys.add(`${laneId}\u0000${taskId}\u0000${repeatIndex}`);
      }
    }
  }

  const rowCounts = new Map<string, number>();
  for (const row of input.rows) {
    const key = rowKey(row);
    rowCounts.set(key, (rowCounts.get(key) ?? 0) + 1);
    if (!expectedKeys.has(key)) {
      failures.push(
        makeFailure(
          row,
          'unexpected_run_row',
          'Rows outside the required denominator must not be hidden from claim validation.'
        )
      );
    }
    if (row.protocol_hash !== input.expectedProtocolHash) {
      failures.push(
        makeFailure(row, 'protocol_hash_mismatch', 'Row protocol hash does not match the frozen protocol hash.')
      );
    }
    if (row.task_manifest_hash !== input.expectedTaskManifestHash) {
      failures.push(
        makeFailure(
          row,
          'task_manifest_hash_mismatch',
          'Row task manifest hash does not match the frozen task manifest hash.'
        )
      );
    }
  }

  for (const row of input.rows) {
    if ((rowCounts.get(rowKey(row)) ?? 0) > 1) {
      failures.push(
        makeFailure(
          row,
          'duplicate_required_run',
          'Duplicate lane/task/repeat rows make the evidence denominator ambiguous.'
        )
      );
    }
  }

  if (!input.expectedRunnerHash || !input.currentRunnerHash) {
    failures.push({
      code: 'runner_provenance_missing',
      message: 'Expected and current runner hashes are required for claim-bearing validation.'
    });
  } else if (input.expectedRunnerHash !== input.currentRunnerHash) {
    failures.push({
      code: 'runner_provenance_mismatch',
      message: 'Current runner hash does not match the expected generation runner hash.'
    });
  }

  for (const laneId of input.requiredLaneIds) {
    for (const taskId of input.requiredTaskIds) {
      for (let repeatIndex = 1; repeatIndex <= input.requiredRepeats; repeatIndex += 1) {
        const matchingRows = input.rows.filter(
          (candidate) =>
            candidate.lane_id === laneId &&
            candidate.task_id === taskId &&
            candidate.repeat_index === repeatIndex
        );
        const row = matchingRows[0];

        if (!row) {
          failures.push({
            code: 'missing_required_run',
            laneId,
            taskId,
            repeatIndex,
            message: 'A required lane/task/repeat row is missing from the evidence denominator.'
          });
          continue;
        }

        const artifacts = input.artifactsByRunId[row.run_id];
        if (row.status !== 'completed') {
          failures.push(makeFailure(row, 'non_completed_status', 'Claim-bearing runs must complete.'));
        }

        if (
          input.protocol.benchmarkTarget.officialEvaluatorFirst &&
          !hasOfficialEvaluatorProof(row, artifacts?.score, input.artifactHashesByPath)
        ) {
          failures.push(
            makeFailure(
              row,
              'official_evaluator_missing',
              'Official evaluator proof is required before this row can support claims.'
            )
          );
        }

        if (hasDiagnosticFallback(row, artifacts?.score)) {
          failures.push(
            makeFailure(
              row,
              'diagnostic_fallback_only',
              'Diagnostic fallback scoring cannot satisfy the claim-bearing evidence gate.'
            )
          );
        }

        if (!hasLaneIsolationProof(row, artifacts?.laneIsolation, input.lanePoliciesById[row.lane_id])) {
          failures.push(
            makeFailure(
              row,
              artifacts?.laneIsolation?.violations?.length ? 'lane_isolation_violation' : 'lane_isolation_missing',
              'Lane isolation must be proven by explicit allowed/observed tool evidence.'
            )
          );
        }

        if (!hasMeasuredSetupIndex(row, artifacts?.setupIndex)) {
          failures.push(
            makeFailure(
              row,
              'setup_index_cost_missing',
              'Setup/index statuses, durations, and log references are required.'
            )
          );
        }

        if (!hasRunnerProvenance(row, artifacts?.rawTrace, input.expectedRunnerHash)) {
          failures.push(
            makeFailure(
              row,
              'runner_provenance_mismatch',
              'Raw trace executor/model metadata must match the manifest row.'
            )
          );
        }
      }
    }
  }

  const blockingFailures = failures.filter((failure) => failure.code !== 'artifact_verification_missing');
  const shapePass = blockingFailures.length === 0;
  const claimPass = failures.length === 0;
  return {
    shapePass,
    claimPass,
    diagnosticOnly: !claimPass,
    failures
  };
}
