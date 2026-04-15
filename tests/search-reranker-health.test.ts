import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { SearchResponse } from '../src/tools/types.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME
} from '../src/constants/codebase-context.js';
import { rmWithRetries } from './test-helpers.js';

const searchMocks = vi.hoisted(() => ({
  search: vi.fn()
}));

const rerankerMocks = vi.hoisted(() => ({
  getStatus: vi.fn()
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

vi.mock('../src/core/reranker.js', () => ({
  rerank: vi.fn(async (_query: string, results: unknown) => results),
  getRerankerStatus: rerankerMocks.getStatus,
  isAmbiguous: vi.fn(() => false)
}));

function makeResult() {
  return {
    summary: 'Auth service token management',
    snippet: 'export class AuthService { getToken() { return token; } }',
    filePath: 'src/auth/auth.service.ts',
    startLine: 1,
    endLine: 20,
    score: 0.85,
    language: 'ts',
    metadata: {}
  };
}

function parseSearchResponse(text: string): SearchResponse {
  return JSON.parse(text) as SearchResponse;
}

describe('search_codebase reranker health surface', () => {
  let tempRoot: string | null = null;
  let originalArgv: string[] | null = null;
  let originalEnvRoot: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    searchMocks.search.mockReset();
    rerankerMocks.getStatus.mockReset();

    originalArgv = [...process.argv];
    originalEnvRoot = process.env.CODEBASE_ROOT;

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'search-reranker-health-'));
    process.env.CODEBASE_ROOT = tempRoot;
    process.argv[2] = tempRoot;

    const ctxDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(path.join(ctxDir, VECTOR_DB_DIRNAME), { recursive: true });

    const buildId = 'test-build-reranker-health';
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
            vectorDb: { path: VECTOR_DB_DIRNAME, provider: 'lancedb' },
            intelligence: { path: INTELLIGENCE_FILENAME }
          }
        },
        null,
        2
      ),
      'utf-8'
    );

    await fs.writeFile(
      path.join(ctxDir, INTELLIGENCE_FILENAME),
      JSON.stringify(
        {
          header: { buildId, formatVersion: INDEX_FORMAT_VERSION },
          generatedAt,
          patterns: {},
          goldenFiles: []
        },
        null,
        2
      ),
      'utf-8'
    );
  });

  afterEach(async () => {
    if (originalArgv) process.argv = originalArgv;
    if (originalEnvRoot === undefined) {
      delete process.env.CODEBASE_ROOT;
    } else {
      process.env.CODEBASE_ROOT = originalEnvRoot;
    }

    if (tempRoot) {
      await rmWithRetries(tempRoot);
      tempRoot = null;
    }
  });

  it('surfaces rerankerStatus when reranker is unavailable', async () => {
    searchMocks.search.mockResolvedValueOnce([makeResult()]);
    rerankerMocks.getStatus.mockReturnValueOnce('unavailable');

    const { server } = await import('../src/index.js');
    const handler = (
      server as {
        _requestHandlers?: Map<
          string,
          (request: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>
        >;
      }
    )._requestHandlers?.get('tools/call');
    if (!handler) throw new Error('Expected tools/call handler');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_codebase', arguments: { query: 'auth service' } }
    });

    const payload = parseSearchResponse(response.content[0].text);
    expect(payload.searchQuality.rerankerStatus).toBe('unavailable');
  });

  it('omits rerankerStatus when reranker is not degraded', async () => {
    searchMocks.search.mockResolvedValueOnce([makeResult()]);
    rerankerMocks.getStatus.mockReturnValueOnce('fallback');

    const { server } = await import('../src/index.js');
    const handler = (
      server as {
        _requestHandlers?: Map<
          string,
          (request: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>
        >;
      }
    )._requestHandlers?.get('tools/call');
    if (!handler) throw new Error('Expected tools/call handler');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_codebase', arguments: { query: 'auth service' } }
    });

    const payload = parseSearchResponse(response.content[0].text);
    expect(payload.searchQuality.rerankerStatus).toBeUndefined();
  });
});
