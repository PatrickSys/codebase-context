import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import laneToolCardsFixture from './fixtures/contextbench-lane-tool-cards.json';
import lanesFixture from './fixtures/contextbench-lanes.json';
import methodologyFixture from './fixtures/contextbench-publishable-methodology.json';
import protocolFixture from './fixtures/contextbench-benchmark-protocol.json';

type OperatingModelTrack = {
  trackId: string;
  indexReuseScope: string;
  workspaceReuseScope: string;
  crossSnapshotReuseAllowed: boolean;
};

type PublishableMethodology = {
  schemaVersion: number;
  status: string;
  claimAllowed: boolean;
  baselineEvidence: {
    status: string;
    coldBaselineReportHash: string;
    knownClaimLimits: string[];
    preservationPolicy: string;
  };
  operatingModelTracks: OperatingModelTrack[];
  requiredLanes: string[];
  claimBearingReadinessLanes: string[];
  appendixLanes: Array<{ laneId: string; reason: string }>;
  vNextUserOwnedDecisions: {
    publicationPosture: string;
    paperGradeClaimAllowed: boolean;
    proofCandidateLabelRequiresAllGates: boolean;
    grepaiFailurePolicy: string;
    paidApiBudgetUsd: number;
    paidApiRequiresProviderPrivacyAndSpendRecord: boolean;
    repowiseHeadlineMode: string;
    repowiseHostedMode: string;
    jcodemunchPrimaryMode: string;
    jcodemunchFallbackMode: string;
    taskSourceStrategy: string;
    patchQualityScope: string;
    publicationOrder: string[];
    stopBehavior: string;
  };
  vNextMinimumCredibleRun: {
    retrieval: {
      tasks: number;
      headlineLanes: string[];
      repeatsPerTaskLane: number;
      expectedRows: number;
      coldAndWarmMustStaySeparated: boolean;
    };
    patchQuality: {
      tasks: number;
      source: string;
      repeatsPerTaskLane: number;
      requiresBudgetGate: boolean;
      requiresEvaluatorReadiness: boolean;
    };
  };
  vNextLanePolicy: {
    headlineLanes: string[];
    fallbackLanes: Array<{ laneId: string; fallbackFor: string; claimLimit: string }>;
    appendixLanes: Array<{ laneId: string; reason: string }>;
    fullMatrixRequiresAllHeadlineLanesReadyBeforeOutputs: boolean;
    notReadyLaneCannotBeScheduledForHeadlineMatrix: boolean;
  };
  proofBundleRequiredArtifacts: string[];
  evidenceGateExtensionsRequired: string[];
  relatedWorkRequirements: {
    productComparators: string[];
    paperBenchmarkFamilies: string[];
    requiredMethodologyLessons: string[];
  };
  claimTaxonomy: {
    allowedAfterEvidence: string[];
    blockedUnlessSeparatelyMeasured: string[];
    forbiddenPublicPhrases: string[];
  };
  readinessMethodology: {
    selectedMode: string;
    modeLabelRequired: boolean;
    fullMatrixRequiresSameMethodology: boolean;
    strictReadiness: {
      claimMeaning: string;
      requiredProofs: string[];
      currentBlocker: string;
    };
    assistedReadiness: {
      claimMeaning: string;
      requiredProofs: string[];
      allowedForNextReadinessRun: boolean;
    };
    mixingPolicy: string;
    qualityPolicy: string;
    strictBlockerPolicy: string;
  };
  infraPolicy: {
    competitorInfraAllowedWhenRequired: boolean;
    codebaseContextProductClaimRemainsZeroInfraDefault: boolean;
    infraMustBeReportedAsCost: boolean;
    requiredFields: string[];
  };
  preExecutionFreeze: {
    requiredBeforeFullMatrix: boolean;
    frozenItems: string[];
    forbiddenAfterOutputsObserved: string[];
  };
  laneReadinessGate: {
    requiredBeforeFullMatrix: boolean;
    acceptedModes: string[];
    modeLabelRequired: boolean;
    fullMatrixRequiresSameMethodology: boolean;
    requiredProofs: string[];
    fullMatrixBlockedStatuses: string[];
  };
  telemetrySchema: {
    resourceTelemetryRequired: boolean;
    recommendedEnvironment: Record<string, string>;
    rowRequiredFields: string[];
    unavailablePolicy: string;
  };
  metricGroups: {
    retrievalQuality: { source: string; metrics: string[] };
    reliability: { metrics: string[] };
    cost: { metrics: string[] };
    seniorAgentUsefulness: { metrics: string[] };
  };
  repeatConfidence: {
    claimBearingRepeatsPerLaneTask: number;
    varianceRequiredForMainClaims: boolean;
    confidenceIntervalRequiredForMainClaims: boolean;
    underRepeatedCellsBlockPaperGradeClaim: boolean;
  };
  warmTrackValidity: {
    amortizationClaimRequiresMultiTaskWorkspaces: boolean;
    minimumTasksPerReusableWorkspace: number;
    minimumReusableWorkspacesForWarmClaim: number;
    noAmortizationOpportunityStatus: string;
  };
  antiBiasControls: string[];
  reportArtifactsRequired: string[];
  stopRules: string[];
};

