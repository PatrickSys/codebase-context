/**
 * Core types for the modular codebase context system
 * These types define the contract that all framework analyzers must implement
 */

// ============================================================================
// CORE ANALYZER INTERFACE - All framework analyzers must implement this
// ============================================================================

export interface FrameworkAnalyzer {
  /** Unique identifier for the analyzer (e.g., 'angular', 'react', 'vue') */
  readonly name: string;

  /** Framework version this analyzer supports */
  readonly version: string;

  /** File extensions this analyzer handles */
  readonly supportedExtensions: string[];

  /** Check if this analyzer can handle a given file */
  canAnalyze(filePath: string, content?: string): boolean;

  /** Parse a file and extract structured information */
  analyze(filePath: string, content: string): Promise<AnalysisResult>;

  /** Detect framework-specific patterns and metadata from the entire codebase */
  detectCodebaseMetadata(rootPath: string): Promise<CodebaseMetadata>;

  /**
   * Generate a concise summary of a code chunk (1-2 sentences)
   * Optional - defaults to generic summary if not implemented
   */
  summarize?(chunk: CodeChunk): string;

  /** Priority - higher number = higher priority (default: 50) */
  readonly priority: number;

  /** Get a regex to extract a code snippet for a detected pattern (optional) */
  getSnippetPattern?(category: string, name: string): RegExp | null;
}

// ============================================================================
// ANALYSIS RESULTS
// ============================================================================

export interface AnalysisResult {
  filePath: string;
  language: string;
  framework?: string;
  components: CodeComponent[];
  imports: ImportStatement[];
  exports: ExportStatement[];
  dependencies: Dependency[];
  metadata: Record<string, unknown>;
  chunks: CodeChunk[];
}

export interface CodeComponent {
  name: string;
  type: string; // Generic: 'class', 'function', 'interface', etc.
  componentType?: string; // Framework-specific: 'component', 'service', 'directive', etc.
  startLine: number;
  endLine: number;
  layer?: ArchitecturalLayer;
  decorators?: Decorator[];
  properties?: Property[];
  methods?: Method[];
  lifecycle?: string[];
  dependencies?: string[];
  metadata: Record<string, unknown>;
}

export interface ImportStatement {
  source: string;
  imports: string[];
  isDefault: boolean;
  isDynamic: boolean;
  line?: number; // Line number for usage tracking
}

export interface ExportStatement {
  name: string;
  isDefault: boolean;
  type: string;
}

export interface Dependency {
  name: string;
  version?: string;
  category: DependencyCategory;
  layer?: ArchitecturalLayer;
}

export type DependencyCategory =
  | 'framework' // Angular, React, Vue core
  | 'state' // State management (NgRx, Redux, Pinia)
  | 'ui' // UI libraries (Material, Ant Design)
  | 'routing' // Routing libraries
  | 'http' // HTTP clients
  | 'testing' // Testing frameworks
  | 'utility' // Utility libraries
  | 'build' // Build tools
  | 'other';

export type ArchitecturalLayer =
  | 'presentation' // UI components, views
  | 'business' // Business logic, services
  | 'data' // Data access, API calls
  | 'state' // State management
  | 'core' // Core services, guards
  | 'shared' // Shared utilities
  | 'feature' // Feature modules
  | 'infrastructure' // Infrastructure code
  | 'unknown';

// ============================================================================
// CODE CHUNKS - The atomic unit for indexing and search
// ============================================================================

export interface CodeChunk {
  id: string;
  content: string;
  filePath: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  language: string;
  framework?: string;
  componentType?: string;
  layer?: ArchitecturalLayer;
  dependencies: string[];
  imports: string[];
  exports: string[];
  tags: string[];
  metadata: ChunkMetadata;
  embedding?: number[];
}

export interface ChunkMetadata {
  // Component identification
  componentName?: string;
  decoratorType?: string;
  className?: string;
  functionName?: string;

