import { describe, expect, it } from 'vitest';
import type { TreeSitterSymbol } from '../src/utils/tree-sitter.js';
import {
  buildSymbolTree,
  generateASTChunks,
  mergeSmallSymbolChunks,
  splitOversizedChunks,
  createASTAlignedChunks,
  type ASTChunkOptions
} from '../src/utils/ast-chunker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sym(name: string, kind: string, startLine: number, endLine: number): TreeSitterSymbol {
  const lines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    lines.push(`// line ${i} of ${name}`);
  }
  return {
    name,
    kind,
    startLine,
    endLine,
    declarationStartLine: startLine,
    declarationEndLine: endLine,
    declarationStartIndex: 0,
    declarationEndIndex: 0,
    startIndex: 0,
    endIndex: 0,
    content: lines.join('\n'),
    nodeType:
      kind === 'function'
        ? 'function_declaration'
        : kind === 'class'
          ? 'class_declaration'
          : 'method_definition'
  };
}

function makeContent(totalLines: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= totalLines; i++) {
    lines.push(`// line ${i}`);
  }
  return lines.join('\n');
}

const defaultOptions: ASTChunkOptions = {
  minChunkLines: 10,
  maxChunkLines: 150,
  filePath: '/test/file.ts',
  language: 'typescript',
  framework: 'generic',
  componentType: 'module'
};

// ---------------------------------------------------------------------------
// buildSymbolTree
// ---------------------------------------------------------------------------

