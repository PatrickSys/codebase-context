import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME
} from '../src/constants/codebase-context.js';
import {
  CONTEXT_RESOURCE_URI,
  FULL_CONTEXT_RESOURCE_URI,
  buildProjectContextResourceUri,
  buildProjectFullContextResourceUri
} from '../src/resources/uri.js';

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
  _requestHandlers: Map<
    string,
    (request: unknown) => Promise<ToolCallResponse | ResourceReadResponse>
  >;
}

const searchMocks = vi.hoisted(() => ({
  search: vi.fn()
}));

const indexerMocks = vi.hoisted(() => ({
  index: vi.fn()
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

function parsePayload(response: ToolCallResponse): Record<string, unknown> {
  return JSON.parse(response.content[0]?.text ?? '{}') as Record<string, unknown>;
}

async function callTool(
  handler: (request: unknown) => Promise<ToolCallResponse | ResourceReadResponse>,
  id: number,
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResponse> {
  return (await handler({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args }
  })) as ToolCallResponse;
}

describe('multi-project routing', () => {
  let primaryRoot: string;
  let secondaryRoot: string;
  let nestedProjectRoot: string;
  let originalArgv: string[] | null = null;
  let originalEnvRoot: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    searchMocks.search.mockReset();
    indexerMocks.index.mockReset();
    watcherMocks.start.mockReset();

    originalArgv = [...process.argv];
    originalEnvRoot = process.env.CODEBASE_ROOT;

    primaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-primary-root-'));
    secondaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-secondary-root-'));
    nestedProjectRoot = path.join(primaryRoot, 'apps', 'dashboard');

    process.env.CODEBASE_ROOT = primaryRoot;
    process.argv[2] = primaryRoot;

    await seedValidIndex(primaryRoot);
    await seedValidIndex(secondaryRoot);
    await fs.mkdir(nestedProjectRoot, { recursive: true });
    await seedValidIndex(nestedProjectRoot);

    watcherMocks.start.mockImplementation(
      ({ rootPath }: { rootPath: string }) =>
        () =>
          `stopped:${rootPath}`
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

  it('starts without a bootstrap root and routes once client roots arrive', async () => {
    delete process.env.CODEBASE_ROOT;
    delete process.argv[2];

    const { server, refreshKnownRootsFromClient } = await import('../src/index.js');
    const typedServer = server as unknown as TestServer & {
      listRoots: () => Promise<{ roots: Array<{ uri: string; name?: string }> }>;
    };
    const originalListRoots = typedServer.listRoots.bind(typedServer);
    const handler = typedServer._requestHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');

    typedServer.listRoots = vi.fn().mockResolvedValue({
      roots: [{ uri: pathToFileURL(secondaryRoot).href, name: 'Secondary' }]
    });

    try {
      await refreshKnownRootsFromClient();
      const response = await callTool(handler, 1, 'search_codebase', { query: 'feature' });
      const payload = parsePayload(response) as {
        status: string;
        project: { rootPath: string; label: string };
      };

      expect(payload.status).toBe('success');
      expect(payload.project.rootPath).toBe(secondaryRoot);
      expect(payload.project.label).toBe('Secondary');
    } finally {
      typedServer.listRoots = originalListRoots;
    }
  });

  it('ignores invalid client roots instead of registering or creating them', async () => {
    delete process.env.CODEBASE_ROOT;
    delete process.argv[2];

    const missingRoot = path.join(os.tmpdir(), `cc-missing-root-${Date.now()}`);
    const { server, refreshKnownRootsFromClient } = await import('../src/index.js');
    const typedServer = server as unknown as TestServer & {
      listRoots: () => Promise<{ roots: Array<{ uri: string; name?: string }> }>;
    };
    const originalListRoots = typedServer.listRoots.bind(typedServer);
    const toolHandler = typedServer._requestHandlers.get('tools/call');
    const resourceHandler = typedServer._requestHandlers.get('resources/read');
    if (!toolHandler || !resourceHandler) throw new Error('required handlers not registered');

    typedServer.listRoots = vi.fn().mockResolvedValue({
      roots: [{ uri: pathToFileURL(missingRoot).href, name: 'Missing' }]
    });

    try {
      await refreshKnownRootsFromClient();

      const response = await callTool(toolHandler, 90, 'search_codebase', { query: 'feature' });
      const payload = parsePayload(response) as {
        status: string;
        errorCode: string;
      };

      expect(response.isError).toBe(true);
      expect(payload.status).toBe('selection_required');
      expect(payload.errorCode).toBe('selection_required');
      await expect(fs.stat(missingRoot)).rejects.toThrow();

      const resourceResponse = (await resourceHandler({
        jsonrpc: '2.0',
        id: 91,
        method: 'resources/read',
        params: { uri: CONTEXT_RESOURCE_URI }
      })) as ResourceReadResponse;

      expect(resourceResponse.contents[0]?.text).not.toContain(missingRoot);
    } finally {
      typedServer.listRoots = originalListRoots;
    }
  });

  it('does not eagerly index every announced root during background refresh', async () => {
    delete process.env.CODEBASE_ROOT;
    delete process.argv[2];

    const unindexedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-unindexed-root-'));
    const { server, refreshKnownRootsFromClient } = await import('../src/index.js');
    const typedServer = server as unknown as TestServer & {
      listRoots: () => Promise<{ roots: Array<{ uri: string; name?: string }> }>;
    };
    const originalListRoots = typedServer.listRoots.bind(typedServer);

    typedServer.listRoots = vi.fn().mockResolvedValue({
      roots: [{ uri: pathToFileURL(unindexedRoot).href, name: 'Unindexed' }]
    });

    try {
      await refreshKnownRootsFromClient();
      expect(indexerMocks.index).not.toHaveBeenCalled();
    } finally {
      typedServer.listRoots = originalListRoots;
      await fs.rm(unindexedRoot, { recursive: true, force: true });
    }
  });

  it('supports explicit project routing without bootstrap roots when the client does not expose roots', async () => {
    delete process.env.CODEBASE_ROOT;
    delete process.argv[2];

    const { server, refreshKnownRootsFromClient } = await import('../src/index.js');
    const typedServer = server as unknown as TestServer & {
      listRoots: () => Promise<{ roots: Array<{ uri: string; name?: string }> }>;
    };
    const originalListRoots = typedServer.listRoots.bind(typedServer);
    const handler = typedServer._requestHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');

    typedServer.listRoots = vi.fn().mockRejectedValue(new Error('roots unsupported'));

    try {
      await refreshKnownRootsFromClient();
      const response = await callTool(handler, 2, 'search_codebase', {
        query: 'feature',
        project: secondaryRoot
      });
      const payload = parsePayload(response) as {
        status: string;
        project: { rootPath: string };
      };

      expect(payload.status).toBe('success');
      expect(payload.project.rootPath).toBe(secondaryRoot);
    } finally {
      typedServer.listRoots = originalListRoots;
    }
  });

  it('triggers a background rebuild for a corrupted explicit project without falling back to cwd', async () => {
    delete process.env.CODEBASE_ROOT;
    delete process.argv[2];

    await fs.rm(path.join(secondaryRoot, CODEBASE_CONTEXT_DIRNAME, INDEX_META_FILENAME), {
      force: true
    });

    const { server, refreshKnownRootsFromClient } = await import('../src/index.js');
    const typedServer = server as unknown as TestServer & {
      listRoots: () => Promise<{ roots: Array<{ uri: string; name?: string }> }>;
    };
    const originalListRoots = typedServer.listRoots.bind(typedServer);
    const handler = typedServer._requestHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');

    typedServer.listRoots = vi.fn().mockRejectedValue(new Error('roots unsupported'));

    try {
      await refreshKnownRootsFromClient();
      const response = await callTool(handler, 21, 'search_codebase', {
        query: 'feature',
        project: secondaryRoot
      });
      const payload = parsePayload(response) as {
        status: string;
        message: string;
        index?: { action?: string; reason?: string };
      };

      expect(payload.status).toBe('indexing');
      expect(payload.message).toContain('retry shortly');
      expect(payload.index?.action).toBe('rebuild-started');
      expect(String(payload.index?.reason || '')).toContain('Index meta');
    } finally {
      typedServer.listRoots = originalListRoots;
    }
  });

  it('returns selection_required instead of silently falling back to cwd when startup is rootless and unresolved', async () => {
    delete process.env.CODEBASE_ROOT;
    delete process.argv[2];

    const { server, refreshKnownRootsFromClient } = await import('../src/index.js');
    const typedServer = server as unknown as TestServer & {
      listRoots: () => Promise<{ roots: Array<{ uri: string; name?: string }> }>;
    };
    const originalListRoots = typedServer.listRoots.bind(typedServer);
    const handler = typedServer._requestHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');

    typedServer.listRoots = vi.fn().mockRejectedValue(new Error('roots unsupported'));

    try {
      await refreshKnownRootsFromClient();
      const response = await callTool(handler, 3, 'search_codebase', { query: 'feature' });
      const payload = parsePayload(response) as {
        status: string;
        errorCode: string;
      };

      expect(response.isError).toBe(true);
      expect(payload.status).toBe('selection_required');
      expect(payload.errorCode).toBe('selection_required');
      expect(searchMocks.search).not.toHaveBeenCalled();
    } finally {
      typedServer.listRoots = originalListRoots;
    }
  });

  it('auto-selects the only known project when routing without an explicit selector', async () => {
    const { server, refreshKnownRootsFromClient } = await import('../src/index.js');
    const handler = (server as unknown as TestServer)._requestHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');

    await fs.rm(nestedProjectRoot, { recursive: true, force: true });
    await refreshKnownRootsFromClient();
    const response = await callTool(handler, 4, 'search_codebase', { query: 'feature' });
    const payload = parsePayload(response) as {
      status: string;
      project: { project: string; rootPath: string };
    };

    expect(payload.status).toBe('success');
    expect(payload.project.rootPath).toBe(primaryRoot);
    expect(payload.project.project).toBe(primaryRoot);
    expect(watcherMocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: primaryRoot })
    );
  });

  it('explicit project starts a watcher and makes that project active', async () => {
    const { server } = await import('../src/index.js');
    const handler = (server as unknown as TestServer)._requestHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');

    const response = await callTool(handler, 5, 'search_codebase', {
      query: 'feature',
      project: secondaryRoot
    });
    const payload = parsePayload(response) as {
      status: string;
      project: { project: string; rootPath: string };
    };

    expect(payload.status).toBe('success');
    expect(payload.project.rootPath).toBe(secondaryRoot);
    expect(payload.project.project).toBe(secondaryRoot);
    expect(watcherMocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: secondaryRoot })
    );
  });

  it('uses the active project for later tool calls and returns project metadata', async () => {
    const { server } = await import('../src/index.js');
    const handler = (server as unknown as TestServer)._requestHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');

    const selection = await callTool(handler, 6, 'search_codebase', {
      query: 'feature',
      project: secondaryRoot
    });
    const selectedProject = (parsePayload(selection) as { project: { project: string } }).project
      .project;

    const response = await callTool(handler, 7, 'search_codebase', { query: 'feature' });
    const payload = parsePayload(response) as {
      status: string;
      project: { project: string; rootPath: string };
      results: Array<{ file: string }>;
    };

    expect(payload.status).toBe('success');
    expect(payload.project.project).toBe(selectedProject);
    expect(payload.project.rootPath).toBe(secondaryRoot);
    expect(searchMocks.search).toHaveBeenCalledWith(secondaryRoot, 'feature', 5, undefined, {
      profile: 'explore'
    });
    expect(payload.results[0]?.file).toContain('feature.ts');
  });

  it('explicit project overrides the active project and updates subsequent routing', async () => {
    const { server } = await import('../src/index.js');
    const handler = (server as unknown as TestServer)._requestHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');

    await callTool(handler, 8, 'search_codebase', { query: 'feature', project: secondaryRoot });
    await callTool(handler, 9, 'search_codebase', { query: 'feature', project: primaryRoot });
    await callTool(handler, 10, 'search_codebase', { query: 'feature' });
    await callTool(handler, 11, 'search_codebase', { query: 'feature' });

    expect(searchMocks.search.mock.calls[0]?.[0]).toBe(secondaryRoot);
    expect(searchMocks.search.mock.calls[1]?.[0]).toBe(primaryRoot);
    expect(searchMocks.search.mock.calls[2]?.[0]).toBe(primaryRoot);
    expect(searchMocks.search.mock.calls[3]?.[0]).toBe(primaryRoot);
  });

  it('requires explicit project selection in ambiguous multi-root sessions without an active project', async () => {
    const { server, refreshKnownRootsFromClient } = await import('../src/index.js');
    const typedServer = server as unknown as TestServer & {
      listRoots: () => Promise<{ roots: Array<{ uri: string }> }>;
    };
    const originalListRoots = typedServer.listRoots.bind(typedServer);
    const handler = typedServer._requestHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');

    typedServer.listRoots = vi.fn().mockResolvedValue({
      roots: [{ uri: pathToFileURL(primaryRoot).href }, { uri: pathToFileURL(secondaryRoot).href }]
    });

    try {
      await refreshKnownRootsFromClient();
      const response = await callTool(handler, 12, 'search_codebase', { query: 'feature' });
      const payload = parsePayload(response) as {
        status: string;
        errorCode: string;
        reason: string;
        nextAction: string;
        availableProjects: Array<{ project: string; rootPath: string }>;
      };

      expect(response.isError).toBe(true);
      expect(payload.status).toBe('selection_required');
      expect(payload.errorCode).toBe('selection_required');
      expect(payload.reason).toBe('multiple_projects_configured_no_active_context');
      expect(payload.nextAction).toBe('retry_with_project');
      expect(payload.availableProjects.length).toBeGreaterThanOrEqual(2);
      expect(payload.availableProjects[0]?.project).toBeTruthy();
    } finally {
      typedServer.listRoots = originalListRoots;
    }
  });

  it('generic context resource follows the active project after selection', async () => {
    const { server } = await import('../src/index.js');
    const requestHandler = (server as unknown as TestServer)._requestHandlers.get('tools/call');
    const resourceHandler = (server as unknown as TestServer)._requestHandlers.get(
      'resources/read'
    );

    if (!requestHandler || !resourceHandler) {
      throw new Error('required handlers not registered');
    }

    await callTool(requestHandler, 13, 'search_codebase', {
      query: 'feature',
      project: secondaryRoot
    });

    const response = (await resourceHandler({
      jsonrpc: '2.0',
      id: 14,
      method: 'resources/read',
      params: { uri: CONTEXT_RESOURCE_URI }
    })) as ResourceReadResponse;

    expect(response.contents[0]?.uri).toBe(CONTEXT_RESOURCE_URI);
    expect(response.contents[0]?.text).toContain('# Codebase Map');
    expect(response.contents[0]?.text).not.toContain('Project selection required');
  });

  it('lists bounded and full context resources for active and project-scoped flows', async () => {
    const { server } = await import('../src/index.js');
    const toolHandler = (server as unknown as TestServer)._requestHandlers.get('tools/call');
    const resourcesHandler = (server as unknown as TestServer)._requestHandlers.get('resources/list');

    if (!toolHandler || !resourcesHandler) {
      throw new Error('required handlers not registered');
    }

    await callTool(toolHandler, 140, 'search_codebase', {
      query: 'feature',
      project: secondaryRoot
    });

    const response = (await resourcesHandler({
      jsonrpc: '2.0',
      id: 141,
      method: 'resources/list',
      params: {}
    })) as { resources: Array<{ uri: string }> };

    const uris = response.resources.map((resource) => resource.uri);
    expect(uris).toContain(CONTEXT_RESOURCE_URI);
    expect(uris).toContain(FULL_CONTEXT_RESOURCE_URI);
    expect(uris).toContain(buildProjectContextResourceUri(primaryRoot));
    expect(uris).toContain(buildProjectFullContextResourceUri(primaryRoot));
    expect(uris).toContain(buildProjectContextResourceUri(secondaryRoot));
    expect(uris).toContain(buildProjectFullContextResourceUri(secondaryRoot));
  });

  it('generic full context resource follows the active project after selection', async () => {
    const { server } = await import('../src/index.js');
    const requestHandler = (server as unknown as TestServer)._requestHandlers.get('tools/call');
    const resourceHandler = (server as unknown as TestServer)._requestHandlers.get(
      'resources/read'
    );

    if (!requestHandler || !resourceHandler) {
      throw new Error('required handlers not registered');
    }

    await callTool(requestHandler, 142, 'search_codebase', {
      query: 'feature',
      project: secondaryRoot
    });

    const response = (await resourceHandler({
      jsonrpc: '2.0',
      id: 143,
      method: 'resources/read',
      params: { uri: FULL_CONTEXT_RESOURCE_URI }
    })) as ResourceReadResponse;

    expect(response.contents[0]?.uri).toBe(FULL_CONTEXT_RESOURCE_URI);
    expect(response.contents[0]?.text).toContain('# Codebase Map');
    expect(response.contents[0]?.text).not.toContain('Project selection required');
  });

  it('builds a workspace overview for multiple configured roots before selection', async () => {
    const { server, refreshKnownRootsFromClient } = await import('../src/index.js');
    const typedServer = server as unknown as TestServer & {
      listRoots: () => Promise<{ roots: Array<{ uri: string }> }>;
    };
    const originalListRoots = typedServer.listRoots.bind(typedServer);
    const resourceHandler = typedServer._requestHandlers.get('resources/read');

    if (!resourceHandler) {
      throw new Error('resources/read handler not registered');
    }

    typedServer.listRoots = vi.fn().mockResolvedValue({
      roots: [{ uri: pathToFileURL(primaryRoot).href }, { uri: pathToFileURL(secondaryRoot).href }]
    });

    try {
      await refreshKnownRootsFromClient();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const response = (await resourceHandler({
        jsonrpc: '2.0',
        id: 15,
        method: 'resources/read',
        params: { uri: CONTEXT_RESOURCE_URI }
      })) as ResourceReadResponse;

      expect(response.contents[0]?.text).toContain('# Codebase Workspace');
      expect(response.contents[0]?.text).toContain(
        'client-announced roots as the workspace boundary'
      );
      expect(response.contents[0]?.text).toContain('codebase://context/project/');
      expect(response.contents[0]?.text).toContain('codebase://context/full/project/');
      expect(response.contents[0]?.text).toContain('retry tool calls with `project`');
      expect(response.contents[0]?.text).toContain('apps/dashboard');
      expect(response.contents[0]?.text).toMatch(/\[(idle|indexing|ready)\]/);
      expect(watcherMocks.start).not.toHaveBeenCalledWith(
        expect.objectContaining({ rootPath: secondaryRoot })
      );
    } finally {
      typedServer.listRoots = originalListRoots;
    }
  });

  it('supports project-scoped resource reads and monorepo subdirectory selection by relative path', async () => {
    const { server, refreshKnownRootsFromClient } = await import('../src/index.js');
    const requestHandler = (server as unknown as TestServer)._requestHandlers.get('tools/call');
    const resourceHandler = (server as unknown as TestServer)._requestHandlers.get(
      'resources/read'
    );

    if (!requestHandler || !resourceHandler) {
      throw new Error('required handlers not registered');
    }

    await refreshKnownRootsFromClient();
    const selection = await callTool(requestHandler, 16, 'search_codebase', {
      query: 'feature',
      project: 'apps/dashboard'
    });
    const payload = parsePayload(selection) as {
      status: string;
      project: { project: string; label: string; rootPath: string; relativePath?: string };
    };

    expect(payload.status).toBe('success');
    expect(payload.project.rootPath).toBe(nestedProjectRoot);
    expect(payload.project.label).toBe('apps/dashboard');
    expect(payload.project.relativePath).toBe('apps/dashboard');

    const response = (await resourceHandler({
      jsonrpc: '2.0',
      id: 17,
      method: 'resources/read',
      params: { uri: buildProjectContextResourceUri(payload.project.project) }
    })) as ResourceReadResponse;

    expect(response.contents[0]?.uri).toBe(buildProjectContextResourceUri(payload.project.project));
    expect(response.contents[0]?.text).toContain('# Codebase Map');

    const fullResponse = (await resourceHandler({
      jsonrpc: '2.0',
      id: 171,
      method: 'resources/read',
      params: { uri: buildProjectFullContextResourceUri(payload.project.project) }
    })) as ResourceReadResponse;

    expect(fullResponse.contents[0]?.uri).toBe(
      buildProjectFullContextResourceUri(payload.project.project)
    );
    expect(fullResponse.contents[0]?.text).toContain('# Codebase Map');
  });

  it('returns unknown_project error when project path does not exist', async () => {
    const { server } = await import('../src/index.js');
    const handler = (server as unknown as TestServer)._requestHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');

    const bogusPath = path.join(os.tmpdir(), `cc-nonexistent-${Date.now()}`);
    const response = await callTool(handler, 19, 'search_codebase', {
      query: 'feature',
      project: bogusPath
    });
    const payload = parsePayload(response) as {
      status: string;
      errorCode: string;
      message: string;
    };

    expect(response.isError).toBe(true);
    expect(payload.errorCode).toBe('unknown_project');
    expect(payload.message).toContain('does not exist');
  });

  it('resolves a file path selector to the nearest discovered project boundary', async () => {
    const filePath = path.join(nestedProjectRoot, 'src', 'auth', 'guard.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const guard = true;\n', 'utf-8');

    const { server, refreshKnownRootsFromClient } = await import('../src/index.js');
    const typedServer = server as unknown as TestServer & {
      listRoots: () => Promise<{ roots: Array<{ uri: string; name?: string }> }>;
    };
    const originalListRoots = typedServer.listRoots.bind(typedServer);
    const handler = typedServer._requestHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');

    typedServer.listRoots = vi.fn().mockResolvedValue({
      roots: [{ uri: pathToFileURL(primaryRoot).href, name: 'Primary' }]
    });

    try {
      await refreshKnownRootsFromClient();
      const response = await callTool(handler, 18, 'search_codebase', {
        query: 'feature',
        project: filePath
      });
      const payload = parsePayload(response) as {
        status: string;
        project: { rootPath: string; relativePath?: string };
      };

      expect(payload.status).toBe('success');
      expect(payload.project.rootPath).toBe(nestedProjectRoot);
      expect(payload.project.relativePath).toBe('apps/dashboard');
    } finally {
      typedServer.listRoots = originalListRoots;
    }
  });
});
