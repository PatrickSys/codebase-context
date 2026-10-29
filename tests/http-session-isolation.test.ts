import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from '../src/server/http.js';

const repoRoot = resolve(import.meta.dirname, '..');
const entrypoint = resolve(repoRoot, 'src', 'index.ts');

type JsonResult = {
  project?: { project?: string; active?: boolean };
  [key: string]: unknown;
};

function parseToolResult(result: { content?: Array<{ type: string; text?: string }> }): JsonResult {
  const text = result.content?.find((entry) => entry.type === 'text')?.text;
  if (!text) throw new Error('MCP tool returned no text content');
  return JSON.parse(text) as JsonResult;
}

async function waitForWatcherReindex(client: Client, project: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let sawIndexing = false;
  while (Date.now() < deadline) {
    const status = parseToolResult(
      await client.callTool({ name: 'get_indexing_status', arguments: { project } })
    );
    if (status.status === 'indexing' || status.project?.indexStatus === 'indexing') {
      sawIndexing = true;
    }
    if (sawIndexing && status.status === 'ready') return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`watcher did not trigger an indexing cycle for ${project}`);
}

async function waitForServer(child: ChildProcessWithoutNullStreams, marker: string): Promise<string> {
  let stderr = '';
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start\n${stderr}`)), 120_000);
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += String(chunk);
      if (stderr.includes(marker)) {
        clearTimeout(timer);
        resolvePromise();
      }
    });
    child.once('exit', (code) => {
      if (code !== null) {
        clearTimeout(timer);
        reject(new Error(`server exited ${code}\n${stderr}`));
      }
    });
  });
  return stderr;
}

describe('HTTP MCP session isolation', () => {
  it('keeps roots and active project selection inside each HTTP session', async () => {
    const fixtureRoot = resolve(process.env.TEMP ?? process.env.TMP ?? '.', `cbc-http-${randomUUID()}`);
    const rootA = resolve(fixtureRoot, 'root-a');
    const rootB = resolve(fixtureRoot, 'root-b');
    const port = 31900 + Math.floor(Math.random() * 500);
    const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
    const child = spawn(process.execPath, ['--import', 'tsx', entrypoint, '--http', '--port', String(port)], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEBASE_CONTEXT_CONFIG_PATH: resolve(fixtureRoot, 'missing-config.json'),
        CODEBASE_CONTEXT_HANDSHAKE_TIMEOUT_MS: '10000'
      },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    const clients: Client[] = [];
    const rootRequestCounts = new Map<string, number>();
    const rootsByClient = new Map<string, string>();

    async function connectClient(name: string, root: string): Promise<Client> {
      const client = new Client(
        { name, version: 'http-isolation-test' },
        { capabilities: { roots: { listChanged: true } } }
      );
      rootRequestCounts.set(name, 0);
      rootsByClient.set(name, root);
      client.setRequestHandler(
        (await import('@modelcontextprotocol/sdk/types.js')).ListRootsRequestSchema,
        async () => {
          rootRequestCounts.set(name, (rootRequestCounts.get(name) ?? 0) + 1);
          return { roots: [{ uri: pathToFileURL(rootsByClient.get(name)!).toString(), name }] };
        }
      );
      await client.connect(new StreamableHTTPClientTransport(endpoint));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
      clients.push(client);
      return client;
    }

    try {
      await mkdir(rootA, { recursive: true });
      await mkdir(rootB, { recursive: true });
      const rootAAfterChange = resolve(fixtureRoot, 'root-a-after-change');
      await writeFile(resolve(rootA, 'package.json'), '{"name":"http-root-a"}\n');
      await writeFile(resolve(rootB, 'package.json'), '{"name":"http-root-b"}\n');
      await mkdir(rootAAfterChange, { recursive: true });
      await writeFile(resolve(rootAAfterChange, 'package.json'), '{"name":"http-root-a-after-change"}\n');
      await waitForServer(child, `http://127.0.0.1:${port}/mcp`);

      const clientA = await connectClient('client-a', rootA);
      const clientB = await connectClient('client-b', rootB);
      const resourcesA = await clientA.listResources();
      const explicitA = parseToolResult(
        await clientA.callTool({ name: 'get_indexing_status', arguments: { project: rootA } })
      );
      const explicitB = parseToolResult(
        await clientB.callTool({ name: 'get_indexing_status', arguments: { project: rootB } })
      );
      const implicitAAfterB = parseToolResult(
        await clientA.callTool({ name: 'get_indexing_status', arguments: {} })
      );

      rootsByClient.set('client-a', rootAAfterChange);
      await clientA.notification({ method: 'notifications/roots/list_changed' });
      let explicitAAfterRootChange = parseToolResult(
        await clientA.callTool({ name: 'get_indexing_status', arguments: { project: rootAAfterChange } })
      );
      for (let attempt = 0; attempt < 20 && explicitAAfterRootChange.project?.project !== rootAAfterChange; attempt += 1) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        explicitAAfterRootChange = parseToolResult(
          await clientA.callTool({ name: 'get_indexing_status', arguments: { project: rootAAfterChange } })
        );
      }
      const resourcesAAfterRootChange = await clientA.listResources();
      await clientA.close();
      const implicitBAfterAClosed = parseToolResult(
        await clientB.callTool({ name: 'get_indexing_status', arguments: {} })
      );

      // A client that only POSTs (without the optional standalone GET/SSE
      // stream) cannot advertise roots to the server. It must select a project
      // explicitly instead of receiving a misleading implicit-project result.
      const postOnlyHeaders = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      };
      const postOnlyInit = await fetch(endpoint, {
        method: 'POST',
        headers: postOnlyHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'post-only-test', version: '1.0.0' }
          }
        })
      });
      const postOnlySession = postOnlyInit.headers.get('mcp-session-id');
      expect(postOnlySession).toBeTruthy();
      await postOnlyInit.body?.cancel();
      const postOnlySessionHeaders = {
        'content-type': 'application/json',
        accept: 'application/json',
        'mcp-session-id': postOnlySession!
      };
      await fetch(endpoint, {
        method: 'POST',
        headers: postOnlySessionHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
      });
      const postOnlyCall = await fetch(endpoint, {
        method: 'POST',
        headers: { ...postOnlySessionHeaders, accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'get_indexing_status', arguments: {} }
        })
      });
      const postOnlyBody = await postOnlyCall.text();
      const postOnlyData = postOnlyBody
        .split(/\r?\n/)
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length);
      const postOnlyPayload = (postOnlyData ? JSON.parse(postOnlyData) : {}) as {
        result?: { content?: Array<{ text?: string }> };
      };
      const postOnlyText = postOnlyPayload.result?.content?.find((entry) => entry.text)?.text;
      expect(postOnlyText).toContain('selection_required');
      await fetch(endpoint, { method: 'DELETE', headers: postOnlySessionHeaders });

      expect(rootRequestCounts.get('client-a')).toBeGreaterThan(0);
      expect(rootRequestCounts.get('client-b')).toBeGreaterThan(0);
      expect(resourcesA.resources.some((resource) => resource.uri.includes(encodeURIComponent(rootA)))).toBe(
        true
      );
      expect(explicitA.project?.project).toBe(rootA);
      expect(explicitB.project?.project).toBe(rootB);
      expect(implicitAAfterB.project?.project).toBe(rootA);
      expect(rootRequestCounts.get('client-a')).toBeGreaterThan(1);
      expect(explicitAAfterRootChange.project?.project).toBe(rootAAfterChange);
      expect(
        resourcesAAfterRootChange.resources.some((resource) =>
          resource.uri.includes(encodeURIComponent(rootAAfterChange))
        )
      ).toBe(true);
      expect(implicitBAfterAClosed.project?.project).toBe(rootB);
    } finally {
      await Promise.allSettled(clients.map((client) => client.close()));
      child.kill();
      if (!child.killed || child.exitCode === null) {
        await new Promise<void>((resolvePromise) => {
          const timer = setTimeout(resolvePromise, 2_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolvePromise();
          });
        });
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          await rm(fixtureRoot, { recursive: true, force: true });
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 7) throw error;
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        }
      }
    }
  }, 180_000);

  it('protects shared watchers from another session eviction and DELETE', async () => {
    const fixtureRoot = resolve(process.env.TEMP ?? process.env.TMP ?? '.', `cbc-watcher-${randomUUID()}`);
    const parentRoot = resolve(fixtureRoot, 'workspace');
    const sharedRoot = resolve(parentRoot, 'shared');
    const projects = Array.from({ length: 6 }, (_, index) => resolve(parentRoot, `project-${index + 1}`));
    const port = 31900 + Math.floor(Math.random() * 500);
    const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
    const child = spawn(process.execPath, ['--import', 'tsx', entrypoint, '--http', '--port', String(port)], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEBASE_CONTEXT_CONFIG_PATH: resolve(fixtureRoot, 'missing-config.json'),
        CODEBASE_CONTEXT_DEBOUNCE_MS: '50'
      },
        stdio: ['ignore', 'ignore', 'pipe']
      });
    const clients: Client[] = [];

    async function connectClient(root: string, name: string): Promise<Client> {
      const client = new Client(
        { name, version: 'watcher-ownership-test' },
        { capabilities: { roots: { listChanged: true } } }
      );
      client.setRequestHandler(
        (await import('@modelcontextprotocol/sdk/types.js')).ListRootsRequestSchema,
        async () => ({ roots: [{ uri: pathToFileURL(root).toString(), name }] })
      );
      await client.connect(new StreamableHTTPClientTransport(endpoint));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      clients.push(client);
      return client;
    }

    try {
      await mkdir(resolve(sharedRoot, 'src'), { recursive: true });
      await writeFile(resolve(sharedRoot, 'package.json'), '{"name":"shared"}\n');
      await writeFile(resolve(sharedRoot, 'src', 'change.ts'), 'export const shared = 1;\n');
      for (const [index, project] of projects.entries()) {
        await mkdir(project, { recursive: true });
        await writeFile(resolve(project, 'package.json'), `{"name":"project-${index + 1}"}\n`);
      }
      await waitForServer(child, `http://127.0.0.1:${port}/mcp`);

      const clientA = await connectClient(parentRoot, 'client-a');
      const clientB = await connectClient(sharedRoot, 'client-b');

      // Session B claims the shared watcher first. Session A then exceeds the
      // five-project process cap with six distinct projects.
      await clientB.callTool({ name: 'get_indexing_status', arguments: { project: sharedRoot } });
      for (const project of projects) {
        await clientA.callTool({ name: 'get_indexing_status', arguments: { project } });
      }

      await waitForWatcherReindex(clientB, sharedRoot);
      await appendFile(resolve(sharedRoot, 'src', 'change.ts'), 'export const afterEviction = 2;\n');
      await waitForWatcherReindex(clientB, sharedRoot);

      // A co-owns the shared watcher, then DELETE releases only A's claim.
      await clientA.callTool({ name: 'get_indexing_status', arguments: { project: sharedRoot } });
      await clientA.close();
      await appendFile(resolve(sharedRoot, 'src', 'change.ts'), 'export const afterDelete = 3;\n');
      await waitForWatcherReindex(clientB, sharedRoot);
    } finally {
      await Promise.allSettled(clients.map((client) => client.close()));
      child.kill();
      if (!child.killed || child.exitCode === null) {
        await new Promise<void>((resolvePromise) => {
          const timer = setTimeout(resolvePromise, 2_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolvePromise();
          });
        });
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          await rm(fixtureRoot, { recursive: true, force: true });
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 7) throw error;
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        }
      }
    }
  }, 180_000);

  it('rejects non-loopback HTTP binds', async () => {
    await expect(
      startHttpServer({
        name: 'test',
        version: 'test',
        host: '0.0.0.0',
        port: 31999,
        registerHandlers: () => undefined
      })
    ).rejects.toThrow(/loopback-only/);
  });

  it('serves health checks on the IPv6 loopback host', async () => {
    const port = 31900 + Math.floor(Math.random() * 500);
    const handle = await startHttpServer({
      name: 'test',
      version: 'test',
      host: '::1',
      port,
      registerHandlers: () => undefined
    });

    try {
      const response = await fetch(`http://[::1]:${port}/`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
    } finally {
      await handle.close();
    }
  });
});