type LanesFixture = {
  broadClaimLaneSet: string[];
  vNextHeadlineLaneSet: string[];
  vNextFallbackLaneSet: string[];
  vNextAppendixLaneSet: string[];
  vNextMinimumCredibleRun: {
    retrievalTasks: number;
    headlineLanes: number;
    repeatsPerTaskLane: number;
    expectedRetrievalRows: number;
    patchQualityTasks: number;
    patchQualityRepeatsPerTaskLane: number;
  };
  vNextReadinessPolicy: Record<string, boolean>;
};
type VNextTargetCard = {
  laneId: string;
  headlineTarget: boolean;
  localOrCloudRequirement: string;
  privacyMode: string;
  setupCommand: string;
  indexCommand: string;
  queryCommand: string;
  versionCommand: string;
  cachePath: string;
  artifactPaths: Record<string, string>;
  requiresUserApprovalForPaidProviders: boolean;
  maxExtraSpendUsd: number;
  readinessArtifacts: string[];
  cleanupProcedure: string;
};
type RunnerLaneCard = {
  laneId: string;
  contextTools: string[];
  allowedTools: string[];
  disallowedTools: string[];
  setupCommand: string;
  indexCommand: string;
  queryCommand: string;
  versionCommand: string;
  cachePath: string;
  artifactPaths: Record<string, string>;
  setupCostReportedSeparately: boolean;
  indexCostReportedSeparately: boolean;
  claimBearing: boolean;
};
type LaneToolCardsFixture = { vNextTargetCards: VNextTargetCard[]; cards: RunnerLaneCard[] };
type ProtocolFixture = { runPolicy: { claimBearingRunsPerTaskLane: number } };

const methodology = methodologyFixture as PublishableMethodology;
const lanes = lanesFixture as LanesFixture;
const laneToolCards = laneToolCardsFixture as LaneToolCardsFixture;
const protocol = protocolFixture as ProtocolFixture;
const expectedVNextHeadlineLanes = [
  'raw-native',
  'codebase-context',
  'repowise-selfhosted-mcp',
  'jcodemunch-full-mcp',
  'context-mode'
];

