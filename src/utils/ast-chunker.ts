/**
 * AST-Aligned Chunking Engine
 *
 * Produces symbol-bounded chunks from Tree-sitter output instead of
 * arbitrary line-sliced chunks. Each function/method/class becomes its
 * own chunk, with size bounds enforced via merging (tiny) and splitting
 * (oversized) at safe structural boundaries.
 */

import { v4 as uuidv4 } from 'uuid';
import type { TreeSitterSymbol } from './tree-sitter.js';
import type { CodeChunk, ChunkMetadata } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SymbolNode {
  symbol: TreeSitterSymbol;
  children: SymbolNode[];
  parent: SymbolNode | null;
}

export interface ASTChunkOptions {
  minChunkLines: number;
  maxChunkLines: number;
  filePath: string;
  language: string;
  framework?: string;
  componentType?: string;
  includeScopePrefix?: boolean;
}

export const DEFAULT_AST_CHUNK_OPTIONS = {
  minChunkLines: 10,
  maxChunkLines: 150
} as const;

// File ceiling constants: beyond these, AST chunking is skipped in favor of line chunks
export const MAX_AST_CHUNK_FILE_SIZE = 500_000; // 500KB
export const MAX_AST_CHUNK_FILE_LINES = 10_000; // 10K lines

// ---------------------------------------------------------------------------
// Scope Prefix Generation
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable scope prefix for a symbol chunk.
 *
 * Format: `// [scope_path] :: [signature_hint]`
 *
 * Examples:
 * - Top-level function: `// getData :: (id: string): Promise<User>`
 * - Method inside class: `// UserService > getData :: (id: string): Promise<User>`
 * - Standalone constant: `// MAX_RETRIES :: const`
 */
export function generateScopePrefix(node: SymbolNode, ancestors: SymbolNode[]): string {
  // Build scope path: ancestor names joined with " > ", then current node
  const pathParts = node.symbol.symbolPath ?? [
    ...ancestors.map((a) => a.symbol.name),
    node.symbol.name
  ];
  const scopePath = pathParts.join(' > ');

  // Build signature hint from the symbol content
  const hint = extractSignatureHint(node.symbol);

  return `// ${scopePath} :: ${hint}`;
}

/**
 * Extract a short signature hint from a symbol's content.
 */
function extractSignatureHint(sym: Pick<TreeSitterSymbol, 'kind' | 'content'>): string {
  const kind = sym.kind;

  if (kind === 'class') return 'class';
  if (kind === 'interface') return 'interface';
  if (kind === 'type') return 'type';
  if (kind === 'enum') return 'enum';
  if (kind === 'struct') return 'struct';
  if (kind === 'trait') return 'trait';

  // For functions/methods, try to extract parameter list and return type
  if (kind === 'function' || kind === 'method') {
    const content = sym.content;
    // Match params and optional return type: (params): ReturnType
    const match = content.match(/\(([^)]*)\)(?:\s*:\s*([^{=>\n]*))?/);
    if (match) {
      let params = match[1].trim();
      if (params.length > 80) {
        params = params.slice(0, 77) + '...';
      }
      const returnType = match[2]?.trim();
      if (returnType) {
        return `(${params}): ${returnType.slice(0, 40)}`;
      }
      return `(${params})`;
    }
    return 'function';
  }

  // Constants/variables
  return 'const';
}

// ---------------------------------------------------------------------------
// 1. buildSymbolTree
// ---------------------------------------------------------------------------

/**
 * Build a parent/child tree from a flat list of Tree-sitter symbols.
 *
 * A symbol B is a child of A when A fully contains B (A.startLine <= B.startLine
 * AND A.endLine >= B.endLine) and A is the *smallest* such container.
 */
export function buildSymbolTree(symbols: TreeSitterSymbol[]): SymbolNode[] {
  // Sort: startLine ASC, then span DESC (largest first for same start)
  const sorted = [...symbols].sort((a, b) => {
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    return b.endLine - b.startLine - (a.endLine - a.startLine);
  });

  const nodes: SymbolNode[] = sorted.map((s) => ({ symbol: s, children: [], parent: null }));

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    let bestParent: SymbolNode | null = null;
    let bestSpan = Infinity;

    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const candidate = nodes[j];
      const cs = candidate.symbol;
      const ns = node.symbol;

      // Real parser offsets disambiguate nested and sibling symbols on the same line.
      // Synthetic callers without offsets retain the public line-range contract.
      const hasOffsets = cs.endIndex > cs.startIndex && ns.endIndex > ns.startIndex;
      const contains = hasOffsets
        ? cs.startIndex <= ns.startIndex &&
          cs.endIndex >= ns.endIndex &&
          (cs.startIndex !== ns.startIndex || cs.endIndex !== ns.endIndex)
        : cs.startLine <= ns.startLine &&
          cs.endLine >= ns.endLine &&
          !(cs.startLine === ns.startLine && cs.endLine === ns.endLine);
      if (contains) {
        const span = hasOffsets ? cs.endIndex - cs.startIndex : cs.endLine - cs.startLine;
        if (span < bestSpan) {
          bestSpan = span;
          bestParent = candidate;
        }
      }
    }

    if (bestParent) {
      node.parent = bestParent;
      bestParent.children.push(node);
    }
  }

  return nodes.filter((n) => n.parent === null);
}

