import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { IndexSignalSchema } from '../src/core/index-signal.js';
import { afterEach, expect, it } from 'vitest';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { resolveIndexArtifact } from '../src/core/index-generation.js';
import { makePaths } from '../src/project-state.js';
import { handle as searchTool } from '../src/tools/search-codebase.js';
import type { ToolContext } from '../src/tools/types.js';

let root = '';
const clients: Array<{ client: Client; transport: StdioClientTransport }> = [];
const children: ChildProcess[] = [];
const nativeSessions = new Map<Client, { root: string; stderr: () => string }>();
afterEach(async () => {
  for (const item of clients.splice(0)) {
    await item.client.close().catch(() => {});
    await item.transport.close().catch(() => {});
  }
  nativeSessions.clear();
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await exited;
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = '';
});
async function fixture() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-late-recovery-'));
  await fs.writeFile(path.join(root, 'route.ts'), 'export function route() { return "original"; }');
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
}
async function corruptLocation() {
  const indexPath = await resolveIndexArtifact(root, 'index.json');
  const value = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  value.chunks[0].filePath = path.join(root, '..', 'foreign.ts');
  await fs.writeFile(indexPath, JSON.stringify(value));
}
const NativePayloadSchema = z
  .object({
    status: z.string(),
    index: IndexSignalSchema.optional(),
    project: z.object({ indexStatus: z.string() }).passthrough(),
    error: z.string().optional(),
    message: z.string().optional()
  })
  .passthrough();
function decode(response: unknown): z.infer<typeof NativePayloadSchema> {
  const envelope = z
    .object({
      content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
    })
    .parse(response);
  const item = envelope.content.find((item) => item.type === 'text');
  if (!item?.text) throw Error('Expected JSON text');
  return NativePayloadSchema.parse(JSON.parse(item.text));
}