  // Symbol-aware chunking (AST-aligned)
  symbolAware?: boolean;
  symbolName?: string;
  symbolKind?: string;
  symbolPath?: string[];
  parentSymbol?: string;
  chunkStrategy?: string;

  // Framework-specific
  isStandalone?: boolean;
  selector?: string;
  template?: string;
  styles?: string[];

  // Code quality metrics
  linesOfCode?: number;
  complexity?: number;
  cyclomaticComplexity?: number;
  maintainabilityIndex?: number;

  // Testing
  hasTests?: boolean;
  testCoverage?: number;

  // Relationships
  dependencies?: string[];
  dependents?: string[];
  relatedFiles?: string[];

  // Patterns and practices
  patterns?: string[];
  antiPatterns?: string[];
  styleViolations?: string[];

  // Custom tags for filtering
  tags?: string[];
  category?: string;

  // Any framework-specific metadata
  [key: string]: unknown;
}

// ============================================================================
// CODEBASE METADATA
// ============================================================================

export interface CodebaseMetadata {
  name: string;
  rootPath: string;
  framework?: FrameworkInfo;
  languages: LanguageInfo[];
  dependencies: Dependency[];
  architecture: ArchitectureInfo;
  styleGuides: StyleGuide[];
  documentation: DocumentationFile[];
  projectStructure: ProjectStructure;
  statistics: CodebaseStatistics;
  customMetadata: Record<string, unknown>;
}

export interface FrameworkInfo {
  name: string;
  version: string;
  type: 'angular' | 'react' | 'nextjs' | 'vue' | 'svelte' | 'solid' | 'other';
  variant?: string; // 'standalone', 'module-based', 'class-components', etc.
  stateManagement?: string[]; // 'ngrx', 'redux', 'zustand', 'pinia', etc.
  uiLibraries?: string[];
  testingFrameworks?: string[];
  /** Enumerated evidence signals that triggered this framework claim (e.g. 'dep:next', 'disk:app-router'). */
  indicators?: readonly string[];
}

export interface LanguageInfo {
  name: string;
  version?: string;
  fileCount: number;
  lineCount: number;
  percentage: number;
}

export interface ArchitectureInfo {
  type: 'layered' | 'feature-based' | 'modular' | 'monolithic' | 'micro-frontend' | 'mixed';
  layers: Record<ArchitecturalLayer, number>; // Count of files per layer
  modules?: ModuleInfo[];
  patterns: string[]; // Detected patterns: 'MVVM', 'MVC', 'Repository', 'Facade', etc.
}

export interface ModuleInfo {
  name: string;
  path: string;
  type: string;
  dependencies: string[];
  exports: string[];
}

export interface ProjectStructure {
  type: 'monorepo' | 'single-app' | 'library' | 'multi-package';
  workspaces?: string[];
  packages?: PackageInfo[];
}

export interface PackageInfo {
  name: string;
  path: string;
  type: 'app' | 'library' | 'tool';
  framework?: string;
}

export interface CodebaseStatistics {
  totalFiles: number;
  totalLines: number;
  totalComponents: number;
  componentsByType: Record<string, number>;
  componentsByLayer: Record<ArchitecturalLayer, number>;
  avgComplexity?: number;
  testCoverage?: number;
}

// ============================================================================
// STYLE GUIDES AND DOCUMENTATION
// ============================================================================

export interface StyleGuide {
  name: string;
  filePath: string;
  content: string;
  metadata: Record<string, unknown>;
  category: string;
  tags: string[];
  rules: StyleRule[];
  parsedAt: Date;
}

export interface StyleRule {
  id: string;
  title: string;
  description: string;
  examples: CodeExample[];
  antiPatterns?: CodeExample[];
  category: string;
  severity?: 'error' | 'warning' | 'info';
  autoFixable?: boolean;
}

export interface CodeExample {
  language: string;
  code: string;
  explanation?: string;
  tags?: string[];
}

