import type { CodebaseIndexer } from '../core/indexer.js';
import type { IndexingStats } from '../types/index.js';

export interface DecisionCard {
  ready: boolean;
  /** True when the tool soft-abstains from edit guidance (e.g. stale index or low confidence + edit intent) */
  abstain?: boolean;
  nextAction?: string;
  warnings?: string[];
  patterns?: {
    do?: string[];
    avoid?: string[];
  };
  bestExample?: string;
  impact?: {
    coverage?: string;
    files?: string[];
    details?: Array<{ file: string; line?: number; hop: 1 | 2 }>;
  };
  health?: {
    level: 'low' | 'medium' | 'high';
    reasons?: string[];
  };
  whatWouldHelp?: string[];
}

export interface ToolPaths {
  baseDir: string;
  memory: string;
  intelligence: string;
  health: string;
  keywordIndex: string;
  vectorDb: string;
}

export interface ProjectDescriptor {
  project: string;
  label: string;
  rootPath: string;
  relativePath?: string;
  active: boolean;
  source: 'root' | 'subdirectory' | 'ad_hoc';
  indexStatus: 'idle' | 'indexing' | 'ready' | 'error';
}

export interface IndexState {
  status: 'idle' | 'indexing' | 'ready' | 'error';
  lastIndexed?: Date;
  stats?: IndexingStats;
  error?: string;
  indexer?: CodebaseIndexer;
}

export interface ToolContext {
  indexState: IndexState;
  paths: ToolPaths;
  rootPath: string;
  project?: ProjectDescriptor;
  performIndexing: (incrementalOnly?: boolean, reason?: string) => void;
  listProjects?: () => ProjectDescriptor[];
  getActiveProject?: () => ProjectDescriptor | undefined;
}

export interface ToolResponse {
  content?: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

// --- Search response types ---
export interface SearchQuality {
  status: 'ok' | 'low_confidence';
  confidence: number | string;
  hint?: string;
  tokenEstimate?: number;
  warning?: string;
  rerankerStatus?: 'unavailable';
}

export interface SearchResultRelationships {
  importedByCount?: number;
  hasTests?: boolean;
}

export interface SearchResultHints {
  callers?: string[];
  tests?: string[];
}

export interface SearchNextHop {
  tool: string;
  why: string;
  args?: Record<string, string>;
}

export interface SearchBudget {
  mode: 'compact' | 'full';
  resultCount: number;
}

export interface SearchLitePreflight extends Partial<Omit<DecisionCard, 'ready'>> {
  ready: boolean;
  reason?: string;
}

export interface SearchResultItem {
  file: string; // "path:startLine-endLine"
  summary: string;
  score: number;
  relevanceReason?: string;
  type?: string; // "componentType:layer"
  trend?: 'Rising' | 'Declining';
  patternWarning?: string;
  relationships?: SearchResultRelationships;
  hints?: SearchResultHints;
  importedByCount?: number;
  topExports?: string[];
  layer?: string;
  symbol?: string;
  symbolKind?: string;
  scope?: string;
  signaturePreview?: string;
  imports?: string[];
  exports?: string[];
  complexity?: number;
  health?: {
    level: 'low' | 'medium' | 'high';
    reasons?: string[];
  };
  snippet?: string;
}

export interface SearchResponse {
  status: string;
  searchQuality: SearchQuality;
  budget?: SearchBudget;
  preflight?: DecisionCard | SearchLitePreflight;
  patternSummary?: string;
  bestExample?: string;
  nextHops?: SearchNextHop[];
  results: SearchResultItem[];
  totalResults?: number;
  relatedMemories?: string[];
}

// --- Pattern response types ---
export interface PatternEntry {
  name: string;
  frequency: string;
  trend?: string;
  adoption?: string;
}

export interface PatternCategory {
  primary: PatternEntry;
  alsoDetected?: PatternEntry[];
}

export interface PatternConflict {
  category: string;
  primary: { name: string; adoption: string; trend?: string };
  alternative: { name: string; adoption: string; trend?: string };
}

export interface GoldenFile {
  file: string;
  score: number;
}

export interface LibraryEntry {
  source: string;
  count: number;
}

export interface PatternResponse {
  patterns?: Record<string, PatternCategory>;
  goldenFiles?: GoldenFile[];
  memories?: Array<{ type: string; memory: string }>;
  conflicts?: PatternConflict[];
  topUsed?: LibraryEntry[];
}

// --- Metadata response types ---
export interface MetadataDependency {
  name: string;
  version?: string;
  category?: string;
}

export interface MetadataFramework {
  name?: string;
  version?: string;
  stateManagement?: string[];
  testingFrameworks?: string[];
  uiLibraries?: string[];
}

export interface MetadataLanguage {
  name?: string;
  percentage?: number;
  fileCount?: number;
  lineCount?: number;
}

export interface MetadataStatistics {
  totalFiles?: number;
  totalLines?: number;
  totalComponents?: number;
  componentsByType?: Record<string, number>;
  componentsByLayer?: Record<string, number>;
}

export interface MetadataInner {
  name?: string;
  framework?: MetadataFramework;
  languages?: MetadataLanguage[];
  dependencies?: MetadataDependency[];
  architecture?: {
    type?: string;
    layers?: Record<string, number>;
    patterns?: unknown[];
    modules?: Array<{ name: string }>;
  };
  projectStructure?: { type?: string; workspaces?: string[] };
  statistics?: MetadataStatistics;
  // teamPatterns mirrors the shape from get_team_patterns — not rendered here
  // since the `patterns` command covers it; modelled so the field isn't invisible
  teamPatterns?: Record<string, unknown>;
}

export interface MetadataResponse {
  status?: string;
  metadata?: MetadataInner;
}

// --- Style guide response types ---
export interface StyleGuideResult {
  file?: string;
  relevantSections?: string[];
}

export interface StyleGuideResponse {
  status?: string; // 'success' | 'no_results'
  query?: string;
  category?: string;
  results?: StyleGuideResult[];
  totalFiles?: number;
  totalMatches?: number;
  limited?: boolean;
  notice?: string;
  // no_results shape:
  message?: string;
  hint?: string;
  searchedPatterns?: string[];
}

// --- Cycles response types ---
export interface CycleItem {
  files?: string[];
  cycle?: string[];
  severity?: string;
  length?: number;
}

export interface GraphStats {
  files?: number;
  edges?: number;
  avgDependencies?: number;
}

export interface CyclesResponse {
  status?: string;
  message?: string;
  scope?: string;
  cycles?: CycleItem[];
  count?: number;
  graphStats?: GraphStats;
  advice?: string;
}

// --- Refs response types ---
export interface RefsUsage {
  file: string;
  line: number;
  preview: string;
}

export interface RefsResponse {
  status?: string;
  symbol: string;
  usageCount: number;
  confidence: string;
  usages: RefsUsage[];
  /** false when results were capped at limit — more references exist */
  isComplete?: boolean;
}
