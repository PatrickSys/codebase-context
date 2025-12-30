/**
 * Core Indexer - Orchestrates codebase indexing
 * Scans files, delegates to analyzers, creates embeddings, stores in vector DB
 */

import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import ignore from "ignore";
import {
  CodebaseMetadata,
  CodeChunk,
  IndexingProgress,
  IndexingStats,
  IndexingPhase,
  CodebaseConfig,
  AnalysisResult,
} from "../types/index.js";
import { analyzerRegistry } from "./analyzer-registry.js";
import { isCodeFile, isBinaryFile } from "../utils/language-detection.js";
import {
  getEmbeddingProvider,
  EmbeddingProvider,
} from "../embeddings/index.js";
import {
  getStorageProvider,
  VectorStorageProvider,
  CodeChunkWithEmbedding,
} from "../storage/index.js";
import { LibraryUsageTracker, PatternDetector, ImportGraph, InternalFileGraph, FileExport } from "../utils/usage-tracker.js";
import { getFileCommitDates } from "../utils/git-dates.js";

export interface IndexerOptions {
  rootPath: string;
  config?: Partial<CodebaseConfig>;
  onProgress?: (progress: IndexingProgress) => void;
}

export class CodebaseIndexer {
  private rootPath: string;
  private config: CodebaseConfig;
  private progress: IndexingProgress;
  private onProgressCallback?: (progress: IndexingProgress) => void;

  constructor(options: IndexerOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.config = this.mergeConfig(options.config);
    this.onProgressCallback = options.onProgress;

    this.progress = {
      phase: "initializing",
      percentage: 0,
      filesProcessed: 0,
      totalFiles: 0,
      chunksCreated: 0,
      errors: [],
      startedAt: new Date(),
    };
  }

  private mergeConfig(userConfig?: Partial<CodebaseConfig>): CodebaseConfig {
    const defaultConfig: CodebaseConfig = {
      analyzers: {
        angular: { enabled: true, priority: 100 },
        react: { enabled: false, priority: 90 },
        vue: { enabled: false, priority: 90 },
        generic: { enabled: true, priority: 10 },
      },
      include: ["**/*.{ts,tsx,js,jsx,html,css,scss,sass,less}"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "build/**",
        ".git/**",
        "coverage/**",
      ],
      respectGitignore: true,
      parsing: {
        maxFileSize: 1048576, // 1MB
        chunkSize: 100,
        chunkOverlap: 10,
        parseTests: true,
        parseNodeModules: false,
      },
      styleGuides: {
        autoDetect: true,
        paths: ["STYLE_GUIDE.md", "docs/style-guide.md", "ARCHITECTURE.md"],
        parseMarkdown: true,
      },
      documentation: {
        autoDetect: true,
        includeReadmes: true,
        includeChangelogs: false,
      },
      embedding: {
        provider: "transformers",
        model: "Xenova/bge-base-en-v1.5",
        batchSize: 100,
      },
      skipEmbedding: false,
      storage: {
        provider: "lancedb",
        path: "./codebase-index",
      },
    };

    return {
      ...defaultConfig,
      ...userConfig,
      analyzers: { ...defaultConfig.analyzers, ...userConfig?.analyzers },
      parsing: { ...defaultConfig.parsing, ...userConfig?.parsing },
      styleGuides: { ...defaultConfig.styleGuides, ...userConfig?.styleGuides },
      documentation: {
        ...defaultConfig.documentation,
        ...userConfig?.documentation,
      },
      embedding: { ...defaultConfig.embedding, ...userConfig?.embedding },
      storage: { ...defaultConfig.storage, ...userConfig?.storage },
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
        unknown: 0,
      },
      errors: [],
      startedAt: new Date(),
    };

