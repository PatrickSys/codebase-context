/**
 * Human-readable CLI formatters for codebase-context commands.
 * Use --json flag for raw JSON output instead.
 */

import path from 'path';
import type {
  PatternResponse,
  PatternEntry,
  LibraryEntry,
  SearchResponse,
  SearchResultItem,
  RefsResponse,
  RefsUsage,
  CyclesResponse,
  CycleItem,
  MetadataResponse,
  StyleGuideResponse
} from './tools/types.js';

export const BOX_WIDTH = 72;

type Charset = 'unicode' | 'ascii';

function parseEnvBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getCharset(): Charset {
  if (parseEnvBoolean(process.env.CODEBASE_CONTEXT_ASCII)) return 'ascii';
  if (process.stdout && process.stdout.isTTY === false) return 'ascii';
  return 'unicode';
}

type CliGlyphs = {
  charset: Charset;
  box: {
    tl: string;
    tr: string;
    bl: string;
    br: string;
    h: string;
    v: string;
  };
  tree: {
    tee: string;
    elbow: string;
    pipe: string;
  };
  arrow: string;
  leftRight: string;
  dot: string;
  warn: string;
  bar: {
    full: string;
    empty: string;
  };
};

const UNICODE_GLYPHS: CliGlyphs = {
  charset: 'unicode',
  box: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  tree: { tee: '├─', elbow: '└─', pipe: '│' },
  arrow: '→',
  leftRight: '↔',
  dot: '·',
  warn: '⚠',
  bar: { full: '█', empty: '░' }
};

const ASCII_GLYPHS: CliGlyphs = {
  charset: 'ascii',
  box: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' },
  tree: { tee: '|-', elbow: '`-', pipe: '|' },
  arrow: '->',
  leftRight: '<->',
  dot: '*',
  warn: '!',
  bar: { full: '#', empty: '.' }
};

function getGlyphs(): CliGlyphs {
  return getCharset() === 'ascii' ? ASCII_GLYPHS : UNICODE_GLYPHS;
}

