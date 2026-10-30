import { fork } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { readIndexMeta, validateIndexArtifacts } from '../src/core/index-meta.js';
import { handle as searchTool } from '../src/tools/search-codebase.js';
import { makePaths, getOrCreateProject, clearProjects } from '../src/project-state.js';

const roots: string[] = [];
afterEach(async () => {
  await clearProjects();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-publication-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'route.ts'), 'export function route() { return "old"; }');
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
  return root;
}

async function interrupt(root: string, mode: string, edge: string) {
  const child = fork(
    fileURLToPath(new URL('./helpers/index-publication-child.ts', import.meta.url)),
    [root, mode, edge],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    }
  );
  let stderr = '';
  child.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  child.stdout?.resume();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      // End on an observed edge/exit or after twenty seconds; finally kills this child.
      watchdog = setTimeout(
        () => reject(new Error(`Child did not reach ${edge}: ${stderr}`)),
        20_000
      );
      child.once('error', reject);
      child.once('exit', (code) =>
        reject(new Error(`Child exited before edge (${code}): ${stderr}`))
      );
      child.on('message', (message) => {
        if (typeof message === 'object' && message !== null && 'edge' in message) resolve();
        else reject(new Error(`Child did not reach edge: ${JSON.stringify(message)}`));
      });
    });
  } finally {
    clearTimeout(watchdog);
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    if (child.exitCode === null && child.signalCode === null) await exited;
  }
}

describe('interrupted index publication', () => {
  it('serves the committed index through the direct MCP tool during refresh', async () => {
    const root = await fixture();
    const response = await searchTool(
      { query: 'route' },
      {
        rootPath: root,
        paths: makePaths(root),
        indexState: { status: 'indexing' },
        performIndexing: () => undefined
      }
    );
    const payload: { status: string; results?: unknown[] } = JSON.parse(
      response.content?.[0]?.text ?? '{}'
    );
    expect(payload.status).toBe('success');
    expect(payload.results?.length).toBeGreaterThan(0);
  });

  it('serves the committed index through the native MCP gate during refresh', async () => {
    const root = await fixture();
    const oldRoot = process.env.CODEBASE_ROOT;
    const oldArgv = process.argv;
    process.env.CODEBASE_ROOT = root;
    process.argv = [process.execPath, 'publication-test'];
    try {
      const { server } = await import('../src/index.js');
      const project = getOrCreateProject(root);
      project.initPromise = Promise.resolve();
      project.indexState.status = 'indexing';
      // Invoke the real SDK-registered MCP handler, with the real search/index code.
      const handler = Reflect.get(server, '_requestHandlers').get('tools/call');
      const response = await handler({
        method: 'tools/call',
        params: { name: 'search_codebase', arguments: { query: 'route', project: root } }
      });
      const payload: { status: string; results?: unknown[] } = JSON.parse(response.content[0].text);
      expect(payload.status).toBe('success');
      expect(payload.results?.length).toBeGreaterThan(0);
    } finally {
      process.argv = oldArgv;
      if (oldRoot === undefined) delete process.env.CODEBASE_ROOT;
      else process.env.CODEBASE_ROOT = oldRoot;
    }
  });

  it.each([
    ['full', 'published-meta'],
    ['incremental', 'vector-marker']
  ])(
    'keeps a complete committed index after killed %s at %s',
    async (mode, edge) => {
      const root = await fixture();
      await fs.writeFile(path.join(root, 'route.ts'), 'export function route() { return "new"; }');
      await interrupt(root, mode, edge);
      const meta = await readIndexMeta(root);
      await expect(validateIndexArtifacts(root, meta)).resolves.toBeUndefined();
    },
    30_000
  );
});
