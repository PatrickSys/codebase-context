import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import type { ToolContext, ToolResponse, DecisionCard } from './types.js';
import { CodebaseSearcher } from '../core/search.js';
import type { SearchIntentProfile } from '../core/search.js';
import type {
  SearchResult,
  IntelligenceData,
  PatternsData,
  IntelligenceGoldenFile,
  ChunkMetadata
} from '../types/index.js';
import { buildEvidenceLock } from '../preflight/evidence-lock.js';
import type { EvidenceLock } from '../preflight/evidence-lock.js';
import { shouldIncludePatternConflictCategory } from '../preflight/query-scope.js';
import {
  isComplementaryPatternConflict,
  shouldSkipLegacyTestingFrameworkCategory
} from '../patterns/semantics.js';
import { assessSearchQuality } from '../core/search-quality.js';
import { IndexCorruptedError } from '../errors/index.js';
import { readMemoriesFile, withConfidence } from '../memory/store.js';
import { InternalFileGraph } from '../utils/usage-tracker.js';
import { RELATIONSHIPS_FILENAME } from '../constants/codebase-context.js';

interface RelationshipsData {
  graph?: {
    imports?: Record<string, string[]>;
    importDetails?: Record<string, Record<string, { line?: number; importedSymbols?: string[] }>>;
  };
  stats?: unknown;
}

