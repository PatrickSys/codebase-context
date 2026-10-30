import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect } from '@lancedb/lancedb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveIndexArtifact, withIndexSnapshot } from '../src/core/index-generation.js';

const { embedBatch, embed } = vi.hoisted(() => ({
  embed: vi.fn(async (text: string) =>
    Array.from({ length: 384 }, (_, index) => (text.charCodeAt(index % text.length) + index) / 1000)
  ),
  embedBatch: vi.fn(async (texts: string[]) =>
    texts.map((text) =>
      Array.from(
        { length: 384 },
        (_, index) => (text.charCodeAt(index % text.length) + index) / 1000
      )
    )
  )
}));
vi.mock('../src/embeddings/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/embeddings/index.js')>()),
  getEmbeddingProvider: vi.fn(async () => ({ embedBatch, embed }))
}));
import { CodebaseIndexer } from '../src/core/indexer.js';
import { CodebaseSearcher } from '../src/core/search.js';
import * as storage from '../src/storage/index.js';
import * as embeddings from '../src/embeddings/index.js';
import { createHash } from 'node:crypto';
import { handleCliCommand } from '../src/cli.js';
import { handleMapCli } from '../src/cli-map.js';
import { readIndexMeta } from '../src/core/index-meta.js';
import { LanceDBStorageProvider } from '../src/storage/lancedb.js';
import { IndexCorruptedError } from '../src/errors/index.js';

let root = '';
beforeEach(() => {
  vi.mocked(embeddings.getEmbeddingProvider)
    .mockReset()
    .mockResolvedValue({
      name: 'fixture',
      modelName: 'vector-generation-fixture',
      dimensions: 384,
      initialize: async () => undefined,
      isReady: () => true,
      embed,
      embedBatch
    });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = '';
  embedBatch.mockClear();
  embed.mockClear();
});

async function nativeRows(directory: string) {
  const db = await connect(directory);
  const table = await db.openTable('code_chunks');
  try {
    const result = await table.query().toArray();
    return result.map((row) => ({
      id: String(row.id),
      file: String(row.relativePath),
      content: String(row.content),
      vector: Array.from(row.vector)
    }));
  } finally {
    table.close();
    db.close();
  }
}

async function rows() {
  return withIndexSnapshot(root, async () => nativeRows(await resolveIndexArtifact(root, 'index')));
}

async function runMap(skipEmbedding?: boolean, command: 'map' | 'reindex' = 'map') {
  const previousRoot = process.env.CODEBASE_ROOT;
  const previousConfig = process.env.CODEBASE_CONTEXT_CONFIG_PATH;
  const configPath = path.join(root, 'server-config.json');
  await fs.writeFile(
    configPath,
    JSON.stringify({
      projects: [{ root, ...(skipEmbedding === undefined ? {} : { skipEmbedding }) }]
    })
  );
  process.env.CODEBASE_ROOT = root;
  process.env.CODEBASE_CONTEXT_CONFIG_PATH = configPath;
  try {
    if (command === 'map') await handleMapCli(['--json']);
    else await handleCliCommand(['reindex']);
  } finally {
    if (previousRoot === undefined) delete process.env.CODEBASE_ROOT;
    else process.env.CODEBASE_ROOT = previousRoot;
    if (previousConfig === undefined) delete process.env.CODEBASE_CONTEXT_CONFIG_PATH;
    else process.env.CODEBASE_CONTEXT_CONFIG_PATH = previousConfig;
  }
}

async function generationBytes(
  directory: string
): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const result: Array<{ path: string; bytes: number; sha256: string }> = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else {
        const bytes = await fs.readFile(filename);
        result.push({
          path: path.relative(directory, filename),
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex')
        });
      }
    }
  };
  await visit(directory);
  return result;
}

