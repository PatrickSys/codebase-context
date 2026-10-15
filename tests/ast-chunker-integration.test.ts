import { describe, expect, it } from 'vitest';
import { GenericAnalyzer } from '../src/analyzers/generic/index';
import { MAX_AST_CHUNK_FILE_LINES } from '../src/utils/ast-chunker';
import { createASTAlignedChunks } from '../src/utils/ast-chunker';
import { extractTreeSitterSymbols } from '../src/utils/tree-sitter';
import structuralFixture from './fixtures/structural-context-regressions.json';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TYPESCRIPT_FIXTURE = `
import { EventEmitter } from 'events';

const MAX_RETRIES = 3;

export class UserService extends EventEmitter {
  private users: Map<string, User> = new Map();

  constructor(private readonly db: Database) {
    super();
    this.init();
  }

  async getById(id: string): Promise<User | null> {
    if (!id) {
      throw new Error('ID required');
    }
    const cached = this.users.get(id);
    if (cached) return cached;
    const user = await this.db.findUser(id);
    if (user) {
      this.users.set(id, user);
    }
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    const user = await this.getById(id);
    if (!user) {
      throw new Error(\`User \${id} not found\`);
    }
    const updated = { ...user, ...data };
    this.users.set(id, updated);
    this.emit('user:updated', updated);
    return updated;
  }

  private init(): void {
    console.log('UserService initialized');
  }
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface Database {
  findUser(id: string): Promise<User | null>;
}

export function createUserService(db: Database): UserService {
  return new UserService(db);
}
`.trim();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const analyzer = new GenericAnalyzer();

