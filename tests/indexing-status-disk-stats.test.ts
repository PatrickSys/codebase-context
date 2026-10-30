import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makePaths } from '../src/project-state.js';
import { handle } from '../src/tools/get-indexing-status.js';
import type { ToolContext } from '../src/tools/types.js';

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