it.each(['map', 'reindex'] as const)(
  'preserves a completed semantic generation and requires explicit recovery when only its root pointer is missing: %s',
  async (command) => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-orphan-semantic-'));
    await fs.writeFile(path.join(root, 'route.ts'), 'export const route = "original";');
    await new CodebaseIndexer({
      rootPath: root,
      config: {
        skipEmbedding: false,
        embedding: { provider: 'custom', model: 'vector-generation-fixture' }
      }
    }).index();
    const pointer = path.join(root, '.codebase-context', 'index-meta.json');
    const pointerBytes = await fs.readFile(pointer);
    const generation = path.dirname(await resolveIndexArtifact(root, 'index.json'));
    const vectors = await rows();
    const files = await generationBytes(generation);
    expect(vectors.some((row) => row.file === 'route.ts')).toBe(true);
    expect(files.some((file) => file.path === 'index-meta.json')).toBe(true);
    await fs.rm(pointer);
    let failure: unknown;
    try {
      await runMap(undefined, command);
    } catch (error) {
      failure = error;
    }
    const afterPointer = await fs.readFile(pointer).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    });
    expect({
      failed: failure instanceof Error,
      pointer: afterPointer,
      files: await generationBytes(generation),
      vectors: await nativeRows(path.join(generation, 'index'))
    }).toEqual({ failed: true, pointer: null, files, vectors });
    // The original complete pointer is retained in test evidence, separate from the deleted authority file.
    expect(JSON.parse(pointerBytes.toString()).artifacts.vectorDb.embeddingEnabled).toBe(true);
  },
  30_000
);

it('fails explicitly and preserves real semantic metadata and vectors when map finds a missing keyword artifact', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-map-corrupt-semantic-'));
  await fs.writeFile(path.join(root, 'route.ts'), 'export const route = "original";');
  await new CodebaseIndexer({
    rootPath: root,
    config: {
      skipEmbedding: false,
      embedding: { provider: 'custom', model: 'vector-generation-fixture' }
    }
  }).index();
  const metaPath = path.join(root, '.codebase-context', 'index-meta.json');
  const beforeMeta = await fs.readFile(metaPath, 'utf8');
  const vectorPath = await resolveIndexArtifact(root, 'index');
  const beforeRows = await nativeRows(vectorPath);
  expect(beforeRows.length).toBeGreaterThan(0);
  await fs.rm(await resolveIndexArtifact(root, 'index.json'));
  let failure: unknown;
  try {
    await runMap();
  } catch (error) {
    failure = error;
  }
  expect({
    failed: failure instanceof Error,
    metadata: await fs.readFile(metaPath, 'utf8'),
    vectors: await nativeRows(vectorPath)
  }).toEqual({ failed: true, metadata: beforeMeta, vectors: beforeRows });
});

it.each([undefined, true, false])(
  'honors fresh-map project embedding choice %s',
  async (skipEmbedding) => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-map-mode-'));
    await fs.writeFile(path.join(root, 'route.ts'), 'export const route = "original";');
    vi.mocked(embeddings.getEmbeddingProvider).mockClear();
    await runMap(skipEmbedding);
    const semantic = skipEmbedding === false;
    expect((await readIndexMeta(root)).artifacts.vectorDb.embeddingEnabled).toBe(semantic);
    expect(vi.mocked(embeddings.getEmbeddingProvider).mock.calls.length > 0).toBe(semantic);
    if (semantic) expect((await rows()).some((row) => row.file === 'route.ts')).toBe(true);
  }
);

it('preserves the committed generation and reports an inaccessible keyword artifact', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-map-inaccessible-'));
  await fs.writeFile(path.join(root, 'route.ts'), 'export const route = "original";');
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
  const keyword = await resolveIndexArtifact(root, 'index.json');
  const metaPath = path.join(root, '.codebase-context', 'index-meta.json');
  const before = await fs.readFile(metaPath, 'utf8');
  const original = fs.access;
  vi.spyOn(fs, 'access').mockImplementation(async (...args) => {
    if (String(args[0]) === keyword)
      throw Object.assign(new Error('keyword access denied'), { code: 'EACCES' });
    return original(...args);
  });
  await expect(runMap()).rejects.toMatchObject({ code: 'EACCES' });
  expect(await fs.readFile(metaPath, 'utf8')).toBe(before);
});

