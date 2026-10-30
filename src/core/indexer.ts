/**
 * Core Indexer - Orchestrates codebase indexing
 * Scans files, delegates to analyzers, creates embeddings, stores in vector DB
 */

import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { IndexCorruptedError, InvalidSourceChunkError } from '../errors/index.js';
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
  assertEmbeddingRuntimeAvailable,
  getEmbeddingProvider,
  getConfiguredDimensions,
  DEFAULT_MODEL,
  parseEmbeddingProviderName
} from '../embeddings/index.js';
import {
  assertStorageRuntimeAvailable,
  getStorageProvider,
  CodeChunkWithEmbedding
} from '../storage/index.js';
import {
  LibraryUsageTracker,
  PatternDetector,
  ImportGraph,
  InternalFileGraph,
  FileExport,
  ImportEdgeSource
} from '../utils/usage-tracker.js';
import { mergeSmallChunks, validateSourceChunks } from '../utils/chunking.js';
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
import { isPathWithin } from '../utils/project-discovery.js';
import { deriveCodebaseHealth } from '../health/derive.js';
import {
  extractSourceReexports,
  InternalSourceResolver,
  loadTsconfigCompilerOptions
} from '../utils/internal-source-resolver.js';

const DEFAULT_MAX_CHUNKS = 5000;

class SourceSnapshotChangedError extends Error {}

import {
  computeFileHashes,
  hashFileContent,
  readManifest,
  writeManifest,
  diffManifest,
  type FileManifest,
  type ManifestDiff
} from './manifest.js';
import {
  readIndexMeta,
  readIndexMetaFromFile,
  checkEmbeddingMismatch,
  resolveSkipEmbedding,
  validateIndexArtifacts
} from './index-meta.js';
import {
  withIndexWriter,
  withIndexSnapshot,
  inspectIndexDiskState,
  permitsFirstBuild,
  prepareIndexGeneration,
  publishIndexGeneration,
  resolveIndexArtifact,
  copyIndexVectors,
  withAvailableIndexSnapshot
} from './index-generation.js';

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
  /** Recheck first-use eligibility after writer admission; never replace a newly published index. */
  firstBuildOnly?: boolean;
}

interface PersistedIndexingStats {
  indexedFiles: number;
  totalChunks: number;
  totalFiles: number;
  generatedAt: string;
}

const MAX_INDEX_FILES = 10000;
const MAX_PREVIEW_SKIP_SAMPLES = 20;

export interface IndexFileSelection {
  selected: string[];
  overLimitCount: number;
  overLimitSamples: string[];
}

export interface IndexPreview {
  rootPath: string;
  eligibleFiles: string[];
  skippedFiles: Array<{ path: string; reason: string }>;
  skippedFileCount: number;
  /** Patterns applied before glob enumeration; matching files are not individually observed. */
  excludedPatterns: string[];
}

interface FileScanResult {
  files: string[];
  skippedFiles: Array<{ path: string; reason: string }>;
  skippedFileCount: number;
}

type SourcePathResolution =
  | { status: 'contained'; path: string }
  | { status: 'outside' }
  | { status: 'alias' }
  | { status: 'unavailable' };

