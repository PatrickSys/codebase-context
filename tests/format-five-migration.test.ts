import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect } from '@lancedb/lancedb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { provider } = vi.hoisted(() => ({ provider: vi.fn() }));
vi.mock('../src/embeddings/index.js', async (original) => ({
  ...(await original<typeof import('../src/embeddings/index.js')>()),
  getEmbeddingProvider: provider
}));
import { CodebaseIndexer } from '../src/core/indexer.js';
import { readIndexMeta, IndexMetaSchema } from '../src/core/index-meta.js';
import { IndexCapacityError, inspectIndexDiskState } from '../src/core/index-generation.js';
import { analyzerRegistry } from '../src/core/analyzer-registry.js';
import { InvalidSourceChunkError } from '../src/errors/index.js';
import { INDEX_FORMAT_VERSION } from '../src/constants/codebase-context.js';
let root = '';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-format-five-'));
  await fs.writeFile(path.join(root, 'route.ts'), 'export const route = "original";');
  provider.mockReset().mockResolvedValue({
    name: 'fixture',
    modelName: 'migration',
    dimensions: 384,
    initialize: async () => undefined,
    isReady: () => true,
    embedBatch: async (texts: string[]) => texts.map(() => Array(384).fill(0.1))
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
const context = () => path.join(root, '.codebase-context');
const build = (skipEmbedding?: boolean, incrementalOnly = false) =>
  new CodebaseIndexer({
    rootPath: root,
    incrementalOnly,
    config: {
      ...(skipEmbedding === undefined ? {} : { skipEmbedding }),
      embedding: { provider: 'custom', model: 'migration' }
    }
  }).index();
async function bytes(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) {
      for (const [name, value] of Object.entries(await bytes(full)))
        result[path.join(item.name, name)] = value;
    } else result[item.name] = (await fs.readFile(full)).toString('base64');
  }
  return result;
}
async function oldFour() {
  const generations = path.join(context(), '.generations');
  for (const id of await fs.readdir(generations)) {
    const directory = path.join(generations, id);
    for (const name of [
      'index.json',
      'intelligence.json',
      'relationships.json',
      'health.json',
      'manifest.json',
      'index-meta.json'
    ]) {
      const file = path.join(directory, name);
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      if (value.header) value.header.formatVersion = 4;
      if (name === 'index-meta.json') value.formatVersion = 4;
      await fs.writeFile(file, JSON.stringify(value));
    }
    const marker = path.join(directory, 'index', 'index-build.json');
    const value = JSON.parse(await fs.readFile(marker, 'utf8'));
    value.formatVersion = 4;
    await fs.writeFile(marker, JSON.stringify(value));
  }
  const pointer = path.join(context(), 'index-meta.json');
  const value = JSON.parse(await fs.readFile(pointer, 'utf8'));
  value.formatVersion = 4;
  await fs.writeFile(pointer, JSON.stringify(value));
  return IndexMetaSchema.parse(value).buildId;
}
async function rows(id: string) {
  const db = await connect(path.join(context(), '.generations', id, 'index'));
  const table = await db.openTable('code_chunks');
  try {
    return (await table.query().toArray()).map((row) => ({
      id: String(row.id),
      content: String(row.content),
      vector: Array.from(row.vector)
    }));
  } finally {
    table.close();
    db.close();
  }
}
it.each(
  [true, false].flatMap((skip) => [true, false].map((incremental) => ({ skip, incremental })))
)(
  'migrates unchanged old4 mode skip=$skip incremental=$incremental',
  async ({ skip, incremental }) => {
    await build(skip);
    const id = await oldFour();
    const native = skip ? undefined : await rows(id);
    const old = await bytes(path.join(context(), '.generations', id));
    await build(undefined, incremental);
    const meta = await readIndexMeta(root);
    expect(meta.formatVersion).toBe(INDEX_FORMAT_VERSION);
    expect(meta.buildId).not.toBe(id);
    expect(meta.artifacts.vectorDb.embeddingEnabled).toBe(!skip);
    expect(await bytes(path.join(context(), '.generations', id))).toEqual(old);
    if (native) expect(await rows(id)).toEqual(native);
  }
);
it('preserves actual old4 semantic pointer/vectors when the omitted-mode provider cannot initialize', async () => {
  await build(false);
  const id = await oldFour();
  const pointer = await fs.readFile(path.join(context(), 'index-meta.json'));
  const old = await bytes(path.join(context(), '.generations', id));
  const native = await rows(id);
  provider.mockRejectedValue(new Error('semantic runtime unavailable'));
  await expect(build(undefined, true)).rejects.toThrow(/semantic runtime unavailable/);
  expect(await fs.readFile(path.join(context(), 'index-meta.json'))).toEqual(pointer);
  expect(await bytes(path.join(context(), '.generations', id))).toEqual(old);
  expect(await rows(id)).toEqual(native);
});
it.each([true, false])(
  'does not infer fresh mode from missing old4 root metadata skip=%s',
  async (skip) => {
    await build(skip);
    await oldFour();
    await fs.rm(path.join(context(), 'index-meta.json'));
    const old = await bytes(path.join(context(), '.generations'));
    expect((await inspectIndexDiskState(root)).kind).toBe('recoverable-unpublished');
    await expect(build(undefined, true)).rejects.toThrow(/recover.*mode/i);
    expect(await bytes(path.join(context(), '.generations'))).toEqual(old);
  }
);
it.each([true, false])(
  'fails bounded migration at three pinned old4 generations incremental=%s',
  async (incremental) => {
    await build(true);
    await build(false);
    await build(false);
    const active = await oldFour();
    const directory = path.join(context(), '.generations');
    const ids = await fs.readdir(directory);
    const pins = path.join(context(), '.pins');
    await fs.mkdir(pins, { recursive: true });
    for (const id of ids.filter((id) => id !== active))
      await fs.writeFile(
        path.join(pins, `${id}.json`),
        JSON.stringify({ pid: process.pid, buildId: id })
      );
    const pointer = await fs.readFile(path.join(context(), 'index-meta.json'));
    const old = await bytes(directory);
    const native = await rows(active);
    await expect(build(undefined, incremental)).rejects.toBeInstanceOf(IndexCapacityError);
    expect(await fs.readFile(path.join(context(), 'index-meta.json'))).toEqual(pointer);
    expect(await bytes(directory)).toEqual(old);
    expect(await rows(active)).toEqual(native);
    expect(await fs.readdir(pins)).toHaveLength(2);
  }
);
it('preserves real semantic vectors after fatal producer corruption', async () => {
  await build(false);
  const id = (await readIndexMeta(root)).buildId;
  const pointer = await fs.readFile(path.join(context(), 'index-meta.json'));
  const old = await bytes(path.join(context(), '.generations', id));
  const native = await rows(id);
  const analyze = analyzerRegistry.analyzeFile.bind(analyzerRegistry);
  vi.spyOn(analyzerRegistry, 'analyzeFile').mockImplementation(async (...args) => {
    const result = await analyze(...args);
    if (result?.chunks[0]) result.chunks[0].filePath = path.join(root, 'foreign.ts');
    return result;
  });
  await expect(build(false)).rejects.toBeInstanceOf(InvalidSourceChunkError);
  expect(await fs.readFile(path.join(context(), 'index-meta.json'))).toEqual(pointer);
  expect(await bytes(path.join(context(), '.generations', id))).toEqual(old);
  expect(await rows(id)).toEqual(native);
});

