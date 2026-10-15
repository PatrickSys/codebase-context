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
  MANIFEST_FILENAME
} from '../src/constants/codebase-context.js';

type ToolCallRequest = {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/call';
  params: { name: string; arguments: Record<string, unknown> };
};

type ToolCallResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function getToolCallHandler(
  server: unknown
): (request: ToolCallRequest) => Promise<ToolCallResponse> {
  const handlers = (server as { _requestHandlers?: unknown })._requestHandlers;
  if (!(handlers instanceof Map)) {
    throw new Error('Expected server._requestHandlers to be a Map');
  }
  const handler = handlers.get('tools/call');
  if (typeof handler !== 'function') {
    throw new Error('Expected tools/call handler to be registered');
  }
  return handler as (request: ToolCallRequest) => Promise<ToolCallResponse>;
}

async function writeProjectSource(
  rootPath: string,
  relativePath: string,
  content: string
): Promise<string> {
  const absolutePath = path.join(rootPath, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf-8');
  return absolutePath;
}

async function writeReferenceManifest(
  rootPath: string,
  buildId: string,
  sourcePaths: string[]
): Promise<void> {
  const contextDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
  const metadataPath = path.join(contextDir, INDEX_META_FILENAME);
  const meta = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as {
    artifacts: Record<string, unknown>;
  };
  meta.artifacts.manifest = { path: MANIFEST_FILENAME };
  await fs.writeFile(metadataPath, JSON.stringify(meta, null, 2), 'utf8');
  await fs.writeFile(
    path.join(contextDir, MANIFEST_FILENAME),
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      header: { buildId, formatVersion: INDEX_FORMAT_VERSION },
      files: Object.fromEntries(sourcePaths.map((sourcePath) => [sourcePath, 'a'.repeat(16)]))
    }),
    'utf8'
  );
}

