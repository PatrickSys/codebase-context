import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import os from 'os';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { checkEmbeddingMismatch, IndexMetaSchema, readIndexMeta } from '../src/core/index-meta.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  HEALTH_FILENAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  MANIFEST_FILENAME,
  RELATIONSHIPS_FILENAME,
  VECTOR_DB_DIRNAME
} from '../src/constants/codebase-context.js';
import type { CodeChunk } from '../src/types/index.js';

const searchDeps = vi.hoisted(() => ({
  getEmbeddingProvider: vi.fn(),
  getStorageProvider: vi.fn()
}));

vi.mock('../src/embeddings/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/embeddings/index.js')>()),
  getEmbeddingProvider: searchDeps.getEmbeddingProvider
}));

vi.mock('../src/storage/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/storage/index.js')>()),
  getStorageProvider: searchDeps.getStorageProvider
}));

const DEFAULT_MODEL = 'Xenova/bge-small-en-v1.5';

function makeMeta(embeddingEnabled?: boolean) {
  const vectorDb: {
    path: string;
    provider: string;
    embeddingProvider: string;
    embeddingModel: string;
    embeddingEnabled?: boolean;
  } = {
    path: VECTOR_DB_DIRNAME,
    provider: 'lancedb',
    embeddingProvider: 'transformers',
    embeddingModel: DEFAULT_MODEL
  };
  if (embeddingEnabled !== undefined) vectorDb.embeddingEnabled = embeddingEnabled;

  return {
    metaVersion: INDEX_META_VERSION,
    formatVersion: INDEX_FORMAT_VERSION,
    buildId: 'opt-out-test-build',
    generatedAt: new Date().toISOString(),
    toolVersion: 'test',
    artifacts: {
      keywordIndex: { path: KEYWORD_INDEX_FILENAME },
      vectorDb
    }
  };
}

async function snapshotActiveIndexFiles(contextDir: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};

  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (directory === contextDir && entry.name === '.staging') continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      const relativePath = path.relative(contextDir, absolutePath).replace(/\\/g, '/');
      snapshot[relativePath] = createHash('sha256')
        .update(await fs.readFile(absolutePath))
        .digest('hex');
    }
  }

  await visit(contextDir);
  return Object.fromEntries(
    Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right))
  );
}

describe('embedding opt-out index metadata', () => {
  it('accepts the explicit disabled state without changing the index format version', () => {
    const parsed = IndexMetaSchema.parse(makeMeta(false));

    expect(parsed.formatVersion).toBe(INDEX_FORMAT_VERSION);
    expect(parsed.artifacts.vectorDb.embeddingEnabled).toBe(false);
  });

  it('treats legacy missing state as enabled and detects both mode transitions', () => {
    const legacy = IndexMetaSchema.parse(makeMeta());
    const enabled = IndexMetaSchema.parse(makeMeta(true));
    const disabled = IndexMetaSchema.parse(makeMeta(false));

    expect(checkEmbeddingMismatch(legacy, 'transformers', DEFAULT_MODEL)).toBe(false);
    expect(checkEmbeddingMismatch(legacy, 'transformers', DEFAULT_MODEL, false)).toBe(true);
    expect(checkEmbeddingMismatch(enabled, 'transformers', DEFAULT_MODEL, false)).toBe(true);
    expect(checkEmbeddingMismatch(disabled, 'transformers', DEFAULT_MODEL, true)).toBe(true);
    expect(checkEmbeddingMismatch(disabled, 'transformers', 'changed-model', false)).toBe(false);
  });
});