describe('frozen structural raw chunks', () => {
  for (const descriptor of [
    {
      name: 'concise-value',
      fields: 'value() { closeConnections(); }',
      markers: ['closeConnections()']
    },
    { name: 'concise-get', fields: 'get() { return readState(); }', markers: ['readState()'] },
    {
      name: 'concise-set',
      fields: 'set(next) { writeState(next); }',
      markers: ['writeState(next)']
    },
    {
      name: 'mixed-accessors',
      fields: 'get() { return readState(); }, set: next => writeState(next), enumerable: true',
      markers: ['readState()', 'writeState(next)']
    }
  ]) {
    it(`keeps the nearest concise descriptor owner with its body: ${descriptor.name}`, async () => {
      const source = `function createHandlers() { return { shutdown: { ${descriptor.fields} }, sibling: { value() { reloadConnections(); } }, services: { billing: { reconcile() { persistInvoice(); } } } }; }`;
      const parsed = await extractTreeSitterSymbols(source, 'javascript');
      expect(parsed).not.toBeNull();
      const owner = parsed!.symbols.find((symbol) => symbol.name === 'shutdown');
      expect(owner).toBeDefined();
      expect(owner!.symbolPath).toEqual(['createHandlers', 'shutdown']);
      expect(owner!.content).toBe(`shutdown: { ${descriptor.fields} }`);
      const chunks = createASTAlignedChunks(source, parsed!.symbols, {
        filePath: '/virtual/concise-descriptor.js',
        language: 'javascript',
        minChunkLines: 10,
        maxChunkLines: 150,
        includeScopePrefix: false
      });
      const implementation = chunks.find((chunk) => chunk.metadata.symbolName === 'shutdown');
      expect(implementation).toBeDefined();
      expect(implementation!.metadata.symbolPath).toEqual(['createHandlers', 'shutdown']);
      expect(implementation!.content).toBe(owner!.content);
      for (const marker of descriptor.markers) expect(implementation!.content).toContain(marker);
      expect(implementation!.content).not.toContain('reloadConnections()');
      expect(implementation!.content).not.toContain('persistInvoice()');
      expect(
        chunks.find((chunk) => chunk.metadata.symbolName === 'reconcile')?.metadata.symbolPath
      ).toEqual(['createHandlers', 'services', 'billing', 'reconcile']);
      expect(
        parsed!.symbols.some(
          (symbol) => symbol.symbolPath?.join('.') === 'createHandlers.shutdown.value'
        )
      ).toBe(false);
    });
  }

  for (const fields of [
    'value() { closeConnections(); }, unknown: true',
    '[operation]() { closeConnections(); }'
  ]) {
    it(`does not coalesce an unresolved descriptor shape: ${fields}`, async () => {
      const source = `function createHandlers() { return { shutdown: { ${fields} } }; }`;
      const parsed = await extractTreeSitterSymbols(source, 'javascript');
      expect(parsed).not.toBeNull();
      expect(parsed!.symbols.some((symbol) => symbol.name === 'shutdown')).toBe(false);
    });
  }

  it('preserves same-line container statements before and after a nested callback', async () => {
    const source = 'function start(){ before(); const hooks={onReady:()=>openQueue()}; after(); }';
    const parsed = await extractTreeSitterSymbols(source, 'javascript');
    const chunks = createASTAlignedChunks(source, parsed!.symbols, {
      filePath: '/virtual/container.js',
      language: 'javascript',
      minChunkLines: 10,
      maxChunkLines: 150,
      includeScopePrefix: false
    });
    expect(chunks.map((chunk) => chunk.content).join('')).toBe(source);
    const callback = chunks.find((chunk) => chunk.metadata.symbolName === 'onReady');
    expect(callback).toBeDefined();
    expect(callback!.content).toContain('openQueue()');
    expect(callback!.content).not.toContain('before()');
    expect(callback!.content).not.toContain('after()');
    for (const chunk of chunks) {
      expect(chunk.startLine).toBe(1);
      expect(chunk.endLine).toBe(1);
      expect(source).toContain(chunk.content);
    }
  });

  for (const fixture of structuralFixture.cases) {
    it(`keeps raw owner bodies isolated: ${fixture.id}`, async () => {
      const parsed = await extractTreeSitterSymbols(fixture.source, fixture.language);
      expect(parsed).not.toBeNull();
      const chunks = createASTAlignedChunks(fixture.source, parsed!.symbols, {
        filePath: '/virtual/structural.ts',
        language: fixture.language,
        minChunkLines: 10,
        maxChunkLines: 150,
        includeScopePrefix: false
      });
      for (const fact of fixture.sourceSymbols) {
        if ('scopeOnly' in fact && fact.scopeOnly) {
          expect(
            chunks.some((chunk) =>
              fact.bodyMarkers.every((marker) => chunk.content.includes(marker))
            )
          ).toBe(true);
          continue;
        }
        const matching = chunks.filter(
          (chunk) => JSON.stringify(chunk.metadata.symbolPath) === JSON.stringify(fact.ownerChain)
        );
        expect(matching.length, `${fixture.id}: ${fact.ownerChain.join(' > ')}`).toBeGreaterThan(0);
        for (const marker of fact.bodyMarkers)
          expect(matching.some((chunk) => chunk.content.includes(marker))).toBe(true);
        for (const chunk of matching) {
          expect(fixture.source).toContain(chunk.content);
          if ('forbiddenSiblingBodyMarkers' in fact) {
            for (const marker of fact.forbiddenSiblingBodyMarkers ?? [])
              expect(chunk.content).not.toContain(marker);
          }
        }
      }
    });
  }

  it('coalesces only an immediate callable descriptor, without swallowing singleton wrappers', async () => {
    const source = [
      'function buildHandlers() {',
      '  return {',
      '    shutdown: {',
      '      configurable: true,',
      '      value: () => { closeConnections(); }',
      '    },',
      '    services: { billing: { reconcile: () => persistInvoice() } }',
      '  };',
      '}'
    ].join('\n');
    const parsed = await extractTreeSitterSymbols(source, 'javascript');
    const chunks = createASTAlignedChunks(source, parsed!.symbols, {
      filePath: '/virtual/descriptor.js',
      language: 'javascript',
      minChunkLines: 10,
      maxChunkLines: 150,
      includeScopePrefix: false
    });
    const shutdown = chunks.find((chunk) => chunk.metadata.symbolName === 'shutdown');
    expect(shutdown).toBeDefined();
    expect(shutdown!.content).toContain('shutdown: {');
    expect(shutdown!.content).toContain('closeConnections()');
    expect(shutdown!.content).not.toContain('persistInvoice()');
    const reconcile = chunks.find((chunk) => chunk.metadata.symbolName === 'reconcile');
    expect(reconcile).toBeDefined();
    expect(reconcile!.content).not.toContain('services:');
    expect(reconcile!.content).not.toContain('billing:');
  });

  it('splits raw source before display prefixes without shifting source coordinates', async () => {
    const source = [
      'function consume() {',
      '// consume :: ()',
      ...Array.from({ length: 175 }, (_, i) => `  step${i}();`),
      '}'
    ].join('\n');
    const parsed = await extractTreeSitterSymbols(source, 'javascript');
    const options = {
      filePath: '/virtual/large.js',
      language: 'javascript',
      minChunkLines: 10,
      maxChunkLines: 35
    };
    const raw = createASTAlignedChunks(source, parsed!.symbols, {
      ...options,
      includeScopePrefix: false
    });
    const displayed = createASTAlignedChunks(source, parsed!.symbols, options);
    expect(displayed.map(({ startLine, endLine }) => [startLine, endLine])).toEqual(
      raw.map(({ startLine, endLine }) => [startLine, endLine])
    );
    for (const chunk of raw) {
      expect(chunk.content).toBe(
        source
          .split('\n')
          .slice(chunk.startLine - 1, chunk.endLine)
          .join('\n')
      );
      expect(chunk.endLine - chunk.startLine + 1).toBeLessThanOrEqual(35);
    }
    expect(raw.map((chunk) => chunk.content).join('\n')).toBe(source);
    expect(raw[0].content).toContain('// consume :: ()');
  });
});

