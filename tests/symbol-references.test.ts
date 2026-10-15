import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  KEYWORD_INDEX_FILENAME,
  MANIFEST_FILENAME,
  MEMORY_FILENAME
} from '../src/constants/codebase-context.js';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { analyzerRegistry } from '../src/core/analyzer-registry.js';
import { GenericAnalyzer } from '../src/analyzers/generic/index.js';

const { findIdentifierOccurrences } = vi.hoisted(() => ({
  findIdentifierOccurrences: vi.fn()
}));

vi.mock('../src/utils/tree-sitter.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/tree-sitter.js')>()),
  findIdentifierOccurrences
}));

import { findSymbolReferences } from '../src/core/symbol-references.js';

if (!analyzerRegistry.get('generic')) analyzerRegistry.register(new GenericAnalyzer());

function createGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('findSymbolReferences', () => {
  let rootPath: string | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    if (rootPath) {
      await fs.rm(rootPath, { recursive: true, force: true });
      rootPath = null;
    }
  });

  async function createIndex(files: Array<{ path: string; exists?: boolean; source?: string }>) {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-symbol-references-'));
    const chunks = [];
    for (const entry of files) {
      const absolutePath = path.join(rootPath, entry.path);
      if (entry.exists !== false) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, entry.source ?? '', 'utf8');
      }
      chunks.push({ relativePath: entry.path, filePath: absolutePath });
    }
    const contextPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(contextPath, { recursive: true });
    await fs.writeFile(
      path.join(contextPath, KEYWORD_INDEX_FILENAME),
      JSON.stringify({
        header: { buildId: 'test', formatVersion: INDEX_FORMAT_VERSION },
        chunks
      }),
      'utf8'
    );
    await fs.writeFile(
      path.join(contextPath, INDEX_META_FILENAME),
      JSON.stringify({
        metaVersion: INDEX_META_VERSION,
        formatVersion: INDEX_FORMAT_VERSION,
        buildId: 'test',
        generatedAt: new Date().toISOString(),
        toolVersion: 'test',
        artifacts: {
          keywordIndex: { path: KEYWORD_INDEX_FILENAME },
          vectorDb: { path: 'index', provider: 'test' },
          manifest: { path: MANIFEST_FILENAME }
        }
      }),
      'utf8'
    );
    await fs.writeFile(
      path.join(contextPath, MANIFEST_FILENAME),
      JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        header: { buildId: 'test', formatVersion: INDEX_FORMAT_VERSION },
        // Deliberately stale hashes prove source text, not stored hashes, decides matches.
        files: Object.fromEntries(files.map((file) => [file.path, '0'.repeat(16)]))
      }),
      'utf8'
    );
    return rootPath;
  }

  async function rewriteManifest(root: string, value: unknown): Promise<void> {
    const contextPath = path.join(root, CODEBASE_CONTEXT_DIRNAME);
    await fs.writeFile(path.join(contextPath, MANIFEST_FILENAME), JSON.stringify(value), 'utf8');
  }

  async function rewriteManifestArtifactPath(root: string, manifestPath: string): Promise<void> {
    const metadataPath = path.join(root, CODEBASE_CONTEXT_DIRNAME, INDEX_META_FILENAME);
    const meta = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as {
      artifacts: Record<string, unknown>;
    };
    meta.artifacts.manifest = { path: manifestPath };
    await fs.writeFile(metadataPath, JSON.stringify(meta), 'utf8');
  }

  it.each([
    ['missing keyword index header', (index: Record<string, unknown>) => delete index.header],
    [
      'mismatched keyword index build identity',
      (index: Record<string, unknown>) => {
        const header = index.header as Record<string, unknown>;
        index.header = { ...header, buildId: 'different-build' };
      }
    ]
  ])('rejects a real-built index with %s', async (_description, mutate) => {
    findIdentifierOccurrences.mockResolvedValue([]);
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-symbol-index-identity-'));
    const sourcePath = path.join(rootPath, 'src', 'identity.ts');
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, 'export function identity() { return identity; }\n', 'utf8');
    await new CodebaseIndexer({
      rootPath,
      config: { skipEmbedding: true },
      projectOptions: { preferredAnalyzer: 'generic' }
    }).index();

    const keywordPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
    const parsed = JSON.parse(await fs.readFile(keywordPath, 'utf8')) as Record<string, unknown>;
    mutate(parsed);
    await fs.writeFile(keywordPath, JSON.stringify(parsed), 'utf8');

    await expect(findSymbolReferences(rootPath, 'identity')).rejects.toThrow(/keyword index/i);
  });

  it('finds current references in files omitted by the keyword chunk cap', async () => {
    findIdentifierOccurrences.mockResolvedValue([
      { line: 1, startIndex: 0, endIndex: 1, nodeType: 'identifier' }
    ]);
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-symbol-index-cap-'));
    const sources = new Map([
      ['src/a-first.ts', 'export function firstOnlyToken() { return 1; }\n'],
      ['src/z-second.ts', 'export function secondOnlyToken() { return 2; }\n']
    ]);
    for (const [relativePath, source] of sources) {
      const absolutePath = path.join(rootPath, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, source, 'utf8');
    }

    const stats = await new CodebaseIndexer({
      rootPath,
      config: { skipEmbedding: true, parsing: { maxChunks: 1, maxFileSize: 1024 * 1024 } },
      projectOptions: { preferredAnalyzer: 'generic' }
    }).index();

    const contextPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
    const keywordIndex = JSON.parse(
      await fs.readFile(path.join(contextPath, KEYWORD_INDEX_FILENAME), 'utf8')
    ) as {
      header: { buildId: string; formatVersion: number };
      chunks: Array<{ relativePath?: string }>;
    };
    const manifest = JSON.parse(
      await fs.readFile(path.join(contextPath, MANIFEST_FILENAME), 'utf8')
    ) as {
      header?: { buildId: string; formatVersion: number };
      files: Record<string, string>;
    };
    const indexedPaths = new Set(
      keywordIndex.chunks.flatMap((chunk) => (chunk.relativePath ? [chunk.relativePath] : []))
    );
    const omittedPath = Object.keys(manifest.files).find((file) => !indexedPaths.has(file));
    expect(stats.indexedFiles).toBe(2);
    expect(stats.totalChunks).toBeGreaterThan(keywordIndex.chunks.length);
    expect(keywordIndex.chunks).toHaveLength(1);
    expect(manifest.header).toEqual(keywordIndex.header);
    expect(omittedPath).toBeDefined();
    if (!omittedPath) throw new Error('Expected one manifest-listed file omitted by the chunk cap');

    const omittedSymbol = new Map([
      ['src/a-first.ts', 'firstOnlyToken'],
      ['src/z-second.ts', 'secondOnlyToken']
    ]).get(omittedPath);
    expect(omittedSymbol).toBeDefined();
    if (!omittedSymbol) throw new Error(`Unexpected omitted source path: ${omittedPath}`);

    const result = await findSymbolReferences(rootPath, omittedSymbol);

    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Expected successful current-source scan');
    expect(result.usageCount).toBe(1);
    expect(result.usages).toMatchObject([{ file: omittedPath, line: 1 }]);
    expect(result.isComplete).toBe(true);
    expect(result.coverage).toMatchObject({
      candidateFiles: 2,
      sourcesRead: 2,
      filesUnavailable: 0
    });
  });

  it('writes a build-bound manifest after an incremental add/change/delete pass', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-symbol-manifest-incremental-'));
    const sourceFiles = new Map([
      ['src/keep.ts', 'export const beforeChange = 1;\n'],
      ['src/remove.ts', 'export const removedSource = 1;\n']
    ]);
    for (const [relativePath, source] of sourceFiles) {
      const absolutePath = path.join(rootPath, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, source, 'utf8');
    }
    const config = { skipEmbedding: true, parsing: { maxChunks: 1, maxFileSize: 1024 * 1024 } };
    await new CodebaseIndexer({
      rootPath,
      config,
      projectOptions: { preferredAnalyzer: 'generic' }
    }).index();

    const contextPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
    const firstMeta = JSON.parse(
      await fs.readFile(path.join(contextPath, INDEX_META_FILENAME), 'utf8')
    ) as { buildId: string; formatVersion: number };
    const firstManifest = JSON.parse(
      await fs.readFile(path.join(contextPath, MANIFEST_FILENAME), 'utf8')
    ) as { header?: { buildId: string; formatVersion: number } };
    expect(firstManifest.header).toEqual({
      buildId: firstMeta.buildId,
      formatVersion: firstMeta.formatVersion
    });

    await fs.rm(path.join(rootPath, 'src', 'remove.ts'));
    await fs.writeFile(path.join(rootPath, 'src', 'keep.ts'), 'export const changedToken = 2;\n');
    await fs.writeFile(path.join(rootPath, 'src', 'added.ts'), 'export const addedToken = 3;\n');
    const incremental = await new CodebaseIndexer({
      rootPath,
      config,
      projectOptions: { preferredAnalyzer: 'generic' },
      incrementalOnly: true
    }).index();

    const nextMeta = JSON.parse(
      await fs.readFile(path.join(contextPath, INDEX_META_FILENAME), 'utf8')
    ) as { buildId: string; formatVersion: number };
    const nextManifest = JSON.parse(
      await fs.readFile(path.join(contextPath, MANIFEST_FILENAME), 'utf8')
    ) as { header?: { buildId: string; formatVersion: number }; files: Record<string, string> };
    expect(incremental.incremental).toMatchObject({ added: 1, changed: 1, deleted: 1 });
    expect(nextManifest.header).toEqual({
      buildId: nextMeta.buildId,
      formatVersion: nextMeta.formatVersion
    });
    expect(Object.keys(nextManifest.files).sort()).toEqual(['src/added.ts', 'src/keep.ts']);
  });

  it('does not stamp a headerless legacy manifest on a no-op incremental run', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-symbol-manifest-legacy-'));
    const sourcePath = path.join(rootPath, 'src', 'legacy.ts');
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, 'export const legacyToken = 1;\n', 'utf8');
    await new CodebaseIndexer({
      rootPath,
      config: { skipEmbedding: true },
      projectOptions: { preferredAnalyzer: 'generic' }
    }).index();

    const contextPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
    const manifestPath = path.join(contextPath, MANIFEST_FILENAME);
    const initialManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(initialManifest.header).toBeDefined();
    delete initialManifest.header;
    await fs.writeFile(manifestPath, JSON.stringify(initialManifest), 'utf8');

    await new CodebaseIndexer({
      rootPath,
      config: { skipEmbedding: true },
      projectOptions: { preferredAnalyzer: 'generic' },
      incrementalOnly: true
    }).index();

    const afterIncremental = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    const meta = JSON.parse(
      await fs.readFile(path.join(contextPath, INDEX_META_FILENAME), 'utf8')
    ) as { artifacts: { vectorDb: { embeddingEnabled?: boolean } } };
    expect(afterIncremental.header).toBeUndefined();
    expect(meta.artifacts.vectorDb.embeddingEnabled).toBe(false);
    await expect(findSymbolReferences(rootPath, 'legacyToken')).rejects.toThrow(/full reindex/i);

    const memoryPath = path.join(contextPath, MEMORY_FILENAME);
    const memory = JSON.stringify([{ type: 'note', memory: 'preserve this note' }]);
    await fs.writeFile(memoryPath, memory, 'utf8');
    await new CodebaseIndexer({
      rootPath,
      config: { skipEmbedding: true },
      projectOptions: { preferredAnalyzer: 'generic' }
    }).index();

    const repairedManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      header?: { buildId: string; formatVersion: number };
    };
    const repairedMeta = JSON.parse(
      await fs.readFile(path.join(contextPath, INDEX_META_FILENAME), 'utf8')
    ) as { buildId: string; formatVersion: number; artifacts: { vectorDb: { embeddingEnabled?: boolean } } };
    expect(repairedManifest.header).toEqual({
      buildId: repairedMeta.buildId,
      formatVersion: repairedMeta.formatVersion
    });
    expect(repairedMeta.artifacts.vectorDb.embeddingEnabled).toBe(false);
    expect(await fs.readFile(memoryPath, 'utf8')).toBe(memory);
    findIdentifierOccurrences.mockResolvedValue([
      { line: 1, startIndex: 0, endIndex: 1, nodeType: 'identifier' }
    ]);
    const repairedResult = await findSymbolReferences(rootPath, 'legacyToken');
    expect(repairedResult.status).toBe('success');
    if (repairedResult.status !== 'success') throw new Error('Expected reference lookup after full reindex');
    expect(repairedResult.usageCount).toBe(1);
  });

  it('requires a readable versioned manifest for reference coverage', async () => {
    const root = await createIndex([{ path: 'src/a.ts', source: 'alpha();' }]);
    await fs.rm(path.join(root, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME));

    await expect(findSymbolReferences(root, 'alpha')).rejects.toThrow(/manifest.*full reindex/i);
  });

  it('requires a build-bound manifest instead of accepting the legacy headerless format', async () => {
    const root = await createIndex([{ path: 'src/a.ts', source: 'alpha();' }]);
    const manifestPath = path.join(root, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    delete manifest.header;
    await rewriteManifest(root, manifest);

    await expect(findSymbolReferences(root, 'alpha')).rejects.toThrow(/manifest.*full reindex/i);
  });

  it.each([
    ['buildId', { buildId: 'different-build', formatVersion: INDEX_FORMAT_VERSION }],
    ['formatVersion', { buildId: 'test', formatVersion: INDEX_FORMAT_VERSION + 1 }]
  ])('rejects manifest header with mismatched %s', async (_field, header) => {
    const root = await createIndex([{ path: 'src/a.ts', source: 'alpha();' }]);
    const manifestPath = path.join(root, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      header: unknown;
      [key: string]: unknown;
    };
    manifest.header = header;
    await rewriteManifest(root, manifest);

    await expect(findSymbolReferences(root, 'alpha')).rejects.toThrow(/manifest.*(buildId|formatVersion)/i);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a malformed hash', { 'src/a.ts': 'not-a-hash' }]
  ])('rejects manifest file entries supplied as %s', async (_description, files) => {
    const root = await createIndex([{ path: 'src/a.ts', source: 'alpha();' }]);
    const manifestPath = path.join(root, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      [key: string]: unknown;
    };
    manifest.files = files;
    await rewriteManifest(root, manifest);

    await expect(findSymbolReferences(root, 'alpha')).rejects.toThrow(/manifest/i);
  });

  it('rejects manifest artifact metadata that traverses outside the context directory', async () => {
    const root = await createIndex([{ path: 'src/a.ts', source: 'alpha();' }]);
    await fs.writeFile(
      path.join(root, MANIFEST_FILENAME),
      await fs.readFile(path.join(root, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME), 'utf8'),
      'utf8'
    );
    await rewriteManifestArtifactPath(root, `../${MANIFEST_FILENAME}`);

    await expect(findSymbolReferences(root, 'alpha')).rejects.toThrow(/manifest.*path/i);
  });

  it('rejects traversal in manifest source paths before scanning sources', async () => {
    const root = await createIndex([{ path: 'src/a.ts', source: 'alpha();' }]);
    const manifestPath = path.join(root, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      [key: string]: unknown;
    };
    manifest.files = { '../outside.ts': '0'.repeat(16) };
    await rewriteManifest(root, manifest);

    await expect(findSymbolReferences(root, 'alpha')).rejects.toThrow(/manifest.*path/i);
  });

  it('skips parser work when current source text cannot contain the symbol', async () => {
    const root = await createIndex([{ path: 'src/a.ts', source: 'const beta = 1;' }]);
    findIdentifierOccurrences.mockResolvedValue([]);

    const result = await findSymbolReferences(root, 'alpha');

    expect(result.status).toBe('success');
    expect(findIdentifierOccurrences).not.toHaveBeenCalled();
    if (result.status !== 'success') throw new Error('Expected complete current-source scan');
    expect(result.coverage).toMatchObject({
      candidateFiles: 1,
      sourcesRead: 1,
      filesWithoutText: 1,
      parserCalls: 0
    });
  });

  it('skips longer-identifier candidates without changing exact references or text coverage', async () => {
    const root = await createIndex([
      { path: 'src/long.ts', source: 'const SceneData = 1;' },
      { path: 'src/exact.ts', source: 'const Scene = 1; Scene();' }
    ]);
    findIdentifierOccurrences.mockResolvedValue([
      { line: 1, startIndex: 6, endIndex: 11, nodeType: 'identifier' }
    ]);

    const result = await findSymbolReferences(root, 'Scene');

    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Expected successful current-source scan');
    expect(findIdentifierOccurrences).toHaveBeenCalledTimes(1);
    expect(findIdentifierOccurrences).toHaveBeenCalledWith(
      'const Scene = 1; Scene();',
      'typescript',
      'Scene'
    );
    expect(findIdentifierOccurrences).not.toHaveBeenCalledWith(
      'const SceneData = 1;',
      'typescript',
      'Scene'
    );
    expect(result.usageCount).toBe(1);
    expect(result.usages).toMatchObject([{ file: 'src/exact.ts', line: 1 }]);
    expect(result.coverage).toMatchObject({
      candidateFiles: 2,
      sourcesRead: 2,
      filesWithoutText: 0,
      parserCalls: 1
    });
  });

  it('finds references added after indexing by checking current source', async () => {
    const root = await createIndex([{ path: 'src/a.ts', source: 'const previousOnly = 1;' }]);
    await fs.writeFile(
      path.join(root, 'src/a.ts'),
      'const currentOnly = 1; currentOnly();',
      'utf8'
    );
    findIdentifierOccurrences.mockResolvedValue(null);

    const result = await findSymbolReferences(root, 'currentOnly');

    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Expected successful current-source scan');
    expect(result.usageCount).toBe(2);
    expect(result.coverage).toMatchObject({ sourcesRead: 1, parserCalls: 1 });
  });

  it.each(['$alpha', 'προβολή'])(
    'matches the full identifier spelling %s in lexical fallback',
    async (symbol) => {
      const source = `x${symbol} suffix_${symbol} $${symbol} ${symbol} `;
      const root = await createIndex([{ path: 'src/a.unknown', source }]);
      findIdentifierOccurrences.mockResolvedValue(null);

      const result = await findSymbolReferences(root, symbol);

      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected successful lexical scan');
      expect(result.usageCount).toBe(1);
      expect(result.confidence).toBe('lexical');
      expect(result.coverage.lexicalFallbackFiles).toBe(1);
    }
  );

  it('counts observed references beyond the usage limit and reports truncation', async () => {
    const root = await createIndex([
      { path: 'src/a.unknown', source: 'activeToken(); activeToken(); activeToken();' }
    ]);
    findIdentifierOccurrences.mockResolvedValue(null);

    const result = await findSymbolReferences(root, 'activeToken', 2);

    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Expected successful bounded scan');
    expect(result.usages).toHaveLength(2);
    expect(result.usageCount).toBe(3);
    expect(result.isComplete).toBe(false);
  });

  it('keeps observed references when an indexed source is unavailable', async () => {
    const root = await createIndex([
      { path: 'src/missing.ts', exists: false },
      { path: 'src/readable.unknown', source: 'activeToken();' }
    ]);
    findIdentifierOccurrences.mockResolvedValue(null);

    const result = await findSymbolReferences(root, 'activeToken');

    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Expected partial successful scan');
    expect(result.usageCount).toBe(1);
    expect(result.isComplete).toBe(false);
    expect(result.coverage.filesUnavailable).toBe(1);
  });

  it('bounds source reads to four and preserves manifest order with sequential parsing', async () => {
    const files = Array.from({ length: 9 }, (_, index) => ({
      path: `src/${index}.unknown`,
      source: index < 2 ? 'previousOnly();' : `// file ${index}\nπροβολή();\n`
    }));
    const root = await createIndex(files);
    await fs.writeFile(path.join(root, files[0].path), '// current source\r\nπροβολή();\r\n');
    // Every other source is manifest-only; capped keyword chunks are not the inventory.
    await fs.writeFile(
      path.join(root, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME),
      JSON.stringify({
        header: { buildId: 'test', formatVersion: INDEX_FORMAT_VERSION },
        chunks: [{ relativePath: files[0].path }]
      })
    );
    const sourcePaths = new Map(files.map((file, index) => [path.join(root, file.path), index]));
    const gates = files.map(() => createGate());
    const parserGate = createGate();
    const parserStarted = createGate();
    const readsStarted: number[] = [];
    const readsCompleted: number[] = [];
    let activeReads = 0;
    let maxActiveReads = 0;
    let activeParsers = 0;
    let maxActiveParsers = 0;
    const originalReadFile = fs.readFile;
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      const index = typeof args[0] === 'string' ? sourcePaths.get(args[0]) : undefined;
      if (index === undefined) return originalReadFile(...args);
      readsStarted.push(index);
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      try {
        await gates[index].promise;
        const content = await originalReadFile(...args);
        readsCompleted.push(index);
        return content;
      } finally {
        activeReads -= 1;
      }
    });
    findIdentifierOccurrences.mockImplementation(async () => {
      activeParsers += 1;
      maxActiveParsers = Math.max(maxActiveParsers, activeParsers);
      parserStarted.release();
      await parserGate.promise;
      activeParsers -= 1;
      return null;
    });
    const scan = findSymbolReferences(root, 'προβολή', 3);
    try {
      await vi.waitFor(() => expect(readsStarted).toHaveLength(4));
      expect([...readsStarted].sort()).toEqual([0, 1, 2, 3]);
      for (const index of [3, 2, 1, 0]) {
        gates[index].release();
        await vi.waitFor(() => expect(readsCompleted).toContain(index));
      }
      await parserStarted.promise;
      // Completed buffers remain bounded while the shared parser is busy.
      expect(readsStarted).toHaveLength(4);
      expect(findIdentifierOccurrences).toHaveBeenCalledTimes(1);
      parserGate.release();
      for (const gate of gates) gate.release();
      const result = await scan;

      expect(maxActiveReads).toBe(4);
      expect(maxActiveParsers).toBe(1);
      expect(readsCompleted.slice(0, 4)).toEqual([3, 2, 1, 0]);
      expect(new Set(readsStarted).size).toBe(9);
      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected bounded current-source scan');
      expect(result.usageCount).toBe(8);
      expect(result.usages.map((usage) => usage.file)).toEqual([
        'src/0.unknown', 'src/2.unknown', 'src/3.unknown'
      ]);
      expect(result.usages[0]).toEqual({
        file: 'src/0.unknown', line: 2, preview: '// current source\nπροβολή();'
      });
      expect(result.coverage).toEqual({
        candidateFiles: 9, sourcesRead: 9, filesWithoutText: 1,
        filesUnavailable: 0, parserCalls: 8, lexicalFallbackFiles: 8
      });
      expect(result.confidence).toBe('lexical');
      expect(result.isComplete).toBe(false);
    } finally {
      for (const gate of gates) gate.release();
      parserGate.release();
      await scan;
      findIdentifierOccurrences.mockReset();
    }
  });

  it.each(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'])(
    'keeps full observed counts across batches when a source read reports %s',
    async (code) => {
      const files = Array.from({ length: 6 }, (_, index) => ({
        path: `src/${index}.unknown`, source: 'alpha();'
      }));
      const root = await createIndex(files);
      const unavailable = path.join(root, files[1].path);
      const originalReadFile = fs.readFile;
      vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
        if (args[0] === unavailable) throw Object.assign(new Error('unavailable'), { code });
        return originalReadFile(...args);
      });
      findIdentifierOccurrences.mockResolvedValue(null);

      const result = await findSymbolReferences(root, 'alpha', 1);

      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected partial current-source scan');
      expect(result.usageCount).toBe(5);
      expect(result.usages.map((usage) => usage.file)).toEqual(['src/0.unknown']);
      expect(result.coverage).toMatchObject({
        candidateFiles: 6, sourcesRead: 5, filesUnavailable: 1, parserCalls: 5
      });
      expect(result.isComplete).toBe(false);
    }
  );

  it.each(['realpath', 'stat', 'readFile'] as const)(
    'fails the entire batch closed on an unexpected %s error without parsing it',
    async (operation) => {
      const files = Array.from({ length: 5 }, (_, index) => ({
        path: `src/${index}.unknown`, source: 'alpha();'
      }));
      const root = await createIndex(files);
      const fatal = path.join(root, files[1].path);
      const later = path.join(root, files[4].path);
      const originalReadFile = fs.readFile;
      const laterReads: unknown[] = [];
      // The operation-specific spies retain the real fs signatures.
      if (operation === 'realpath') {
        const realpath = fs.realpath;
        vi.spyOn(fs, 'realpath').mockImplementation(async (...args) => {
          if (args[0] === fatal) throw Object.assign(new Error('fatal'), { code: 'EIO' });
          return realpath(...args);
        });
      } else if (operation === 'stat') {
        const stat = fs.stat;
        vi.spyOn(fs, 'stat').mockImplementation(async (...args) => {
          if (args[0] === fatal) throw Object.assign(new Error('fatal'), { code: 'EIO' });
          return stat(...args);
        });
      }
      vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
        if (args[0] === later) laterReads.push(args[0]);
        if (operation === 'readFile' && args[0] === fatal) {
          throw Object.assign(new Error('fatal'), { code: 'EIO' });
        }
        return originalReadFile(...args);
      });
      findIdentifierOccurrences.mockResolvedValue(null);

      const result = await findSymbolReferences(root, 'alpha');

      expect(result.status).toBe('error');
      if (result.status !== 'error') throw new Error('Expected fail-closed scan');
      expect(result.message).toContain(files[1].path);
      expect(findIdentifierOccurrences).not.toHaveBeenCalled();
      expect(laterReads).toEqual([]);
    }
  );

  it('settles pending source read failures before returning a fatal batch', async () => {
    const files = Array.from({ length: 5 }, (_, index) => ({
      path: `src/${index}.unknown`, source: 'alpha();'
    }));
    const root = await createIndex(files);
    const first = path.join(root, files[0].path);
    const pending = path.join(root, files[1].path);
    const pendingRelease = createGate();
    const originalReadFile = fs.readFile;
    let pendingStarted = false;
    let pendingSettled = false;
    let scanSettled = false;
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      if (args[0] === first) throw Object.assign(new Error('first failure'), { code: 'EIO' });
      if (args[0] === pending) {
        pendingStarted = true;
        await pendingRelease.promise;
        pendingSettled = true;
        throw Object.assign(new Error('later failure'), { code: 'EMFILE' });
      }
      return originalReadFile(...args);
    });
    findIdentifierOccurrences.mockResolvedValue(null);
    const scan = findSymbolReferences(root, 'alpha').finally(() => { scanSettled = true; });
    try {
      await vi.waitFor(() => expect(pendingStarted).toBe(true));
      expect(scanSettled).toBe(false);
      expect(pendingSettled).toBe(false);
      pendingRelease.release();
      const result = await scan;
      expect(result.status).toBe('error');
      if (result.status !== 'error') throw new Error('Expected fail-closed scan');
      expect(result.message).toContain(files[0].path);
      expect(pendingSettled).toBe(true);
      expect(findIdentifierOccurrences).not.toHaveBeenCalled();
    } finally {
      pendingRelease.release();
      await scan;
    }
  });

  it('fails a batch closed when a manifest-listed source becomes a directory', async () => {
    const files = Array.from({ length: 5 }, (_, index) => ({
      path: `src/${index}.unknown`, source: 'alpha();'
    }));
    const root = await createIndex(files);
    const invalidSource = path.join(root, files[1].path);
    await fs.unlink(invalidSource);
    await fs.mkdir(invalidSource);
    findIdentifierOccurrences.mockResolvedValue(null);

    const result = await findSymbolReferences(root, 'alpha');

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('Expected file-integrity error');
    expect(result.message).toContain(files[1].path);
    expect(findIdentifierOccurrences).not.toHaveBeenCalled();
  });

  it('fails closed when an indexed source resolves outside the project', async () => {
    const root = await createIndex([{ path: 'src/a.ts', source: 'alpha();' }]);
    const outsidePath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-symbol-outside-'));
    try {
      const externalFile = path.join(outsidePath, 'external.ts');
      await fs.writeFile(externalFile, 'alpha();', 'utf8');
      const indexPath = path.join(root, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
      await fs.writeFile(
        indexPath,
        JSON.stringify({
          header: { buildId: 'test', formatVersion: INDEX_FORMAT_VERSION },
          chunks: [{ filePath: externalFile }]
        }),
        'utf8'
      );

      const result = await findSymbolReferences(root, 'alpha');

      expect(result.status).toBe('error');
      if (result.status !== 'error') throw new Error('Expected path-confinement error');
      expect(result.message).toMatch(/invalid|outside/i);
    } finally {
      await fs.rm(outsidePath, { recursive: true, force: true });
    }
  });

  it('fails closed when a manifest-listed source symlink resolves outside the project', async ({ skip }) => {
    const root = await createIndex([{ path: 'src/anchor.ts', source: 'safeOnly();' }]);
    const outsidePath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-symbol-manifest-link-'));
    try {
      const externalFile = path.join(outsidePath, 'external.ts');
      await fs.writeFile(externalFile, 'export const outsideOnly = 1;\n', 'utf8');
      const linkPath = path.join(root, 'src', 'link.ts');
      await fs.mkdir(path.dirname(linkPath), { recursive: true });
      try {
        await fs.symlink(externalFile, linkPath, 'file');
      } catch (error) {
        const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') {
          skip(`Symlink creation is unavailable in this environment (${String(code)})`);
        }
        throw error;
      }
      const manifestPath = path.join(root, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME);
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
        files: Record<string, string>;
        [key: string]: unknown;
      };
      manifest.files['src/link.ts'] = '0'.repeat(16);
      await rewriteManifest(root, manifest);

      const result = await findSymbolReferences(root, 'outsideOnly');

      expect(result.status).toBe('error');
      if (result.status !== 'error') throw new Error('Expected symlink confinement error');
      expect(result.message).toMatch(/outside/i);
    } finally {
      await fs.rm(outsidePath, { recursive: true, force: true });
    }
  });
});
