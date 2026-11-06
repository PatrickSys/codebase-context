import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProjectConfig, loadServerConfig } from '../src/server/config.js';

// Helper: write a temp config file and set CODEBASE_CONTEXT_CONFIG_PATH
async function withTempConfig(content: string, fn: (filePath: string) => Promise<void>) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccc-config-test-'));
  const filePath = path.join(tmpDir, 'config.json');
  await fs.writeFile(filePath, content, 'utf8');
  try {
    await fn(filePath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe('loadServerConfig', () => {
  afterEach(() => {
    delete process.env.CODEBASE_CONTEXT_CONFIG_PATH;
    vi.restoreAllMocks();
  });

  it('returns null silently when config file does not exist (ENOENT)', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    process.env.CODEBASE_CONTEXT_CONFIG_PATH = '/tmp/nonexistent-ccc-config-99999.json';
    const result = await loadServerConfig();
    expect(result).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null and logs to stderr on malformed JSON', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    await withTempConfig('{ invalid json }', async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[config\] Failed to load config:/);
    });
  });

  it('returns null when top-level value is an array', async () => {
    await withTempConfig('[]', async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).toBeNull();
    });
  });

  it('returns null when top-level value is a string', async () => {
    await withTempConfig('"just a string"', async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).toBeNull();
    });
  });

  it('resolves ~/my-repo to an absolute path using os.homedir()', async () => {
    const config = JSON.stringify({
      projects: [{ root: '~/my-repo' }]
    });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).not.toBeNull();
      expect(result!.projects).toHaveLength(1);
      const resolved = result!.projects![0].root;
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved).toBe(path.join(os.homedir(), 'my-repo'));
    });
  });

  it('resolves a relative path via path.resolve()', async () => {
    const config = JSON.stringify({
      projects: [{ root: 'relative/path' }]
    });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).not.toBeNull();
      const resolved = result!.projects![0].root;
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved).toBe(path.resolve('relative/path'));
    });
  });

  it('skips project entries with missing or empty roots instead of resolving cwd', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({
      projects: [{}, { root: '   ' }, { root: 'valid-root' }]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();

      expect(result).not.toBeNull();
      expect(result!.projects).toEqual([{ root: path.resolve('valid-root') }]);
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy.mock.calls[0][0]).toMatch(
        /\[config\] Skipping project entry with missing or empty root/
      );
      expect(errorSpy.mock.calls[1][0]).toMatch(
        /\[config\] Skipping project entry with missing or empty root/
      );
    });
  });

  it('returns valid config for well-formed input with projects and server.port', async () => {
    // Use absolute paths that are valid on all platforms
    const projA = path.join(os.tmpdir(), 'ccc-test-proj-a');
    const projB = path.join(os.tmpdir(), 'ccc-test-proj-b');
    const config = JSON.stringify({
      projects: [{ root: projA, excludePatterns: ['**/dist/**'] }, { root: projB }],
      server: { port: 5199, host: '0.0.0.0' }
    });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).not.toBeNull();
      expect(result!.projects).toHaveLength(2);
      expect(result!.projects![0].root).toBe(path.resolve(projA));
      expect(result!.projects![0].excludePatterns).toEqual(['**/dist/**']);
      expect(result!.projects![1].root).toBe(path.resolve(projB));
      expect(result!.server?.port).toBe(5199);
      expect(result!.server?.host).toBe('0.0.0.0');
    });
  });

  it('parses analyzer hints with trimmed analyzer name and non-empty extensions', async () => {
    const config = JSON.stringify({
      projects: [
        {
          root: '~/hinted-repo',
          analyzerHints: {
            analyzer: '  generic  ',
            extensions: ['sfc', ' .astro ', '', 42, null]
          }
        }
      ]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();

      expect(result).not.toBeNull();
      expect(result!.projects).toHaveLength(1);
      expect(result!.projects![0].analyzerHints).toEqual({
        analyzer: 'generic',
        extensions: ['sfc', '.astro']
      });
    });
  });

  it('parses a positive per-project maxChunks value', async () => {
    const config = JSON.stringify({
      projects: [{ root: '~/large-repo', parsing: { maxChunks: 25000 } }]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();

      expect(result?.projects?.[0].parsing).toEqual({ maxChunks: 25000 });
    });
  });

  it('preserves explicit per-project embedding mode, including false opt-in', async () => {
    const config = JSON.stringify({
      projects: [
        { root: '~/model-free', skipEmbedding: true },
        { root: '~/semantic', skipEmbedding: false },
        { root: '~/invalid', skipEmbedding: 'false' }
      ]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result?.projects?.map((project) => project.skipEmbedding)).toEqual([
        true,
        false,
        undefined
      ]);
    });
  });

  it('loads parsing configuration for the requested CLI project root', async () => {
    const projectRoot = path.join(os.tmpdir(), 'ccc-large-cli-project');
    const config = JSON.stringify({
      projects: [
        { root: path.join(os.tmpdir(), 'ccc-other-project') },
        { root: projectRoot, parsing: { maxChunks: 25000 } }
      ]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const projectConfig = await loadProjectConfig(projectRoot);

      expect(projectConfig).toEqual({
        root: projectRoot,
        parsing: { maxChunks: 25000 }
      });
    });
  });

  it('ignores an invalid per-project maxChunks value', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({
      projects: [{ root: '~/large-repo', parsing: { maxChunks: 0 } }]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();

      expect(result?.projects?.[0].parsing).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        '[config] Ignoring invalid project parsing.maxChunks: 0'
      );
    });
  });

  it('drops empty analyzerHints objects after parsing', async () => {
    const config = JSON.stringify({
      projects: [
        {
          root: '~/hinted-repo',
          analyzerHints: {
            analyzer: '   ',
            extensions: ['', '   ']
          }
        }
      ]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();

      expect(result).not.toBeNull();
      expect(result!.projects).toHaveLength(1);
      expect(result!.projects![0].analyzerHints).toBeUndefined();
    });
  });

  it('drops server.port with a warning when value is 0', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({ server: { port: 0 } });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).not.toBeNull();
      expect(result!.server?.port).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[config\] Ignoring invalid server\.port: 0/);
    });
  });

  it('drops server.port with a warning when value is negative', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({ server: { port: -1 } });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result!.server?.port).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[config\] Ignoring invalid server\.port: -1/);
    });
  });

  it('drops server.port with a warning when value is a non-numeric string', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({ server: { port: 'abc' } });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result!.server?.port).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[config\] Ignoring invalid server\.port: abc/);
    });
  });

  it('drops server.port with a warning when value exceeds 65535', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({ server: { port: 65536 } });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result!.server?.port).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[config\] Ignoring invalid server\.port: 65536/);
    });
  });

  it('respects CODEBASE_CONTEXT_CONFIG_PATH env var', async () => {
    const config = JSON.stringify({ server: { port: 4242 } });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).not.toBeNull();
      expect(result!.server?.port).toBe(4242);
    });
  });
});

