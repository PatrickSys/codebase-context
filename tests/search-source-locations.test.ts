import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { handle } from '../src/tools/search-codebase.js';
import type { SearchResponse, ToolContext } from '../src/tools/types.js';
import type { CodeChunk } from '../src/types/index.js';
import { isPathWithin } from '../src/utils/project-discovery.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  KEYWORD_INDEX_FILENAME
} from '../src/constants/codebase-context.js';

// Exercise the real keyword index, searcher and tool without model/network work.
vi.mock('../src/embeddings/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/embeddings/index.js')>()),
  getEmbeddingProvider: vi.fn(async () => {
    throw new Error('Offline source-location regression: keyword search only');
  })
}));
vi.mock('../src/core/reranker.js', () => ({
  rerank: vi.fn(async (_query: string, results: unknown) => results),
  getRerankerStatus: vi.fn(() => 'fallback')
}));

describe('search source locations', () => {
  let tempDir: string;
  let rootPath: string;
  let sourcePath: string;
  let siblingPath: string;
  let indexPath: string;
  let ctx: ToolContext;
  const source = 'export function registerToken() { return "api-token"; }\nregisterToken();\n';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'search-source-locations-'));
    const monorepoRoot = path.join(tempDir, 'repo with spaces');
    rootPath = path.join(monorepoRoot, 'packages', 'api');
    sourcePath = path.join(rootPath, 'src', 'auth', 'token.ts');
    siblingPath = path.join(monorepoRoot, 'packages', 'web', 'src', 'auth', 'token.ts');
    for (const target of [sourcePath, siblingPath]) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, source, 'utf-8');
    }
    const baseDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
    indexPath = path.join(baseDir, KEYWORD_INDEX_FILENAME);
    ctx = {
      rootPath,
      indexState: { status: 'ready' },
      paths: {
        baseDir,
        keywordIndex: indexPath,
        memory: path.join(baseDir, 'memory.json'),
        intelligence: path.join(baseDir, 'intelligence.json'),
        health: path.join(baseDir, 'health.json'),
        vectorDb: path.join(baseDir, 'vectors')
      },
      performIndexing: vi.fn()
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function search(mode: 'compact' | 'full'): Promise<SearchResponse> {
    const response = await handle(
      { query: 'registerToken', mode, limit: 10, includeSnippets: true },
      ctx
    );
    expect(response.isError).not.toBe(true);
    const text = response.content?.[0]?.text;
    if (!text) throw new Error('Missing search payload');
    return JSON.parse(text) as SearchResponse;
  }

  async function assertSource(payload: SearchResponse): Promise<void> {
    expect(payload.status).toBe('success');
    expect(payload.results.length).toBeGreaterThan(0);
    for (const result of payload.results) {
      const location = /^(.*):(\d+)-(\d+)$/.exec(result.file);
      expect(location).not.toBeNull();
      const file = location![1];
      expect(file).toBe('src/auth/token.ts');
      expect(path.isAbsolute(file)).toBe(false);
      const resolved = path.resolve(rootPath, file);
      expect(isPathWithin(rootPath, resolved)).toBe(true);
      expect(resolved).toBe(sourcePath);
      expect(
        (await fs.readFile(resolved, 'utf-8')).split('\n')[Number(location![2]) - 1]
      ).toContain('registerToken');
    }
    if (payload.budget?.mode === 'compact') {
      expect(payload.nextHops?.find((hop) => hop.tool === 'read_file')?.args?.path).toBe(
        'src/auth/token.ts'
      );
    }
  }

  it.each(['compact', 'full'] as const)(
    '%s returns exact openable paths across cwd changes, spaces, monorepos and reused indexes',
    async (mode) => {
      const previousCwd = process.cwd();
      try {
        process.chdir(tempDir);
        await new CodebaseIndexer({ rootPath, config: { skipEmbedding: true } }).index();
        await assertSource(await search(mode));

        const index = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as {
          header: { buildId: string };
          chunks: CodeChunk[];
        };
        const originalBuildId = index.header.buildId;
        // Reproduce an older launch-relative metadata path without rebuilding.
        for (const chunk of index.chunks) {
          chunk.relativePath = path.relative(tempDir, sourcePath).replace(/\\/g, '/');
        }
        await fs.writeFile(indexPath, JSON.stringify(index), 'utf-8');
        process.chdir(path.dirname(siblingPath));
        await assertSource(await search(mode));
        const reused = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as typeof index;
        expect(reused.header.buildId).toBe(originalBuildId);
        expect(ctx.performIndexing).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    },
    60000
  );

  it.each(['compact', 'full'] as const)(
    '%s omits missing/outside files and keeps valid ..-prefixed names',
    async (mode) => {
      await new CodebaseIndexer({ rootPath, config: { skipEmbedding: true } }).index();
      const index = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as {
        chunks: CodeChunk[];
      };
      const original = index.chunks[0];
      expect(original).toBeDefined();
      const hiddenPath = path.join(rootPath, '..name.ts');
      await fs.writeFile(hiddenPath, source, 'utf-8');
      index.chunks = [
        { ...original, id: 'valid-hidden', filePath: hiddenPath, relativePath: '..name.ts' },
        { ...original, id: 'outside-absolute', filePath: siblingPath },
        { ...original, id: 'outside-relative', filePath: '../web/src/auth/token.ts' },
        { ...original, id: 'missing', filePath: path.join(rootPath, 'missing.ts') }
      ];
      await fs.writeFile(indexPath, JSON.stringify(index), 'utf-8');
      const payload = await search(mode);
      expect(payload.results).toHaveLength(1);
      expect(payload.results[0].file).toMatch(/^\.\.name\.ts:\d+-\d+$/);
      expect(await fs.readFile(hiddenPath, 'utf-8')).toContain('registerToken');
      if (mode === 'compact') {
        expect(payload.nextHops?.find((hop) => hop.tool === 'read_file')?.args?.path).toBe(
          '..name.ts'
        );
      }
    },
    60000
  );
});
