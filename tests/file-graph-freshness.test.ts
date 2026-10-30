import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  RELATIONSHIPS_FILENAME
} from '../src/constants/codebase-context.js';
import { handle as getCodeRelationships } from '../src/tools/get-code-relationships.js';
import type { ToolContext } from '../src/tools/types.js';
import { InternalFileGraph } from '../src/utils/usage-tracker.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-graph-freshness-'));
  roots.push(root);
  const graph = new InternalFileGraph(root);
  const sources = new Map<string, string>();
  const baseDir = path.join(root, CODEBASE_CONTEXT_DIRNAME);
  await fs.mkdir(baseDir);
  const write = async (file: string, source: string) => {
    sources.set(file, source);
    await fs.writeFile(path.join(root, file), source);
  };
  const fingerprint = (file: string) =>
    createHash('sha256')
      .update(sources.get(file) ?? '')
      .digest('hex');
  const edge = (from: string, to: string, line = 1, kind: 'import' | 'reexport' = 'import') => {
    graph.trackImport(path.join(root, from), path.join(root, to), line, [], {
      kind,
      specifier: `./${to.slice(0, -3)}`,
      sourceFingerprint: fingerprint(from),
      targetFingerprint: fingerprint(to)
    });
  };
  const save = async () => {
    await fs.writeFile(
      path.join(baseDir, INDEX_META_FILENAME),
      JSON.stringify({
        metaVersion: INDEX_META_VERSION,
        formatVersion: INDEX_FORMAT_VERSION,
        buildId: 'freshness-fixture',
        generatedAt: '2026-10-15T00:00:00.000Z',
        toolVersion: 'fixture',
        artifacts: {
          keywordIndex: { path: 'index.json' },
          vectorDb: { path: 'index', provider: 'none', embeddingEnabled: false }
        }
      })
    );
    await fs.writeFile(
      path.join(baseDir, RELATIONSHIPS_FILENAME),
      JSON.stringify({
        header: { buildId: 'freshness-fixture', formatVersion: INDEX_FORMAT_VERSION },
        graph: graph.toJSON()
      })
    );
  };
  const ctx: ToolContext = {
    rootPath: root,
    paths: {
      baseDir,
      intelligence: path.join(baseDir, 'intelligence.json'),
      memory: path.join(baseDir, 'memory.json'),
      health: path.join(baseDir, 'health.json'),
      keywordIndex: path.join(baseDir, 'index.json'),
      vectorDb: path.join(baseDir, 'index')
    },
    indexState: { status: 'ready' },
    performIndexing: () => undefined
  };
  const query = async (
    file: string,
    direction: 'incoming' | 'outgoing',
    maxHops = 1,
    maxNodes = 100
  ) => {
    const response = await getCodeRelationships(
      { file, direction, max_hops: maxHops, max_nodes: maxNodes },
      ctx
    );
    const text = response.content?.[0]?.text ?? '{}';
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(4000);
    return JSON.parse(text) as {
      status: string;
      paths: Array<{ nodes: string[]; edges: Array<{ kind: string }> }>;
      truncated: boolean;
      outputNote?: string;
      message: string;
    };
  };
  return { root, write, edge, save, query };
}

it.each([2, 100])(
  'keeps a current outgoing edge after forty stale targets with accepted node cap %i',
  async (maxNodes) => {
    const f = await fixture();
    const stale = Array.from({ length: 40 }, (_, n) => `stale-${n}.ts`);
    await f.write(
      'entry.ts',
      [...stale, 'support.ts'].map((file) => `import './${file.slice(0, -3)}';`).join('\n')
    );
    for (const [index, file] of [...stale, 'support.ts'].entries()) {
      await f.write(file, 'export const value = true;\n');
      f.edge('entry.ts', file, index + 1);
    }
    await f.save();
    for (const file of stale) await f.write(file, 'export const changed = true;\n');

    const result = await f.query('entry.ts', 'outgoing', 1, maxNodes);
    expect(result.status).toBe('stale_edges');
    expect(result.paths.map(({ nodes }) => nodes)).toEqual([['entry.ts', 'support.ts']]);
    expect(result.paths.some(({ nodes }) => nodes.some((node) => node.startsWith('stale-')))).toBe(
      false
    );
  }
);

it.each([2, 100])(
  'keeps a current incoming importer after forty stale importers with accepted node cap %i',
  async (maxNodes) => {
    const f = await fixture();
    await f.write('target.ts', 'export const value = true;\n');
    const stale = Array.from({ length: 40 }, (_, n) => `stale-${n}.ts`);
    for (const file of [...stale, 'current.ts']) {
      await f.write(file, "import './target';\n");
      f.edge(file, 'target.ts');
    }
    await f.save();
    for (const file of stale) await f.write(file, 'export const changed = true;\n');

    const result = await f.query('target.ts', 'incoming', 1, maxNodes);
    expect(result.paths.map(({ nodes }) => nodes)).toEqual([['target.ts', 'current.ts']]);
  }
);

it('follows a current typed three-hop chain past stale branches and terminates its cycle', async () => {
  const f = await fixture();
  const stale = Array.from({ length: 40 }, (_, n) => `stale-${n}.ts`);
  await f.write(
    'entry.ts',
    [...stale, 'barrel.ts'].map((file) => `import './${file.slice(0, -3)}';`).join('\n')
  );
  await f.write('barrel.ts', "export * from './middle';\n");
  await f.write('middle.ts', "import './leaf';\n");
  await f.write('leaf.ts', "import './barrel';\n");
  for (const file of stale) {
    await f.write(file, 'export const value = true;\n');
    f.edge('entry.ts', file);
  }
  f.edge('entry.ts', 'barrel.ts');
  f.edge('barrel.ts', 'middle.ts', 1, 'reexport');
  f.edge('middle.ts', 'leaf.ts');
  f.edge('leaf.ts', 'barrel.ts');
  await f.save();
  for (const file of stale) await f.write(file, 'export const changed = true;\n');

  const result = await f.query('entry.ts', 'outgoing', 3, 4);
  const chain = result.paths.find(({ nodes }) => nodes.length === 4);
  expect(chain?.nodes).toEqual(['entry.ts', 'barrel.ts', 'middle.ts', 'leaf.ts']);
  expect(chain?.edges.map(({ kind }) => kind)).toEqual(['import', 'reexport', 'import']);
  expect(result.paths.every(({ nodes }) => new Set(nodes).size === nodes.length)).toBe(true);
});

it('bounds stale edge inspections and explains when a current edge remains beyond that budget', async () => {
  const f = await fixture();
  await f.write('entry.ts', `${"import './stale';\n".repeat(1100)}import './current';\n`);
  await f.write('stale.ts', 'export const value = true;\n');
  await f.write('current.ts', 'export const current = true;\n');
  for (let line = 1; line <= 1100; line++) f.edge('entry.ts', 'stale.ts', line);
  f.edge('entry.ts', 'current.ts', 1101);
  await f.save();
  await f.write('stale.ts', 'export const changed = true;\n');
  const reads = vi.spyOn(fs, 'readFile');

  const result = await f.query('entry.ts', 'outgoing');
  const staleReads = reads.mock.calls.filter(
    ([file]) => String(file) === path.join(f.root, 'stale.ts')
  );
  expect(staleReads.length).toBeLessThanOrEqual(1000);
  expect(result.paths).toEqual([]);
  expect(result.truncated).toBe(true);
  expect(result.outputNote).toMatch(/inspection/i);
  expect(result.message).toMatch(/refresh indexing/i);
});