    try {
      // Phase 1: Scanning
      this.updateProgress("scanning", 0);
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

      // Phase 2: Analyzing & Parsing
      this.updateProgress("analyzing", 0);
      const allChunks: CodeChunk[] = [];
      const libraryTracker = new LibraryUsageTracker();
      const patternDetector = new PatternDetector();
      const importGraph = new ImportGraph();
      const internalFileGraph = new InternalFileGraph(this.rootPath);

      // Fetch git commit dates for pattern momentum analysis
      const fileDates = await getFileCommitDates(this.rootPath);

      // Create a lowercased map for case-insensitive fallback on Windows
      const lowercasedFileDates = new Map<string, Date>();
      for (const [filepath, date] of fileDates.entries()) {
        lowercasedFileDates.set(filepath.toLowerCase(), date);
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.progress.currentFile = file;
        this.progress.filesProcessed = i + 1;
        this.progress.percentage = Math.round(((i + 1) / files.length) * 100);

        try {
          // Normalize line endings to \n for consistent cross-platform output
          const rawContent = await fs.readFile(file, "utf-8");
          const content = rawContent.replace(/\r\n/g, "\n");
          const result = await analyzerRegistry.analyzeFile(file, content);

          if (result) {
            allChunks.push(...result.chunks);
            stats.indexedFiles++;
            stats.totalLines += content.split("\n").length;

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
              const fileExports: FileExport[] = result.exports.map(exp => ({
                name: exp.name,
                type: exp.isDefault ? 'default' : (exp.type as FileExport['type']) || 'other',
              }));
              internalFileGraph.trackExports(file, fileExports);
            }

            // Detect generic patterns from code
            patternDetector.detectFromCode(content, file);

            // Helper to extract code snippet around a pattern
            const extractSnippet = (pattern: RegExp, linesBefore = 1, linesAfter = 3): string | undefined => {
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
            // Try strict match first, then case-insensitive fallback
            const normalizedRelPath = path.relative(this.rootPath, file).replace(/\\/g, '/');
            let fileDate = fileDates.get(normalizedRelPath);

            if (!fileDate) {
              fileDate = lowercasedFileDates.get(normalizedRelPath.toLowerCase());
            }

            // GENERIC PATTERN FORWARDING
            // Framework analyzers return detectedPatterns in metadata - we just forward them
            // This keeps the indexer framework-agnostic
            if (result.metadata?.detectedPatterns) {
              for (const pattern of result.metadata.detectedPatterns) {
                // Try to extract a relevant snippet for the pattern
                const snippetPattern = this.getSnippetPatternFor(pattern.category, pattern.name);
                const snippet = snippetPattern ? extractSnippet(snippetPattern) : undefined;
                patternDetector.track(pattern.category, pattern.name,
                  snippet ? { file: relPath, snippet } : undefined, fileDate);
              }
            }

            // Track file for Golden File scoring (framework-agnostic based on patterns)
            const detectedPatterns = result.metadata?.detectedPatterns || [];
            const hasPattern = (category: string, name: string) =>
              detectedPatterns.some((p: { category: string; name: string }) =>
                p.category === category && p.name === name);

            const patternScore = (
              (hasPattern('dependencyInjection', 'inject() function') ? 1 : 0) +
              (hasPattern('stateManagement', 'Signals') ? 1 : 0) +
              (hasPattern('reactivity', 'Computed') ? 1 : 0) +
              (hasPattern('reactivity', 'Effect') ? 1 : 0) +
              (hasPattern('componentStyle', 'Standalone') ? 1 : 0) +
              (hasPattern('componentInputs', 'Signal-based inputs') ? 1 : 0)
            );
            if (patternScore >= 3) {
              patternDetector.trackGoldenFile(relPath, patternScore, {
                inject: hasPattern('dependencyInjection', 'inject() function'),
                signals: hasPattern('stateManagement', 'Signals'),
                computed: hasPattern('reactivity', 'Computed'),
                effect: hasPattern('reactivity', 'Effect'),
                standalone: hasPattern('componentStyle', 'Standalone'),
                signalInputs: hasPattern('componentInputs', 'Signal-based inputs'),
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
            phase: "analyzing",
            timestamp: new Date(),
          });
        }

        if (this.onProgressCallback) {
          this.onProgressCallback(this.progress);
        }
      }

      stats.totalChunks = allChunks.length;
      stats.avgChunkSize =
        allChunks.length > 0
          ? Math.round(
            allChunks.reduce((sum, c) => sum + c.content.length, 0) /
            allChunks.length
          )
          : 0;

      // Memory safety: limit chunks to prevent embedding memory issues
      const MAX_CHUNKS = 5000;
      let chunksToEmbed = allChunks;
      if (allChunks.length > MAX_CHUNKS) {
        console.warn(
          `WARNING: ${allChunks.length} chunks exceed limit. Indexing first ${MAX_CHUNKS} chunks.`
        );
        chunksToEmbed = allChunks.slice(0, MAX_CHUNKS);
      }

      // Phase 3: Embedding
      let chunksWithEmbeddings: CodeChunkWithEmbedding[] = [];

      if (!this.config.skipEmbedding) {
        this.updateProgress("embedding", 50);
        console.error(`Creating embeddings for ${chunksToEmbed.length} chunks...`);

        // Initialize embedding provider
        const embeddingProvider = await getEmbeddingProvider(this.config.embedding);

        // Generate embeddings for all chunks
        const batchSize = this.config.embedding?.batchSize || 32;

        for (let i = 0; i < chunksToEmbed.length; i += batchSize) {
          const batch = chunksToEmbed.slice(i, i + batchSize);
          const texts = batch.map((chunk) => {
            // Create a searchable text representation
            const parts = [chunk.content];
            if (chunk.metadata?.componentName) {
              parts.unshift(`Component: ${chunk.metadata.componentName}`);
            }
            if (chunk.componentType) {
              parts.unshift(`Type: ${chunk.componentType}`);
            }
            return parts.join("\n");
          });

          const embeddings = await embeddingProvider.embedBatch(texts);

          for (let j = 0; j < batch.length; j++) {
            chunksWithEmbeddings.push({
              ...batch[j],
              embedding: embeddings[j],
            });
          }

          // Update progress
          const embeddingProgress =
            50 + Math.round((i / chunksToEmbed.length) * 25);
          this.updateProgress("embedding", embeddingProgress);

          if (
            (i + batchSize) % 100 === 0 ||
            i + batchSize >= chunksToEmbed.length
          ) {
            console.error(
              `Embedded ${Math.min(i + batchSize, chunksToEmbed.length)}/${chunksToEmbed.length
              } chunks`
            );
          }
        }
      } else {
        console.error("Skipping embedding generation (skipEmbedding=true)");
      }

      // Phase 4: Storing
      this.updateProgress("storing", 75);

      if (!this.config.skipEmbedding) {
        console.error(`Storing ${chunksToEmbed.length} chunks...`);

        // Store in LanceDB for vector search
        const storagePath = path.join(this.rootPath, ".codebase-index");
        const storageProvider = await getStorageProvider({ path: storagePath });
        await storageProvider.clear(); // Clear existing index
        await storageProvider.store(chunksWithEmbeddings);
      }

      // Also save JSON for keyword search (Fuse.js) - use chunksToEmbed for consistency
      const indexPath = path.join(this.rootPath, ".codebase-index.json");
      // Write without pretty-printing to save memory
      await fs.writeFile(indexPath, JSON.stringify(chunksToEmbed));

      // Save library usage and pattern stats
      const intelligencePath = path.join(this.rootPath, ".codebase-intelligence.json");
      const libraryStats = libraryTracker.getStats();

      // Extract tsconfig paths for AI to understand import aliases
      let tsconfigPaths: Record<string, string[]> | undefined;
      try {
        const tsconfigPath = path.join(this.rootPath, "tsconfig.json");
        const tsconfigContent = await fs.readFile(tsconfigPath, "utf-8");
        const tsconfig = JSON.parse(tsconfigContent);
        if (tsconfig.compilerOptions?.paths) {
          tsconfigPaths = tsconfig.compilerOptions.paths;
          console.error(`Found ${Object.keys(tsconfigPaths!).length} path aliases in tsconfig.json`);
        }
      } catch (error) {
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
          topUsed: importGraph.getTopUsed(30),
        },
        // Internal file graph for circular dependency and unused export detection
        internalFileGraph: internalFileGraph.toJSON(),
        generatedAt: new Date().toISOString(),
      };
      await fs.writeFile(intelligencePath, JSON.stringify(intelligence, null, 2));

      // Phase 5: Complete
      this.updateProgress("complete", 100);

      stats.duration = Date.now() - startTime;
      stats.completedAt = new Date();

      console.error(`Indexing complete in ${stats.duration}ms`);
      console.error(
        `Indexed ${stats.indexedFiles} files, ${stats.totalChunks} chunks`
      );

      return stats;
    } catch (error) {
      this.progress.phase = "error";
      stats.errors.push({
        filePath: this.rootPath,
        error: error instanceof Error ? error.message : String(error),
        phase: this.progress.phase,
        timestamp: new Date(),
      });
      throw error;
    }
  }