export function shortPath(filePath: string, rootPath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const normalizedRoot = rootPath.replace(/\\/g, '/');
  if (normalized.startsWith(normalizedRoot)) {
    return normalized.slice(normalizedRoot.length).replace(/^\//, '');
  }
  // Also strip common Repos/ prefix patterns
  const reposIdx = normalized.indexOf('/Repos/');
  if (reposIdx >= 0) {
    const afterRepos = normalized.slice(reposIdx + 7);
    const slashIdx = afterRepos.indexOf('/');
    return slashIdx >= 0 ? afterRepos.slice(slashIdx + 1) : afterRepos;
  }
  return path.basename(filePath);
}

export function formatTrend(trend?: string): string {
  if (trend === 'Rising') return 'rising';
  if (trend === 'Declining') return 'declining';
  return '';
}

export function formatType(type?: string): string {
  if (!type) return '';
  // "interceptor:core" -> "interceptor (core)", "resolver:unknown" -> "resolver"
  const [compType, layer] = type.split(':');
  if (!layer || layer === 'unknown') return compType;
  return `${compType} (${layer})`;
}

export function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

export function padLeft(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

export function barChart(pct: number, width: number = 10): string {
  const g = getGlyphs();
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return g.bar.full.repeat(filled) + g.bar.empty.repeat(width - filled);
}

export function scoreBar(score: number, width: number = 10): string {
  return barChart(Math.round(score * 100), width);
}

export function parsePercent(s?: string): number {
  if (!s) return 0;
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function wrapLine(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const words = text.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length > maxWidth) {
      if (cur) out.push(cur);
      cur = w;
    } else cur = candidate;
  }
  if (cur) out.push(cur);
  return out;
}

export function drawBox(title: string, lines: string[], width: number = 60): string[] {
  const g = getGlyphs();
  const output: string[] = [];
  const inner = width - 4; // 2 for "| " + 2 for " |"
  const dashes = g.box.h;
  const titlePart = `${g.box.tl}${g.box.h} ${title} `;
  const remaining = Math.max(0, width - titlePart.length - 1);
  output.push(titlePart + dashes.repeat(remaining) + g.box.tr);
  for (const line of lines) {
    const wrapped = wrapLine(line, inner);
    for (const wl of wrapped) {
      const padded = wl + ' '.repeat(Math.max(0, inner - wl.length));
      output.push(`${g.box.v} ${padded} ${g.box.v}`);
    }
  }
  output.push(g.box.bl + dashes.repeat(width - 2) + g.box.br);
  return output;
}

export function getCycleFiles(cycle: CycleItem): string[] {
  if (cycle.files && cycle.files.length > 0) return cycle.files;
  return cycle.cycle ?? [];
}

export function formatPatterns(data: PatternResponse): void {
  const g = getGlyphs();
  const { patterns, goldenFiles, memories, conflicts } = data;
  const lines: string[] = [];

  if (patterns) {
    const entries = Object.entries(patterns);
    for (let ei = 0; ei < entries.length; ei++) {
      const [category, catData] = entries[ei];
      const label = category
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (s) => s.toUpperCase())
        .trim();
      if (ei > 0) {
        lines.push('  ' + g.box.h.repeat(66));
      }
      lines.push('');
      lines.push(label.toUpperCase());

      const renderEntry = (entry: PatternEntry, isAlt: boolean): void => {
        const raw = entry as unknown as Record<string, unknown>;
        const guidance = typeof raw.guidance === 'string' ? raw.guidance : null;
        const prefix = isAlt ? 'alt  ' : '     ';
        if (guidance) {
          lines.push(`${prefix}${guidance}`);
        } else {
          const name = padRight(entry.name ?? '', 30);
          const freq = padLeft(entry.frequency ?? '', 6);
          const trend = formatTrend(entry.trend);
          lines.push(`${prefix}${name} ${freq}${trend ? `   ${trend}` : ''}`);
        }
      };

      const primary = catData.primary;
      renderEntry(primary, false);

      const alsoDetected = catData.alsoDetected;
      if (alsoDetected) {
        for (const alt of alsoDetected) renderEntry(alt, true);
      }
    }
  }

  const topUsed = data.topUsed;
  if (topUsed && topUsed.length > 0) {
    lines.push('');
    lines.push(g.box.h.repeat(66));
    lines.push('');
    lines.push('TOP LIBRARIES');
    for (const lib of topUsed.slice(0, 15) as LibraryEntry[]) {
      const src = padRight(lib.source ?? '', 52);
      lines.push(`  ${src} ${lib.count} imports`);
    }
  }

  if (goldenFiles && goldenFiles.length > 0) {
    lines.push('');
    lines.push(g.box.h.repeat(66));
    lines.push('');
    lines.push('GOLDEN FILES');
    for (const gf of goldenFiles.slice(0, 5)) {
      const file = padRight(gf.file ?? '', 52);
      lines.push(`  ${file} score: ${gf.score}`);
    }
  }

  if (conflicts && conflicts.length > 0) {
    lines.push('');
    lines.push(g.box.h.repeat(66));
    lines.push('');
    lines.push('CONFLICTS');
    for (const c of conflicts) {
      const p = c.primary;
      const a = c.alternative;
      const pTrend = p.trend ? ` (${p.trend})` : '';
      const aTrend = a.trend ? ` (${a.trend})` : '';
      lines.push(`  split: ${p.name} ${p.adoption}${pTrend} vs ${a.name} ${a.adoption}${aTrend}`);
    }
  }

  if (memories && memories.length > 0) {
    lines.push('');
    lines.push(g.box.h.repeat(66));
    lines.push('');
    lines.push('MEMORIES');
    for (const m of memories.slice(0, 5)) {
      lines.push(`  [${m.type}] ${m.memory}`);
    }
  }

  lines.push('');

  const boxLines = drawBox('Team Patterns', lines, BOX_WIDTH);
  console.log('');
  for (const l of boxLines) {
    console.log(l);
  }
  console.log('');
}

