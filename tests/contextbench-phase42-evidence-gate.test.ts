import { describe, expect, it } from 'vitest';
import {
  evaluateContextBenchEvidenceGate,
  type ContextBenchEvidenceGateInput,
  type ContextBenchRunEvidenceArtifacts
} from '../src/eval/contextbench-evidence-gate.js';
import type { ContextBenchRunManifestRow } from '../src/eval/contextbench-types.js';

const runnerHash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
const protocolHash = 'sha256:protocol';
const taskManifestHash = 'sha256:manifest';
const scoreHash = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const officialOutputHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const stdoutHash = 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const stderrHash = 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function baseRow(overrides: Partial<ContextBenchRunManifestRow> = {}): ContextBenchRunManifestRow {
  return {
    run_id: 'codebase-context-task-1-1-claude',
    protocol_version: 'contextbench-protocol-v1',
    protocol_hash: protocolHash,
    task_manifest_hash: taskManifestHash,
    lane_id: 'codebase-context',
    task_id: 'task-1',
    repeat_index: 1,
    status: 'completed',
    started_at: '2026-04-29T00:00:00.000Z',
    completed_at: '2026-04-29T00:00:05.000Z',
    raw_trace_path: 'runs/codebase-context-task-1-1-claude/raw-trace.json',
    structured_answer_path: 'runs/codebase-context-task-1-1-claude/structured-answer.json',
    trajectory_path: 'runs/codebase-context-task-1-1-claude/trajectory.json',
    score_path: 'runs/codebase-context-task-1-1-claude/score.json',
    setup_index_path: 'runs/codebase-context-task-1-1-claude/setup-index.json',
    prompt_path: 'runs/codebase-context-task-1-1-claude/prompt.txt',
    lane_tool_card_path: 'runs/codebase-context-task-1-1-claude/lane-card.json',
    setupIndex: {
      setupCommand: 'npx codebase-context index',
      indexCommand: 'npx codebase-context index',
      setupDurationMs: 120,
      indexDurationMs: 340,
      setupLogPath: 'runs/codebase-context-task-1-1-claude/setup.log',
      indexLogPath: 'runs/codebase-context-task-1-1-claude/index.log',
      setupStatus: 'completed',
      indexStatus: 'completed'
    },
    taskExecution: {
      model: 'claude-sonnet-4-5',
      timeoutSeconds: 600,
      maxContextTokens: 120000,
      maxAnswerTokens: 4000,
      startedAt: '2026-04-29T00:00:00.000Z',
      completedAt: '2026-04-29T00:00:05.000Z',
      taskWallTimeMs: 5000,
      executor: 'claude'
    },
    scoring: {
      officialEvaluatorFirst: true,
      officialEvaluatorAttempted: true,
      officialEvaluatorInvoked: true,
      command: 'python -m contextbench.evaluate --gold gold.parquet --pred trajectory.json --out official.jsonl',
      claimBearing: true
    },
    hashes: {
      runnerSourceHash: runnerHash
    },
    ...overrides
  };
}

function passingArtifacts(overrides: Partial<ContextBenchRunEvidenceArtifacts> = {}): ContextBenchRunEvidenceArtifacts {
  return {
    rawTrace: {
      executor: 'claude',
      model: 'claude-sonnet-4-5',
      runnerHash
    },
    score: {
      status: 'completed',
      mode: 'official_evaluator',
      claimBearing: true,
      officialEvaluatorInvoked: true,
      command: 'python -m contextbench.evaluate --gold gold.parquet --pred trajectory.json --out official.jsonl',
      exitCode: 0,
      outputPath: 'runs/codebase-context-task-1-1-claude/official-results.jsonl',
      outputHash: officialOutputHash,
      stdoutPath: 'runs/codebase-context-task-1-1-claude/official.stdout.log',
      stderrPath: 'runs/codebase-context-task-1-1-claude/official.stderr.log'
    },
    setupIndex: {
      setupStatus: 'completed',
      indexStatus: 'completed',
      setupDurationMs: 120,
      indexDurationMs: 340,
      setupLogPath: 'runs/codebase-context-task-1-1-claude/setup.log',
      indexLogPath: 'runs/codebase-context-task-1-1-claude/index.log'
    },
    laneIsolation: {
      laneId: 'codebase-context',
      proven: true,
      sourceKind: 'proxy',
      expectedContextTool: 'codebase-context',
      allowedTools: ['codebase-context'],
      observedTools: ['codebase-context']
    },
    ...overrides
  };
}

