import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INDEX_FORMAT_VERSION, INDEX_META_VERSION } from '../src/constants/codebase-context.js';
import { readIndexMeta } from '../src/core/index-meta.js';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { makePaths } from '../src/project-state.js';
import { handle } from '../src/tools/get-indexing-status.js';
import type { ToolContext } from '../src/tools/types.js';
import type { IndexingStats } from '../src/types/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('indexing status disk stats', () => {
  it('reports the keyword cap from persisted stats when the process has no in-memory stats', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cbc-status-cap-'));
    roots.push(root);
    const dir = path.join(root, '.codebase-context');
    await mkdir(dir);
    await writeFile(
      path.join(dir, 'indexing-stats.json'),
      JSON.stringify({
        indexedFiles: 4,
        totalChunks: 12,
        totalFiles: 4,
        generatedAt: '2026-10-30T22:40:09.166Z'
      })
    );
    await writeFile(
      path.join(dir, 'index.json'),
      JSON.stringify({ chunks: [{ id: 'a' }, { id: 'b' }] })
    );

    const ctx: ToolContext = {
      indexState: { status: 'ready' },
      paths: makePaths(root),
      rootPath: root,
      performIndexing: async () => undefined
    };
    const response = await handle({}, ctx);
    const payload = JSON.parse(response.content?.[0]?.text ?? '{}') as {
      lastIndexed?: string;
      stats?: {
        indexedFiles?: number;
        totalChunks?: number;
        searchableChunks?: number;
        omittedChunks?: number;
      };
    };

    expect(payload.lastIndexed).toBe('2026-10-30T22:40:09.166Z');
    expect(payload.stats).toMatchObject({
      indexedFiles: 4,
      totalChunks: 12,
      searchableChunks: 2,
      omittedChunks: 10
    });
  });
});

interface StatusPayload {
  lastIndexed?: string;
  stats?: {
    totalFiles?: number;
    indexedFiles?: number;
    totalChunks?: number;
    searchableChunks?: number;
    omittedChunks?: number;
    duration?: string;
    incremental?: unknown;
  };
}

interface GenerationFixture {
  buildId: string;
  generatedAt: string;
  totalFiles: number;
  indexedFiles: number;
  totalChunks: number;
  searchableChunks: number;
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cbc-status-generation-'));
  roots.push(root);
  await mkdir(path.join(root, '.codebase-context'));
  return root;
}

/** Writes one committed generation and points the root metadata at it. */
async function publishGeneration(root: string, generation: GenerationFixture): Promise<void> {
  const relative = `.generations/${generation.buildId}`;
  const directory = path.join(root, '.codebase-context', relative);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'indexing-stats.json'),
    JSON.stringify({
      indexedFiles: generation.indexedFiles,
      totalChunks: generation.totalChunks,
      totalFiles: generation.totalFiles,
      generatedAt: generation.generatedAt
    })
  );
  await writeFile(
    path.join(directory, 'index.json'),
    JSON.stringify({
      header: { buildId: generation.buildId, formatVersion: INDEX_FORMAT_VERSION },
      chunks: Array.from({ length: generation.searchableChunks }, (_, id) => ({ id }))
    })
  );
  await writeFile(
    path.join(root, '.codebase-context', 'index-meta.json'),
    JSON.stringify({
      metaVersion: INDEX_META_VERSION,
      formatVersion: INDEX_FORMAT_VERSION,
      buildId: generation.buildId,
      generatedAt: generation.generatedAt,
      toolVersion: 'test',
      artifacts: {
        keywordIndex: { path: `${relative}/index.json` },
        vectorDb: { path: `${relative}/index`, provider: 'lancedb' },
        indexingStats: { path: `${relative}/indexing-stats.json` }
      }
    })
  );
}

function memoryStats(overrides: Partial<IndexingStats>): IndexingStats {
  return {
    totalFiles: 5,
    indexedFiles: 5,
    skippedFiles: 0,
    totalChunks: 500,
    totalLines: 0,
    duration: 1000,
    avgChunkSize: 0,
    componentsByType: {},
    componentsByLayer: {} as IndexingStats['componentsByLayer'],
    errors: [],
    startedAt: new Date('2026-11-03T08:59:00.000Z'),
    ...overrides
  };
}