export function formatSearch(
  data: SearchResponse,
  rootPath: string,
  query?: string,
  intent?: string
): void {
  const g = getGlyphs();
  const { searchQuality: quality, preflight, results, relatedMemories: memories } = data;

  const boxLines: string[] = [];

  const showPreflight = intent === 'edit' || intent === 'refactor' || intent === 'migrate';

  if (quality) {
    const status = quality.status === 'ok' ? 'ok' : 'low confidence';
    const conf = quality.confidence ?? '';
    const confStr = typeof conf === 'number' ? conf.toFixed(2) : String(conf);
    boxLines.push(`Quality: ${status} (${confStr})`);
    if (quality.hint) {
      boxLines.push(`Hint: ${quality.hint}`);
    }
  }

  if (preflight && showPreflight) {
    const readyLabel = preflight.ready ? 'YES' : 'NO';
    boxLines.push(`Ready to edit: ${readyLabel}`);

    if (preflight.nextAction) {
      boxLines.push(`Next: ${preflight.nextAction}`);
    }

    const patterns = preflight.patterns;
    if (patterns) {
      if (
        (patterns.do && patterns.do.length > 0) ||
        (patterns.avoid && patterns.avoid.length > 0)
      ) {
        boxLines.push('');
        boxLines.push('Patterns:');
        for (const p of patterns.do ?? []) {
          boxLines.push(`  do:    ${p}`);
        }
        for (const p of patterns.avoid ?? []) {
          boxLines.push(`  avoid: ${p}`);
        }
      }
    }

    if (preflight.bestExample) {
      boxLines.push('');
      boxLines.push(`Best example: ${shortPath(preflight.bestExample, rootPath)}`);
    }

    const impact = preflight.impact;
    if (impact?.coverage) {
      boxLines.push(`Callers: ${impact.coverage}`);
    }
    if (impact?.details && impact.details.length > 0) {
      const shown = impact.details.slice(0, 3).map((d) => {
        const p = shortPath(d.file, rootPath);
        const suffix = d.line ? `:${d.line}` : '';
        return `${p}${suffix} (hop ${d.hop})`;
      });
      boxLines.push(`Files:   ${shown.join(', ')}`);
    } else if (impact?.files && impact.files.length > 0) {
      const shown = impact.files.slice(0, 3).map((f) => shortPath(f, rootPath));
      boxLines.push(`Files:   ${shown.join(', ')}`);
    }

    const whatWouldHelp = preflight.whatWouldHelp;
    if (whatWouldHelp && whatWouldHelp.length > 0) {
      boxLines.push('');
      for (const h of whatWouldHelp) {
        boxLines.push(`${g.arrow} ${h}`);
      }
    }
  }

  const titleParts: string[] = [];
  if (query) titleParts.push(`"${query}"`);
  if (intent) titleParts.push(`intent: ${intent}`);
  const boxTitle =
    titleParts.length > 0 ? `Search: ${titleParts.join(` ${g.box.h.repeat(3)} `)}` : 'Search';

  console.log('');
  if (boxLines.length > 0) {
    const boxOut = drawBox(boxTitle, boxLines, BOX_WIDTH);
    for (const l of boxOut) {
      console.log(l);
    }
    console.log('');
  } else if (quality) {
    const status = quality.status === 'ok' ? 'ok' : 'low confidence';
    console.log(`  ${results?.length ?? 0} results  ${g.dot}  quality: ${status}`);
    console.log('');
  }

  if (results && results.length > 0) {
    for (let i = 0; i < results.length; i++) {
      const r: SearchResultItem = results[i];
      const file = shortPath(r.file ?? '', rootPath);
      const scoreValue = Number(r.score ?? 0);
      const score = scoreValue.toFixed(2);
      const typePart = formatType(r.type);
      const trendPart = formatTrend(r.trend);

      const metaParts = [`confidence: ${scoreBar(scoreValue)} ${score}`];
      if (typePart) metaParts.push(typePart);
      if (trendPart) metaParts.push(trendPart);
      if (r.relationships?.hasTests) metaParts.push('has tests');

      console.log(`${i + 1}.  ${file}`);
      console.log(`    ${metaParts.join(` ${g.dot} `)}`);

      const summary = r.summary ?? '';
      if (summary) {
        const short = summary.length > 120 ? summary.slice(0, 117) + '...' : summary;
        console.log(`    ${short}`);
      }

      if (r.patternWarning) {
        console.log(`    ${g.warn} ${r.patternWarning}`);
      }

      const hints = r.hints;
      if (hints?.callers && hints.callers.length > 0) {
        const shortCallers = hints.callers.slice(0, 3).map((c) => shortPath(c, rootPath));
        const total = r.relationships?.importedByCount ?? hints.callers.length;
        const more = total > 3 ? ` (+${total - 3} more)` : '';
        console.log(`    used by: ${shortCallers.join(', ')}${more}`);
      }
      if (hints?.tests && hints.tests.length > 0) {
        const shortTests = hints.tests.slice(0, 2).map((t) => shortPath(t, rootPath));
        console.log(`    tested:  ${shortTests.join(', ')}`);
      }

      const snippet = r.snippet ?? '';
      if (snippet) {
        const snippetLines = snippet.split('\n');
        const trimmed = snippetLines.map((l) => l.trimEnd());
        while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
        const shown = trimmed.slice(0, 8);
        for (const sl of shown) {
          console.log(`  ${g.box.v} ${sl}`);
        }
      }

      console.log('');
    }
  }

  if (memories && memories.length > 0) {
    console.log('Memories:');
    for (const m of memories) {
      console.log(`  ${m}`);
    }
    console.log('');
  }
}