export const definition: Tool = {
  name: 'search_codebase',
  description:
    'Search the indexed codebase. Returns ranked results and a searchQuality confidence summary. ' +
    'IMPORTANT: Pass the intent="edit"|"refactor"|"migrate" to get preflight: edit readiness check with evidence gating.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query'
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
          'Include code snippets in results (default: false). If you need code, prefer read_file instead.',
        default: false
      },
      filters: {
        type: 'object',
        description: 'Optional filters',
        properties: {
          framework: {
            type: 'string',
            description: 'Filter by framework (angular, react, vue)'
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
  const { query, limit, filters, intent, includeSnippets } = args as {
    query?: unknown;
    limit?: number;
    filters?: Record<string, unknown>;
    intent?: string;
    includeSnippets?: boolean;
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

  if (ctx.indexState.status === 'indexing') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'indexing',
              message: 'Index is still being built. Retry in a moment.',
              progress: ctx.indexState.indexer?.getProgress()
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (ctx.indexState.status === 'error') {
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
  const searchProfile = (
    intent && ['explore', 'edit', 'refactor', 'migrate'].includes(intent) ? intent : 'explore'
  ) as SearchIntentProfile;

  try {
    results = await searcher.search(queryStr, limit || 5, filters, {
      profile: searchProfile
    });
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
                message: 'Index was corrupt. Rebuild started — retry shortly.'
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

  // Load memories for keyword matching, enriched with confidence
  const allMemories = await readMemoriesFile(ctx.paths.memory);
  const allMemoriesWithConf = withConfidence(allMemories);

  const queryTerms = queryStr.toLowerCase().split(/\s+/).filter(Boolean);
  const relatedMemories = allMemoriesWithConf
    .filter((m) => {
      const searchText = `${m.memory} ${m.reason}`.toLowerCase();
      return queryTerms.some((term: string) => searchText.includes(term));
    })
    .sort((a, b) => b.effectiveConfidence - a.effectiveConfidence);

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

  function pathsMatch(a: string, b: string): boolean {
    return a === b || a.endsWith(b) || b.endsWith(a);
  }

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

  // Build reverse import map from relationships sidecar (preferred) or intelligence graph
  const reverseImports = new Map<string, string[]>();
  const importsGraph = getImportsGraph();
  if (importsGraph) {
    for (const [file, deps] of Object.entries<string[]>(importsGraph)) {
      for (const dep of deps) {
        if (!reverseImports.has(dep)) reverseImports.set(dep, []);
        reverseImports.get(dep)!.push(file);
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
      consumers?: string[];
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
    if (importsGraph) {
      for (const file of Object.keys(importsGraph)) {
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
      hintsObj.consumers = sortedCallers; // Same data, different label
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
        consumers?: string[];
        tests?: string[];
      };
    }

    return output;
  }

  const searchQuality = assessSearchQuality(queryStr, results);

  // Always-on edit preflight (lite): do not require intent and keep payload small.
  let editPreflight:
    | { mode: string; riskLevel: string; confidence: string; evidenceLock: EvidenceLock }
    | undefined = undefined;
  if (intelligence && (!intent || intent === 'explore')) {
    try {
      const resultPaths = results.map((r) => r.filePath);
      const impactCandidates = computeImpactCandidates(resultPaths);

      // Use existing pattern intelligence for evidenceLock scoring, but keep the output payload lite.
      const preferredPatternsForEvidence: Array<{ pattern: string; example?: string }> = [];
      const patterns: PatternsData = intelligence.patterns || {};
      for (const [_, data] of Object.entries(patterns)) {
        if (data.primary) {
          const p = data.primary;
          if (p.trend === 'Rising' || p.trend === 'Stable') {
            preferredPatternsForEvidence.push({
              pattern: p.name,
              ...(p.canonicalExample && { example: p.canonicalExample.file })
            });
          }
        }
      }

      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      if (impactCandidates.length > 10) {
        riskLevel = 'high';
      } else if (impactCandidates.length > 3) {
        riskLevel = 'medium';
      }

      editPreflight = {
        mode: 'lite',
        riskLevel,
        confidence: computeIndexConfidence(),
        evidenceLock: buildEvidenceLock({
          results,
          preferredPatterns: preferredPatternsForEvidence.slice(0, 5),
          relatedMemories,
          failureWarnings: [],
          patternConflicts: [],
          searchQualityStatus: searchQuality.status
        })
      };
    } catch {
      // editPreflight is best-effort - never fail search over it
    }
  }

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
            if (p.trend === 'Rising' || p.trend === 'Stable') {
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
              if (alt.trend === 'Declining') {
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

        // PREF-02: Compute impact coverage (callers of result files that appear in results)
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
        let _riskLevel: 'low' | 'medium' | 'high' = 'low';
        let cycleCount = 0;
        const graphDataSource = relationships?.graph || intelligence?.internalFileGraph;
        if (graphDataSource) {
          try {
            const graph = InternalFileGraph.fromJSON(graphDataSource, ctx.rootPath);
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
          _riskLevel = 'high';
        } else if (impactCandidates.length > 3) {
          _riskLevel = 'medium';
        }

        // --- Golden files (exemplar code) ---
        const goldenFiles = (intelligence.goldenFiles ?? [])
          .slice(0, 3)
          .map((g: IntelligenceGoldenFile) => ({
            file: g.file,
            score: g.score
          }));

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
          const primaryFreq = parseFloat(data.primary.frequency) || 100;
          if (primaryFreq >= 80) continue;
          for (const alt of data.alsoDetected) {
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
          impactCoverage
        });

        // Build clean decision card (PREF-01 to PREF-04)
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

        // Add patterns (do/avoid, capped at 3 each, with adoption %)
        const doPatterns = preferredPatternsForOutput
          .slice(0, 3)
          .map((p) => `${p.pattern} — ${p.adoption ? `${p.adoption} adoption` : ''}`);
        const avoidPatterns = avoidPatternsForOutput
          .slice(0, 3)
          .map((p) => `${p.pattern} — ${p.adoption ? `${p.adoption} adoption` : ''} (declining)`);
        if (doPatterns.length > 0 || avoidPatterns.length > 0) {
          decisionCard.patterns = {
            ...(doPatterns.length > 0 && { do: doPatterns }),
            ...(avoidPatterns.length > 0 && { avoid: avoidPatterns })
          };
        }

        // Add bestExample (top 1 golden file)
        if (goldenFiles.length > 0) {
          decisionCard.bestExample = `${goldenFiles[0].file}`;
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

        // Add whatWouldHelp from evidenceLock
        if (evidenceLock.whatWouldHelp && evidenceLock.whatWouldHelp.length > 0) {
          decisionCard.whatWouldHelp = evidenceLock.whatWouldHelp;
        }

        preflight = decisionCard;
      } catch {
        // Preflight construction failed — skip preflight, don't fail the search
      }
    }
  }

  // For edit/refactor/migrate: return clean decision card.
  // For explore or lite-only: return lightweight { ready, reason }.
  let preflightPayload: { ready: boolean; reason?: string } | Record<string, unknown> | undefined;
  if (preflight) {
    // preflight is already a clean decision card (DecisionCard type)
    preflightPayload = preflight;
  } else if (editPreflight) {
    // Lite preflight for explore intent
    const el = editPreflight.evidenceLock;
    preflightPayload = {
      ready: el?.readyToEdit ?? false,
      ...(el && !el.readyToEdit && el.nextAction && { reason: el.nextAction })
    };
  }

  // Helper: Build scope header for symbol-aware chunks (SEARCH-02)
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

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: 'success',
            searchQuality: {
              status: searchQuality.status,
              confidence: searchQuality.confidence,
              ...(searchQuality.status === 'low_confidence' &&
                searchQuality.nextSteps?.[0] && {
                  hint: searchQuality.nextSteps[0]
                })
            },
            ...(preflightPayload && { preflight: preflightPayload }),
            results: results.map((r) => {
              const relationshipsAndHints = buildRelationshipHints(r);
              const enrichedSnippet = includeSnippets
                ? enrichSnippetWithScope(r.snippet, r.metadata, r.filePath, r.startLine)
                : undefined;

              return {
                file: `${r.filePath}:${r.startLine}-${r.endLine}`,
                summary: r.summary,
                score: Math.round(r.score * 100) / 100,
                ...(r.componentType &&
                  r.layer &&
                  r.layer !== 'unknown' && { type: `${r.componentType}:${r.layer}` }),
                ...(r.trend && r.trend !== 'Stable' && { trend: r.trend }),
                ...(r.patternWarning && { patternWarning: r.patternWarning }),
                ...(relationshipsAndHints.relationships && {
                  relationships: relationshipsAndHints.relationships
                }),
                ...(relationshipsAndHints.hints && { hints: relationshipsAndHints.hints }),
                ...(enrichedSnippet && { snippet: enrichedSnippet })
              };
            }),
            totalResults: results.length,
            ...(relatedMemories.length > 0 && {
              relatedMemories: relatedMemories
                .slice(0, 3)
                .map((m) => `${m.memory} (${m.effectiveConfidence})`)
            })
          },
          null,
          2
        )
      }
    ]
  };
}
