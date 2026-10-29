import { promises as fs } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { fork, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { provider } = vi.hoisted(() => ({ provider: vi.fn() }));
vi.mock('../src/embeddings/index.js', async (original) => ({
  ...(await original<typeof import('../src/embeddings/index.js')>()),
  getEmbeddingProvider: provider
}));
import { CodebaseIndexer } from '../src/core/indexer.js';
import { handleCliCommand } from '../src/cli.js';
import { resolveSkipEmbedding, readIndexMeta } from '../src/core/index-meta.js';
import {
  inspectIndexDiskState,
  resolveIndexArtifact,
  IndexCapacityError
} from '../src/core/index-generation.js';

let root = '';
const children: ChildProcess[] = [];
const previousRoot = process.env.CODEBASE_ROOT;
const previousConfig = process.env.CODEBASE_CONTEXT_CONFIG_PATH;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-mode-matrix-'));
  await fs.writeFile(path.join(root, 'route.ts'), 'export const route = "matrix";');
  process.env.CODEBASE_ROOT = root;
  process.env.CODEBASE_CONTEXT_CONFIG_PATH = path.join(root, 'server-config.json');
  provider.mockReset().mockResolvedValue({
    name: 'fixture',
    modelName: 'matrix',
    dimensions: 384,
    initialize: async () => undefined,
    isReady: () => true,
    embedBatch: async (texts: string[]) =>
      texts.map(() => Array.from({ length: 384 }, (_, i) => i / 1000)),
    embed: async () => Array(384).fill(0)
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await exited;
  }
  await fs.rm(root, { recursive: true, force: true });
  if (previousRoot === undefined) delete process.env.CODEBASE_ROOT;
  else process.env.CODEBASE_ROOT = previousRoot;
  if (previousConfig === undefined) delete process.env.CODEBASE_CONTEXT_CONFIG_PATH;
  else process.env.CODEBASE_CONTEXT_CONFIG_PATH = previousConfig;
});
async function config(skipEmbedding?: boolean) {
  await fs.writeFile(
    path.join(root, 'server-config.json'),
    JSON.stringify({
      projects: [{ root, ...(skipEmbedding === undefined ? {} : { skipEmbedding }) }]
    })
  );
}
async function build(skipEmbedding: boolean) {
  return new CodebaseIndexer({ rootPath: root, config: { skipEmbedding } }).index();
}
async function digest(
  directory: string
): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const result: Array<{ path: string; bytes: number; sha256: string }> = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else {
        const data = await fs.readFile(filename);
        result.push({
          path: path.relative(directory, filename),
          bytes: data.length,
          sha256: createHash('sha256').update(data).digest('hex')
        });
      }
    }
  };
  await visit(directory);
  return result;
}
async function legacy(skipEmbedding: boolean) {
  await build(skipEmbedding);
  const pointer = path.join(root, '.codebase-context', 'index-meta.json');
  const meta = await readIndexMeta(root);
  const directory = path.dirname(await resolveIndexArtifact(root, 'index.json'));
  for (const entry of await fs.readdir(directory)) {
    if (entry !== 'index-meta.json')
      await fs.cp(path.join(directory, entry), path.join(root, '.codebase-context', entry), {
        recursive: true
      });
  }
  const fixed = JSON.parse(await fs.readFile(path.join(directory, 'index-meta.json'), 'utf8'));
  expect(fixed.buildId).toBe(meta.buildId);
  await fs.writeFile(pointer, JSON.stringify(fixed));
  await fs.rm(path.join(root, '.codebase-context', '.generations'), { recursive: true });
}
const scenarios = [
  { name: 'fresh default', setup: async () => config(), mode: true },
  { name: 'fresh explicit keyword', setup: async () => config(true), mode: true },
  { name: 'fresh explicit semantic', setup: async () => config(false), mode: false },
  {
    name: 'recorded keyword',
    setup: async () => {
      await build(true);
      await config();
    },
    mode: true
  },
  {
    name: 'recorded semantic',
    setup: async () => {
      await build(false);
      await config();
    },
    mode: false
  },
  {
    name: 'legacy keyword',
    setup: async () => {
      await legacy(true);
      await config();
    },
    mode: true
  },
  {
    name: 'legacy semantic',
    setup: async () => {
      await legacy(false);
      await config();
    },
    mode: false
  },
  {
    name: 'memory only',
    setup: async () => {
      await fs.mkdir(path.join(root, '.codebase-context'));
      await fs.writeFile(path.join(root, '.codebase-context', 'memory.json'), '{}');
      await config();
    },
    mode: true
  }
];
describe.each(['map', 'reindex'] as const)('mode matrix through %s', (command) => {
  it.each(scenarios)('$name', async ({ setup, mode }) => {
    await setup();
    provider.mockClear();
    await handleCliCommand([command, '--json']);
    expect(await resolveSkipEmbedding(root)).toBe(mode);
    expect((await readIndexMeta(root)).artifacts.vectorDb.embeddingEnabled).toBe(!mode);
    if (mode) expect(provider).not.toHaveBeenCalled();
  });
  it('preserves an out-of-order stage instead of treating known filenames as a first build', async () => {
    await build(true);
    await config();
    const generation = path.dirname(await resolveIndexArtifact(root, 'index.json'));
    await fs.rm(path.join(root, '.codebase-context', 'index-meta.json'));
    for (const name of await fs.readdir(generation)) {
      if (name !== 'health.json') await fs.rm(path.join(generation, name), { recursive: true });
    }
    const before = await digest(generation);
    await expect(handleCliCommand([command, '--json'])).rejects.toThrow(/recover|explicit/i);
    expect(await digest(generation)).toEqual(before);
  });
  it.each(['keyword', 'semantic'] as const)(
    'requires explicit recovery of a completed %s orphan',
    async (mode) => {
      await build(mode === 'keyword');
      await config();
      const directory = path.join(root, '.codebase-context', '.generations');
      const before = await digest(directory);
      await fs.rm(path.join(root, '.codebase-context', 'index-meta.json'));
      await expect(handleCliCommand([command, '--json'])).rejects.toThrow(/explicit|recover/i);
      expect(await digest(directory)).toEqual(before);
      await expect(
        fs.access(path.join(root, '.codebase-context', 'index-meta.json'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );
  it.each(['malformed', 'future', 'truncated-local', 'mismatched-local', 'unknown-stage'] as const)(
    'preserves %s evidence',
    async (variant) => {
      await build(true);
      await config();
      const pointer = path.join(root, '.codebase-context', 'index-meta.json');
      const generation = path.dirname(await resolveIndexArtifact(root, 'index.json'));
      if (variant === 'malformed') await fs.writeFile(pointer, '{');
      else if (variant === 'future') {
        const meta = await readIndexMeta(root);
        await fs.writeFile(pointer, JSON.stringify({ ...meta, formatVersion: 999 }));
      } else {
        await fs.rm(pointer);
        if (variant === 'unknown-stage')
          await fs.writeFile(path.join(generation, 'unknown.bin'), 'hold');
        else if (variant === 'truncated-local')
          await fs.writeFile(path.join(generation, 'index-meta.json'), '{');
        else {
          const local = JSON.parse(
            await fs.readFile(path.join(generation, 'index-meta.json'), 'utf8')
          );
          local.buildId = randomUUID();
          await fs.writeFile(path.join(generation, 'index-meta.json'), JSON.stringify(local));
        }
      }
      const before = await digest(path.join(root, '.codebase-context', '.generations'));
      await expect(handleCliCommand([command, '--json'])).rejects.toThrow();
      expect(await digest(path.join(root, '.codebase-context', '.generations'))).toEqual(before);
    }
  );
});

it.each([true, false])(
  'preserves three mixed completed orphans and reports capacity even with explicit skipEmbedding=%s',
  async (skipEmbedding) => {
    await build(false);
    await build(true);
    await build(false);
    const directory = path.join(root, '.codebase-context', '.generations');
    const before = await digest(directory);
    await fs.rm(path.join(root, '.codebase-context', 'index-meta.json'));
    const attempt = build(skipEmbedding);
    await expect(attempt).rejects.toBeInstanceOf(IndexCapacityError);
    await expect(attempt).rejects.toThrow(/operator-selected.*outside.*explicit/i);
    expect(await digest(directory)).toEqual(before);
    expect(await fs.readdir(directory)).toHaveLength(3);
  }
);
it.each(
  [1, 2].flatMap((count) => [true, false].map((skipEmbedding) => ({ count, skipEmbedding })))
)(
  'makes explicit progress with $count completed orphans and skipEmbedding=$skipEmbedding without deleting bytes',
  async ({ count, skipEmbedding }) => {
    for (let i = 0; i < count; i++) await build(i % 2 === 0);
    const directory = path.join(root, '.codebase-context', '.generations');
    const before = await digest(directory);
    await fs.rm(path.join(root, '.codebase-context', 'index-meta.json'));
    await build(skipEmbedding);
    const after = await digest(directory);
    for (const file of before) expect(after).toContainEqual(file);
    expect((await readIndexMeta(root)).artifacts.vectorDb.embeddingEnabled).toBe(!skipEmbedding);
  }
);
it('holds an unknown UUID generation during explicit recovery', async () => {
  const directory = path.join(root, '.codebase-context', '.generations', randomUUID());
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'unknown.bin'), 'preserve');
  const before = await digest(directory);
  await build(true);
  expect(await digest(directory)).toEqual(before);
});

it.each([true, false])(
  'holds unknown and completed data at capacity with explicit skipEmbedding=%s',
  async (skipEmbedding) => {
    await build(true);
    await build(false);
    await fs.rm(path.join(root, '.codebase-context', 'index-meta.json'));
    const directory = path.join(root, '.codebase-context', '.generations');
    const unknown = path.join(directory, randomUUID());
    await fs.mkdir(unknown);
    await fs.writeFile(path.join(unknown, 'unknown.bin'), 'preserve');
    const before = await digest(directory);
    await expect(build(skipEmbedding)).rejects.toBeInstanceOf(IndexCapacityError);
    expect(await digest(directory)).toEqual(before);
  }
);
for (const command of ['map', 'reindex'] as const) {
  it(`preserves unversioned legacy bytes through ${command} without inventing a mode`, async () => {
    await legacy(true);
    await config();
    const pointer = path.join(root, '.codebase-context', 'index-meta.json');
    await fs.rm(pointer);
    const before = await digest(path.join(root, '.codebase-context'));
    expect(await inspectIndexDiskState(root)).toEqual({ kind: 'legacy', mode: 'unknown' });
    if (command === 'map') await handleCliCommand([command, '--json']);
    else await expect(handleCliCommand([command, '--json'])).rejects.toThrow(/recover|explicit/i);
    expect(await digest(path.join(root, '.codebase-context'))).toEqual(before);
    await expect(fs.access(pointer)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it(`rejects unsupported future fixed-layout metadata through ${command}`, async () => {
    await legacy(true);
    await config();
    const pointer = path.join(root, '.codebase-context', 'index-meta.json');
    const meta = await readIndexMeta(root);
    await fs.writeFile(pointer, JSON.stringify({ ...meta, metaVersion: 999 }));
    const before = await digest(path.join(root, '.codebase-context'));
    await expect(handleCliCommand([command, '--json'])).rejects.toThrow();
    expect(await digest(path.join(root, '.codebase-context'))).toEqual(before);
  });
  it(`reports pointer permission failure through ${command} without publication`, async () => {
    await build(true);
    await config();
    const pointer = path.join(root, '.codebase-context', 'index-meta.json');
    const before = await digest(path.join(root, '.codebase-context', '.generations'));
    const read = fs.readFile.bind(fs);
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      if (String(args[0]) === pointer)
        throw Object.assign(new Error('pointer access denied'), { code: 'EACCES' });
      return read(...args);
    });
    await expect(inspectIndexDiskState(root)).rejects.toMatchObject({ code: 'EACCES' });
    await expect(handleCliCommand([command, '--json'])).rejects.toThrow(/denied|unreadable/i);
    expect(await digest(path.join(root, '.codebase-context', '.generations'))).toEqual(before);
  });
  it(`preserves linked orphan contents through ${command}`, async () => {
    await build(true);
    await config();
    const generation = path.dirname(await resolveIndexArtifact(root, 'index.json'));
    await fs.rm(path.join(root, '.codebase-context', 'index-meta.json'));
    await fs.rm(path.join(generation, 'index'), { recursive: true });
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'held.bin'), 'held');
    await fs.symlink(
      outside,
      path.join(generation, 'index'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const before = await digest(outside);
    await expect(handleCliCommand([command, '--json'])).rejects.toThrow(/recover|explicit|linked/i);
    expect(await digest(outside)).toEqual(before);
    expect((await fs.lstat(path.join(generation, 'index'))).isSymbolicLink()).toBe(true);
  });
}

for (const command of ['map', 'reindex'] as const) {
  it.each([1, 2, 3])(
    `preserves format-%i fixed-layout recorded mode through ${command}`,
    async (formatVersion) => {
      const skipEmbedding = formatVersion !== 2;
      await legacy(skipEmbedding);
      await config();
      const pointer = path.join(root, '.codebase-context', 'index-meta.json');
      const meta = await readIndexMeta(root);
      await fs.writeFile(pointer, JSON.stringify({ ...meta, formatVersion }));
      const before = await digest(path.join(root, '.codebase-context'));
      expect(await resolveSkipEmbedding(root)).toBe(skipEmbedding);
      if (command === 'map') {
        await expect(handleCliCommand([command, '--json'])).rejects.toThrow(/version|rebuild/i);
        expect(await digest(path.join(root, '.codebase-context'))).toEqual(before);
      } else {
        await handleCliCommand([command, '--json']);
        expect((await readIndexMeta(root)).artifacts.vectorDb.embeddingEnabled).toBe(
          !skipEmbedding
        );
      }
    }
  );
}
it.each(['index-generation', 'index-meta'])(
  'cold-imports %s first and resolves a fresh mode without a provider',
  (first) => {
    const entry = new URL(`../src/core/${first}.ts`, import.meta.url).href;
    const metadata = new URL('../src/core/index-meta.ts', import.meta.url).href;
    const script = `await import(${JSON.stringify(entry)}); const {resolveSkipEmbedding}=await import(${JSON.stringify(metadata)}); console.log((await resolveSkipEmbedding(${JSON.stringify(root)})) ? "keyword" : "semantic");`;
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true }
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('keyword');
    expect(result.stderr).toBe('');
  }
);

function child(action: string, helper = 'index-mode-child.ts') {
  const process = fork(
    fileURLToPath(new URL(`./helpers/${helper}`, import.meta.url)),
    helper === 'index-publication-child.ts' ? [root, 'full', 'vector-marker'] : [root, action],
    { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
  );
  children.push(process);
  const seen: string[] = [];
  const listeners = new Set<() => void>();
  let stderr = '';
  process.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  process.on('message', (message) => {
    if (typeof message === 'object' && message !== null) {
      if ('type' in message && typeof message.type === 'string') seen.push(message.type);
      else if ('edge' in message) seen.push('marker');
    }
    for (const check of listeners) check();
  });
  process.on('exit', () => {
    for (const check of listeners) check();
  });
  const wait = (type: string) =>
    new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        listeners.delete(check);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        if (seen.includes(type)) finish();
        else if (
          seen.includes('failed') ||
          process.exitCode !== null ||
          process.signalCode !== null
        )
          finish(new Error(`Child stopped: ${seen} ${stderr}`));
      };
      // Stops on this event, child exit, or20seconds; afterEach kills only these children.
      const timer = setTimeout(
        () => finish(new Error(`Child did not report ${type}: ${stderr}`)),
        20_000
      );
      listeners.add(check);
      check();
    });
  const kill = async () => {
    const exited = new Promise<void>((resolve) => process.once('exit', () => resolve()));
    process.kill('SIGKILL');
    await exited;
  };
  return { process, wait, kill };
}
it('rechecks first-build eligibility under the writer after another process publishes semantic data', async () => {
  await config(true);
  const publisher = child('publish');
  await publisher.wait('held');
  const map = child('map');
  await map.wait('queued');
  publisher.process.send({ release: true });
  await publisher.wait('complete');
  const before = await fs.readFile(path.join(root, '.codebase-context', 'index-meta.json'));
  expect((await readIndexMeta(root)).artifacts.vectorDb.embeddingEnabled).toBe(true);
  await map.wait('complete');
  expect(await fs.readFile(path.join(root, '.codebase-context', 'index-meta.json'))).toEqual(
    before
  );
  expect(await fs.readdir(path.join(root, '.codebase-context', '.generations'))).toHaveLength(1);
}, 30_000);
it.each(['map', 'reindex'] as const)(
  'resumes a real killed model-free marker-only first build through %s',
  async (command) => {
    await config();
    const first = child('marker', 'index-publication-child.ts');
    await first.wait('marker');
    await first.kill();
    expect((await inspectIndexDiskState(root)).kind).toBe('incomplete-first-build');
    await handleCliCommand([command, '--json']);
    expect((await readIndexMeta(root)).artifacts.vectorDb.embeddingEnabled).toBe(false);
    expect(await fs.readdir(path.join(root, '.codebase-context', '.generations'))).toHaveLength(2);
  },
  30_000
);
it.each(['map', 'reindex'] as const)(
  'preserves a real killed semantic native stage before its marker through %s',
  async (command) => {
    await config();
    const first = child('semantic-stage');
    await first.wait('native');
    await first.kill();
    const directory = path.join(root, '.codebase-context', '.generations');
    const before = await digest(directory);
    expect(before.some((file) => file.path.includes('.lance'))).toBe(true);
    expect(
      before.some(
        (file) => file.path.endsWith('index-meta.json') || file.path.endsWith('index-build.json')
      )
    ).toBe(false);
    await expect(handleCliCommand([command, '--json'])).rejects.toThrow(/recover|explicit/i);
    expect(await digest(directory)).toEqual(before);
  },
  30_000
);
