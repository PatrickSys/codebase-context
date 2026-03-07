import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME
} from '../src/constants/codebase-context.js';

const searchMocks = vi.hoisted(() => ({
  search: vi.fn()
}));

const indexerMocks = vi.hoisted(() => ({
  index: vi.fn()
}));

vi.mock('../src/core/search.js', async () => {
  class CodebaseSearcher {
    constructor(_rootPath: string) {}

    async search(query: string, limit: number, filters?: unknown) {
      return searchMocks.search(query, limit, filters);
    }
  }

  return { CodebaseSearcher };
});

vi.mock('../src/core/indexer.js', () => {
  class CodebaseIndexer {
    constructor(_options: unknown) {}

    getProgress() {
      return { phase: 'complete', percentage: 100 };
    }

    async index() {
      indexerMocks.index();
      return {
        totalFiles: 0,
        indexedFiles: 0,
        skippedFiles: 0,
        totalChunks: 0,
        totalLines: 0,
        duration: 0,
        avgChunkSize: 0,
        componentsByType: {},
        componentsByLayer: {
          presentation: 0,
          business: 0,
          data: 0,
          state: 0,
          core: 0,
          shared: 0,
          feature: 0,
          infrastructure: 0,
          unknown: 0
        },
        errors: [],
        startedAt: new Date(),
        completedAt: new Date()
      };
    }
  }

  return { CodebaseIndexer };
});

describe('search_codebase auto-heal', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let tempRoot: string | null = null;
  let originalArgv: string[] | null = null;
  let originalEnvRoot: string | undefined;

  beforeEach(async () => {
    searchMocks.search.mockReset();
    indexerMocks.index.mockReset();
    vi.resetModules();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Ensure src/index.ts resolves ROOT_PATH to an isolated temp workspace, not this repo.
    // This avoids slow git operations during performIndexing() and keeps the test deterministic.
    originalArgv = [...process.argv];
    originalEnvRoot = process.env.CODEBASE_ROOT;
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-context-auto-heal-'));
    process.env.CODEBASE_ROOT = tempRoot;
    process.argv[2] = tempRoot;

    // Seed a minimal valid index so Phase 06 validation gate passes.
    const ctxDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(path.join(ctxDir, VECTOR_DB_DIRNAME), { recursive: true });
    const buildId = 'test-build-auto-heal';
    const generatedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(ctxDir, VECTOR_DB_DIRNAME, 'index-build.json'),
      JSON.stringify({ buildId, formatVersion: INDEX_FORMAT_VERSION }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(ctxDir, KEYWORD_INDEX_FILENAME),
      JSON.stringify({ header: { buildId, formatVersion: INDEX_FORMAT_VERSION }, chunks: [] }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(ctxDir, INDEX_META_FILENAME),
      JSON.stringify(
        {
          metaVersion: INDEX_META_VERSION,
          formatVersion: INDEX_FORMAT_VERSION,
          buildId,
          generatedAt,
          toolVersion: 'test',
          artifacts: {
            keywordIndex: { path: KEYWORD_INDEX_FILENAME },
            vectorDb: { path: VECTOR_DB_DIRNAME, provider: 'lancedb' }
          }
        },
        null,
        2
      ),
      'utf-8'
    );
  });

  afterEach(async () => {
    consoleErrorSpy.mockRestore();

    if (originalArgv) process.argv = originalArgv;
    if (originalEnvRoot === undefined) {
      delete process.env.CODEBASE_ROOT;
    } else {
      process.env.CODEBASE_ROOT = originalEnvRoot;
    }

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('fires background re-index and returns retry message when IndexCorruptedError is thrown', async () => {
    const { IndexCorruptedError } = await import('../src/errors/index.js');

    searchMocks.search.mockRejectedValueOnce(
      new IndexCorruptedError('LanceDB index corrupted: missing vector column')
    );

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'test'
        }
      }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.status).toBe('indexing');
    expect(payload.message).toContain('retry');
    expect(searchMocks.search).toHaveBeenCalledTimes(1);
  }, 15000);

  it('returns invalid_params when search_codebase query is missing', async () => {
    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {}
      }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(response.isError).toBe(true);
    expect(payload.errorCode).toBe('invalid_params');
    expect(payload.message).toContain('query');
  });

  it('supports get_style_guide with no query in limited mode', async () => {
    if (!tempRoot) {
      throw new Error('tempRoot not initialized');
    }

    await fs.writeFile(
      path.join(tempRoot, 'STYLE_GUIDE.md'),
      [
        '# Style Guide',
        '',
        '## Naming',
        'Use descriptive names.',
        '',
        '## Testing',
        'Write unit tests for business logic.',
        '',
        '## Architecture',
        'Prefer layered architecture boundaries.'
      ].join('\n')
    );

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_style_guide',
        arguments: {}
      }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.status).toBe('success');
    expect(payload.limited).toBe(true);
    expect(payload.notice).toContain('No query provided');
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results.length).toBeLessThanOrEqual(3);
    expect(payload.results[0].relevantSections.length).toBeLessThanOrEqual(2);
  });
});