export function formatRefs(data: RefsResponse, rootPath: string): void {
  const g = getGlyphs();
  const { symbol, usageCount: count, confidence, usages } = data;

  const lines: string[] = [];
  lines.push('');
  lines.push(String(symbol));

  if (usages && usages.length > 0) {
    lines.push(g.tree.pipe);
    for (let i = 0; i < usages.length; i++) {
      const u: RefsUsage = usages[i];
      const isLast = i === usages.length - 1;
      const branch = isLast ? g.tree.elbow : g.tree.tee;
      const file = shortPath(u.file ?? '', rootPath);
      lines.push(`${branch} ${file}:${u.line}`);

      const preview = u.preview ?? '';
      if (preview) {
        const nonEmpty = preview
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 2);
        const indent = isLast ? '   ' : `${g.tree.pipe}  `;
        const maxPrev = BOX_WIDTH - 10;
        for (const pl of nonEmpty) {
          const clipped = pl.length > maxPrev ? pl.slice(0, maxPrev - 3) + '...' : pl;
          lines.push(`${indent} ${clipped}`);
        }
      }

      if (!isLast) {
        lines.push(g.tree.pipe);
      }
    }
  }

  if (data.isComplete === false) {
    lines.push('');
    lines.push(`${g.arrow} results capped at limit — use --limit to see more`);
  }

  lines.push('');

  const confLabel =
    confidence === 'syntactic' ? 'static analysis' : (confidence ?? 'static analysis');
  const boxTitle = `${symbol} ${g.box.h.repeat(3)} ${count} references ${g.box.h.repeat(3)} ${confLabel}`;
  const boxOut = drawBox(boxTitle, lines, BOX_WIDTH);
  console.log('');
  for (const l of boxOut) {
    console.log(l);
  }
  console.log('');
}

