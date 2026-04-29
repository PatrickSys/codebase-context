import { describe, expect, it } from 'vitest';
import protocolFixture from './fixtures/contextbench-benchmark-protocol.json';
import correctionsFixture from './fixtures/contextbench-corrections.json';
import lanesFixture from './fixtures/contextbench-lanes.json';

type ProtocolFixture = {
  name: string;
  protocolVersion: string;
  status: string;
  claimAllowed: boolean;
  phaseBoundary: {
    phase36Freezes: string[];
    phase37Freezes: string[];
    phase36MustNotFreeze: string[];
  };
  benchmarkTarget: {
    primary: string;
    datasetConfig: string;
    officialEvaluatorFirst: boolean;
    fallbackScorerPolicy: {
      claimBearing: boolean;
      requiresValidationAgainstOfficialOutputs: boolean;
    };
  };
  taskSlicePolicy: {
    sliceKind: string;
    taskCount: { min: number; max: number };
    selectedInPhase: number;
    phase36SelectionSchemaOnly: boolean;
    requiredManifestFields: string[];
    selectionMethodRequiredFields: string[];
    coverageConstraints: {
      minRepos: number;
      minLanguages: number;
      selectionBeforeOutputs: boolean;
    };
    hardnessSignalPolicy: {
      required: boolean;
      status: string;
      proxyAllowed: boolean;
      selectionMustRecordAbsence: boolean;
    };
    forbiddenSources: string[];
  };
  smokeOnlyCorpora: Array<{ name: string; claimBearing: boolean }>;
  runPolicy: {
    smokeRunsPerTaskLane: number;
    claimBearingRunsPerTaskLane: number;
    fewerThanClaimRunsMeans: string;
    bestOfNReportingAllowed: boolean;
  };
  minimalRunnerBehavior: { mustNotScript: string[] };
  structuredAnswerSchema: { requiredFields: string[]; invalidSchemaStatus: string };
  trajectorySchema: { requiredFields: string[]; rawTracePreservationRequired: boolean };
  metrics: {
    primary: string[];
    secondary: string[];
    efficiencyIsSecondary: boolean;
    tokenSavingsWinRequiresCorrectnessNonRegression: boolean;
  };
  factRecallJudgeScope: {
    allowedOnlyFor: string[];
    forbiddenFor: string[];
    uncertainCountsAsSuccess: boolean;
  };
  budgets: {
    sameModelAcrossLanes: boolean;
    setupAndIndexingReportedSeparately: boolean;
    defaults: Record<string, number>;
  };
  thresholds: {
    claimBearingRunsPerTaskLane: number;
    setupFailuresBlockBroadClaims: boolean;
    thresholdChangesRequireCorrection: boolean;
    wedgeWinRequires: string[];
  };
  failureTaxonomy: string[];
  runManifestSchema: {
    appendOnly: boolean;
    claimRunsRequireSlotsForEveryTaskLaneRepeat: boolean;
    requiredFields: string[];
    terminalStatuses: string[];
    failedRunsIncludedInAggregates: boolean;
  };
  protocolFingerprint: { required: boolean; covers: string[] };
  architectureReviewRule: {
    requiredBeforePostBaselineProductChanges: boolean;
    mustRejectTaskSpecificHeuristics: boolean;
    requiresFrozenRerun: boolean;
  };
  postBaselineCycleGate: {
    maxImprovementCyclesBeforeDecision: number;
    allowedDecisions: string[];
    noDecisionMeans: string;
  };
  tripwires: string[];
  blockedClaims: string[];
};

type CorrectionsFixture = {
  protocolVersion: string;
  corrections: Array<Record<string, string | string[]>>;
  policy: {
    silentChangesAllowed: boolean;
    allowedReasonCategories: string[];
    requiresProtocolVersionBumpFor: string[];
    requiredCorrectionFields: string[];
    forbiddenReasons: string[];
    anyFixtureChangeRequiresCorrection: boolean;
    comparisonAcrossVersionsRequiresFullRerun: boolean;
  };
};