async function server() {
  const home = path.join(root, 'profile');
  await fs.mkdir(home);
  const config = path.join(home, 'server.json');
  await fs.writeFile(config, '{}');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--import',
      import.meta.resolve('tsx'),
      fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      root
    ],
    cwd: root,
    env: {
      ...process.env,
      CODEBASE_CONTEXT_CONFIG_PATH: config,
      HOME: home,
      USERPROFILE: home,
      HF_HOME: path.join(home, 'models')
    },
    stderr: 'pipe'
  });
  let stderr = '';
  transport.stderr?.on('data', (data) => {
    stderr += data.toString();
  });
  const client = new Client({ name: 'late-index-state-regression', version: '1.0.0' });
  nativeSessions.set(client, { root, stderr: () => stderr });
  clients.push({ client, transport });
  try {
    await client.connect(transport);
  } catch (error) {
    throw new Error(`SDK connection failed: ${stderr}`, { cause: error });
  }
  return { client, stderr: () => stderr };
}
async function captureEnvelope<T>(client: Client, phase: string, response: T): Promise<T> {
  const session = nativeSessions.get(client);
  const envelope = {
    phase,
    time: new Date().toISOString(),
    root: session?.root,
    response,
    serverStderr: session?.stderr()
  };
  const diagnosticPath = process.env.CBC_TEST_SDK_DIAGNOSTICS;
  if (diagnosticPath) await fs.appendFile(diagnosticPath, JSON.stringify(envelope) + '\n');
  return response;
}
async function status(client: Client, expected: string, phase = 'status') {
  const deadline = Date.now() + 20000;
  for (;;) {
    const response = await captureEnvelope(
      client,
      phase,
      await client.callTool({ name: 'get_indexing_status', arguments: {} })
    );
    let result: ReturnType<typeof decode>;
    try {
      result = decode(response);
    } catch (error) {
      const session = nativeSessions.get(client);
      throw new Error(
        `Native status decoding failed before ${expected}: ${JSON.stringify({ phase, response, serverStderr: session?.stderr() })}`,
        { cause: error }
      );
    }
    if (result.status === expected) return result;
    if (Date.now() >= deadline) throw Error(`Did not reach ${expected}: ${JSON.stringify(result)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
async function holdWriter() {
  const child = fork(
    fileURLToPath(new URL('./helpers/index-writer-child.ts', import.meta.url)),
    [root, 'hold', 'full'],
    { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
  );
  children.push(child);
  let stderr = '';
  child.stderr?.on('data', (data) => {
    stderr += data.toString();
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Writer did not stage: ${stderr}`)), 20000);
    child.on('message', (message) => {
      if (typeof message === 'object' && message !== null && 'type' in message) {
        if (message.type === 'staged') {
          clearTimeout(timer);
          resolve();
        } else if (message.type === 'failed') {
          clearTimeout(timer);
          reject(Error(JSON.stringify(message)));
        }
      }
    });
    child.once('error', reject);
  });
  return child;
}
it('uses actual late-corruption state through the SDK and does not duplicate an already-running rebuild', async () => {
  await fixture();
  const s = await server();
  await status(s.client, 'ready', 'initial ready');
  await corruptLocation();
  const held = await holdWriter();
  const query = () =>
    s.client.callTool(
      { name: 'search_codebase', arguments: { query: 'route', limit: 5 } },
      undefined,
      { timeout: 20000 }
    );
  const first = decode(await captureEnvelope(s.client, 'first corrupt search', await query()));
  expect(first.status).toBe('indexing');
  expect(first.index).toMatchObject({
    status: 'indexing',
    confidence: 'low',
    action: 'rebuild-started'
  });
  expect(first.project.indexStatus).toBe('indexing');
  const starts = s.stderr().match(/Indexing \(full\)/g)?.length ?? 0;
  const second = decode(
    await captureEnvelope(s.client, 'second search while held writer', await query())
  );
  expect(second.status).toBe('indexing');
  expect(second.index?.status).toBe('indexing');
  expect(second.project.indexStatus).toBe('indexing');
  expect(s.stderr().match(/Indexing \(full\)/g)?.length ?? 0).toBe(starts);
  const exited = new Promise<void>((resolve) => held.once('exit', () => resolve()));
  held.kill('SIGKILL');
  await exited;
  await status(s.client, 'ready', 'after killed held writer');
  const healthy = decode(
    await captureEnvelope(s.client, 'healthy search after recovery', await query())
  );
  expect(healthy.status).toBe('success');
  expect(healthy.index).toMatchObject({ status: 'ready', action: 'served' });
  expect(healthy.project.indexStatus).toBe('ready');
}, 30000);
it('auto-heals a forged stored body through the real SDK without exposing its header', async () => {
  await fixture();
  const s = await server();
  await status(s.client, 'ready');
  const file = await resolveIndexArtifact(root, 'index.json');
  const value = z
    .object({ chunks: z.array(z.object({ content: z.string() }).passthrough()) })
    .passthrough()
    .parse(JSON.parse(await fs.readFile(file, 'utf8')));
  for (const chunk of value.chunks)
    chunk.content = '// FORGED_HEADER_MUST_NOT_ESCAPE\n' + chunk.content;
  await fs.writeFile(file, JSON.stringify(value));
  const query = () =>
    s.client.callTool(
      { name: 'search_codebase', arguments: { query: 'route', limit: 5 } },
      undefined,
      { timeout: 20000 }
    );
  const first = await query();
  expect(JSON.stringify(first)).not.toContain('FORGED_HEADER_MUST_NOT_ESCAPE');
  expect(decode(first).index?.action).not.toBe('served');
  await status(s.client, 'ready');
  const healthy = await query();
  expect(decode(healthy).status).toBe('success');
  expect(decode(healthy).index).toMatchObject({ status: 'ready', action: 'served' });
  expect(JSON.stringify(healthy)).not.toContain('FORGED_HEADER_MUST_NOT_ESCAPE');
}, 30000);
it('reports failed capacity recovery through the real SDK without changing the old pointer/vector marker', async () => {
  await fixture();
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
  const directory = path.join(root, '.codebase-context', '.generations');
  const pointer = path.join(root, '.codebase-context', 'index-meta.json');
  const meta = JSON.parse(await fs.readFile(pointer, 'utf8'));
  const pins = path.join(root, '.codebase-context', '.pins');
  await fs.mkdir(pins, { recursive: true });
  for (const id of (await fs.readdir(directory)).filter((id) => id !== meta.buildId))
    await fs.writeFile(
      path.join(pins, `${id}.json`),
      JSON.stringify({ pid: process.pid, buildId: id })
    );
  const s = await server();
  await status(s.client, 'ready');
  await corruptLocation();
  const before = await fs.readFile(pointer);
  const marker = path.join(directory, meta.buildId, 'index', 'index-build.json');
  const markerBytes = await fs.readFile(marker);
  const response = decode(
    await s.client.callTool(
      { name: 'search_codebase', arguments: { query: 'route', limit: 5 } },
      undefined,
      { timeout: 20000 }
    )
  );
  expect(response.index?.status).toBe(response.status);
  expect(response.index?.confidence).toBe('low');
  expect(response.index?.action).not.toBe('served');
  const failed = await status(s.client, 'error');
  expect(failed.project.indexStatus).toBe('error');
  expect(failed.error ?? failed.message).toMatch(/capacity|deferred/i);
  expect(await fs.readFile(pointer)).toEqual(before);
  expect(await fs.readFile(marker)).toEqual(markerBytes);
}, 30000);
it('keeps healthy artifact status and stale-source abstention distinct through a cold SDK session', async () => {
  await fixture();
  await fs.writeFile(
    path.join(root, 'route.ts'),
    'export function renamed() { return "changed before startup"; }'
  );
  const pointer = path.join(root, '.codebase-context', 'index-meta.json');
  const before = await fs.readFile(pointer);
  const s = await server();
  await status(s.client, 'ready');
  const result = decode(
    await s.client.callTool(
      { name: 'search_codebase', arguments: { query: 'route', limit: 5 } },
      undefined,
      { timeout: 20000 }
    )
  );
  expect(result.status).toBe('no_fresh_results');
  expect(result.index).toMatchObject({ status: 'ready', action: 'served' });
  expect(result.project.indexStatus).toBe('ready');
  expect(await fs.readFile(pointer)).toEqual(before);
}, 30000);
it.each(['throw', 'reject'] as const)(
  'reports an immediately %s launch without claiming indexing or ready',
  async (kind) => {
    await fixture();
    await corruptLocation();
    const ctx: ToolContext = {
      rootPath: root,
      paths: makePaths(root),
      indexState: { status: 'ready' },
      performIndexing: () => {
        if (kind === 'throw') throw Error('launch denied');
        return Promise.reject(Error('launch denied'));
      }
    };
    const result = await searchTool({ query: 'route' }, ctx);
    const text = result.content?.[0]?.text;
    if (!text) throw Error('Expected response');
    const value = JSON.parse(text);
    expect(value.status).toBe('error');
    expect(value.index).toMatchObject({
      status: 'error',
      confidence: 'low',
      action: 'rebuild-failed'
    });
    expect(ctx.indexState.status).toBe('error');
    expect(result.isError).toBe(true);
  }
);
