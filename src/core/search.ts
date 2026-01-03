/**
 * Hybrid search combining semantic vector search with keyword matching
 */

import Fuse from "fuse.js";
import path from "path";
import { promises as fs } from "fs";
import { CodeChunk, SearchResult, SearchFilters } from "../types/index.js";
import {
  EmbeddingProvider,
  getEmbeddingProvider,
} from "../embeddings/index.js";
import { VectorStorageProvider, getStorageProvider } from "../storage/index.js";
import { analyzerRegistry } from "./analyzer-registry.js";

export interface SearchOptions {
  useSemanticSearch?: boolean;
  useKeywordSearch?: boolean;
  semanticWeight?: number;
  keywordWeight?: number;
}

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  useSemanticSearch: true,
  useKeywordSearch: true,
  semanticWeight: 0.7,
  keywordWeight: 0.3,
};

/**
 * Thrown when the vector index is corrupted or has a schema mismatch.
 * Callers should catch this and trigger a re-index.
 */
export class IndexCorruptedError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = "IndexCorruptedError";
  }
}

export class CodebaseSearcher {
  private rootPath: string;
  private storagePath: string;

  private fuseIndex: Fuse<CodeChunk> | null = null;
  private chunks: CodeChunk[] = [];

  private embeddingProvider: EmbeddingProvider | null = null;
  private storageProvider: VectorStorageProvider | null = null;

  private initialized = false;

  // v1.2: Pattern intelligence for trend detection
  private patternIntelligence: {
    decliningPatterns: Set<string>;
    risingPatterns: Set<string>;
    patternWarnings: Map<string, string>;
  } | null = null;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.storagePath = path.join(rootPath, ".codebase-index");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.loadKeywordIndex();
      await this.loadPatternIntelligence();

      this.embeddingProvider = await getEmbeddingProvider();
      this.storageProvider = await getStorageProvider({
        path: this.storagePath,
      });