export interface DocumentationFile {
  filePath: string;
  title: string;
  content: string;
  type: 'readme' | 'guide' | 'api' | 'changelog' | 'contributing' | 'other';
  metadata: Record<string, unknown>;
  sections?: DocumentationSection[];
}

export interface DocumentationSection {
  title: string;
  content: string;
  level: number;
  tags?: string[];
}

// ============================================================================
// SEARCH AND INDEXING
// ============================================================================

export interface SearchQuery {
  query: string;
  filters?: SearchFilters;
  limit?: number;
  includeContext?: boolean;
  includeRelated?: boolean;
}

export interface SearchFilters {
  framework?: string;
  language?: string;
  componentType?: string;
  layer?: ArchitecturalLayer;
  tags?: string[];
  filePaths?: string[];
  excludePaths?: string[];
  hasTests?: boolean;
  minComplexity?: number;
  maxComplexity?: number;
}

export interface SearchResult {
  // High-level summary (1-2 sentences)
  summary: string;

  // Code snippet (word-limited, showing key parts)
  snippet: string;

  // File location
  filePath: string;
  startLine: number;
  endLine: number;

  // Search relevance
  score: number;
  relevanceReason?: string;

  // Metadata from original chunk
  language: string;
  framework?: string;
  componentType?: string;
  layer?: ArchitecturalLayer;
  metadata: ChunkMetadata;

  trend?: 'Rising' | 'Stable' | 'Declining';
  patternWarning?: string;
  imports?: string[];
  exports?: string[];

  relationships?: RelationshipData;

  // Optional detailed context (for agent to request if needed)
  fullContent?: string; // Only included if explicitly requested
  relatedChunks?: CodeChunk[];
  highlights?: TextHighlight[];
}

export interface RelationshipData {
  /** Files that import this result */
  importedBy?: string[];
  /** Files this result depends on */
  imports?: string[];
  /** Test files covering this (heuristic: same basename + .spec/.test) */
  testedIn?: string[];
  /** ISO date from git log */
  lastModified?: string;
}

export interface TextHighlight {
  start: number;
  end: number;
  text: string;
  type: 'match' | 'keyword' | 'entity';
}

// ============================================================================
// INDEXING
// ============================================================================

export interface IndexingProgress {
  phase: IndexingPhase;
  percentage: number;
  currentFile?: string;
  filesProcessed: number;
  totalFiles: number;
  chunksCreated: number;
  errors: IndexingError[];
  startedAt: Date;
  estimatedCompletion?: Date;
}

export type IndexingPhase =
  | 'initializing'
  | 'scanning'
  | 'analyzing'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'storing'
  | 'indexing'
  | 'complete'
  | 'error';

export interface IndexingError {
  filePath: string;
  error: string;
  phase: IndexingPhase;
  timestamp: Date;
}

export interface IndexingStats {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  totalChunks: number;
  totalLines: number;
  duration: number; // milliseconds
  avgChunkSize: number;
  componentsByType: Record<string, number>;
  componentsByLayer: Record<ArchitecturalLayer, number>;
  errors: IndexingError[];
  startedAt: Date;
  completedAt?: Date;
  incremental?: {
    added: number;
    changed: number;
    deleted: number;
    unchanged: number;
  };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface AnalyzerConfig {
  enabled: boolean;
  priority?: number;
  options?: Record<string, unknown>;
}

export interface CodebaseConfig {
  // Analyzers configuration
  analyzers: {
    angular?: AnalyzerConfig;
    react?: AnalyzerConfig;
    nextjs?: AnalyzerConfig;
    vue?: AnalyzerConfig;
    generic?: AnalyzerConfig;
    [key: string]: AnalyzerConfig | undefined;
  };

  // File filtering
  include?: string[];
  exclude?: string[];
  respectGitignore?: boolean;

  // Parsing options
  parsing: {
    maxFileSize?: number; // bytes
    chunkSize?: number; // lines
    chunkOverlap?: number; // lines
    parseTests?: boolean;
    parseNodeModules?: boolean;
  };

