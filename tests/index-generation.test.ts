import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { CodebaseSearcher } from '../src/core/search.js';
import { readIndexMeta, validateIndexArtifacts } from '../src/core/index-meta.js';
import {
  IndexCapacityError,
  resolveIndexArtifact,
  withIndexSnapshot,
  MAX_INDEX_GENERATIONS
} from '../src/core/index-generation.js';
import { withAvailableIndexSnapshot } from '../src/core/index-generation.js';
import { IndexMetaSchema } from '../src/core/index-meta.js';
import { handle as healthTool } from '../src/tools/get-codebase-health.js';
import { makePaths } from '../src/project-state.js';

let root = '';
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = '';
});
async function fixture() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-generation-'));
  await fs.writeFile(path.join(root, 'route.ts'), 'export function route() { return "alpha"; }');
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
  return readIndexMeta(root);
}
async function update(value: string, incrementalOnly = false) {
  await fs.writeFile(path.join(root, 'route.ts'), `export function route() { return "${value}"; }`);
  return new CodebaseIndexer({
    rootPath: root,
    config: { skipEmbedding: true },
    incrementalOnly
  }).index();
}
async function validate() {
  await validateIndexArtifacts(root, await readIndexMeta(root));
}

async function legacyFixture() {
  const meta = await fixture();
  const context = path.join(root, '.codebase-context');
  const artifacts: Record<string, unknown> = {};
  for (const [name, artifact] of Object.entries(meta.artifacts)) {
    if (
      typeof artifact !== 'object' ||
      artifact === null ||
      !('path' in artifact) ||
      typeof artifact.path !== 'string'
    )
      throw new Error('Invalid fixture artifact');
    const filename = path.basename(artifact.path);
    await fs.cp(path.join(context, artifact.path), path.join(context, filename), {
      recursive: true
    });
    artifacts[name] = { ...artifact, path: filename };
  }
  const legacy = IndexMetaSchema.parse({ ...meta, artifacts });
  await fs.writeFile(path.join(context, 'index-meta.json'), JSON.stringify(legacy));
  await fs.rm(path.join(context, '.generations', meta.buildId), { recursive: true });
  return legacy;
}

