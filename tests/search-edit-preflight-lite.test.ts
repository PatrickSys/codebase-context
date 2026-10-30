import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME
} from '../src/constants/codebase-context.js';

type SourceCoverageMock = {
  status: 'current' | 'partial' | 'no_fresh_results';
  checkedFiles: number;
  skippedFiles: number;
  refreshAction?: string;
};

type ToolCallRequest = {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/call';
  params: { name: string; arguments: Record<string, unknown> };
};

type ToolCallResponse = { content: Array<{ type: string; text: string }> };

type SearchPayload = {
  status: string;
  searchQuality?: { status: string; confidence: number };
  sourceCoverage?: SourceCoverageMock;
  preflight?: { ready: boolean; abstain?: boolean; reason?: string };
};

const searchMocks = vi.hoisted(() => ({
  search: vi.fn(),
  sourceCoverage: vi.fn(
    (): SourceCoverageMock => ({
      status: 'current',
      checkedFiles: 0,
      skippedFiles: 0
    })
  )
}));

function getToolCallHandler(
  server: unknown
): (request: ToolCallRequest) => Promise<ToolCallResponse> {
  const handlers = (server as { _requestHandlers?: unknown })._requestHandlers;
  if (!(handlers instanceof Map)) throw new Error('Expected server._requestHandlers to be a Map');
  const handler = handlers.get('tools/call');
  if (typeof handler !== 'function') throw new Error('Expected tools/call handler');
  return handler as (request: ToolCallRequest) => Promise<ToolCallResponse>;
}

vi.mock('../src/core/search.js', async () => {
  class CodebaseSearcher {
    constructor(_rootPath: string) {}

    async search(query: string, limit: number, filters?: unknown) {
      return searchMocks.search(query, limit, filters);
    }

    async searchWithCoverage(query: string, limit: number, filters?: unknown) {
      return {
        results: await this.search(query, limit, filters),
        sourceCoverage: searchMocks.sourceCoverage()
      };
    }
  }

  return { CodebaseSearcher };
});

describe('search_codebase preflight', () => {
  let tempRoot: string | null = null;
  let originalArgv: string[] | null = null;
  let originalEnvRoot: string | undefined;

  beforeEach(async () => {
    searchMocks.search.mockReset();
    searchMocks.sourceCoverage.mockReset().mockReturnValue({
      status: 'current',
      checkedFiles: 0,
      skippedFiles: 0
    });
    vi.resetModules();

    originalArgv = [...process.argv];
    originalEnvRoot = process.env.CODEBASE_ROOT;

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-context-edit-preflight-'));
    process.env.CODEBASE_ROOT = tempRoot;
    process.argv[2] = tempRoot;

    // Seed a minimal valid index + intelligence so preflight can render without indexing.
    const ctxDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(ctxDir, { recursive: true });

    const buildId = 'test-build-edit-preflight';
    const generatedAt = new Date().toISOString();

    await fs.mkdir(path.join(ctxDir, VECTOR_DB_DIRNAME), { recursive: true });
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
          generatedAt: new Date().toISOString(),
          internalFileGraph: {
            imports: {
              'src/app/app.config.ts': ['src/auth/auth.interceptor.ts'],
              'src/app/api/api.service.ts': ['src/auth/auth.interceptor.ts'],
              'src/app/feature/feature.ts': ['src/auth/auth.interceptor.ts'],
              'src/app/other.ts': ['src/auth/auth.interceptor.ts']
            }
          },
          patterns: {},
          goldenFiles: []
        },
        null,
        2
      )
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
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('omits edit readiness for discovery when intent is omitted', async () => {
    searchMocks.search.mockResolvedValueOnce([
      {
        summary: 'Auth interceptor implementation',
        snippet: 'intercept(req, next) { ... }',
        filePath: 'src/auth/auth.interceptor.ts',
        startLine: 1,
        endLine: 20,
        score: 0.42,
        language: 'ts',
        metadata: {}
      }
    ]);

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'How does this app attach the auth token to outgoing API calls?'
        }
      }
    });

    const payload = JSON.parse(response.content[0].text) as SearchPayload;
    expect(payload.status).toBe('success');
    expect(payload.searchQuality).toBeDefined();
    expect(payload.preflight).toBeUndefined();
  });

  it('keeps currentness and retrieval uncertainty visible for explicit exploration', async () => {
    searchMocks.search.mockResolvedValueOnce([
      {
        summary: 'Local cache recovery path',
        snippet: 'reloadCache() { return readSnapshot(); }',
        filePath: 'src/cache/recovery.ts',
        startLine: 14,
        endLine: 19,
        score: 0.05,
        language: 'ts',
        metadata: {}
      }
    ]);
    searchMocks.sourceCoverage.mockReturnValueOnce({
      status: 'partial',
      checkedFiles: 2,
      skippedFiles: 1,
      refreshAction: 'Refresh the index to inspect remaining candidates.'
    });

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);
    const response = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'cache recovery', intent: 'explore' }
      }
    });

    const payload = JSON.parse(response.content[0].text) as SearchPayload;
    expect(payload.sourceCoverage?.status).toBe('partial');
    expect(payload.sourceCoverage?.refreshAction).toBe(
      'Refresh the index to inspect remaining candidates.'
    );
    expect(payload.searchQuality?.status).toBeDefined();
    expect(payload.preflight).toBeUndefined();
  });

  it('returns preflight with ready flag when intent="edit"', async () => {
    searchMocks.search.mockResolvedValueOnce([
      {
        summary: 'Auth interceptor implementation',
        snippet: 'intercept(req, next) { ... }',
        filePath: 'src/auth/auth.interceptor.ts',
        startLine: 1,
        endLine: 20,
        score: 0.42,
        language: 'ts',
        metadata: {}
      }
    ]);

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'How does this app attach the auth token to outgoing API calls?',
          intent: 'edit'
        }
      }
    });

    const payload = JSON.parse(response.content[0].text) as SearchPayload;
    expect(payload.status).toBe('success');
    expect(payload.preflight).toBeTruthy();
    expect(typeof payload.preflight?.ready).toBe('boolean');
  });

  it('keeps the explicit edit gate closed when source coverage is partial', async () => {
    searchMocks.search.mockResolvedValueOnce([
      {
        summary: 'Local cache recovery path',
        snippet: 'reloadCache() { return readSnapshot(); }',
        filePath: 'src/cache/recovery.ts',
        startLine: 14,
        endLine: 19,
        score: 0.05,
        language: 'ts',
        metadata: {}
      }
    ]);
    searchMocks.sourceCoverage.mockReturnValueOnce({
      status: 'partial',
      checkedFiles: 2,
      skippedFiles: 1,
      refreshAction: 'Refresh the index to inspect remaining candidates.'
    });

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);
    const response = await handler({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'cache recovery', intent: 'edit' }
      }
    });

    const payload = JSON.parse(response.content[0].text) as SearchPayload;
    expect(payload.preflight?.ready).toBe(false);
    expect(payload.preflight?.abstain).toBe(true);
    expect(payload.preflight?.reason).toBe('Refresh the index to inspect remaining candidates.');
  });
});