  // Style guides
  styleGuides?: {
    autoDetect?: boolean;
    paths?: string[];
    parseMarkdown?: boolean;
  };

  // Documentation
  documentation?: {
    autoDetect?: boolean;
    includeReadmes?: boolean;
    includeChangelogs?: boolean;
    customPaths?: string[];
  };

  // Embedding
  embedding?: {
    provider?: 'transformers' | 'openai' | 'ollama' | 'custom';
    model?: string;
    batchSize?: number;
  };

  // Optimization flags
  skipEmbedding?: boolean;

  // Storage
  storage?: {
    provider?: 'lancedb' | 'milvus' | 'chromadb' | 'custom';
    path?: string;
    connection?: Record<string, unknown>;
  };

  // Custom metadata
  customMetadata?: Record<string, unknown>;
}

// ============================================================================
// UTILITIES
// ============================================================================

export interface Decorator {
  name: string;
  arguments?: unknown[];
  properties?: Record<string, unknown>;
}

export interface Property {
  name: string;
  type?: string;
  visibility?: 'public' | 'private' | 'protected';
  isStatic?: boolean;
  isReadonly?: boolean;
  decorators?: Decorator[];
  initializer?: string;
}

export interface Method {
  name: string;
  returnType?: string;
  parameters?: Parameter[];
  visibility?: 'public' | 'private' | 'protected';
  isStatic?: boolean;
  isAsync?: boolean;
  decorators?: Decorator[];
}

export interface Parameter {
  name: string;
  type?: string;
  isOptional?: boolean;
  defaultValue?: string;
  decorators?: Decorator[];
}

// Memory System

/**
 * Category of architectural/design decision
 * Used for organizing and querying decisions
 */
export type MemoryCategory =
  | 'tooling' // Build tools, package managers, linting, IDE config
  | 'architecture' // Layers, folder structure, module boundaries
  | 'testing' // Test frameworks, mocking strategies, coverage
  | 'dependencies' // Library choices, wrappers, versioning, package management
  | 'conventions'; // Naming, style, organization not captured in patterns

/**
 * Type of knowledge being recorded
 */
export type MemoryType =
  | 'convention' // Style, naming, component preferences
  | 'decision' // Architecture/tooling choices with rationale
  | 'gotcha' // Things that break and why
  | 'failure'; // Tried X, failed because Y — prevents repeating mistakes

/**
 * A recorded architectural or design decision
 * Captures the "why" behind choices to prevent AI agents from repeating mistakes
 */
export interface Memory {
  /** Content-based hash ID (first 12 chars of SHA-256) */
  id: string;
  /** Type of knowledge: convention, decision, or gotcha */
  type: MemoryType;
  /** Category for organization and filtering */
  category: MemoryCategory;
  /** Brief description of what to remember */
  memory: string;
  /** Why this decision was made - the rationale/context */
  reason: string;
  /** ISO 8601 date when decision was recorded */
  date: string;
  /** Source of the memory: 'user' (default) or 'git' (auto-extracted from commits) */
  source?: 'user' | 'git';
}

// ============================================================================
// SHARED PRIMITIVES
// ============================================================================

/** File + line reference — canonical base for all usage location types */
export interface UsageLocation {
  file: string;
  line: number;
}

// ============================================================================
// INTELLIGENCE / PATTERN DATA
// ============================================================================

/** Pattern trend direction — shared between runtime tracker and serialized form */
export type PatternTrend = 'Rising' | 'Declining' | 'Stable';

/** Common fields for any pattern candidate, at runtime or in intelligence.json */
export interface PatternCandidateBase {
  name: string;
  /** e.g. "72%" */
  frequency: string;
  trend?: PatternTrend;
  guidance?: string;
  newestFileDate?: string;
}

/** A single detected pattern variant within a category (serialized form) */
export interface PatternCandidate extends PatternCandidateBase {
  canonicalExample?: { file: string; snippet?: string };
  count?: number;
}

/** Primary + alternatives for one pattern category */
export interface PatternEntry {
  primary?: PatternCandidate;
  alsoDetected?: PatternCandidate[];
}

/** intelligence.json patterns map */
export type PatternsData = Record<string, PatternEntry>;

/** Minimal golden file shape as stored in intelligence.json */
export interface IntelligenceGoldenFile {
  file: string;
  score: number;
  /** Pattern flags persisted from runtime GoldenFile — e.g. "dependencyInjection:inject() function": true */
  patterns?: Record<string, boolean>;
}

// ============================================================================
// CODEBASE MAP
// ============================================================================

/** Architecture layer derived from first path segment of graph keys */
export interface CodebaseMapLayer {
  name: string;
  fileCount: number;
  /** Most-imported file whose first path segment matches this layer */
  hubFile?: string;
  /** Top 3 named exports from hubFile */
  hubExports?: string[];
}

/** Key interface/class/type from the index, ranked by import centrality */
export interface CodebaseMapKeyInterface {
  name: string;
  kind: string;
  file: string;
  importerCount: number;
  /** First 1–3 non-empty content lines, trimmed, max 200 chars, trailing { stripped */
  signatureHint: string;
}

/** Exported symbols per entrypoint file */
export interface CodebaseMapApiSurface {
  file: string;
  /** Up to 5 named exports (no 'default') */
  exports: string[];
}

/** File ranked by combined import + importer count */
export interface CodebaseMapHotspot {
  file: string;
  importerCount: number;
  importCount: number;
  combined: number;
}

/** Active pattern from intelligence.json with adoption and trend */
export interface CodebaseMapPattern {
  name: string;
  /** e.g. "97%" */
  adoption: string;
  trend: 'Rising' | 'Stable' | 'Declining';
}

/** Best example derived from intelligence.json goldenFiles */
export interface CodebaseMapExample {
  file: string;
  score: number;
  /** Dominant pattern this file exemplifies */
  reason: string;
}

/** Graph statistics from relationships.json stats */
export interface CodebaseMapGraphStats {
  files: number;
  edges: number;
  avgDependencies: number;
}

/** Concrete tool invocation suggestion */
export interface CodebaseMapNextCall {
  tool: string;
  args?: Record<string, string>;
  why: string;
}

/** Compact first-call conventions map — the primary product surface */
export interface CodebaseMapSummary {
  project: string;
  architecture: {
    /** Layers derived from first path segment of graph.imports keys */
    layers: CodebaseMapLayer[];
    /** Files that import others but are imported by nobody, excluding tests/scripts */
    entrypoints: string[];
    /** Top most-imported internal files by importedBy count */
    hubFiles: string[];
    /** Top 10 interfaces/classes/types by import centrality */
    keyInterfaces: CodebaseMapKeyInterface[];
    /** Exported API surface per entrypoint */
    apiSurface: CodebaseMapApiSurface[];
    /** Top 5 files by combined import + importer count */
    hotspots: CodebaseMapHotspot[];
  };
  activePatterns: CodebaseMapPattern[];
  bestExamples: CodebaseMapExample[];
  graphStats: CodebaseMapGraphStats;
  suggestedNextCalls: CodebaseMapNextCall[];
}

/** Typed shape for intelligence.json content */
export interface IntelligenceData {
  patterns?: PatternsData;
  goldenFiles?: IntelligenceGoldenFile[];
  /** Opaque — consumed via InternalFileGraph.fromJSON */
  internalFileGraph?: {
    imports?: Record<string, string[]>;
    importDetails?: Record<string, Record<string, { line?: number; importedSymbols?: string[] }>>;
    exports?: Record<string, unknown[]>;
    stats?: unknown;
  };
  generatedAt?: string;
  libraryUsage?: Record<string, { count: number; examples: string[] }>;
  tsconfigPaths?: Record<string, string[]>;
  importGraph?: { topUsed?: unknown[] };
  header?: unknown;
  [key: string]: unknown;
}
