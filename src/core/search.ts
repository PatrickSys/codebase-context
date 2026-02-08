/**
 * Hybrid search combining semantic vector search with keyword matching
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import Fuse from 'fuse.js';
import path from 'path';
import { promises as fs } from 'fs';
import { CodeChunk, SearchResult, SearchFilters } from '../types/index.js';
import { EmbeddingProvider, getEmbeddingProvider } from '../embeddings/index.js';
import { VectorStorageProvider, getStorageProvider } from '../storage/index.js';
import { analyzerRegistry } from './analyzer-registry.js';
import { IndexCorruptedError } from '../errors/index.js';
import { isTestingRelatedQuery } from '../preflight/query-scope.js';
import { assessSearchQuality } from './search-quality.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME
} from '../constants/codebase-context.js';

export interface SearchOptions {
  useSemanticSearch?: boolean;
  useKeywordSearch?: boolean;
  semanticWeight?: number;
  keywordWeight?: number;
  profile?: SearchIntentProfile;
  enableQueryExpansion?: boolean;
  enableLowConfidenceRescue?: boolean;
  candidateFloor?: number;
}

export type SearchIntentProfile = 'explore' | 'edit' | 'refactor' | 'migrate';

interface QueryVariant {
  query: string;
  weight: number;
}

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  useSemanticSearch: true,
  useKeywordSearch: true,
  semanticWeight: 0.7,
  keywordWeight: 0.3,
  profile: 'explore',
  enableQueryExpansion: true,
  enableLowConfidenceRescue: true,
  candidateFloor: 30
};

const QUERY_EXPANSION_HINTS: Array<{ pattern: RegExp; terms: string[] }> = [
  {
    pattern: /\b(auth|authentication|login|signin|sign-in|session|token|oauth)\b/i,
    terms: ['auth', 'login', 'token', 'session', 'guard', 'oauth']
  },
  {
    pattern: /\b(route|routes|routing|router|navigate|navigation|redirect|path)\b/i,
    terms: ['router', 'route', 'navigation', 'redirect', 'path']
  },
  {
    pattern: /\b(config|configuration|configure|setup|register|provider|providers|bootstrap)\b/i,
    terms: ['config', 'setup', 'register', 'provider', 'bootstrap']
  },
  {
    pattern: /\b(role|roles|permission|permissions|authorization|authorisation|access)\b/i,
    terms: ['roles', 'permissions', 'access', 'policy', 'guard']
  },
  {
    pattern: /\b(interceptor|middleware|request|response|http)\b/i,
    terms: ['interceptor', 'middleware', 'http', 'request', 'response']
  },
  {
    pattern: /\b(theme|styles?|styling|palette|color|branding|upload)\b/i,
    terms: ['theme', 'styles', 'palette', 'color', 'branding', 'upload']
  }
];

const QUERY_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'to',
  'of',
  'for',
  'and',
  'or',
  'with',
  'in',
  'on',
  'by',
  'how',
  'are',
  'is',
  'after',
  'before'
]);

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
    this.storagePath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, VECTOR_DB_DIRNAME);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.loadKeywordIndex();
      await this.loadPatternIntelligence();

      this.embeddingProvider = await getEmbeddingProvider();
      this.storageProvider = await getStorageProvider({
        path: this.storagePath
      });

      this.initialized = true;
    } catch (error) {
      if (error instanceof IndexCorruptedError) {
        throw error; // Propagate to handler for auto-heal
      }
      console.warn('Partial initialization (keyword search only):', error);
      this.initialized = true;
    }
  }

  private async loadKeywordIndex(): Promise<void> {
    try {
      const indexPath = path.join(this.rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
      const content = await fs.readFile(indexPath, 'utf-8');
      this.chunks = JSON.parse(content);

      this.fuseIndex = new Fuse(this.chunks, {
        keys: [
          { name: 'content', weight: 0.4 },
          { name: 'metadata.componentName', weight: 0.25 },
          { name: 'filePath', weight: 0.15 },
          { name: 'relativePath', weight: 0.15 },
          { name: 'componentType', weight: 0.15 },
          { name: 'layer', weight: 0.1 },
          { name: 'tags', weight: 0.15 }
        ],
        includeScore: true,
        threshold: 0.4,
        useExtendedSearch: true,
        ignoreLocation: true
      });
    } catch (error) {
      console.warn('Keyword index load failed:', error);
      this.chunks = [];
      this.fuseIndex = null;
    }
  }

  /**
   * v1.2: Load pattern intelligence for trend detection and warnings
   */
  private async loadPatternIntelligence(): Promise<void> {
    try {
      const intelligencePath = path.join(
        this.rootPath,
        CODEBASE_CONTEXT_DIRNAME,
        INTELLIGENCE_FILENAME
      );
      const content = await fs.readFile(intelligencePath, 'utf-8');
      const intelligence = JSON.parse(content);

      const decliningPatterns = new Set<string>();
      const risingPatterns = new Set<string>();
      const patternWarnings = new Map<string, string>();

      // Extract pattern indicators from intelligence data
      if (intelligence.patterns) {
        for (const [_category, data] of Object.entries(intelligence.patterns)) {
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
      console.error(
        `[search] Loaded pattern intelligence: ${decliningPatterns.size} declining, ${risingPatterns.size} rising patterns`
      );
    } catch (error) {
      console.warn(
        'Pattern intelligence load failed (will proceed without trend detection):',
        error
      );
      this.patternIntelligence = null;
    }
  }

  /**
   * v1.2: Detect pattern trend from chunk content
   */
  private detectChunkTrend(chunk: CodeChunk): {
    trend: 'Rising' | 'Stable' | 'Declining' | undefined;
    warning?: string;
  } {
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

  private isTestFile(filePath: string): boolean {
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');
    return (
      normalized.includes('.spec.') ||
      normalized.includes('.test.') ||
      normalized.includes('/e2e/') ||
      normalized.includes('/__tests__/')
    );
  }

  private normalizeQueryTerms(query: string): string[] {
    return query
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((term) => term.length > 2 && !QUERY_STOP_WORDS.has(term));
  }

  private buildQueryVariants(query: string, maxExpansions: number): QueryVariant[] {
    const variants: QueryVariant[] = [{ query, weight: 1 }];
    if (maxExpansions <= 0) return variants;

    const normalized = query.toLowerCase();
    const terms = new Set(this.normalizeQueryTerms(query));

    for (const hint of QUERY_EXPANSION_HINTS) {
      if (!hint.pattern.test(query)) continue;
      for (const term of hint.terms) {
        if (!normalized.includes(term)) {
          terms.add(term);
        }
      }
    }

    const addedTerms = Array.from(terms).filter((term) => !normalized.includes(term));
    if (addedTerms.length === 0) return variants;

    const firstExpansion = `${query} ${addedTerms.slice(0, 6).join(' ')}`.trim();
    if (firstExpansion !== query) {
      variants.push({ query: firstExpansion, weight: 0.35 });
    }

    if (maxExpansions > 1 && addedTerms.length > 6) {
      const secondExpansion = `${query} ${addedTerms.slice(6, 12).join(' ')}`.trim();
      if (secondExpansion !== query) {
        variants.push({ query: secondExpansion, weight: 0.25 });
      }
    }

    return variants.slice(0, 1 + maxExpansions);
  }

  private isCompositionRootFile(filePath: string): boolean {
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');
    const base = path.basename(normalized);

    if (/^(main|index|bootstrap|startup)\./.test(base)) return true;

    return (
      normalized.includes('/routes') ||
      normalized.includes('/routing') ||
      normalized.includes('/router') ||
      normalized.includes('/config') ||
      normalized.includes('/providers')
    );
  }

  private queryPathTokenOverlap(filePath: string, query: string): number {
    const queryTerms = new Set(this.normalizeQueryTerms(query));
    if (queryTerms.size === 0) return 0;

    const pathTerms = this.normalizeQueryTerms(filePath.replace(/\\/g, '/'));
    return pathTerms.reduce((count, term) => (queryTerms.has(term) ? count + 1 : count), 0);
  }

  private isLikelyWiringOrFlowQuery(query: string): boolean {
    return /\b(route|router|routing|navigate|navigation|redirect|auth|authentication|login|provider|register|config|configuration|interceptor|middleware)\b/i.test(
      query
    );
  }

  private isActionOrHowQuery(query: string): boolean {
    return /\b(how|where|configure|configured|setup|register|wire|wiring|navigate|redirect|login|authenticate|copy|upload|handle|create|update|delete)\b/i.test(
      query
    );
  }

  private isDefinitionHeavyResult(chunk: CodeChunk): boolean {
    const normalizedPath = chunk.filePath.toLowerCase().replace(/\\/g, '/');
    const componentType = (chunk.componentType || '').toLowerCase();

    if (['type', 'interface', 'enum', 'constant'].includes(componentType)) return true;

    return (
      normalizedPath.includes('/models/') ||
      normalizedPath.includes('/interfaces/') ||
      normalizedPath.includes('/types/') ||
      normalizedPath.includes('/constants')
    );
  }

  private scoreAndSortResults(
    query: string,
    limit: number,
    results: Map<string, { chunk: CodeChunk; scores: number[] }>,
    profile: SearchIntentProfile
  ): SearchResult[] {
    const likelyWiringQuery = this.isLikelyWiringOrFlowQuery(query);
    const actionQuery = this.isActionOrHowQuery(query);

    return Array.from(results.entries())
      .map(([_id, { chunk, scores }]) => {
        // Calculate base combined score
        let combinedScore = scores.reduce((sum, score) => sum + score, 0);

        // Normalize to 0-1 range (scores are already weighted)
        // If both semantic and keyword matched, max possible is ~1.0
        combinedScore = Math.min(1.0, combinedScore);

        // Slight boost when analyzer identified a concrete component type
        if (chunk.componentType && chunk.componentType !== 'unknown') {
          combinedScore = Math.min(1.0, combinedScore * 1.1);
        }

        // Boost if layer is detected
        if (chunk.layer && chunk.layer !== 'unknown') {
          combinedScore = Math.min(1.0, combinedScore * 1.1);
        }

        // Query-aware reranking to reduce noisy matches in practical workflows.
        if (!isTestingRelatedQuery(query) && this.isTestFile(chunk.filePath)) {
          combinedScore = combinedScore * 0.75;
        }

        if (actionQuery && this.isDefinitionHeavyResult(chunk)) {
          combinedScore = combinedScore * 0.82;
        }

        if (
          actionQuery &&
          ['service', 'component', 'interceptor', 'guard', 'module', 'resolver'].includes(
            (chunk.componentType || '').toLowerCase()
          )
        ) {
          combinedScore = Math.min(1.0, combinedScore * 1.06);
        }

        // Light intent-aware boost for likely wiring/configuration queries.
        if (likelyWiringQuery && profile !== 'explore') {
          if (this.isCompositionRootFile(chunk.filePath)) {
            combinedScore = Math.min(1.0, combinedScore * 1.12);
          }
        }

        const pathOverlap = this.queryPathTokenOverlap(chunk.filePath, query);
        if (pathOverlap >= 2) {
          combinedScore = Math.min(1.0, combinedScore * 1.08);
        }

        // v1.2: Detect pattern trend and apply momentum boost
        const { trend, warning } = this.detectChunkTrend(chunk);
        if (trend === 'Rising') {
          combinedScore = Math.min(1.0, combinedScore * 1.15); // +15% for modern patterns
        } else if (trend === 'Declining') {
          combinedScore = combinedScore * 0.9; // -10% for legacy patterns
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
          patternWarning: warning
        } as SearchResult;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private pickBetterResultSet(
    query: string,
    primary: SearchResult[],
    rescue: SearchResult[]
  ): SearchResult[] {
    const primaryQuality = assessSearchQuality(query, primary);
    const rescueQuality = assessSearchQuality(query, rescue);

    if (
      rescueQuality.status === 'ok' &&
      primaryQuality.status === 'low_confidence' &&
      rescueQuality.confidence >= primaryQuality.confidence
    ) {
      return rescue;
    }

    if (rescueQuality.confidence >= primaryQuality.confidence + 0.05) {
      return rescue;
    }

    return primary;
  }

  private async collectHybridMatches(
    queryVariants: QueryVariant[],
    candidateLimit: number,
    filters: SearchFilters | undefined,
    useSemanticSearch: boolean,
    useKeywordSearch: boolean,
    semanticWeight: number,
    keywordWeight: number
  ): Promise<Map<string, { chunk: CodeChunk; scores: number[] }>> {
    const results: Map<string, { chunk: CodeChunk; scores: number[] }> = new Map();

    if (useSemanticSearch && this.embeddingProvider && this.storageProvider) {
      try {
        for (const variant of queryVariants) {
          const vectorResults = await this.semanticSearch(variant.query, candidateLimit, filters);

          vectorResults.forEach((result) => {
            const id = result.chunk.id;
            const weightedScore = result.score * semanticWeight * variant.weight;
            const existing = results.get(id);

            if (existing) {
              existing.scores.push(weightedScore);
            } else {
              results.set(id, {
                chunk: result.chunk,
                scores: [weightedScore]
              });
            }
          });
        }
      } catch (error) {
        if (error instanceof IndexCorruptedError) {
          throw error; // Propagate to handler for auto-heal
        }
        console.warn('Semantic search failed:', error);
      }
    }

    if (useKeywordSearch && this.fuseIndex) {
      try {
        for (const variant of queryVariants) {
          const keywordResults = await this.keywordSearch(variant.query, candidateLimit, filters);

          keywordResults.forEach((result) => {
            const id = result.chunk.id;
            const weightedScore = result.score * keywordWeight * variant.weight;
            const existing = results.get(id);

            if (existing) {
              existing.scores.push(weightedScore);
            } else {
              results.set(id, {
                chunk: result.chunk,
                scores: [weightedScore]
              });
            }
          });
        }
      } catch (error) {
        console.warn('Keyword search failed:', error);
      }
    }

    return results;
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
      profile,
      enableQueryExpansion,
      enableLowConfidenceRescue,
      candidateFloor
    } = {
      ...DEFAULT_SEARCH_OPTIONS,
      ...options
    };

    const candidateLimit = Math.max(limit * 2, candidateFloor || 30);
    const primaryVariants = this.buildQueryVariants(query, enableQueryExpansion ? 1 : 0);

    const primaryMatches = await this.collectHybridMatches(
      primaryVariants,
      candidateLimit,
      filters,
      Boolean(useSemanticSearch),
      Boolean(useKeywordSearch),
      semanticWeight || 0.7,
      keywordWeight || 0.3
    );

    const primaryResults = this.scoreAndSortResults(
      query,
      limit,
      primaryMatches,
      (profile || 'explore') as SearchIntentProfile
    );

    if (!enableLowConfidenceRescue) {
      return primaryResults;
    }

    const primaryQuality = assessSearchQuality(query, primaryResults);
    if (primaryQuality.status !== 'low_confidence') {
      return primaryResults;
    }

    const rescueVariants = this.buildQueryVariants(query, 2).slice(1);
    if (rescueVariants.length === 0) {
      return primaryResults;
    }

    const rescueMatches = await this.collectHybridMatches(
      rescueVariants.map((variant, index) => ({
        query: variant.query,
        weight: index === 0 ? 1 : 0.8
      })),
      candidateLimit,
      filters,
      Boolean(useSemanticSearch),
      Boolean(useKeywordSearch),
      semanticWeight || 0.7,
      keywordWeight || 0.3
    );

    const rescueResults = this.scoreAndSortResults(
      query,
      limit,
      rescueMatches,
      (profile || 'explore') as SearchIntentProfile
    );

    return this.pickBetterResultSet(query, primaryResults, rescueResults);
  }

  private generateSummary(chunk: CodeChunk): string {
    const analyzer = chunk.framework ? analyzerRegistry.get(chunk.framework) : null;

    if (analyzer && analyzer.summarize) {
      try {
        const summary = analyzer.summarize(chunk);
        // Only use analyzer summary if it's meaningful (not the generic fallback)
        if (summary && !summary.startsWith('Code in ') && !summary.includes(': lines ')) {
          return summary;
        }
      } catch (error) {
        console.warn('Analyzer summary failed:', error);
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
      return `${
        componentType.charAt(0).toUpperCase() + componentType.slice(1)
      } '${name}' in ${fileName}.`;
    } else if (name) {
      return `'${name}' defined in ${fileName}.`;
    } else if (componentType) {
      return `${componentType.charAt(0).toUpperCase() + componentType.slice(1)} in ${fileName}.`;
    }

    // Last resort: describe the file type
    const ext = path.extname(fileName).slice(1);
    const langMap: Record<string, string> = {
      ts: 'TypeScript',
      js: 'JavaScript',
      html: 'HTML template',
      scss: 'SCSS styles',
      css: 'CSS styles',
      json: 'JSON config'
    };
    return `${langMap[ext] || ext.toUpperCase()} in ${fileName}.`;
  }

  private generateSnippet(content: string, maxLines: number = 20): string {
    const lines = content.split('\n');
    if (lines.length <= maxLines) {
      return content;
    }

    const snippet = lines.slice(0, maxLines).join('\n');
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

    const results = await this.storageProvider.search(queryVector, limit, filters);

    return results.map((r) => ({
      chunk: r.chunk,
      score: r.score
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

        if (filters.componentType && chunk.componentType !== filters.componentType) {
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
      const componentName = chunk.metadata?.componentName?.toLowerCase() || '';

      // Exact class name match
      if (componentName && queryLower === componentName) {
        score = Math.min(1.0, score + 0.3);
      }

      // Exact file name match
      if (
        fileName === queryLower ||
        fileName.replace(/\.ts$/, '') === queryLower.replace(/\.ts$/, '')
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
        score
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
    const matchingTags = (chunk.tags || []).filter((tag) => queryLower.includes(tag.toLowerCase()));
    if (matchingTags.length > 0) {
      reasons.push(`tags: ${matchingTags.join(', ')}`);
    }

    return reasons.length > 0 ? reasons.join('; ') : 'content match';
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