// ---------------------------------------------------------------------------
// 2. generateASTChunks
// ---------------------------------------------------------------------------

/**
 * Convert Tree-sitter symbols into non-overlapping, full-coverage CodeChunks.
 *
 * - Leaf symbols → one chunk each (symbolAware)
 * - Container symbols → header + child chunks + footer
 * - Gaps between symbols → filler chunks (not symbolAware)
 */
export function generateASTChunks(
  content: string,
  symbols: TreeSitterSymbol[],
  options: ASTChunkOptions
): CodeChunk[] {
  const lines = content.split('\n');
  if (symbols.length === 0) return [makeFillerChunk(lines, 1, lines.length, options)];

  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineStarts.push(i + 1);
  }
  const lineAt = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle;
    }
    return low + 1;
  };
  const ranges = new Map<TreeSitterSymbol, { start: number; end: number }>();
  for (const symbol of symbols) {
    let start = lineStarts[symbol.startLine - 1] ?? content.length;
    let end = symbol.endLine < lineStarts.length ? lineStarts[symbol.endLine] - 1 : content.length;
    if (symbol.endIndex > symbol.startIndex) {
      start = symbol.startIndex;
      end = symbol.endIndex;
      // web-tree-sitter releases may expose byte offsets or UTF-16 offsets.
      // Match the already extracted source rather than guessing from non-ASCII text.
      if (content.slice(start, end) !== symbol.content) {
        const bytes = Buffer.from(content, 'utf8');
        start = bytes.subarray(0, symbol.startIndex).toString('utf8').length;
        end = bytes.subarray(0, symbol.endIndex).toString('utf8').length;
      }
    }
    ranges.set(symbol, { start, end });
  }

  const chunks: CodeChunk[] = [];
  const appendRange = (
    start: number,
    end: number,
    owner?: SymbolNode,
    ancestors: SymbolNode[] = [],
    suffix = ''
  ): void => {
    const originalStart = start;
    const fragment = content.slice(start, end);
    const first = fragment.search(/\S/);
    if (first < 0) return;
    const last = fragment.search(/\s*$/);
    // Drop only whitespace crossing a line boundary. Same-line separators remain
    // exact source; indentation on an adjacent symbol's line is not a body span.
    if (fragment.slice(0, first).includes('\n')) start = lineStarts[lineAt(start + first) - 1];
    if (fragment.slice(last).includes('\n')) end = originalStart + last;
    const startLine = lineAt(start);
    const endLine = lineAt(Math.max(start, end - 1));
    const source = content.slice(start, end);
    if (!owner) {
      chunks.push({ ...makeFillerChunk(lines, startLine, endLine, options), content: source });
      return;
    }
    const symbol = owner.symbol;
    const symbolPath = symbol.symbolPath ?? [
      ...ancestors.map((ancestor) => ancestor.symbol.name),
      symbol.name
    ];
    const chunk = makeSymbolChunk(
      { ...symbol, name: symbol.name + suffix, startLine, endLine, content: source },
      lines,
      options,
      symbolPath,
      symbolPath.at(-2) ?? null,
      true
    );
    if (options.includeScopePrefix !== false)
      chunk.content = generateScopePrefix(owner, ancestors) + '\n' + chunk.content;
    chunks.push(chunk);
  };
  const processNode = (node: SymbolNode, ancestors: SymbolNode[]): void => {
    const range = ranges.get(node.symbol)!;
    const children = [...node.children].sort(
      (a, b) => ranges.get(a.symbol)!.start - ranges.get(b.symbol)!.start
    );
    if (children.length === 0) {
      appendRange(range.start, range.end, node, ancestors);
      return;
    }
    let cursor = range.start;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childRange = ranges.get(child.symbol)!;
      appendRange(cursor, childRange.start, node, ancestors, i === 0 ? ':header' : ':body');
      processNode(child, [...ancestors, node]);
      cursor = childRange.end;
    }
    appendRange(cursor, range.end, node, ancestors, ':footer');
  };
  const roots = buildSymbolTree(symbols).sort(
    (a, b) => ranges.get(a.symbol)!.start - ranges.get(b.symbol)!.start
  );
  let cursor = 0;
  for (const root of roots) {
    const range = ranges.get(root.symbol)!;
    appendRange(cursor, range.start);
    processNode(root, []);
    cursor = range.end;
  }
  appendRange(cursor, content.length);
  return chunks;
}

