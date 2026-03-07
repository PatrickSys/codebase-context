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
import { CONTEXT_RESOURCE_URI } from '../src/resources/uri.js';

interface SearchResultRow {
  summary: string;
  snippet: string;
  filePath: string;
  startLine: number;
  endLine: number;
  score: number;
  language: string;
  metadata: Record<string, unknown>;
}

interface ToolCallResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface ResourceReadResponse {
  contents: Array<{ uri: string; mimeType?: string; text?: string }>;
}

interface TestServer {
  _requestHandlers: Map<string, (request: unknown) => Promise<ToolCallResponse | ResourceReadResponse>>;
}

const searchMocks = vi.hoisted(() => ({
  search: vi.fn()
}));

const watcherMocks = vi.hoisted(() => ({
  start: vi.fn()
}));

vi.mock('../src/core/search.js', async () => {
  class CodebaseSearcher {
    constructor(private readonly rootPath: string) {}

    async search(query: string, limit: number, filters?: unknown, options?: unknown) {
      return searchMocks.search(this.rootPath, query, limit, filters, options);
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

vi.mock('../src/core/file-watcher.js', () => ({
  startFileWatcher: watcherMocks.start
}));

async function seedValidIndex(rootPath: string): Promise<void> {
  const ctxDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
  await fs.mkdir(path.join(ctxDir, VECTOR_DB_DIRNAME), { recursive: true });

  const buildId = `build-${path.basename(rootPath)}`;
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
}

describe('multi-project routing', () => {
  let primaryRoot: string;
  let secondaryRoot: string;
  let originalArgv: string[] | null = null;
  let originalEnvRoot: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    searchMocks.search.mockReset();
    watcherMocks.start.mockReset();

    originalArgv = [...process.argv];
    originalEnvRoot = process.env.CODEBASE_ROOT;

    primaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-primary-root-'));
    secondaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-secondary-root-'));
    process.env.CODEBASE_ROOT = primaryRoot;
    process.argv[2] = primaryRoot;

    await seedValidIndex(primaryRoot);
    await seedValidIndex(secondaryRoot);

    watcherMocks.start.mockImplementation(
      ({ rootPath }: { rootPath: string }) => () => `stopped:${rootPath}`
    );

    searchMocks.search.mockImplementation(
      async (rootPath: string): Promise<SearchResultRow[]> => [
        {
          summary: `Result for ${path.basename(rootPath)}`,
          snippet: 'snippet',
          filePath: path.join(rootPath, 'src', 'feature.ts'),
          startLine: 1,
          endLine: 2,
          score: 0.9,
          language: 'ts',
          metadata: {}
        }
      ]
    );
  });

  afterEach(async () => {
    const { clearProjects } = await import('../src/project-state.js');
    clearProjects();

    if (originalArgv) process.argv = originalArgv;
    if (originalEnvRoot === undefined) {
      delete process.env.CODEBASE_ROOT;
    } else {
      process.env.CODEBASE_ROOT = originalEnvRoot;
    }

    await fs.rm(primaryRoot, { recursive: true, force: true });
    await fs.rm(secondaryRoot, { recursive: true, force: true });
  });

  it('routes a tool call to the requested project_directory', async () => {
    const { server } = await import('../src/index.js');
    const handler = (server as unknown as TestServer)._requestHandlers.get('tools/call');

    if (!handler) {
      throw new Error('tools/call handler not registered');
    }

    const response = (await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'feature', project_directory: secondaryRoot }
      }
    })) as ToolCallResponse;

    expect(searchMocks.search).toHaveBeenCalledTimes(1);
    expect(searchMocks.search.mock.calls[0]?.[0]).toBe(secondaryRoot);
    expect(watcherMocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: secondaryRoot })
    );

    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      results: Array<{ file: string }>;
    };

    expect(payload.status).toBe('success');
    expect(payload.results[0]?.file).toContain('feature.ts');
  });

  it('returns an ambiguity error after multiple projects are known', async () => {
    const { server } = await import('../src/index.js');
    const handler = (server as unknown as TestServer)._requestHandlers.get('tools/call');

    if (!handler) {
      throw new Error('tools/call handler not registered');
    }

    await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'feature', project_directory: secondaryRoot }
      }
    });

    const response = (await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'feature' }
      }
    })) as ToolCallResponse;

    expect(response.isError).toBe(true);
    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      errorCode: string;
      availableRoots: string[];
    };

    expect(payload.status).toBe('error');
    expect(payload.errorCode).toBe('ambiguous_project');
    expect(payload.availableRoots).toEqual(expect.arrayContaining([primaryRoot, secondaryRoot]));
  });

  it('refuses ambiguous resource reads instead of serving the primary project', async () => {
    const { server } = await import('../src/index.js');
    const requestHandler = (server as unknown as TestServer)._requestHandlers.get('tools/call');
    const resourceHandler = (server as unknown as TestServer)._requestHandlers.get('resources/read');

    if (!requestHandler || !resourceHandler) {
      throw new Error('required handlers not registered');
    }

    await requestHandler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'feature', project_directory: secondaryRoot }
      }
    });

    const response = (await resourceHandler({
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: CONTEXT_RESOURCE_URI }
    })) as ResourceReadResponse;

    expect(response.contents[0]?.uri).toBe(CONTEXT_RESOURCE_URI);
    expect(response.contents[0]?.text).toContain('Multiple project roots are available');
  });
});
