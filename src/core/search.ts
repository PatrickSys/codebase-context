import {
  withAvailableIndexSnapshot,
  currentIndexSnapshot,
  resolveIndexArtifact
} from './index-generation.js';
/**
 * Hybrid search combining semantic vector search with keyword matching
 */

import Fuse, { type FuseResult, type IFuseOptions } from 'fuse.js';
import path from 'path';
import { promises as fs } from 'fs';
import { CodeChunk, SearchResult, SearchFilters, IntelligenceData } from '../types/index.js';
import {
  EmbeddingProvider,
  EmbeddingConfig,
  getEmbeddingProvider,
  parseEmbeddingProviderName
} from '../embeddings/index.js';
import { VectorStorageProvider, getStorageProvider } from '../storage/index.js';
import { analyzerRegistry } from './analyzer-registry.js';
import { IndexCorruptedError, OptionalDependencyError } from '../errors/index.js';
import { isTestingRelatedQuery } from '../preflight/query-scope.js';
import { assessSearchQuality } from './search-quality.js';
import { rerank } from './reranker.js';
import { type IndexMeta, readIndexMeta, validateIndexArtifacts } from './index-meta.js';
import { hashFileContent, readReferenceManifest, type FileManifest } from './manifest.js';
import { isPathWithin } from '../utils/project-discovery.js';
import { isSourceBodyWithinInterval } from '../utils/source-interval.js';
import {
  InternalSourceResolver,
  loadTsconfigCompilerOptions
} from '../utils/internal-source-resolver.js';
import type { ImportEdgeDetail } from '../utils/usage-tracker.js';
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

/** Coverage of nominated sources, not a claim that the entire repository was searched. */
export interface SearchSourceCoverage {
  status: 'current' | 'partial' | 'no_fresh_results';
  checkedFiles: number;
  skippedFiles: number;
  candidateBudgetExhausted?: true;
  candidateRetrievalFailed?: true;
  refreshAction?: string;
}

export interface SearchOutcome {
  results: SearchResult[];
  sourceCoverage: SearchSourceCoverage;
}

// Null records ordinary drift/unavailability; integrity failures still throw.
type CheckedSources = Map<string, string[] | null>;

interface SourceValidationContext {
  sources: CheckedSources;
  realRootPath?: Promise<string>;
  candidateBudgetExhausted?: true;
  candidateRetrievalFailed?: true;
}

interface SourceInspectionBudget {
  limit: number;
  inspected: Set<string>;
}

// Reuse the lexical rescue work ceiling for bounded stale-candidate replenishment.
const MAX_CANDIDATE_WORK = 750;

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

// Syntax and question scaffolding are weak evidence after strict keyword
// retrieval fails, so they cannot independently support a rescue match.
const NON_DISCRIMINATIVE_FALLBACK_TERMS = new Set([
  'class',
  'code',
  'const',
  'does',
  'export',
  'file',
  'function',
  'import',
  'return',
  'something',
  'still',
  'thing',
  'value',
  'what',
  'when',
  'where',
  'why'
]);

const KEYWORD_FUSE_OPTIONS: IFuseOptions<CodeChunk> = {
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
};

export class CodebaseSearcher {
  private rootPath: string;
  private storagePath: string;

  private indexMeta: IndexMeta | null = null;

  private fuseIndex: Fuse<CodeChunk> | null = null;
  private chunks: CodeChunk[] = [];

  private embeddingProvider: EmbeddingProvider | null = null;
  private storageProvider: VectorStorageProvider | null = null;

  private initialized = false;
  private sourceManifest: FileManifest | null = null;

  // Pattern intelligence for trend detection
  private patternIntelligence: {
    decliningPatterns: Set<string>;
    risingPatterns: Set<string>;
    patternWarnings: Map<string, string>;
  } | null = null;