describe('disabled-index returning-user search', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-embedding-opt-out-search-'));
    searchDeps.getEmbeddingProvider.mockReset();
    searchDeps.getStorageProvider.mockReset();

    const contextDir = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME);
    const vectorDir = path.join(contextDir, VECTOR_DB_DIRNAME);
    const buildId = 'disabled-search-build';
    const chunkPath = path.join(tempDir, 'src', 'albums.action.ts');
    const chunk: CodeChunk = {
      id: 'load-albums-success',
      content: "export const loadAlbumsSuccess = createAction('[Albums] Load Success');",
      filePath: chunkPath,
      relativePath: 'src/albums.action.ts',
      startLine: 1,
      endLine: 1,
      language: 'typescript',
      dependencies: [],
      imports: [],
      exports: ['loadAlbumsSuccess'],
      tags: ['state'],
      metadata: { symbolName: 'loadAlbumsSuccess' }
    };

    await fs.mkdir(path.join(vectorDir, 'code_chunks.lance'), { recursive: true });
    await fs.writeFile(
      path.join(vectorDir, 'index-build.json'),
      JSON.stringify({ buildId, formatVersion: INDEX_FORMAT_VERSION }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(vectorDir, 'code_chunks.lance', 'stale-vector-sentinel'),
      'A disabled index must not open this stale table path.',
      'utf-8'
    );
    await fs.writeFile(
      path.join(contextDir, KEYWORD_INDEX_FILENAME),
      JSON.stringify({
        header: { buildId, formatVersion: INDEX_FORMAT_VERSION },
        chunks: [chunk]
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(contextDir, INTELLIGENCE_FILENAME),
      JSON.stringify({
        header: { buildId, formatVersion: INDEX_FORMAT_VERSION },
        patterns: {},
        internalFileGraph: { imports: {} }
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(contextDir, INDEX_META_FILENAME),
      JSON.stringify({ ...makeMeta(false), buildId }, null, 2),
      'utf-8'
    );
    await fs.mkdir(path.dirname(chunkPath), { recursive: true });
    await fs.writeFile(chunkPath, chunk.content, 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('serves an exact keyword reference without initializing embeddings or stale vector storage', async () => {
    const { CodebaseSearcher } = await import('../src/core/search.js');
    const searcher = new CodebaseSearcher(tempDir);

    const results = await searcher.search('loadAlbumsSuccess', 5, undefined, {
      useSemanticSearch: true,
      useKeywordSearch: true,
      enableQueryExpansion: false,
      enableLowConfidenceRescue: false,
      enableReranker: false
    });

    expect(
      results.some((result) => result.filePath === path.join(tempDir, 'src', 'albums.action.ts'))
    ).toBe(true);
    expect(results.find((result) => result.filePath.endsWith('albums.action.ts'))?.startLine).toBe(
      1
    );
    expect(searcher.isReady()).toBe(true);
    expect(searchDeps.getEmbeddingProvider).not.toHaveBeenCalled();
    expect(searchDeps.getStorageProvider).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'explicitly enabled metadata', embeddingEnabled: true },
    { label: 'legacy metadata without an embedding state', embeddingEnabled: undefined }
  ])('preserves default semantic initialization for $label', async ({ embeddingEnabled }) => {
    const meta = makeMeta(embeddingEnabled);
    await fs.writeFile(
      path.join(tempDir, CODEBASE_CONTEXT_DIRNAME, INDEX_META_FILENAME),
      JSON.stringify({ ...meta, buildId: 'disabled-search-build' }, null, 2),
      'utf-8'
    );

    const { CodebaseSearcher } = await import('../src/core/search.js');
    const searcher = new CodebaseSearcher(tempDir);
    await searcher.initialize();

    expect(searcher.isReady()).toBe(true);
    expect(searchDeps.getEmbeddingProvider).toHaveBeenCalledTimes(1);
    expect(searchDeps.getEmbeddingProvider).toHaveBeenCalledWith({
      provider: 'transformers',
      model: DEFAULT_MODEL
    });
    expect(searchDeps.getStorageProvider).toHaveBeenCalledTimes(1);
    expect(searchDeps.getStorageProvider).toHaveBeenCalledWith({
      path: path.join(tempDir, CODEBASE_CONTEXT_DIRNAME, VECTOR_DB_DIRNAME)
    });
  });
});

describe('skipEmbedding builds and transitions', () => {
  let tempDir: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-embedding-opt-out-index-'));
    searchDeps.getEmbeddingProvider.mockReset();
    searchDeps.getStorageProvider.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'src', 'index.ts'),
      'export function loadAlbums(): string { return "ready"; }\n',
      'utf-8'
    );
  });

  afterEach(async () => {
    consoleErrorSpy.mockRestore();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('persists the disabled state while retaining structural and keyword artifacts', async () => {
    const stats = await new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    }).index();

    const meta = await readIndexMeta(tempDir);
    const contextDir = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME);

    expect(stats.errors).toHaveLength(0);
    expect(meta.artifacts.vectorDb.embeddingEnabled).toBe(false);
    expect(meta.artifacts.vectorDb.embeddingProvider).toBe('transformers');
    expect(meta.artifacts.vectorDb.embeddingModel).toBe(DEFAULT_MODEL);
    for (const artifact of [
      KEYWORD_INDEX_FILENAME,
      INTELLIGENCE_FILENAME,
      RELATIONSHIPS_FILENAME,
      MANIFEST_FILENAME,
      HEALTH_FILENAME
    ]) {
      await expect(fs.access(path.join(contextDir, artifact))).resolves.toBeUndefined();
    }
    await expect(
      fs.access(path.join(contextDir, VECTOR_DB_DIRNAME, 'code_chunks.lance'))
    ).rejects.toThrow();
  });

  it('forces a full rebuild and removes stale vector artifacts when switching to disabled', async () => {
    await new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    }).index();

    const contextDir = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME);
    const metaPath = path.join(contextDir, INDEX_META_FILENAME);
    const rawMeta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as ReturnType<typeof makeMeta>;
    rawMeta.artifacts.vectorDb.embeddingEnabled = true;
    await fs.writeFile(metaPath, JSON.stringify(rawMeta, null, 2), 'utf-8');

    const staleVectorPath = path.join(contextDir, VECTOR_DB_DIRNAME, 'code_chunks.lance');
    await fs.mkdir(staleVectorPath, { recursive: true });
    await fs.writeFile(path.join(staleVectorPath, 'stale-vector-sentinel'), 'stale', 'utf-8');
    const oldBuildId = (await readIndexMeta(tempDir)).buildId;

    const stats = await new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      incrementalOnly: true
    }).index();

    const meta = await readIndexMeta(tempDir);
    expect(stats.errors).toHaveLength(0);
    expect(meta.buildId).not.toBe(oldBuildId);
    expect(meta.artifacts.vectorDb.embeddingEnabled).toBe(false);
    await expect(fs.access(staleVectorPath)).rejects.toThrow();
  });

  it('keeps the disabled active index intact when enabling fails at storage initialization', async () => {
    await new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    }).index();

    const contextDir = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME);
    const oldActiveFiles = await snapshotActiveIndexFiles(contextDir);
    const oldMeta = await readIndexMeta(tempDir);
    const vectorBuildMarker = path.join(VECTOR_DB_DIRNAME, 'index-build.json').replace(/\\/g, '/');
    expect(oldActiveFiles[vectorBuildMarker]).toMatch(/^[a-f0-9]{64}$/);

    await fs.unlink(path.join(tempDir, 'src', 'index.ts'));
    searchDeps.getStorageProvider.mockRejectedValue(
      new Error('Injected storage initialization failure')
    );

    await expect(
      new CodebaseIndexer({
        rootPath: tempDir,
        config: { skipEmbedding: false },
        incrementalOnly: true
      }).index()
    ).rejects.toThrow('Injected storage initialization failure');

    expect(searchDeps.getEmbeddingProvider).not.toHaveBeenCalled();
    expect(searchDeps.getStorageProvider).toHaveBeenCalledTimes(1);
    expect(searchDeps.getStorageProvider).toHaveBeenCalledWith(
      { path: expect.stringContaining(path.join(contextDir, '.staging')) },
      undefined
    );
    expect(await snapshotActiveIndexFiles(contextDir)).toEqual(oldActiveFiles);
    expect((await readIndexMeta(tempDir)).buildId).toBe(oldMeta.buildId);
    expect((await readIndexMeta(tempDir)).artifacts.vectorDb.embeddingEnabled).toBe(false);
    await expect(fs.readdir(path.join(contextDir, '.staging'))).resolves.toEqual([]);
  });
});