describe('buildSymbolTree', () => {
  it('flat symbols produce root nodes with no children', () => {
    const symbols = [
      sym('funcA', 'function', 1, 10),
      sym('funcB', 'function', 12, 20),
      sym('funcC', 'function', 22, 30)
    ];

    const roots = buildSymbolTree(symbols);

    expect(roots).toHaveLength(3);
    for (const root of roots) {
      expect(root.children).toHaveLength(0);
      expect(root.parent).toBeNull();
    }
  });

  it('nested class with methods produces 1 root with 2 children', () => {
    const symbols = [
      sym('MyClass', 'class', 1, 30),
      sym('methodA', 'method', 5, 15),
      sym('methodB', 'method', 17, 28)
    ];

    const roots = buildSymbolTree(symbols);

    expect(roots).toHaveLength(1);
    expect(roots[0].symbol.name).toBe('MyClass');
    expect(roots[0].children).toHaveLength(2);
    expect(roots[0].children[0].symbol.name).toBe('methodA');
    expect(roots[0].children[1].symbol.name).toBe('methodB');
  });

  it('mixed: module-level function + class with methods', () => {
    const symbols = [
      sym('helperFn', 'function', 1, 8),
      sym('MyClass', 'class', 10, 40),
      sym('doStuff', 'method', 15, 25),
      sym('cleanup', 'method', 27, 38)
    ];

    const roots = buildSymbolTree(symbols);

    expect(roots).toHaveLength(2);
    const fnRoot = roots.find((r) => r.symbol.name === 'helperFn')!;
    const classRoot = roots.find((r) => r.symbol.name === 'MyClass')!;
    expect(fnRoot.children).toHaveLength(0);
    expect(classRoot.children).toHaveLength(2);
  });

  it('overlapping non-nested symbols are treated as siblings', () => {
    // Two functions that don't fully contain each other
    const symbols = [sym('funcA', 'function', 1, 15), sym('funcB', 'function', 10, 25)];

    const roots = buildSymbolTree(symbols);

    // Neither fully contains the other, so both are roots
    expect(roots).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// generateASTChunks
// ---------------------------------------------------------------------------

describe('generateASTChunks', () => {
  it('3 leaf functions → 3 symbol chunks + filler chunks', () => {
    const content = makeContent(35);
    const symbols = [
      sym('funcA', 'function', 3, 10),
      sym('funcB', 'function', 15, 22),
      sym('funcC', 'function', 27, 34)
    ];

    const chunks = generateASTChunks(content, symbols, defaultOptions);

    // Symbol chunks
    const symbolChunks = chunks.filter((c) => c.metadata?.symbolAware === true);
    expect(symbolChunks).toHaveLength(3);
    expect(symbolChunks[0].metadata.symbolName).toBe('funcA');
    expect(symbolChunks[1].metadata.symbolName).toBe('funcB');
    expect(symbolChunks[2].metadata.symbolName).toBe('funcC');

    // Filler chunks (prefix, gaps, suffix)
    const fillerChunks = chunks.filter((c) => c.metadata?.symbolAware !== true);
    expect(fillerChunks.length).toBeGreaterThan(0);
  });

  it('class with 3 methods → method chunks + possible header/footer', () => {
    // Class spanning lines 1-50 with 3 methods inside
    const content = makeContent(50);
    const symbols = [
      sym('MyClass', 'class', 1, 50),
      sym('init', 'method', 10, 20),
      sym('process', 'method', 22, 35),
      sym('cleanup', 'method', 37, 48)
    ];

    const chunks = generateASTChunks(content, symbols, defaultOptions);

    const symbolChunks = chunks.filter((c) => c.metadata?.symbolAware === true);
    // Should have at least 3 method chunks + header
    expect(symbolChunks.length).toBeGreaterThanOrEqual(3);

    const methodNames = symbolChunks.map((c) => c.metadata.symbolName);
    expect(methodNames).toContain('init');
    expect(methodNames).toContain('process');
    expect(methodNames).toContain('cleanup');
  });

  it('full file coverage: no gaps, no overlaps', () => {
    const totalLines = 40;
    const content = makeContent(totalLines);
    const symbols = [sym('funcA', 'function', 5, 15), sym('funcB', 'function', 20, 35)];

    const chunks = generateASTChunks(content, symbols, defaultOptions);

    // Sort by startLine
    const sorted = [...chunks].sort((a, b) => a.startLine - b.startLine);

    // First chunk starts at line 1
    expect(sorted[0].startLine).toBe(1);

    // Last chunk ends at totalLines
    expect(sorted[sorted.length - 1].endLine).toBe(totalLines);

    // No overlaps: each chunk starts >= previous chunk end
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startLine).toBeGreaterThan(sorted[i - 1].endLine);
    }

    // Full coverage: no gaps
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startLine).toBe(sorted[i - 1].endLine + 1);
    }
  });

  it('symbol chunks have correct metadata', () => {
    const content = makeContent(20);
    const symbols = [sym('helperFn', 'function', 3, 18)];

    const chunks = generateASTChunks(content, symbols, defaultOptions);

    const symChunk = chunks.find((c) => c.metadata?.symbolAware === true);
    expect(symChunk).toBeDefined();
    expect(symChunk!.metadata.symbolName).toBe('helperFn');
    expect(symChunk!.metadata.symbolKind).toBe('function');
    expect(symChunk!.metadata.chunkStrategy).toBe('ast-aligned');
    expect(symChunk!.metadata.symbolPath).toEqual(['helperFn']);
  });

  it('gap/filler chunks do not have symbolAware', () => {
    const content = makeContent(30);
    const symbols = [sym('funcA', 'function', 10, 20)];

    const chunks = generateASTChunks(content, symbols, defaultOptions);

    const fillers = chunks.filter((c) => c.metadata?.symbolAware !== true);
    expect(fillers.length).toBeGreaterThan(0);
    for (const f of fillers) {
      expect(f.metadata.symbolAware).toBeUndefined();
    }
  });

  it('no symbols: entire file becomes one filler chunk', () => {
    const content = makeContent(10);
    const chunks = generateASTChunks(content, [], defaultOptions);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(10);
    expect(chunks[0].metadata.symbolAware).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mergeSmallSymbolChunks
// ---------------------------------------------------------------------------

describe('mergeSmallSymbolChunks', () => {
  it('two tiny adjacent leaf symbols → merged', () => {
    const content = makeContent(12);
    const symbols = [sym('tiny1', 'function', 1, 5), sym('tiny2', 'function', 6, 12)];

    const chunks = generateASTChunks(content, symbols, defaultOptions);
    const merged = mergeSmallSymbolChunks(chunks, 10);

    // The two symbol chunks should be merged since both < 10 lines
    const symbolChunks = merged.filter((c) => c.metadata?.symbolAware === true);
    expect(symbolChunks).toHaveLength(1);
    expect(symbolChunks[0].metadata.symbolName).toContain('tiny1');
    expect(symbolChunks[0].metadata.symbolName).toContain('tiny2');
    expect(symbolChunks[0].metadata.merged).toBe(true);
  });

  it('tiny symbol next to normal symbol → no merge', () => {
    const content = makeContent(25);
    const symbols = [sym('tiny', 'function', 1, 5), sym('normal', 'function', 6, 25)];

    const chunks = generateASTChunks(content, symbols, defaultOptions);
    const merged = mergeSmallSymbolChunks(chunks, 10);

    const symbolChunks = merged.filter((c) => c.metadata?.symbolAware === true);
    expect(symbolChunks).toHaveLength(2);
  });

  it('tiny symbols with different parents → NOT merged', () => {
    // Two small methods in different classes
    const content = makeContent(40);
    const symbols = [
      sym('ClassA', 'class', 1, 20),
      sym('method1', 'method', 3, 8),
      sym('ClassB', 'class', 21, 40),
      sym('method2', 'method', 23, 28)
    ];

    const chunks = generateASTChunks(content, symbols, defaultOptions);
    const merged = mergeSmallSymbolChunks(chunks, 10);

    // method1 (parent=ClassA) and method2 (parent=ClassB) should NOT merge
    const methodChunks = merged.filter(
      (c) =>
        c.metadata?.symbolAware === true &&
        !c.metadata?.symbolName?.includes(':header') &&
        !c.metadata?.symbolName?.includes(':footer')
    );
    // Each method should remain separate
    const m1 = methodChunks.find((c) => c.metadata.symbolName?.includes('method1'));
    const m2 = methodChunks.find((c) => c.metadata.symbolName?.includes('method2'));
    expect(m1).toBeDefined();
    expect(m2).toBeDefined();
  });

  it('already-adequate symbols → unchanged', () => {
    const content = makeContent(30);
    const symbols = [sym('funcA', 'function', 1, 15), sym('funcB', 'function', 16, 30)];

    const chunks = generateASTChunks(content, symbols, defaultOptions);
    const original = chunks.filter((c) => c.metadata?.symbolAware === true);
    const merged = mergeSmallSymbolChunks(chunks, 10);
    const after = merged.filter((c) => c.metadata?.symbolAware === true);

    expect(after).toHaveLength(original.length);
  });
});

// ---------------------------------------------------------------------------
// splitOversizedChunks
// ---------------------------------------------------------------------------

describe('splitOversizedChunks', () => {
  it('200-line function (maxLines=150) → split into 2 pieces', () => {
    const content = makeContent(200);
    const symbols = [sym('bigFunc', 'function', 1, 200)];

    const chunks = generateASTChunks(content, symbols, { ...defaultOptions, maxChunkLines: 150 });
    const split = splitOversizedChunks(chunks, 150);

    const symbolChunks = split.filter((c) => c.metadata?.symbolAware === true);
    expect(symbolChunks.length).toBeGreaterThanOrEqual(2);

    for (const c of symbolChunks) {
      const lineCount = c.endLine - c.startLine + 1;
      expect(lineCount).toBeLessThanOrEqual(150);
    }
  });

  it('100-line function (maxLines=150) → unchanged', () => {
    const content = makeContent(100);
    const symbols = [sym('normalFunc', 'function', 1, 100)];

    const chunks = generateASTChunks(content, symbols, defaultOptions);
    const split = splitOversizedChunks(chunks, 150);

    const symbolChunks = split.filter((c) => c.metadata?.symbolAware === true);
    expect(symbolChunks).toHaveLength(1);
  });

  it('400-line function → split into 3+ pieces', () => {
    const content = makeContent(400);
    const symbols = [sym('hugeFunc', 'function', 1, 400)];

    const chunks = generateASTChunks(content, symbols, { ...defaultOptions, maxChunkLines: 150 });
    const split = splitOversizedChunks(chunks, 150);

    const symbolChunks = split.filter((c) => c.metadata?.symbolAware === true);
    expect(symbolChunks.length).toBeGreaterThanOrEqual(3);

    for (const c of symbolChunks) {
      const lineCount = c.endLine - c.startLine + 1;
      expect(lineCount).toBeLessThanOrEqual(150);
    }
  });

  it('split preserves symbolAware on all pieces', () => {
    const content = makeContent(300);
    const symbols = [sym('bigFunc', 'function', 1, 300)];

    const chunks = generateASTChunks(content, symbols, defaultOptions);
    const split = splitOversizedChunks(chunks, 150);

    const symbolChunks = split.filter((c) => c.metadata?.symbolAware === true);
    for (const c of symbolChunks) {
      expect(c.metadata.symbolAware).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// createASTAlignedChunks (integration)
// ---------------------------------------------------------------------------

describe('createASTAlignedChunks', () => {
  it('full pipeline: class + methods + standalone functions', () => {
    const content = makeContent(60);
    const symbols = [
      sym('helperUtil', 'function', 1, 8),
      sym('DataService', 'class', 10, 50),
      sym('constructor', 'method', 15, 22),
      sym('fetchData', 'method', 24, 35),
      sym('transform', 'method', 37, 48),
      sym('standalone', 'function', 52, 60)
    ];

    const chunks = createASTAlignedChunks(content, symbols, defaultOptions);

    // All chunks should be valid
    expect(chunks.length).toBeGreaterThan(0);

    // No overlaps
    const sorted = [...chunks].sort((a, b) => a.startLine - b.startLine);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startLine).toBeGreaterThan(sorted[i - 1].endLine);
    }

    // Full coverage
    expect(sorted[0].startLine).toBe(1);
    expect(sorted[sorted.length - 1].endLine).toBe(60);

    // Check metadata on symbol chunks
    const symChunks = chunks.filter((c) => c.metadata?.symbolAware === true);
    const names = symChunks.map((c) => c.metadata.symbolName);
    expect(names).toContain('helperUtil');
    expect(names).toContain('standalone');
    // Method names should be present
    expect(names.some((n) => n?.includes('constructor'))).toBe(true);
    expect(names.some((n) => n?.includes('fetchData'))).toBe(true);
    expect(names.some((n) => n?.includes('transform'))).toBe(true);
  });

  it('all chunks have chunkStrategy ast-aligned', () => {
    const content = makeContent(30);
    const symbols = [sym('funcA', 'function', 5, 15), sym('funcB', 'function', 20, 28)];

    const chunks = createASTAlignedChunks(content, symbols, defaultOptions);

    for (const chunk of chunks) {
      expect(chunk.metadata.chunkStrategy).toBe('ast-aligned');
    }
  });

  it('chunks have correct filePath and language', () => {
    const content = makeContent(20);
    const symbols = [sym('fn', 'function', 1, 20)];

    const chunks = createASTAlignedChunks(content, symbols, defaultOptions);

    for (const chunk of chunks) {
      expect(chunk.filePath).toBe('/test/file.ts');
      expect(chunk.language).toBe('typescript');
    }
  });
});