it.each([true, false])(
  'rebuilds malformed unchanged old4 rows rather than stamping them as format5 skip=%s',
  async (skip) => {
    await build(skip);
    const id = await oldFour();
    const file = path.join(context(), '.generations', id, 'index.json');
    const index = JSON.parse(await fs.readFile(file, 'utf8'));
    index.chunks[0].startLine = 17;
    index.chunks[0].endLine = 6;
    index.chunks[0].metadata.merged = true;
    await fs.writeFile(file, JSON.stringify(index));
    const old = await bytes(path.join(context(), '.generations', id));
    await build(undefined, true);
    const meta = await readIndexMeta(root);
    expect(meta.formatVersion).toBe(INDEX_FORMAT_VERSION);
    expect(meta.buildId).not.toBe(id);
    const rebuilt = JSON.parse(
      await fs.readFile(path.join(context(), meta.artifacts.keywordIndex.path), 'utf8')
    );
    expect(rebuilt.chunks.length).toBeGreaterThan(0);
    for (const chunk of rebuilt.chunks) {
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      expect(chunk.content).toContain('original');
    }
    expect(await bytes(path.join(context(), '.generations', id))).toEqual(old);
  }
);
it.each([true, false])(
  'holds all three old4 orphans under explicit capacity recovery skip=%s',
  async (skip) => {
    await build(true);
    await build(false);
    await build(false);
    await oldFour();
    await fs.rm(path.join(context(), 'index-meta.json'));
    const old = await bytes(path.join(context(), '.generations'));
    await expect(build(skip)).rejects.toBeInstanceOf(IndexCapacityError);
    expect(await bytes(path.join(context(), '.generations'))).toEqual(old);
    await expect(fs.access(path.join(context(), 'index-meta.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  }
);