type Lane = {
  laneId: string;
  phase36Status: string;
  contextTool: string;
  allowedTools: string[];
  disallowedTools: string[];
  nativeToolsAllowed: boolean;
  setupCostReportedSeparately: boolean;
  indexCostReportedSeparately: boolean;
  cacheIsolationRequired: boolean;
};

type LanesFixture = {
  protocolVersion: string;
  initialExternalGate: string[];
  broadClaimLaneSet: string[];
  broadClaimsRequireAllLanesComplete: boolean;
  setupFailedRequiredLaneBlocksBroadClaims: boolean;
  lanes: Lane[];
  setupFailureSemantics: {
    status: string;
    winEligible: boolean;
    claimContribution: string;
    includedInPublicationRows: boolean;
    blocksBroadClaimsForRequiredLane: boolean;
    requiresReproductionCommand: boolean;
    requiresLogs: boolean;
  };
  laneContaminationRules: Record<string, boolean>;
  laneToolCardRequiredFields: string[];
};

const protocol = protocolFixture as ProtocolFixture;
const corrections = correctionsFixture as CorrectionsFixture;
const lanes = lanesFixture as LanesFixture;

const requiredFailureStatuses = [
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

describe('ContextBench benchmark protocol invariants', () => {
  it('keeps Phase 36 schema-only and leaves actual task identity freeze to Phase 37', () => {
    expect(protocol.benchmarkTarget.primary).toBe('ContextBench');
    expect(protocol.benchmarkTarget.datasetConfig).toBe('contextbench_verified');
    expect(protocol.taskSlicePolicy.phase36SelectionSchemaOnly).toBe(true);
    expect(protocol.taskSlicePolicy.selectedInPhase).toBe(37);
    expect(protocol.taskSlicePolicy.taskCount).toEqual({ min: 20, max: 50 });
    expect(protocol.phaseBoundary.phase36MustNotFreeze).toContain('actual_task_ids');
    expect(protocol.phaseBoundary.phase36MustNotFreeze).toContain('actual_repo_commits');
    expect(protocol.phaseBoundary.phase37Freezes).toContain('actual_contextbench_instance_ids');
    expect(protocol.taskSlicePolicy.requiredManifestFields).toEqual(
      expect.arrayContaining([
        'instance_id',
        'repo_url',
        'base_commit',
        'problem_statement_hash',
        'gold_context_hash',
        'patch_hash',
        'test_patch_hash'
      ])
    );
    expect(protocol.taskSlicePolicy.selectionMethodRequiredFields).toEqual(
      expect.arrayContaining([
        'selection_algorithm',
        'task_pool_hash',
        'selection_timestamp',
        'inclusion_rationale',
        'exclusion_log_path',
        'no_lane_outputs_observed_attestation'
      ])
    );
    expect(protocol.taskSlicePolicy.forbiddenSources).toEqual(
      expect.arrayContaining([
        'agent_outputs',
        'codebase_context_outputs',
        'competitor_outputs',
        'post_failure_task_filtering'
      ])
    );
    expect(protocol.taskSlicePolicy.coverageConstraints.minRepos).toBeGreaterThanOrEqual(2);
    expect(protocol.taskSlicePolicy.coverageConstraints.minLanguages).toBeGreaterThanOrEqual(2);
    expect(protocol.taskSlicePolicy.coverageConstraints.selectionBeforeOutputs).toBe(true);
    expect(protocol.taskSlicePolicy.hardnessSignalPolicy).toEqual({
      required: false,
      status: 'unavailable_in_contextbench_verified_schema',
      proxyAllowed: false,
      selectionMustRecordAbsence: true
    });
  });

  it('records unavailable hardness as a schema fact and forbids proxy scoring', () => {
    expect(protocol.taskSlicePolicy.hardnessSignalPolicy.required).toBe(false);
    expect(protocol.taskSlicePolicy.hardnessSignalPolicy.status).toBe(
      'unavailable_in_contextbench_verified_schema'
    );
    expect(protocol.taskSlicePolicy.hardnessSignalPolicy.proxyAllowed).toBe(false);
    expect(protocol.taskSlicePolicy.hardnessSignalPolicy.selectionMustRecordAbsence).toBe(true);
    expect(JSON.stringify(protocol)).not.toContain('mustIncludeHardTasks');
  });

  it('freezes smoke and claim-bearing run-count policy', () => {
    expect(protocol.runPolicy.smokeRunsPerTaskLane).toBe(1);
    expect(protocol.runPolicy.claimBearingRunsPerTaskLane).toBe(3);
    expect(protocol.runPolicy.fewerThanClaimRunsMeans).toBe('diagnostic_only_claim_allowed_false');
    expect(protocol.runPolicy.bestOfNReportingAllowed).toBe(false);
    expect(protocol.thresholds.claimBearingRunsPerTaskLane).toBe(
      protocol.runPolicy.claimBearingRunsPerTaskLane
    );
  });

  it('keeps smoke corpora non-claim-bearing and blocks public claims before evidence', () => {
    expect(protocol.claimAllowed).toBe(false);
    expect(protocol.smokeOnlyCorpora).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Excalidraw', claimBearing: false }),
        expect.objectContaining({ name: 'FastAPI', claimBearing: false })
      ])
    );
    expect(protocol.blockedClaims).toEqual(
      expect.arrayContaining([
        'codebase_context_beats_competitors',
        'codebase_context_improves_patch_correctness',
        'focus_mode_improves_agent_outcomes',
        'token_savings_superiority',
        'setup_failed_competitor_is_loss'
      ])
    );
  });

  it('uses official ContextBench scoring first and constrains fallback scorer claims', () => {
    expect(protocol.benchmarkTarget.officialEvaluatorFirst).toBe(true);
    expect(protocol.benchmarkTarget.fallbackScorerPolicy.claimBearing).toBe(false);
    expect(
      protocol.benchmarkTarget.fallbackScorerPolicy.requiresValidationAgainstOfficialOutputs
    ).toBe(true);
    expect(protocol.tripwires).toContain(
      'official_evaluator_bypassed_without_documented_incompatibility'
    );
  });

  it('freezes runner boundaries, structured answers, budgets, and judge scope', () => {
    expect(protocol.minimalRunnerBehavior.mustNotScript).toEqual(
      expect.arrayContaining([
        'agent_decisions',
        'file_selection',
        'query_rewrites',
        'evidence_selection'
      ])
    );
    expect(protocol.structuredAnswerSchema.requiredFields).toEqual(
      expect.arrayContaining([
        'answer',
        'confidence',
        'evidence',
        'filesReferenced',
        'unsupportedClaims',
        'readyToEdit'
      ])
    );
    expect(protocol.structuredAnswerSchema.invalidSchemaStatus).toBe('invalid_schema');
    expect(protocol.trajectorySchema.requiredFields).toEqual([
      'pred_steps',
      'pred_files',
      'pred_spans'
    ]);
    expect(protocol.trajectorySchema.rawTracePreservationRequired).toBe(true);
    expect(protocol.budgets.sameModelAcrossLanes).toBe(true);
    expect(protocol.budgets.setupAndIndexingReportedSeparately).toBe(true);
    expect(protocol.budgets.defaults.maxContextTokens).toBeGreaterThan(0);
    expect(protocol.factRecallJudgeScope.forbiddenFor).toContain('broad_rubric_vibes');
    expect(protocol.factRecallJudgeScope.uncertainCountsAsSuccess).toBe(false);
  });

  it('prioritizes correctness metrics over token efficiency', () => {
    expect(protocol.metrics.primary).toEqual(
      expect.arrayContaining([
        'context_file_recall',
        'context_file_precision',
        'context_symbol_recall',
        'context_symbol_precision',
        'context_span_recall',
        'context_span_precision',
        'edit_location_recall',
        'edit_location_precision'
      ])
    );
    expect(protocol.metrics.efficiencyIsSecondary).toBe(true);
    expect(protocol.metrics.tokenSavingsWinRequiresCorrectnessNonRegression).toBe(true);
    expect(protocol.thresholds.wedgeWinRequires).toEqual(
      expect.arrayContaining(['no_correctness_regression', 'false_ready_rate_not_worse'])
    );
  });

  it('keeps the full failure taxonomy visible in terminal run statuses', () => {
    expect(protocol.failureTaxonomy).toEqual(requiredFailureStatuses);
    expect(protocol.runManifestSchema.terminalStatuses).toEqual(
      expect.arrayContaining(requiredFailureStatuses)
    );
    expect(protocol.runManifestSchema.appendOnly).toBe(true);
    expect(protocol.runManifestSchema.claimRunsRequireSlotsForEveryTaskLaneRepeat).toBe(true);
    expect(protocol.runManifestSchema.failedRunsIncludedInAggregates).toBe(true);
    expect(protocol.runManifestSchema.requiredFields).toEqual(
      expect.arrayContaining([
        'protocol_hash',
        'task_manifest_hash',
        'raw_trace_path',
        'score_path'
      ])
    );
  });

  it('requires protocol fingerprinting and correction-backed governance changes', () => {
    expect(protocol.protocolFingerprint.required).toBe(true);
    expect(protocol.protocolFingerprint.covers).toEqual(
      expect.arrayContaining([
        'protocol_fixture',
        'lane_fixture',
        'correction_fixture',
        'task_manifest_after_phase37'
      ])
    );
    expect(corrections.policy.silentChangesAllowed).toBe(false);
    expect(corrections.policy.anyFixtureChangeRequiresCorrection).toBe(true);
    expect(corrections.policy.comparisonAcrossVersionsRequiresFullRerun).toBe(true);
    expect(corrections.policy.requiresProtocolVersionBumpFor).toEqual(
      expect.arrayContaining([
        'task_ids',
        'repo_commits',
        'qrels',
        'thresholds',
        'metrics',
        'failure_taxonomy',
        'terminal_statuses',
        'blocked_claims',
        'lane_sets',
        'setup_failure_semantics',
        'correction_policy'
      ])
    );
    expect(corrections.policy.requiredCorrectionFields).toEqual(
      expect.arrayContaining([
        'correction_id',
        'reason_category',
        'prior_hash',
        'new_hash',
        'protocol_version_before',
        'protocol_version_after'
      ])
    );
    for (const correction of corrections.corrections) {
      for (const field of corrections.policy.requiredCorrectionFields) {
        expect(correction[field]).toBeTruthy();
      }
      expect(corrections.policy.allowedReasonCategories).toContain(correction.reason_category);
      expect(corrections.policy.forbiddenReasons).not.toContain(correction.reason_category);
    }
    expect(corrections.corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correction_id: 'contextbench-hardness-signal-policy-2026-04-27',
          reason_category: 'factual_erratum',
          affected_fields: expect.arrayContaining([
            'taskSlicePolicy.coverageConstraints.mustIncludeHardTasks',
            'taskSlicePolicy.hardnessSignalPolicy'
          ]),
          prior_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          new_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          protocol_version_before: 'contextbench-protocol-v1',
          protocol_version_after: 'contextbench-protocol-v1'
        })
      ])
    );
  });

  it('requires architecture review and one-cycle continue/pivot/kill governance', () => {
    expect(protocol.architectureReviewRule.requiredBeforePostBaselineProductChanges).toBe(true);
    expect(protocol.architectureReviewRule.mustRejectTaskSpecificHeuristics).toBe(true);
    expect(protocol.architectureReviewRule.requiresFrozenRerun).toBe(true);
    expect(protocol.postBaselineCycleGate.maxImprovementCyclesBeforeDecision).toBe(1);
    expect(protocol.postBaselineCycleGate.allowedDecisions).toEqual(['continue', 'pivot', 'kill']);
    expect(protocol.postBaselineCycleGate.noDecisionMeans).toBe('stop_no_more_product_work');
  });

  it('freezes anti-gaming tripwires for output-aware edits and run manipulation', () => {
    expect(protocol.tripwires).toEqual(
      expect.arrayContaining([
        'fixture_or_qrel_changed_after_outputs',
        'threshold_moved_after_failures',
        'setup_failed_treated_as_win',
        'smoke_task_used_as_claim',
        'mixed_context_tools_in_one_lane',
        'product_change_before_baseline',
        'benchmark_repo_name_or_task_phrase_heuristic_added',
        'failed_run_removed_from_denominator',
        'best_of_n_reported_as_primary',
        'official_evaluator_bypassed_without_documented_incompatibility'
      ])
    );
  });
});

