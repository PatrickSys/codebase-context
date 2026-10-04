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
  KEYWORD_INDEX_FILENAME,
  MANIFEST_FILENAME
} from '../src/constants/codebase-context.js';
import { findSymbolReferences } from '../src/core/symbol-references.js';
import type { SearchResult } from '../src/types/index.js';

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
    const search = new CodebaseSearcher(differentlyCasedRoot).search(
      'quartzBeacon',
      5,
      undefined,
      KEYWORD_ONLY_OPTIONS
    );
    const caseVariantExists = await fs.access(differentlyCasedRoot).then(
      () => true,
      () => false
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

  it('rejects stale ranges after a same-root prestart source shift, then searches rebuilt current ranges', async () => {
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

    // Frozen freshness contract: an in-root, readable source can still make the
    // persisted snippet/range stale; reject it and use the existing full rebuild.
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
    expect(rebuiltResults.some((result) => result.startLine >= 3)).toBe(true);
  });
  it('rejects a deleted top result instead of returning stale evidence, then rebuilds to the valid lower file', async () => {
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
    await expect(
      staleSearcher.search('quartzBeacon', 5, undefined, KEYWORD_ONLY_OPTIONS)
    ).rejects.toBeInstanceOf(IndexCorruptedError);

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
      (chunk) => chunk.relativePath === 'src/quartzBeacon.ts'
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
});