// ---------------------------------------------------------------------------
// 3. mergeSmallSymbolChunks
// ---------------------------------------------------------------------------

/**
 * Merge adjacent symbol-aware chunks that are both below `minLines` AND share
 * the same parentSymbol (or both have no parent).
 */
export function mergeSmallSymbolChunks(chunks: CodeChunk[], minLines: number): CodeChunk[] {
  if (chunks.length <= 1) return chunks;

  const result: CodeChunk[] = [];
  let current = chunks[0];

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    const curLines = current.endLine - current.startLine + 1;
    const nextLines = next.endLine - next.startLine + 1;
    const curSymAware = current.metadata?.symbolAware === true;
    const nextSymAware = next.metadata?.symbolAware === true;

    const sameParent =
      (current.metadata?.parentSymbol ?? null) === (next.metadata?.parentSymbol ?? null);

    if (curSymAware && nextSymAware && curLines < minLines && nextLines < minLines && sameParent) {
      // Merge
      const mergedName = [current.metadata?.symbolName || '', next.metadata?.symbolName || '']
        .filter(Boolean)
        .join('+');

      current = {
        ...current,
        content: current.content + '\n' + next.content,
        endLine: next.endLine,
        metadata: {
          ...current.metadata,
          symbolName: mergedName,
          merged: true
        }
      };
    } else {
      result.push(current);
      current = next;
    }
  }

  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// 4. splitOversizedChunks
// ---------------------------------------------------------------------------

/**
 * Split any chunk exceeding `maxLines` at safe structural boundaries.
 */
export function splitOversizedChunks(chunks: CodeChunk[], maxLines: number): CodeChunk[] {
  const result: CodeChunk[] = [];
  for (const chunk of chunks) {
    const lineCount = chunk.endLine - chunk.startLine + 1;
    if (lineCount <= maxLines) {
      result.push(chunk);
    } else {
      result.push(...splitChunk(chunk, maxLines));
    }
  }
  return result;
}

function splitChunk(chunk: CodeChunk, maxLines: number): CodeChunk[] {
  const chunkLines = chunk.content.split('\n');
  const lineCount = chunkLines.length;

  if (lineCount <= maxLines) return [chunk];

  // Find safe split point near midpoint
  const mid = Math.floor(lineCount / 2);
  const splitIdx = findSafeSplitPoint(chunkLines, mid);

  const firstContent = chunkLines.slice(0, splitIdx).join('\n');
  const secondContent = chunkLines.slice(splitIdx).join('\n');

  const baseName = chunk.metadata?.symbolName || 'chunk';
  // Strip existing suffix like ":1" before adding new ones
  const cleanName = baseName.replace(/:\d+$/, '');

  const firstChunk: CodeChunk = {
    ...chunk,
    id: uuidv4(),
    content: firstContent,
    endLine: chunk.startLine + splitIdx - 1,
    metadata: {
      ...chunk.metadata,
      symbolName: `${cleanName}:1`
    }
  };

  const secondChunk: CodeChunk = {
    ...chunk,
    id: uuidv4(),
    content: secondContent,
    startLine: chunk.startLine + splitIdx,
    metadata: {
      ...chunk.metadata,
      symbolName: `${cleanName}:2`
    }
  };

  // Recursively split if still oversized
  const result: CodeChunk[] = [];
  result.push(...splitOversizedChunks([firstChunk], maxLines));
  result.push(...splitOversizedChunks([secondChunk], maxLines));

  // Renumber after recursive splits
  if (result.length > 2) {
    for (let i = 0; i < result.length; i++) {
      result[i] = {
        ...result[i],
        metadata: {
          ...result[i].metadata,
          symbolName: `${cleanName}:${i + 1}`
        }
      };
    }
  }

  return result;
}

/**
 * Find a safe split point near `targetIdx`:
 * - Blank line
 * - Comment boundary
 * - Closing brace at same or lesser indent
 */