describe('ContextBench publishable methodology', () => {
  it('keeps p41-r29 sealed as evidence and freezes separate cold/warm operating models', () => {
    expect(methodology.schemaVersion).toBe(1);
    expect(methodology.status).toBe('methodology_frozen_before_next_publishable_run');
    expect(methodology.claimAllowed).toBe(false);
    expect(methodology.baselineEvidence).toMatchObject({
      status: 'sealed_baseline',
      preservationPolicy: 'do_not_mutate_fixtures_prompts_traces_predictions_scores_or_claims'
    });
    expect(methodology.baselineEvidence.coldBaselineReportHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(methodology.baselineEvidence.knownClaimLimits).toEqual(
      expect.arrayContaining(['resource_telemetry_gap', 'repeat_confidence_gap'])
    );

    const tracksById = new Map(
      methodology.operatingModelTracks.map((track) => [track.trackId, track])
    );
    expect(tracksById.get('cold-isolated-task')).toMatchObject({
      indexReuseScope: 'none',
      workspaceReuseScope: 'none',
      crossSnapshotReuseAllowed: false
    });
    expect(tracksById.get('warm-persistent-workspace')).toMatchObject({
      indexReuseScope: 'same_repo_workspace_only',
      workspaceReuseScope: 'same_repo_base_commit_only',
      crossSnapshotReuseAllowed: false
    });
  });

  it('requires the current vNext headline lanes and treats competitor infra as reportable cost', () => {
    expect(methodology.requiredLanes).toEqual(expectedVNextHeadlineLanes);
    expect(methodology.claimBearingReadinessLanes).toEqual(expectedVNextHeadlineLanes);
    expect(methodology.claimBearingReadinessLanes).not.toEqual(
      expect.arrayContaining(['grepai', 'codebase-memory-mcp', 'codegraphcontext'])
    );
    expect(methodology.appendixLanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          laneId: 'grepai-semantic',
          reason:
            'official_release_installed_but_moved_to_appendix_after_two_bounded_readiness_failures'
        }),
        expect.objectContaining({
          laneId: 'grepai',
          reason: 'legacy_alias_for_grepai_semantic_not_headline_claim_bearing'
        }),
        expect.objectContaining({
          laneId: 'codebase-memory-mcp',
          reason: 'legacy_comparator_diagnostic_unless_user_reopens_scope'
        }),
        expect.objectContaining({
          laneId: 'codegraphcontext',
          reason: 'legacy_comparator_diagnostic_unless_user_reopens_scope'
        })
      ])
    );
    expect(methodology.infraPolicy).toMatchObject({
      competitorInfraAllowedWhenRequired: true,
      codebaseContextProductClaimRemainsZeroInfraDefault: true,
      infraMustBeReportedAsCost: true
    });
    expect(methodology.infraPolicy.requiredFields).toEqual(
      expect.arrayContaining([
        'installCommands',
        'services',
        'ports',
        'environmentVariables',
        'diskFootprintBytes',
        'cleanupProof'
      ])
    );
  });

  it('captures user-owned vNext decisions instead of silently inheriting the old lane set', () => {
    expect(methodology.vNextUserOwnedDecisions).toMatchObject({
      publicationPosture: 'engineering_benchmark',
      paperGradeClaimAllowed: false,
      proofCandidateLabelRequiresAllGates: true,
      grepaiFailurePolicy: 'appendix_after_owner_approved_retry',
      paidApiBudgetUsd: 5,
      paidApiRequiresProviderPrivacyAndSpendRecord: true,
      repowiseHeadlineMode: 'self_hosted_mcp_only',
      repowiseHostedMode: 'appendix_only',
      jcodemunchPrimaryMode: 'full_mcp',
      jcodemunchFallbackMode: 'jcodemunch_repomapper_labeled_fallback',
      taskSourceStrategy: 'public_benchmark_mix_plus_stratified_public_repos_when_defensible',
      patchQualityScope: '12_tasks_3_repeats_after_budget_and_evaluator_gates',
      stopBehavior: 'obey_stop_rules_and_record_blockers_as_results'
    });
    expect(methodology.vNextUserOwnedDecisions.publicationOrder).toEqual([
      'benchmark_report',
      'portfolio_after_human_copy_review',
      'readme_npm_after_claim_audit'
    ]);
  });

  it('freezes the vNext headline lane target separately from legacy diagnostic lanes', () => {
    expect(lanes.vNextHeadlineLaneSet).toEqual(expectedVNextHeadlineLanes);
    expect(methodology.vNextLanePolicy.headlineLanes).toEqual(expectedVNextHeadlineLanes);
    expect(methodology.vNextMinimumCredibleRun.retrieval).toMatchObject({
      tasks: lanes.vNextMinimumCredibleRun.retrievalTasks,
      headlineLanes: expectedVNextHeadlineLanes,
      repeatsPerTaskLane: lanes.vNextMinimumCredibleRun.repeatsPerTaskLane,
      expectedRows: lanes.vNextMinimumCredibleRun.expectedRetrievalRows,
      coldAndWarmMustStaySeparated: true
    });
    expect(methodology.vNextMinimumCredibleRun.patchQuality).toMatchObject({
      tasks: lanes.vNextMinimumCredibleRun.patchQualityTasks,
      source: 'frozen_retrieval_task_set',
      repeatsPerTaskLane: lanes.vNextMinimumCredibleRun.patchQualityRepeatsPerTaskLane,
      requiresBudgetGate: true,
      requiresEvaluatorReadiness: true
    });
    expect(
      methodology.vNextLanePolicy.fallbackLanes.map((lane) => [lane.laneId, lane.fallbackFor])
    ).toContainEqual(['jcodemunch-repomapper', 'jcodemunch-full-mcp']);
    expect(methodology.vNextLanePolicy.appendixLanes.map((lane) => lane.laneId)).toEqual(
      expect.arrayContaining(lanes.vNextAppendixLaneSet)
    );
    expect(methodology.vNextLanePolicy.fullMatrixRequiresAllHeadlineLanesReadyBeforeOutputs).toBe(
      true
    );
    expect(methodology.vNextLanePolicy.notReadyLaneCannotBeScheduledForHeadlineMatrix).toBe(true);
    expect(lanes.vNextReadinessPolicy).toMatchObject({
      headlineClaimsRequireAllHeadlineLanesReadyBeforeFreeze: true,
      grepaiSemanticDebuggingRequiredBeforeFallbackDecision: false,
      grepaiSemanticFailureRequiresUserDecision: true,
      grepaiSemanticMovedToAppendixAfterOwnerApprovedRetry: true,
      repowiseHostedHttpMustNotMergeIntoLocalHeadlineClaims: true,
      jcodemunchRepoMapperFallbackMustBeExplicitlyLabeled: true
    });
  });

  it('requires vNext lane cards for the five headline lanes with cost, privacy, and cleanup policy', () => {
    const cardsByLane = new Map(laneToolCards.vNextTargetCards.map((card) => [card.laneId, card]));
    expect([...cardsByLane.keys()].sort()).toEqual([...expectedVNextHeadlineLanes].sort());

    for (const laneId of expectedVNextHeadlineLanes) {
      const card = cardsByLane.get(laneId);
      expect(card, `missing vNext target card for ${laneId}`).toBeTruthy();
      if (!card) continue;
      expect(card.headlineTarget).toBe(true);
      expect(card.setupCommand.length).toBeGreaterThan(3);
      expect(card.indexCommand.length).toBeGreaterThan(3);
      expect(card.queryCommand.length).toBeGreaterThan(3);
      expect(card.versionCommand.length).toBeGreaterThan(3);
      expect(card.cachePath).toContain(laneId);
      expect(card.localOrCloudRequirement.length).toBeGreaterThan(10);
      expect(card.privacyMode.length).toBeGreaterThan(10);
      expect(card.cleanupProcedure.length).toBeGreaterThan(20);
      expect(card.artifactPaths).toMatchObject({
        setup: 'setup-index.json',
        rawTrace: 'raw-trace.json',
        structuredAnswer: 'structured-answer.json',
        trajectory: 'trajectory.json',
        score: 'score.json'
      });
      expect(card.readinessArtifacts).toEqual(
        expect.arrayContaining([
          'LANE-READINESS-PAPER-GRADE.json',
          'LANE-PROXY-CAPTURE-AUDIT.json',
          'LANE-SET-DECISION.json'
        ])
      );
    }

    expect(cardsByLane.get('repowise-selfhosted-mcp')).toMatchObject({
      requiresUserApprovalForPaidProviders: true,
      maxExtraSpendUsd: 5
    });
    expect(cardsByLane.has('grepai-semantic')).toBe(false);
    expect(cardsByLane.get('raw-native')).toMatchObject({
      requiresUserApprovalForPaidProviders: false,
      maxExtraSpendUsd: 0
    });

    const runnerCardsByLane = new Map(laneToolCards.cards.map((card) => [card.laneId, card]));
    expect(runnerCardsByLane.get('grepai-semantic')).toMatchObject({
      claimBearing: false,
      setupCostReportedSeparately: true,
      indexCostReportedSeparately: true
    });
    for (const laneId of expectedVNextHeadlineLanes) {
      const card = runnerCardsByLane.get(laneId);
      expect(card, `missing executable runner card for ${laneId}`).toBeTruthy();
      if (!card) continue;
      expect(card.claimBearing).toBe(false);
      expect(card.setupCostReportedSeparately).toBe(true);
      expect(card.indexCostReportedSeparately).toBe(true);
      expect(card.setupCommand.length).toBeGreaterThan(3);
      expect(card.indexCommand.length).toBeGreaterThan(3);
      expect(card.queryCommand.length).toBeGreaterThan(3);
      expect(card.versionCommand.length).toBeGreaterThan(3);
      expect(card.cachePath).toContain(laneId);
      if (laneId !== 'raw-native') {
        expect(card.contextTools).toEqual([laneId]);
        expect(card.allowedTools).toEqual([laneId]);
        expect(card.disallowedTools).not.toContain(laneId);
      }
    }
  });

  it('blocks full-matrix execution until scope, readiness, telemetry, and anti-bias gates exist', () => {
    expect(methodology.preExecutionFreeze.requiredBeforeFullMatrix).toBe(true);
    expect(methodology.preExecutionFreeze.frozenItems).toEqual(
      expect.arrayContaining([
        'tasks',
        'repoSnapshots',
        'competitors',
        'metrics',
        'telemetrySchema',
        'antiBiasControls'
      ])
    );
    expect(methodology.preExecutionFreeze.forbiddenAfterOutputsObserved).toEqual(
      expect.arrayContaining([
        'taskSelection',
        'qrels',
        'expectedResults',
        'thresholds',
        'dropRules'
      ])
    );
    expect(methodology.laneReadinessGate.requiredBeforeFullMatrix).toBe(true);
    expect(methodology.laneReadinessGate).toMatchObject({
      acceptedModes: ['strict', 'assisted-readiness'],
      modeLabelRequired: true,
      fullMatrixRequiresSameMethodology: true
    });
    expect(methodology.laneReadinessGate.requiredProofs).toEqual(
      expect.arrayContaining([
        'setupCompletedOrExactBlocker',
        'indexCompletedOrExactBlocker',
        'laneToolCallable',
        'capturedCompletedToolCall',
        'laneProxyCaptureClassified',
        'predictionHasNonEmptyFiles',
        'predictionHasNonEmptySpans',
        'officialEvaluatorScoresPilotRow',
        'resourceTelemetryCaptured',
        'cleanupOwnedProcessesProven',
        'failureClassificationProven'
      ])
    );
    expect(methodology.laneReadinessGate.fullMatrixBlockedStatuses).toEqual(
      expect.arrayContaining([
        'setup_failed',
        'index_failed',
        'tool_error',
        'judge_failed',
        'invalid_schema',
        'not_ready',
        'excluded',
        'diagnostic_only'
      ])
    );
    expect(methodology.antiBiasControls).toEqual(
      expect.arrayContaining([
        'no_fixture_mutation_to_improve_results',
        'no_cherry_picked_easy_tasks',
        'no_self_rated_quality_as_evidence',
        'no_hidden_failed_lanes',
        'no_blending_reliability_failures_into_quality',
        'no_warm_vs_cold_comparison_without_labeling',
        'external_probe_env_flags_must_be_explicit_per_run'
      ])
    );
  });

  it('keeps strict and assisted readiness as separate labeled methodologies', () => {
    expect(methodology.readinessMethodology).toMatchObject({
      selectedMode: 'assisted-readiness',
      modeLabelRequired: true,
      fullMatrixRequiresSameMethodology: true,
      mixingPolicy: 'strict_and_assisted_rows_must_not_be_mixed_without_labels',
      qualityPolicy: 'assisted_rows_are_scoreable_only_inside_assisted_methodology_reports',
      strictBlockerPolicy: 'strict_tool_selection_failures_are_reliability_findings_not_quality'
    });
    expect(methodology.readinessMethodology.strictReadiness).toMatchObject({
      claimMeaning: 'solver_self_selected_lane_tool',
      currentBlocker: 'codex_mcp_tool_selection_reliability'
    });
    expect(methodology.readinessMethodology.strictReadiness.requiredProofs).toEqual(
      expect.arrayContaining([
        'solverCallsLaneToolItself',
        'capturedCompletedToolCall',
        'shellNativeBypassRejected',
        'structuredAnswerAfterToolCall',
        'officialEvaluatorScoresPilotRow'
      ])
    );
    expect(methodology.readinessMethodology.assistedReadiness).toMatchObject({
      claimMeaning: 'harness_captures_lane_tool_evidence_solver_uses_evidence',
      allowedForNextReadinessRun: true
    });
    expect(methodology.readinessMethodology.assistedReadiness.requiredProofs).toEqual(
      expect.arrayContaining([
        'harnessCallsLaneProxyTool',
        'capturedCompletedToolCall',
        'assistedLaneProxyFlagRecorded',
        'predictionHasNonEmptyFiles',
        'predictionHasNonEmptySpans',
        'officialEvaluatorScoresPilotRow'
      ])
    );
  });

  it('requires resource telemetry, repeat confidence, and senior-agent usefulness before research-paper benchmark claims', () => {
    expect(methodology.telemetrySchema.resourceTelemetryRequired).toBe(true);
    expect(methodology.telemetrySchema.recommendedEnvironment.CONTEXTBENCH_RESOURCE_TELEMETRY).toBe(
      '1'
    );
    expect(methodology.telemetrySchema.rowRequiredFields).toEqual(
      expect.arrayContaining([
        'setupDurationMs',
        'indexDurationMs',
        'taskWallTimeMs',
        'inputTokens',
        'outputTokens',
        'peakRssBytes',
        'cpuTotalMs',
        'indexDiskBytes',
        'infraServices',
        'cleanupProof'
      ])
    );
    expect(methodology.telemetrySchema.unavailablePolicy).toBe(
      'null_requires_reason_and_blocks_resource_efficiency_claims'
    );
    expect(methodology.metricGroups.retrievalQuality.source).toBe(
      'official_evaluator_completed_rows_only'
    );
    expect(methodology.metricGroups.seniorAgentUsefulness.metrics).toEqual(
      expect.arrayContaining([
        'wrongAnchorRate',
        'unsupportedClaimRate',
        'editLocationUsefulness',
        'reviewBurden',
        'patchRelevantContextRate'
      ])
    );
    expect(methodology.repeatConfidence).toMatchObject({
      claimBearingRepeatsPerLaneTask: protocol.runPolicy.claimBearingRunsPerTaskLane,
      varianceRequiredForMainClaims: true,
      confidenceIntervalRequiredForMainClaims: true,
      underRepeatedCellsBlockPaperGradeClaim: true
    });
    expect(methodology.warmTrackValidity).toMatchObject({
      amortizationClaimRequiresMultiTaskWorkspaces: true,
      minimumTasksPerReusableWorkspace: 2,
      minimumReusableWorkspacesForWarmClaim: 2,
      noAmortizationOpportunityStatus: 'diagnostic_only_no_amortization_opportunity'
    });
  });

  it('makes the vNext proof bundle and evidence-gate gaps executable requirements', () => {
    expect(methodology.proofBundleRequiredArtifacts).toEqual(
      expect.arrayContaining([
        'LANE-READINESS-PAPER-GRADE.json',
        'LANE-PROXY-CAPTURE-AUDIT.json',
        'LANE-SET-DECISION.json',
        'BENCHMARK-ADMISSION-GATES.json',
        'RUNNER-PROVENANCE.json',
        'HASHED-INPUTS.json',
        'ENVIRONMENT-MANIFEST.json',
        'SOURCE-SNAPSHOT.json',
        'RUN-MANIFEST.jsonl',
        'PROCESS-LIFECYCLE-AUDIT.json',
        'PROCESS-CENSUS-BEFORE.json',
        'PROCESS-CENSUS-AFTER-READINESS.json',
        'PROCESS-CENSUS-AFTER-MATRIX.json',
        'CLEANUP-LEDGER.jsonl',
        'BUDGET-AND-EXECUTION-PLAN.json',
        'BUDGET-CONSUMPTION.jsonl',
        'SETUP-INDEX-COST-LEDGER.json',
        'ORCHESTRATION-COST-LEDGER.json',
        'USER-APPROVAL-RECORD.json',
        'APPROVAL-REQUEST.json',
        'ABORT-DECISION.json',
        'CLAIM-LEDGER.json',
        'METHODOLOGY-CARD.json',
        'RELATED-WORK-LEDGER.json',
        'RESULTS-PACKAGE.json',
        'DENOMINATOR-LEDGER.json',
        'PAIRED-DELTAS.json',
        'CONFIDENCE-VARIANCE-TABLE.json',
        'TRACE-INDEX.json',
        'FAILURE-ANALYSIS.json',
        'QUALITATIVE-CASES.json',
        'NON-CLAIMS.json'
      ])
    );
    expect(methodology.evidenceGateExtensionsRequired).toEqual(
      expect.arrayContaining([
        'readiness_artifacts',
        'admission_gate_ledger',
        'runner_provenance_artifacts',
        'process_lifecycle_artifacts',
        'budget_artifacts',
        'owner_approval_request',
        'claim_ledger',
        'methodology_card',
        'related_work_ledger',
        'trace_index',
        'non_claims',
        'subgroup_denominators',
        'paired_deltas',
        'confidence_intervals'
      ])
    );
    expect(methodology.stopRules).toEqual(
      expect.arrayContaining([
        'do_not_run_full_matrix_before_readiness',
        'stop_on_unclassified_required_lane_blocker',
        'stop_on_unapproved_external_probe_env_flag',
        'stop_on_fixture_or_qrel_mutation_after_outputs',
        'stop_on_missing_resource_telemetry_for_resource_efficiency_claim',
        'stop_on_insufficient_repeat_confidence_for_paper_grade_claim'
      ])
    );
  });

  it('requires related-work grounding and blocks overbroad public claims', () => {
    expect(methodology.relatedWorkRequirements.productComparators).toEqual(
      expect.arrayContaining(['jcodemunch', 'repowise', 'grepai', 'context-mode'])
    );
    expect(methodology.relatedWorkRequirements.paperBenchmarkFamilies).toEqual(
      expect.arrayContaining([
        'ContextBench',
        'SWE-bench',
        'SWE-bench Verified',
        'RepoBench',
        'CrossCodeEval',
        'CodeSearchNet',
        'SWE-PRBench',
        'HELM',
        'BEIR',
        'TREC'
      ])
    );
    expect(methodology.relatedWorkRequirements.requiredMethodologyLessons).toEqual(
      expect.arrayContaining([
        'separate_retrieval_from_patch_correctness',
        'objective_evaluators_before_judges',
        'repeated_runs_and_confidence_intervals',
        'raw_artifacts_and_prompts',
        'visible_failures',
        'no_broad_claim_from_single_aggregate_score'
      ])
    );
    expect(methodology.claimTaxonomy.allowedAfterEvidence).toEqual(
      expect.arrayContaining([
        'retrieval_localization_delta_under_frozen_protocol',
        'setup_index_runtime_token_resource_cost_profile',
        'false_ready_delta',
        'patch_solve_delta_on_patch_quality_track'
      ])
    );
    expect(methodology.claimTaxonomy.blockedUnlessSeparatelyMeasured).toEqual(
      expect.arrayContaining([
        'developer_productivity',
        'universal_best_tool',
        'market_wide_leaderboard',
        'patch_correctness_from_retrieval_only',
        'paper_grade'
      ])
    );
    expect(methodology.claimTaxonomy.forbiddenPublicPhrases).toEqual(
      expect.arrayContaining([
        'codebase-context beats competitors',
        'state of the art',
        'proves better implementation quality',
        'proves faster development',
        'setup_failed means competitor lost',
        'token savings superiority'
      ])
    );
  });

  it('wires publishable methodology into runner fixture validation', () => {
    const stdout = execFileSync(
      'node',
      ['scripts/contextbench-runner.mjs', '--validate-fixtures'],
      {
        cwd: process.cwd(),
        encoding: 'utf8'
      }
    );
    expect(stdout).toContain('fixture validation passed');
  });
});
