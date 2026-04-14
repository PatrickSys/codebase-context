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
  CodebaseMapKeyInterface,
  CodebaseMapApiSurface,
  CodebaseMapHotspot,
  IntelligenceData,
  PatternsData,
  CodeChunk
} from '../types/index.js';
import { RELATIONSHIPS_FILENAME, KEYWORD_INDEX_FILENAME } from '../constants/codebase-context.js';

// ---------------------------------------------------------------------------
// Internal types for relationships.json
// ---------------------------------------------------------------------------

interface RelationshipsGraph {
  imports?: Record<string, string[]>;
  importedBy?: Record<string, string[]>;
  exports?: Record<string, Array<{ name: string; type: string }>>;
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
 * Reads `intelligence.json`, `relationships.json`, and `index.json` from project paths.
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

  // Read index.json (keyword index — contains CodeChunk[] with ChunkMetadata)
  const idxPath = path.join(path.dirname(project.paths.intelligence), KEYWORD_INDEX_FILENAME);
  let chunks: CodeChunk[] = [];
  try {
    const raw = await fs.readFile(idxPath, 'utf-8');
    const parsed = JSON.parse(raw) as { chunks?: unknown };
    if (parsed && Array.isArray(parsed.chunks)) chunks = parsed.chunks as CodeChunk[];
  } catch {
    // Degrade gracefully
  }

  const graph = relationships.graph ?? {};
  const graphImports = graph.imports ?? {};
  const graphImportedBy = graph.importedBy ?? {};
  const graphExports = graph.exports ?? {};
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
  const rawLayers: CodebaseMapLayer[] = sortByCountThenAlpha(
    Array.from(layerCounts.entries()).map(([name, fileCount]) => ({ name, fileCount })),
    (l) => l.fileCount,
    (l) => l.name
  );
  const layers = enrichLayers(rawLayers, graphImportedBy, graphExports);

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

  // --- Key interfaces ---
  const keyInterfaces = deriveKeyInterfaces(chunks, graphImportedBy);

  // --- API surface ---
  const apiSurface = deriveApiSurface(entrypoints, graphExports);

  // --- Dependency hotspots ---
  const hotspots = deriveHotspots(graphImports, graphImportedBy);

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
    architecture: { layers, entrypoints, hubFiles, keyInterfaces, apiSurface, hotspots },
    activePatterns,
    bestExamples,
    graphStats,
    suggestedNextCalls
  };
}

// ---------------------------------------------------------------------------
// Structural skeleton derivations
// ---------------------------------------------------------------------------

const SYMBOL_KINDS = new Set(['interface', 'class', 'type', 'enum']);

