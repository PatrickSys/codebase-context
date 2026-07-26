/**
 * Library entry point for codebase-context
 *
 * This exports the core logic for use as a library.
 * For the MCP server, import from 'codebase-context/server' or run the CLI.
 *
 * @example
 * ```typescript
 * import {
 *   ProjectAnalyzer,
 *   VectorStorage,
 *   analyzerRegistry,
 *   AngularAnalyzer,
 *   NextJsAnalyzer,
 *   NestJsAnalyzer,
 *   ReactAnalyzer,
 *   GenericAnalyzer
 * } from 'codebase-context';
 *
 * // Register analyzers
 * analyzerRegistry.register(new AngularAnalyzer());
 * analyzerRegistry.register(new NextJsAnalyzer());
 * analyzerRegistry.register(new NestJsAnalyzer());
 * analyzerRegistry.register(new ReactAnalyzer());
 * analyzerRegistry.register(new GenericAnalyzer());
 *
 * // Create and run indexer
 * const indexer = new CodebaseIndexer({
 *   rootPath: '/path/to/project',
 *   onProgress: (progress) => console.error(progress)
 * });
 * const stats = await indexer.index();
 *
 * // Search the indexed codebase
 * const searcher = new CodebaseSearcher('/path/to/project');
 * const results = await searcher.search('how do we handle errors?');
 * ```
 */

// Core classes
export { CodebaseIndexer, type IndexerOptions } from './core/indexer.js';
import { CodebaseIndexer } from './core/indexer.js';
export { CodebaseSearcher, type SearchOptions } from './core/search.js';
import { CodebaseSearcher } from './core/search.js';
export { AnalyzerRegistry, analyzerRegistry } from './core/analyzer-registry.js';
import { analyzerRegistry } from './core/analyzer-registry.js';

// Embedding providers
export {
  getEmbeddingProvider,
  TransformersEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingConfig,
  DEFAULT_EMBEDDING_CONFIG
} from './embeddings/index.js';

// Storage providers
export {
  getStorageProvider,
  LanceDBStorageProvider,
  type VectorStorageProvider,
  type StorageConfig,
  type CodeChunkWithEmbedding,
  DEFAULT_STORAGE_CONFIG
} from './storage/index.js';

// Framework analyzers
export { AngularAnalyzer } from './analyzers/angular/index.js';
import { AngularAnalyzer } from './analyzers/angular/index.js';
export { NextJsAnalyzer } from './analyzers/nextjs/index.js';
import { NextJsAnalyzer } from './analyzers/nextjs/index.js';
export { NestJsAnalyzer } from './analyzers/nestjs/index.js';
import { NestJsAnalyzer } from './analyzers/nestjs/index.js';
export { ReactAnalyzer } from './analyzers/react/index.js';
import { ReactAnalyzer } from './analyzers/react/index.js';
export { GenericAnalyzer } from './analyzers/generic/index.js';
import { GenericAnalyzer } from './analyzers/generic/index.js';

// Utilities
export {
  isCodeFile,
  isBinaryFile,
  detectLanguage,
  isTestFile,
  isDocumentationFile,
  getSupportedExtensions
} from './utils/language-detection.js';
export {
  createChunksFromCode,
  calculateComplexity,
  mergeSmallChunks,
  type ChunkingOptions
} from './utils/chunking.js';

// All types
export type {
  // Analyzer interface
  FrameworkAnalyzer,

  // Analysis results
  AnalysisResult,
  CodeComponent,
  ImportStatement,
  ExportStatement,
  Dependency,
  DependencyCategory,
  ArchitecturalLayer,

  // Code chunks
  CodeChunk,
  ChunkMetadata,

  // Codebase metadata
  CodebaseMetadata,
  FrameworkInfo,
  LanguageInfo,
  ArchitectureInfo,
  ModuleInfo,
  ProjectStructure,
  PackageInfo,
  CodebaseStatistics,

  // Style guides and documentation
  StyleGuide,
  StyleRule,
  CodeExample,
  DocumentationFile,
  DocumentationSection,

  // Search
  SearchQuery,
  SearchFilters,
  SearchResult,
  TextHighlight,

  // Indexing
  IndexingProgress,
  IndexingPhase,
  IndexingError,
  IndexingStats,

  // Configuration
  AnalyzerConfig,
  CodebaseConfig,

  // Utilities
  Decorator,
  Property,
  Method,
  Parameter
} from './types/index.js';

/**
 * Convenience function to create a fully configured indexer with default analyzers
 *
 * @param rootPath - Path to the project root
 * @param options - Optional indexer configuration
 * @returns A configured CodebaseIndexer instance
 */
export function createIndexer(
  rootPath: string,
  options?: Partial<Omit<import('./core/indexer.js').IndexerOptions, 'rootPath'>>
): import('./core/indexer.js').CodebaseIndexer {
  // Register default analyzers if not already registered
  if (!analyzerRegistry.get('angular')) {
    analyzerRegistry.register(new AngularAnalyzer());
  }
  if (!analyzerRegistry.get('nextjs')) {
    analyzerRegistry.register(new NextJsAnalyzer());
  }
  if (!analyzerRegistry.get('nestjs')) {
    analyzerRegistry.register(new NestJsAnalyzer());
  }
  if (!analyzerRegistry.get('react')) {
    analyzerRegistry.register(new ReactAnalyzer());
  }
  if (!analyzerRegistry.get('generic')) {
    analyzerRegistry.register(new GenericAnalyzer());
  }

  return new CodebaseIndexer({
    rootPath,
    ...options
  });
}

/**
 * Convenience function to create a searcher for an indexed codebase
 *
 * @param rootPath - Path to the indexed project root
 * @returns A configured CodebaseSearcher instance
 */
export function createSearcher(rootPath: string): import('./core/search.js').CodebaseSearcher {
  return new CodebaseSearcher(rootPath);
}
