/**
 * Codebase map builder and renderers.
 *
 * `buildCodebaseMap` produces a typed `CodebaseMapSummary` from index artifacts.
 * `renderMapMarkdown` renders it to pipeable markdown (CLI default / MCP).
 * `renderMapPretty` renders it to a terminal-friendly box layout.
 *
 * All ordering is deterministic: sort by count DESC, then alphabetically for ties.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { ProjectState } from '../project-state.js';
import type {
  CodebaseMapSummary,
  CodebaseMapLayer,
  CodebaseMapPattern,
  CodebaseMapExample,
  CodebaseMapNextCall,
  IntelligenceData,
  PatternsData
} from '../types/index.js';
import { RELATIONSHIPS_FILENAME } from '../constants/codebase-context.js';

// ---------------------------------------------------------------------------
// Internal types for relationships.json
// ---------------------------------------------------------------------------

interface RelationshipsGraph {
  imports?: Record<string, string[]>;
  importedBy?: Record<string, string[]>;
  stats?: {
    files?: number;
    edges?: number;
    avgDependencies?: number;
  };
}

interface RelationshipsData {
  graph?: RelationshipsGraph;
  stats?: {
    files?: number;
    edges?: number;
    avgDependencies?: number;
  };
}

// ---------------------------------------------------------------------------
// Entrypoint exclusion pattern
// ---------------------------------------------------------------------------

const ENTRYPOINT_EXCLUSION_RE =
  /(?:^|\/)(?:tests?|__tests__|fixtures?|scripts?)\/|\.test\.|\.spec\./;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a `CodebaseMapSummary` from the project's index artifacts.
 * Reads `intelligence.json` and `relationships.json` from project paths.
 * Degrades gracefully when artifacts are missing.
 */
export async function buildCodebaseMap(project: ProjectState): Promise<CodebaseMapSummary> {
  const projectName = path.basename(project.rootPath);

  // Read intelligence.json
  let intelligence: IntelligenceData = {};
  try {
    const raw = await fs.readFile(project.paths.intelligence, 'utf-8');
    intelligence = JSON.parse(raw) as IntelligenceData;
  } catch {
    // Degrade gracefully
  }

  // Read relationships.json
  const relPath = path.join(path.dirname(project.paths.intelligence), RELATIONSHIPS_FILENAME);
  let relationships: RelationshipsData = {};
  try {
    const raw = await fs.readFile(relPath, 'utf-8');
    relationships = JSON.parse(raw) as RelationshipsData;
  } catch {
    // Degrade gracefully
  }

  const graph = relationships.graph ?? {};
  const graphImports = graph.imports ?? {};
  const graphImportedBy = graph.importedBy ?? {};
  // relationships.json has stats at top level OR inside graph
  const statsSource =
    relationships.stats ??
    (graph as RelationshipsGraph & { stats?: RelationshipsData['stats'] }).stats ??
    {};

  // --- Architecture layers ---
  const layerCounts = new Map<string, number>();
  for (const file of Object.keys(graphImports)) {
    const segment = file.split('/')[0] ?? file;
    layerCounts.set(segment, (layerCounts.get(segment) ?? 0) + 1);
  }
  // Files in importedBy that aren't in imports
  for (const file of Object.keys(graphImportedBy)) {
    const segment = file.split('/')[0] ?? file;
    if (!graphImports[file]) {
      layerCounts.set(segment, (layerCounts.get(segment) ?? 0) + 1);
    }
  }
  const layers: CodebaseMapLayer[] = sortByCountThenAlpha(
    Array.from(layerCounts.entries()).map(([name, fileCount]) => ({ name, fileCount })),
    (l) => l.fileCount,
    (l) => l.name
  );

  // --- Entrypoints ---
  const entrypoints: string[] = [];
  for (const [file, imports] of Object.entries(graphImports)) {
    if (imports.length === 0) continue; // no imports — not an entrypoint
    if (ENTRYPOINT_EXCLUSION_RE.test(file)) continue; // test/script file
    const importers = graphImportedBy[file];
    if (!importers || importers.length === 0) {
      entrypoints.push(file);
    }
  }
  entrypoints.sort();

  // --- Hub files ---
  const importedByCounts: Array<{ file: string; count: number }> = Object.entries(
    graphImportedBy
  ).map(([file, importers]) => ({ file, count: importers.length }));
  const hubFiles: string[] = sortByCountThenAlpha(
    importedByCounts,
    (x) => x.count,
    (x) => x.file
  )
    .slice(0, 5)
    .map((x) => x.file);

  // --- Active patterns ---
  const patterns: PatternsData = intelligence.patterns ?? {};
  const activePatterns: CodebaseMapPattern[] = [];
  for (const [, entry] of Object.entries(patterns)) {
    const primary = entry.primary;
    if (!primary) continue;
    const adoptionPct = Number.parseInt(primary.frequency, 10);
    if (Number.isNaN(adoptionPct)) continue;
    activePatterns.push({
      name: primary.name,
      adoption: primary.frequency,
      trend: primary.trend ?? 'Stable'
    });
  }
  // Sort by adoption % descending, then name ascending
  activePatterns.sort((a, b) => {
    const aVal = Number.parseInt(a.adoption, 10);
    const bVal = Number.parseInt(b.adoption, 10);
    if (bVal !== aVal) return bVal - aVal;
    return a.name.localeCompare(b.name);
  });

  // --- Best examples ---
  const dominantPatternName =
    activePatterns.length > 0 ? activePatterns[0].name : 'high-quality example';
  const goldenFiles = intelligence.goldenFiles ?? [];
  const bestExamples: CodebaseMapExample[] = goldenFiles.slice(0, 3).map((gf) => ({
    file: gf.file,
    score: gf.score,
    reason: dominantPatternName
  }));

  // --- Graph stats ---
  const graphStats = {
    files: statsSource.files ?? 0,
    edges: statsSource.edges ?? 0,
    avgDependencies: statsSource.avgDependencies ?? 0
  };

  // --- Suggested next calls ---
  const suggestedNextCalls = buildSuggestedNextCalls(
    project.indexState.status,
    activePatterns,
    bestExamples
  );

  return {
    project: projectName,
    architecture: { layers, entrypoints, hubFiles },
    activePatterns,
    bestExamples,
    graphStats,
    suggestedNextCalls
  };
}