describe('AST Chunker Integration', () => {
  // Test 1: Supported language, normal file — AST chunks with scope prefixes
  it('produces AST-aligned chunks with scope prefixes for a normal TypeScript file', async () => {
    const result = await analyzer.analyze('/virtual/user-service.ts', TYPESCRIPT_FIXTURE);

    expect(result.metadata.chunkStrategy).toBe('ast-aligned');
    expect(result.metadata.symbolAware).toBe(true);

    // Should have symbol-aware chunks
    const symbolChunks = result.chunks.filter((c) => c.metadata?.symbolAware === true);
    expect(symbolChunks.length).toBeGreaterThan(0);

    // Check key symbols exist
    const names = symbolChunks.map((c) => c.metadata.symbolName);
    expect(names.some((n) => n?.includes('getById'))).toBe(true);
    expect(names.some((n) => n?.includes('updateUser'))).toBe(true);
    expect(names.some((n) => n?.includes('createUserService'))).toBe(true);

    // Every symbol chunk should have a scope prefix (starts with //)
    for (const chunk of symbolChunks) {
      expect(chunk.content.startsWith('//')).toBe(true);
    }
  });

  // Test 2: Oversized file — falls back to line chunks
  it('falls back to line-based chunking for oversized files (>10K lines)', async () => {
    // Generate a large file exceeding MAX_AST_CHUNK_FILE_LINES
    const bigLines: string[] = [];
    bigLines.push('// Large generated file');
    for (let i = 1; i <= MAX_AST_CHUNK_FILE_LINES + 100; i++) {
      bigLines.push(`export const var_${i} = ${i};`);
    }
    const bigContent = bigLines.join('\n');

    const result = await analyzer.analyze('/virtual/huge-file.ts', bigContent);

    // Should NOT be ast-aligned due to file ceiling
    expect(result.chunks.length).toBeGreaterThan(0);

    // Chunks should be produced (via line/component fallback)
    const hasAstAligned = result.chunks.some((c) => c.metadata?.chunkStrategy === 'ast-aligned');
    expect(hasAstAligned).toBe(false);
  });

  // Test 3: Parse error simulation — fallback, no crash
  it('falls back gracefully on files with syntax errors', async () => {
    // Content with syntax errors that cause Tree-sitter hasError
    const badContent = [
      'export class Broken {',
      '  method() {',
      '    const x = {{{{{;', // severe syntax error
      '    return \\\\\\\\;',
      '  }',
      '  another() {',
      '    return 42;',
      '  }',
      '}'
    ].join('\n');

    // Should not throw
    const result = await analyzer.analyze('/virtual/broken.ts', badContent);

    // Chunks should still be produced (via fallback)
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  // Test 4: Unsupported language — regex/line fallback
  it('produces chunks via fallback for unsupported languages (.rb)', async () => {
    const rubyContent = [
      'class Calculator',
      '  def add(a, b)',
      '    a + b',
      '  end',
      '',
      '  def subtract(a, b)',
      '    a - b',
      '  end',
      'end',
      '',
      'def standalone_function(x)',
      '  x * 2',
      'end'
    ].join('\n');

    const result = await analyzer.analyze('/virtual/calculator.rb', rubyContent);

    // Chunks produced
    expect(result.chunks.length).toBeGreaterThan(0);

    // Should NOT be ast-aligned (Ruby has no grammar)
    expect(result.metadata.chunkStrategy).toBe('line-or-component');
    expect(result.metadata.symbolAware).toBeUndefined();

    // No chunk should have AST-related metadata
    for (const chunk of result.chunks) {
      expect(chunk.metadata?.symbolAware).not.toBe(true);
    }
  });

  // Test 5: Scope prefix correctness — nested class > method format
  it('generates correct scope prefix format for nested symbols', async () => {
    const result = await analyzer.analyze('/virtual/user-service.ts', TYPESCRIPT_FIXTURE);

    const symbolChunks = result.chunks.filter((c) => c.metadata?.symbolAware === true);

    // Find a method chunk inside UserService
    const getByIdChunk = symbolChunks.find((c) => c.metadata.symbolName === 'getById');
    if (getByIdChunk) {
      // Should have prefix format: // UserService > getById :: (...)
      const firstLine = getByIdChunk.content.split('\n')[0];
      expect(firstLine).toMatch(/\/\/\s*UserService\s*>\s*getById\s*::/);
    }

    // Find standalone function chunk
    const createChunk = symbolChunks.find((c) =>
      c.metadata.symbolName?.includes('createUserService')
    );
    if (createChunk) {
      // Should have prefix format: // createUserService :: (...)
      const firstLine = createChunk.content.split('\n')[0];
      expect(firstLine).toMatch(/\/\/\s*createUserService\s*::/);
      // Should NOT have parent path separator
      expect(firstLine).not.toMatch(/>/);
    }
  });

  // Test 6: Full coverage verification — chunks cover the file with small
  // structural gaps only where container headers/footers are below the
  // 2-non-blank-line threshold.
  it('AST chunks cover the file with at most small structural gaps', async () => {
    const result = await analyzer.analyze('/virtual/user-service.ts', TYPESCRIPT_FIXTURE);

    // Only check when we get AST-aligned chunks
    expect(result.metadata.chunkStrategy).toBe('ast-aligned');

    const sorted = [...result.chunks].sort((a, b) => a.startLine - b.startLine);
    const totalLines = TYPESCRIPT_FIXTURE.split('\n').length;

    // Collect all line numbers covered by chunks
    const coveredLines = new Set<number>();
    for (const chunk of sorted) {
      for (let line = chunk.startLine; line <= chunk.endLine; line++) {
        coveredLines.add(line);
      }
    }

    // Count uncovered lines — should be minimal (small headers/footers below threshold)
    const allLines = TYPESCRIPT_FIXTURE.split('\n');
    const uncoveredLines: number[] = [];
    for (let i = 1; i <= totalLines; i++) {
      if (!coveredLines.has(i)) {
        uncoveredLines.push(i);
      }
    }

    // Uncovered lines should be small structural fragments (class opening/closing braces, etc.)
    // Allow up to 15% uncovered for container header/footer gaps
    const uncoveredPct = (uncoveredLines.length / totalLines) * 100;
    expect(uncoveredPct).toBeLessThan(15);

    // Every uncovered line should be structurally trivial (blank, brace, or short header)
    for (const lineNum of uncoveredLines) {
      const line = allLines[lineNum - 1].trim();
      const isTrivial = line === '' || line === '}' || line === '};' || line.length < 60;
      expect(isTrivial).toBe(true);
    }

    // Verify no overlapping line ranges
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startLine).toBeGreaterThan(sorted[i - 1].endLine);
    }

    // Content from chunks (minus scope prefixes) should contain all significant source lines
    const chunkContent: string[] = [];
    for (const chunk of sorted) {
      const lines = chunk.content.split('\n');
      for (const line of lines) {
        // Skip scope prefix lines
        if (line.match(/^\/\/\s*.+\s*::\s*.+/) && !TYPESCRIPT_FIXTURE.includes(line)) {
          continue;
        }
        chunkContent.push(line);
      }
    }
    const joined = chunkContent.join('\n');

    // All important function/class names must be present in reconstructed content
    // Note: 'class UserService' may be in a dropped header (<= 2 non-blank lines)
    // but the methods and standalone functions must be present
    expect(joined).toContain('async getById');
    expect(joined).toContain('async updateUser');
    expect(joined).toContain('function createUserService');
  });
});