function passingInput(overrides: Partial<ContextBenchEvidenceGateInput> = {}): ContextBenchEvidenceGateInput {
  const row = baseRow();
  return {
    evidenceMode: 'artifact_verified',
    protocol: {
      claimAllowed: true,
      benchmarkTarget: {
        officialEvaluatorFirst: true
      }
    },
    requiredLaneIds: ['codebase-context'],
    requiredTaskIds: ['task-1'],
    requiredRepeats: 1,
    expectedTotalRows: 1,
    expectedProtocolHash: protocolHash,
    expectedTaskManifestHash: taskManifestHash,
    lanePoliciesById: {
      'codebase-context': {
        laneId: 'codebase-context',
        expectedContextTool: 'codebase-context',
        allowedTools: ['codebase-context'],
        disallowedTools: ['native-read', 'native-search', 'native-shell-readonly']
      }
    },
    rows: [row],
    artifactsByRunId: {
      [row.run_id]: passingArtifacts()
    },
    artifactHashesByPath: {
      [row.score_path]: scoreHash,
      'runs/codebase-context-task-1-1-claude/official-results.jsonl': officialOutputHash,
      'runs/codebase-context-task-1-1-claude/official.stdout.log': stdoutHash,
      'runs/codebase-context-task-1-1-claude/official.stderr.log': stderrHash
    },
    expectedRunnerHash: runnerHash,
    currentRunnerHash: runnerHash,
    ...overrides
  };
}

function failureCodes(input: ContextBenchEvidenceGateInput): string[] {
  return evaluateContextBenchEvidenceGate(input).failures.map((failure) => failure.code);
}

