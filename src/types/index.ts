/* eslint-disable @typescript-eslint/no-explicit-any */
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
  metadata: Record<string, any>;
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
  metadata: Record<string, any>;
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
  [key: string]: any;
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
  customMetadata: Record<string, any>;
}

export interface FrameworkInfo {
  name: string;
  version: string;
  type: 'angular' | 'react' | 'vue' | 'svelte' | 'solid' | 'other';
  variant?: string; // 'standalone', 'module-based', 'class-components', etc.
  stateManagement?: string[]; // 'ngrx', 'redux', 'zustand', 'pinia', etc.
  uiLibraries?: string[];
  testingFrameworks?: string[];
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
  metadata: Record<string, any>;
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
  metadata: Record<string, any>;
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

  // v1.2: Pattern Momentum awareness
  /** Pattern trend for this chunk: Rising (modern), Stable, or Declining (legacy) */
  trend?: 'Rising' | 'Stable' | 'Declining';
  /** Warning if this result uses declining/legacy patterns */
  patternWarning?: string;

  // Optional detailed context (for agent to request if needed)
  fullContent?: string; // Only included if explicitly requested
  relatedChunks?: CodeChunk[];
  highlights?: TextHighlight[];
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
  options?: Record<string, any>;
}

export interface CodebaseConfig {
  // Analyzers configuration
  analyzers: {
    angular?: AnalyzerConfig;
    react?: AnalyzerConfig;
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
    connection?: Record<string, any>;
  };

  // Custom metadata
  customMetadata?: Record<string, any>;
}

// ============================================================================
// UTILITIES
// ============================================================================

export interface Decorator {
  name: string;
  arguments?: any[];
  properties?: Record<string, any>;
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