function normalizeComparablePath(filePath: string): string {
  const normalized = path.normalize(path.resolve(filePath));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function resolveContainedSourcePath(
  filePath: string,
  canonicalRootPath: string
): Promise<SourcePathResolution> {
  let canonicalFilePath: string;
  try {
    canonicalFilePath = await fs.realpath(filePath);
  } catch {
    return { status: 'unavailable' };
  }
  if (!isPathWithin(canonicalRootPath, canonicalFilePath)) return { status: 'outside' };
  if (normalizeComparablePath(filePath) !== normalizeComparablePath(canonicalFilePath)) {
    return { status: 'alias' };
  }
  return { status: 'contained', path: canonicalFilePath };
}

function addSkippedFile(
  scan: FileScanResult,
  filePath: string,
  reason: string,
  rootPath: string
): void {
  scan.skippedFileCount++;
  if (scan.skippedFiles.length < MAX_PREVIEW_SKIP_SAMPLES) {
    scan.skippedFiles.push({ path: path.relative(rootPath, filePath).replace(/\\/g, '/'), reason });
  }
}

export function selectFilesForIndex(files: string[]): IndexFileSelection {
  return {
    selected: files.slice(0, MAX_INDEX_FILES),
    overLimitCount: Math.max(0, files.length - MAX_INDEX_FILES),
    overLimitSamples: files.slice(MAX_INDEX_FILES, MAX_INDEX_FILES + MAX_PREVIEW_SKIP_SAMPLES)
  };
}

export class CodebaseIndexer {
  private rootPath: string;
  private config: CodebaseConfig;
  private projectOptions: AnalyzerSelectionOptions;
  private supportedCodeExtensions: Set<string>;
  private progress: IndexingProgress;
  private onProgressCallback?: (progress: IndexingProgress) => void;
  private incrementalOnly: boolean;
  private readonly firstBuildOnly: boolean;
  private readonly explicitSkipEmbedding?: boolean;

  constructor(options: IndexerOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.firstBuildOnly = options.firstBuildOnly ?? false;
    this.config = this.mergeConfig(options.config);
    this.explicitSkipEmbedding = options.config?.skipEmbedding;
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
        : defaultEmbeddingProvider === 'ollama' && !process.env.EMBEDDING_MODEL
          ? 'nomic-embed-text'
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
      skipEmbedding: true,
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

  /** Enumerate the exact files the next index pass would select, without indexing or writing. */
  async previewFiles(): Promise<IndexPreview> {
    const scan = await this.scanFiles(false);
    const selection = selectFilesForIndex(scan.files);
    const skippedFiles = [...scan.skippedFiles];
    for (const file of selection.overLimitSamples.slice(
      0,
      MAX_PREVIEW_SKIP_SAMPLES - skippedFiles.length
    )) {
      skippedFiles.push({
        path: path.relative(this.rootPath, file).replace(/\\/g, '/'),
        reason: 'exceeds the indexer file-count limit'
      });
    }
    const toRelativePath = (file: string): string =>
      path.relative(this.rootPath, file).replace(/\\/g, '/');
    const comparePaths = (left: string, right: string): number =>
      left < right ? -1 : left > right ? 1 : 0;
    const eligibleFiles = selection.selected.map(toRelativePath).sort(comparePaths);
    skippedFiles.sort(
      (left, right) =>
        comparePaths(left.path, right.path) || comparePaths(left.reason, right.reason)
    );
    return {
      rootPath: this.rootPath,
      eligibleFiles,
      skippedFiles,
      skippedFileCount: scan.skippedFileCount + selection.overLimitCount,
      excludedPatterns: [...(this.config.exclude ?? [])]
    };
  }

  async index(): Promise<IndexingStats> {
    return withIndexWriter(this.rootPath, () => this.indexLocked());
  }

  private async indexLocked(): Promise<IndexingStats> {
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
      if (this.firstBuildOnly) {
        const state = await inspectIndexDiskState(this.rootPath);
        if (state.kind === 'committed' || state.kind === 'legacy') {
          await withIndexSnapshot(this.rootPath, async () => {
            await validateIndexArtifacts(this.rootPath, await readIndexMeta(this.rootPath));
          });
          stats.duration = Date.now() - startTime;
          stats.completedAt = new Date();
          return stats;
        }
        if (!permitsFirstBuild(state))
          throw new IndexCorruptedError(
            'Existing index data needs explicit recovery before map can build a first index.'
          );
      }
      this.config.skipEmbedding = await resolveSkipEmbedding(
        this.rootPath,
        this.explicitSkipEmbedding
      );
      if (!this.config.skipEmbedding) {
        assertEmbeddingRuntimeAvailable(this.config.embedding);
        assertStorageRuntimeAvailable();
      }
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
      const scan = await this.scanFiles();
      const selection = selectFilesForIndex(scan.files);
      const files = selection.selected;

      // Memory safety: limit total files to prevent heap exhaustion
      if (selection.overLimitCount > 0) {
        console.warn(
          `WARNING: Found ${scan.files.length} files, limiting to ${MAX_INDEX_FILES} to prevent memory issues.`
        );
        console.warn(
          `Consider using more specific include patterns or excluding large directories.`
        );
      }

      stats.totalFiles = files.length;
      this.progress.totalFiles = files.length;

      console.error(`Found ${files.length} files to index`);

      // Phase 1b: Incremental diff (if incremental mode)
      const contextDir = path.join(this.rootPath, CODEBASE_CONTEXT_DIRNAME);
      const baselineMeta = await readIndexMeta(this.rootPath).catch(() => null);
      const baselineDirectory = baselineMeta
        ? path.dirname(
            await resolveIndexArtifact(this.rootPath, KEYWORD_INDEX_FILENAME, baselineMeta)
          )
        : contextDir;
      const manifestPath = path.join(baselineDirectory, MANIFEST_FILENAME);
      const indexingStatsPath = path.join(baselineDirectory, INDEXING_STATS_FILENAME);
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
          if (
            checkEmbeddingMismatch(
              existingMeta,
              currentProvider,
              currentModel,
              !this.config.skipEmbedding
            )
          ) {
            const stored = existingMeta.artifacts.vectorDb;
            console.error(
              `Embedding configuration changed (stored: ${stored.embeddingEnabled === false ? 'disabled' : `${stored.embeddingProvider ?? 'unknown'}:${stored.embeddingModel ?? 'unknown'}`}, current: ${this.config.skipEmbedding ? 'disabled' : `${currentProvider}:${currentModel}`}); forcing full rebuild`
            );
            diff = null;
          }
        } catch {
          // Chunk semantics and embedding input may have changed even when source hashes did not.
          // Incompatible metadata must never reuse chunks from the previous format.
          diff = null;
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
              const existingIndexPath = path.join(baselineDirectory, KEYWORD_INDEX_FILENAME);
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

      // Resolve graph edges only to discovered, root-confined source files.
      let tsconfigPaths: Record<string, string[]> | undefined;
      const tsconfigCompilerOptions = loadTsconfigCompilerOptions(this.rootPath);
      if (tsconfigCompilerOptions.paths) {
        tsconfigPaths = Object.fromEntries(
          Object.entries(tsconfigCompilerOptions.paths).map(([alias, targets]) => [
            alias,
            [...targets]
          ])
        );
      }
      const sourceResolver = await InternalSourceResolver.create(this.rootPath, files, {
        compilerOptions: tsconfigCompilerOptions
      });
      const sourceFingerprints = new Map<string, string>();
      const analyzedManifestHashes = new Map<string, string>();
      const pendingResolvedEdges: Array<{
        from: string;
        to: string;
        target: string;
        line: number;
        importedSymbols: string[];
        source: Omit<ImportEdgeSource, 'line' | 'targetFingerprint'>;
      }> = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.progress.currentFile = file;
        this.progress.filesProcessed = i + 1;
        this.progress.percentage = Math.round(((i + 1) / files.length) * 100);

        try {
          // Normalize line endings to \n for consistent cross-platform output
          const resolution = await resolveContainedSourcePath(file, this.rootPath);
          if (resolution.status !== 'contained') {
            throw new Error(
              resolution.status === 'outside'
                ? `Source resolves outside selected root: ${file}`
                : resolution.status === 'alias'
                  ? `Source alias is not indexed: ${file}`
                  : `Source could not be resolved before reading: ${file}`
            );
          }
          const resolvedFile = resolution.path;
          const rawBytes = await fs.readFile(resolvedFile);
          const sourceFingerprint = createHash('sha256').update(rawBytes).digest('hex');
          sourceFingerprints.set(resolvedFile, sourceFingerprint);
          const rawContent = rawBytes.toString('utf-8');
          const relativeFile = path.relative(this.rootPath, resolvedFile).replace(/\\/g, '/');
          const analyzedManifestHash = hashFileContent(rawContent);
          analyzedManifestHashes.set(relativeFile, analyzedManifestHash);
          if (
            currentHashes &&
            diff?.unchanged.includes(relativeFile) &&
            currentHashes[relativeFile] !== analyzedManifestHash
          ) {
            throw new SourceSnapshotChangedError(
              `Source changed during incremental scan; retry indexing: ${relativeFile}`
            );
          }
          const content = rawContent.replace(/\r\n/g, '\n');
          const result = await analyzerRegistry.analyzeFile(file, content, {
            ...resolvedProjectOptions,
            includeScopePrefix: false
          });

          if (result) {
            const isFileChanged = !filesToProcessSet || filesToProcessSet.has(file);

            // Analyzer paths are derived from process.cwd(); persisted paths belong to this index root.
            for (const chunk of result.chunks) {
              chunk.relativePath = relativeFile;
            }

            const mergedChunks = mergeSmallChunks(result.chunks, 15);
            validateSourceChunks(mergedChunks, {
              filePath: resolvedFile,
              relativePath: relativeFile,
              content
            });

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

              const resolution = await sourceResolver.resolve(file, imp.source);
              if (resolution.status === 'resolved') {
                pendingResolvedEdges.push({
                  from: file,
                  to: resolution.path,
                  target: resolution.target,
                  line: imp.line || 1,
                  importedSymbols: imp.imports,
                  source: {
                    kind: 'import',
                    specifier: imp.source,
                    sourceFingerprint
                  }
                });
              } else {
                internalFileGraph.trackUnresolved(
                  file,
                  {
                    line: imp.line || 1,
                    specifier: imp.source,
                    kind: 'import',
                    sourceFingerprint,
                    targetFingerprint: ''
                  },
                  resolution
                );
              }
            }

            // Re-export relationships are separate typed edges and require AST source evidence.
            for (const reexport of extractSourceReexports(content, file)) {
              const resolution = await sourceResolver.resolve(file, reexport.specifier);
              const proof = {
                line: reexport.line,
                specifier: reexport.specifier,
                kind: 'reexport' as const,
                sourceFingerprint,
                targetFingerprint: ''
              };
              if (resolution.status === 'resolved') {
                pendingResolvedEdges.push({
                  from: file,
                  to: resolution.path,
                  target: resolution.target,
                  line: reexport.line,
                  importedSymbols: [],
                  source: {
                    kind: proof.kind,
                    specifier: proof.specifier,
                    sourceFingerprint: proof.sourceFingerprint
                  }
                });
              } else {
                internalFileGraph.trackUnresolved(file, proof, resolution);
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
          if (
            error instanceof SourceSnapshotChangedError ||
            error instanceof InvalidSourceChunkError
          )
            throw error;
          const relativeFile = path.relative(this.rootPath, file).replace(/\\/g, '/');
          if (
            diff?.unchanged.includes(relativeFile) &&
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ) {
            throw new SourceSnapshotChangedError(
              `Source disappeared during incremental scan; retry indexing: ${relativeFile}`
            );
          }
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

      // Finish edges only after each endpoint has been read for this build. This binds both
      // fingerprints to the exact source snapshots analyzed above, without retaining file bytes.
      for (const edge of pendingResolvedEdges) {
        const targetFingerprint = sourceFingerprints.get(edge.to);
        if (targetFingerprint) {
          internalFileGraph.trackImport(edge.from, edge.to, edge.line, edge.importedSymbols, {
            ...edge.source,
            targetFingerprint
          });
        } else {
          internalFileGraph.trackUnresolved(
            edge.from,
            {
              ...edge.source,
              line: edge.line,
              targetFingerprint: ''
            },
            { reason: 'analysis-unavailable', target: edge.target }
          );
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

      // Both full and incremental builds write a new, unpublished generation.
      stagingDir = await prepareIndexGeneration(this.rootPath, buildId);
      const generationDirectory = stagingDir;
      if (diff && !this.config.skipEmbedding) {
        // The published baseline is immutable and has no writer handles. A physical
        // copy preserves unchanged vectors without sharing writable Lance files.
        await copyIndexVectors(
          this.rootPath,
          path.join(baselineDirectory, VECTOR_DB_DIRNAME),
          path.join(generationDirectory, VECTOR_DB_DIRNAME)
        );
      }

      if (!this.config.skipEmbedding) {
        const storagePath = path.join(generationDirectory, VECTOR_DB_DIRNAME);
        const storageProvider = await getStorageProvider(
          { path: storagePath },
          diff ? { expectedDimensions: getConfiguredDimensions(this.config.embedding) } : undefined
        );

        try {
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
        } finally {
          await storageProvider.close?.();
        }
      }

      // Vector DB build marker (required for version gating)
      // Write after semantic store step so marker reflects the latest DB state.
      const vectorDir = path.join(generationDirectory, VECTOR_DB_DIRNAME);
      await fs.mkdir(vectorDir, { recursive: true });
      await fs.writeFile(
        path.join(vectorDir, 'index-build.json'),
        JSON.stringify({ buildId, formatVersion: INDEX_FORMAT_VERSION })
      );

      // Keyword index always uses ALL chunks (full regen)
      const indexPath = path.join(generationDirectory, KEYWORD_INDEX_FILENAME);
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
      const intelligencePath = path.join(generationDirectory, INTELLIGENCE_FILENAME);
      const libraryStats = libraryTracker.getStats();

      if (tsconfigPaths && Object.keys(tsconfigPaths).length > 0) {
        console.error(`Found ${Object.keys(tsconfigPaths).length} path aliases in tsconfig.json`);
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
      const relationshipsPath = path.join(generationDirectory, RELATIONSHIPS_FILENAME);
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
          ...(graphData.unresolvedEdges ? { unresolvedEdges: graphData.unresolvedEdges } : {}),
          importedBy,
          exports: graphData.exports || {}
        },
        symbols: {
          exportedBy
        },
        stats: graphData.stats || internalFileGraph.getStats()
      };
      await fs.writeFile(relationshipsPath, JSON.stringify(relationships, null, 2));

      const healthPath = path.join(generationDirectory, HEALTH_FILENAME);
      const health = deriveCodebaseHealth({
        buildId,
        formatVersion: INDEX_FORMAT_VERSION,
        generatedAt,
        chunks: allChunks,
        graph: internalFileGraph
      });
      await fs.writeFile(healthPath, JSON.stringify(health, null, 2));

      // Write manifest (both full and incremental)
      // Full and incremental builds both write an immutable staged generation.
      const activeManifestPath = path.join(generationDirectory, MANIFEST_FILENAME);
      const analyzedHashes = Object.fromEntries(analyzedManifestHashes);
      const manifest: FileManifest = {
        version: 1,
        generatedAt: new Date().toISOString(),
        header: { buildId, formatVersion: INDEX_FORMAT_VERSION },
        files: analyzedHashes
      };
      await writeManifest(activeManifestPath, manifest);

      const persistedStats: PersistedIndexingStats = {
        indexedFiles: stats.indexedFiles,
        totalChunks: stats.totalChunks,
        totalFiles: stats.totalFiles,
        generatedAt
      };
      const activeIndexingStatsPath = path.join(generationDirectory, INDEXING_STATS_FILENAME);
      await fs.writeFile(activeIndexingStatsPath, JSON.stringify(persistedStats, null, 2));

      // Complete the staged generation metadata before the separate root-pointer publication.
      const metaPath = path.join(generationDirectory, INDEX_META_FILENAME);
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
                embeddingModel: this.config.embedding?.model ?? DEFAULT_MODEL,
                embeddingEnabled: !this.config.skipEmbedding
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

      const generationMeta = await readIndexMetaFromFile(metaPath);
      // Once publication starts, only retention may remove the generation. Even a
      // post-commit housekeeping fault must not enter the staging rollback path.
      stagingDir = null;
      await publishIndexGeneration(this.rootPath, generationMeta);

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

  private async scanFiles(warnOnLargeFiles = true): Promise<FileScanResult> {
    const scan: FileScanResult = { files: [], skippedFiles: [], skippedFileCount: 0 };
    const seen = new Set<string>();
    this.rootPath = await fs.realpath(this.rootPath);

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
        const sourcePath = await resolveContainedSourcePath(file, this.rootPath);
        if (sourcePath.status !== 'contained') {
          addSkippedFile(
            scan,
            file,
            sourcePath.status === 'outside'
              ? 'source resolves outside selected root'
              : sourcePath.status === 'alias'
                ? 'source alias is not indexed; use its canonical path'
                : 'file could not be inspected',
            this.rootPath
          );
          continue;
        }

        // Check gitignore
        if (ig && ig.ignores(relativePath)) {
          addSkippedFile(scan, file, 'ignored by .gitignore', this.rootPath);
          continue;
        }

        // Check if it's a code file
        if (
          !isCodeFile(sourcePath.path, this.supportedCodeExtensions) ||
          isBinaryFile(sourcePath.path)
        ) {
          addSkippedFile(scan, file, 'unsupported or binary file', this.rootPath);
          continue;
        }

        // Check file size
        try {
          const stats = await fs.stat(sourcePath.path);
          if (stats.size > (this.config.parsing?.maxFileSize || 1048576)) {
            if (warnOnLargeFiles)
              console.warn(`Skipping large file: ${file} (${stats.size} bytes)`);
            addSkippedFile(scan, file, 'exceeds configured maximum file size', this.rootPath);
            continue;
          }
        } catch (_error) {
          addSkippedFile(scan, file, 'file could not be inspected', this.rootPath);
          continue;
        }

        scan.files.push(sourcePath.path);
      }
    }

    return scan;
  }

  private updateProgress(phase: IndexingPhase, percentage: number): void {
    this.progress.phase = phase;
    this.progress.percentage = percentage;

    if (this.onProgressCallback) {
      this.onProgressCallback(this.progress);
    }
  }

  async detectMetadata(): Promise<CodebaseMetadata> {
    return withAvailableIndexSnapshot(this.rootPath, () => this.detectPinnedMetadata());
  }

  private async detectPinnedMetadata(): Promise<CodebaseMetadata> {
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
      const intelligencePath = await resolveIndexArtifact(this.rootPath, INTELLIGENCE_FILENAME);
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