// ---------------------------------------------------------------------------
// Suggested next calls
// ---------------------------------------------------------------------------

function buildSuggestedNextCalls(
  indexStatus: string,
  patterns: CodebaseMapPattern[],
  examples: CodebaseMapExample[]
): CodebaseMapNextCall[] {
  const calls: CodebaseMapNextCall[] = [];

  // Priority 1: stale index
  if (indexStatus !== 'ready' && indexStatus !== 'idle') {
    calls.push({ tool: 'refresh_index', why: 'Index is not ready' });
  }

  // Priority 2: split patterns (< 60% adoption)
  if (calls.length < 3) {
    const splitPattern = patterns.find((p) => Number.parseInt(p.adoption, 10) < 60);
    if (splitPattern) {
      calls.push({
        tool: 'get_team_patterns',
        args: { category: splitPattern.name.toLowerCase().replace(/\s+/g, '-') },
        why: `Team is split on ${splitPattern.name}`
      });
    }
  }

  // Priority 3: golden files exist
  if (calls.length < 3 && examples.length > 0) {
    const topFile = examples[0].file;
    const query = path.basename(topFile, path.extname(topFile));
    calls.push({
      tool: 'search_codebase',
      args: { query },
      why: 'Explore the top-rated example'
    });
  }

  // Priority 4: fallback (always add if under cap)
  if (calls.length < 3) {
    calls.push({
      tool: 'search_codebase',
      args: { query: 'project architecture' },
      why: 'Explore the codebase'
    });
  }

  return calls.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/** Render a `CodebaseMapSummary` to pipeable markdown. */
export function renderMapMarkdown(map: CodebaseMapSummary): string {
  const lines: string[] = [];

  lines.push(`# Codebase Map — ${map.project}`);
  lines.push('');

  // Architecture
  lines.push('## Architecture Layers');
  lines.push('');
  if (map.architecture.layers.length === 0) {
    lines.push('_No index data available._');
  } else {
    for (const layer of map.architecture.layers) {
      lines.push(
        `- **${layer.name}** (${layer.fileCount} file${layer.fileCount === 1 ? '' : 's'})`
      );
    }
  }
  lines.push('');

  // Entrypoints
  lines.push('## Entrypoints');
  lines.push('');
  if (map.architecture.entrypoints.length === 0) {
    lines.push('_None detected._');
  } else {
    for (const ep of map.architecture.entrypoints) {
      lines.push(`- \`${ep}\``);
    }
  }
  lines.push('');

  // Hub Files
  lines.push('## Hub Files');
  lines.push('');
  if (map.architecture.hubFiles.length === 0) {
    lines.push('_None detected._');
  } else {
    for (const hf of map.architecture.hubFiles) {
      lines.push(`- \`${hf}\``);
    }
  }
  lines.push('');

  // Patterns
  lines.push('## Active Patterns');
  lines.push('');
  if (map.activePatterns.length === 0) {
    lines.push('_No patterns detected._');
  } else {
    for (const p of map.activePatterns) {
      lines.push(`- **${p.name}**: ${p.adoption} (${p.trend})`);
    }
  }
  lines.push('');

  // Best examples
  lines.push('## Best Examples');
  lines.push('');
  if (map.bestExamples.length === 0) {
    lines.push('_No examples available._');
  } else {
    for (const ex of map.bestExamples) {
      lines.push(`- \`${ex.file}\` (score: ${ex.score.toFixed(2)}) — ${ex.reason}`);
    }
  }
  lines.push('');

  // Graph stats
  lines.push('## Graph Stats');
  lines.push('');
  lines.push(
    `Files: ${map.graphStats.files} | Edges: ${map.graphStats.edges} | Avg Dependencies: ${map.graphStats.avgDependencies}`
  );
  lines.push('');

  // Suggested next calls
  lines.push('## Suggested Next Calls');
  lines.push('');
  if (map.suggestedNextCalls.length === 0) {
    lines.push('_No suggestions._');
  } else {
    for (const call of map.suggestedNextCalls) {
      const argsStr = call.args
        ? ` ${Object.entries(call.args)
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ')}`
        : '';
      lines.push(`- \`${call.tool}${argsStr}\` — ${call.why}`);
    }
  }

  return lines.join('\n');
}

/** Render a `CodebaseMapSummary` to terminal-friendly box output. */
export function renderMapPretty(map: CodebaseMapSummary): string {
  const ascii = process.env.CODEBASE_CONTEXT_ASCII === '1';
  const h = ascii ? '-' : '─';
  const v = ascii ? '|' : '│';
  const tl = ascii ? '+' : '┌';
  const tr = ascii ? '+' : '┐';
  const bl = ascii ? '+' : '└';
  const br = ascii ? '+' : '┘';
  const lm = ascii ? '+' : '├';
  const rm = ascii ? '+' : '┤';

  const width = 60;
  const inner = width - 2;

  function box(title: string, lines: string[]): string {
    const top = `${tl}${h.repeat(inner)}${tr}`;
    const mid = `${lm}${h.repeat(inner)}${rm}`;
    const bot = `${bl}${h.repeat(inner)}${br}`;
    const titleLine = `${v} ${title.padEnd(inner - 1)}${v}`;
    const contentLines = lines.map((l) => {
      const truncated = l.length > inner - 2 ? l.slice(0, inner - 5) + '...' : l;
      return `${v}  ${truncated.padEnd(inner - 2)}${v}`;
    });
    return [top, titleLine, mid, ...contentLines, bot].join('\n');
  }

  const sections: string[] = [];

  sections.push(box(`Codebase Map — ${map.project}`, []));

  const layerLines =
    map.architecture.layers.length === 0
      ? ['(none)']
      : map.architecture.layers.map((l) => `${l.name}  ${l.fileCount} files`);
  sections.push(box('Architecture Layers', layerLines));

  const epLines =
    map.architecture.entrypoints.length === 0 ? ['(none detected)'] : map.architecture.entrypoints;
  sections.push(box('Entrypoints', epLines));

  const hubLines =
    map.architecture.hubFiles.length === 0 ? ['(none detected)'] : map.architecture.hubFiles;
  sections.push(box('Hub Files', hubLines));

  const patternLines =
    map.activePatterns.length === 0
      ? ['(no patterns)']
      : map.activePatterns.map((p) => `${p.name}: ${p.adoption} ${p.trend}`);
  sections.push(box('Active Patterns', patternLines));

  const exampleLines =
    map.bestExamples.length === 0
      ? ['(no examples)']
      : map.bestExamples.map((e) => `${e.file} (${e.score.toFixed(2)})`);
  sections.push(box('Best Examples', exampleLines));

  sections.push(
    box('Graph Stats', [
      `Files: ${map.graphStats.files}`,
      `Edges: ${map.graphStats.edges}`,
      `Avg Dependencies: ${map.graphStats.avgDependencies}`
    ])
  );

  const callLines =
    map.suggestedNextCalls.length === 0
      ? ['(no suggestions)']
      : map.suggestedNextCalls.map((c) => `${c.tool} — ${c.why}`);
  sections.push(box('Suggested Next Calls', callLines));

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sortByCountThenAlpha<T>(
  items: T[],
  getCount: (item: T) => number,
  getName: (item: T) => string
): T[] {
  return [...items].sort((a, b) => {
    const diff = getCount(b) - getCount(a);
    if (diff !== 0) return diff;
    return getName(a).localeCompare(getName(b));
  });
}
