/**
 * Core Indexer - Orchestrates codebase indexing
 * Scans files, delegates to analyzers, creates embeddings, stores in vector DB
 */

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { glob } from 'glob';
import ignore from 'ignore';
import {
  CodebaseMetadata,
  CodeChunk,
  FrameworkInfo,
  IndexingProgress,
  IndexingStats,
  IndexingPhase,
  CodebaseConfig,
  Dependency,
  ArchitecturalLayer,
  IntelligenceData
} from '../types/index.js';
import { analyzerRegistry } from './analyzer-registry.js';
import type { AnalyzerSelectionOptions } from './analyzer-registry.js';
import { getSupportedExtensions, isBinaryFile, isCodeFile } from '../utils/language-detection.js';
import {
  getEmbeddingProvider,
  getConfiguredDimensions,
  DEFAULT_MODEL,
  parseEmbeddingProviderName
} from '../embeddings/index.js';
import { getStorageProvider, CodeChunkWithEmbedding } from '../storage/index.js';
import {
  LibraryUsageTracker,
  PatternDetector,
  ImportGraph,
  InternalFileGraph,
  FileExport
} from '../utils/usage-tracker.js';
import { mergeSmallChunks } from '../utils/chunking.js';
import { getFileCommitDates } from '../utils/git-dates.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  EXCLUDED_GLOB_PATTERNS,
  HEALTH_FILENAME,
  INDEX_FORMAT_VERSION,
  INDEXING_STATS_FILENAME,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  MANIFEST_FILENAME,
  RELATIONSHIPS_FILENAME,
  VECTOR_DB_DIRNAME
} from '../constants/codebase-context.js';
import { deriveCodebaseHealth } from '../health/derive.js';

const STAGING_DIRNAME = '.staging';
const PREVIOUS_DIRNAME = '.previous';
const DEFAULT_MAX_CHUNKS = 5000;

import {
  computeFileHashes,
  readManifest,
  writeManifest,
  diffManifest,
  type FileManifest,
  type ManifestDiff
} from './manifest.js';
import { readIndexMeta, checkEmbeddingMismatch } from './index-meta.js';

let cachedToolVersion: string | null = null;

async function getToolVersion(): Promise<string> {
  if (cachedToolVersion) return cachedToolVersion;

  try {
    const pkgRaw = await fs.readFile(new URL('../../package.json', import.meta.url), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      cachedToolVersion = pkg.version;
      return cachedToolVersion;
    }
  } catch {
    // Best-effort — fall back below
  }

  cachedToolVersion = 'unknown';
  return cachedToolVersion;
}

/**
 * Perform a Windows-safe atomic swap of staging artifacts into active location.
 * Strategy: move current active to .previous, then rename staging to active.
 * If staging rename fails, restore from .previous.
 */
async function atomicSwapStagingToActive(
  contextDir: string,
  stagingDir: string,
  buildId: string
): Promise<void> {
  const previousDir = path.join(contextDir, PREVIOUS_DIRNAME);
  const activeMetaPath = path.join(contextDir, INDEX_META_FILENAME);
  const activeIndexPath = path.join(contextDir, KEYWORD_INDEX_FILENAME);
  const activeIntelligencePath = path.join(contextDir, INTELLIGENCE_FILENAME);
  const activeVectorDir = path.join(contextDir, VECTOR_DB_DIRNAME);
  const activeManifestPath = path.join(contextDir, MANIFEST_FILENAME);
  const activeStatsPath = path.join(contextDir, INDEXING_STATS_FILENAME);
  const activeRelationshipsPath = path.join(contextDir, RELATIONSHIPS_FILENAME);
  const activeHealthPath = path.join(contextDir, HEALTH_FILENAME);

  const stagingMetaPath = path.join(stagingDir, INDEX_META_FILENAME);
  const stagingIndexPath = path.join(stagingDir, KEYWORD_INDEX_FILENAME);
  const stagingIntelligencePath = path.join(stagingDir, INTELLIGENCE_FILENAME);
  const stagingVectorDir = path.join(stagingDir, VECTOR_DB_DIRNAME);
  const stagingManifestPath = path.join(stagingDir, MANIFEST_FILENAME);
  const stagingStatsPath = path.join(stagingDir, INDEXING_STATS_FILENAME);
  const stagingRelationshipsPath = path.join(stagingDir, RELATIONSHIPS_FILENAME);
  const stagingHealthPath = path.join(stagingDir, HEALTH_FILENAME);

  // Step 1: Create .previous directory and move current active there
  await fs.mkdir(previousDir, { recursive: true });

  const moveIfExists = async (src: string, dest: string): Promise<void> => {
    try {
      await fs.rename(src, dest);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        // File doesn't exist is OK, other errors are problems
        throw error;
      }
    }
  };

  const moveDirIfExists = async (src: string, dest: string): Promise<void> => {
    try {
      const stat = await fs.stat(src);
      if (stat.isDirectory()) {
        await fs.rename(src, dest);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  };

  // Move active artifacts to .previous
  await moveIfExists(activeMetaPath, path.join(previousDir, INDEX_META_FILENAME));
  await moveIfExists(activeIndexPath, path.join(previousDir, KEYWORD_INDEX_FILENAME));
  await moveIfExists(activeIntelligencePath, path.join(previousDir, INTELLIGENCE_FILENAME));
  await moveIfExists(activeManifestPath, path.join(previousDir, MANIFEST_FILENAME));
  await moveIfExists(activeStatsPath, path.join(previousDir, INDEXING_STATS_FILENAME));
  await moveIfExists(activeRelationshipsPath, path.join(previousDir, RELATIONSHIPS_FILENAME));
  await moveIfExists(activeHealthPath, path.join(previousDir, HEALTH_FILENAME));
  await moveDirIfExists(activeVectorDir, path.join(previousDir, VECTOR_DB_DIRNAME));

  // Step 2: Move staging artifacts to active location
  try {
    await moveIfExists(stagingMetaPath, activeMetaPath);
    await moveIfExists(stagingIndexPath, activeIndexPath);
    await moveIfExists(stagingIntelligencePath, activeIntelligencePath);
    await moveIfExists(stagingManifestPath, activeManifestPath);
    await moveIfExists(stagingStatsPath, activeStatsPath);
    await moveIfExists(stagingRelationshipsPath, activeRelationshipsPath);
    await moveIfExists(stagingHealthPath, activeHealthPath);
    await moveDirIfExists(stagingVectorDir, activeVectorDir);

    // Step 3: Clean up .previous and staging directories
    await cleanupDirectory(previousDir);
    await cleanupDirectory(stagingDir);

    // Also clean up the parent .staging/ directory if empty
    const stagingBase = path.join(contextDir, STAGING_DIRNAME);
    try {
      const remaining = await fs.readdir(stagingBase);
      if (remaining.length === 0) {
        await fs.rmdir(stagingBase);
      }
    } catch {
      // Directory doesn't exist or not empty - ignore
    }

    console.error(`Atomic swap complete: build ${buildId} now active`);
  } catch (swapError) {
    console.error('Atomic swap failed, attempting rollback:', swapError);

    // Attempt rollback: restore from .previous
    try {
      await moveIfExists(path.join(previousDir, INDEX_META_FILENAME), activeMetaPath);
      await moveIfExists(path.join(previousDir, KEYWORD_INDEX_FILENAME), activeIndexPath);
      await moveIfExists(path.join(previousDir, INTELLIGENCE_FILENAME), activeIntelligencePath);
      await moveIfExists(path.join(previousDir, MANIFEST_FILENAME), activeManifestPath);
      await moveIfExists(path.join(previousDir, INDEXING_STATS_FILENAME), activeStatsPath);
      await moveIfExists(path.join(previousDir, RELATIONSHIPS_FILENAME), activeRelationshipsPath);
      await moveIfExists(path.join(previousDir, HEALTH_FILENAME), activeHealthPath);
      await moveDirIfExists(path.join(previousDir, VECTOR_DB_DIRNAME), activeVectorDir);
      console.error('Rollback successful');
    } catch (rollbackError) {
      console.error('Rollback also failed:', rollbackError);
    }

    throw swapError;
  }
}

/**
 * Best-effort cleanup of a directory and its contents.
 */
async function cleanupDirectory(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Best-effort: ignore cleanup failures
  }
}

