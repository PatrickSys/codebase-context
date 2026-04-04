import type { SearchOptions, CodebaseSearcher } from '../core/search.js';

export interface EvalQuery {
  id: number;
  query: string;
  category: string;
  expectedPatterns?: string[];
  expectedNotPatterns?: string[];
  expectedTopFiles?: string[];
  expectedNotTopFiles?: string[];
  notes?: string;
}

export interface EvalFixture {
  description?: string;
  codebase?: string;
  repository?: string;
  frozenDate?: string;
  notes?: string;
  queries: EvalQuery[];
}

export interface EvalResult {
  queryId: number;
  query: string;
  category: string;
  expectedPatterns: string[];
  expectedNotPatterns: string[];
  topFile: string | null;
  top3Files: string[];
  top1Correct: boolean;
  top3Recall: boolean;
  specContaminated: boolean;
  score: number;
}

export interface EvalSummary {
  total: number;
  top1Correct: number;
  top1Accuracy: number;
  top3RecallCount: number;
  top3Recall: number;
  specContaminatedCount: number;
  specContaminationRate: number;
  avgTopScore: number;
  gateThreshold: number;
  passesGate: boolean;
  results: EvalResult[];
}

export interface EvaluateFixtureParams {
  fixture: EvalFixture;
  searcher: CodebaseSearcher;
  limit?: number;
  searchOptions?: SearchOptions;
}

export type EvalGate = number;

export interface FormatEvalReportParams {
  codebaseLabel: string;
  fixturePath: string;
  summary: EvalSummary;
  redactPaths?: boolean;
}

export type DiscoveryJob = 'map' | 'find' | 'search';

export type DiscoverySurface =
  | 'search_codebase'
  | 'get_codebase_metadata'
  | 'get_team_patterns'
  | 'codebase://context';

export interface DiscoveryTask {
  id: string;
  title: string;
  job: DiscoveryJob;
  surface: DiscoverySurface;
  prompt: string;
  args?: Record<string, unknown>;
  expectedSignals: string[];
  expectedFilePatterns?: string[];
  expectedBestExamplePatterns?: string[];
  forbiddenSignals?: string[];
  notes?: string;
}

export interface DiscoveryFixture {
  description?: string;
  codebase?: string;
  repository?: string;
  repositoryUrl?: string;
  repositoryRef?: string;
  frozenDate?: string;
  notes?: string;
  tasks: DiscoveryTask[];
}

export interface DiscoveryTaskResult {
  taskId: string;
  title: string;
  job: DiscoveryJob;
  surface: DiscoverySurface;
  usefulnessScore: number;
  matchedSignals: string[];
  missingSignals: string[];
  forbiddenHits: string[];
  payloadBytes: number;
  estimatedTokens: number;
  firstRelevantHit?: number | null;
  bestExampleUseful?: boolean;
}

export interface DiscoverySummary {
  totalTasks: number;
  averageUsefulness: number;
  averagePayloadBytes: number;
  averageEstimatedTokens: number;
  searchTasks: number;
  findTasks: number;
  mapTasks: number;
  averageFirstRelevantHit: number | null;
  bestExampleUsefulnessRate: number | null;
  gate?: DiscoveryGateEvaluation;
  results: DiscoveryTaskResult[];
}

export interface EvaluateDiscoveryFixtureParams {
  fixture: DiscoveryFixture;
  rootPath: string;
  surfaceRunners?: Partial<Record<DiscoverySurface, DiscoverySurfaceRunner>>;
}

export interface FormatDiscoveryReportParams {
  codebaseLabel: string;
  fixturePath: string;
  summary: DiscoverySummary;
}

export type DiscoverySurfaceRunner = (
  task: DiscoveryTask,
  rootPath: string
) => Promise<DiscoverySurfaceResult>;

export interface DiscoverySurfaceResult {
  payload: string;
  topFiles?: string[];
  bestExample?: string | null;
}

export type DiscoveryMetricName =
  | 'averageUsefulness'
  | 'averagePayloadBytes'
  | 'averageEstimatedTokens'
  | 'averageFirstRelevantHit'
  | 'bestExampleUsefulnessRate';

export interface DiscoveryComparatorProtocol {
  name: string;
  kind: 'baseline' | 'mcp-comparator';
  execution: 'direct-tool' | 'manual-log-capture';
  notes?: string;
}

export interface DiscoveryGateProtocol {
  baselineRule: string;
  comparatorRule: string;
  claimRule: string;
  baseline: {
    comparatorName: string;
    payloadMetric: DiscoveryMetricName;
    usefulnessMetrics: DiscoveryMetricName[];
  };
  comparators: {
    requiredNames: string[];
    tolerancePercent: number;
    usefulnessMetrics: DiscoveryMetricName[];
  };
}

export interface DiscoveryBenchmarkProtocol {
  name: string;
  frozenDate: string;
  scope: 'discovery-only';
  jobs: DiscoveryJob[];
  allowedSurfaces: DiscoverySurface[];
  forbiddenSurfaces: string[];
  primaryLane: 'direct-tool';
  secondaryLane: 'manual-log-capture';
  comparators: DiscoveryComparatorProtocol[];
  metrics: {
    payloadCost: DiscoveryMetricName[];
    usefulness: DiscoveryMetricName[];
  };
  fairnessRules: string[];
  shipGate: DiscoveryGateProtocol;
}

export interface DiscoveryComparatorMetrics {
  averageUsefulness?: number | null;
  averagePayloadBytes?: number | null;
  averageEstimatedTokens?: number | null;
  averageFirstRelevantHit?: number | null;
  bestExampleUsefulnessRate?: number | null;
}

export interface DiscoveryComparatorEvidence {
  [comparatorName: string]: DiscoveryComparatorMetrics;
}

export interface DiscoveryMetricComparison {
  metric: DiscoveryMetricName;
  comparatorValue: number | null;
  actualValue: number | null;
  passes: boolean;
}

export interface DiscoveryBaselineGateResult {
  comparatorName: string;
  status: 'passed' | 'failed' | 'pending_evidence';
  payloadMetric: DiscoveryMetricName;
  payloadMetricPassed: boolean;
  beatenUsefulnessMetrics: DiscoveryMetricName[];
  missingMetrics: DiscoveryMetricName[];
  comparisons: DiscoveryMetricComparison[];
}

export interface DiscoveryComparatorGateResult {
  comparatorName: string;
  status: 'passed' | 'failed' | 'pending_evidence';
  tolerancePercent: number;
  missingMetrics: DiscoveryMetricName[];
  comparisons: DiscoveryMetricComparison[];
}

export interface DiscoveryGateEvaluation {
  status: 'passed' | 'failed' | 'pending_evidence';
  suiteStatus: 'complete' | 'incomplete';
  baseline: DiscoveryBaselineGateResult;
  comparators: DiscoveryComparatorGateResult[];
  missingEvidence: string[];
  claimAllowed: boolean;
}