describe('ContextBench lane governance invariants', () => {
  it('preserves initial gate lanes and full broad-claim lane set', () => {
    expect(lanes.initialExternalGate).toEqual([
      'raw-native',
      'codebase-context',
      'jcodemunch-repomapper'
    ]);
    expect(lanes.broadClaimLaneSet).toEqual([
      'raw-native',
      'codebase-context',
      'jcodemunch-repomapper',
      'grepai',
      'codebase-memory-mcp',
      'codegraphcontext'
    ]);
    expect(lanes.broadClaimsRequireAllLanesComplete).toBe(true);
    expect(lanes.setupFailedRequiredLaneBlocksBroadClaims).toBe(true);
  });

  it('enforces exactly one context tool per lane and blocks native shell leakage', () => {
    for (const lane of lanes.lanes) {
      expect(lane.disallowedTools).not.toContain(lane.contextTool);
      expect(lane.setupCostReportedSeparately).toBe(true);
      expect(lane.indexCostReportedSeparately).toBe(true);
      expect(lane.cacheIsolationRequired).toBe(true);
      if (lane.laneId === 'raw-native') {
        expect(lane.nativeToolsAllowed).toBe(true);
        expect(lane.allowedTools).toEqual(
          expect.arrayContaining(['native-read', 'native-search', 'native-shell-readonly'])
        );
      } else {
        expect(lane.nativeToolsAllowed).toBe(false);
        expect(lane.allowedTools).toEqual([lane.contextTool]);
        expect(lane.disallowedTools).toEqual(
          expect.arrayContaining(['native-read', 'native-search', 'native-shell-readonly'])
        );
      }
    }
    expect(lanes.laneContaminationRules.oneContextToolPerLane).toBe(true);
    expect(lanes.laneContaminationRules.mixedLaneContextInvalidatesRun).toBe(true);
    expect(lanes.laneContaminationRules.memoryStateMustBeIsolated).toBe(true);
  });

  it('treats setup failures as missing evidence instead of wins', () => {
    expect(lanes.setupFailureSemantics).toMatchObject({
      status: 'setup_failed',
      winEligible: false,
      claimContribution: 'missing_evidence',
      includedInPublicationRows: true,
      blocksBroadClaimsForRequiredLane: true,
      requiresReproductionCommand: true,
      requiresLogs: true
    });
  });

  it('requires lane tool cards to make setup, index, version, cache, and artifact paths explicit', () => {
    expect(lanes.laneToolCardRequiredFields).toEqual(
      expect.arrayContaining([
        'laneId',
        'allowedTools',
        'disallowedTools',
        'setupCommand',
        'indexCommand',
        'queryCommand',
        'versionCommand',
        'cachePath',
        'artifactPaths'
      ])
    );
  });
});
