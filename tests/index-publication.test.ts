import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodebaseIndexer } from '../src/core/indexer.js';
import {
  readIndexMeta,
  readIndexMetaFromFile,
  validateIndexArtifacts
} from '../src/core/index-meta.js';
import { handle as searchTool } from '../src/tools/search-codebase.js';
import { makePaths, getOrCreateProject, clearProjects } from '../src/project-state.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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

/** Content hash of every file below a directory, keyed by relative path. */
async function digestTree(directory: string): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  const visit = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else
        digests[path.relative(directory, target)] = createHash('sha256')
          .update(await fs.readFile(target))
          .digest('hex');
    }
  };
  await visit(directory);
  return digests;
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

  it.skipIf(process.platform !== 'win32')(
    'keeps the committed pointer and generation when a ticket stays unreadable on Windows',
    async () => {
      const root = await fixture();
      const pointer = path.join(root, '.codebase-context', 'index-meta.json');
      const generations = path.join(root, '.codebase-context', '.generations');
      const before = {
        pointer: await fs.readFile(pointer, 'utf8'),
        generations: await fs.readdir(generations)
      };
      await fs.writeFile(path.join(root, 'route.ts'), 'export function route() { return "new"; }');
      const read = fs.readFile.bind(fs);
      const tickets = /[\\/]\.(writers|publication)[\\/][^\\/]+\.json$/;
      let denials = 0;
      vi.spyOn(fs, 'readFile').mockImplementation((file, options) => {
        if (tickets.test(String(file))) {
          denials++;
          return Promise.reject(
            Object.assign(new Error('Controlled ticket open denial'), {
              code: 'EPERM',
              syscall: 'open',
              path: String(file)
            })
          );
        }
        return read(file, options);
      });
      await expect(
        new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index()
      ).rejects.toThrow(/ticket stayed unreadable/);
      vi.restoreAllMocks();
      expect(denials).toBeGreaterThan(1);
      expect(await fs.readFile(pointer, 'utf8')).toBe(before.pointer);
      expect(await fs.readdir(generations)).toEqual(before.generations);
      const meta = await readIndexMeta(root);
      await expect(validateIndexArtifacts(root, meta)).resolves.toBeUndefined();
    },
    30_000
  );

  it.skipIf(process.platform !== 'win32')(
    'keeps the committed index and fails honestly when only the final publication lease stays unreadable on Windows',
    async () => {
      const root = await fixture();
      const context = path.join(root, '.codebase-context');
      const pointer = path.join(context, 'index-meta.json');
      const generations = path.join(context, '.generations');
      const committed = await readIndexMeta(root);
      const before = {
        pointer: await fs.readFile(pointer, 'utf8'),
        generations: await fs.readdir(generations),
        activeFiles: await digestTree(path.join(generations, committed.buildId))
      };
      await fs.writeFile(path.join(root, 'route.ts'), 'export function route() { return "new"; }');

      // Writer admission and the staging lease succeed, and the new generation is built.
      // The fault starts when its completion metadata is read, which is the last step before
      // publishIndexGeneration takes the final .publication lease, and then never ends.
      const read = fs.readFile.bind(fs);
      const completion = /[\\/]\.generations[\\/]([^\\/]+)[\\/]index-meta\.json$/;
      const publicationTicket = /[\\/]\.publication[\\/][^\\/]+\.json$/;
      let armed = false;
      let denials = 0;
      let publicationReadsBeforeFault = 0;
      vi.spyOn(fs, 'readFile').mockImplementation((file, options) => {
        const match = completion.exec(String(file));
        if (match && !before.generations.includes(match[1])) armed = true;
        if (publicationTicket.test(String(file))) {
          if (!armed) publicationReadsBeforeFault++;
          else {
            denials++;
            return Promise.reject(
              Object.assign(new Error('Controlled ticket open denial'), {
                code: 'EPERM',
                syscall: 'open',
                path: String(file)
              })
            );
          }
        }
        return read(file, options);
      });
      const phases: string[] = [];
      const indexer = new CodebaseIndexer({
        rootPath: root,
        config: { skipEmbedding: true },
        onProgress: (progress) => phases.push(progress.phase)
      });
      const message = String(
        await indexer.index().then(
          () => '',
          (error: Error) => error.message
        )
      );
      vi.restoreAllMocks();

      // The fault hit the final lease only, and the retry was bounded.
      expect(armed).toBe(true);
      expect(publicationReadsBeforeFault).toBeGreaterThan(0);
      expect(denials).toBeGreaterThan(1);
      expect(denials).toBeLessThanOrEqual(8);

      // The failure is reported, is honest about its cause, and never claims success.
      expect(message).toMatch(/ticket stayed unreadable.*tried \d+x/);
      expect(message).toMatch(/wait a moment and retry\.$/);
      expect(message).not.toMatch(/not changed|unchanged/i);
      expect(phases).not.toContain('complete');
      expect(indexer.getProgress().phase).toBe('error');

      // The old pointer and the active generation are byte-for-byte unchanged and readable.
      expect(await fs.readFile(pointer, 'utf8')).toBe(before.pointer);
      expect(await digestTree(path.join(generations, committed.buildId))).toEqual(
        before.activeFiles
      );
      const meta = await readIndexMeta(root);
      expect(meta.buildId).toBe(committed.buildId);
      await expect(validateIndexArtifacts(root, meta)).resolves.toBeUndefined();

      // The completed, unpublished generation is kept and complete. Its listing is not frozen.
      const unpublished = (await fs.readdir(generations)).filter(
        (name) => !before.generations.includes(name)
      );
      expect(unpublished).toHaveLength(1);
      const completed = await readIndexMetaFromFile(
        path.join(generations, unpublished[0], 'index-meta.json')
      );
      expect(completed.buildId).toBe(unpublished[0]);
      await expect(
        validateIndexArtifacts(root, {
          ...completed,
          artifacts: Object.fromEntries(
            Object.entries(completed.artifacts).map(([name, artifact]) => [
              name,
              { ...artifact, path: `.generations/${completed.buildId}/${artifact.path}` }
            ])
          ) as typeof completed.artifacts
        })
      ).resolves.toBeUndefined();

      // The failed lease left no ticket behind, so an explicit retry can succeed.
      expect(await fs.readdir(path.join(context, '.publication'))).toEqual([]);
      expect(await fs.readdir(path.join(context, '.writers'))).toEqual([]);
      await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
      const retried = await readIndexMeta(root);
      expect(retried.buildId).not.toBe(committed.buildId);
      await expect(validateIndexArtifacts(root, retried)).resolves.toBeUndefined();
      const response = await searchTool(
        { query: 'route' },
        {
          rootPath: root,
          paths: makePaths(root),
          indexState: { status: 'indexing' },
          performIndexing: () => undefined
        }
      );
      const payload: { status: string; results?: Array<{ signaturePreview?: string }> } =
        JSON.parse(response.content?.[0]?.text ?? '{}');
      expect(payload.status).toBe('success');
      expect(payload.results?.map((result) => result.signaturePreview)).toEqual([
        'export function route() { return "new"; }'
      ]);
    },
    60_000
  );

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