export interface IndexerOptions {
  rootPath: string;
  config?: Partial<CodebaseConfig>;
  projectOptions?: AnalyzerSelectionOptions;
  onProgress?: (progress: IndexingProgress) => void;
  incrementalOnly?: boolean;
}

interface PersistedIndexingStats {
  indexedFiles: number;
  totalChunks: number;
  totalFiles: number;
  generatedAt: string;
}

export class CodebaseIndexer {
  private rootPath: string;
  private config: CodebaseConfig;
  private projectOptions: AnalyzerSelectionOptions;
  private supportedCodeExtensions: Set<string>;
  private progress: IndexingProgress;
  private onProgressCallback?: (progress: IndexingProgress) => void;
  private incrementalOnly: boolean;

  constructor(options: IndexerOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.config = this.mergeConfig(options.config);
    this.projectOptions = {
      preferredAnalyzer: options.projectOptions?.preferredAnalyzer,
      extraFileExtensions: options.projectOptions?.extraFileExtensions
    };
    this.supportedCodeExtensions = new Set(
      getSupportedExtensions(this.projectOptions.extraFileExtensions).map((extension) =>
        extension.toLowerCase()
      )
    );
    this.onProgressCallback = options.onProgress;
    this.incrementalOnly = options.incrementalOnly ?? false;

    this.progress = {
      phase: 'initializing',
      percentage: 0,
      filesProcessed: 0,
      totalFiles: 0,
      chunksCreated: 0,
      errors: [],
      startedAt: new Date()
    };
  }

  private mergeConfig(userConfig?: Partial<CodebaseConfig>): CodebaseConfig {
    const defaultEmbeddingProvider =
      parseEmbeddingProviderName(process.env.EMBEDDING_PROVIDER) ?? 'transformers';

    // When provider=openai and EMBEDDING_MODEL is not set, DEFAULT_MODEL resolves to the
    // transformers fallback (Xenova/bge-small-en-v1.5), which the OpenAI API rejects.
    // Use a sane OpenAI default instead.
    const defaultModel =
      defaultEmbeddingProvider === 'openai' && !process.env.EMBEDDING_MODEL
        ? 'text-embedding-3-small'
        : DEFAULT_MODEL;

    const defaultConfig: CodebaseConfig = {
      analyzers: {
        angular: { enabled: true, priority: 100 },
        nextjs: { enabled: false, priority: 90 },
        nestjs: { enabled: false, priority: 105 },
        react: { enabled: false, priority: 90 },
        vue: { enabled: false, priority: 90 },
        generic: { enabled: true, priority: 10 }
      },
      include: [
        '**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
        '**/*.{html,htm,css,scss,sass,less}',
        '**/*.{py,pyi,rb,php}',
        '**/*.{java,kt,kts,scala,swift,cs}',
        '**/*.{go,rs}',
        '**/*.{c,cpp,cc,cxx,h,hpp}',
        '**/*.{sh,bash,zsh,ps1}',
        '**/*.{sql,graphql,gql}',
        '**/*.{json,jsonc,yaml,yml,toml,xml}'
      ],
      exclude: [...EXCLUDED_GLOB_PATTERNS],
      respectGitignore: true,
      parsing: {
        maxFileSize: 1048576,
        maxChunks: DEFAULT_MAX_CHUNKS,
        chunkSize: 50,
        chunkOverlap: 0,
        parseTests: true,
        parseNodeModules: false
      },
      styleGuides: {
        autoDetect: true,
        paths: ['STYLE_GUIDE.md', 'docs/style-guide.md', 'ARCHITECTURE.md'],
        parseMarkdown: true
      },
      documentation: {
        autoDetect: true,
        includeReadmes: true,
        includeChangelogs: false
      },
      embedding: {
        provider: defaultEmbeddingProvider,
        model: defaultModel,
        batchSize: 32
      },
      skipEmbedding: false,
      storage: {
        provider: 'lancedb',
        path: './codebase-index'
      }
    };

    return {
      ...defaultConfig,
      ...userConfig,
      analyzers: { ...defaultConfig.analyzers, ...userConfig?.analyzers },
      parsing: { ...defaultConfig.parsing, ...userConfig?.parsing },
      styleGuides: { ...defaultConfig.styleGuides, ...userConfig?.styleGuides },
      documentation: {
        ...defaultConfig.documentation,
        ...userConfig?.documentation
      },
      embedding: { ...defaultConfig.embedding, ...userConfig?.embedding },
      storage: { ...defaultConfig.storage, ...userConfig?.storage }
    };
  }