describe('index generation fault boundaries', () => {
  it('rejects a linked vector marker even when its external build identity matches', async () => {
    const meta = await fixture();
    const vector = await resolveIndexArtifact(root, 'index');
    const marker = path.join(vector, 'index-build.json');
    const outside = path.join(root, 'outside-marker.json');
    await fs.copyFile(marker, outside);
    await fs.rm(marker);
    await fs.symlink(outside, marker, 'file');
    await expect(validateIndexArtifacts(root, meta)).rejects.toThrow(/linked.*artifact/i);
  });

  it('rejects linked artifact files and a linked context directory through a real tool', async () => {
    await fixture();
    const keyword = await resolveIndexArtifact(root, 'index.json');
    const outside = path.join(root, 'outside-keyword.json');
    await fs.copyFile(keyword, outside);
    await fs.rm(keyword);
    await fs.symlink(outside, keyword, 'file');
    await expect(resolveIndexArtifact(root, 'index.json')).rejects.toThrow(/linked.*artifact/i);
    await fs.rm(keyword);
    await fs.copyFile(outside, keyword);
    const context = path.join(root, '.codebase-context');
    const moved = path.join(root, 'outside-context');
    await fs.rename(context, moved);
    await fs.symlink(moved, context, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      healthTool(
        {},
        {
          rootPath: root,
          paths: makePaths(root),
          indexState: { status: 'ready' },
          performIndexing: () => undefined
        }
      )
    ).rejects.toThrow(/linked.*artifact/i);
  });

  it.each([false, true])(
    'preserves the committed build across every staged write failure (incremental=%s)',
    async (incrementalOnly) => {
      const baseline = await fixture();
      for (const filename of [
        'index-build.json',
        'index.json',
        'intelligence.json',
        'relationships.json',
        'health.json',
        'manifest.json',
        'indexing-stats.json',
        'index-meta.json'
      ]) {
        const write = fs.writeFile.bind(fs);
        let injected = false;
        const spy = vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
          await write(...args);
          if (
            !injected &&
            String(args[0]).includes('.generations') &&
            path.basename(String(args[0])) === filename
          ) {
            injected = true;
            throw new Error(`fault after ${filename}`);
          }
        });
        try {
          await expect(update(`new-${filename}`, incrementalOnly)).rejects.toThrow(
            `fault after ${filename}`
          );
          expect(injected).toBe(true);
        } finally {
          spy.mockRestore();
        }
        expect((await readIndexMeta(root)).buildId).toBe(baseline.buildId);
        await validate();
      }
    },
    60_000
  );

  it('keeps the previous build when pointer replacement fails', async () => {
    const baseline = await fixture();
    const rename = fs.rename.bind(fs);
    const pointer = path.join(root, '.codebase-context', 'index-meta.json');
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (String(target) === pointer) throw new Error('pointer rename failed');
      await rename(source, target);
    });
    await expect(update('beta')).rejects.toThrow('pointer rename failed');
    spy.mockRestore();
    expect((await readIndexMeta(root)).buildId).toBe(baseline.buildId);
    await validate();
  });

  it('keeps the previous build when writing temporary publication metadata fails', async () => {
    const baseline = await fixture();
    const context = path.join(root, '.codebase-context');
    const write = fs.writeFile.bind(fs);
    let injected = false;
    const spy = vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      await write(...args);
      const filename = String(args[0]);
      if (
        path.dirname(filename) === context &&
        path.basename(filename).startsWith('index-meta.json.') &&
        filename.endsWith('.tmp')
      ) {
        injected = true;
        throw new Error('temporary publication write failed');
      }
    });
    await expect(update('beta')).rejects.toThrow('temporary publication write failed');
    spy.mockRestore();
    expect(injected).toBe(true);
    expect((await readIndexMeta(root)).buildId).toBe(baseline.buildId);
    await validate();
  });

  it('does not roll back or delete a committed generation when collection fails', async () => {
    const baseline = await fixture();
    const readdir = fs.readdir.bind(fs);
    const pointer = path.join(root, '.codebase-context', 'index-meta.json');
    let committed = false;
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      await rename(source, target);
      if (String(target) === pointer) committed = true;
    });
    const spy = vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
      if (committed && String(args[0]) === path.join(root, '.codebase-context', '.generations'))
        throw new Error('cleanup failed');
      return readdir(...args);
    });
    await expect(update('beta')).resolves.toHaveProperty('errors', []);
    spy.mockRestore();
    expect(committed).toBe(true);
    expect((await readIndexMeta(root)).buildId).not.toBe(baseline.buildId);
    await validate();
  });

  it('preserves publication when lease-file cleanup fails after commit', async () => {
    const baseline = await fixture();
    const pointer = path.join(root, '.codebase-context', 'index-meta.json');
    let committed = false;
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      await rename(source, target);
      if (String(target) === pointer) committed = true;
    });
    const remove = fs.rm.bind(fs);
    const spy = vi.spyOn(fs, 'rm').mockImplementation(async (...args) => {
      if (
        committed &&
        String(args[0]).includes('.publication') &&
        String(args[0]).endsWith('.json')
      )
        throw new Error('lease cleanup failed');
      return remove(...args);
    });
    await expect(update('beta')).resolves.toHaveProperty('errors', []);
    spy.mockRestore();
    expect((await readIndexMeta(root)).buildId).not.toBe(baseline.buildId);
    await validate();
    await expect(update('gamma')).resolves.toHaveProperty('errors', []);
  });
});

