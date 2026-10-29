import { hasCommittedIndex } from '../core/index-meta.js';
import { withToolIndexSnapshot } from './index-snapshot.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import type { ToolContext, ToolResponse, DecisionCard } from './types.js';
import { CodebaseSearcher } from '../core/search.js';
import type { SearchIntentProfile, SearchSourceCoverage } from '../core/search.js';
import type {
  SearchResult,
  IntelligenceData,
  PatternsData,
  ChunkMetadata
} from '../types/index.js';
import { buildEvidenceLock } from '../preflight/evidence-lock.js';
import { shouldIncludePatternConflictCategory } from '../preflight/query-scope.js';
import {
  isComplementaryPatternConflict,
  shouldSkipLegacyTestingFrameworkCategory
} from '../patterns/semantics.js';
import { assessSearchQuality } from '../core/search-quality.js';
import { getRerankerStatus } from '../core/reranker.js';
import { IndexCorruptedError } from '../errors/index.js';
import { readMemoriesFile, withConfidence } from '../memory/store.js';
import type { MemoryWithConfidence } from '../memory/store.js';
import { indexHealthByFile, normalizeHealthLookupKey, readHealthFile } from '../health/store.js';
import { InternalFileGraph } from '../utils/usage-tracker.js';
import type { FileExport } from '../utils/usage-tracker.js';
import { RELATIONSHIPS_FILENAME } from '../constants/codebase-context.js';
import { finalizeSearchPayloadText } from './search-payload-budget.js';

// Stop words for compact-mode memory relevance filter (mirrors QUERY_STOP_WORDS in search.ts)
const COMPACT_STOP_WORDS = new Set([
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
  'before',
  'from',
  'that',
  'this',
  'which',
  'what',
  'where',
  'when'
]);

interface RelationshipsData {
  graph?: {
    imports?: Record<string, string[]>;
    importDetails?: Record<string, Record<string, { line?: number; importedSymbols?: string[] }>>;
    importedBy?: Record<string, string[]>;
    exports?: Record<string, FileExport[]>;
  };
  stats?: unknown;
}

export const definition: Tool = {
  name: 'search_codebase',
  description:
    'Search the indexed codebase. Default compact mode returns at most 6 ranked results with ' +
    'light graph context (importedByCount, topExports, layer), a patternSummary, bestExample, ' +
    'nextHops, and response-budget metadata. Use mode="full" for today\'s richer response with ' +
    'full hints arrays and all memories — identical shape as before this parameter existed. ' +
    'IMPORTANT: Pass the intent="edit"|"refactor"|"migrate" to get preflight: edit readiness check with evidence gating.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query'
      },
      mode: {
        type: 'string',
        enum: ['compact', 'full'],
        description:
          'Response mode. compact (default): max 6 results with light graph context, pattern summary, ' +
          "best example, next hops, and budget metadata. full: today's richer shape + budget metadata.",
        default: 'compact'
      },
      intent: {
        type: 'string',
        enum: ['explore', 'edit', 'refactor', 'migrate'],
        description:
          'Optional. Use "edit", "refactor", or "migrate" to get the full preflight card before making changes.'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5)',
        default: 5
      },
      includeSnippets: {
        type: 'boolean',
        description:
          'Include code snippets in results (default: false). Open returned paths with your host file reader; CBC does not expose a file-reading tool.',
        default: false
      },
      filters: {
        type: 'object',
        description: 'Optional filters',
        properties: {
          framework: {
            type: 'string',
            description: 'Filter by framework (angular, react, nextjs, nestjs, vue)'
          },
          language: {
            type: 'string',
            description: 'Filter by programming language'
          },
          componentType: {
            type: 'string',
            description: 'Filter by component type (component, service, directive, etc.)'
          },
          layer: {
            type: 'string',
            description:
              'Filter by architectural layer (presentation, business, data, state, core, shared)'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by tags'
          }
        }
      }
    },
    required: ['query']
  }
};

export async function handle(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  return withToolIndexSnapshot(ctx, (pinned) => handlePinned(args, pinned));
}