export function formatCycles(data: CyclesResponse, rootPath: string): void {
  const g = getGlyphs();
  const cycles = data.cycles ?? [];
  const stats = data.graphStats;

  const statParts: string[] = [];
  if (cycles.length === 0) {
    statParts.push('No cycles found');
  } else {
    statParts.push(`${cycles.length} cycle${cycles.length === 1 ? '' : 's'}`);
  }
  if (stats?.files != null) statParts.push(`${stats.files} files`);
  if (stats?.edges != null) statParts.push(`${stats.edges} edges`);
  if (stats?.avgDependencies != null)
    statParts.push(`${stats.avgDependencies.toFixed(1)} avg deps`);

  const lines: string[] = [];
  lines.push('');
  lines.push(statParts.join(`  ${g.dot}  `));

  for (const c of cycles) {
    const sev = (c.severity ?? 'low').toLowerCase();
    const sevLabel = sev === 'high' ? 'HIGH' : sev === 'medium' ? 'MED ' : 'LOW ';
    const nodes = getCycleFiles(c).map((f) => shortPath(f, rootPath));

    lines.push('');
    if (nodes.length === 2) {
      lines.push(`  ${sevLabel}  ${nodes[0]} ${g.leftRight} ${nodes[1]}`);
    } else {
      const arrow = ` ${g.arrow} `;
      const full = nodes.join(arrow);
      if (full.length <= 60) {
        lines.push(`  ${sevLabel}  ${full}`);
      } else {
        const indent = '        ';
        let current = `  ${sevLabel}  ${nodes[0]}`;
        for (let ni = 1; ni < nodes.length; ni++) {
          const next = arrow + nodes[ni];
          if (current.length + next.length > 68) {
            lines.push(current);
            current = indent + nodes[ni];
          } else {
            current += next;
          }
        }
        lines.push(current);
      }
    }
  }

  lines.push('');

  const boxOut = drawBox('Circular Dependencies', lines, BOX_WIDTH);
  console.log('');
  for (const l of boxOut) {
    console.log(l);
  }
  console.log('');
}

export function formatMetadata(data: MetadataResponse): void {
  const m = data.metadata;
  if (!m) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const g = getGlyphs();

  const lines: string[] = [];
  lines.push('');

  // Framework line
  const fw = m.framework;
  const fwName = fw ? `${fw.name ?? ''}${fw.version ? ` ${fw.version}` : ''}`.trim() : '';
  const archType = m.architecture?.type ?? '';
  if (fwName || archType) {
    const parts: string[] = [];
    if (fwName) parts.push(`Framework: ${fwName}`);
    if (archType) parts.push(`Architecture: ${archType}`);
    lines.push(parts.join('   '));
  }

  // Languages line
  const langs = m.languages ?? [];
  if (langs.length > 0) {
    const langStr = langs
      .slice(0, 4)
      .map((l) => {
        const pct = l.percentage != null ? ` ${l.percentage}%` : '';
        const files = l.fileCount != null ? ` (${l.fileCount} files)` : '';
        return `${l.name ?? ''}${pct}${files}`;
      })
      .join('  ');
    lines.push(langStr);
  }

  // Stats line
  const stats = m.statistics;
  if (stats) {
    const statParts: string[] = [];
    if (stats.totalFiles != null) statParts.push(`${stats.totalFiles} files`);
    if (stats.totalLines != null) statParts.push(`${stats.totalLines.toLocaleString()} lines`);
    if (stats.totalComponents != null) statParts.push(`${stats.totalComponents} components`);
    if (statParts.length > 0) lines.push(statParts.join(` ${g.dot} `));
  }

  // Component breakdown by type (e.g. module 199  component 53  service 31)
  const byType = stats?.componentsByType;
  if (byType) {
    const entries = Object.entries(byType)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a);
    if (entries.length > 0) {
      const shown = entries.slice(0, 3);
      const more = entries.length > 3 ? `  (+${entries.length - 3} more)` : '';
      const str = shown.map(([k, v]) => `${k} ${v}`).join('  ');
      lines.push(`By type:   ${str}${more}`);
    }
  }

  // Layer breakdown — skip zero-count and 'unknown' (e.g. presentation 57  business 23)
  const layers = m.architecture?.layers;
  if (layers) {
    const entries = Object.entries(layers)
      .filter(([k, v]) => v > 0 && k !== 'unknown')
      .sort(([, a], [, b]) => b - a);
    if (entries.length > 0) {
      const str = entries.map(([k, v]) => `${k} ${v}`).join('  ');
      lines.push(`By layer:  ${str}`);
    }
  }

  // Framework extras: state, testing, ui
  if (fw) {
    const extras: string[] = [];
    if (fw.stateManagement && fw.stateManagement.length > 0) {
      extras.push(`State: ${fw.stateManagement.join(', ')}`);
    }
    if (fw.testingFrameworks && fw.testingFrameworks.length > 0) {
      extras.push(`Testing: ${fw.testingFrameworks.join(', ')}`);
    }
    if (fw.uiLibraries && fw.uiLibraries.length > 0) {
      extras.push(`UI: ${fw.uiLibraries.join(', ')}`);
    }
    if (extras.length > 0) {
      lines.push('');
      for (const e of extras) lines.push(e);
    }
  }

  // Dependencies grouped by category (framework / state / other)
  const deps = m.dependencies ?? [];
  if (deps.length > 0) {
    lines.push('');
    const grouped: Record<string, string[]> = {};
    for (const d of deps) {
      const cat = d.category ?? 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(d.name);
    }
    const catOrder = ['framework', 'state', 'testing', 'other'];
    const cats = [
      ...catOrder.filter((c) => grouped[c]),
      ...Object.keys(grouped).filter((c) => !catOrder.includes(c))
    ];
    for (const cat of cats) {
      const names = grouped[cat];
      if (!names || names.length === 0) continue;
      const label = padRight(cat, 9);
      const shown = names.slice(0, 2).join(` ${g.dot} `);
      const more = names.length > 2 ? ` (+${names.length - 2} more)` : '';
      lines.push(`  ${label}  ${shown}${more}`);
    }
  }

  // Modules (if any)
  const modules = m.architecture?.modules;
  if (modules && modules.length > 0) {
    lines.push('');
    lines.push(
      `Modules: ${modules
        .slice(0, 6)
        .map((mod) => mod.name)
        .join(` ${g.dot} `)}${modules.length > 6 ? ` (+${modules.length - 6})` : ''}`
    );
  }

  lines.push('');

  const projectName = m.name ?? 'Project';
  const structureType = m.projectStructure?.type;
  const titleSuffix = structureType ? ` [${structureType}]` : '';
  const boxOut = drawBox(`${projectName}${titleSuffix}`, lines, BOX_WIDTH);
  console.log('');
  for (const l of boxOut) {
    console.log(l);
  }
  console.log('');
}