function findSafeSplitPoint(lines: string[], targetIdx: number): number {
  const windowSize = Math.min(20, Math.floor(lines.length / 4));

  let bestIdx = targetIdx;
  let bestDistance = Infinity;

  // Search in a window around the midpoint
  const lo = Math.max(1, targetIdx - windowSize);
  const hi = Math.min(lines.length - 1, targetIdx + windowSize);

  for (let i = lo; i <= hi; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const isSafe =
      trimmed === '' || /^\s*(\/\/|#|\/\*|\*\/)/.test(line) || trimmed === '}' || trimmed === '};';

    if (isSafe) {
      const dist = Math.abs(i - targetIdx);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestIdx = i + 1; // split *after* this line
      }
    }
  }

  // If no safe point found, hard split at target
  if (bestDistance === Infinity) {
    bestIdx = targetIdx;
  }

  return bestIdx;
}

// ---------------------------------------------------------------------------
// 5. createASTAlignedChunks (public entry point)
// ---------------------------------------------------------------------------

/**
 * Main public API: generate AST-aligned chunks from content + symbols,
 * then split oversized source spans and optionally add presentation context.
 */
export function createASTAlignedChunks(
  content: string,
  symbols: TreeSitterSymbol[],
  options: ASTChunkOptions
): CodeChunk[] {
  // Partition source before adding presentation context. Persisted callers opt out
  // of the final prefix; they receive exactly the same source ranges and bytes.
  const raw = generateASTChunks(content, symbols, { ...options, includeScopePrefix: false });
  // Even identical owner labels can describe distinct declarations. The public
  // merge helper is retained for callers, but persisted source spans stay separate.
  const final = splitOversizedChunks(raw, options.maxChunkLines);
  if (options.includeScopePrefix !== false) {
    const prefixes = new Map<string, string>();
    for (const chunk of raw) {
      if (!chunk.metadata.symbolAware) continue;
      const path = chunk.metadata.symbolPath ?? [];
      const key = JSON.stringify(path);
      if (!prefixes.has(key)) {
        const symbol = symbols.find(
          (candidate) =>
            candidate.name === path.at(-1) &&
            candidate.startLine <= chunk.startLine &&
            candidate.endLine >= chunk.endLine
        );
        prefixes.set(
          key,
          `// ${path.join(' > ')} :: ${extractSignatureHint(symbol ?? { kind: chunk.metadata.symbolKind ?? '', content: chunk.content })}`
        );
      }
    }
    for (const chunk of final) {
      const prefix = prefixes.get(JSON.stringify(chunk.metadata.symbolPath ?? []));
      if (chunk.metadata.symbolAware && prefix) chunk.content = `${prefix}\n${chunk.content}`;
    }
  }
  return final;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractLines(lines: string[], startLine: number, endLine: number): string[] {
  // startLine and endLine are 1-based inclusive
  return lines.slice(startLine - 1, endLine);
}

function makeFillerChunk(
  lines: string[],
  startLine: number,
  endLine: number,
  options: ASTChunkOptions
): CodeChunk {
  const chunkContent = extractLines(lines, startLine, endLine).join('\n');
  return {
    id: uuidv4(),
    content: chunkContent,
    filePath: options.filePath,
    relativePath: options.filePath,
    startLine,
    endLine,
    language: options.language,
    framework: options.framework,
    componentType: options.componentType,
    dependencies: [],
    imports: [],
    exports: [],
    tags: [],
    metadata: {
      chunkStrategy: 'ast-aligned'
    } as ChunkMetadata
  };
}

function makeSymbolChunk(
  sym: TreeSitterSymbol,
  lines: string[],
  options: ASTChunkOptions,
  symbolPath: string[],
  parentName: string | null,
  useProvidedContent = false
): CodeChunk {
  const chunkContent =
    useProvidedContent || sym.endIndex > sym.startIndex
      ? sym.content
      : extractLines(lines, sym.startLine, sym.endLine).join('\n');

  return {
    id: uuidv4(),
    content: chunkContent,
    filePath: options.filePath,
    relativePath: options.filePath,
    startLine: sym.startLine,
    endLine: sym.endLine,
    language: options.language,
    framework: options.framework,
    componentType: options.componentType,
    dependencies: [],
    imports: [],
    exports: [],
    tags: [],
    metadata: {
      symbolAware: true,
      symbolName: sym.name,
      symbolKind: sym.kind,
      symbolPath,
      parentSymbol: parentName ?? undefined,
      chunkStrategy: 'ast-aligned',
      componentName: sym.name
    } as ChunkMetadata
  };
}