function buildSignatureHint(content: string): string {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const hint = lines.slice(0, 3).join('\n');
  const truncated = hint.length > 200 ? hint.slice(0, 197) + '...' : hint;
  return truncated.replace(/\s*\{$/, '').trim();
}

function deriveKeyInterfaces(
  chunks: CodeChunk[],
  graphImportedBy: Record<string, string[]>
): CodebaseMapKeyInterface[] {
  const symbolChunks = chunks.filter(
    (c) => c.metadata?.symbolAware === true && SYMBOL_KINDS.has(c.metadata.symbolKind ?? '')
  );
  const scored = symbolChunks.map((c) => ({
    chunk: c,
    importerCount: graphImportedBy[c.relativePath]?.length ?? 0
  }));
  scored.sort((a, b) => {
    if (b.importerCount !== a.importerCount) return b.importerCount - a.importerCount;
    const lenDiff = a.chunk.content.length - b.chunk.content.length;
    if (lenDiff !== 0) return lenDiff;
    return a.chunk.relativePath.localeCompare(b.chunk.relativePath);
  });
  return scored.slice(0, 10).map(({ chunk, importerCount }) => ({
    name: chunk.metadata.symbolName ?? path.basename(chunk.relativePath),
    kind: chunk.metadata.symbolKind ?? 'unknown',
    file: chunk.relativePath,
    importerCount,
    signatureHint: buildSignatureHint(chunk.content)
  }));
}

function deriveApiSurface(
  entrypoints: string[],
  graphExports: Record<string, Array<{ name: string; type: string }>>
): CodebaseMapApiSurface[] {
  const results: CodebaseMapApiSurface[] = [];
  for (const ep of entrypoints) {
    const exps = graphExports[ep];
    if (!exps || exps.length === 0) continue;
    const names = exps
      .map((e) => e.name)
      .filter((n) => n && n !== 'default')
      .slice(0, 5);
    if (names.length === 0) continue;
    results.push({ file: ep, exports: names });
  }
  return results;
}

function deriveHotspots(
  graphImports: Record<string, string[]>,
  graphImportedBy: Record<string, string[]>
): CodebaseMapHotspot[] {
  const allFiles = new Set([...Object.keys(graphImports), ...Object.keys(graphImportedBy)]);
  const hotspots: CodebaseMapHotspot[] = [];
  for (const file of allFiles) {
    const importerCount = graphImportedBy[file]?.length ?? 0;
    const importCount = graphImports[file]?.length ?? 0;
    const combined = importerCount + importCount;
    if (combined === 0) continue;
    hotspots.push({ file, importerCount, importCount, combined });
  }
  hotspots.sort((a, b) => {
    if (b.combined !== a.combined) return b.combined - a.combined;
    return a.file.localeCompare(b.file);
  });
  return hotspots.slice(0, 5);
}

function enrichLayers(
  layers: CodebaseMapLayer[],
  graphImportedBy: Record<string, string[]>,
  graphExports: Record<string, Array<{ name: string; type: string }>>
): CodebaseMapLayer[] {
  return layers.map((layer) => {
    const bestFile = sortByCountThenAlpha(
      Object.entries(graphImportedBy)
        .filter(([file]) => file.split('/')[0] === layer.name)
        .map(([file, importers]) => ({ file, count: importers.length })),
      (entry) => entry.count,
      (entry) => entry.file
    )[0]?.file;
    if (!bestFile) return layer;
    const exps = graphExports[bestFile];
    const hubExports = exps
      ? exps
          .map((e) => e.name)
          .filter((n) => n && n !== 'default')
          .slice(0, 3)
      : [];
    return {
      ...layer,
      hubFile: bestFile,
      ...(hubExports.length > 0 ? { hubExports } : {})
    };
  });
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

  // Architecture layers
  lines.push('## Architecture Layers');
  lines.push('');
  if (map.architecture.layers.length === 0) {
    lines.push('_No index data available._');
  } else {
    for (const layer of map.architecture.layers) {
      let line = `- **${layer.name}** (${layer.fileCount} file${layer.fileCount === 1 ? '' : 's'})`;
      if (layer.hubFile) {
        const exStr =
          layer.hubExports && layer.hubExports.length > 0
            ? ` → ${layer.hubExports.join(', ')}`
            : '';
        line += ` — hub: \`${layer.hubFile}\`${exStr}`;
      }
      lines.push(line);
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

  // Key Interfaces
  lines.push('## Key Interfaces');
  lines.push('');
  if (map.architecture.keyInterfaces.length === 0) {
    lines.push('_None detected._');
  } else {
    for (const ki of map.architecture.keyInterfaces) {
      lines.push(
        `- **${ki.name}** \`${ki.kind}\` — \`${ki.file}\` (imported by ${ki.importerCount})`
      );
      if (ki.signatureHint) {
        lines.push('  ```');
        lines.push(`  ${ki.signatureHint.split('\n').join('\n  ')}`);
        lines.push('  ```');
      }
    }
  }
  lines.push('');

  // API Surface
  lines.push('## API Surface');
  lines.push('');
  if (map.architecture.apiSurface.length === 0) {
    lines.push('_None detected._');
  } else {
    for (const s of map.architecture.apiSurface) {
      lines.push(`- \`${s.file}\` — exports: ${s.exports.join(', ')}`);
    }
  }
  lines.push('');

  // Dependency Hotspots
  lines.push('## Dependency Hotspots');
  lines.push('');
  if (map.architecture.hotspots.length === 0) {
    lines.push('_None detected._');
  } else {
    for (const h of map.architecture.hotspots) {
      lines.push(
        `- \`${h.file}\` — imported by ${h.importerCount}, imports ${h.importCount} (combined: ${h.combined})`
      );
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
      : map.architecture.layers.map((l) =>
          l.hubFile
            ? `${l.name}  ${l.fileCount} files  [${l.hubFile}]`
            : `${l.name}  ${l.fileCount} files`
        );
  sections.push(box('Architecture Layers', layerLines));

  const epLines =
    map.architecture.entrypoints.length === 0 ? ['(none detected)'] : map.architecture.entrypoints;
  sections.push(box('Entrypoints', epLines));

  const hubLines =
    map.architecture.hubFiles.length === 0 ? ['(none detected)'] : map.architecture.hubFiles;
  sections.push(box('Hub Files', hubLines));

  const kiLines =
    map.architecture.keyInterfaces.length === 0
      ? ['(none detected)']
      : map.architecture.keyInterfaces.map(
          (ki) => `${ki.name} ${ki.kind}  ${ki.file} (×${ki.importerCount})`
        );
  sections.push(box('Key Interfaces', kiLines));

  const apiLines =
    map.architecture.apiSurface.length === 0
      ? ['(none detected)']
      : map.architecture.apiSurface.map((s) => `${s.file}: ${s.exports.join(', ')}`);
  sections.push(box('API Surface', apiLines));

  const hotspotLines =
    map.architecture.hotspots.length === 0
      ? ['(none detected)']
      : map.architecture.hotspots.map((h) => `${h.file}  +${h.importerCount}/-${h.importCount}`);
  sections.push(box('Dependency Hotspots', hotspotLines));

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