describe('get_symbol_references MCP tool', () => {
  let tempRoot: string | null = null;
  let originalArgv: string[] | null = null;
  let originalEnvRoot: string | undefined;

  beforeEach(async () => {
    vi.resetModules();

    originalArgv = [...process.argv];
    originalEnvRoot = process.env.CODEBASE_ROOT;

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-context-symbol-refs-'));
    process.env.CODEBASE_ROOT = tempRoot;
    process.argv[2] = tempRoot;
  });

  afterEach(async () => {
    if (originalArgv) {
      process.argv = originalArgv;
    }

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

  it('registers get_symbol_references in TOOLS', async () => {
    const { TOOLS } = await import('../src/index.js');
    expect(TOOLS.some((tool) => tool.name === 'get_symbol_references')).toBe(true);
  });

  it('marks a manifest-listed source integrity failure as an MCP error', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const { server } = await import('../src/index.js');
    const { CodebaseIndexer } = await import('../src/core/indexer.js');
    const sourcePath = await writeProjectSource(
      tempRoot,
      'src/a.ts',
      'export const alpha = 1;\nconsole.log(alpha);\n'
    );
    await new CodebaseIndexer({ rootPath: tempRoot }).index();
    await fs.unlink(sourcePath);
    await fs.mkdir(sourcePath);

    const response = await getToolCallHandler(server)({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_symbol_references', arguments: { symbol: 'alpha' } }
    });

    expect(response.isError).toBe(true);
    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      message: string;
    };
    expect(payload.status).toBe('error');
    expect(payload.message).toContain('src/a.ts');
  });

  it('returns usageCount and top usages from keyword index', async () => {
    if (!tempRoot) {
      throw new Error('tempRoot not initialized');
    }

    const contextDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(contextDir, { recursive: true });

    const buildId = 'test-build-symbol-refs';
    const generatedAt = new Date().toISOString();

    await fs.mkdir(path.join(contextDir, 'index'), { recursive: true });
    await fs.writeFile(
      path.join(contextDir, 'index', 'index-build.json'),
      JSON.stringify({ buildId, formatVersion: INDEX_FORMAT_VERSION }),
      'utf-8'
    );

    const sourceA = 'export function alpha() {\n  return beta(alpha);\n}\n';
    const sourceB = 'const beta = alpha + 1;\n';
    const filePathA = await writeProjectSource(tempRoot, 'src/a.ts', sourceA);
    const filePathB = await writeProjectSource(tempRoot, 'src/b.ts', sourceB);
    const chunks = [
      {
        content: sourceA,
        startLine: 10,
        relativePath: 'src/a.ts',
        filePath: filePathA
      },
      {
        content: sourceB,
        startLine: 2,
        relativePath: 'src/b.ts',
        filePath: filePathB
      }
    ];

    await fs.writeFile(
      path.join(contextDir, KEYWORD_INDEX_FILENAME),
      JSON.stringify({ header: { buildId, formatVersion: INDEX_FORMAT_VERSION }, chunks }),
      'utf-8'
    );

    await fs.writeFile(
      path.join(contextDir, INDEX_META_FILENAME),
      JSON.stringify(
        {
          metaVersion: INDEX_META_VERSION,
          formatVersion: INDEX_FORMAT_VERSION,
          buildId,
          generatedAt,
          toolVersion: 'test',
          artifacts: {
            keywordIndex: { path: KEYWORD_INDEX_FILENAME },
            vectorDb: { path: 'index', provider: 'lancedb' }
          }
        },
        null,
        2
      ),
      'utf-8'
    );
    await writeReferenceManifest(tempRoot, buildId, ['src/a.ts', 'src/b.ts']);

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_symbol_references',
        arguments: {
          symbol: 'alpha',
          limit: 2
        }
      }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.status).toBe('success');
    expect(payload.usageCount).toBeGreaterThan(0);
    expect(payload.usages.length).toBeLessThanOrEqual(2);
    expect(payload.confidence).toBe('syntactic');
    expect(typeof payload.isComplete).toBe('boolean');
    expect(payload.coverage).toMatchObject({
      candidateFiles: 2,
      sourcesRead: 2,
      filesUnavailable: 0
    });

    for (const usage of payload.usages) {
      expect(usage.file).toBeTypeOf('string');
      expect(usage.line).toBeTypeOf('number');
      expect(usage.preview).toBeTypeOf('string');
      expect(usage.preview.length).toBeGreaterThan(0);
    }
  });

  it('returns a structured full-reindex error when the reference manifest is missing', async () => {
    if (!tempRoot) {
      throw new Error('tempRoot not initialized');
    }

    const contextDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(contextDir, { recursive: true });
    const buildId = 'test-build-symbol-refs-missing-manifest';
    await fs.mkdir(path.join(contextDir, 'index'), { recursive: true });
    await fs.writeFile(
      path.join(contextDir, 'index', 'index-build.json'),
      JSON.stringify({ buildId, formatVersion: INDEX_FORMAT_VERSION }),
      'utf8'
    );
    await fs.writeFile(
      path.join(contextDir, KEYWORD_INDEX_FILENAME),
      JSON.stringify({
        header: { buildId, formatVersion: INDEX_FORMAT_VERSION },
        chunks: []
      }),
      'utf8'
    );
    await fs.writeFile(
      path.join(contextDir, INDEX_META_FILENAME),
      JSON.stringify({
        metaVersion: INDEX_META_VERSION,
        formatVersion: INDEX_FORMAT_VERSION,
        buildId,
        generatedAt: new Date().toISOString(),
        toolVersion: 'test',
        artifacts: {
          keywordIndex: { path: KEYWORD_INDEX_FILENAME },
          vectorDb: { path: 'index', provider: 'test' },
          manifest: { path: MANIFEST_FILENAME }
        }
      }),
      'utf8'
    );

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);
    const response = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_symbol_references', arguments: { symbol: 'alpha' } }
    });

    expect(response.isError).toBe(true);
    const payload = JSON.parse(response.content[0].text) as { status: string; message: string };
    expect(payload.status).toBe('error');
    expect(payload.message).toMatch(/full reindex.*codebase-context reindex without --incremental/i);
  });

  it('excludes comment and string matches when file exists and Tree-sitter is supported', async () => {
    if (!tempRoot) {
      throw new Error('tempRoot not initialized');
    }

    const contextDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.rm(contextDir, { recursive: true, force: true });
    await fs.mkdir(contextDir, { recursive: true });

    const buildId = 'test-build-symbol-refs-treesitter';
    const generatedAt = new Date().toISOString();

    await fs.mkdir(path.join(contextDir, 'index'), { recursive: true });
    await fs.writeFile(
      path.join(contextDir, 'index', 'index-build.json'),
      JSON.stringify({ buildId, formatVersion: INDEX_FORMAT_VERSION }),
      'utf-8'
    );

    const srcDir = path.join(tempRoot, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'example.ts');
    const fileContent = [
      'const alpha = 1;',
      '// alpha only in comment',
      'console.log(alpha);',
      'const s = "alpha";'
    ].join('\n');
    await fs.writeFile(filePath, fileContent, 'utf-8');

    const chunks = [
      {
        content: fileContent,
        startLine: 1,
        relativePath: 'src/example.ts',
        filePath
      }
    ];

    await fs.writeFile(
      path.join(contextDir, KEYWORD_INDEX_FILENAME),
      JSON.stringify({ header: { buildId, formatVersion: INDEX_FORMAT_VERSION }, chunks }),
      'utf-8'
    );

    await fs.writeFile(
      path.join(contextDir, INDEX_META_FILENAME),
      JSON.stringify(
        {
          metaVersion: INDEX_META_VERSION,
          formatVersion: INDEX_FORMAT_VERSION,
          buildId,
          generatedAt,
          toolVersion: 'test',
          artifacts: {
            keywordIndex: { path: KEYWORD_INDEX_FILENAME },
            vectorDb: { path: 'index', provider: 'lancedb' }
          }
        },
        null,
        2
      ),
      'utf-8'
    );
    await writeReferenceManifest(tempRoot, buildId, ['src/example.ts']);

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_symbol_references',
        arguments: {
          symbol: 'alpha',
          limit: 10
        }
      }
    });

    const payload = JSON.parse(response.content[0].text) as unknown as {
      status: string;
      usageCount: number;
      usages: Array<{ file: string; line: number }>;
    };
    expect(payload.status).toBe('success');
    expect(payload.usageCount).toBe(2);
    expect(payload.usages.length).toBe(2);
    expect(payload.usages.every((usage) => usage.file === 'src/example.ts')).toBe(true);
    const lines = payload.usages.map((usage) => usage.line).sort((a, b) => a - b);
    expect(lines).toEqual([1, 3]);
  });

  it('isComplete is true when results are less than limit', async () => {
    if (!tempRoot) {
      throw new Error('tempRoot not initialized');
    }

    const contextDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(contextDir, { recursive: true });

    const buildId = 'test-build-isComplete-true';
    const generatedAt = new Date().toISOString();

    await fs.mkdir(path.join(contextDir, 'index'), { recursive: true });
    await fs.writeFile(
      path.join(contextDir, 'index', 'index-build.json'),
      JSON.stringify({ buildId, formatVersion: INDEX_FORMAT_VERSION }),
      'utf-8'
    );

    const source = 'export function alpha() {\n  return alpha;\n}\n';
    const filePath = await writeProjectSource(tempRoot, 'src/test.ts', source);
    const chunks = [
      {
        content: source,
        startLine: 1,
        relativePath: 'src/test.ts',
        filePath
      }
    ];

    await fs.writeFile(
      path.join(contextDir, KEYWORD_INDEX_FILENAME),
      JSON.stringify({ header: { buildId, formatVersion: INDEX_FORMAT_VERSION }, chunks }),
      'utf-8'
    );

    await fs.writeFile(
      path.join(contextDir, INDEX_META_FILENAME),
      JSON.stringify(
        {
          metaVersion: INDEX_META_VERSION,
          formatVersion: INDEX_FORMAT_VERSION,
          buildId,
          generatedAt,
          toolVersion: 'test',
          artifacts: {
            keywordIndex: { path: KEYWORD_INDEX_FILENAME },
            vectorDb: { path: 'index', provider: 'lancedb' }
          }
        },
        null,
        2
      ),
      'utf-8'
    );
    await writeReferenceManifest(tempRoot, buildId, ['src/test.ts']);

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_symbol_references',
        arguments: {
          symbol: 'alpha',
          limit: 10
        }
      }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.status).toBe('success');
    expect(payload.isComplete).toBe(true);
    expect(payload.usageCount).toBeLessThan(10);
  });

  it('isComplete is false when results equal or exceed limit', async () => {
    if (!tempRoot) {
      throw new Error('tempRoot not initialized');
    }

    const contextDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);

    // Clear previous test data
    await fs.rm(contextDir, { recursive: true, force: true });
    await fs.mkdir(contextDir, { recursive: true });

    const buildId = 'test-build-isComplete-false';
    const generatedAt = new Date().toISOString();

    await fs.mkdir(path.join(contextDir, 'index'), { recursive: true });
    await fs.writeFile(
      path.join(contextDir, 'index', 'index-build.json'),
      JSON.stringify({ buildId, formatVersion: INDEX_FORMAT_VERSION }),
      'utf-8'
    );

    // Create a chunk with many matches
    const content = 'foo foo foo foo foo foo foo foo foo foo foo';
    const filePath = await writeProjectSource(tempRoot, 'src/test.ts', content);
    const chunks = [
      {
        content,
        startLine: 1,
        relativePath: 'src/test.ts',
        filePath
      }
    ];

    await fs.writeFile(
      path.join(contextDir, KEYWORD_INDEX_FILENAME),
      JSON.stringify({ header: { buildId, formatVersion: INDEX_FORMAT_VERSION }, chunks }),
      'utf-8'
    );

    await fs.writeFile(
      path.join(contextDir, INDEX_META_FILENAME),
      JSON.stringify(
        {
          metaVersion: INDEX_META_VERSION,
          formatVersion: INDEX_FORMAT_VERSION,
          buildId,
          generatedAt,
          toolVersion: 'test',
          artifacts: {
            keywordIndex: { path: KEYWORD_INDEX_FILENAME },
            vectorDb: { path: 'index', provider: 'lancedb' }
          }
        },
        null,
        2
      ),
      'utf-8'
    );
    await writeReferenceManifest(tempRoot, buildId, ['src/test.ts']);

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_symbol_references',
        arguments: {
          symbol: 'foo',
          limit: 5
        }
      }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.status).toBe('success');
    expect(payload.isComplete).toBe(false);
    expect(payload.usageCount).toBeGreaterThanOrEqual(5);
    expect(payload.usages.length).toBeLessThanOrEqual(5);
  });
});