async function statusFor(root: string, indexState: ToolContext['indexState']) {
  const ctx: ToolContext = {
    indexState,
    paths: makePaths(root),
    rootPath: root,
    performIndexing: async () => undefined
  };
  const response = await handle({}, ctx);
  return JSON.parse(response.content?.[0]?.text ?? '{}') as StatusPayload;
}

const newerGeneration: GenerationFixture = {
  buildId: 'build-new',
  generatedAt: '2026-11-03T10:00:00.000Z',
  totalFiles: 6,
  indexedFiles: 6,
  totalChunks: 800,
  searchableChunks: 750
};

describe('indexing status generation consistency', () => {
  it.each([
    { label: 'an older build id', buildId: 'build-old' },
    { label: 'no build id', buildId: undefined }
  ])('reports only the on-disk generation when memory stats carry $label', async ({ buildId }) => {
    const root = await makeRoot();
    await publishGeneration(root, newerGeneration);

    const payload = await statusFor(root, {
      status: 'ready',
      lastIndexed: new Date('2026-11-03T09:00:00.000Z'),
      stats: memoryStats({ buildId, totalChunks: 500 })
    });

    expect(payload.stats).toEqual({
      totalFiles: 6,
      indexedFiles: 6,
      totalChunks: 800,
      searchableChunks: 750,
      omittedChunks: 50
    });
    expect(payload.stats?.searchableChunks).toBeLessThanOrEqual(payload.stats?.totalChunks ?? 0);
    expect(payload.lastIndexed).toBe('2026-11-03T10:00:00.000Z');
  });

  it('keeps the in-memory run details when memory and disk are the same generation', async () => {
    const root = await makeRoot();
    await publishGeneration(root, newerGeneration);
    const incremental = { added: 1, changed: 0, deleted: 0, unchanged: 5 };

    const payload = await statusFor(root, {
      status: 'ready',
      lastIndexed: new Date('2026-11-03T10:00:05.000Z'),
      stats: memoryStats({
        buildId: 'build-new',
        totalFiles: 6,
        indexedFiles: 6,
        totalChunks: 800,
        incremental
      })
    });

    expect(payload.stats).toEqual({
      totalFiles: 6,
      indexedFiles: 6,
      totalChunks: 800,
      duration: '1.00s',
      incremental,
      searchableChunks: 750,
      omittedChunks: 50
    });
    expect(payload.lastIndexed).toBe('2026-11-03T10:00:05.000Z');
  });

  it('falls back to memory alone, with its own cap counts, when no disk index is readable', async () => {
    const root = await makeRoot();

    const payload = await statusFor(root, {
      status: 'ready',
      lastIndexed: new Date('2026-11-03T09:00:00.000Z'),
      stats: memoryStats({ buildId: 'build-old', totalChunks: 60, searchableChunks: 40 })
    });

    expect(payload.stats).toEqual({
      totalFiles: 5,
      indexedFiles: 5,
      totalChunks: 60,
      duration: '1.00s',
      searchableChunks: 40,
      omittedChunks: 20
    });
    expect(payload.lastIndexed).toBe('2026-11-03T09:00:00.000Z');
  });

  it('recognizes stats from a real full and no-change index run as the published generation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cbc-status-real-'));
    roots.push(root);
    await writeFile(path.join(root, 'index.ts'), 'export const x = 1;');
    const lastIndexed = new Date('2026-11-03T11:00:00.000Z');

    for (const incrementalOnly of [false, true]) {
      const stats = await new CodebaseIndexer({
        rootPath: root,
        config: { skipEmbedding: true },
        incrementalOnly
      }).index();
      const payload = await statusFor(root, { status: 'ready', lastIndexed, stats });

      expect(stats.buildId).toBe((await readIndexMeta(root)).buildId);
      // Memory's own timestamp and run details are kept only for the same generation.
      expect(payload.lastIndexed).toBe(lastIndexed.toISOString());
      expect(payload.stats?.duration).toBeDefined();
    }
  }, 30000);
});