type IndexingStatusPayload = {
  status?: string;
  rootPath?: string;
  lastIndexed?: string;
  stats?: {
    totalFiles?: number;
    indexedFiles?: number;
    totalChunks?: number;
    duration?: string;
    incremental?: boolean;
  };
  progress?: {
    phase?: string;
    percentage?: number;
    filesProcessed?: number;
    totalFiles?: number;
  };
  error?: string;
  hint?: string;
};

export function formatStatus(data: IndexingStatusPayload, rootPath: string): void {
  const g = getGlyphs();
  const lines: string[] = [];
  lines.push('');

  const state = data.status ?? 'unknown';
  lines.push(`State: ${state}`);

  const effectiveRoot = data.rootPath ?? rootPath;
  if (effectiveRoot) {
    lines.push(`Root:  ${effectiveRoot}`);
  }

  if (data.lastIndexed) {
    lines.push(`Last:  ${data.lastIndexed}`);
  }

  if (data.stats) {
    const s = data.stats;
    const parts: string[] = [];
    if (s.indexedFiles != null) parts.push(`${s.indexedFiles} files`);
    if (s.totalChunks != null) parts.push(`${s.totalChunks} chunks`);
    if (s.duration) parts.push(s.duration);
    if (typeof s.incremental === 'boolean') parts.push(s.incremental ? 'incremental' : 'full');
    if (parts.length > 0) lines.push(`Stats: ${parts.join(` ${g.dot} `)}`);
  }

  if (data.progress) {
    const p = data.progress;
    const pct = typeof p.percentage === 'number' ? p.percentage : undefined;
    const phase = p.phase ?? 'working';
    if (pct != null) {
      lines.push(`Progress: ${padRight(phase, 12)} ${barChart(pct, 18)} ${pct}%`);
    } else {
      lines.push(`Progress: ${phase}`);
    }
  }

  if (data.error) {
    lines.push('');
    lines.push(`${g.warn} ${data.error}`);
  }

  if (data.hint) {
    lines.push('');
    lines.push(`${g.arrow} ${data.hint}`);
  }

  lines.push('');

  const boxOut = drawBox('Index Status', lines, BOX_WIDTH);
  console.log('');
  for (const l of boxOut) console.log(l);
  console.log('');
}

