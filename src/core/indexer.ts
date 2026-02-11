/**
 * Core Indexer - Orchestrates codebase indexing
 * Scans files, delegates to analyzers, creates embeddings, stores in vector DB
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { promises as fs } from 'fs';
import path from 'path';
import { glob } from 'glob';
import ignore from 'ignore';
import {
  CodebaseMetadata,
  CodeChunk,
  IndexingProgress,
  IndexingStats,
  IndexingPhase,
  CodebaseConfig
} from '../types/index.js';
import { analyzerRegistry } from './analyzer-registry.js';
import { isCodeFile, isBinaryFile } from '../utils/language-detection.js';
import { getEmbeddingProvider, DEFAULT_MODEL } from '../embeddings/index.js';
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
  INDEXING_STATS_FILENAME,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  MANIFEST_FILENAME,
  VECTOR_DB_DIRNAME
} from '../constants/codebase-context.js';
import {
  computeFileHashes,
  readManifest,
  writeManifest,
  diffManifest,
  type FileManifest,
  type ManifestDiff
} from './manifest.js';

export interface IndexerOptions {
  rootPath: string;
  config?: Partial<CodebaseConfig>;
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
  private progress: IndexingProgress;
  private onProgressCallback?: (progress: IndexingProgress) => void;
  private incrementalOnly: boolean;

  constructor(options: IndexerOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.config = this.mergeConfig(options.config);
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
    const defaultConfig: CodebaseConfig = {
      analyzers: {
        angular: { enabled: true, priority: 100 },
        react: { enabled: false, priority: 90 },
        vue: { enabled: false, priority: 90 },
        generic: { enabled: true, priority: 10 }
      },
      include: ['**/*.{ts,tsx,js,jsx,html,css,scss,sass,less}'],
      exclude: ['node_modules/**', 'dist/**', 'build/**', '.git/**', 'coverage/**'],
      respectGitignore: true,
      parsing: {
        maxFileSize: 1048576,
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
        provider: 'transformers',
        model: DEFAULT_MODEL,
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

    try {
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

        // Short-circuit: nothing changed
        if (diff.added.length === 0 && diff.changed.length === 0 && diff.deleted.length === 0) {
          console.error('No files changed — skipping re-index.');
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
              const existingChunks = JSON.parse(await fs.readFile(existingIndexPath, 'utf-8'));
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
          const result = await analyzerRegistry.analyzeFile(file, content);

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

                internalFileGraph.trackImport(file, resolvedPath, imp.imports);
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
            if (result.metadata?.detectedPatterns) {
              for (const pattern of result.metadata.detectedPatterns) {
                // Try to extract a relevant snippet for the pattern
                const snippetPattern = this.getSnippetPatternFor(pattern.category, pattern.name);
                const snippet = snippetPattern ? extractSnippet(snippetPattern) : undefined;
                patternDetector.track(
                  pattern.category,
                  pattern.name,
                  snippet ? { file: relPath, snippet } : undefined,
                  fileDate
                );
              }
            }

            // Track file for Golden File scoring (framework-agnostic based on patterns)
            const detectedPatterns = result.metadata?.detectedPatterns || [];
            const hasPattern = (category: string, name: string) =>
              detectedPatterns.some(
                (p: { category: string; name: string }) =>
                  p.category === category && p.name === name
              );

            const patternScore =
              (hasPattern('dependencyInjection', 'inject() function') ? 1 : 0) +
              (hasPattern('stateManagement', 'Signals') ? 1 : 0) +
              (hasPattern('reactivity', 'Computed') ? 1 : 0) +
              (hasPattern('reactivity', 'Effect') ? 1 : 0) +
              (hasPattern('componentStyle', 'Standalone') ? 1 : 0) +
              (hasPattern('componentInputs', 'Signal-based inputs') ? 1 : 0);
            if (patternScore >= 3) {
              patternDetector.trackGoldenFile(relPath, patternScore, {
                inject: hasPattern('dependencyInjection', 'inject() function'),
                signals: hasPattern('stateManagement', 'Signals'),
                computed: hasPattern('reactivity', 'Computed'),
                effect: hasPattern('reactivity', 'Effect'),
                standalone: hasPattern('componentStyle', 'Standalone'),
                signalInputs: hasPattern('componentInputs', 'Signal-based inputs')
              });
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
      const MAX_CHUNKS = 5000;
      let chunksToEmbed = chunksForEmbedding;
      if (chunksForEmbedding.length > MAX_CHUNKS) {
        console.warn(
          `WARNING: ${chunksForEmbedding.length} chunks exceed limit. Indexing first ${MAX_CHUNKS} chunks.`
        );
        chunksToEmbed = chunksForEmbedding.slice(0, MAX_CHUNKS);
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

      await fs.mkdir(contextDir, { recursive: true });

      if (!this.config.skipEmbedding) {
        const storagePath = path.join(contextDir, VECTOR_DB_DIRNAME);
        const storageProvider = await getStorageProvider({ path: storagePath });

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
          // Full: clear and re-store everything
          console.error(`Storing ${chunksToEmbed.length} chunks...`);
          await storageProvider.clear();
          await storageProvider.store(chunksWithEmbeddings);
        }
      }

      // Keyword index always uses ALL chunks (full regen)
      const indexPath = path.join(contextDir, KEYWORD_INDEX_FILENAME);
      // Memory safety: cap keyword index too
      const keywordChunks =
        allChunks.length > MAX_CHUNKS ? allChunks.slice(0, MAX_CHUNKS) : allChunks;
      await fs.writeFile(indexPath, JSON.stringify(keywordChunks));

      // Save library usage and pattern stats (always full regen)
      const intelligencePath = path.join(contextDir, INTELLIGENCE_FILENAME);
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
        generatedAt: new Date().toISOString()
      };
      await fs.writeFile(intelligencePath, JSON.stringify(intelligence, null, 2));

      // Write manifest (both full and incremental)
      const manifest: FileManifest = {
        version: 1,
        generatedAt: new Date().toISOString(),
        files: currentHashes ?? (await computeFileHashes(files, this.rootPath))
      };
      await writeManifest(manifestPath, manifest);

      const persistedStats: PersistedIndexingStats = {
        indexedFiles: stats.indexedFiles,
        totalChunks: stats.totalChunks,
        totalFiles: stats.totalFiles,
        generatedAt: new Date().toISOString()
      };
      await fs.writeFile(indexingStatsPath, JSON.stringify(persistedStats, null, 2));

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
    const includePatterns = this.config.include || ['**/*'];
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
        if (!isCodeFile(file) || isBinaryFile(file)) {
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
      const intelligence = JSON.parse(intelligenceContent);

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
      framework: incoming.framework || base.framework, // Framework from higher priority analyzer wins
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

  private mergeDependencies(base: any[], incoming: any[]): any[] {
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

  private mergeLayers(base: any, incoming?: any): any {
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

  private mergeStatistics(base: any, incoming: any): any {
    return {
      totalFiles: Math.max(base.totalFiles || 0, incoming.totalFiles || 0),
      totalLines: Math.max(base.totalLines || 0, incoming.totalLines || 0),
      totalComponents: Math.max(base.totalComponents || 0, incoming.totalComponents || 0),
      componentsByType: { ...base.componentsByType, ...incoming.componentsByType },
      componentsByLayer: this.mergeLayers(base.componentsByLayer, incoming.componentsByLayer)
    };
  }

  /**
   * Get regex pattern for extracting code snippets based on pattern category and name
   * This maps abstract pattern names to actual code patterns
   */
  private getSnippetPatternFor(category: string, name: string): RegExp | null {
    const patterns: Record<string, Record<string, RegExp>> = {
      dependencyInjection: {
        'inject() function': /\binject\s*[<(]/,
        'Constructor injection': /constructor\s*\(/
      },
      stateManagement: {
        RxJS: /BehaviorSubject|ReplaySubject|Subject|Observable/,
        Signals: /\bsignal\s*[<(]/
      },
      reactivity: {
        Effect: /\beffect\s*\(/,
        Computed: /\bcomputed\s*[<(]/
      },
      componentStyle: {
        Standalone: /standalone\s*:\s*true/,
        'NgModule-based': /@(?:Component|Directive|Pipe)\s*\(/
      },
      componentInputs: {
        'Signal-based inputs': /\binput\s*[<(]/,
        'Decorator-based @Input': /@Input\(\)/
      }
    };
    return patterns[category]?.[name] || null;
  }

  getProgress(): IndexingProgress {
    return { ...this.progress };
  }
}