// Body limits belong to the transport options, not persisted server configuration.
import http, { type Server as NodeHttpServer } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  startHttpServer,
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  type HttpServerHandle
} from '../src/server/http.js';

async function withHttpFixture(
  run: (fixture: {
    port: number;
    created: McpServer[];
    dispatched: ReturnType<typeof vi.fn>;
    closed: ReturnType<typeof vi.fn>;
  }) => Promise<void>,
  maxRequestBodySize = 512,
  configureServer?: (server: McpServer) => void
) {
  let listener: NodeHttpServer | undefined;
  const create = http.createServer;
  const capture = vi
    .spyOn(http, 'createServer')
    .mockImplementation((...args: Parameters<typeof create>) => {
      listener = create(...args);
      return listener;
    });
  syncBuiltinESMExports();
  const created: McpServer[] = [];
  const dispatched = vi.fn();
  const closed = vi.fn();
  let handle: HttpServerHandle | undefined;
  try {
    handle = await startHttpServer({
      name: 'body-limit-test',
      version: '1',
      port: 0,
      maxRequestBodySize,
      registerHandlers(server) {
        created.push(server);
        server.onclose = closed;
        server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
        server.setRequestHandler(CallToolRequestSchema, async () => {
          dispatched();
          return { content: [{ type: 'text', text: 'ok' }] };
        });
        configureServer?.(server);
      }
    });
    const address = listener!.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address');
    await run({ port: address.port, created, dispatched, closed });
  } finally {
    await handle?.close();
    capture.mockRestore();
    syncBuiltinESMExports();
  }
}

function httpFixtureRequest(port: number, body?: string, session?: string, chunked = false) {
  return new Promise<{ status: number; body: string; session?: string }>((resolve, reject) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-03-26'
    };
    if (session) headers['mcp-session-id'] = session;
    if (body !== undefined && !chunked) headers['content-length'] = String(Buffer.byteLength(body));
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: body === undefined ? '/' : '/mcp',
        method: body === undefined ? 'GET' : 'POST',
        headers,
        agent: false
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode!,
            body: text,
            session: response.headers['mcp-session-id'] as string | undefined
          })
        );
      }
    );
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('HTTP fixture timeout')));
    if (chunked && body !== undefined) {
      request.write(body.slice(0, 256));
      request.end(body.slice(256));
    } else request.end(body);
  });
}

const initializeBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'fixture', version: '1' }
  }
});

describe('HTTP request body limit', () => {
  it('keeps the compatible 4 MiB default explicit', () => {
    expect(DEFAULT_MAX_REQUEST_BODY_SIZE).toBe(4 * 1024 * 1024);
  });

  it.each([0, -1, Infinity, NaN, 1.5])(
    'rejects an invalid byte ceiling %s before listening',
    async (limit) => {
      await expect(
        startHttpServer({
          name: 'test',
          version: '1',
          registerHandlers() {},
          maxRequestBodySize: limit
        })
      ).rejects.toThrow(RangeError);
    }
  );

  it.each([false, true])(
    'rejects oversized initialization (chunked=%s) and closes server/transport',
    async (chunked) => {
      await withHttpFixture(async ({ port, created, dispatched, closed }) => {
        const response = await httpFixtureRequest(
          port,
          initializeBody + ' '.repeat(512),
          undefined,
          chunked
        );
        expect(response.status).toBe(413);
        expect(JSON.parse(response.body)).toMatchObject({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: expect.stringContaining('512 bytes') }
        });
        const health = await httpFixtureRequest(port);
        expect(JSON.parse(health.body).sessions).toBe(0);
        expect(created).toHaveLength(1);
        expect(created[0].transport).toBeUndefined();
        expect(closed).toHaveBeenCalledOnce();
        expect(dispatched).not.toHaveBeenCalled();
      });
    }
  );

  it.each([511, 512, 513])('enforces the byte boundary at %i bytes', async (size) => {
    await withHttpFixture(async ({ port, created }) => {
      const response = await httpFixtureRequest(port, initializeBody.padEnd(size, ' '));
      expect(response.status).toBe(size <= 512 ? 200 : 413);
      if (size > 512) expect(created[0].transport).toBeUndefined();
    });
  });

  it.each(['connect', 'handleRequest'])(
    'closes orphaned initialization when %s throws',
    async (stage) => {
      await withHttpFixture(
        async ({ port, created, closed }) => {
          const response = await httpFixtureRequest(port, initializeBody);
          expect(response.status).toBe(500);
          expect(JSON.parse((await httpFixtureRequest(port)).body).sessions).toBe(0);
          expect(created[0].transport).toBeUndefined();
          expect(closed).toHaveBeenCalledOnce();
        },
        512,
        (server) => {
          const connect = server.connect.bind(server);
          vi.spyOn(server, 'connect').mockImplementation(async (transport) => {
            await connect(transport);
            if (stage === 'connect') throw new Error('Synthetic connect failure');
            vi.spyOn(transport as StreamableHTTPServerTransport, 'handleRequest').mockRejectedValue(
              new Error('Synthetic handler failure')
            );
          });
        }
      );
    }
  );

  it('closes malformed initialization and accepts subsequent ordinary initialization/tools requests', async () => {
    await withHttpFixture(async ({ port, created, closed, dispatched }) => {
      const invalid = await httpFixtureRequest(port, '{invalid');
      expect(invalid.status).toBe(400);
      expect(JSON.parse(invalid.body).error.code).toBe(-32700);
      expect(created[0].transport).toBeUndefined();
      expect(closed).toHaveBeenCalledOnce();
      const initialized = await httpFixtureRequest(port, initializeBody);
      expect(initialized.status).toBe(200);
      expect(initialized.session).toBeTruthy();
      const listed = await httpFixtureRequest(
        port,
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
        initialized.session
      );
      expect(listed.status).toBe(200);
      expect(listed.body).toContain('"tools":[]');
      const called = await httpFixtureRequest(
        port,
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'fixture', arguments: {} }
        }),
        initialized.session
      );
      expect(called.status).toBe(200);
      expect(dispatched).toHaveBeenCalledOnce();
      expect(JSON.parse((await httpFixtureRequest(port)).body).sessions).toBe(1);
    });
  });

  it.each([false, true])(
    'does not dispatch oversized calls on a live session (chunked=%s)',
    async (chunked) => {
      await withHttpFixture(async ({ port, dispatched }) => {
        const initialized = await httpFixtureRequest(port, initializeBody);
        const response = await httpFixtureRequest(
          port,
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'fixture', arguments: { text: 'safe'.repeat(256) } }
          }),
          initialized.session,
          chunked
        );
        expect(response.status).toBe(413);
        expect(dispatched).not.toHaveBeenCalled();
        expect(JSON.parse((await httpFixtureRequest(port)).body).sessions).toBe(1);
      });
    }
  );
});