describe('ContextBench Phase 42 evidence gate', () => {
  it('allows synthetic shape validation but never treats it as claim-pass', () => {
    const result = evaluateContextBenchEvidenceGate(
      passingInput({ evidenceMode: 'synthetic_shape' })
    );
    expect(result.shapePass).toBe(true);
    expect(result.claimPass).toBe(false);
    expect(result.diagnosticOnly).toBe(true);
    expect(result.failures.map((failure) => failure.code)).toEqual(['artifact_verification_missing']);
  });

  it('rejects synthetic evidence when official evaluator invocation is missing', () => {
    const row = baseRow({
      scoring: {
        officialEvaluatorFirst: true,
        officialEvaluatorAttempted: true,
        officialEvaluatorInvoked: false,
        command: 'python -m contextbench.evaluate',
        claimBearing: false,
        fallbackReason: 'official_evaluator_not_invoked'
      }
    });
    const input = passingInput({
      rows: [row],
      artifactsByRunId: {
        [row.run_id]: passingArtifacts({
          score: {
            status: 'judge_failed',
            mode: 'diagnostic_fallback',
            claimBearing: false,
            officialEvaluatorInvoked: false,
            command: 'python -m contextbench.evaluate',
            exitCode: 1,
            outputPath: 'official-results.jsonl',
            outputHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            stdoutPath: 'official.stdout.log',
            stderrPath: 'official.stderr.log'
          }
        })
      },
      artifactHashesByPath: {}
    });
    expect(failureCodes(input)).toEqual(
      expect.arrayContaining(['official_evaluator_missing', 'diagnostic_fallback_only'])
    );
  });

  it('rejects synthetic evidence when lane isolation proof is missing', () => {
    const row = baseRow();
    const input = passingInput({
      artifactsByRunId: {
        [row.run_id]: passingArtifacts({ laneIsolation: undefined })
      }
    });
    expect(failureCodes(input)).toContain('lane_isolation_missing');
  });

  it('rejects synthetic evidence when lane isolation telemetry is empty', () => {
    const row = baseRow();
    const input = passingInput({
      artifactsByRunId: {
        [row.run_id]: passingArtifacts({
          laneIsolation: {
            laneId: 'codebase-context',
            proven: true,
            sourceKind: 'proxy',
            expectedContextTool: 'codebase-context',
            allowedTools: ['codebase-context'],
            observedTools: []
          }
        })
      }
    });
    expect(failureCodes(input)).toContain('lane_isolation_missing');
  });

  it('rejects synthetic evidence when ready lane setup/index evidence is missing', () => {
    const row = baseRow();
    const input = passingInput({
      artifactsByRunId: {
        [row.run_id]: passingArtifacts({
          setupIndex: {
            setupStatus: 'completed',
            indexStatus: 'completed',
            setupDurationMs: 0,
            indexDurationMs: 0,
            setupLogPath: 'setup.log',
            indexLogPath: 'index.log'
          }
        })
      }
    });
    expect(failureCodes(input)).toContain('setup_index_cost_missing');
  });

  it('rejects synthetic evidence when runner provenance does not match', () => {
    const input = passingInput({
      currentRunnerHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222'
    });
    expect(failureCodes(input)).toContain('runner_provenance_mismatch');
  });

  it('rejects duplicate and unexpected rows so the denominator cannot be narrowed', () => {
    const row = baseRow();
    const duplicate = baseRow({ run_id: 'duplicate-run' });
    const unexpected = baseRow({ run_id: 'unexpected-run', task_id: 'task-outside-denominator' });
    const input = passingInput({
      rows: [row, duplicate, unexpected],
      expectedTotalRows: 1,
      artifactsByRunId: {
        [row.run_id]: passingArtifacts(),
        [duplicate.run_id]: passingArtifacts(),
        [unexpected.run_id]: passingArtifacts()
      }
    });
    expect(failureCodes(input)).toEqual(
      expect.arrayContaining(['duplicate_required_run', 'unexpected_run_row'])
    );
  });

  it('rejects evidence when row count is narrower than the frozen denominator', () => {
    const input = passingInput({ expectedTotalRows: 2 });
    expect(failureCodes(input)).toContain('denominator_count_mismatch');
  });

  it('rejects setup/index evidence that contradicts the manifest row', () => {
    const row = baseRow();
    const input = passingInput({
      artifactsByRunId: {
        [row.run_id]: passingArtifacts({
          setupIndex: {
            setupStatus: 'completed',
            indexStatus: 'completed',
            setupDurationMs: 999,
            indexDurationMs: 340,
            setupLogPath: 'runs/codebase-context-task-1-1-claude/setup.log',
            indexLogPath: 'runs/codebase-context-task-1-1-claude/index.log'
          }
        })
      }
    });
    expect(failureCodes(input)).toContain('setup_index_cost_missing');
  });

  it('rejects self-attested official evaluator proof without command output artifacts', () => {
    const row = baseRow();
    const input = passingInput({
      artifactsByRunId: {
        [row.run_id]: passingArtifacts({
          score: {
            status: 'completed',
            mode: 'official_evaluator',
            claimBearing: true,
            officialEvaluatorInvoked: true
          }
        })
      }
    });
    expect(failureCodes(input)).toContain('official_evaluator_missing');
  });

  it('passes artifact-verified evidence with official evaluator, lane isolation, setup/index, and matching runner provenance', () => {
    const result = evaluateContextBenchEvidenceGate(passingInput());
    expect(result).toEqual({
      shapePass: true,
      claimPass: true,
      diagnosticOnly: false,
      failures: []
    });
  });

  it('allows raw-native policy to prove multiple native observations without collapsing them into one fake tool', () => {
    const row = baseRow({ lane_id: 'raw-native', run_id: 'raw-native-task-1-1-claude' });
    const input = passingInput({
      requiredLaneIds: ['raw-native'],
      rows: [row],
      lanePoliciesById: {
        'raw-native': {
          laneId: 'raw-native',
          expectedContextTool: 'native-agent-tools',
          allowedTools: ['native-read', 'native-search', 'native-shell-readonly'],
          disallowedTools: ['codebase-context'],
          allowMultipleObservedTools: true
        }
      },
      artifactsByRunId: {
        [row.run_id]: passingArtifacts({
          laneIsolation: {
            laneId: 'raw-native',
            proven: true,
            sourceKind: 'proxy',
            expectedContextTool: 'native-agent-tools',
            allowedTools: ['native-read', 'native-search', 'native-shell-readonly'],
            observedTools: ['native-read', 'native-search']
          }
        })
      }
    });
    expect(evaluateContextBenchEvidenceGate(input).claimPass).toBe(true);
  });

  it('rejects env-injected lane telemetry for artifact-verified claim pass', () => {
    const row = baseRow();
    const input = passingInput({
      artifactsByRunId: {
        [row.run_id]: passingArtifacts({
          laneIsolation: {
            laneId: 'codebase-context',
            proven: true,
            sourceKind: 'env_override',
            expectedContextTool: 'codebase-context',
            allowedTools: ['codebase-context'],
            observedTools: ['codebase-context']
          }
        })
      }
    });
    expect(failureCodes(input)).toContain('lane_isolation_missing');
  });
});
