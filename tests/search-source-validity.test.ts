import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { CodebaseSearcher, type SearchOptions } from '../src/core/search.js';
import { analyzerRegistry } from '../src/core/analyzer-registry.js';
import { GenericAnalyzer } from '../src/analyzers/generic/index.js';
import { IndexCorruptedError } from '../src/errors/index.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  HEALTH_FILENAME,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  MANIFEST_FILENAME,
  MEMORY_FILENAME,
  VECTOR_DB_DIRNAME
} from '../src/constants/codebase-context.js';
import { findSymbolReferences } from '../src/core/symbol-references.js';
import type { CodeChunk, SearchResult } from '../src/types/index.js';
import { handle as searchCodebase } from '../src/tools/search-codebase.js';
import type { SearchResponse, ToolContext } from '../src/tools/types.js';

const KEYWORD_ONLY_OPTIONS: SearchOptions = {
  useSemanticSearch: false,
  useKeywordSearch: true,
  enableQueryExpansion: false,
  enableLowConfidenceRescue: false,
  enableReranker: false,
  profile: 'explore'
};

function isContained(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

async function indexProject(rootPath: string, extraFileExtensions: string[] = []): Promise<void> {
  const indexer = new CodebaseIndexer({
    rootPath,
    config: {
      skipEmbedding: true,
      embedding: { provider: 'openai', model: 'text-embedding-3-small' },
      parsing: { maxFileSize: 1024 * 1024 }
    },
    projectOptions: {
      preferredAnalyzer: 'generic',
      extraFileExtensions
    }
  });
  await indexer.index();
}

async function createSourceFile(
  rootPath: string,
  relativePath: string,
  content: string
): Promise<void> {
  const filePath = path.join(rootPath, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

function searchContext(rootPath: string): ToolContext {
  const baseDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
  return {
    rootPath,
    indexState: { status: 'ready' },
    paths: {
      baseDir,
      keywordIndex: path.join(baseDir, KEYWORD_INDEX_FILENAME),
      intelligence: path.join(baseDir, INTELLIGENCE_FILENAME),
      memory: path.join(baseDir, MEMORY_FILENAME),
      health: path.join(baseDir, HEALTH_FILENAME),
      vectorDb: path.join(baseDir, VECTOR_DB_DIRNAME)
    },
    performIndexing: vi.fn()
  };
}

async function expectSearchResultsOpenInsideRoot(
  rootPath: string,
  results: SearchResult[],
  expectedRelativePath: string
): Promise<void> {
  expect(results.length).toBeGreaterThan(0);
  for (const result of results) {
    expect(path.isAbsolute(result.filePath)).toBe(true);
    expect(isContained(rootPath, result.filePath)).toBe(true);
    expect(path.relative(rootPath, result.filePath).replace(/\\/g, '/')).toBe(expectedRelativePath);
    const source = await fs.readFile(result.filePath, 'utf8');
    const sourceLines = source.replace(/\r\n/g, '\n').split('\n');
    const indexedRange = sourceLines.slice(result.startLine - 1, result.endLine).join('\n');
    expect(indexedRange).toContain('quartzBeacon');
    expect(indexedRange).toContain(result.snippet.replace(/\n\n\.\.\. \[\d+ more lines\]$/, ''));
    expect(result.startLine).toBeGreaterThan(0);
    expect(result.endLine).toBeGreaterThanOrEqual(result.startLine);
  }
}

describe('search source-path validity', () => {
  let tempRoot: string;
  let originalEmbeddingProvider: string | undefined;
  let originalOpenAiKey: string | undefined;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-search-source-validity-'));
    originalEmbeddingProvider = process.env.EMBEDDING_PROVIDER;
    originalOpenAiKey = process.env.OPENAI_API_KEY;
    // CodebaseSearcher uses its real provider-selection path, which fails closed before any
    // network request when OpenAI is selected without a key; keyword search remains available.
    process.env.EMBEDDING_PROVIDER = 'openai';
    delete process.env.OPENAI_API_KEY;
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    analyzerRegistry.register(new GenericAnalyzer());
  });

  afterEach(async () => {
    consoleWarnSpy.mockRestore();
    if (originalEmbeddingProvider === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = originalEmbeddingProvider;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it.each(['changed', 'deleted', 'unreadable'] as const)(
    'keeps a fresh lower nominee when the top source is %s without rebuilding',
    async (drift) => {
      const rootPath = path.join(tempRoot, drift);
      const topPath = path.join(rootPath, 'src/quartzBeacon.ts');
      await createSourceFile(
        rootPath,
        'src/quartzBeacon.ts',
        'export function quartzBeacon() { return "old top"; }\n'
      );
      await createSourceFile(
        rootPath,
        'src/support.ts',
        'export function support() { return quartzBeacon(); }\n'
      );
      await indexProject(rootPath);
      const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
      const indexBefore = await fs.readFile(indexPath, 'utf8');
      if (drift === 'changed') await fs.writeFile(topPath, 'export const changed = true;\n');
      if (drift === 'deleted') await fs.rm(topPath);
      const readFile = fs.readFile.bind(fs);
      const readSpy =
        drift === 'unreadable'
          ? vi
              .spyOn(fs, 'readFile')
              .mockImplementation((...args: Parameters<typeof fs.readFile>) => {
                if (path.resolve(String(args[0])) === path.resolve(topPath)) {
                  return Promise.reject(
                    Object.assign(new Error('Permission denied'), { code: 'EACCES' })
                  );
                }
                return readFile(...args);
              })
          : undefined;
      try {
        const ctx = searchContext(rootPath);
        const response = await searchCodebase(
          { query: 'quartzBeacon', limit: 1, intent: 'edit' },
          ctx
        );
        const payload = JSON.parse(response.content![0].text) as SearchResponse;
        expect(payload.status).toBe('success');
        expect(payload.results).toHaveLength(1);
        expect(payload.results[0].file).toContain('support.ts:');
        expect(payload.sourceCoverage).toMatchObject({
          status: 'partial',
          checkedFiles: 2,
          skippedFiles: 1
        });
        expect(payload.preflight?.ready).toBe(false);
        expect(payload.preflight?.nextAction).toMatch(/refresh/i);
        expect(JSON.stringify(payload)).not.toContain('old top');
        expect(ctx.performIndexing).not.toHaveBeenCalled();
        expect(await fs.readFile(indexPath, 'utf8')).toBe(indexBefore);
      } finally {
        readSpy?.mockRestore();
      }
    }
  );

  it.each(['compact', 'full'])(
    'distinguishes stale-only evidence from no nominations in %s mode',
    async (mode) => {
      const rootPath = path.join(tempRoot, mode);
      await createSourceFile(
        rootPath,
        'src/quartzBeacon.ts',
        'export function quartzBeacon() { return "old top"; }\n'
      );
      await indexProject(rootPath);
      await fs.writeFile(
        path.join(rootPath, 'src/quartzBeacon.ts'),
        'export const different = true;\n'
      );
      const ctx = searchContext(rootPath);
      const stale = await searchCodebase({ query: 'quartzBeacon', mode }, ctx);
      const payload = JSON.parse(stale.content![0].text) as SearchResponse & { message: string };
      expect(payload.status).toBe('no_fresh_results');
      expect(payload.message).toMatch(/no fresh/i);
      expect(payload.sourceCoverage).toMatchObject({ status: 'no_fresh_results', skippedFiles: 1 });
      expect(payload.sourceCoverage?.refreshAction).toMatch(/refresh_index/);
      expect(payload.results).toEqual([]);
      expect(payload.preflight).toBeUndefined();
      expect(ctx.performIndexing).not.toHaveBeenCalled();
      expect(JSON.stringify(payload)).not.toContain('old top');
      for (const intent of ['edit', 'refactor', 'migrate'] as const) {
        const guarded = await searchCodebase({ query: 'quartzBeacon', mode, intent }, ctx);
        const guardedPayload = JSON.parse(guarded.content![0].text) as SearchResponse;
        expect(guardedPayload.status).toBe('no_fresh_results');
        expect(guardedPayload.sourceCoverage?.status).toBe('no_fresh_results');
        expect(guardedPayload.preflight?.ready).toBe(false);
      }
      const empty = await searchCodebase({ query: 'nonexistentUnrelatedNomination', mode }, ctx);
      const emptyPayload = JSON.parse(empty.content![0].text) as SearchResponse;
      expect(emptyPayload.status).toBe('success');
      expect(emptyPayload.results).toEqual([]);
      expect(emptyPayload.sourceCoverage).toBeUndefined();
    }
  );

  it('rejects an injected nominee absent from the manifest even with a fresh lower result', async () => {
    const rootPath = path.join(tempRoot, 'injected source');
    await createSourceFile(rootPath, 'src/quartzBeacon.ts', 'export const quartzBeacon = true;\n');
    await indexProject(rootPath);
    const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as { chunks: CodeChunk[] };
    await createSourceFile(
      rootPath,
      'src/injected.ts',
      'export const quartzBeacon = "injected";\n'
    );
    index.chunks.push({
      ...index.chunks[0],
      id: 'injected',
      filePath: path.join(rootPath, 'src/injected.ts'),
      relativePath: 'src/injected.ts'
    });
    await fs.writeFile(indexPath, JSON.stringify(index));
    await expect(
      new CodebaseSearcher(rootPath).search('quartzBeacon', 1, undefined, KEYWORD_ONLY_OPTIONS)
    ).rejects.toThrow(/absent from its manifest/);
  });

  it('keeps concurrent query coverage independent on one initialized searcher', async () => {
    const rootPath = path.join(tempRoot, 'concurrent coverage');
    await createSourceFile(rootPath, 'src/quartzBeacon.ts', 'export const quartzBeacon = true;\n');
    await createSourceFile(rootPath, 'src/stableBeacon.ts', 'export const stableBeacon = true;\n');
    await indexProject(rootPath);
    await fs.writeFile(
      path.join(rootPath, 'src/quartzBeacon.ts'),
      'export const changed = true;\n'
    );
    const searcher = new CodebaseSearcher(rootPath);
    await searcher.initialize();
    const [stale, current] = await Promise.all([
      searcher.searchWithCoverage('quartzBeacon', 1, undefined, KEYWORD_ONLY_OPTIONS),
      searcher.searchWithCoverage('stableBeacon', 1, undefined, KEYWORD_ONLY_OPTIONS)
    ]);
    expect(stale.results).toEqual([]);
    expect(stale.sourceCoverage).toMatchObject({
      status: 'no_fresh_results',
      checkedFiles: 1,
      skippedFiles: 1
    });
    expect(current.results).toHaveLength(1);
    expect(current.sourceCoverage).toEqual({ status: 'current', checkedFiles: 1, skippedFiles: 0 });
  });

  it.each(['compact', 'full'] as const)(
    'replenishes current candidates while retaining mutation gates in %s mode',
    async (mode) => {
    const rootPath = path.join(tempRoot, 'one stale source many chunks');
    const sourcePath = path.join(rootPath, 'src/quartzBeacon.ts');
    const supportPath = path.join(rootPath, 'src/support.ts');
    const source =
      Array.from(
        { length: 100 },
        (_, n) =>
          `export function quartzBeacon${n}() {\n${Array.from(
            { length: 30 },
            (_, m) => `  const helper${m} = "quartzBeacon";`
          ).join('\n')}\n  return "quartzBeacon";\n}`
      ).join('\n') + '\n';
    await createSourceFile(rootPath, 'src/quartzBeacon.ts', source);
    await createSourceFile(
      rootPath,
      'src/support.ts',
      'export function support() { return quartzBeacon0(); }\n'
    );
    await indexProject(rootPath);
    const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
    const indexBefore = await fs.readFile(indexPath, 'utf8');
    const index = JSON.parse(indexBefore) as { chunks: CodeChunk[] };
    expect(
      index.chunks.filter((chunk) => chunk.relativePath === 'src/quartzBeacon.ts').length
    ).toBeGreaterThan(30);
    const readSpy = vi.spyOn(fs, 'readFile');
    const realPathSpy = vi.spyOn(fs, 'realpath');
    try {
      const fresh = await new CodebaseSearcher(rootPath).searchWithCoverage(
        'quartzBeacon',
        1,
        undefined,
        KEYWORD_ONLY_OPTIONS
      );
      expect(fresh.results).toHaveLength(1);
      expect(fresh.sourceCoverage).toEqual({ status: 'current', checkedFiles: 1, skippedFiles: 0 });
      await fs.writeFile(sourcePath, 'export const changed = true;\n');
      for (const limit of [1, 5]) {
        readSpy.mockClear();
        realPathSpy.mockClear();
        const result = await new CodebaseSearcher(rootPath).searchWithCoverage(
          'quartzBeacon',
          limit,
          undefined,
          KEYWORD_ONLY_OPTIONS
        );
        await expectSearchResultsOpenInsideRoot(rootPath, result.results, 'src/support.ts');
        expect(result.results.length).toBeLessThanOrEqual(limit);
        expect(result.sourceCoverage).toMatchObject({
          status: 'partial',
          checkedFiles: 2,
          skippedFiles: 1
        });
        expect(result.sourceCoverage.candidateBudgetExhausted).toBeUndefined();
        const reads = readSpy.mock.calls.map(([file]) => path.resolve(String(file)));
        expect(reads.filter((file) => file === sourcePath)).toHaveLength(1);
        // The assertion helper opens the returned file once as a host would.
        expect(reads.filter((file) => file === supportPath)).toHaveLength(2);
        expect(
          realPathSpy.mock.calls.filter(([file]) => path.resolve(String(file)) === rootPath)
        ).toHaveLength(1);
      }
      const ctx = searchContext(rootPath);
      const response = await searchCodebase({ query: 'quartzBeacon', limit: 1, mode }, ctx);
      const payload = JSON.parse(response.content![0].text) as SearchResponse;
      expect(payload.status).toBe('success');
      expect(payload.results).toHaveLength(1);
      expect(payload.results[0].file).toContain('support.ts:');
      expect(payload.sourceCoverage?.status).toBe('partial');
      expect(payload.preflight).toBeUndefined();
      for (const intent of ['edit', 'refactor', 'migrate'] as const) {
        const guarded = await searchCodebase(
          { query: 'quartzBeacon', limit: 1, mode, intent },
          ctx
        );
        const guardedPayload = JSON.parse(guarded.content![0].text) as SearchResponse;
        expect(guardedPayload.sourceCoverage?.status).toBe('partial');
        expect(guardedPayload.preflight?.ready).toBe(false);
        expect(guardedPayload.preflight?.nextAction).toMatch(/refresh/i);
      }
      expect(ctx.performIndexing).not.toHaveBeenCalled();
      expect(await fs.readFile(indexPath, 'utf8')).toBe(indexBefore);
    } finally {
      readSpy.mockRestore();
      realPathSpy.mockRestore();
    }
    }
  );

  it('discloses exhausted source inspection budget instead of claiming all nominated evidence is stale', async () => {
    const rootPath = path.join(tempRoot, 'bounded stale sources');
    for (let n = 0; n < 35; n++) {
      await createSourceFile(
        rootPath,
        `src/quartzBeacon${n}.ts`,
        `export function quartzBeacon${n}() { return "quartzBeacon"; }\n`
      );
    }
    await createSourceFile(
      rootPath,
      'src/support.ts',
      'export function support() { return quartzBeacon0(); }\n'
    );
    await indexProject(rootPath);
    for (let n = 0; n < 35; n++) {
      await fs.writeFile(
        path.join(rootPath, `src/quartzBeacon${n}.ts`),
        'export const changed = true;\n'
      );
    }
    const outcome = await new CodebaseSearcher(rootPath).searchWithCoverage(
      'quartzBeacon',
      1,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    expect(outcome.results).toEqual([]);
    expect(outcome.sourceCoverage).toMatchObject({
      status: 'no_fresh_results',
      candidateBudgetExhausted: true
    });
    expect(outcome.sourceCoverage.checkedFiles).toBeLessThanOrEqual(30);
    const ctx = searchContext(rootPath);
    const response = await searchCodebase({ query: 'quartzBeacon', limit: 1 }, ctx);
    const payload = JSON.parse(response.content![0].text) as SearchResponse & { message: string };
    expect(payload.status).toBe('no_fresh_results');
    expect(payload.message).toMatch(/bounded candidate window.*uninspected/i);
    expect(payload.sourceCoverage?.candidateBudgetExhausted).toBe(true);
    expect(ctx.performIndexing).not.toHaveBeenCalled();
  });

  it('rejects malformed ranges in lower nominated evidence before limiting to a fresh top file', async () => {
    const rootPath = path.join(tempRoot, 'lower invalid range');
    await createSourceFile(
      rootPath,
      'src/quartzBeacon.ts',
      'export function quartzBeacon() { return true; }\n'
    );
    await createSourceFile(rootPath, 'src/support.ts', 'export const support = quartzBeacon;\n');
    await indexProject(rootPath);
    const before = await new CodebaseSearcher(rootPath).search(
      'quartzBeacon',
      1,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    expect(path.basename(before[0].filePath)).toBe('quartzBeacon.ts');
    const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as { chunks: CodeChunk[] };
    for (const chunk of index.chunks.filter((chunk) => chunk.relativePath === 'src/support.ts')) {
      chunk.endLine = 99999;
    }
    await fs.writeFile(indexPath, JSON.stringify(index));
    await expect(
      new CodebaseSearcher(rootPath).search('quartzBeacon', 1, undefined, KEYWORD_ONLY_OPTIONS)
    ).rejects.toThrow(/source line range is invalid/i);
  });

  it('stores root-relative chunk paths when indexing nested roots from an ancestor cwd', async () => {
    const ancestorPath = path.join(tempRoot, 'consumer');
    const rootPath = path.join(ancestorPath, 'project-a');
    const independentRootPath = path.join(ancestorPath, 'project-b');
    await createSourceFile(
      rootPath,
      'src/quartzBeacon.ts',
      'export function quartzBeacon() { return "first"; }\nquartzBeacon();\n'
    );
    await createSourceFile(
      rootPath,
      'src/stableBeacon.ts',
      'export function stableBeacon() { return "stable"; }\nstableBeacon();\n'
    );
    await createSourceFile(
      independentRootPath,
      'src/quartzBeacon.ts',
      'export function quartzBeacon() { return "independent"; }\nquartzBeacon();\n'
    );

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(ancestorPath);
    try {
      await indexProject(rootPath);

      const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
      const initialIndex = JSON.parse(await fs.readFile(indexPath, 'utf8')) as {
        chunks: Array<{
          content: string;
          filePath: string;
          id: string;
          relativePath: string;
          startLine: number;
          endLine: number;
        }>;
      };
      expect(initialIndex.chunks.length).toBeGreaterThan(0);
      expect(
        initialIndex.chunks.every((chunk) => !chunk.relativePath.startsWith('project-a/'))
      ).toBe(true);
      expect(initialIndex.chunks.every((chunk) => chunk.relativePath.startsWith('src/'))).toBe(
        true
      );

      const firstResults = await new CodebaseSearcher(rootPath).search(
        'quartzBeacon',
        5,
        undefined,
        KEYWORD_ONLY_OPTIONS
      );
      await expectSearchResultsOpenInsideRoot(rootPath, firstResults, 'src/quartzBeacon.ts');

      const stableBefore = initialIndex.chunks.filter((chunk) =>
        chunk.relativePath.endsWith('stableBeacon.ts')
      );
      expect(stableBefore.length).toBeGreaterThan(0);
      await createSourceFile(
        rootPath,
        'src/quartzBeacon.ts',
        'export function quartzBeacon() { return "edited"; }\nquartzBeacon();\n'
      );
      cwdSpy.mockReturnValue(tempRoot);
      await new CodebaseIndexer({
        rootPath,
        config: {
          skipEmbedding: true,
          embedding: { provider: 'openai', model: 'text-embedding-3-small' },
          parsing: { maxFileSize: 1024 * 1024 }
        },
        projectOptions: { preferredAnalyzer: 'generic' },
        incrementalOnly: true
      }).index();

      const incrementallyIndexed = JSON.parse(await fs.readFile(indexPath, 'utf8')) as {
        chunks: Array<{
          content: string;
          filePath: string;
          id: string;
          relativePath: string;
          startLine: number;
          endLine: number;
        }>;
      };
      expect(incrementallyIndexed.chunks.length).toBeGreaterThan(0);
      expect(
        incrementallyIndexed.chunks.every(
          (chunk) =>
            chunk.relativePath === 'src/quartzBeacon.ts' ||
            chunk.relativePath === 'src/stableBeacon.ts'
        )
      ).toBe(true);
      const stableAfter = incrementallyIndexed.chunks.filter((chunk) =>
        chunk.relativePath.endsWith('stableBeacon.ts')
      );
      expect(stableAfter).toHaveLength(stableBefore.length);
      expect(
        stableAfter.map(({ relativePath, filePath, content, startLine, endLine }) => ({
          relativePath,
          filePath,
          content,
          startLine,
          endLine
        }))
      ).toEqual(
        stableBefore.map(({ relativePath, filePath, content, startLine, endLine }) => ({
          relativePath,
          filePath,
          content,
          startLine,
          endLine
        }))
      );

      const editedResults = await new CodebaseSearcher(rootPath).search(
        'quartzBeacon',
        5,
        undefined,
        KEYWORD_ONLY_OPTIONS
      );
      await expectSearchResultsOpenInsideRoot(rootPath, editedResults, 'src/quartzBeacon.ts');
      expect(editedResults.some((result) => result.snippet.includes('edited'))).toBe(true);

      cwdSpy.mockReturnValue(ancestorPath);
      await indexProject(independentRootPath);
      const independentIndex = JSON.parse(
        await fs.readFile(
          path.join(independentRootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME),
          'utf8'
        )
      ) as { chunks: Array<{ relativePath: string }> };
      expect(independentIndex.chunks.length).toBeGreaterThan(0);
      expect(independentIndex.chunks.every((chunk) => chunk.relativePath.startsWith('src/'))).toBe(
        true
      );
      const independentResults = await new CodebaseSearcher(independentRootPath).search(
        'quartzBeacon',
        5,
        undefined,
        KEYWORD_ONLY_OPTIONS
      );
      await expectSearchResultsOpenInsideRoot(
        independentRootPath,
        independentResults,
        'src/quartzBeacon.ts'
      );
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it('rejects a copied index that points outside the selected root, then searches rebuilt current ranges', async () => {
    const originalRoot = path.join(tempRoot, 'source repo with spaces');
    const copiedRoot = path.join(tempRoot, 'copied repo with spaces');
    const initialSource = [
      'export function quartzBeacon() {',
      '  return "original";',
      '}',
      'quartzBeacon();',
      ''
    ].join('\n');
    await createSourceFile(originalRoot, 'src/quartzBeacon.ts', initialSource);
    await indexProject(originalRoot);
    await fs.cp(originalRoot, copiedRoot, { recursive: true });
    await createSourceFile(
      copiedRoot,
      'src/quartzBeacon.ts',
      `// copied header one\n// copied header two\n${initialSource}`
    );

    const staleSearcher = new CodebaseSearcher(copiedRoot);
    await expect(
      staleSearcher.search('quartzBeacon', 5, undefined, KEYWORD_ONLY_OPTIONS)
    ).rejects.toBeInstanceOf(IndexCorruptedError);

    // The existing recovery action is a complete index rebuild, which must replace absolute
    // chunk paths and stale line ranges with evidence from the selected copied repository.
    await indexProject(copiedRoot);
    const rebuiltResults = await new CodebaseSearcher(copiedRoot).search(
      'quartzBeacon',
      5,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    await expectSearchResultsOpenInsideRoot(copiedRoot, rebuiltResults, 'src/quartzBeacon.ts');
    expect(rebuiltResults.some((result) => result.startLine >= 3)).toBe(true);
  });

  it('renders only current cited source lines, not indexing-only context headers', async () => {
    const rootPath = path.join(tempRoot, 'annotated chunks');
    await createSourceFile(
      rootPath,
      'src/quartzBeacon.ts',
      'export function quartzBeacon(): string {\r\n  return "current source";\r\n}\r\nquartzBeacon();\r\n'
    );
    await indexProject(rootPath);
    const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as {
      chunks: Array<{ content: string }>;
    };
    for (const chunk of index.chunks)
      chunk.content = '// indexing-only signature header\n' + chunk.content;
    const indexedBytes = JSON.stringify(index);
    await fs.writeFile(indexPath, indexedBytes, 'utf8');

    const results = await new CodebaseSearcher(rootPath).search(
      'quartzBeacon',
      5,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );

    await expectSearchResultsOpenInsideRoot(rootPath, results, 'src/quartzBeacon.ts');
    expect(
      results.every((result) => !result.snippet.includes('indexing-only signature header'))
    ).toBe(true);
    expect(await fs.readFile(indexPath, 'utf8')).toBe(indexedBytes);
  });

  it('preserves source projection when Windows opens the same root with different casing', async () => {
    const rootPath = path.join(tempRoot, 'mixed-case-project');
    await createSourceFile(
      rootPath,
      'src/quartzBeacon.ts',
      'export function quartzBeacon() { return 1; }\n'
    );
    await indexProject(rootPath);
    const differentlyCasedRoot = path.join(tempRoot, 'MIXED-CASE-PROJECT');
    const caseVariantExists = await fs.access(differentlyCasedRoot).then(
      () => true,
      () => false
    );
    const search = new CodebaseSearcher(differentlyCasedRoot).search(
      'quartzBeacon',
      5,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    if (caseVariantExists) {
      await expectSearchResultsOpenInsideRoot(
        differentlyCasedRoot,
        await search,
        'src/quartzBeacon.ts'
      );
    } else {
      // Filesystem behavior, not the OS name, decides whether this is the same project.
      await expect(search).rejects.toBeInstanceOf(IndexCorruptedError);
    }
  });

  it('rejects an indexed directory redirected outside the root even when source bytes match', async () => {
    const rootPath = path.join(tempRoot, 'junction-project');
    const outsidePath = path.join(tempRoot, 'external-source');
    await createSourceFile(
      rootPath,
      'src/quartzBeacon.ts',
      'export function quartzBeacon() { return 1; }\n'
    );
    await indexProject(rootPath);
    // Only this test's owned directory is moved; the index retains the original path/hash.
    await fs.rename(path.join(rootPath, 'src'), outsidePath);
    await fs.symlink(
      outsidePath,
      path.join(rootPath, 'src'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await expect(
      new CodebaseSearcher(rootPath).search('quartzBeacon', 5, undefined, KEYWORD_ONLY_OPTIONS)
    ).rejects.toBeInstanceOf(IndexCorruptedError);
    expect(await fs.readFile(path.join(outsidePath, 'quartzBeacon.ts'), 'utf8')).toContain(
      'quartzBeacon'
    );
  });

  it('permits an indexed directory linked to a source location still inside its own root', async () => {
    const rootPath = path.join(tempRoot, 'real-project');
    await createSourceFile(
      rootPath,
      'src/quartzBeacon.ts',
      'export function quartzBeacon() { return 1; }\n'
    );
    await indexProject(rootPath);
    const internalSourcePath = path.join(rootPath, 'internal-source');
    await fs.rename(path.join(rootPath, 'src'), internalSourcePath);
    await fs.symlink(
      internalSourcePath,
      path.join(rootPath, 'src'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const results = await new CodebaseSearcher(rootPath).search(
      'quartzBeacon',
      5,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    await expectSearchResultsOpenInsideRoot(rootPath, results, 'src/quartzBeacon.ts');
  });

  it.each([-1, 1.5, 99999])(
    'rejects invalid returned source bounds (%s) without fabricating a snippet',
    async (endLine) => {
      const rootPath = path.join(tempRoot, 'invalid range');
      await createSourceFile(
        rootPath,
        'src/quartzBeacon.ts',
        'export function quartzBeacon() { return 1; }\n'
      );
      await indexProject(rootPath);
      const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
      const index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as {
        chunks: Array<{ startLine: number; endLine: number }>;
      };
      for (const chunk of index.chunks) {
        chunk.startLine = 1;
        chunk.endLine = endLine;
      }
      await fs.writeFile(indexPath, JSON.stringify(index), 'utf8');
      await expect(
        new CodebaseSearcher(rootPath).search('quartzBeacon', 5, undefined, KEYWORD_ONLY_OPTIONS)
      ).rejects.toThrow(/source line range is invalid.*rebuild required/i);
    }
  );

  it('excludes stale ranges after a same-root source shift until an explicit refresh', async () => {
    const rootPath = path.join(tempRoot, 'shifted source repo with spaces');
    const originalSource = [
      'export function quartzBeacon() {',
      '  return "original";',
      '}',
      'quartzBeacon();',
      ''
    ].join('\n');
    await createSourceFile(rootPath, 'src/quartzBeacon.ts', originalSource);
    await indexProject(rootPath);
    await createSourceFile(
      rootPath,
      'src/quartzBeacon.ts',
      `// shifted header one\n// shifted header two\n${originalSource}`
    );

    // Owner-selected contract migration: ordinary drift is excluded with explicit
    // coverage, while missing membership, malformed ranges and confinement remain errors.
    const stale = await new CodebaseSearcher(rootPath).searchWithCoverage(
      'quartzBeacon',
      5,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    expect(stale.results).toEqual([]);
    expect(stale.sourceCoverage).toMatchObject({ status: 'no_fresh_results', skippedFiles: 1 });

    await indexProject(rootPath);
    const rebuiltResults = await new CodebaseSearcher(rootPath).search(
      'quartzBeacon',
      5,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    await expectSearchResultsOpenInsideRoot(rootPath, rebuiltResults, 'src/quartzBeacon.ts');
    expect(rebuiltResults.some((result) => result.startLine >= 3)).toBe(true);
  });
  it('excludes a deleted top result while returning the valid lower file before and after refresh', async () => {
    const rootPath = path.join(tempRoot, 'deleted source repo with spaces');
    await createSourceFile(
      rootPath,
      'src/quartzBeacon.ts',
      'export function quartzBeacon() {\n  return "top";\n}\nquartzBeacon();\n'
    );
    await createSourceFile(
      rootPath,
      'src/support.ts',
      'export function useBeacon() {\n  return quartzBeacon();\n}\n'
    );
    await indexProject(rootPath);
    await fs.rm(path.join(rootPath, 'src', 'quartzBeacon.ts'));

    const staleSearcher = new CodebaseSearcher(rootPath);
    const current = await staleSearcher.searchWithCoverage(
      'quartzBeacon',
      5,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    await expectSearchResultsOpenInsideRoot(rootPath, current.results, 'src/support.ts');
    expect(current.sourceCoverage).toMatchObject({ status: 'partial', skippedFiles: 1 });

    await indexProject(rootPath);
    const rebuiltResults = await new CodebaseSearcher(rootPath).search(
      'quartzBeacon',
      5,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    await expectSearchResultsOpenInsideRoot(rootPath, rebuiltResults, 'src/support.ts');
  });

  it('fails closed when the source manifest is missing, then recovers after a full rebuild', async () => {
    const rootPath = path.join(tempRoot, 'missing manifest repo with spaces');
    await createSourceFile(
      rootPath,
      'src/quartzBeacon.ts',
      'export function quartzBeacon() {\n  return "source";\n}\nquartzBeacon();\n'
    );
    await indexProject(rootPath);
    await fs.rm(path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME));

    await expect(
      new CodebaseSearcher(rootPath).search('quartzBeacon', 5, undefined, KEYWORD_ONLY_OPTIONS)
    ).rejects.toBeInstanceOf(IndexCorruptedError);

    await indexProject(rootPath);
    const rebuiltResults = await new CodebaseSearcher(rootPath).search(
      'quartzBeacon',
      5,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    await expectSearchResultsOpenInsideRoot(rootPath, rebuiltResults, 'src/quartzBeacon.ts');
  });

  it('rejects traversal paths even when the outside target exists', async () => {
    const rootPath = path.join(tempRoot, 'path traversal repo with spaces');
    const outsidePath = path.join(tempRoot, 'outside.ts');
    await createSourceFile(
      rootPath,
      'src/quartzBeacon.ts',
      'export function quartzBeacon() {\n  return "inside";\n}\nquartzBeacon();\n'
    );
    await createSourceFile(
      tempRoot,
      'outside.ts',
      'export function quartzBeacon() {\n  return "outside";\n}\nquartzBeacon();\n'
    );
    await indexProject(rootPath);

    const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
    const parsedIndex = JSON.parse(await fs.readFile(indexPath, 'utf8')) as {
      header: { buildId: string; formatVersion: number };
      chunks: Array<{ content: string; filePath: string; relativePath: string }>;
    };
    const candidateChunk = parsedIndex.chunks.find(
      (chunk) =>
        path.resolve(rootPath, chunk.filePath) === path.join(rootPath, 'src', 'quartzBeacon.ts')
    );
    if (!candidateChunk) throw new Error('Indexed source chunk missing from test fixture');
    candidateChunk.filePath = outsidePath;
    candidateChunk.relativePath = '../outside.ts';
    await fs.writeFile(indexPath, JSON.stringify(parsedIndex), 'utf8');

    await expect(
      new CodebaseSearcher(rootPath).search('quartzBeacon', 5, undefined, KEYWORD_ONLY_OPTIONS)
    ).rejects.toBeInstanceOf(IndexCorruptedError);

    await indexProject(rootPath);
    const rebuiltResults = await new CodebaseSearcher(rootPath).search(
      'quartzBeacon',
      5,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    await expectSearchResultsOpenInsideRoot(rootPath, rebuiltResults, 'src/quartzBeacon.ts');
    expect(
      rebuiltResults.every(
        (result) => !path.resolve(result.filePath).startsWith(path.resolve(outsidePath))
      )
    ).toBe(true);
  });
  it('finds new references in current parser-unavailable source even when stale chunks lack the symbol', async () => {
    const rootPath = path.join(tempRoot, 'changed source repo with spaces');
    const originalSource = [
      'export function staleToken() {',
      '  return "old";',
      '}',
      'staleToken();',
      ''
    ].join('\n');
    await createSourceFile(rootPath, 'src/widget.sfc', originalSource);
    await indexProject(rootPath, ['.sfc']);

    const currentSource = [
      'export function currentOnly() {',
      '  return "new";',
      '}',
      'currentOnly();',
      ''
    ].join('\n');
    await createSourceFile(rootPath, 'src/widget.sfc', currentSource);

    const staleSymbol = await findSymbolReferences(rootPath, 'staleToken');
    const newSymbol = await findSymbolReferences(rootPath, 'currentOnly');
    expect(staleSymbol.status).toBe('success');
    if (staleSymbol.status !== 'success') throw new Error('Expected a successful reference query');
    expect(staleSymbol.usageCount).toBe(0);
    expect(staleSymbol.usages).toEqual([]);
    expect(newSymbol.status).toBe('success');
    if (newSymbol.status !== 'success') throw new Error('Expected a successful reference query');
    expect(newSymbol.usageCount).toBe(2);
    expect(newSymbol.usages.map((usage) => usage.line)).toEqual([1, 4]);
    expect(newSymbol.usages.every((usage) => usage.file === 'src/widget.sfc')).toBe(true);
  });

  it('does not return symbol references through a directory junction outside the project', async () => {
    const rootPath = path.join(tempRoot, 'symbol-junction-project');
    const outsidePath = path.join(tempRoot, 'symbol-external-source');
    await createSourceFile(
      rootPath,
      'src/quartzBeacon.ts',
      'export function quartzBeacon() { return 1; }\nquartzBeacon();\n'
    );
    await indexProject(rootPath);
    await fs.rename(path.join(rootPath, 'src'), outsidePath);
    await fs.symlink(
      outsidePath,
      path.join(rootPath, 'src'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    const result = await findSymbolReferences(rootPath, 'quartzBeacon');
    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('Expected source-confinement error');
    expect(result.message).toMatch(/outside the selected project/i);
  });
});