it('copies unchanged real LanceDB vectors while applying incremental add/change/delete', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-vector-generation-'));
  for (const name of ['unchanged', 'changed', 'deleted']) {
    await fs.writeFile(path.join(root, `${name}.ts`), `export const ${name} = "original";`);
  }
  const options = {
    rootPath: root,
    config: {
      skipEmbedding: false,
      embedding: { provider: 'custom' as const, model: 'vector-generation-fixture' }
    }
  };
  await new CodebaseIndexer(options).index();
  const before = await rows();
  expect(before.map((row) => row.file).sort()).toEqual([
    'changed.ts',
    'deleted.ts',
    'unchanged.ts'
  ]);
  embedBatch.mockClear();
  await fs.writeFile(path.join(root, 'changed.ts'), 'export const changed = "replacement";');
  await fs.rm(path.join(root, 'deleted.ts'));
  await fs.writeFile(path.join(root, 'added.ts'), 'export const added = "new";');
  const stats = await new CodebaseIndexer({ ...options, incrementalOnly: true }).index();
  expect(stats.incremental).toEqual({ added: 1, changed: 1, deleted: 1, unchanged: 1 });
  const after = await rows();
  expect(after.map((row) => row.file).sort()).toEqual(['added.ts', 'changed.ts', 'unchanged.ts']);
  expect(after.find((row) => row.file === 'unchanged.ts')).toEqual(
    before.find((row) => row.file === 'unchanged.ts')
  );
  expect(after.find((row) => row.file === 'changed.ts')?.content).toContain('replacement');
  expect(after.find((row) => row.file === 'changed.ts')?.vector).not.toEqual(
    before.find((row) => row.file === 'changed.ts')?.vector
  );
  const embedded = embedBatch.mock.calls.flatMap(([texts]) => texts);
  expect(embedded).toHaveLength(2);
  expect(embedded.join('\n')).not.toContain('unchanged');
}, 30_000);

it('retains keyword fallback when the same semantic searcher cannot reopen its provider', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-semantic-fallback-'));
  await fs.writeFile(path.join(root, 'route.ts'), 'export function route() { return "route"; }');
  await new CodebaseIndexer({
    rootPath: root,
    config: {
      skipEmbedding: false,
      embedding: { provider: 'custom', model: 'vector-generation-fixture' }
    }
  }).index();
  vi.spyOn(storage, 'getStorageProvider').mockRejectedValue(
    new Error('storage temporarily unavailable')
  );
  const searcher = new CodebaseSearcher(root);
  expect((await searcher.search('route')).length).toBeGreaterThan(0);
  expect((await searcher.search('route')).length).toBeGreaterThan(0);
});

it('does not reuse an old embedding provider after mode changes and repeated new-model initialization failures', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-semantic-mode-pair-'));
  await fs.writeFile(path.join(root, 'route.ts'), 'export function route() { return "route"; }');
  const semanticConfig = {
    skipEmbedding: false,
    embedding: { provider: 'custom' as const, model: 'vector-generation-fixture' }
  };
  await new CodebaseIndexer({ rootPath: root, config: semanticConfig }).index();
  const searcher = new CodebaseSearcher(root);
  const query = () => searcher.search('route', 5, undefined, { enableReranker: false });
  expect((await query()).length).toBeGreaterThan(0);
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
  expect((await query()).length).toBeGreaterThan(0);
  await new CodebaseIndexer({
    rootPath: root,
    config: {
      ...semanticConfig,
      embedding: { ...semanticConfig.embedding, model: 'vector-generation-fixture-v2' }
    }
  }).index();
  const initialize = vi
    .spyOn(embeddings, 'getEmbeddingProvider')
    .mockRejectedValue(new Error('new model temporarily unavailable'));
  initialize.mockClear();
  embed.mockClear();
  expect((await query()).length).toBeGreaterThan(0);
  expect((await query()).length).toBeGreaterThan(0);
  expect(initialize).toHaveBeenCalledTimes(2);
  expect(embed).not.toHaveBeenCalled();
}, 30_000);

it('preserves successful search and integrity failures when native read-handle cleanup fails', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-semantic-close-'));
  await fs.writeFile(path.join(root, 'route.ts'), 'export function route() { return "route"; }');
  await new CodebaseIndexer({
    rootPath: root,
    config: {
      skipEmbedding: false,
      embedding: { provider: 'custom', model: 'vector-generation-fixture' }
    }
  }).index();
  const close = LanceDBStorageProvider.prototype.close;
  vi.spyOn(LanceDBStorageProvider.prototype, 'close').mockImplementation(function (
    this: LanceDBStorageProvider
  ) {
    close.call(this);
    throw new Error('native cleanup unavailable');
  });
  const searcher = new CodebaseSearcher(root);
  const query = () => searcher.search('route', 5, undefined, { enableReranker: false });
  await expect(query()).resolves.toHaveLength(1);
  const original = new IndexCorruptedError('original vector integrity failure');
  vi.spyOn(LanceDBStorageProvider.prototype, 'search').mockRejectedValue(original);
  await expect(query()).rejects.toBe(original);
});