      this.initialized = true;
    } catch (error) {
      console.warn("Partial initialization (keyword search only):", error);
      this.initialized = true;
    }
  }

  private async loadKeywordIndex(): Promise<void> {
    try {
      const indexPath = path.join(this.rootPath, ".codebase-index.json");
      const content = await fs.readFile(indexPath, "utf-8");
      this.chunks = JSON.parse(content);

      this.fuseIndex = new Fuse(this.chunks, {
        keys: [
          { name: "content", weight: 0.4 },
          { name: "metadata.componentName", weight: 0.25 },
          { name: "filePath", weight: 0.15 },
          { name: "relativePath", weight: 0.15 },
          { name: "componentType", weight: 0.15 },
          { name: "layer", weight: 0.1 },
          { name: "tags", weight: 0.15 },
        ],
        includeScore: true,
        threshold: 0.4,
        useExtendedSearch: true,
        ignoreLocation: true,
      });
    } catch (error) {
      console.warn("Keyword index load failed:", error);
      this.chunks = [];
      this.fuseIndex = null;
    }
  }

  /**
   * v1.2: Load pattern intelligence for trend detection and warnings
   */
  private async loadPatternIntelligence(): Promise<void> {
    try {
      const intelligencePath = path.join(this.rootPath, ".codebase-intelligence.json");
      const content = await fs.readFile(intelligencePath, "utf-8");
      const intelligence = JSON.parse(content);

      const decliningPatterns = new Set<string>();
      const risingPatterns = new Set<string>();
      const patternWarnings = new Map<string, string>();

      // Extract pattern indicators from intelligence data
      if (intelligence.patterns) {
        for (const [category, data] of Object.entries(intelligence.patterns)) {
          const patternData = data as any;

          // Track primary pattern
          if (patternData.primary?.trend === 'Rising') {
            risingPatterns.add(patternData.primary.name.toLowerCase());
          }

          // Track declining alternatives
          if (patternData.alsoDetected) {
            for (const alt of patternData.alsoDetected) {
              if (alt.trend === 'Declining') {
                decliningPatterns.add(alt.name.toLowerCase());
                patternWarnings.set(
                  alt.name.toLowerCase(),
                  `⚠️ Uses declining pattern: ${alt.name} (${alt.guidance || 'consider modern alternatives'})`
                );
              } else if (alt.trend === 'Rising') {
                risingPatterns.add(alt.name.toLowerCase());
              }
            }
          }
        }
      }

      this.patternIntelligence = { decliningPatterns, risingPatterns, patternWarnings };
      console.error(`[search] Loaded pattern intelligence: ${decliningPatterns.size} declining, ${risingPatterns.size} rising patterns`);
    } catch (error) {
      console.warn("Pattern intelligence load failed (will proceed without trend detection):", error);
      this.patternIntelligence = null;
    }
  }

  /**
   * v1.2: Detect pattern trend from chunk content
   */
  private detectChunkTrend(chunk: CodeChunk): { trend: 'Rising' | 'Stable' | 'Declining' | undefined; warning?: string } {
    if (!this.patternIntelligence) {
      return { trend: undefined };
    }

    const content = chunk.content.toLowerCase();
    const { decliningPatterns, risingPatterns, patternWarnings } = this.patternIntelligence;

    // Check for declining patterns
    for (const pattern of decliningPatterns) {
      if (content.includes(pattern)) {
        return {
          trend: 'Declining',
          warning: patternWarnings.get(pattern)
        };
      }
    }

    // Check for rising patterns
    for (const pattern of risingPatterns) {
      if (content.includes(pattern)) {
        return { trend: 'Rising' };
      }
    }

    return { trend: 'Stable' };
  }

  async search(
    query: string,
    limit: number = 5,
    filters?: SearchFilters,
    options: SearchOptions = DEFAULT_SEARCH_OPTIONS
  ): Promise<SearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const {
      useSemanticSearch,
      useKeywordSearch,
      semanticWeight,
      keywordWeight,
    } = {
      ...DEFAULT_SEARCH_OPTIONS,
      ...options,
    };

    const results: Map<string, { chunk: CodeChunk; scores: number[] }> =
      new Map();

    if (useSemanticSearch && this.embeddingProvider && this.storageProvider) {
      try {
        const vectorResults = await this.semanticSearch(
          query,
          limit * 2,
          filters
        );

        vectorResults.forEach((result) => {
          const id = result.chunk.id;
          const existing = results.get(id);

          if (existing) {
            existing.scores.push(result.score * (semanticWeight || 0.7));
          } else {
            results.set(id, {
              chunk: result.chunk,
              scores: [result.score * (semanticWeight || 0.7)],
            });
          }
        });
      } catch (error) {
        // Check for critical index failures that require re-indexing
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isCriticalIndexError =
          errorMessage.includes("Table not found") ||
          errorMessage.includes("Schema mismatch") ||
          errorMessage.includes("No vector column") ||
          errorMessage.includes("Column not found") ||
          errorMessage.includes("does not exist");

        if (isCriticalIndexError) {
          // Throw so caller can trigger auto-heal
          throw new IndexCorruptedError(
            `Semantic index corrupted: ${errorMessage}`,
            error
          );
        }

        // Non-critical errors: log and continue with keyword-only search
        console.warn("Semantic search failed (non-critical, falling back to keyword):", error);
      }
    }

    if (useKeywordSearch && this.fuseIndex) {
      try {
        const keywordResults = await this.keywordSearch(
          query,
          limit * 2,
          filters
        );

        keywordResults.forEach((result) => {
          const id = result.chunk.id;
          const existing = results.get(id);

          if (existing) {
            existing.scores.push(result.score * (keywordWeight || 0.3));
          } else {
            results.set(id, {
              chunk: result.chunk,
              scores: [result.score * (keywordWeight || 0.3)],
            });
          }
        });
      } catch (error) {
        console.warn("Keyword search failed:", error);
      }
    }

    const combinedResults: SearchResult[] = Array.from(results.entries())
      .map(([id, { chunk, scores }]) => {
        // Calculate base combined score
        let combinedScore = scores.reduce((sum, score) => sum + score, 0);

        // Normalize to 0-1 range (scores are already weighted)
        // If both semantic and keyword matched, max possible is ~1.0
        combinedScore = Math.min(1.0, combinedScore);

        // Boost scores for Angular components with proper detection
        if (chunk.componentType && chunk.framework === "angular") {
          combinedScore = Math.min(1.0, combinedScore * 1.3);
        }

        // Boost if layer is detected
        if (chunk.layer && chunk.layer !== "unknown") {
          combinedScore = Math.min(1.0, combinedScore * 1.1);
        }

        // v1.2: Detect pattern trend and apply momentum boost
        const { trend, warning } = this.detectChunkTrend(chunk);
        if (trend === 'Rising') {
          combinedScore = Math.min(1.0, combinedScore * 1.15); // +15% for modern patterns
        } else if (trend === 'Declining') {
          combinedScore = combinedScore * 0.90; // -10% for legacy patterns
        }

        const summary = this.generateSummary(chunk);
        const snippet = this.generateSnippet(chunk.content);

        return {
          summary,
          snippet,
          filePath: chunk.filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score: combinedScore,
          relevanceReason: this.generateRelevanceReason(chunk, query),
          language: chunk.language,
          framework: chunk.framework,
          componentType: chunk.componentType,
          layer: chunk.layer,
          metadata: chunk.metadata,
          // v1.2: Pattern momentum awareness
          trend,
          patternWarning: warning,
        } as SearchResult;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return combinedResults;
  }

  private generateSummary(chunk: CodeChunk): string {
    const analyzer = chunk.framework
      ? analyzerRegistry.get(chunk.framework)
      : null;

    if (analyzer && analyzer.summarize) {
      try {
        const summary = analyzer.summarize(chunk);
        // Only use analyzer summary if it's meaningful (not the generic fallback)
        if (
          summary &&
          !summary.startsWith("Code in ") &&
          !summary.includes(": lines ")
        ) {
          return summary;
        }
      } catch (error) {
        console.warn("Analyzer summary failed:", error);
      }
    }

    // Enhanced generic summary
    const fileName = path.basename(chunk.filePath);
    const componentName = chunk.metadata?.componentName;
    const componentType = chunk.componentType;

    // Try to extract a meaningful name from content
    const classMatch = chunk.content.match(
      /(?:export\s+)?(?:class|interface|type|enum|function)\s+(\w+)/
    );
    const name = componentName || (classMatch ? classMatch[1] : null);

    if (name && componentType) {
      return `${componentType.charAt(0).toUpperCase() + componentType.slice(1)
        } '${name}' in ${fileName}.`;
    } else if (name) {
      return `'${name}' defined in ${fileName}.`;
    } else if (componentType) {
      return `${componentType.charAt(0).toUpperCase() + componentType.slice(1)
        } in ${fileName}.`;
    }

    // Last resort: describe the file type
    const ext = path.extname(fileName).slice(1);
    const langMap: Record<string, string> = {
      ts: "TypeScript",
      js: "JavaScript",
      html: "HTML template",
      scss: "SCSS styles",
      css: "CSS styles",
      json: "JSON config",
    };
    return `${langMap[ext] || ext.toUpperCase()} in ${fileName}.`;
  }

  private generateSnippet(content: string, maxLines: number = 100): string {
    const lines = content.split("\n");
    if (lines.length <= maxLines) {
      return content;
    }

    const snippet = lines.slice(0, maxLines).join("\n");
    const remaining = lines.length - maxLines;
    return `${snippet}\n\n... [${remaining} more lines]`;
  }

  private async semanticSearch(
    query: string,
    limit: number,
    filters?: SearchFilters
  ): Promise<{ chunk: CodeChunk; score: number }[]> {
    if (!this.embeddingProvider || !this.storageProvider) {
      return [];
    }

    const queryVector = await this.embeddingProvider.embed(query);

    const results = await this.storageProvider.search(
      queryVector,
      limit,
      filters
    );

    return results.map((r) => ({
      chunk: r.chunk,
      score: r.score,
    }));
  }

  private async keywordSearch(
    query: string,
    limit: number,
    filters?: SearchFilters
  ): Promise<{ chunk: CodeChunk; score: number }[]> {
    if (!this.fuseIndex || this.chunks.length === 0) {
      return [];
    }

    let fuseResults = this.fuseIndex.search(query);

    if (filters) {
      fuseResults = fuseResults.filter((r) => {
        const chunk = r.item;

        if (
          filters.componentType &&
          chunk.componentType !== filters.componentType
        ) {
          return false;
        }
        if (filters.layer && chunk.layer !== filters.layer) {
          return false;
        }
        if (filters.framework && chunk.framework !== filters.framework) {
          return false;
        }
        if (filters.language && chunk.language !== filters.language) {
          return false;
        }
        if (filters.tags && filters.tags.length > 0) {
          const chunkTags = chunk.tags || [];
          if (!filters.tags.some((tag) => chunkTags.includes(tag))) {
            return false;
          }
        }

        return true;
      });
    }

    return fuseResults.slice(0, limit).map((r) => {
      const chunk = r.item;
      let score = 1 - (r.score || 0);

      // Boost exact matches on class name or file path
      const queryLower = query.toLowerCase();
      const fileName = path.basename(chunk.filePath).toLowerCase();
      const relativePathLower = chunk.relativePath.toLowerCase();
      const componentName = chunk.metadata?.componentName?.toLowerCase() || "";

      // Exact class name match
      if (componentName && queryLower === componentName) {
        score = Math.min(1.0, score + 0.3);
      }

      // Exact file name match
      if (
        fileName === queryLower ||
        fileName.replace(/\.ts$/, "") === queryLower.replace(/\.ts$/, "")
      ) {
        score = Math.min(1.0, score + 0.2);
      }

      // File path contains query
      if (
        chunk.filePath.toLowerCase().includes(queryLower) ||
        relativePathLower.includes(queryLower)
      ) {
        score = Math.min(1.0, score + 0.1);
      }

      return {
        chunk,
        score,
      };
    });
  }

  private generateRelevanceReason(chunk: CodeChunk, query: string): string {
    const reasons: string[] = [];

    if (chunk.componentType) {
      reasons.push(`${chunk.componentType}`);
    }

    if (chunk.layer) {
      reasons.push(`${chunk.layer} layer`);
    }

    const queryLower = query.toLowerCase();
    const matchingTags = (chunk.tags || []).filter((tag) =>
      queryLower.includes(tag.toLowerCase())
    );
    if (matchingTags.length > 0) {
      reasons.push(`tags: ${matchingTags.join(", ")}`);
    }

    return reasons.length > 0 ? reasons.join("; ") : "content match";
  }

  async getChunkCount(): Promise<number> {
    if (this.storageProvider) {
      return await this.storageProvider.count();
    }
    return this.chunks.length;
  }

  isReady(): boolean {
    return this.initialized;
  }
}
