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

// Keep tool calls fast and deterministic in this suite.
vi.mock('../src/core/search.js', async () => {
  class CodebaseSearcher {
    constructor(_rootPath: string) {}
    async search(query: string, limit: number, filters?: unknown, options?: unknown) {
      return searchMocks.search(query, limit, filters, options);
    }
  }

  return { CodebaseSearcher };
});

vi.mock('../src/core/indexer.js', async () => {
  const { promises: fs } = await import('fs');
  const path = (await import('path')).default;
  const {
    CODEBASE_CONTEXT_DIRNAME,
    INDEX_FORMAT_VERSION,
    INDEX_META_FILENAME,
    INDEX_META_VERSION,
    KEYWORD_INDEX_FILENAME,
    VECTOR_DB_DIRNAME
  } = await import('../src/constants/codebase-context.js');

  let rebuildCounter = 0;

  class CodebaseIndexer {
    private rootPath: string;

    constructor(options: { rootPath: string }) {
      this.rootPath = options.rootPath;
    }

    getProgress() {
      return { phase: 'complete', percentage: 100 };
    }

    async index() {
      indexerMocks.index();
      rebuildCounter += 1;

      const buildId = `rebuilt-${rebuildCounter}`;
      const generatedAt = new Date().toISOString();

      const ctxDir = path.join(this.rootPath, CODEBASE_CONTEXT_DIRNAME);
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
              vectorDb: { path: VECTOR_DB_DIRNAME, provider: 'lancedb' }
            }
          },
          null,
          2
        ),
        'utf-8'
      );

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

    async detectMetadata() {
      return {
        name: 'test',
        rootPath: this.rootPath,
        languages: [],
        dependencies: [],
        architecture: {
          type: 'mixed',
          layers: {
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
          patterns: []
        },
        styleGuides: [],
        documentation: [],
        projectStructure: { type: 'single-app' },
        statistics: {
          totalFiles: 0,
          totalLines: 0,
          totalComponents: 0,
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
          }
        },
        customMetadata: {}
      };
    }
  }

  return { CodebaseIndexer };
});