describe('operation-scoped generation readers', () => {
  it('keeps an operation that began without an index on that same unavailable snapshot', async () => {
    await fixture();
    await fs.rm(path.join(root, '.codebase-context', 'index-meta.json'));
    await withAvailableIndexSnapshot(root, async () => {
      const before = await resolveIndexArtifact(root, 'index.json');
      await update('beta');
      expect(await resolveIndexArtifact(root, 'index.json')).toBe(before);
    });
    expect((await new CodebaseSearcher(root).search('beta')).length).toBeGreaterThan(0);
  });

  it('protects metadata-free legacy readers while an explicit rebuild migrates their files', async () => {
    await legacyFixture();
    await fs.rm(path.join(root, '.codebase-context', 'index-meta.json'));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const reader = withAvailableIndexSnapshot(root, async () => {
      const filename = await resolveIndexArtifact(root, 'index.json');
      entered.resolve();
      await release.promise;
      expect(await fs.readFile(filename, 'utf8')).toContain('alpha');
    });
    await entered.promise;
    try {
      await update('beta');
    } finally {
      release.resolve();
      await reader;
    }
    expect((await new CodebaseSearcher(root).search('beta')).length).toBeGreaterThan(0);
  });

  it('retries a completed pin release after both its release write and unlink temporarily fail', async () => {
    await fixture();
    const rename = fs.rename.bind(fs);
    const remove = fs.rm.bind(fs);
    let releasing = false;
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (releasing && String(target).includes('.pins') && String(target).endsWith('.json'))
        throw new Error('pin release write unavailable');
      return rename(source, target);
    });
    const removeSpy = vi.spyOn(fs, 'rm').mockImplementation(async (...args) => {
      if (releasing && String(args[0]).includes('.pins') && String(args[0]).endsWith('.json'))
        throw new Error('pin unlink unavailable');
      return remove(...args);
    });
    await withIndexSnapshot(root, async () => {
      releasing = true;
    });
    releasing = false;
    renameSpy.mockRestore();
    removeSpy.mockRestore();
    await update('beta');
    expect(await fs.readdir(path.join(root, '.codebase-context', '.pins'))).toEqual([]);
  });

  it('migrates legacy fixed files while preserving a pinned legacy reader and memory/config bytes', async () => {
    const legacy = await legacyFixture();
    const context = path.join(root, '.codebase-context');
    const memory = '[{"memory":"retain this"}]';
    const config = '{"project":"retain this"}';
    await fs.writeFile(path.join(context, 'memory.json'), memory);
    await fs.writeFile(path.join(context, 'config.json'), config);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const reader = withIndexSnapshot(root, async () => {
      const filename = await resolveIndexArtifact(root, 'index.json');
      entered.resolve();
      await release.promise;
      expect(JSON.parse(await fs.readFile(filename, 'utf8')).header.buildId).toBe(legacy.buildId);
    });
    await entered.promise;
    const releaseNew = Promise.withResolvers<void>();
    let newReader: Promise<void> | undefined;
    try {
      await update('beta', true);
      const enteredNew = Promise.withResolvers<void>();
      newReader = withIndexSnapshot(root, async () => {
        const meta = await readIndexMeta(root);
        const filename = await resolveIndexArtifact(root, 'index.json');
        enteredNew.resolve();
        await releaseNew.promise;
        expect(JSON.parse(await fs.readFile(filename, 'utf8')).header.buildId).toBe(meta.buildId);
      });
      await enteredNew.promise;
      await update('gamma', true);
      await expect(update('delta', true)).rejects.toBeInstanceOf(IndexCapacityError);
      expect(await fs.readdir(path.join(context, '.generations'))).toHaveLength(2);
      await fs.access(path.join(context, 'index.json'));
    } finally {
      release.resolve();
      releaseNew.resolve();
      await Promise.all([reader, newReader]);
    }
    await update('epsilon', true);
    await expect(fs.access(path.join(context, 'index.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
    expect(await fs.readFile(path.join(context, 'memory.json'), 'utf8')).toBe(memory);
    expect(await fs.readFile(path.join(context, 'config.json'), 'utf8')).toBe(config);
    await validate();
  });

  it('indexes and reads one canonical project through a real junction alias', async () => {
    await fixture();
    const alias = `${root}-alias`;
    await fs.symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      await expect(
        new CodebaseIndexer({ rootPath: alias, config: { skipEmbedding: true } }).index()
      ).resolves.toHaveProperty('errors', []);
      await fs.writeFile(path.join(root, 'route.ts'), 'export function route() { return "beta"; }');
      await expect(
        new CodebaseIndexer({
          rootPath: alias,
          config: { skipEmbedding: true },
          incrementalOnly: true
        }).index()
      ).resolves.toHaveProperty('errors', []);
      expect((await new CodebaseSearcher(alias).search('beta')).length).toBeGreaterThan(0);
    } finally {
      await fs.rm(alias, { recursive: true, force: true });
    }
  });

  it('rejects every mixed legacy/generation artifact path even when headers match', async () => {
    const meta = await fixture();
    const context = path.join(root, '.codebase-context');
    for (const artifact of Object.values(meta.artifacts)) {
      if (
        typeof artifact !== 'object' ||
        artifact === null ||
        !('path' in artifact) ||
        typeof artifact.path !== 'string'
      )
        continue;
      await fs.cp(
        path.join(context, artifact.path),
        path.join(context, path.basename(artifact.path)),
        { recursive: true }
      );
    }
    const legacy = IndexMetaSchema.parse({
      ...meta,
      artifacts: Object.fromEntries(
        Object.entries(meta.artifacts).map(([name, artifact]) => {
          if (
            typeof artifact !== 'object' ||
            artifact === null ||
            !('path' in artifact) ||
            typeof artifact.path !== 'string'
          )
            throw new Error('Invalid fixture artifact');
          return [name, { ...artifact, path: path.basename(artifact.path) }];
        })
      )
    });
    for (const [name, filename] of [
      ['vectorDb', 'index'],
      ['intelligence', 'intelligence.json'],
      ['manifest', 'manifest.json'],
      ['indexingStats', 'indexing-stats.json'],
      ['relationships', 'relationships.json'],
      ['health', 'health.json']
    ]) {
      const original = legacy.artifacts[name];
      if (typeof original !== 'object' || original === null)
        throw new Error('Missing fixture artifact');
      await fs.writeFile(
        path.join(context, 'index-meta.json'),
        JSON.stringify({
          ...legacy,
          artifacts: {
            ...legacy.artifacts,
            [name]: {
              ...original,
              path: meta.artifacts.keywordIndex.path.replace('index.json', filename)
            }
          }
        })
      );
      await expect(
        withIndexSnapshot(root, async () => resolveIndexArtifact(root, filename))
      ).rejects.toThrow(/artifact.*path/i);
    }
  });

  it('preserves successful and failed read outcomes when pin deletion fails, then reuses capacity', async () => {
    await fixture();
    const remove = fs.rm.bind(fs);
    const spy = vi.spyOn(fs, 'rm').mockImplementation(async (...args) => {
      if (String(args[0]).includes('.pins') && String(args[0]).endsWith('.json'))
        throw new Error('pin deletion failed');
      return remove(...args);
    });
    const original = new Error('original read failure');
    await expect(withIndexSnapshot(root, async () => 'read complete')).resolves.toBe(
      'read complete'
    );
    await expect(
      withIndexSnapshot(root, async () => {
        throw original;
      })
    ).rejects.toBe(original);
    for (const value of ['beta', 'gamma', 'delta', 'epsilon']) {
      await update(value);
      await expect(withIndexSnapshot(root, async () => value)).resolves.toBe(value);
    }
    spy.mockRestore();
    await expect(update('zeta')).resolves.toHaveProperty('errors', []);
    await validate();
  });

  it('selects the latest incremental baseline inside a writer nested under an old read snapshot', async () => {
    await fixture();
    await withIndexSnapshot(root, async () => {
      const old = await readIndexMeta(root);
      await update('beta');
      await fs.writeFile(path.join(root, 'added.ts'), 'export const added = true;');
      const stats = await new CodebaseIndexer({
        rootPath: root,
        config: { skipEmbedding: true },
        incrementalOnly: true
      }).index();
      expect(stats.incremental).toEqual({ added: 1, changed: 0, deleted: 0, unchanged: 1 });
      expect((await readIndexMeta(root)).buildId).toBe(old.buildId);
    });
    await validate();
  });

  it('keeps two long readers safe across publications and defers when all three slots are occupied', async () => {
    const a = await fixture();
    const enteredA = Promise.withResolvers<void>();
    const releaseA = Promise.withResolvers<void>();
    const readerA = withIndexSnapshot(root, async () => {
      const filename = await resolveIndexArtifact(root, 'index.json');
      enteredA.resolve();
      await releaseA.promise;
      const artifact = JSON.parse(await fs.readFile(filename, 'utf8'));
      expect(artifact.header.buildId).toBe(a.buildId);
    });
    await enteredA.promise;
    let readerB: Promise<void> | undefined;
    const releaseB = Promise.withResolvers<void>();
    try {
      await update('beta');
      const b = await readIndexMeta(root);
      const enteredB = Promise.withResolvers<void>();
      readerB = withIndexSnapshot(root, async () => {
        const filename = await resolveIndexArtifact(root, 'index.json');
        enteredB.resolve();
        await releaseB.promise;
        expect(JSON.parse(await fs.readFile(filename, 'utf8')).header.buildId).toBe(b.buildId);
      });
      await enteredB.promise;
      await update('gamma');
      const c = await readIndexMeta(root);
      await expect(update('delta')).rejects.toBeInstanceOf(IndexCapacityError);
      expect((await readIndexMeta(root)).buildId).toBe(c.buildId);
      expect(await fs.readdir(path.join(root, '.codebase-context', '.generations'))).toHaveLength(
        MAX_INDEX_GENERATIONS
      );
    } finally {
      releaseA.resolve();
      releaseB.resolve();
      await Promise.all([readerA, readerB]);
    }
    await expect(update('epsilon')).resolves.toHaveProperty('errors', []);
    await validate();
    expect(
      (await fs.readdir(path.join(root, '.codebase-context', '.generations'))).length
    ).toBeLessThanOrEqual(MAX_INDEX_GENERATIONS);
  });

  it('refreshes an existing searcher on every operation and keeps source-drift negatives', async () => {
    await fixture();
    const searcher = new CodebaseSearcher(root);
    expect((await searcher.search('alpha')).length).toBeGreaterThan(0);
    await fs.writeFile(path.join(root, 'route.ts'), 'export function route() { return "beta"; }');
    expect((await searcher.searchWithCoverage('alpha')).sourceCoverage.status).toBe(
      'no_fresh_results'
    );
    await update('beta', true);
    expect((await searcher.search('beta')).length).toBeGreaterThan(0);
    await update('gamma', true);
    expect((await searcher.search('gamma')).length).toBeGreaterThan(0);
    expect(await fs.readdir(path.join(root, '.codebase-context', '.pins'))).toEqual([]);
  });

  it('keeps validation and loading on the pinned build when publication occurs between them', async () => {
    await fixture();
    const filename = await resolveIndexArtifact(root, 'index.json');
    const read = fs.readFile.bind(fs);
    let refreshed = false;
    const spy = vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      const data = await read(...args);
      if (!refreshed && String(args[0]) === filename) {
        refreshed = true;
        await update('beta');
      }
      return data;
    });
    const outcome = await new CodebaseSearcher(root).searchWithCoverage('alpha');
    spy.mockRestore();
    expect(refreshed).toBe(true);
    expect(outcome.results).toEqual([]);
    expect(outcome.sourceCoverage.status).toBe('no_fresh_results');
    expect((await new CodebaseSearcher(root).search('beta')).length).toBeGreaterThan(0);
  });
});