export function formatStyleGuide(data: StyleGuideResponse, rootPath: string): void {
  const g = getGlyphs();
  if (data.status === 'no_results' || !data.results || data.results.length === 0) {
    console.log('');
    console.log('No style guides found.');
    if (data.hint) {
      console.log(`  Hint: ${data.hint}`);
    }
    if (data.searchedPatterns && data.searchedPatterns.length > 0) {
      console.log(`  Searched: .md files matching ${data.searchedPatterns.join(', ')}`);
    }
    console.log('');
    return;
  }

  const lines: string[] = [];
  lines.push('');

  const totalFiles = data.totalFiles ?? data.results.length;
  const totalMatches = data.totalMatches ?? 0;
  const countParts: string[] = [];
  if (data.limited) {
    countParts.push(`showing top ${totalFiles} of ${totalMatches}`);
  } else {
    const filePart = `${totalFiles} file${totalFiles === 1 ? '' : 's'}`;
    const matchPart = `${totalMatches} match${totalMatches === 1 ? '' : 'es'}`;
    countParts.push(`${filePart} ${g.dot} ${matchPart}`);
  }
  lines.push(countParts[0]);

  if (data.notice) {
    lines.push(`${g.arrow} ${data.notice}`);
  }

  for (const result of data.results) {
    lines.push('');
    lines.push(shortPath(result.file ?? '', rootPath));
    for (const section of result.relevantSections ?? []) {
      const stripped = section.replace(/^#+\s*/, '');
      lines.push(`  \u00a7 ${stripped}`);
    }
  }

  lines.push('');

  const titlePart = data.query ? `Style Guide: "${data.query}"` : 'Style Guide';
  const boxOut = drawBox(titlePart, lines, BOX_WIDTH);
  console.log('');
  for (const l of boxOut) {
    console.log(l);
  }
  console.log('');
}

export function formatJson(
  json: string,
  useJson: boolean,
  command?: string,
  rootPath?: string,
  query?: string,
  intent?: string
): void {
  if (useJson) {
    console.log(json);
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    console.log(json);
    return;
  }

  // Tools return { status: 'error', message: '...' } in their JSON payload but
  // don't always set isError on the MCP envelope. Route these to stderr before
  // a command formatter would render a misleading empty box.
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).status === 'error'
  ) {
    const d = data as Record<string, unknown>;
    const msg = typeof d.message === 'string' ? d.message : JSON.stringify(d, null, 2);
    process.stderr.write(`Error: ${msg}\n`);
    return;
  }

  switch (command) {
    case 'status': {
      try {
        formatStatus(data as IndexingStatusPayload, rootPath ?? '');
      } catch {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    }
    case 'metadata': {
      try {
        formatMetadata(data as MetadataResponse);
      } catch {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    }
    case 'style-guide': {
      try {
        formatStyleGuide(data as StyleGuideResponse, rootPath ?? '');
      } catch {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    }
    case 'patterns': {
      try {
        formatPatterns(data as PatternResponse);
      } catch {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    }
    case 'search': {
      try {
        formatSearch(data as SearchResponse, rootPath ?? '', query, intent);
      } catch {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    }
    case 'refs': {
      try {
        formatRefs(data as RefsResponse, rootPath ?? '');
      } catch {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    }
    case 'cycles': {
      try {
        formatCycles(data as CyclesResponse, rootPath ?? '');
      } catch {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    }
    default: {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}