  private getProjectOptions(): AnalyzerSelectionOptions {
    const preferredAnalyzer = this.projectOptions.preferredAnalyzer?.trim();
    if (!preferredAnalyzer) {
      return this.projectOptions;
    }

    if (!analyzerRegistry.get(preferredAnalyzer)) {
      console.warn(
        `[indexer] Preferred analyzer "${preferredAnalyzer}" is not registered. Falling back to default analyzer selection.`
      );
      return {
        ...this.projectOptions,
        preferredAnalyzer: undefined
      };
    }

    return {
      ...this.projectOptions,
      preferredAnalyzer
    };
  }

  private getIncludePatterns(): string[] {
    const includePatterns = this.config.include || ['**/*'];
    const extraFileExtensions = this.projectOptions.extraFileExtensions ?? [];

    if (extraFileExtensions.length === 0) {
      return includePatterns;
    }

    const extraPatterns = extraFileExtensions
      .map((extension) => extension.trim().toLowerCase())
      .filter((extension) => extension.length > 0)
      .map((extension) => (extension.startsWith('.') ? extension : `.${extension}`))
      .map((extension) => `**/*${extension}`);

    return Array.from(new Set([...includePatterns, ...extraPatterns]));
  }

  async index(): Promise<IndexingStats> {
    const startTime = Date.now();
    const stats: IndexingStats = {
      totalFiles: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      totalChunks: 0,
      totalLines: 0,
      duration: 0,
      avgChunkSize: 0,
      componentsByType: {},
      componentsByLayer: {
        presentation: 0,
        business: 0,
        data: 0,
        state: 0,
        core: 0,
        shared: 0,
        feature: 0,
        infrastructure: 0,
        unknown: 0
      },
      errors: [],
      startedAt: new Date()
    };

    let stagingDir: string | null = null;

    try {
      // Ensure there is at least a generic fallback analyzer registered when the indexer
      // is used directly (e.g. in tests or standalone scripts).
      if (analyzerRegistry.getAll().length === 0) {
        const { GenericAnalyzer } = await import('../analyzers/generic/index.js');
        analyzerRegistry.register(new GenericAnalyzer());
      }

      const resolvedProjectOptions = this.getProjectOptions();

      const buildId = randomUUID();
      const generatedAt = new Date().toISOString();
      const toolVersion = await getToolVersion();

      // Phase 1: Scanning
      this.updateProgress('scanning', 0);
      let files = await this.scanFiles();

      // Memory safety: limit total files to prevent heap exhaustion
      const MAX_FILES = 10000;
      if (files.length > MAX_FILES) {
        console.warn(
          `WARNING: Found ${files.length} files, limiting to ${MAX_FILES} to prevent memory issues.`
        );
        console.warn(
          `Consider using more specific include patterns or excluding large directories.`
        );
        files = files.slice(0, MAX_FILES);
      }

      stats.totalFiles = files.length;
      this.progress.totalFiles = files.length;

      console.error(`Found ${files.length} files to index`);

      // Phase 1b: Incremental diff (if incremental mode)
      const contextDir = path.join(this.rootPath, CODEBASE_CONTEXT_DIRNAME);
      const manifestPath = path.join(contextDir, MANIFEST_FILENAME);
      const indexingStatsPath = path.join(contextDir, INDEXING_STATS_FILENAME);
      let diff: ManifestDiff | null = null;
      let currentHashes: Record<string, string> | null = null;
      let previousManifest: FileManifest | null = null;

      if (this.incrementalOnly) {
        this.updateProgress('scanning', 10);
        console.error('Computing file hashes for incremental diff...');
        currentHashes = await computeFileHashes(files, this.rootPath);

        previousManifest = await readManifest(manifestPath);
        diff = diffManifest(previousManifest, currentHashes);

        console.error(
          `Incremental diff: ${diff.added.length} added, ${diff.changed.length} changed, ` +
            `${diff.deleted.length} deleted, ${diff.unchanged.length} unchanged`
        );

        stats.incremental = {
          added: diff.added.length,
          changed: diff.changed.length,
          deleted: diff.deleted.length,
          unchanged: diff.unchanged.length
        };

        // Check for embedding provider/model mismatch — forces full rebuild to avoid
        // silent vector dimension mismatch when switching providers or models.
        try {
          const existingMeta = await readIndexMeta(this.rootPath);
          const currentProvider = this.config.embedding?.provider ?? 'transformers';
          const currentModel = this.config.embedding?.model ?? DEFAULT_MODEL;
          if (checkEmbeddingMismatch(existingMeta, currentProvider, currentModel)) {
            const stored = existingMeta.artifacts.vectorDb;
            console.error(
              `Embedding provider/model changed (stored: ${stored.embeddingProvider}:${stored.embeddingModel}, current: ${currentProvider}:${currentModel}) — forcing full rebuild`
            );
            diff = null;
          }
        } catch {
          // No meta yet or legacy index without embedding fields — proceed with incremental
        }

        // Short-circuit: nothing changed
        if (
          diff &&
          diff.added.length === 0 &&
          diff.changed.length === 0 &&
          diff.deleted.length === 0
        ) {
          console.error('No files changed - skipping re-index.');
          this.updateProgress('complete', 100);
          stats.duration = Date.now() - startTime;
          stats.completedAt = new Date();

          let restoredFromPersistedStats = false;

          try {
            const persisted = JSON.parse(
              await fs.readFile(indexingStatsPath, 'utf-8')
            ) as Partial<PersistedIndexingStats>;

            if (
              typeof persisted.indexedFiles === 'number' &&
              typeof persisted.totalChunks === 'number' &&
              typeof persisted.totalFiles === 'number'
            ) {
              stats.indexedFiles = persisted.indexedFiles;
              stats.totalChunks = persisted.totalChunks;
              stats.totalFiles = persisted.totalFiles;
              restoredFromPersistedStats = true;
            }
          } catch {
            // No persisted stats yet — fall back below
          }

          if (!restoredFromPersistedStats) {
            if (previousManifest) {
              stats.indexedFiles = Object.keys(previousManifest.files).length;
            }

            try {
              const existingIndexPath = path.join(contextDir, KEYWORD_INDEX_FILENAME);
              const existing = JSON.parse(await fs.readFile(existingIndexPath, 'utf-8')) as unknown;
              const existingObj = existing as { chunks?: unknown };
              const existingChunks: unknown = Array.isArray(existing)
                ? existing
                : existingObj && Array.isArray(existingObj.chunks)
                  ? existingObj.chunks
                  : null;
              if (Array.isArray(existingChunks)) {
                stats.totalChunks = existingChunks.length;
                if (stats.indexedFiles === 0) {
                  const uniqueFiles = new Set(
                    existingChunks.map((c: { filePath?: string }) => c.filePath)
                  );
                  stats.indexedFiles = uniqueFiles.size;
                }
              }
            } catch {
              // Keyword index doesn't exist yet — keep best-known counts
            }
          }

          stats.totalFiles = files.length;

          return stats;
        }
      }

      // Build the set of files that need analysis + embedding (incremental: only added/changed)
      const filesToProcess = diff
        ? files.filter((f) => {
            const rel = path.relative(this.rootPath, f).replace(/\\/g, '/');
            return diff!.added.includes(rel) || diff!.changed.includes(rel);
          })
        : files;

      // Phase 2: Analyzing & Parsing
      // Intelligence tracking (patterns, libraries, import graph) runs on ALL files
      // but embedding only runs on filesToProcess
      this.updateProgress('analyzing', 0);
      const allChunks: CodeChunk[] = [];
      const changedChunks: CodeChunk[] = []; // Only chunks from added/changed files
      const libraryTracker = new LibraryUsageTracker();
      const patternDetector = new PatternDetector();
      const importGraph = new ImportGraph();
      const internalFileGraph = new InternalFileGraph(this.rootPath);

      // Fetch git commit dates for pattern momentum analysis
      const fileDates = await getFileCommitDates(this.rootPath);

      // When incremental, track which files need embedding
      const filesToProcessSet = diff ? new Set(filesToProcess.map((f) => f)) : null;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.progress.currentFile = file;
        this.progress.filesProcessed = i + 1;
        this.progress.percentage = Math.round(((i + 1) / files.length) * 100);

        try {
          // Normalize line endings to \n for consistent cross-platform output
          const rawContent = await fs.readFile(file, 'utf-8');
          const content = rawContent.replace(/\r\n/g, '\n');
          const result = await analyzerRegistry.analyzeFile(file, content, resolvedProjectOptions);

          if (result) {
            const isFileChanged = !filesToProcessSet || filesToProcessSet.has(file);

            const mergedChunks = mergeSmallChunks(result.chunks, 15);

            allChunks.push(...mergedChunks);
            if (isFileChanged) {
              changedChunks.push(...mergedChunks);
            }
            stats.indexedFiles++;
            stats.totalLines += content.split('\n').length;

            // Track library usage AND import graph from imports
            for (const imp of result.imports) {
              libraryTracker.track(imp.source, file);
              importGraph.trackImport(imp.source, file, imp.line || 1);

              // Track internal file-to-file imports (relative paths)
              if (imp.source.startsWith('.')) {
                // Resolve the relative import to an absolute path
                const fileDir = path.dirname(file);
                let resolvedPath = path.resolve(fileDir, imp.source);

                // Try common extensions if not already specified
                const ext = path.extname(resolvedPath);
                if (!ext) {
                  for (const tryExt of ['.ts', '.tsx', '.js', '.jsx']) {
                    const withExt = resolvedPath + tryExt;
                    // We don't check if file exists for performance - just track what's referenced
                    resolvedPath = withExt;
                    break;
                  }
                }

                internalFileGraph.trackImport(file, resolvedPath, imp.line || 1, imp.imports);
              }
            }

            // Track exports for unused export detection
            if (result.exports && result.exports.length > 0) {
              const fileExports: FileExport[] = result.exports.map((exp) => ({
                name: exp.name,
                type: exp.isDefault ? 'default' : (exp.type as FileExport['type']) || 'other'
              }));
              internalFileGraph.trackExports(file, fileExports);
            }

            // Detect generic patterns from code
            patternDetector.detectFromCode(content, file);

            // Helper to extract code snippet around a pattern
            const extractSnippet = (
              pattern: RegExp,
              linesBefore = 1,
              linesAfter = 3
            ): string | undefined => {
              const match = content.match(pattern);
              if (!match) return undefined;
              const lines = content.split('\n');
              const matchIndex = content.substring(0, match.index).split('\n').length - 1;
              const start = Math.max(0, matchIndex - linesBefore);
              const end = Math.min(lines.length, matchIndex + linesAfter + 1);
              return lines.slice(start, end).join('\n').trim();
            };

            const relPath = file.split(/[\\/]/).slice(-3).join('/');

            // Get file date for pattern momentum tracking
            // Try multiple path formats since git uses forward slashes
            const normalizedRelPath = path.relative(this.rootPath, file).replace(/\\/g, '/');
            const fileDate = fileDates.get(normalizedRelPath);

            // GENERIC PATTERN FORWARDING
            // Framework analyzers return detectedPatterns in metadata - we just forward them
            // This keeps the indexer framework-agnostic
            if (
              result.metadata?.detectedPatterns &&
              Array.isArray(result.metadata.detectedPatterns)
            ) {
              for (const pattern of result.metadata.detectedPatterns as Array<{
                category: string;
                name: string;
              }>) {
                // Try to extract a relevant snippet for the pattern
                // Ask analyzer registry for snippet pattern (framework-agnostic delegation)
                const analyzer = analyzerRegistry.findAnalyzer(file);
                const snippetPattern =
                  analyzer?.getSnippetPattern?.(pattern.category, pattern.name) ?? null;
                const snippet = snippetPattern ? extractSnippet(snippetPattern) : undefined;
                patternDetector.track(
                  pattern.category,
                  pattern.name,
                  snippet ? { file: relPath, snippet } : undefined,
                  fileDate
                );
              }
            }

            // Track file for Golden File scoring (framework-agnostic)
            // A golden file = file with patterns in ≥3 distinct categories
            const rawPatterns = result.metadata?.detectedPatterns;
            const detectedPatterns: Array<{ category: string; name: string }> = Array.isArray(
              rawPatterns
            )
              ? (rawPatterns as Array<{ category: string; name: string }>)
              : [];
            const uniqueCategories = new Set(detectedPatterns.map((p) => p.category));
            const patternScore = uniqueCategories.size;
            if (patternScore >= 2) {
              const patternFlags: Record<string, boolean> = {};
              for (const p of detectedPatterns) {
                patternFlags[`${p.category}:${p.name}`] = true;
              }
              patternDetector.trackGoldenFile(relPath, patternScore, patternFlags);
            }

            // Update component statistics
            for (const component of result.components) {
              if (component.componentType) {
                stats.componentsByType[component.componentType] =
                  (stats.componentsByType[component.componentType] || 0) + 1;
              }
              if (component.layer) {
                stats.componentsByLayer[component.layer]++;
              }
            }
          } else {
            stats.skippedFiles++;
          }
        } catch (error) {
          stats.skippedFiles++;
          stats.errors.push({
            filePath: file,
            error: error instanceof Error ? error.message : String(error),
            phase: 'analyzing',
            timestamp: new Date()
          });
        }

        if (this.onProgressCallback) {
          this.onProgressCallback(this.progress);
        }
      }

      stats.totalChunks = allChunks.length;
      stats.avgChunkSize =
        allChunks.length > 0
          ? Math.round(allChunks.reduce((sum, c) => sum + c.content.length, 0) / allChunks.length)
          : 0;

      // Determine which chunks to embed: in incremental mode, only changed/added file chunks
      const chunksForEmbedding = diff ? changedChunks : allChunks;

      // Memory safety: limit chunks to prevent embedding memory issues
      const maxChunks = this.config.parsing.maxChunks ?? DEFAULT_MAX_CHUNKS;
      let chunksToEmbed = chunksForEmbedding;
      if (chunksForEmbedding.length > maxChunks) {
        console.warn(
          `WARNING: ${chunksForEmbedding.length} chunks exceed limit. Indexing first ${maxChunks} chunks.`
        );
        chunksToEmbed = chunksForEmbedding.slice(0, maxChunks);
      }

      // Phase 3: Embedding (only changed/added chunks in incremental mode)
      const chunksWithEmbeddings: CodeChunkWithEmbedding[] = [];

      if (!this.config.skipEmbedding && chunksToEmbed.length > 0) {
        this.updateProgress('embedding', 50);
        console.error(
          `Creating embeddings for ${chunksToEmbed.length} chunks` +
            (diff ? ` (${allChunks.length} total, ${chunksToEmbed.length} changed)` : '') +
            '...'
        );

        // Initialize embedding provider
        const embeddingProvider = await getEmbeddingProvider(this.config.embedding);

        // Generate embeddings for all chunks
        // Outer batch size controls how many chunks we collect before calling embedBatch.
        // embedBatch internally sub-batches further based on model context size.
        const batchSize = Math.min(this.config.embedding?.batchSize || 32, 32);

        for (let i = 0; i < chunksToEmbed.length; i += batchSize) {
          const batch = chunksToEmbed.slice(i, i + batchSize);
          const texts = batch.map((chunk) => {
            const meta: string[] = [];
            if (chunk.relativePath) {
              meta.push(`path:${chunk.relativePath}`);
            }
            if (chunk.componentType && chunk.componentType !== 'unknown') {
              meta.push(`type:${chunk.componentType}`);
            }
            if (chunk.metadata?.componentName) {
              meta.push(`component:${chunk.metadata.componentName}`);
            }
            if (chunk.layer && chunk.layer !== 'unknown') {
              meta.push(`layer:${chunk.layer}`);
            }
            const prefix = meta.length > 0 ? meta.join(' ') + '\n' : '';
            return prefix + chunk.content;
          });

          const embeddings = await embeddingProvider.embedBatch(texts);

          for (let j = 0; j < batch.length; j++) {
            chunksWithEmbeddings.push({
              ...batch[j],
              embedding: embeddings[j]
            });
          }

          // Yield to event loop between outer embedding batches — keeps system responsive
          // and allows SIGINT/SIGTERM signal handlers to fire during long indexing runs.
          await new Promise<void>((resolve) => setImmediate(resolve));

          // Update progress
          const embeddingProgress = 50 + Math.round((i / chunksToEmbed.length) * 25);
          this.updateProgress('embedding', embeddingProgress);

          if ((i + batchSize) % 100 === 0 || i + batchSize >= chunksToEmbed.length) {
            console.error(
              `Embedded ${Math.min(i + batchSize, chunksToEmbed.length)}/${
                chunksToEmbed.length
              } chunks`
            );
          }
        }
      } else if (this.config.skipEmbedding) {
        console.error('Skipping embedding generation (skipEmbedding=true)');
      } else if (chunksToEmbed.length === 0 && diff) {
        console.error('No chunks to embed (all unchanged)');
      }

      // Phase 4: Storing
      this.updateProgress('storing', 75);

      // For full rebuilds, use staging directory for atomic swap
      // For incremental, write directly to active location
      const isFullRebuild = !diff;
      let activeContextDir = contextDir;

      if (isFullRebuild) {
        // Create staging directory for atomic swap
        const stagingBase = path.join(contextDir, STAGING_DIRNAME);
        stagingDir = path.join(stagingBase, buildId);
        await fs.mkdir(stagingDir, { recursive: true });
        activeContextDir = stagingDir;
        console.error(`Full rebuild: writing to staging ${stagingDir}`);
      }

      await fs.mkdir(activeContextDir, { recursive: true });

      if (!this.config.skipEmbedding) {
        const storagePath = path.join(activeContextDir, VECTOR_DB_DIRNAME);
        const storageProvider = await getStorageProvider(
          { path: storagePath },
          diff ? { expectedDimensions: getConfiguredDimensions(this.config.embedding) } : undefined
        );

        if (diff) {
          // Incremental: delete old chunks for changed + deleted files, then add new
          const filesToDelete = [...diff.changed, ...diff.deleted].map((rel) =>
            path.join(this.rootPath, rel).replace(/\\/g, '/')
          );
          // Also try with OS-native separators for matching
          const filePathsForDelete = [...diff.changed, ...diff.deleted].map((rel) =>
            path.resolve(this.rootPath, rel)
          );
          const allDeletePaths = [...new Set([...filesToDelete, ...filePathsForDelete])];

          if (allDeletePaths.length > 0) {
            await storageProvider.deleteByFilePaths(allDeletePaths);
          }
          if (chunksWithEmbeddings.length > 0) {
            await storageProvider.store(chunksWithEmbeddings);
          }
          console.error(
            `Incremental store: deleted chunks for ${diff.changed.length + diff.deleted.length} files, ` +
              `added ${chunksWithEmbeddings.length} new chunks`
          );
        } else {
          // Full rebuild: store to staging (no clear - fresh directory)
          console.error(`Storing ${chunksToEmbed.length} chunks to staging...`);
          await storageProvider.store(chunksWithEmbeddings);
        }
      }

      // Vector DB build marker (required for version gating)
      // Write after semantic store step so marker reflects the latest DB state.
      const vectorDir = path.join(activeContextDir, VECTOR_DB_DIRNAME);
      await fs.mkdir(vectorDir, { recursive: true });
      await fs.writeFile(
        path.join(vectorDir, 'index-build.json'),
        JSON.stringify({ buildId, formatVersion: INDEX_FORMAT_VERSION })
      );

      // Keyword index always uses ALL chunks (full regen)
      const indexPath = path.join(activeContextDir, KEYWORD_INDEX_FILENAME);
      // Memory safety: cap keyword index too
      const keywordChunks =
        allChunks.length > maxChunks ? allChunks.slice(0, maxChunks) : allChunks;
      await fs.writeFile(
        indexPath,
        JSON.stringify({
          header: { buildId, formatVersion: INDEX_FORMAT_VERSION },
          chunks: keywordChunks
        })
      );

      // Save library usage and pattern stats (always full regen)
      const intelligencePath = path.join(activeContextDir, INTELLIGENCE_FILENAME);
      const libraryStats = libraryTracker.getStats();

      // Extract tsconfig paths for AI to understand import aliases
      let tsconfigPaths: Record<string, string[]> | undefined;
      try {
        const tsconfigPath = path.join(this.rootPath, 'tsconfig.json');
        const tsconfigContent = await fs.readFile(tsconfigPath, 'utf-8');
        const tsconfig = JSON.parse(tsconfigContent);
        if (tsconfig.compilerOptions?.paths) {
          tsconfigPaths = tsconfig.compilerOptions.paths;
          console.error(
            `Found ${Object.keys(tsconfigPaths!).length} path aliases in tsconfig.json`
          );
        }
      } catch (_error) {
        // No tsconfig.json or no paths defined
      }

      const intelligence = {
        header: { buildId, formatVersion: INDEX_FORMAT_VERSION },
        libraryUsage: libraryStats,
        patterns: patternDetector.getAllPatterns(),
        goldenFiles: patternDetector.getGoldenFiles(5),
        // tsconfig paths help AI understand import aliases (e.g., @mycompany/* -> libs/*)
        // This reveals which @scoped packages are internal vs external
        tsconfigPaths,
        importGraph: {
          usages: importGraph.getAllUsages(),
          topUsed: importGraph.getTopUsed(30)
        },
        // Internal file graph for circular dependency and unused export detection
        internalFileGraph: internalFileGraph.toJSON(),
        generatedAt
      };
      await fs.writeFile(intelligencePath, JSON.stringify(intelligence, null, 2));

      // Write relationships sidecar (versioned, for fast lookup)
      const relationshipsPath = path.join(activeContextDir, RELATIONSHIPS_FILENAME);
      const graphData = internalFileGraph.toJSON();

      // Build reverse import map (importedBy)
      const importedBy: Record<string, string[]> = {};
      if (graphData.imports) {
        for (const [file, deps] of Object.entries(graphData.imports)) {
          for (const dep of deps as string[]) {
            if (!importedBy[dep]) importedBy[dep] = [];
            importedBy[dep].push(file);
          }
        }
      }

      // Build symbol export map (exportedBy)
      const exportedBy: Record<string, string[]> = {};
      if (graphData.exports) {
        for (const [file, exps] of Object.entries(graphData.exports)) {
          for (const exp of exps as Array<{ name: string; type: string }>) {
            if (exp.name && exp.name !== 'default') {
              if (!exportedBy[exp.name]) exportedBy[exp.name] = [];
              if (!exportedBy[exp.name].includes(file)) {
                exportedBy[exp.name].push(file);
              }
            }
          }
        }
      }

      const relationships = {
        header: { buildId, formatVersion: INDEX_FORMAT_VERSION },
        generatedAt,
        graph: {
          imports: graphData.imports || {},
          ...(graphData.importDetails ? { importDetails: graphData.importDetails } : {}),
          importedBy,
          exports: graphData.exports || {}
        },
        symbols: {
          exportedBy
        },
        stats: graphData.stats || internalFileGraph.getStats()
      };
      await fs.writeFile(relationshipsPath, JSON.stringify(relationships, null, 2));

      const healthPath = path.join(activeContextDir, HEALTH_FILENAME);
      const health = deriveCodebaseHealth({
        buildId,
        formatVersion: INDEX_FORMAT_VERSION,
        generatedAt,
        chunks: allChunks,
        graph: internalFileGraph
      });
      await fs.writeFile(healthPath, JSON.stringify(health, null, 2));

      // Write manifest (both full and incremental)
      // For full rebuild, write to staging; for incremental, write to active
      const activeManifestPath = path.join(activeContextDir, MANIFEST_FILENAME);
      const manifest: FileManifest = {
        version: 1,
        generatedAt: new Date().toISOString(),
        files: currentHashes ?? (await computeFileHashes(files, this.rootPath))
      };
      await writeManifest(activeManifestPath, manifest);

      const persistedStats: PersistedIndexingStats = {
        indexedFiles: stats.indexedFiles,
        totalChunks: stats.totalChunks,
        totalFiles: stats.totalFiles,
        generatedAt
      };
      const activeIndexingStatsPath = path.join(activeContextDir, INDEXING_STATS_FILENAME);
      await fs.writeFile(activeIndexingStatsPath, JSON.stringify(persistedStats, null, 2));

      // Index meta (authoritative) — write last so readers never observe meta pointing to missing artifacts.
      const metaPath = path.join(activeContextDir, INDEX_META_FILENAME);
      await fs.writeFile(
        metaPath,
        JSON.stringify(
          {
            metaVersion: INDEX_META_VERSION,
            formatVersion: INDEX_FORMAT_VERSION,
            buildId,
            generatedAt,
            toolVersion,
            artifacts: {
              keywordIndex: { path: KEYWORD_INDEX_FILENAME },
              vectorDb: {
                path: VECTOR_DB_DIRNAME,
                provider: 'lancedb',
                embeddingProvider: this.config.embedding?.provider ?? 'transformers',
                embeddingModel: this.config.embedding?.model ?? DEFAULT_MODEL
              },
              intelligence: { path: INTELLIGENCE_FILENAME },
              manifest: { path: MANIFEST_FILENAME },
              indexingStats: { path: INDEXING_STATS_FILENAME },
              relationships: { path: RELATIONSHIPS_FILENAME },
              health: { path: HEALTH_FILENAME }
            }
          },
          null,
          2
        )
      );

      // Atomic swap for full rebuilds: move staging into active location
      if (isFullRebuild && stagingDir) {
        console.error('Performing atomic swap of staging to active...');
        await atomicSwapStagingToActive(contextDir, stagingDir, buildId);
      }

      // Phase 5: Complete
      this.updateProgress('complete', 100);

      stats.duration = Date.now() - startTime;
      stats.completedAt = new Date();

      if (diff) {
        console.error(
          `Incremental indexing complete in ${stats.duration}ms ` +
            `(${diff.added.length} added, ${diff.changed.length} changed, ` +
            `${diff.deleted.length} deleted, ${diff.unchanged.length} unchanged)`
        );
      } else {
        console.error(`Indexing complete in ${stats.duration}ms`);
        console.error(`Indexed ${stats.indexedFiles} files, ${stats.totalChunks} chunks`);
      }

      return stats;
    } catch (error) {
      this.progress.phase = 'error';
      stats.errors.push({
        filePath: this.rootPath,
        error: error instanceof Error ? error.message : String(error),
        phase: this.progress.phase,
        timestamp: new Date()
      });
      // Clean up staging directory on failure (best-effort)
      if (stagingDir) {
        console.error('Cleaning up staging directory after failure...');
        await cleanupDirectory(stagingDir);
      }
      throw error;
    }
  }

  private async scanFiles(): Promise<string[]> {
    const files: string[] = [];
    const seen = new Set<string>();

    // Read .gitignore if respecting it
    let ig: ReturnType<typeof ignore.default> | null = null;
    if (this.config.respectGitignore) {
      try {
        const gitignorePath = path.join(this.rootPath, '.gitignore');
        const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
        ig = ignore.default().add(gitignoreContent);
      } catch (_error) {
        // No .gitignore or couldn't read it
      }
    }

    // Scan with glob
    const includePatterns = this.getIncludePatterns();
    const excludePatterns = this.config.exclude || [];

    for (const pattern of includePatterns) {
      const matches = await glob(pattern, {
        cwd: this.rootPath,
        absolute: true,
        ignore: excludePatterns,
        nodir: true
      });

      for (const file of matches) {
        const normalizedFile = file.replace(/\\/g, '/');
        if (seen.has(normalizedFile)) {
          continue;
        }
        seen.add(normalizedFile);

        const relativePath = path.relative(this.rootPath, file);

        // Check gitignore
        if (ig && ig.ignores(relativePath)) {
          continue;
        }

        // Check if it's a code file
        if (!isCodeFile(file, this.supportedCodeExtensions) || isBinaryFile(file)) {
          continue;
        }

        // Check file size
        try {
          const stats = await fs.stat(file);
          if (stats.size > (this.config.parsing?.maxFileSize || 1048576)) {
            console.warn(`Skipping large file: ${file} (${stats.size} bytes)`);
            continue;
          }
        } catch (_error) {
          continue;
        }

        files.push(file);
      }
    }

    return files;
  }

  private updateProgress(phase: IndexingPhase, percentage: number): void {
    this.progress.phase = phase;
    this.progress.percentage = percentage;

    if (this.onProgressCallback) {
      this.onProgressCallback(this.progress);
    }
  }

  async detectMetadata(): Promise<CodebaseMetadata> {
    // Get all registered analyzers (sorted by priority, highest first)
    const analyzers = analyzerRegistry.getAll();

    // Start with base metadata template
    let metadata: CodebaseMetadata = {
      name: path.basename(this.rootPath),
      rootPath: this.rootPath,
      languages: [],
      dependencies: [],
      architecture: {
        type: 'mixed',
        layers: {
          presentation: 0,
          business: 0,
          data: 0,
          state: 0,
          core: 0,
          shared: 0,
          feature: 0,
          infrastructure: 0,
          unknown: 0
        },
        patterns: []
      },
      styleGuides: [],
      documentation: [],
      projectStructure: {
        type: 'single-app'
      },
      statistics: {
        totalFiles: 0,
        totalLines: 0,
        totalComponents: 0,
        componentsByType: {},
        componentsByLayer: {
          presentation: 0,
          business: 0,
          data: 0,
          state: 0,
          core: 0,
          shared: 0,
          feature: 0,
          infrastructure: 0,
          unknown: 0
        }
      },
      customMetadata: {}
    };

    // Loop through all analyzers (highest priority first) and merge their metadata
    // Higher priority analyzers' values win on conflicts
    for (const analyzer of analyzers) {
      try {
        const analyzerMeta = await analyzer.detectCodebaseMetadata(this.rootPath);
        metadata = this.mergeMetadata(metadata, analyzerMeta);
      } catch (error) {
        // Analyzer failed, continue with next
        console.warn(`Analyzer ${analyzer.name} failed to detect metadata:`, error);
      }
    }

    // Load intelligence data if available
    try {
      const intelligencePath = path.join(
        this.rootPath,
        CODEBASE_CONTEXT_DIRNAME,
        INTELLIGENCE_FILENAME
      );
      const intelligenceContent = await fs.readFile(intelligencePath, 'utf-8');
      const intelligence = JSON.parse(intelligenceContent) as IntelligenceData;

      // Phase 06: ignore legacy intelligence files that lack a versioned header.
      if (!intelligence || typeof intelligence !== 'object' || !intelligence.header) {
        return metadata;
      }

      metadata.customMetadata = {
        ...metadata.customMetadata,
        libraryUsage: intelligence.libraryUsage,
        patterns: intelligence.patterns,
        intelligenceGeneratedAt: intelligence.generatedAt
      };
    } catch (_error) {
      // Intelligence file doesn't exist yet (indexing not run)
    }

    return metadata;
  }

  /**
   * Merge two CodebaseMetadata objects.
   * The 'incoming' metadata takes precedence for non-empty values.
   */
  private mergeMetadata(base: CodebaseMetadata, incoming: CodebaseMetadata): CodebaseMetadata {
    return {
      name: incoming.name || base.name,
      rootPath: incoming.rootPath || base.rootPath,
      languages: [...new Set([...base.languages, ...incoming.languages])], // Merge and deduplicate
      dependencies: this.mergeDependencies(base.dependencies, incoming.dependencies),
      framework: this.selectFramework(base.framework, incoming.framework),
      architecture: {
        type: incoming.architecture?.type || base.architecture.type,
        layers: this.mergeLayers(base.architecture.layers, incoming.architecture?.layers),
        patterns: [
          ...new Set([
            ...(base.architecture.patterns || []),
            ...(incoming.architecture?.patterns || [])
          ])
        ] // Merge and deduplicate
      },
      styleGuides: [...new Set([...base.styleGuides, ...incoming.styleGuides])], // Merge and deduplicate
      documentation: [...new Set([...base.documentation, ...incoming.documentation])], // Merge and deduplicate
      projectStructure:
        incoming.projectStructure?.type !== 'single-app'
          ? incoming.projectStructure
          : base.projectStructure,
      statistics: this.mergeStatistics(base.statistics, incoming.statistics),
      customMetadata: { ...base.customMetadata, ...incoming.customMetadata }
    };
  }

  /**
   * Select the best framework claim from two candidates.
   * Requires at least MIN_INDICATORS evidence signals — prevents analyzers from claiming
   * a framework when only one weak signal is present (e.g. a single import).
   * Priority-order callers (highest priority first) ensure the first passing candidate wins.
   */
  private selectFramework(
    base: FrameworkInfo | undefined,
    incoming: FrameworkInfo | undefined
  ): FrameworkInfo | undefined {
    const MIN_INDICATORS = 3;
    const passes = (f: FrameworkInfo | undefined): f is FrameworkInfo =>
      !!f && (f.indicators?.length ?? 0) >= MIN_INDICATORS;

    if (passes(base) && passes(incoming)) return base; // higher-priority analyzer wins
    if (passes(base)) return base;
    if (passes(incoming)) return incoming;
    // Debug: log dropped framework claims to aid production diagnosis
    const claimed = [];
    if (base)
      claimed.push(
        `${(base as FrameworkInfo).type}(${(base as FrameworkInfo).indicators?.length ?? 0})`
      );
    if (incoming)
      claimed.push(
        `${(incoming as FrameworkInfo).type}(${(incoming as FrameworkInfo).indicators?.length ?? 0})`
      );
    if (claimed.length > 0) {
      console.debug(
        '[selectFramework] dropped %d claim(s) below MIN_INDICATORS=%d: %s',
        claimed.length,
        MIN_INDICATORS,
        claimed.join(', ')
      );
    }
    return undefined;
  }

  private mergeDependencies(base: Dependency[], incoming: Dependency[]): Dependency[] {
    const seen = new Set(base.map((d) => d.name));
    const result = [...base];
    for (const dep of incoming) {
      if (!seen.has(dep.name)) {
        result.push(dep);
        seen.add(dep.name);
      }
    }
    return result;
  }

  private mergeLayers(
    base: Record<ArchitecturalLayer, number>,
    incoming?: Partial<Record<ArchitecturalLayer, number>>
  ): Record<ArchitecturalLayer, number> {
    if (!incoming) return base;
    return {
      presentation: Math.max(base.presentation || 0, incoming.presentation || 0),
      business: Math.max(base.business || 0, incoming.business || 0),
      data: Math.max(base.data || 0, incoming.data || 0),
      state: Math.max(base.state || 0, incoming.state || 0),
      core: Math.max(base.core || 0, incoming.core || 0),
      shared: Math.max(base.shared || 0, incoming.shared || 0),
      feature: Math.max(base.feature || 0, incoming.feature || 0),
      infrastructure: Math.max(base.infrastructure || 0, incoming.infrastructure || 0),
      unknown: Math.max(base.unknown || 0, incoming.unknown || 0)
    };
  }

  private mergeStatistics(
    base: CodebaseMetadata['statistics'],
    incoming: CodebaseMetadata['statistics']
  ): CodebaseMetadata['statistics'] {
    return {
      totalFiles: Math.max(base.totalFiles || 0, incoming.totalFiles || 0),
      totalLines: Math.max(base.totalLines || 0, incoming.totalLines || 0),
      totalComponents: Math.max(base.totalComponents || 0, incoming.totalComponents || 0),
      componentsByType: { ...base.componentsByType, ...incoming.componentsByType },
      componentsByLayer: this.mergeLayers(base.componentsByLayer, incoming.componentsByLayer)
    };
  }

  getProgress(): IndexingProgress {
    return { ...this.progress };
  }
}