  private async scanFiles(): Promise<string[]> {
    const files: string[] = [];

    // Read .gitignore if respecting it
    let ig: ReturnType<typeof ignore.default> | null = null;
    if (this.config.respectGitignore) {
      try {
        const gitignorePath = path.join(this.rootPath, ".gitignore");
        const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
        ig = ignore.default().add(gitignoreContent);
      } catch (error) {
        // No .gitignore or couldn't read it
      }
    }

    // Scan with glob
    const includePatterns = this.config.include || ["**/*"];
    const excludePatterns = this.config.exclude || [];

    for (const pattern of includePatterns) {
      const matches = await glob(pattern, {
        cwd: this.rootPath,
        absolute: true,
        ignore: excludePatterns,
        nodir: true,
      });

      for (const file of matches) {
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
        } catch (error) {
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
    // Try to use the most specific analyzer for metadata detection
    const primaryAnalyzer = analyzerRegistry.getAll()[0]; // Highest priority

    let metadata: CodebaseMetadata;
    if (primaryAnalyzer) {
      metadata = await primaryAnalyzer.detectCodebaseMetadata(this.rootPath);
    } else {
      // Fallback metadata
      metadata = {
        name: path.basename(this.rootPath),
        rootPath: this.rootPath,
        languages: [],
        dependencies: [],
        architecture: {
          type: "mixed",
          layers: {
            presentation: 0,
            business: 0,
            data: 0,
            state: 0,
            core: 0,
            shared: 0,
            feature: 0,
            infrastructure: 0,
            unknown: 0,
          },
          patterns: [],
        },
        styleGuides: [],
        documentation: [],
        projectStructure: {
          type: "single-app",
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
            unknown: 0,
          },
        },
        customMetadata: {},
      };
    }

    // Load intelligence data if available
    try {
      const intelligencePath = path.join(this.rootPath, ".codebase-intelligence.json");
      const intelligenceContent = await fs.readFile(intelligencePath, "utf-8");
      const intelligence = JSON.parse(intelligenceContent);

      metadata.customMetadata = {
        ...metadata.customMetadata,
        libraryUsage: intelligence.libraryUsage,
        patterns: intelligence.patterns,
        intelligenceGeneratedAt: intelligence.generatedAt,
      };
    } catch (error) {
      // Intelligence file doesn't exist yet (indexing not run)
    }

    return metadata;
  }

  /**
   * Get regex pattern for extracting code snippets based on pattern category and name
   * This maps abstract pattern names to actual code patterns
   */
  private getSnippetPatternFor(category: string, name: string): RegExp | null {
    const patterns: Record<string, Record<string, RegExp>> = {
      dependencyInjection: {
        'inject() function': /\binject\s*[<(]/,
        'Constructor injection': /constructor\s*\(/,
      },
      stateManagement: {
        'RxJS': /BehaviorSubject|ReplaySubject|Subject|Observable/,
        'Signals': /\bsignal\s*[<(]/,
      },
      reactivity: {
        'Effect': /\beffect\s*\(/,
        'Computed': /\bcomputed\s*[<(]/,
      },
      componentStyle: {
        'Standalone': /standalone\s*:\s*true/,
        'NgModule-based': /@(?:Component|Directive|Pipe)\s*\(/,
      },
      componentInputs: {
        'Signal-based inputs': /\binput\s*[<(]/,
        'Decorator-based @Input': /@Input\(\)/,
      },
    };
    return patterns[category]?.[name] || null;
  }

  getProgress(): IndexingProgress {
    return { ...this.progress };
  }
}