async function handlePinned(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const { query, limit, filters, intent, includeSnippets, mode } = args as {
    query?: unknown;
    limit?: number;
    filters?: Record<string, unknown>;
    intent?: string;
    includeSnippets?: boolean;
    mode?: string;
  };
  const queryStr = typeof query === 'string' ? query.trim() : '';

  if (!queryStr) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'error',
              errorCode: 'invalid_params',
              message: "Invalid params: 'query' is required and must be a non-empty string.",
              hint: "Provide a query like 'how are routes configured' or 'AlbumApiService'."
            },
            null,
            2
          )
        }
      ],
      isError: true
    };
  }

  if (ctx.indexState.status === 'indexing' && !(await hasCommittedIndex(ctx.rootPath))) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'indexing',
              message: 'Index build in progress. Check indexing status, then retry.',
              progress: ctx.indexState.indexer?.getProgress()
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (ctx.indexState.status === 'error' && !(await hasCommittedIndex(ctx.rootPath))) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'error',
              message: `Indexing failed: ${ctx.indexState.error}`
            },
            null,
            2
          )
        }
      ]
    };
  }

  const searcher = new CodebaseSearcher(ctx.rootPath);
  let results: SearchResult[];
  let sourceCoverage: SearchSourceCoverage;
  const searchProfile = (
    intent && ['explore', 'edit', 'refactor', 'migrate'].includes(intent) ? intent : 'explore'
  ) as SearchIntentProfile;

  try {
    const outcome = await searcher.searchWithCoverage(queryStr, limit || 5, filters, {
      profile: searchProfile
    });
    results = outcome.results;
    sourceCoverage = outcome.sourceCoverage;
  } catch (error) {
    if (error instanceof IndexCorruptedError) {
      console.error('[Auto-Heal] Index corrupted. Triggering background re-index...');
      void ctx.performIndexing();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'indexing',
                message:
                  'Index is unavailable or not ready. Indexing has started. Check indexing status, then retry.'
              },
              null,
              2
            )
          }
        ]
      };
    }
    throw error;
  }

  if (sourceCoverage.status === 'no_fresh_results') {
    return {
      content: [
        {
          type: 'text',
          text: finalizeSearchPayloadText(
            {
              status: 'no_fresh_results',
              message: sourceCoverage.candidateRetrievalFailed
                ? 'No fresh results in the inspected candidates. Semantic refill failed; retry or refresh the index.'
                : sourceCoverage.candidateBudgetExhausted
                  ? 'No fresh results in the bounded candidate window. Some candidates remain uninspected; refresh the index or narrow the query and retry.'
                  : 'No fresh results: nominated sources changed or could not be read. Refresh the index and retry.',
              sourceCoverage,
              searchQuality: { status: 'low_confidence', confidence: 0 },
              budget: { mode: mode === 'full' ? 'full' : 'compact', resultCount: 0 },
              ...(searchProfile !== 'explore' && {
                preflight: { ready: false, reason: sourceCoverage.refreshAction }
              }),
              results: []
            },
            { mode: mode === 'full' ? 'full' : 'compact', pretty: true, transportAware: true }
          )
        }
      ]
    };
  }

  // Load memories for keyword matching, enriched with confidence
  const allMemories = await readMemoriesFile(ctx.paths.memory);
  const allMemoriesWithConf = withConfidence(allMemories);
  const queryTerms = queryStr.toLowerCase().split(/\s+/).filter(Boolean);
  const queryTermSet = new Set(queryTerms);

  // Load intelligence data for enrichment (all intents, not just preflight)
  let intelligence: IntelligenceData | null = null;
  try {
    const intelligenceContent = await fs.readFile(ctx.paths.intelligence, 'utf-8');
    const parsed = JSON.parse(intelligenceContent) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      intelligence = parsed as IntelligenceData;
    }
  } catch {
    /* graceful degradation — intelligence file may not exist yet */
  }

  // Load relationships sidecar (preferred over intelligence.internalFileGraph)
  let relationships: RelationshipsData | null = null;
  try {
    const relationshipsPath = path.join(
      path.dirname(ctx.paths.intelligence),
      RELATIONSHIPS_FILENAME
    );
    const relationshipsContent = await fs.readFile(relationshipsPath, 'utf-8');
    const parsed = JSON.parse(relationshipsContent) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      relationships = parsed as RelationshipsData;
    }
  } catch {
    /* graceful degradation — relationships sidecar may not exist yet */
  }

  const healthArtifact = await readHealthFile(ctx.paths.health);
  const healthByFile = indexHealthByFile(healthArtifact, ctx.rootPath);

  // Helper to get imports graph from relationships sidecar (preferred) or intelligence
  function getImportsGraph(): Record<string, string[]> | null {
    if (relationships?.graph?.imports) {
      return relationships.graph.imports as Record<string, string[]>;
    }
    if (intelligence?.internalFileGraph?.imports) {
      return intelligence.internalFileGraph.imports as Record<string, string[]>;
    }
    return null;
  }

  type ImportEdgeDetail = { line?: number; importedSymbols?: string[] };
  type ImportDetailsGraph = Record<string, Record<string, ImportEdgeDetail>>;

  function getImportDetailsGraph(): ImportDetailsGraph | null {
    if (relationships?.graph?.importDetails) {
      return relationships.graph.importDetails as ImportDetailsGraph;
    }
    const internalDetails = intelligence?.internalFileGraph?.importDetails;
    if (internalDetails) {
      return internalDetails as ImportDetailsGraph;
    }
    return null;
  }

  function normalizeGraphPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    if (path.isAbsolute(filePath)) {
      const rel = path.relative(ctx.rootPath, filePath).replace(/\\/g, '/');
      if (rel && !rel.startsWith('..')) {
        return rel;
      }
    }
    return normalized.replace(/^\.\//, '');
  }

  function normalizeSymbolName(value: string): string {
    return value.trim().toLowerCase();
  }

  function pathsMatch(a: string, b: string): boolean {
    return a === b || a.endsWith(b) || b.endsWith(a);
  }

  const resultPathSet = new Set(results.map((result) => normalizeGraphPath(result.filePath)));
  const resultSymbolSet = new Set(
    results
      .map((result) => {
        const symbolName = result.metadata?.symbolName;
        return typeof symbolName === 'string' ? normalizeSymbolName(symbolName) : null;
      })
      .filter((value): value is string => value !== null)
  );

  function canonicalRootRelativePath(filePath: string): string | undefined {
    if (!filePath || path.isAbsolute(filePath)) return undefined;
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    if (
      /^[a-z]:/i.test(parts[0]) ||
      parts.some((part) => part === '' || part === '.' || part === '..')
    ) {
      return undefined;
    }
    return normalized;
  }

  function hasGroundedCanonicalExample(candidate: {
    canonicalExample?: { file: string; snippet?: string };
  }): boolean {
    const example = candidate.canonicalExample;
    const examplePath = example && canonicalRootRelativePath(example.file);
    const snippet = example?.snippet;
    if (!examplePath || !snippet?.trim()) return false;

    const matches = results.filter((result) => {
      const resultPath = canonicalRootRelativePath(normalizeGraphPath(result.filePath));
      return resultPath === examplePath;
    });
    return matches.length === 1 && matches[0].snippet.includes(snippet);
  }

  function isPatternInQueryScope(category: string): boolean {
    return shouldIncludePatternConflictCategory(category, queryStr);
  }

  function getMemoryScopeBoost(memory: MemoryWithConfidence): number {
    if (!memory.scope || memory.scope.kind === 'global') return 0;

    const normalizedFile = normalizeGraphPath(memory.scope.file);
    if (memory.scope.kind === 'file') {
      return resultPathSet.has(normalizedFile) ? 3 : 0;
    }

    const symbolMatch =
      resultSymbolSet.has(normalizeSymbolName(memory.scope.symbol)) ||
      queryTermSet.has(normalizeSymbolName(memory.scope.symbol));

    if (resultPathSet.has(normalizedFile) && symbolMatch) return 4;
    if (resultPathSet.has(normalizedFile)) return 2;
    if (symbolMatch) return 1;
    return 0;
  }

  function getMemoryText(memory: MemoryWithConfidence): string {
    return `${memory.memory} ${memory.reason}`.toLowerCase();
  }

  function getMemoryTextMatchCount(memory: MemoryWithConfidence): number {
    const text = getMemoryText(memory);
    return queryTerms.filter((term) => text.includes(term)).length;
  }

  function formatMemoryForOutput(memory: MemoryWithConfidence): string {
    const scopeText =
      !memory.scope || memory.scope.kind === 'global'
        ? ''
        : memory.scope.kind === 'file'
          ? ` [${memory.scope.file}]`
          : ` [${memory.scope.file}#${memory.scope.symbol}]`;
    return `${memory.memory}${scopeText} (${memory.effectiveConfidence})`;
  }

  const relatedMemories = allMemoriesWithConf
    .map((memory) => ({
      memory,
      textMatches: getMemoryTextMatchCount(memory),
      scopeBoost: getMemoryScopeBoost(memory)
    }))
    .filter((entry) => entry.textMatches > 0 || entry.scopeBoost > 0)
    .sort((a, b) => {
      if (b.scopeBoost !== a.scopeBoost) return b.scopeBoost - a.scopeBoost;
      if (b.textMatches !== a.textMatches) return b.textMatches - a.textMatches;
      return b.memory.effectiveConfidence - a.memory.effectiveConfidence;
    })
    .map((entry) => entry.memory);

  function computeIndexConfidence(): 'fresh' | 'aging' | 'stale' {
    let confidence: 'fresh' | 'aging' | 'stale' = 'stale';
    if (intelligence?.generatedAt) {
      const indexAge = Date.now() - new Date(intelligence.generatedAt).getTime();
      const hoursOld = indexAge / (1000 * 60 * 60);
      if (hoursOld < 24) {
        confidence = 'fresh';
      } else if (hoursOld < 168) {
        confidence = 'aging';
      }
    }
    return confidence;
  }

  type ImpactCandidate = { file: string; line?: number; hop: 1 | 2 };

  function findImportDetail(
    details: ImportDetailsGraph | null,
    importer: string,
    imported: string
  ): ImportEdgeDetail | null {
    if (!details) return null;
    const edges = details[importer];
    if (!edges) return null;
    if (edges[imported]) return edges[imported];

    let bestKey: string | null = null;
    for (const depKey of Object.keys(edges)) {
      if (!pathsMatch(depKey, imported)) continue;
      if (!bestKey || depKey.length > bestKey.length) {
        bestKey = depKey;
      }
    }

    return bestKey ? edges[bestKey] : null;
  }

  // Impact breadth estimate from the import graph (used for risk assessment).
  // 2-hop: direct importers (hop 1) + importers of importers (hop 2).
  function computeImpactCandidates(resultPaths: string[]): ImpactCandidate[] {
    const allImports = getImportsGraph();
    if (!allImports) return [];

    const importDetails = getImportDetailsGraph();

    const reverseImportsLocal = new Map<string, string[]>();
    for (const [file, deps] of Object.entries<string[]>(allImports)) {
      for (const dep of deps) {
        if (!reverseImportsLocal.has(dep)) reverseImportsLocal.set(dep, []);
        reverseImportsLocal.get(dep)!.push(file);
      }
    }

    const targets = resultPaths.map((rp) => normalizeGraphPath(rp));

    const candidates = new Map<string, ImpactCandidate>();

    const addCandidate = (file: string, hop: 1 | 2, line?: number): void => {
      const existing = candidates.get(file);
      if (existing) {
        if (existing.hop <= hop) return;
      }
      candidates.set(file, { file, hop, ...(line ? { line } : {}) });
    };

    const collectImporters = (
      target: string
    ): Array<{ importer: string; detail: ImportEdgeDetail | null }> => {
      const matches: Array<{ importer: string; detail: ImportEdgeDetail | null }> = [];
      for (const [dep, importers] of reverseImportsLocal) {
        if (!pathsMatch(dep, target)) continue;
        for (const importer of importers) {
          matches.push({ importer, detail: findImportDetail(importDetails, importer, dep) });
        }
      }
      return matches;
    };

    // Hop 1
    const hop1Files: string[] = [];
    for (const target of targets) {
      for (const { importer, detail } of collectImporters(target)) {
        addCandidate(importer, 1, detail?.line);
      }
    }
    for (const candidate of candidates.values()) {
      if (candidate.hop === 1) hop1Files.push(candidate.file);
    }

    // Hop 2
    for (const mid of hop1Files) {
      for (const { importer, detail } of collectImporters(mid)) {
        addCandidate(importer, 2, detail?.line);
      }
    }

    return Array.from(candidates.values()).slice(0, 20);
  }

  // Build reverse import map: prefer pre-computed relationships.graph.importedBy,
  // fall back to rebuilding from graph.imports for older index formats.
  const reverseImports = new Map<string, string[]>();
  if (relationships?.graph?.importedBy) {
    for (const [dep, importers] of Object.entries<string[]>(relationships.graph.importedBy)) {
      reverseImports.set(dep, importers);
    }
  } else {
    const importsGraph = getImportsGraph();
    if (importsGraph) {
      for (const [file, deps] of Object.entries<string[]>(importsGraph)) {
        for (const dep of deps) {
          if (!reverseImports.has(dep)) reverseImports.set(dep, []);
          reverseImports.get(dep)!.push(file);
        }
      }
    }
  }

  // Build relationship hints with capped arrays ranked by importedByCount
  interface RelationshipHints {
    relationships?: {
      importedByCount?: number;
      hasTests?: boolean;
    };
    hints?: {
      callers?: string[];
      tests?: string[];
    };
  }

  function buildRelationshipHints(result: SearchResult): RelationshipHints {
    const rPath = result.filePath;
    // Graph keys are relative paths with forward slashes; normalize for comparison
    const rPathNorm =
      path.relative(ctx.rootPath, rPath).replace(/\\/g, '/') || rPath.replace(/\\/g, '/');

    // importedBy: files that import this result (reverse lookup), collect with counts
    const importedByMap = new Map<string, number>();
    for (const [dep, importers] of reverseImports) {
      if (dep === rPathNorm || dep.endsWith(rPathNorm) || rPathNorm.endsWith(dep)) {
        for (const importer of importers) {
          importedByMap.set(importer, (importedByMap.get(importer) || 0) + 1);
        }
      }
    }

    // testedIn: heuristic — same basename with .spec/.test extension
    const testedIn: string[] = [];
    const baseName = path.basename(rPathNorm).replace(/\.[^.]+$/, '');
    const localImportsGraph = getImportsGraph();
    if (localImportsGraph) {
      for (const file of Object.keys(localImportsGraph)) {
        const fileBase = path.basename(file);
        if (
          (fileBase.includes('.spec.') || fileBase.includes('.test.')) &&
          fileBase.startsWith(baseName)
        ) {
          testedIn.push(file);
        }
      }
    }

    // Build condensed relationships
    const condensedRel: Record<string, number | boolean> = {};
    if (importedByMap.size > 0) {
      condensedRel.importedByCount = importedByMap.size;
    }
    if (testedIn.length > 0) {
      condensedRel.hasTests = true;
    }

    // Build hints object with capped arrays
    const hintsObj: Record<string, string[]> = {};

    // Rank importers by count descending, cap at 3
    if (importedByMap.size > 0) {
      const sortedCallers = Array.from(importedByMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([file]) => file);
      hintsObj.callers = sortedCallers;
      // NOTE: consumers removed — it was identical to callers (pure token waste)
    }

    // Cap tests at 3
    if (testedIn.length > 0) {
      hintsObj.tests = testedIn.slice(0, 3);
    }

    // Return both condensed and hints (hints only included if non-empty)
    const output: RelationshipHints = {};
    if (Object.keys(condensedRel).length > 0) {
      output.relationships = condensedRel as {
        importedByCount?: number;
        hasTests?: boolean;
      };
    }
    if (Object.keys(hintsObj).length > 0) {
      output.hints = hintsObj as {
        callers?: string[];
        tests?: string[];
      };
    }

    return output;
  }

  // Get the count of files that import a given result (compact mode graph context)
  function getImportedByCount(result: SearchResult): number {
    const rPathNorm = normalizeGraphPath(result.filePath);
    const importers = new Set<string>();
    for (const [dep, imps] of reverseImports) {
      if (dep === rPathNorm || dep.endsWith(rPathNorm) || rPathNorm.endsWith(dep)) {
        for (const imp of imps) importers.add(imp);
      }
    }
    return importers.size;
  }

  // Get up to maxCount named exports for a file from relationships.graph.exports
  function getTopExports(filePath: string, maxCount = 3): string[] {
    if (!relationships?.graph?.exports) return [];
    const normalized = normalizeGraphPath(filePath);
    const fileExports = relationships.graph.exports[normalized];
    if (!Array.isArray(fileExports)) return [];
    return fileExports
      .filter((e) => e.name !== 'default')
      .slice(0, maxCount)
      .map((e) => e.name);
  }

  // Filter memories to only strongly relevant ones for compact mode:
  // ≥2 non-stop-word query term matches AND effectiveConfidence ≥ 0.5
  function filterStrongMemories(
    memories: MemoryWithConfidence[],
    query: string
  ): MemoryWithConfidence[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2 && !COMPACT_STOP_WORDS.has(t));
    if (terms.length === 0) return [];
    return memories
      .filter((m) => {
        const text = getMemoryText(m);
        const matchCount = terms.filter((t) => text.includes(t)).length;
        return (matchCount >= 2 || getMemoryScopeBoost(m) >= 2) && m.effectiveConfidence >= 0.5;
      })
      .slice(0, 2);
  }

  function getResultHealth(
    filePath: string
  ): { level: 'low' | 'medium' | 'high'; reasons?: string[] } | undefined {
    const fileHealth = healthByFile.get(normalizeHealthLookupKey(filePath, ctx.rootPath));
    if (!fileHealth || fileHealth.level === 'low') {
      return undefined;
    }
    return {
      level: fileHealth.level,
      ...(fileHealth.reasons.length > 0 && { reasons: fileHealth.reasons.slice(0, 2) })
    };
  }

  function summarizeResultHealth(
    resultPaths: string[]
  ): { level: 'low' | 'medium' | 'high'; reasons?: string[] } | undefined {
    const matched = resultPaths
      .map((filePath) => healthByFile.get(normalizeHealthLookupKey(filePath, ctx.rootPath)))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (matched.length === 0) {
      return undefined;
    }

    const priority = { high: 3, medium: 2, low: 1 };
    matched.sort((a, b) => {
      if (priority[b.level] !== priority[a.level]) return priority[b.level] - priority[a.level];
      if (b.score !== a.score) return b.score - a.score;
      return a.file.localeCompare(b.file);
    });

    const top = matched[0];
    const reasons = [...top.reasons];
    const sameLevelCount = matched.filter((entry) => entry.level === top.level).length;
    if (sameLevelCount > 1) {
      reasons.push(`${sameLevelCount} result files are marked ${top.level}-risk`);
    }

    return {
      level: top.level,
      ...(reasons.length > 0 && { reasons: reasons.slice(0, 3) })
    };
  }

  // Build a 1-line pattern summary string from intelligence.json patterns (compact mode)
  function buildPatternSummary(): string | undefined {
    const patterns = intelligence?.patterns;
    if (!patterns) return undefined;
    const entries = Object.entries(patterns)
      .filter(([category, data]) =>
        Boolean(
          data.primary &&
          isPatternInQueryScope(category) &&
          hasGroundedCanonicalExample(data.primary)
        )
      )
      .slice(0, 3)
      .map(([, data]) => {
        const p = data.primary!;
        return `${p.name} (${p.frequency}, ${p.trend ?? 'Stable'})`;
      });
    return entries.length > 0 ? entries.join(', ') : undefined;
  }

  // A repository-wide example is not evidence for this query. Recommend it only
  // when search independently returned the same file, preserving result order.
  function getBestExample(topResults: Array<{ filePath: string }>): string | undefined {
    const goldenFiles = intelligence?.goldenFiles;
    if (!goldenFiles?.length || !topResults.length) return undefined;
    const examples = new Map(
      goldenFiles.map((file) => [path.resolve(ctx.rootPath, file.file), file.file])
    );
    for (const result of topResults.slice(0, 5)) {
      const example = examples.get(path.resolve(ctx.rootPath, result.filePath));
      if (example) return example;
    }
    return undefined;
  }

  // Build up to 2 dynamic next-hop suggestions (compact mode)
  function buildNextHops(
    compactResults: SearchResult[],
    sq: { status: string }
  ): Array<{ tool: string; args?: Record<string, string>; why: string }> {
    const hops: Array<{ tool: string; args?: Record<string, string>; why: string }> = [];
    // Only advertise tools this MCP server actually supplies. Source reads belong
    // to the host; returned result paths already identify what to open there.
    if (compactResults.length > 0) {
      const relativeFile = path.relative(ctx.rootPath, compactResults[0].filePath);
      if (
        !path.isAbsolute(relativeFile) &&
        relativeFile !== '..' &&
        !relativeFile.startsWith(`..${path.sep}`)
      ) {
        hops.push({
          tool: 'get_code_relationships',
          args: { file: relativeFile.replace(/\\/g, '/'), direction: 'outgoing' },
          why:
            sq.status === 'low_confidence'
              ? 'Follow current import evidence while continuing source discovery'
              : 'Follow verified imports to related implementation files'
        });
      }
    }
    return hops.slice(0, 2);
  }

  const searchQuality = assessSearchQuality(queryStr, results);

  // Compose preflight card for edit/refactor/migrate intents
  let preflight: DecisionCard | undefined = undefined;
  const preflightIntents = ['edit', 'refactor', 'migrate'];
  if (intent && preflightIntents.includes(intent)) {
    if (!intelligence) {
      preflight = {
        ready: false,
        nextAction: 'Run a full index rebuild to generate pattern intelligence before editing.'
      };
    } else {
      try {
        // --- Avoid / Prefer patterns ---
        const avoidPatternsList: Array<{
          pattern: string;
          category: string;
          adoption: string;
          trend: string;
          guidance?: string;
        }> = [];
        const preferredPatternsList: Array<{
          pattern: string;
          category: string;
          adoption: string;
          trend: string;
          guidance?: string;
          example?: string;
        }> = [];
        const patterns: PatternsData = intelligence.patterns || {};
        for (const [category, data] of Object.entries(patterns)) {
          // Primary pattern = preferred if Rising or Stable
          if (data.primary) {
            const p = data.primary;
            if (
              (p.trend === 'Rising' || p.trend === 'Stable') &&
              isPatternInQueryScope(category) &&
              hasGroundedCanonicalExample(p)
            ) {
              preferredPatternsList.push({
                pattern: p.name,
                category,
                adoption: p.frequency,
                trend: p.trend,
                guidance: p.guidance,
                ...(p.canonicalExample && { example: p.canonicalExample.file })
              });
            }
          }
          // Also-detected patterns that are Declining = avoid
          if (data.alsoDetected) {
            for (const alt of data.alsoDetected) {
              if (
                alt.trend === 'Declining' &&
                isPatternInQueryScope(category) &&
                hasGroundedCanonicalExample(alt)
              ) {
                avoidPatternsList.push({
                  pattern: alt.name,
                  category,
                  adoption: alt.frequency,
                  trend: 'Declining',
                  guidance: alt.guidance
                });
              }
            }
          }
        }

        // --- Impact candidates (files importing the result files) ---
        const resultPaths = results.map((r) => r.filePath);
        const impactCandidates = computeImpactCandidates(resultPaths);

        // Compute impact coverage (callers of result files that appear in results)
        const callerFiles = resultPaths.flatMap((p) => {
          const importers: string[] = [];
          for (const [dep, importerList] of reverseImports) {
            if (dep.endsWith(p) || p.endsWith(dep)) {
              importers.push(...importerList);
            }
          }
          return importers;
        });
        const uniqueCallers = new Set(callerFiles);
        const callersCovered = Array.from(uniqueCallers).filter((f) =>
          resultPaths.some((rp) => f.endsWith(rp) || rp.endsWith(f))
        ).length;
        const callersTotal = uniqueCallers.size;
        const impactCoverage =
          callersTotal > 0 ? { covered: callersCovered, total: callersTotal } : undefined;

        // --- Risk level (based on circular deps + impact breadth) ---
        //TODO: Review this risk level calculation
        let riskLevel: 'low' | 'medium' | 'high' = 'low';
        let cycleCount = 0;
        const graphDataSource = relationships?.graph || intelligence?.internalFileGraph;
        if (graphDataSource) {
          try {
            const graph = InternalFileGraph.fromJSON(
              graphDataSource as {
                imports?: Record<string, string[]>;
                exports?: Record<string, FileExport[]>;
                importDetails?: Record<
                  string,
                  Record<string, { line?: number; importedSymbols?: string[] }>
                >;
              },
              ctx.rootPath
            );
            // Use directory prefixes as scope (not full file paths)
            // findCycles(scope) filters files by startsWith, so a full path would only match itself
            const scopes = new Set(
              resultPaths.map((rp) => {
                const lastSlash = rp.lastIndexOf('/');
                return lastSlash > 0 ? rp.substring(0, lastSlash + 1) : rp;
              })
            );
            for (const scope of scopes) {
              const cycles = graph.findCycles(scope);
              cycleCount += cycles.length;
            }
          } catch {
            // Graph reconstruction failed — skip cycle check
          }
        }
        if (cycleCount > 0 || impactCandidates.length > 10) {
          riskLevel = 'high';
        } else if (impactCandidates.length > 3) {
          riskLevel = 'medium';
        }

        // --- Confidence (index freshness) ---
        // TODO: Review this confidence calculation
        //const confidence = computeIndexConfidence();

        // --- Failure memories (1.5x relevance boost) ---
        const failureWarnings = relatedMemories
          .filter((m) => m.type === 'failure' && !m.stale)
          .map((m) => ({
            memory: m.memory,
            reason: m.reason,
            confidence: m.effectiveConfidence
          }))
          .slice(0, 3);

        const preferredPatternsForOutput = preferredPatternsList.slice(0, 5);
        const avoidPatternsForOutput = avoidPatternsList.slice(0, 5);

        // --- Pattern conflicts (split decisions within categories) ---
        const patternConflicts: Array<{
          category: string;
          primary: { name: string; adoption: string };
          alternative: { name: string; adoption: string };
        }> = [];
        const hasUnitTestFramework = Boolean(patterns.unitTestFramework?.primary);
        for (const [cat, data] of Object.entries(patterns)) {
          if (shouldSkipLegacyTestingFrameworkCategory(cat, patterns)) continue;
          if (!shouldIncludePatternConflictCategory(cat, queryStr)) continue;
          if (!data.primary || !data.alsoDetected?.length) continue;
          if (!hasGroundedCanonicalExample(data.primary)) continue;
          const primaryFreq = parseFloat(data.primary.frequency) || 100;
          if (primaryFreq >= 80) continue;
          for (const alt of data.alsoDetected) {
            if (!hasGroundedCanonicalExample(alt)) continue;
            const altFreq = parseFloat(alt.frequency) || 0;
            if (altFreq >= 20) {
              if (isComplementaryPatternConflict(cat, data.primary.name, alt.name)) continue;
              if (hasUnitTestFramework && cat === 'testingFramework') continue;
              patternConflicts.push({
                category: cat,
                primary: { name: data.primary.name, adoption: data.primary.frequency },
                alternative: { name: alt.name, adoption: alt.frequency }
              });
            }
          }
        }

        const evidenceLock = buildEvidenceLock({
          results,
          preferredPatterns: preferredPatternsForOutput,
          relatedMemories,
          failureWarnings,
          patternConflicts,
          searchQualityStatus: searchQuality.status,
          impactCoverage,
          indexFreshness: computeIndexConfidence()
        });

        // Build clean decision card
        const decisionCard: DecisionCard = {
          ready: evidenceLock.readyToEdit
        };

        // Add nextAction if not ready
        if (!decisionCard.ready && evidenceLock.nextAction) {
          decisionCard.nextAction = evidenceLock.nextAction;
        }

        // Add warnings from failure memories (capped at 3)
        if (failureWarnings.length > 0) {
          decisionCard.warnings = failureWarnings.slice(0, 3).map((w) => w.memory);
        }

        // Surface freshness gap warnings (aging/stale) into the decision card
        const freshnessGaps = (evidenceLock.gaps ?? []).filter(
          (g) => g.includes('aging') || g.includes('stale')
        );
        if (freshnessGaps.length > 0) {
          decisionCard.warnings = [...(decisionCard.warnings ?? []), ...freshnessGaps];
        }

        // Pattern advice is actionable only when search itself did not abstain.
        const suppressPatternAdvice =
          evidenceLock.status === 'block' || searchQuality.status === 'low_confidence';
        const doPatterns = suppressPatternAdvice
          ? []
          : preferredPatternsForOutput.slice(0, 3).map((p) => p.pattern);
        const avoidPatterns = suppressPatternAdvice
          ? []
          : avoidPatternsForOutput.slice(0, 3).map((p) => `${p.pattern} (declining)`);
        if (doPatterns.length > 0 || avoidPatterns.length > 0) {
          decisionCard.patterns = {
            ...(doPatterns.length > 0 && { do: doPatterns }),
            ...(avoidPatterns.length > 0 && { avoid: avoidPatterns })
          };
        }

        // Add bestExample — query-aware via directory overlap against top search results
        const preflightBestExample = getBestExample(results.slice(0, 5));
        if (preflightBestExample) {
          decisionCard.bestExample = preflightBestExample;
        }

        // Add impact (coverage + top 3 files)
        if (impactCoverage || impactCandidates.length > 0) {
          const impactObj: {
            coverage?: string;
            files?: string[];
            details?: Array<{ file: string; line?: number; hop: 1 | 2 }>;
          } = {};
          if (impactCoverage) {
            impactObj.coverage = `${impactCoverage.covered}/${impactCoverage.total} callers in results`;
          }
          if (impactCandidates.length > 0) {
            const top = impactCandidates.slice(0, 3);
            impactObj.files = top.map((candidate) => candidate.file);
            impactObj.details = top;
          }
          if (Object.keys(impactObj).length > 0) {
            decisionCard.impact = impactObj;
          }
        }

        const healthSummary = summarizeResultHealth(resultPaths);
        if (healthSummary) {
          decisionCard.health = healthSummary;
        } else if (riskLevel !== 'low') {
          const reasons: string[] = [];
          if (cycleCount > 0) {
            reasons.push(
              `${cycleCount} circular dependenc${cycleCount === 1 ? 'y' : 'ies'} in the result area`
            );
          }
          if (impactCandidates.length > 3) {
            reasons.push(`${impactCandidates.length} upstream callers may be affected`);
          }
          decisionCard.health = {
            level: riskLevel,
            ...(reasons.length > 0 && { reasons })
          };
        }

        // Add whatWouldHelp from evidenceLock
        if (evidenceLock.whatWouldHelp && evidenceLock.whatWouldHelp.length > 0) {
          decisionCard.whatWouldHelp = evidenceLock.whatWouldHelp;
        }

        // Soft-abstain: block status OR low-confidence search quality signals insufficient
        // evidence for edit guidance. Results are still returned (soft abstain per APPROACH Decision 2).
        if (evidenceLock.status === 'block' || searchQuality.status === 'low_confidence') {
          decisionCard.abstain = true;
        }

        preflight = decisionCard;
      } catch {
        // Preflight construction failed — skip preflight, don't fail the search
      }
    }
  }

  // Discovery returns retrieval quality and source coverage; mutation intents get edit readiness.
  let preflightPayload: { ready: boolean; reason?: string } | Record<string, unknown> | undefined;
  if (preflight) {
    // preflight is already a clean decision card (DecisionCard type)
    preflightPayload = preflight;
  }
  if (sourceCoverage.status === 'partial' && preflightIntents.includes(searchProfile)) {
    preflightPayload = {
      ...preflightPayload,
      ready: false,
      abstain: true,
      reason: sourceCoverage.refreshAction,
      nextAction: sourceCoverage.refreshAction
    };
  }

  // Helper: Build scope header for symbol-aware chunks
  function buildScopeHeader(metadata: ChunkMetadata): string | null {
    // Try symbolPath first (most reliable for AST-based symbols)
    if (metadata?.symbolPath && Array.isArray(metadata.symbolPath)) {
      return metadata.symbolPath.join('.');
    }
    // Fallback: className + functionName
    if (metadata?.className && metadata?.functionName) {
      return `${metadata.className}.${metadata.functionName}`;
    }
    // Class only
    if (metadata?.className) {
      return metadata.className;
    }
    // Function only
    if (metadata?.functionName) {
      return metadata.functionName;
    }
    // component chunk fallback (component or pipe name)
    if (metadata?.componentName) {
      return metadata.componentName;
    }
    return null;
  }

  function formatSnippetFallbackHeader(filePath: string, startLine: number): string {
    const rel = path.relative(ctx.rootPath, filePath).replace(/\\/g, '/');
    const displayPath =
      rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : path.basename(filePath);
    return `${displayPath}:${startLine}`;
  }

  function enrichSnippetWithScope(
    snippet: string | undefined,
    metadata: ChunkMetadata,
    filePath: string,
    startLine: number
  ): string | undefined {
    if (!snippet) return undefined;

    const cleanedSnippet = snippet.replace(/^\r?\n+/, '');
    if (cleanedSnippet.startsWith('//')) {
      return cleanedSnippet;
    }

    const scopeHeader =
      buildScopeHeader(metadata) ?? formatSnippetFallbackHeader(filePath, startLine);
    return `// ${scopeHeader}\n${cleanedSnippet}`;
  }

  const rerankerStatus = getRerankerStatus();
  const searchQualityBlock = {
    status: searchQuality.status,
    confidence: searchQuality.confidence,
    ...(searchQuality.status === 'low_confidence' &&
      searchQuality.nextSteps?.[0] && {
        hint: searchQuality.nextSteps[0]
      }),
    // Surface reranker health so agents know if they're getting degraded results
    ...(rerankerStatus === 'unavailable' && { rerankerStatus: 'unavailable' })
  };

  // Compact mode (default): bounded response with light graph context
  const isCompact = mode !== 'full';

  function buildSignaturePreview(snippet: string | undefined): string | undefined {
    if (!snippet) return undefined;

    const lines = snippet.replace(/^\r?\n+/, '').split('\n');
    const previewTerms = [...new Set(queryTerms.filter((term) => term.length > 3))];
    const strongestMatch = lines
      .map((line, index) => ({
        index,
        matches: previewTerms.filter((term) => line.toLowerCase().includes(term)).length
      }))
      .filter((entry) => entry.matches > 0)
      .sort((a, b) => b.matches - a.matches || a.index - b.index)[0];

    let previewLines = lines.slice(0, 3);
    if (strongestMatch) {
      const windowLength = Math.min(3, lines.length);
      const windowStart = Math.max(
        0,
        Math.min(strongestMatch.index - 1, lines.length - windowLength)
      );
      previewLines = lines.slice(windowStart, windowStart + windowLength);
    }

    return previewLines.join('\n').trim() || undefined;
  }

  if (isCompact) {
    const compactResults = results.slice(0, 6);
    const strongMemories = filterStrongMemories(relatedMemories, queryStr);
    const patternSummary = buildPatternSummary();
    const bestExample = getBestExample(compactResults);
    const nextHops = buildNextHops(compactResults, searchQuality);
    const payloadText = finalizeSearchPayloadText(
      {
        status: 'success',
        ...(sourceCoverage.status === 'partial' && { sourceCoverage }),
        searchQuality: searchQualityBlock,
        budget: { mode: 'compact', resultCount: compactResults.length },
        ...(preflightPayload && { preflight: preflightPayload }),
        ...(patternSummary && { patternSummary }),
        ...(bestExample && { bestExample }),
        ...(nextHops.length > 0 && { nextHops }),
        results: compactResults.map((r) => {
          const importedByCount = getImportedByCount(r);
          const topExports = getTopExports(r.filePath);
          const scope = buildScopeHeader(r.metadata);
          const health = getResultHealth(r.filePath);
          const signaturePreview = buildSignaturePreview(r.snippet);
          return {
            file: `${r.filePath}:${r.startLine}-${r.endLine}`,
            summary: r.summary,
            score: Math.round(r.score * 100) / 100,
            ...(r.relevanceReason && { relevanceReason: r.relevanceReason }),
            ...(r.componentType &&
              r.layer &&
              r.layer !== 'unknown' && { type: `${r.componentType}:${r.layer}` }),
            ...(r.trend && r.trend !== 'Stable' && { trend: r.trend }),
            ...(r.patternWarning && { patternWarning: r.patternWarning }),
            importedByCount,
            ...(topExports.length > 0 && { topExports }),
            ...(r.layer && r.layer !== 'unknown' && { layer: r.layer }),
            // Structural metadata: surface AST intelligence already computed at index time
            ...(r.metadata?.symbolName && { symbol: r.metadata.symbolName }),
            ...(r.metadata?.symbolKind && { symbolKind: r.metadata.symbolKind }),
            ...(scope && { scope }),
            ...(health && { health }),
            ...(signaturePreview && { signaturePreview })
          };
        }),
        ...(strongMemories.length > 0 && {
          relatedMemories: strongMemories.map((m) => formatMemoryForOutput(m))
        })
      },
      { mode: 'compact', pretty: true, transportAware: true }
    );

    return {
      content: [
        {
          type: 'text',
          text: payloadText
        }
      ]
    };
  }

  // Full mode: today's response shape + budget + relevanceReason; consumers removed
  const payloadText = finalizeSearchPayloadText(
    {
      status: 'success',
      ...(sourceCoverage.status === 'partial' && { sourceCoverage }),
      searchQuality: searchQualityBlock,
      budget: { mode: 'full', resultCount: results.length },
      ...(preflightPayload && { preflight: preflightPayload }),
      results: results.map((r) => {
        const relationshipsAndHints = buildRelationshipHints(r);
        const enrichedSnippet = includeSnippets
          ? enrichSnippetWithScope(r.snippet, r.metadata, r.filePath, r.startLine)
          : undefined;
        const scope = buildScopeHeader(r.metadata);
        const health = getResultHealth(r.filePath);
        // Chunk-level imports/exports (top 5 each) + complexity
        const chunkImports = r.imports?.slice(0, 5);
        const chunkExports = r.exports?.slice(0, 5);

        return {
          file: `${r.filePath}:${r.startLine}-${r.endLine}`,
          summary: r.summary,
          score: Math.round(r.score * 100) / 100,
          ...(r.relevanceReason && { relevanceReason: r.relevanceReason }),
          ...(r.componentType &&
            r.layer &&
            r.layer !== 'unknown' && { type: `${r.componentType}:${r.layer}` }),
          ...(r.trend && r.trend !== 'Stable' && { trend: r.trend }),
          ...(r.patternWarning && { patternWarning: r.patternWarning }),
          ...(relationshipsAndHints.relationships && {
            relationships: relationshipsAndHints.relationships
          }),
          ...(relationshipsAndHints.hints && { hints: relationshipsAndHints.hints }),
          ...(enrichedSnippet && { snippet: enrichedSnippet }),
          // Structural metadata
          ...(r.metadata?.symbolName && { symbol: r.metadata.symbolName }),
          ...(r.metadata?.symbolKind && { symbolKind: r.metadata.symbolKind }),
          ...(scope && { scope }),
          ...(chunkImports && chunkImports.length > 0 && { imports: chunkImports }),
          ...(chunkExports && chunkExports.length > 0 && { exports: chunkExports }),
          ...(health && { health }),
          ...(r.metadata?.cyclomaticComplexity && {
            complexity: r.metadata.cyclomaticComplexity
          })
        };
      }),
      totalResults: results.length,
      ...(relatedMemories.length > 0 && {
        relatedMemories: relatedMemories.slice(0, 3).map((m) => formatMemoryForOutput(m))
      })
    },
    { mode: 'full', pretty: true, transportAware: true }
  );

  return {
    content: [
      {
        type: 'text',
        text: payloadText
      }
    ]
  };
}