describe('index versioning migration (MIGR-01)', () => {
  let tempRoot: string | null = null;
  let originalArgv: string[] | null = null;
  let originalEnvRoot: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    searchMocks.search.mockReset();
    indexerMocks.index.mockReset();

    originalArgv = [...process.argv];
    originalEnvRoot = process.env.CODEBASE_ROOT;

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'index-versioning-migration-'));
    process.env.CODEBASE_ROOT = tempRoot;
    process.argv[2] = tempRoot;

    searchMocks.search.mockResolvedValue([
      {
        summary: 'Test summary',
        snippet: 'Test snippet',
        filePath: 'src/a.ts',
        startLine: 1,
        endLine: 2,
        score: 0.9,
        language: 'ts',
        metadata: {}
      }
    ]);
  });

  afterEach(async () => {
    const { clearProjects } = await import('../src/project-state.js');
    clearProjects();

    if (originalArgv) process.argv = originalArgv;
    if (originalEnvRoot === undefined) delete process.env.CODEBASE_ROOT;
    else process.env.CODEBASE_ROOT = originalEnvRoot;

    if (tempRoot) {
      // Background indexing (fire-and-forget) may still be writing — retry on ENOTEMPTY
      await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      tempRoot = null;
    }
  });

  it('refuses legacy indexes without index-meta.json and triggers background rebuild', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const ctxDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(path.join(ctxDir, VECTOR_DB_DIRNAME), { recursive: true });

    // Legacy artifacts: keyword index without header and no index-meta.json
    await fs.writeFile(path.join(ctxDir, KEYWORD_INDEX_FILENAME), JSON.stringify([]), 'utf-8');
    await fs.writeFile(
      path.join(ctxDir, VECTOR_DB_DIRNAME, 'index-build.json'),
      JSON.stringify({ buildId: 'legacy', formatVersion: 0 }),
      'utf-8'
    );

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_codebase', arguments: { query: 'test' } }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.status).toBe('indexing');
    expect(payload.message).toContain('retry');
    expect(payload.index).toBeTruthy();
    expect(payload.index.action).toBe('rebuild-started');
    expect(String(payload.index.reason || '')).toContain('Index meta');
  });

  it('detects keyword index header mismatch and triggers background rebuild', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const ctxDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(path.join(ctxDir, VECTOR_DB_DIRNAME), { recursive: true });

    const metaBuildId = 'meta-build';
    const indexBuildId = 'different-build';
    const generatedAt = new Date().toISOString();

    await fs.writeFile(
      path.join(ctxDir, VECTOR_DB_DIRNAME, 'index-build.json'),
      JSON.stringify({ buildId: metaBuildId, formatVersion: INDEX_FORMAT_VERSION }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(ctxDir, KEYWORD_INDEX_FILENAME),
      JSON.stringify({
        header: { buildId: indexBuildId, formatVersion: INDEX_FORMAT_VERSION },
        chunks: []
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(ctxDir, INDEX_META_FILENAME),
      JSON.stringify(
        {
          metaVersion: INDEX_META_VERSION,
          formatVersion: INDEX_FORMAT_VERSION,
          buildId: metaBuildId,
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

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_codebase', arguments: { query: 'test' } }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.status).toBe('indexing');
    expect(payload.message).toContain('retry');
    expect(payload.index.action).toBe('rebuild-started');
    expect(String(payload.index.reason || '')).toContain('Keyword index');
  });

  it('detects vector DB build marker mismatch and triggers background rebuild', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const ctxDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(path.join(ctxDir, VECTOR_DB_DIRNAME), { recursive: true });

    const metaBuildId = 'meta-build';
    const vectorBuildId = 'different-build';
    const generatedAt = new Date().toISOString();

    await fs.writeFile(
      path.join(ctxDir, VECTOR_DB_DIRNAME, 'index-build.json'),
      JSON.stringify({ buildId: vectorBuildId, formatVersion: INDEX_FORMAT_VERSION }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(ctxDir, KEYWORD_INDEX_FILENAME),
      JSON.stringify({
        header: { buildId: metaBuildId, formatVersion: INDEX_FORMAT_VERSION },
        chunks: []
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(ctxDir, INDEX_META_FILENAME),
      JSON.stringify(
        {
          metaVersion: INDEX_META_VERSION,
          formatVersion: INDEX_FORMAT_VERSION,
          buildId: metaBuildId,
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

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_codebase', arguments: { query: 'test' } }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.status).toBe('indexing');
    expect(payload.message).toContain('retry');
    expect(payload.index.action).toBe('rebuild-started');
    expect(String(payload.index.reason || '')).toContain('Vector DB');
  });
});

describe('index-consuming allowlist enforcement', () => {
  let tempRoot: string | null = null;
  let originalArgv: string[] | null = null;
  let originalEnvRoot: string | undefined;

  beforeEach(async () => {
    vi.resetModules();

    originalArgv = [...process.argv];
    originalEnvRoot = process.env.CODEBASE_ROOT;
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'index-versioning-allowlist-'));
    process.env.CODEBASE_ROOT = tempRoot;
    process.argv[2] = tempRoot;

    const ctxDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    const buildId = 'allowlist-build';
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
    const { clearProjects } = await import('../src/project-state.js');
    clearProjects();

    if (originalArgv) process.argv = originalArgv;
    if (originalEnvRoot === undefined) delete process.env.CODEBASE_ROOT;
    else process.env.CODEBASE_ROOT = originalEnvRoot;

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('ensures any tool cases that consume index artifacts are listed in INDEX_CONSUMING_TOOL_NAMES', async () => {
    const indexSource = await fs.readFile(path.join(process.cwd(), 'src', 'index.ts'), 'utf-8');

    // Extract `case 'tool':` blocks.
    const caseRegex = /case\s+'([^']+)'\s*:\s*\{([\s\S]*?)(?=\n\s*case\s+'|\n\s*default\s*:)/g;
    const consumingTools = new Set<string>();

    let match: RegExpExecArray | null;
    while ((match = caseRegex.exec(indexSource)) !== null) {
      const toolName = match[1];
      const body = match[2];
      const consumes =
        body.includes('PATHS.intelligence') ||
        body.includes('PATHS.keywordIndex') ||
        body.includes('PATHS.vectorDb') ||
        body.includes('new CodebaseSearcher') ||
        body.includes('findSymbolReferences(');

      if (consumes) consumingTools.add(toolName);
    }

    const { INDEX_CONSUMING_TOOL_NAMES } = await import('../src/index.js');
    const allowlist = new Set(INDEX_CONSUMING_TOOL_NAMES as readonly string[]);

    for (const toolName of consumingTools) {
      expect(allowlist.has(toolName)).toBe(true);
    }
  });

  it('calls validateIndexArtifacts for every tool in INDEX_CONSUMING_TOOL_NAMES', async () => {
    // Mock the gate to avoid filesystem setup and focus on coverage.
    const validateIndexArtifacts = vi.fn(async () => {});
    const readIndexMeta = vi.fn(async () => ({
      metaVersion: INDEX_META_VERSION,
      formatVersion: INDEX_FORMAT_VERSION,
      buildId: 'test',
      generatedAt: new Date().toISOString(),
      toolVersion: 'test',
      artifacts: {
        keywordIndex: { path: KEYWORD_INDEX_FILENAME },
        vectorDb: { path: VECTOR_DB_DIRNAME, provider: 'lancedb' }
      }
    }));

    vi.doMock('../src/core/index-meta.js', () => ({
      readIndexMeta,
      validateIndexArtifacts
    }));

    // Re-import index.js with mocks applied
    const { server, INDEX_CONSUMING_TOOL_NAMES } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    for (const toolName of INDEX_CONSUMING_TOOL_NAMES as readonly string[]) {
      validateIndexArtifacts.mockClear();
      await handler({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments:
            toolName === 'search_codebase'
              ? { query: 'test' }
              : toolName === 'get_symbol_references'
                ? { symbol: 'alpha' }
                : toolName === 'detect_circular_dependencies'
                  ? {}
                  : toolName === 'get_team_patterns'
                    ? {}
                    : {}
        }
      });

      if (validateIndexArtifacts.mock.calls.length === 0) {
        throw new Error(`validateIndexArtifacts was not called for tool: ${toolName}`);
      }
    }
  });
});