  private importCentrality: Map<string, number> | null = null;
  private indexedImports = new Map<string, Map<string, string[]>>();

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.storagePath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, VECTOR_DB_DIRNAME);
  }

  private operationTail: Promise<void> = Promise.resolve();

  private async runOperation<T>(operation: () => Promise<T>): Promise<T> {
    const preceding = this.operationTail;
    let release: () => void = () => undefined;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await preceding;
    try {
      return await withAvailableIndexSnapshot(this.rootPath, async () => {
        const snapshot = currentIndexSnapshot(this.rootPath);
        if (snapshot) this.rootPath = snapshot.realRoot;
        if (snapshot && snapshot.meta.buildId !== this.indexMeta?.buildId) {
          this.initialized = false;
          this.embeddingProvider = null;
          this.storageProvider = null;
          this.chunks = [];
          this.fuseIndex = null;
          this.patternIntelligence = null;
          this.importCentrality = null;
          this.indexedImports.clear();
        }
        if (
          this.initialized &&
          this.indexMeta?.artifacts.vectorDb.embeddingEnabled !== false &&
          !this.storageProvider &&
          this.indexMeta
        ) {
          // Reopening follows the same fail-closed/keyword-fallback policy as first use.
          try {
            await this.initializeSemanticProviders();
          } catch (error) {
            if (error instanceof OptionalDependencyError || error instanceof IndexCorruptedError)
              throw error;
            console.warn('Partial initialization (keyword search only):', error);
          }
        }
        try {
          return await operation();
        } finally {
          const storage = this.storageProvider;
          if (storage?.close) {
            this.storageProvider = null;
            try {
              await storage.close();
            } catch (error) {
              console.warn('Search completed; native handle cleanup failed:', error);
            }
          }
        }
      });
    } finally {
      release();
    }
  }

  async initialize(): Promise<void> {
    return this.runOperation(() => this.initializePinned());
  }

  private async initializePinned(): Promise<void> {
    if (this.initialized) return;

    try {
      // Fail closed on version mismatch/corruption before serving any results.
      this.indexMeta = await readIndexMeta(this.rootPath);
      await validateIndexArtifacts(this.rootPath, this.indexMeta);
      this.storagePath = await resolveIndexArtifact(
        this.rootPath,
        VECTOR_DB_DIRNAME,
        this.indexMeta
      );

      await this.loadKeywordIndex();
      await this.loadSourceManifest();
      await this.loadPatternIntelligence();

      await this.initializeSemanticProviders();

      this.initialized = true;
    } catch (error) {
      if (error instanceof OptionalDependencyError) {
        throw error;
      }
      if (error instanceof IndexCorruptedError) {
        throw error; // Propagate to handler for auto-heal
      }
      console.warn('Partial initialization (keyword search only):', error);
      this.initialized = true;
    }
  }

  private async initializeSemanticProviders(): Promise<void> {
    const stored = this.indexMeta?.artifacts.vectorDb;
    if (!stored || stored.embeddingEnabled === false) return;
    const provider = parseEmbeddingProviderName(stored.embeddingProvider);
    if (stored.embeddingProvider && !provider)
      throw new IndexCorruptedError('Recorded embedding provider is invalid. Rebuild required.');
    const embeddingConfig: Partial<EmbeddingConfig> = provider
      ? { provider, model: stored.embeddingModel }
      : {};
    // Assign the pair only after both are ready. A new model cannot inherit an old
    // query provider when initialization falls back to keyword search.
    const embedding = await getEmbeddingProvider(embeddingConfig);
    const storage = await getStorageProvider(
      { path: this.storagePath },
      { expectExisting: this.chunks.length > 0 }
    );
    this.embeddingProvider = embedding;
    this.storageProvider = storage;
  }

  private getIndexedSourcePath(chunk: CodeChunk): string {
    if (typeof chunk.filePath !== 'string' || !chunk.filePath.trim()) {
      throw new IndexCorruptedError('Indexed source location is invalid. Full rebuild required.');
    }

    const indexedPath = path.resolve(this.rootPath, chunk.filePath);
    if (!isPathWithin(this.rootPath, indexedPath)) {
      throw new IndexCorruptedError(
        'Indexed source belongs to a different project location. Full rebuild required.'
      );
    }

    if (typeof chunk.relativePath === 'string' && chunk.relativePath.trim()) {
      const rawRelativePath = chunk.relativePath.trim();
      if (!path.isAbsolute(rawRelativePath)) {
        const relativeSourcePath = path.resolve(this.rootPath, rawRelativePath);
        if (
          isPathWithin(this.rootPath, relativeSourcePath) &&
          path.relative(relativeSourcePath, indexedPath) !== ''
        ) {
          throw new IndexCorruptedError(
            'Indexed source belongs to a different project location. Full rebuild required.'
          );
        }
      }
    }

    // Some existing analyzers recorded relativePath from process.cwd(). The absolute
    // filePath remains authoritative when it is confined to the selected root.
    return indexedPath;
  }

  private async loadSourceManifest(): Promise<void> {
    if (!this.indexMeta)
      throw new IndexCorruptedError(
        'Source manifest metadata is unavailable. Full rebuild required.'
      );
    const manifest = await readReferenceManifest(this.rootPath, this.indexMeta);

    // Reject copied indexes with foreign absolute source locations before loading models.
    for (const chunk of this.chunks) this.getIndexedSourcePath(chunk);
    this.sourceManifest = manifest;
  }

  private async validateCandidateSources(
    chunks: Iterable<CodeChunk>,
    validation: SourceValidationContext,
    budget?: SourceInspectionBudget
  ): Promise<void> {
    const checkedSources = validation.sources;
    if (!this.sourceManifest) {
      throw new IndexCorruptedError('Source manifest is unavailable. Full rebuild required.');
    }
    const snapshot = currentIndexSnapshot(this.rootPath);
    validation.realRootPath ??= (
      snapshot ? Promise.resolve(snapshot.realRoot) : fs.realpath(this.rootPath)
    ).catch(() => {
      throw new IndexCorruptedError('Selected project is unavailable. Full rebuild required.');
    });
    const realRootPath = await validation.realRootPath;
    for (const chunk of chunks) {
      const sourcePath = this.getIndexedSourcePath(chunk);
      const sourceKey = path.resolve(this.rootPath, chunk.filePath);
      const relativePath = path.relative(this.rootPath, sourcePath).replace(/\\/g, '/');
      const expectedHash = this.sourceManifest.files[relativePath];
      if (typeof expectedHash !== 'string' || !/^[a-f0-9]{16}$/.test(expectedHash)) {
        throw new IndexCorruptedError(
          'Indexed source is absent from its manifest or its hash is invalid. Full rebuild required.'
        );
      }
      this.validateSourceRange(chunk);
      if (!checkedSources.has(sourceKey)) {
        if (budget && budget.inspected.size >= budget.limit) {
          validation.candidateBudgetExhausted = true;
          continue;
        }
        budget?.inspected.add(sourceKey);
        try {
          const realSourcePath = await fs.realpath(sourcePath);
          if (!isPathWithin(realRootPath, realSourcePath)) {
            throw new IndexCorruptedError(
              'Source resolves outside the selected project. Full rebuild required.'
            );
          }
          if (!(await fs.stat(realSourcePath)).isFile()) {
            throw new IndexCorruptedError(
              'Indexed source is not a regular file. Full rebuild required.'
            );
          }
          const content = await fs.readFile(realSourcePath, 'utf-8');
          checkedSources.set(
            sourceKey,
            hashFileContent(content) === expectedHash
              ? content.replace(/\r\n/g, '\n').split('\n')
              : null
          );
        } catch (error) {
          if (error instanceof IndexCorruptedError) throw error;
          // Source reads can fail after a successful stat (delete, permissions, I/O).
          // Preserve other candidates and report incomplete coverage without rebuilding.
          checkedSources.set(sourceKey, null);
        }
      }
      const lines = checkedSources.get(sourceKey);
      if (lines) {
        this.validateSourceRange(chunk, lines);
        // The source read is cached per file; each nominated body still needs
        // its own proof, including siblings sharing the same source lines.
        if (!isSourceBodyWithinInterval(chunk, lines))
          throw new IndexCorruptedError(
            'Indexed chunk body does not match its source interval. Full rebuild required.'
          );
      }
    }
  }

  private async selectCurrentCandidates<T>(
    candidates: Iterable<T>,
    limit: number,
    getChunk: (candidate: T) => CodeChunk,
    validation: SourceValidationContext,
    budget: SourceInspectionBudget = { limit, inspected: new Set() }
  ): Promise<T[]> {
    const current: T[] = [];
    for (const candidate of candidates) {
      if (current.length >= limit) break;
      const chunk = getChunk(candidate);
      await this.validateCandidateSources([chunk], validation, budget);
      const source = validation.sources.get(path.resolve(this.rootPath, chunk.filePath));
      if (source === undefined) break; // Inspection budget ended before this source.
      if (source !== null) current.push(candidate);
    }
    return current;
  }

  private validateSourceRange(
    range: Pick<CodeChunk, 'startLine' | 'endLine'>,
    lines?: string[]
  ): void {
    if (
      !Number.isInteger(range.startLine) ||
      !Number.isInteger(range.endLine) ||
      range.startLine < 1 ||
      range.endLine < range.startLine ||
      (lines !== undefined && range.endLine > lines.length)
    ) {
      throw new IndexCorruptedError('Indexed source line range is invalid. Full rebuild required.');
    }
  }

  private async loadKeywordIndex(): Promise<void> {
    try {
      const indexPath = await resolveIndexArtifact(
        this.rootPath,
        KEYWORD_INDEX_FILENAME,
        this.indexMeta ?? undefined
      );
      const content = await fs.readFile(indexPath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;

      if (Array.isArray(parsed)) {
        throw new IndexCorruptedError(
          'Legacy keyword index format detected (missing header). Rebuild required.'
        );
      }

      const parsedObj = parsed as { chunks?: unknown };
      const chunks =
        parsedObj && typeof parsedObj === 'object' && Array.isArray(parsedObj.chunks)
          ? (parsedObj.chunks as CodeChunk[])
          : null;
      if (!chunks) {
        throw new IndexCorruptedError('Keyword index corrupted: expected { header, chunks }');
      }

      this.chunks = chunks;

      this.fuseIndex = new Fuse(this.chunks, KEYWORD_FUSE_OPTIONS);
    } catch (error) {
      if (error instanceof IndexCorruptedError) {
        throw error;
      }
      throw new IndexCorruptedError(
        `Keyword index load failed (rebuild required): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Load pattern intelligence for trend detection and warnings
   */
  private async loadPatternIntelligence(): Promise<void> {
    this.indexedImports.clear();
    try {
      const intelligencePath = await resolveIndexArtifact(
        this.rootPath,
        INTELLIGENCE_FILENAME,
        this.indexMeta ?? undefined
      );
      const content = await fs.readFile(intelligencePath, 'utf-8');
      const intelligence = JSON.parse(content) as IntelligenceData;

      const decliningPatterns = new Set<string>();
      const risingPatterns = new Set<string>();
      const patternWarnings = new Map<string, string>();

      // Extract pattern indicators from intelligence data
      if (intelligence.patterns) {
        for (const [_category, patternData] of Object.entries(intelligence.patterns)) {
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
                  `WARNING: Uses declining pattern: ${alt.name} (${alt.guidance || 'consider modern alternatives'})`
                );
              } else if (alt.trend === 'Rising') {
                risingPatterns.add(alt.name.toLowerCase());
              }
            }
          }
        }
      }

      this.patternIntelligence = { decliningPatterns, risingPatterns, patternWarnings };
      if (process.env.CODEBASE_CONTEXT_DEBUG) {
        console.error(
          `[search] Loaded pattern intelligence: ${decliningPatterns.size} declining, ${risingPatterns.size} rising patterns`
        );
      }

      this.importCentrality = new Map<string, number>();
      if (intelligence.internalFileGraph && intelligence.internalFileGraph.imports) {
        // Count how many files import each file (in-degree centrality)
        const importCounts = new Map<string, number>();

        const details = intelligence.internalFileGraph.importDetails as
          | Record<string, Record<string, ImportEdgeDetail>>
          | undefined;
        for (const [importingFile, importedFiles] of Object.entries(
          intelligence.internalFileGraph.imports
        )) {
          const imports = importedFiles as string[];
          for (const imported of imports) {
            importCounts.set(imported, (importCounts.get(imported) || 0) + 1);
            const sources = details?.[importingFile]?.[imported]?.sources;
            const sourceHash = this.sourceManifest?.files[importingFile];
            const targetHash = this.sourceManifest?.files[imported];
            if (!sourceHash || !targetHash || !Array.isArray(sources)) continue;
            const witnesses = sources.filter(
              (source) =>
                source.kind === 'import' &&
                source.line > 0 &&
                !!source.specifier &&
                /^[a-f0-9]{64}$/.test(source.sourceFingerprint) &&
                /^[a-f0-9]{64}$/.test(source.targetFingerprint) &&
                source.sourceFingerprint.slice(0, 16) === sourceHash &&
                source.targetFingerprint.slice(0, 16) === targetHash
            );
            if (witnesses.length === 0) continue;
            const key = this.indexedFileKey(importingFile);
            const targets = this.indexedImports.get(key) ?? new Map<string, string[]>();
            targets.set(
              this.indexedFileKey(imported),
              witnesses.map((source) => source.specifier)
            );
            this.indexedImports.set(key, targets);
          }
        }

        // Normalize centrality to 0-1 range
        const maxImports = Math.max(...Array.from(importCounts.values()), 1);
        for (const [file, count] of importCounts) {
          this.importCentrality.set(file, count / maxImports);
        }

        if (process.env.CODEBASE_CONTEXT_DEBUG) {
          console.error(`[search] Computed import centrality for ${importCounts.size} files`);
        }
      }
    } catch (error) {
      console.warn(
        'Pattern intelligence load failed (will proceed without trend detection):',
        error
      );
      this.patternIntelligence = null;
      this.importCentrality = null;
      this.indexedImports.clear();
    }
  }

  /**
   * Detect pattern trend from chunk content
   */
  private detectChunkTrend(chunk: CodeChunk): {
    trend: 'Rising' | 'Stable' | 'Declining' | undefined;
    warning?: string;
  } {
    if (!this.patternIntelligence || chunk.content == null) {
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

  private normalizeLexicalTerm(term: string): string {
    const lower = term.toLowerCase();
    if (lower.length > 5 && lower.endsWith('ies')) {
      return `${lower.slice(0, -3)}y`;
    }
    if (lower.length > 4 && lower.endsWith('s') && !/(ss|us)$/.test(lower)) {
      return lower.slice(0, -1);
    }
    return lower;
  }

  private lexicalWords(text: string): string[] {
    return (
      text
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .match(/[a-zA-Z0-9]+/g) ?? []
    ).map((word) => this.normalizeLexicalTerm(word));
  }

  private lexicalAliases(word: string): string[] {
    // Keep the original word: conservative suffix aliases improve recall but
    // must not erase exact evidence. Query and indexed words use identical rules.
    const aliases = new Set([word]);
    const stem = word.replace(/(?:ed|ing)$/, '');
    if (stem !== word && stem.length >= 4) {
      aliases.add(stem);
      aliases.add(`${stem}e`);
      if (/([b-df-hj-np-tv-z])\1$/.test(stem)) aliases.add(stem.slice(0, -1));
    }
    return [...aliases];
  }

  private lexicalQueryTerms(query: string): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    // An explicit code identifier remains one anchor, governed by the indexed
    // edge proof below. Its component words cannot corroborate that anchor.
    const naturalTerms = query.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (word) =>
      /[a-z][A-Z]|_/.test(word) ? '' : word
    );
    const words = [...new Set(this.lexicalWords(naturalTerms))]
      .filter(
        (term) =>
          term.length >= 4 &&
          !QUERY_STOP_WORDS.has(term) &&
          !NON_DISCRIMINATIVE_FALLBACK_TERMS.has(term)
      )
      .slice(0, 12);
    for (const word of words) {
      const aliases = new Set(this.lexicalAliases(word));
      let key = word;
      // Repeated inflections are one clue, never independent corroboration.
      for (const [existing, values] of groups) {
        if (!values.some((value) => aliases.has(value))) continue;
        key = existing;
        for (const value of values) aliases.add(value);
        groups.delete(existing);
      }
      groups.set(key, [...aliases]);
    }
    return groups;
  }

  private lexicalEvidence(text: string): Set<string> {
    return new Set(this.lexicalWords(text).flatMap((word) => this.lexicalAliases(word)));
  }

  private indexedDeclarationNames(chunk: Pick<CodeChunk, 'metadata'>): string[] {
    return [
      chunk.metadata?.symbolName,
      chunk.metadata?.componentName,
      chunk.metadata?.functionName,
      chunk.metadata?.className
    ]
      .filter((name): name is string => typeof name === 'string')
      .flatMap((name) => name.split('+'));
  }

  private hasExactQueryDeclaration(chunk: Pick<CodeChunk, 'metadata'>, query: string): boolean {
    const identifiers = new Set(
      (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(query.trim())
        ? [query.trim()]
        : (query.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? []).filter((word) => /[a-z][A-Z]|_/.test(word))
      ).map((word) => word.toLowerCase())
    );
    return this.indexedDeclarationNames(chunk).some((name) => identifiers.has(name.toLowerCase()));
  }

  private matchesSearchFilters(chunk: CodeChunk, filters?: SearchFilters): boolean {
    if (!filters) return true;
    if (filters.componentType && chunk.componentType !== filters.componentType) return false;
    if (filters.layer && chunk.layer !== filters.layer) return false;
    if (filters.framework && chunk.framework !== filters.framework) return false;
    if (filters.language && chunk.language !== filters.language) return false;
    if (filters.tags?.length && !filters.tags.some((tag) => chunk.tags?.includes(tag))) {
      return false;
    }
    return true;
  }

  private indexedFileKey(file: string): string {
    const absolute = path.resolve(this.rootPath, file).replace(/\\/g, '/');
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  }

  /**
   * Extended Fuse treats spaces as AND within one chunk. If strict retrieval
   * yields nothing, admit files with multiple lexical clues or an exact symbol
   * whose indexed import edge connects it to a multi-clue companion.
   */
  private async rescueKeywordMatches(
    query: string,
    limit: number,
    filters?: SearchFilters,
    validation: SourceValidationContext = { sources: new Map() },
    sourceBudget?: SourceInspectionBudget,
    retrievedCandidates?: FuseResult<CodeChunk>[]
  ): Promise<FuseResult<CodeChunk>[]> {
    const checkedSources = validation.sources;
    if (!this.fuseIndex || /[|^$!=]/.test(query)) return [];

    const queryTerms = this.lexicalQueryTerms(query);
    const terms = [...queryTerms.keys()];
    if (terms.length < 2) return [];

    const symbolAnchors = (query.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [])
      .filter((term) => /[a-z][A-Z]/.test(term) && term.length >= 8)
      .map((term) => term.toLowerCase());

    const candidateLimit = Math.min(MAX_CANDIDATE_WORK, Math.max(256, limit * 80));
    const budget = sourceBudget ?? { limit: candidateLimit, inspected: new Set<string>() };
    const aliases = [...new Set([...queryTerms.values()].flat())];
    // Invert the existing suffix aliases conservatively: policy/policies share
    // "polic", and archive/archiving share "archiv". These fragments only nominate;
    // the unchanged exact lexical evidence below still decides admission.
    const fragments = [...new Set(aliases.map((alias) => alias.replace(/[ey]$/, '')))];
    const lookupTerms = fragments.filter(
      (fragment) => !fragments.some((other) => other !== fragment && fragment.includes(other))
    );
    // Keep original chunk ordinals, including ties, and nominate across every
    // exact evidence zone. Filters apply before the bounded evidence window.
    const rawCandidates =
      retrievedCandidates ??
      this.chunks.flatMap((item, refIndex): FuseResult<CodeChunk>[] => {
        if (!this.matchesSearchFilters(item, filters)) return [];
        const fields = [
          item.content,
          path.basename(item.relativePath),
          ...this.indexedDeclarationNames(item),
          ...(item.exports ?? [])
        ];
        const matches = fields.some((field) => {
          const text = field.toLowerCase();
          return (
            lookupTerms.some((term) => text.includes(term)) ||
            symbolAnchors.some((anchor) => text.includes(anchor))
          );
        });
        return matches ? [{ item, refIndex, score: 0 }] : [];
      });
    const availableCandidates = rawCandidates.filter(
      ({ item }) => checkedSources.get(path.resolve(this.rootPath, item.filePath)) !== null
    );
    if (availableCandidates.length > candidateLimit) validation.candidateBudgetExhausted = true;
    const candidates = availableCandidates.slice(0, candidateLimit);
    const unavailableBefore = [...checkedSources.values()].filter(
      (source) => source === null
    ).length;

    const queryAliases = new Map(
      terms.map((term) => [term, new Set(queryTerms.get(term)!)] as const)
    );
    const evidence = candidates.map((result) => {
      const { item } = result;
      const bodyWords = this.lexicalWords(item.content);
      const bodyLexemes = new Set<string>();
      const nonBodyLexemes = this.lexicalEvidence(
        [
          item.metadata?.componentName ?? '',
          item.metadata?.symbolName ?? '',
          path.basename(item.relativePath)
        ].join(' ')
      );
      const termFrequencies = new Map<string, number>(terms.map((term) => [term, 0]));
      for (const word of bodyWords) {
        const wordAliases = this.lexicalAliases(word);
        for (const alias of wordAliases) bodyLexemes.add(alias);
        for (const term of terms) {
          if (wordAliases.some((alias) => queryAliases.get(term)!.has(alias))) {
            termFrequencies.set(term, termFrequencies.get(term)! + 1);
          }
        }
      }
      const lexemes = new Set([...bodyLexemes, ...nonBodyLexemes]);
      const matching = new Set(
        terms.filter((term) => queryTerms.get(term)!.some((alias) => lexemes.has(alias)))
      );
      const density =
        terms.reduce((total, term) => total + Math.sqrt(termFrequencies.get(term)!), 0) /
        Math.sqrt(Math.max(1, bodyWords.length));
      // Export names remain useful lexical/graph clues, but can be re-exports;
      // exact definition priority below requires own declaration metadata.
      const indexedSymbols = [...this.indexedDeclarationNames(item), ...(item.exports ?? [])];
      const exactAnchor = symbolAnchors.some((symbol) =>
        indexedSymbols.some(
          (indexedSymbol) =>
            typeof indexedSymbol === 'string' && indexedSymbol.toLowerCase() === symbol
        )
      );
      const declarationLexemes = this.lexicalEvidence(indexedSymbols.filter(Boolean).join(' '));
      const declarationMatching = new Set(
        terms.filter((term) => queryTerms.get(term)!.some((alias) => declarationLexemes.has(alias)))
      );
      return { result, matching, declarationMatching, exactAnchor, density };
    });

    const supportedCompanions = new Map(
      evidence
        .filter(({ matching }) => matching.size >= 2)
        .map(({ result }) => [this.indexedFileKey(result.item.filePath), result.item] as const)
    );
    const anchors = new Map(
      evidence
        .filter(({ exactAnchor }) => exactAnchor)
        .map(({ result }) => [this.indexedFileKey(result.item.filePath), result.item] as const)
    );
    const corroboratedFiles = new Set<string>();
    const corroboratingTargets = new Map<string, Set<string>>();
    const corroboratingSources = new Map<string, CodeChunk>();
    // Visit each anchor's indexed adjacency once; do not rescan all chunks or
    // infer target extensions from source text.
    for (const [key, anchor] of anchors) {
      for (const target of this.indexedImports.get(key)?.keys() ?? []) {
        const companion = supportedCompanions.get(target);
        if (!companion || target === key) continue;
        const targets = corroboratingTargets.get(key) ?? new Set<string>();
        targets.add(target);
        corroboratingTargets.set(key, targets);
        corroboratingSources.set(key, anchor);
        corroboratingSources.set(target, companion);
      }
    }
    // A stale endpoint cannot lend confidence to a current anchor, even when
    // the companion would otherwise fall outside the returned result limit.
    if (corroboratingSources.size > 0) {
      await this.validateCandidateSources(corroboratingSources.values(), validation, budget);
      // Only candidate endpoints enter the resolver. Re-read compiler options for
      // each query: unchanged endpoint bytes do not prove unchanged alias routing.
      const resolver = await InternalSourceResolver.create(
        this.rootPath,
        [...corroboratingSources.values()]
          .filter(
            (chunk) => checkedSources.get(path.resolve(this.rootPath, chunk.filePath)) != null
          )
          .map((chunk) => path.resolve(this.rootPath, chunk.filePath)),
        { compilerOptions: loadTsconfigCompilerOptions(this.rootPath) }
      );
      for (const [key, targets] of corroboratingTargets) {
        const anchor = corroboratingSources.get(key)!;
        if (checkedSources.get(path.resolve(this.rootPath, anchor.filePath)) == null) continue;
        for (const target of targets) {
          const companion = corroboratingSources.get(target)!;
          if (checkedSources.get(path.resolve(this.rootPath, companion.filePath)) == null) continue;
          for (const specifier of this.indexedImports.get(key)?.get(target) ?? []) {
            const current = await resolver.resolve(
              path.resolve(this.rootPath, anchor.filePath),
              specifier
            );
            if (current.status === 'unresolved' && current.reason === 'outside-root') {
              throw new IndexCorruptedError(
                'Import resolves outside the selected project. Full rebuild required.'
              );
            }
            if (
              current.status === 'resolved' &&
              current.path &&
              this.indexedFileKey(current.path) === target
            ) {
              corroboratedFiles.add(key);
              break;
            }
          }
          if (corroboratedFiles.has(key)) break;
        }
      }
    }

    const fileEvidence = new Map<string, Set<string>>();
    for (const { result, matching } of evidence) {
      const key = this.indexedFileKey(result.item.filePath);
      const termsForFile = fileEvidence.get(key) ?? new Set<string>();
      for (const term of matching) termsForFile.add(term);
      fileEvidence.set(key, termsForFile);
    }

    const seenFiles = new Set<string>();
    const nominated = evidence
      .filter(({ result, exactAnchor }) => {
        const key = this.indexedFileKey(result.item.filePath);
        return (
          (exactAnchor && corroboratedFiles.has(key)) || (fileEvidence.get(key)?.size ?? 0) >= 2
        );
      })
      .sort((a, b) => {
        const keyA = this.indexedFileKey(a.result.item.filePath);
        const keyB = this.indexedFileKey(b.result.item.filePath);
        const score = (entry: typeof a, key: string) =>
          ((fileEvidence.get(key)?.size ?? 0) + entry.declarationMatching.size) * 8 +
          entry.matching.size * 3 +
          (entry.exactAnchor ? 8 : 0) -
          (this.isTestFile(entry.result.item.filePath) ? 2 : 0) -
          (entry.result.score ?? 0);
        const primaryDifference = score(b, keyB) - score(a, keyA);
        if (primaryDifference !== 0) return primaryDifference;
        return b.density - a.density || a.result.refIndex - b.result.refIndex;
      })
      .filter(({ result }) => {
        const key = this.indexedFileKey(result.item.filePath);
        if (seenFiles.has(key)) return false;
        seenFiles.add(key);
        return true;
      })
      .map(({ result, declarationMatching }) => ({
        ...result,
        // Equal document zones: distinct source clues nominate the file;
        // indexed declaration clues distinguish its own work from mentions in
        // imports or configuration. This remains bounded to [0, 1].
        score:
          1 -
          ((fileEvidence.get(this.indexedFileKey(result.item.filePath))?.size ?? 0) +
            declarationMatching.size) /
            (terms.length * 2)
      }));
    const current = await this.selectCurrentCandidates(
      nominated,
      limit,
      (result) => result.item,
      validation,
      budget
    );
    const unavailableAfter = [...checkedSources.values()].filter(
      (source) => source === null
    ).length;
    if (
      current.length < limit &&
      unavailableAfter > unavailableBefore &&
      candidates.length === candidateLimit
    ) {
      // Refill the same bounded evidence window after excluding every chunk of
      // a rejected source. Fresh-prefix queries retain the original single pass.
      return this.rescueKeywordMatches(query, limit, filters, validation, budget, rawCandidates);
    }
    return current;
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
        const snippet = this.generateSnippet(chunk.content ?? '');

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
          imports: chunk.imports,
          exports: chunk.exports,
          metadata: chunk.metadata,
          trend,
          patternWarning: warning
        } as SearchResult;
      })
      .sort((a, b) => b.score - a.score);

    // Definition first for explicit identifiers, regardless of which
    // analyzer populated the existing declaration metadata. Coarse component or
    // layer boosts must not move a fuzzy same-suffix mention above that match.
    if (
      intent === 'EXACT_NAME' ||
      scoredResults.some((result) => this.hasExactQueryDeclaration(result, query))
    ) {
      for (const result of scoredResults) {
        if (this.hasExactQueryDeclaration(result, query)) {
          result.score *= 1.15; // +15% boost for definition
        }
      }
      scoredResults.sort(
        (a, b) =>
          Number(this.hasExactQueryDeclaration(b, query)) -
            Number(this.hasExactQueryDeclaration(a, query)) || b.score - a.score
      );
    }

    // File-level deduplication
    const seenFiles = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const result of scoredResults) {
      const normalizedPath = result.filePath.toLowerCase().replace(/\\/g, '/');
      if (seenFiles.has(normalizedPath)) continue;
      seenFiles.add(normalizedPath);
      deduped.push(result);
      if (deduped.length >= limit) break;
    }

    // File-level deduplication above already keeps only one result per file.
    // Keep same-named symbols in different files as distinct search results.
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
        const snippet = this.generateSnippet(bestTestChunk.chunk.content ?? '');

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
          imports: bestTestChunk.chunk.imports,
          exports: bestTestChunk.chunk.exports,
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
    keywordWeight: number,
    validation: SourceValidationContext
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
          const vectorResults = await this.semanticSearch(
            variant.query,
            candidateLimit,
            filters,
            validation
          );

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
          const keywordResults = await this.keywordSearch(
            variant.query,
            candidateLimit,
            filters,
            validation
          );
          // Grounded multi-clue rescue needs its evidence distinction retained
          // through fusion. Single/exact identifier searches keep their existing
          // rank semantics and confidence calibration.
          const weightLexicalEvidence = this.lexicalQueryTerms(variant.query).size >= 2;

          // Assign ranks based on retrieval order (0-indexed)
          keywordResults.forEach((result, index) => {
            const id = result.chunk.id;
            const rank = index; // 0-indexed rank
            const weight =
              keywordWeight * variant.weight * (weightLexicalEvidence ? result.score : 1);
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
        if (error instanceof IndexCorruptedError) {
          throw error; // Preserve the caller's existing auto-heal path.
        }
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
    return (await this.searchWithCoverage(query, limit, filters, options)).results;
  }

  async searchWithCoverage(
    query: string,
    limit: number = 5,
    filters?: SearchFilters,
    options: SearchOptions = DEFAULT_SEARCH_OPTIONS
  ): Promise<SearchOutcome> {
    return this.runOperation(() => this.searchPinned(query, limit, filters, options));
  }

  private async searchPinned(
    query: string,
    limit: number,
    filters: SearchFilters | undefined,
    options: SearchOptions
  ): Promise<SearchOutcome> {
    if (!this.initialized) {
      await this.initializePinned();
    }

    const merged = {
      ...DEFAULT_SEARCH_OPTIONS,
      ...options
    };
    if (this.indexMeta?.artifacts.vectorDb.embeddingEnabled === false) {
      merged.useSemanticSearch = false;
      merged.enableReranker = false;
    }
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

    const validation: SourceValidationContext = { sources: new Map() };
    const checkedSources = validation.sources;
    const primaryMatches = await this.collectHybridMatches(
      primaryVariants,
      candidateLimit,
      filters,
      Boolean(useSemanticSearch),
      Boolean(useKeywordSearch),
      finalSemanticWeight,
      finalKeywordWeight,
      validation
    );

    const keepCurrentMatches = (matches: typeof primaryMatches): void => {
      for (const channel of [matches.semantic, matches.keyword]) {
        for (const [id, { chunk }] of channel) {
          if (checkedSources.get(path.resolve(this.rootPath, chunk.filePath)) == null)
            channel.delete(id);
        }
      }
    };

    // Validate every nominated source before scoring and limiting so stale top
    // matches cannot hide a valid lower-ranked current file.
    await this.validateCandidateSources(
      [...primaryMatches.semantic.values(), ...primaryMatches.keyword.values()].map(
        (match) => match.chunk
      ),
      validation
    );
    keepCurrentMatches(primaryMatches);

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
            finalKeywordWeight,
            validation
          );

          await this.validateCandidateSources(
            [...rescueMatches.semantic.values(), ...rescueMatches.keyword.values()].map(
              (match) => match.chunk
            ),
            validation
          );
          keepCurrentMatches(rescueMatches);

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

    const results = bestResults.map((result) => {
      const lines = checkedSources.get(path.resolve(this.rootPath, result.filePath));
      if (lines == null) {
        throw new IndexCorruptedError('Result source was not validated. Full rebuild required.');
      }
      this.validateSourceRange(result, lines);
      return result;
    });
    const skippedFiles = [...checkedSources.values()].filter((source) => source === null).length;
    return {
      results,
      sourceCoverage: {
        status:
          skippedFiles === 0 &&
          !validation.candidateBudgetExhausted &&
          !validation.candidateRetrievalFailed
            ? 'current'
            : results.length > 0
              ? 'partial'
              : 'no_fresh_results',
        checkedFiles: checkedSources.size,
        skippedFiles,
        ...(validation.candidateBudgetExhausted && { candidateBudgetExhausted: true }),
        ...(validation.candidateRetrievalFailed && { candidateRetrievalFailed: true }),
        ...((skippedFiles > 0 ||
          validation.candidateBudgetExhausted ||
          validation.candidateRetrievalFailed) && {
          refreshAction:
            'Run refresh_index with incrementalOnly=true to refresh changed or unavailable sources, then retry.'
        })
      }
    };
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
    const classMatch = (chunk.content ?? '').match(
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
    filters?: SearchFilters,
    validation: SourceValidationContext = { sources: new Map() }
  ): Promise<{ chunk: CodeChunk; score: number }[]> {
    if (!this.embeddingProvider || !this.storageProvider) {
      return [];
    }

    const queryVector = await this.embeddingProvider.embed(query);

    const budget: SourceInspectionBudget = {
      limit: Math.min(limit, MAX_CANDIDATE_WORK),
      inspected: new Set()
    };
    const retainedCount = this.chunks.length;
    let requested = Math.min(limit, MAX_CANDIDATE_WORK);
    let retrievedWork = 0;
    let retained: Array<{ chunk: CodeChunk; score: number }> | undefined;
    for (;;) {
      const results = await this.storageProvider
        .search(queryVector, requested, filters)
        .catch((error: unknown) => {
          if (error instanceof IndexCorruptedError || retained === undefined) throw error;
          validation.candidateRetrievalFailed = true;
          console.warn('Semantic refill failed; retaining validated current candidates:', error);
          return null;
        });
      if (results === null) return retained ?? [];
      retrievedWork += results.length;
      const current = await this.selectCurrentCandidates(
        results,
        limit,
        (result) => result.chunk,
        validation,
        budget
      );
      retained = current.map(({ chunk, score }) => ({ chunk, score }));
      if (
        current.length >= limit ||
        results.length < requested ||
        (retainedCount > 0 && requested >= retainedCount)
      ) {
        return retained;
      }
      const staleSources = new Set(
        [...validation.sources].filter(([, source]) => source === null).map(([file]) => file)
      );
      if (staleSources.size === 0) {
        if (requested < limit && results.length === requested)
          validation.candidateBudgetExhausted = true;
        return retained;
      }
      const rejectedChunks = this.chunks.filter((chunk) =>
        staleSources.has(path.resolve(this.rootPath, chunk.filePath))
      ).length;
      // Widen by known rejected rows, never by an arbitrary multiplier. Sum of
      // retrieved rows is bounded, and the query vector is reused for all retries.
      const next = Math.min(
        retainedCount || requested,
        limit + rejectedChunks,
        MAX_CANDIDATE_WORK - retrievedWork
      );
      if (next <= requested || budget.inspected.size >= budget.limit) {
        validation.candidateBudgetExhausted = true;
        return retained;
      }
      requested = next;
    }
  }

  private async keywordSearch(
    query: string,
    limit: number,
    filters?: SearchFilters,
    validation: SourceValidationContext = { sources: new Map() }
  ): Promise<{ chunk: CodeChunk; score: number }[]> {
    if (!this.fuseIndex || this.chunks.length === 0) {
      return [];
    }

    let fuseResults = this.fuseIndex.search(query);

    if (filters) {
      fuseResults = fuseResults.filter(({ item }) => this.matchesSearchFilters(item, filters));
    }

    if (fuseResults.length === 0 || (fuseResults[0].score ?? 0) > KEYWORD_FUSE_OPTIONS.threshold!) {
      const rescue = await this.rescueKeywordMatches(query, limit, filters, validation);
      const seen = new Set(rescue.map(({ item }) => item.id));
      fuseResults = [...rescue, ...fuseResults.filter(({ item }) => !seen.has(item.id))].sort(
        (a, b) => (a.score ?? 0) - (b.score ?? 0)
      );
    }
    const current = await this.selectCurrentCandidates(
      fuseResults,
      limit,
      (result) => result.item,
      validation
    );
    return current
      .map((r) => {
        const chunk = r.item;
        let score = 1 - (r.score || 0);

        // Boost exact matches on class name or file path
        const queryLower = query.toLowerCase();
        const fileName = path.basename(chunk.filePath).toLowerCase();
        const relativePathLower = chunk.relativePath.toLowerCase();

        // Use the same analyzer-neutral declaration evidence as final ranking.
        if (this.hasExactQueryDeclaration(chunk, query)) {
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
      })
      .sort(
        (a, b) =>
          Number(this.hasExactQueryDeclaration(b.chunk, query)) -
            Number(this.hasExactQueryDeclaration(a.chunk, query)) || b.score - a.score
      );
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
    return this.runOperation(async () => {
      if (!this.initialized) await this.initializePinned();
      return this.storageProvider ? this.storageProvider.count() : this.chunks.length;
    });
  }

  isReady(): boolean {
    return this.initialized;
  }
}
