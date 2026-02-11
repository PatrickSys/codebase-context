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
import { rerank } from './reranker.js';
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
  /** Enable stage-2 cross-encoder reranking when top scores are ambiguous. Default: true. */
  enableReranker?: boolean;
}

export type SearchIntentProfile = 'explore' | 'edit' | 'refactor' | 'migrate';

type QueryIntent = 'EXACT_NAME' | 'CONCEPTUAL' | 'FLOW' | 'CONFIG' | 'WIRING';

interface QueryVariant {
  query: string;
  weight: number;
}

interface IntentWeights {
  semantic: number;
  keyword: number;
}

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  useSemanticSearch: true,
  useKeywordSearch: true,
  // semanticWeight/keywordWeight intentionally omitted —
  // intent classification provides per-query weights.
  // Callers can still override by passing explicit values.
  profile: 'explore',
  enableQueryExpansion: true,
  enableLowConfidenceRescue: true,
  candidateFloor: 30,
  enableReranker: true
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

  // Pattern intelligence for trend detection
  private patternIntelligence: {
    decliningPatterns: Set<string>;
    risingPatterns: Set<string>;
    patternWarnings: Map<string, string>;
  } | null = null;

  private importCentrality: Map<string, number> | null = null;

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
   * Load pattern intelligence for trend detection and warnings
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

      this.importCentrality = new Map<string, number>();
      if (intelligence.internalFileGraph && intelligence.internalFileGraph.imports) {
        // Count how many files import each file (in-degree centrality)
        const importCounts = new Map<string, number>();

        for (const [_importingFile, importedFiles] of Object.entries(
          intelligence.internalFileGraph.imports
        )) {
          const imports = importedFiles as string[];
          for (const imported of imports) {
            importCounts.set(imported, (importCounts.get(imported) || 0) + 1);
          }
        }

        // Normalize centrality to 0-1 range
        const maxImports = Math.max(...Array.from(importCounts.values()), 1);
        for (const [file, count] of importCounts) {
          this.importCentrality.set(file, count / maxImports);
        }

        console.error(`[search] Computed import centrality for ${importCounts.size} files`);
      }
    } catch (error) {
      console.warn(
        'Pattern intelligence load failed (will proceed without trend detection):',
        error
      );
      this.patternIntelligence = null;
      this.importCentrality = null;
    }
  }

  /**
   * Detect pattern trend from chunk content
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

  /**
   * Classify query intent based on heuristic patterns
   */
  private classifyQueryIntent(query: string): { intent: QueryIntent; weights: IntentWeights } {
    const lowerQuery = query.toLowerCase();

    // EXACT_NAME: Contains PascalCase or camelCase tokens (literal class/component names)
    if (/[A-Z][a-z]+[A-Z]/.test(query) || /[a-z][A-Z]/.test(query)) {
      return {
        intent: 'EXACT_NAME',
        weights: { semantic: 0.4, keyword: 0.6 } // Keyword search dominates for exact names
      };
    }

    // CONFIG: Configuration/setup queries
    const configKeywords = [
      'config',
      'setup',
      'routing',
      'providers',
      'configuration',
      'bootstrap'
    ];
    if (configKeywords.some((kw) => lowerQuery.includes(kw))) {
      return {
        intent: 'CONFIG',
        weights: { semantic: 0.5, keyword: 0.5 } // Balanced
      };
    }

    // WIRING: DI/registration queries
    const wiringKeywords = [
      'provide',
      'inject',
      'dependency',
      'register',
      'wire',
      'bootstrap',
      'module'
    ];
    if (wiringKeywords.some((kw) => lowerQuery.includes(kw))) {
      return {
        intent: 'WIRING',
        weights: { semantic: 0.5, keyword: 0.5 } // Balanced
      };
    }

    // FLOW: Action/navigation queries
    const flowVerbs = [
      'navigate',
      'redirect',
      'route',
      'handle',
      'process',
      'execute',
      'trigger',
      'dispatch'
    ];
    if (flowVerbs.some((verb) => lowerQuery.includes(verb))) {
      return {
        intent: 'FLOW',
        weights: { semantic: 0.6, keyword: 0.4 } // Semantic helps with flow understanding
      };
    }

    // CONCEPTUAL: Natural language without code tokens (default)
    return {
      intent: 'CONCEPTUAL',
      weights: { semantic: 0.7, keyword: 0.3 } // Semantic dominates for concepts
    };
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

  private isTemplateOrStyleFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.html', '.scss', '.css', '.less', '.sass', '.styl'].includes(ext);
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
    results: {
      semantic: Map<string, { chunk: CodeChunk; ranks: Array<{ rank: number; weight: number }> }>;
      keyword: Map<string, { chunk: CodeChunk; ranks: Array<{ rank: number; weight: number }> }>;
    },
    profile: SearchIntentProfile,
    intent: QueryIntent,
    totalVariantWeight: number
  ): SearchResult[] {
    const likelyWiringQuery = this.isLikelyWiringOrFlowQuery(query);
    const actionQuery = this.isActionOrHowQuery(query);

    // RRF: k=60 is the standard parameter (proven robust in Elasticsearch + TOSS paper arXiv:2208.11274)
    const RRF_K = 60;

    // Collect all unique chunks from both retrieval channels
    const allChunks = new Map<string, CodeChunk>();
    const rrfScores = new Map<string, number>();

    // Gather all chunks
    for (const [id, entry] of results.semantic) {
      allChunks.set(id, entry.chunk);
    }
    for (const [id, entry] of results.keyword) {
      if (!allChunks.has(id)) {
        allChunks.set(id, entry.chunk);
      }
    }

    // Calculate RRF scores: RRF(d) = SUM(weight_i / (k + rank_i))
    for (const [id] of allChunks) {
      let rrfScore = 0;

      // Add contributions from semantic ranks
      const semanticEntry = results.semantic.get(id);
      if (semanticEntry) {
        for (const { rank, weight } of semanticEntry.ranks) {
          rrfScore += weight / (RRF_K + rank);
        }
      }

      // Add contributions from keyword ranks
      const keywordEntry = results.keyword.get(id);
      if (keywordEntry) {
        for (const { rank, weight } of keywordEntry.ranks) {
          rrfScore += weight / (RRF_K + rank);
        }
      }

      rrfScores.set(id, rrfScore);
    }

    // Normalize by theoretical maximum (rank-0 in every list), NOT by actual max.
    // Using actual max makes top result always 1.0, breaking quality confidence gating.
    const theoreticalMaxRrf = totalVariantWeight / (RRF_K + 0);
    const maxRrfScore = Math.max(theoreticalMaxRrf, 0.01);

    // Separate test files from implementation files before scoring
    const isNonTestQuery = !isTestingRelatedQuery(query);
    const implementationChunks: Array<[string, CodeChunk]> = [];
    const testChunks: Array<[string, CodeChunk]> = [];

    for (const [id, chunk] of allChunks.entries()) {
      if (this.isTestFile(chunk.filePath)) {
        testChunks.push([id, chunk]);
      } else {
        implementationChunks.push([id, chunk]);
      }
    }

    // For non-test queries: filter test files from candidate pool, keep max 1 test file only if < 3 implementation matches
    const chunksToScore = isNonTestQuery ? implementationChunks : Array.from(allChunks.entries());

    const scoredResults = chunksToScore
      .map(([id, chunk]) => {
        // RRF score normalized to [0,1] range. Boosts below are unclamped
        // to preserve score differentiation — only relative ordering matters.
        let combinedScore = rrfScores.get(id)! / maxRrfScore;

        // Slight boost when analyzer identified a concrete component type
        if (chunk.componentType && chunk.componentType !== 'unknown') {
          combinedScore *= 1.1;
        }

        // Boost if layer is detected
        if (chunk.layer && chunk.layer !== 'unknown') {
          combinedScore *= 1.1;
        }

        if (actionQuery && this.isDefinitionHeavyResult(chunk)) {
          combinedScore *= 0.82;
        }

        if (
          actionQuery &&
          ['service', 'component', 'interceptor', 'guard', 'module', 'resolver'].includes(
            (chunk.componentType || '').toLowerCase()
          )
        ) {
          combinedScore *= 1.06;
        }

        // Demote template/style files for behavioral queries — they describe
        // structure/presentation, not implementation logic.
        if (
          (intent === 'FLOW' || intent === 'WIRING' || actionQuery) &&
          this.isTemplateOrStyleFile(chunk.filePath)
        ) {
          combinedScore *= 0.75;
        }

        // Light intent-aware boost for likely wiring/configuration queries.
        if (likelyWiringQuery && profile !== 'explore') {
          if (this.isCompositionRootFile(chunk.filePath)) {
            combinedScore *= 1.12;
          }
        }

        if (intent === 'FLOW') {
          // Boost service/guard/interceptor files for action/navigation queries
          if (
            ['service', 'guard', 'interceptor', 'middleware'].includes(
              (chunk.componentType || '').toLowerCase()
            )
          ) {
            combinedScore *= 1.15;
          }
        } else if (intent === 'CONFIG') {
          // Boost composition-root files for configuration queries
          if (this.isCompositionRootFile(chunk.filePath)) {
            combinedScore *= 1.2;
          }
        } else if (intent === 'WIRING') {
          // Boost DI/module files for wiring queries
          if (
            ['module', 'provider', 'config'].some((type) =>
              (chunk.componentType || '').toLowerCase().includes(type)
            )
          ) {
            combinedScore *= 1.18;
          }
          if (this.isCompositionRootFile(chunk.filePath)) {
            combinedScore *= 1.22;
          }
        }

        const pathOverlap = this.queryPathTokenOverlap(chunk.filePath, query);
        if (pathOverlap >= 2) {
          combinedScore *= 1.08;
        }

        if (this.importCentrality) {
          const normalizedRoot = this.rootPath.replace(/\\/g, '/').replace(/\/?$/, '/');
          const normalizedPath = chunk.filePath.replace(/\\/g, '/').replace(normalizedRoot, '');
          const centrality = this.importCentrality.get(normalizedPath);
          if (centrality !== undefined && centrality > 0.1) {
            // Boost files with high centrality (many imports)
            const centralityBoost = 1.0 + centrality * 0.15; // Up to +15% for max centrality
            combinedScore *= centralityBoost;
          }
        }

        // Detect pattern trend and apply momentum boost
        const { trend, warning } = this.detectChunkTrend(chunk);
        if (trend === 'Rising') {
          combinedScore *= 1.15; // +15% for modern patterns
        } else if (trend === 'Declining') {
          combinedScore *= 0.9; // -10% for legacy patterns
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
          trend,
          patternWarning: warning
        } as SearchResult;
      })
      .sort((a, b) => b.score - a.score);

    const seenFiles = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const result of scoredResults) {
      const normalizedPath = result.filePath.toLowerCase().replace(/\\/g, '/');
      if (seenFiles.has(normalizedPath)) continue;
      seenFiles.add(normalizedPath);
      deduped.push(result);
      if (deduped.length >= limit) break;
    }
    const finalResults = deduped;

    if (
      isNonTestQuery &&
      finalResults.length < 3 &&
      finalResults.length < limit &&
      testChunks.length > 0
    ) {
      // Find the highest-scoring test file
      const bestTestChunk = testChunks
        .map(([id, chunk]) => ({
          id,
          chunk,
          score: rrfScores.get(id)! / maxRrfScore
        }))
        .sort((a, b) => b.score - a.score)[0];

      if (bestTestChunk) {
        const { trend, warning } = this.detectChunkTrend(bestTestChunk.chunk);
        const summary = this.generateSummary(bestTestChunk.chunk);
        const snippet = this.generateSnippet(bestTestChunk.chunk.content);

        finalResults.push({
          summary,
          snippet,
          filePath: bestTestChunk.chunk.filePath,
          startLine: bestTestChunk.chunk.startLine,
          endLine: bestTestChunk.chunk.endLine,
          score: bestTestChunk.score * 0.5, // Demote below implementation files
          relevanceReason:
            this.generateRelevanceReason(bestTestChunk.chunk, query) + ' (test file)',
          language: bestTestChunk.chunk.language,
          framework: bestTestChunk.chunk.framework,
          componentType: bestTestChunk.chunk.componentType,
          layer: bestTestChunk.chunk.layer,
          metadata: bestTestChunk.chunk.metadata,
          trend,
          patternWarning: warning
        } as SearchResult);
      }
    }

    return finalResults;
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
  ): Promise<{
    semantic: Map<string, { chunk: CodeChunk; ranks: Array<{ rank: number; weight: number }> }>;
    keyword: Map<string, { chunk: CodeChunk; ranks: Array<{ rank: number; weight: number }> }>;
  }> {
    const semanticRanks: Map<
      string,
      { chunk: CodeChunk; ranks: Array<{ rank: number; weight: number }> }
    > = new Map();
    const keywordRanks: Map<
      string,
      { chunk: CodeChunk; ranks: Array<{ rank: number; weight: number }> }
    > = new Map();

    // RRF uses ranks instead of scores for fusion robustness
    if (useSemanticSearch && this.embeddingProvider && this.storageProvider) {
      try {
        for (const variant of queryVariants) {
          const vectorResults = await this.semanticSearch(variant.query, candidateLimit, filters);

          // Assign ranks based on retrieval order (0-indexed)
          vectorResults.forEach((result, index) => {
            const id = result.chunk.id;
            const rank = index; // 0-indexed rank
            const weight = semanticWeight * variant.weight;
            const existing = semanticRanks.get(id);

            if (existing) {
              existing.ranks.push({ rank, weight });
            } else {
              semanticRanks.set(id, {
                chunk: result.chunk,
                ranks: [{ rank, weight }]
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

          // Assign ranks based on retrieval order (0-indexed)
          keywordResults.forEach((result, index) => {
            const id = result.chunk.id;
            const rank = index; // 0-indexed rank
            const weight = keywordWeight * variant.weight;
            const existing = keywordRanks.get(id);

            if (existing) {
              existing.ranks.push({ rank, weight });
            } else {
              keywordRanks.set(id, {
                chunk: result.chunk,
                ranks: [{ rank, weight }]
              });
            }
          });
        }
      } catch (error) {
        console.warn('Keyword search failed:', error);
      }
    }

    return { semantic: semanticRanks, keyword: keywordRanks };
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

    const merged = {
      ...DEFAULT_SEARCH_OPTIONS,
      ...options
    };
    const {
      useSemanticSearch,
      useKeywordSearch,
      profile,
      enableQueryExpansion,
      enableLowConfidenceRescue,
      candidateFloor,
      enableReranker
    } = merged;

    const { intent, weights: intentWeights } = this.classifyQueryIntent(query);
    // Intent weights are the default; caller-supplied weights override them
    const finalSemanticWeight = merged.semanticWeight ?? intentWeights.semantic;
    const finalKeywordWeight = merged.keywordWeight ?? intentWeights.keyword;

    const candidateLimit = Math.max(limit * 2, candidateFloor || 30);
    const primaryVariants = this.buildQueryVariants(query, enableQueryExpansion ? 1 : 0);

    const primaryMatches = await this.collectHybridMatches(
      primaryVariants,
      candidateLimit,
      filters,
      Boolean(useSemanticSearch),
      Boolean(useKeywordSearch),
      finalSemanticWeight,
      finalKeywordWeight
    );

    const primaryTotalWeight =
      primaryVariants.reduce((sum, v) => sum + v.weight, 0) *
      (finalSemanticWeight + finalKeywordWeight);
    const primaryResults = this.scoreAndSortResults(
      query,
      limit,
      primaryMatches,
      (profile || 'explore') as SearchIntentProfile,
      intent,
      primaryTotalWeight
    );

    let bestResults = primaryResults;

    if (enableLowConfidenceRescue) {
      const primaryQuality = assessSearchQuality(query, primaryResults);
      if (primaryQuality.status === 'low_confidence') {
        const rescueVariants = this.buildQueryVariants(query, 2).slice(1);
        if (rescueVariants.length > 0) {
          const rescueMatches = await this.collectHybridMatches(
            rescueVariants.map((variant, index) => ({
              query: variant.query,
              weight: index === 0 ? 1 : 0.8
            })),
            candidateLimit,
            filters,
            Boolean(useSemanticSearch),
            Boolean(useKeywordSearch),
            finalSemanticWeight,
            finalKeywordWeight
          );

          const rescueVariantWeights = rescueVariants.map((_, i) => (i === 0 ? 1 : 0.8));
          const rescueTotalWeight =
            rescueVariantWeights.reduce((sum, w) => sum + w, 0) *
            (finalSemanticWeight + finalKeywordWeight);
          const rescueResults = this.scoreAndSortResults(
            query,
            limit,
            rescueMatches,
            (profile || 'explore') as SearchIntentProfile,
            intent,
            rescueTotalWeight
          );

          bestResults = this.pickBetterResultSet(query, primaryResults, rescueResults);
        }
      }
    }

    // Stage-2: cross-encoder reranking when top scores are ambiguous
    if (enableReranker) {
      try {
        bestResults = await rerank(query, bestResults);
      } catch (error) {
        // Reranker is non-critical — log and return unranked results
        console.warn('[reranker] Failed, returning original order:', error);
      }
    }

    return bestResults;
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
