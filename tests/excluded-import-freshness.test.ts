import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { analyzerRegistry } from '../src/core/analyzer-registry.js';
import { GenericAnalyzer } from '../src/analyzers/generic/index.js';
import { resolveIndexArtifact } from '../src/core/index-generation.js';
import { RELATIONSHIPS_FILENAME } from '../src/constants/codebase-context.js';
import { makePaths } from '../src/project-state.js';
import { handle } from '../src/tools/get-code-relationships.js';
import { InternalSourceResolver } from '../src/utils/internal-source-resolver.js';
import type { ToolContext } from '../src/tools/types.js';

const roots: string[] = [];
beforeAll(() => analyzerRegistry.register(new GenericAnalyzer()));
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-unindexed-'));
  roots.push(root);
  return root;
}
async function write(root: string, relative: string, content: string) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
function index(rootPath: string, exclude?: string[], incrementalOnly = false) {
  return new CodebaseIndexer({
    rootPath,
    config: { skipEmbedding: true, ...(exclude ? { exclude } : {}) },
    incrementalOnly
  }).index();
}
async function query(rootPath: string) {
  const ctx: ToolContext = {
    rootPath,
    paths: makePaths(rootPath),
    indexState: { status: 'ready' },
    performIndexing: () => undefined
  };
  const response = await handle({ file: 'main.ts', max_hops: 1 }, ctx);
  const text = response.content?.[0]?.text ?? '{}';
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4000);
  return z
    .object({
      status: z.string(),
      truncated: z.boolean().optional(),
      outputNote: z.string().optional()
    })
    .passthrough()
    .parse(JSON.parse(text));
}
const Stored = z
  .object({
    header: z.record(z.string(), z.unknown()),
    graph: z
      .object({
        imports: z.record(z.string(), z.array(z.string())),
        unresolvedEdges: z.array(z.record(z.string(), z.unknown())).default([])
      })
      .passthrough()
  })
  .passthrough();
async function sidecar(root: string) {
  const file = await resolveIndexArtifact(root, RELATIONSHIPS_FILENAME);
  const value = Stored.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  return { file, value, save: () => fs.writeFile(file, JSON.stringify(value)) };
}

it.each([
  { statement: "import './dist/target';", exclude: undefined, target: 'dist/target.ts' },
  { statement: "export * from './dist/target';", exclude: undefined, target: 'dist/target.ts' },
  {
    statement: "import './private/target';",
    exclude: ['**/private/**'],
    target: 'private/target.ts'
  }
])(
  'keeps an existing excluded target current across full and incremental refresh: $statement',
  async ({ statement, exclude, target }) => {
    const root = await fixture();
    await write(root, 'main.ts', `${statement}\nexport const main = true;\n`);
    await write(root, target, 'export const target = true;\n');
    for (const incremental of [false, false, true]) {
      await index(root, exclude, incremental);
      expect(await query(root)).toMatchObject({
        status: 'success',
        paths: [],
        unresolved: [expect.objectContaining({ reason: 'not-indexed', target })]
      });
      const stored = await sidecar(root);
      expect(stored.value.graph.imports['main.ts'] ?? []).toEqual([]);
      expect(stored.value.graph.unresolvedEdges).toContainEqual(
        expect.objectContaining({ reason: 'not-indexed', target })
      );
    }
  }
);

it('requires one actual refresh of an old not-found sidecar and then remains current', async () => {
  const root = await fixture();
  await write(root, 'main.ts', "import './dist/target';\n");
  await write(root, 'dist/target.ts', 'export const target = true;\n');
  await index(root);
  const stored = await sidecar(root);
  const edge = stored.value.graph.unresolvedEdges[0];
  if (!edge) throw new Error('Expected stored unresolved import');
  edge.reason = 'not-found';
  delete edge.target;
  await stored.save();
  expect(await query(root)).toMatchObject({ status: 'stale_edges', paths: [] });
  for (let refresh = 0; refresh < 2; refresh++) {
    await index(root);
    expect(await query(root)).toMatchObject({
      status: 'success',
      unresolved: [expect.objectContaining({ reason: 'not-indexed' })]
    });
  }
});

it('does not suppress a newly appeared excluded target using manifest nonmembership', async () => {
  const root = await fixture();
  await write(root, 'main.ts', "import './dist/target';\n");
  await index(root);
  expect(await query(root)).toMatchObject({
    status: 'success',
    unresolved: [expect.objectContaining({ reason: 'not-found' })]
  });
  await write(root, 'dist/target.ts', 'export const target = true;\n');
  expect(await query(root)).toMatchObject({ status: 'stale_edges', paths: [] });
  await index(root);
  expect(await query(root)).toMatchObject({
    status: 'success',
    unresolved: [expect.objectContaining({ reason: 'not-indexed' })]
  });
});

it('rejects a new included higher-priority target even when its bytes match the excluded fallback', async () => {
  const root = await fixture();
  await write(root, 'main.ts', "import './target';\n");
  await write(root, 'target.js', 'export const target = true;\n');
  await index(root, ['**/*.js']);
  expect(await query(root)).toMatchObject({
    status: 'success',
    unresolved: [expect.objectContaining({ target: 'target.js' })]
  });
  await write(root, 'target.ts', 'export const target = true;\n');
  expect(await query(root)).toMatchObject({ status: 'stale_edges', paths: [], unresolved: [] });
});

it('distinguishes a selected target missing its source fingerprint and recovers after a successful read', async () => {
  const root = await fixture();
  await write(root, 'main.ts', "import './target';\n");
  await write(root, 'target.ts', 'export const target = true;\n');
  const target = await fs.realpath(path.join(root, 'target.ts'));
  const read = fs.readFile;
  const reads = vi.spyOn(fs, 'readFile').mockImplementation((file, options) => {
    if (String(file) === target && options === undefined)
      return Promise.reject(
        Object.assign(new Error('Controlled source read failure'), { code: 'EACCES' })
      );
    return read(file, options);
  });
  const stats = await index(root);
  reads.mockRestore();
  expect(stats.errors).toContainEqual(
    expect.objectContaining({ filePath: path.join(root, 'target.ts'), phase: 'analyzing' })
  );
  const stored = await sidecar(root);
  expect(stored.value.graph.unresolvedEdges).toContainEqual(
    expect.objectContaining({ reason: 'analysis-unavailable', target: 'target.ts' })
  );
  expect(await query(root)).toMatchObject({
    status: 'success',
    paths: [],
    unresolved: [expect.objectContaining({ reason: 'analysis-unavailable', target: 'target.ts' })],
    message: expect.stringMatching(/indexing errors/i)
  });
  await index(root);
  expect(await query(root)).toMatchObject({
    status: 'success',
    unresolved: [],
    paths: [expect.objectContaining({ nodes: ['main.ts', 'target.ts'] })]
  });
});

it.each(['throw', 'skip'])(
  'does not confuse post-capture analyzer %s with a missing source fingerprint',
  async (behavior) => {
    const root = await fixture();
    await write(root, 'main.ts', "import './target';\n");
    await write(root, 'target.ts', 'export const target = true;\n');
    const analyze = analyzerRegistry.analyzeFile.bind(analyzerRegistry);
    const analysis = vi
      .spyOn(analyzerRegistry, 'analyzeFile')
      .mockImplementation((file, content, options) => {
        if (file === path.join(root, 'target.ts'))
          return behavior === 'throw'
            ? Promise.reject(new Error('Controlled analyzer failure after byte capture'))
            : Promise.resolve(null);
        return analyze(file, content, options);
      });
    const stats = await index(root);
    analysis.mockRestore();
    if (behavior === 'throw')
      expect(stats.errors).toContainEqual(expect.objectContaining({ phase: 'analyzing' }));
    else expect(stats.skippedFiles).toBeGreaterThan(0);
    expect(await query(root)).toMatchObject({
      status: 'success',
      unresolved: [],
      paths: [expect.objectContaining({ nodes: ['main.ts', 'target.ts'] })]
    });
  }
);

it('captures physical target identity through root and target junction aliases and detects retargeting', async () => {
  const base = await fixture();
  const root = path.join(base, 'physical');
  await write(root, 'main.ts', "import './linked/target';\n");
  await write(root, 'dist/first/target.ts', 'export const target = true;\n');
  await write(root, 'dist/second/target.ts', 'export const target = true;\n');
  const alias = path.join(base, 'alias');
  const link = path.join(root, 'linked');
  await fs.symlink(root, alias, 'junction');
  await fs.symlink(path.join(root, 'dist/first'), link, 'junction');
  await index(root);
  expect(await query(alias)).toMatchObject({
    status: 'success',
    unresolved: [expect.objectContaining({ target: 'dist/first/target.ts' })]
  });
  const stored = await sidecar(alias);
  expect(stored.value.graph.unresolvedEdges).toContainEqual(
    expect.objectContaining({ target: 'dist/first/target.ts' })
  );
  await fs.unlink(link);
  await fs.symlink(path.join(root, 'dist/second'), link, 'junction');
  expect(await query(alias)).toMatchObject({ status: 'stale_edges', paths: [] });
  const outside = path.join(base, 'physical-other');
  await write(outside, 'target.ts', 'export const target = true;\n');
  await fs.unlink(link);
  await fs.symlink(outside, link, 'junction');
  expect(await query(alias)).toMatchObject({ status: 'stale_edges', paths: [] });
});

it.each([
  { target: undefined },
  { target: null },
  { target: 4 },
  { target: [] },
  { target: '/absolute.ts' },
  { target: '../escape.ts' },
  { target: 'C:drive-relative.ts' },
  { target: 'a/../escape.ts' }
])('rejects malformed target proof before traversal: $target', async ({ target }) => {
  const root = await fixture();
  await write(root, 'main.ts', "import './dist/target';\n");
  await write(root, 'dist/target.ts', 'export const target = true;\n');
  await index(root);
  const stored = await sidecar(root);
  const edge = stored.value.graph.unresolvedEdges[0];
  if (!edge) throw new Error('Expected unresolved import');
  edge.reason = 'not-indexed';
  edge.target = target;
  await stored.save();
  const resolve = vi.spyOn(InternalSourceResolver.prototype, 'resolve');
  expect(await query(root)).toMatchObject({ status: 'graph_unavailable' });
  expect(resolve).not.toHaveBeenCalled();
});

it.each([
  null,
  { from: 4 },
  { from: 'main.ts', source: null },
  { from: 'main.ts', reason: 'invented', source: {} }
])('rejects malformed unresolved records before traversal: %j', async (edge) => {
  const root = await fixture();
  await write(root, 'main.ts', "import './missing';\n");
  await index(root);
  const stored = await sidecar(root);
  await fs.writeFile(
    stored.file,
    JSON.stringify({ ...stored.value, graph: { ...stored.value.graph, unresolvedEdges: [edge] } })
  );
  expect(await query(root)).toMatchObject({ status: 'graph_unavailable' });
});

it('keeps canonical proof captured before a pending selected target link is retargeted', async () => {
  const root = await fixture();
  await write(root, 'main.ts', "import './linked/target';\n");
  await write(root, 'first/target.ts', 'export const target = true;\n');
  await write(root, 'second/target.ts', 'export const target = true;\n');
  const link = path.join(root, 'linked');
  await fs.symlink(path.join(root, 'first'), link, 'junction');
  const first = await fs.realpath(path.join(root, 'first/target.ts'));
  const read = fs.readFile;
  const reads = vi.spyOn(fs, 'readFile').mockImplementation((file, options) => {
    if (String(file) === first && options === undefined)
      return Promise.reject(new Error('Controlled missing target snapshot'));
    return read(file, options);
  });
  const resolve = InternalSourceResolver.prototype.resolve;
  let retargeted = false;
  const resolutions = vi
    .spyOn(InternalSourceResolver.prototype, 'resolve')
    .mockImplementation(async function (
      this: InternalSourceResolver,
      importer,
      specifier,
      allowUnindexed
    ) {
      const result = await resolve.call(this, importer, specifier, allowUnindexed);
      if (!retargeted && specifier === './linked/target') {
        expect(result).toMatchObject({ status: 'resolved', target: 'first/target.ts' });
        retargeted = true;
        await fs.unlink(link);
        await fs.symlink(path.join(root, 'second'), link, 'junction');
      }
      return result;
    });
  await index(root);
  reads.mockRestore();
  resolutions.mockRestore();
  expect(retargeted).toBe(true);
  const stored = await sidecar(root);
  expect(stored.value.graph.unresolvedEdges).toContainEqual(
    expect.objectContaining({ reason: 'analysis-unavailable', target: 'first/target.ts' })
  );
  expect(await query(root)).toMatchObject({ status: 'stale_edges', paths: [] });
});

it('uses platform case rules for physical target identity without accepting a different POSIX file', async () => {
  const root = await fixture();
  await write(root, 'main.ts', "import './dist/Case';\n");
  await write(root, 'dist/Case.ts', 'export const target = true;\n');
  if (process.platform !== 'win32')
    await write(root, 'dist/case.ts', 'export const target = true;\n');
  await index(root);
  const stored = await sidecar(root);
  const edge = stored.value.graph.unresolvedEdges[0];
  if (!edge) throw new Error('Expected unresolved import');
  expect(edge.target).toBe('dist/Case.ts');
  edge.target = 'dist/case.ts';
  await stored.save();
  expect(await query(root)).toMatchObject({
    status: process.platform === 'win32' ? 'success' : 'stale_edges',
    paths: []
  });
});

it('rejects changed aliases, missing targets and modified importers without inventing an edge', async () => {
  const root = await fixture();
  await write(root, 'main.ts', "import '@generated';\n");
  await write(root, 'dist/first.ts', 'export const target = true;\n');
  await write(root, 'dist/second.ts', 'export const target = true;\n');
  const config = (target: string) =>
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@generated': [target] } } });
  await write(root, 'tsconfig.json', config('dist/first.ts'));
  await index(root);
  expect(await query(root)).toMatchObject({ status: 'success' });
  await write(root, 'tsconfig.json', config('dist/second.ts'));
  expect(await query(root)).toMatchObject({ status: 'stale_edges', paths: [] });
  await write(root, 'tsconfig.json', config('dist/first.ts'));
  await fs.unlink(path.join(root, 'dist/first.ts'));
  expect(await query(root)).toMatchObject({ status: 'stale_edges', paths: [] });
  await write(root, 'dist/first.ts', 'export const target = true;\n');
  await fs.appendFile(path.join(root, 'main.ts'), '// changed importer\n');
  expect(await query(root)).toMatchObject({ status: 'stale_edges', paths: [] });
});

it('keeps target-bearing diagnostic inspections, cached source reads and response bytes bounded', async () => {
  const root = await fixture();
  await write(root, 'main.ts', "import './dist/target';\n".repeat(1100));
  await write(root, 'dist/target.ts', 'export const target = true;\n');
  await index(root);
  const reads = vi.spyOn(fs, 'readFile');
  const resolutions = vi.spyOn(InternalSourceResolver.prototype, 'resolve');
  const result = await query(root);
  expect(result).toMatchObject({
    status: 'success',
    truncated: true,
    outputNote: expect.stringMatching(/inspection/i)
  });
  expect(resolutions).toHaveBeenCalledTimes(1);
  expect(
    reads.mock.calls.filter(([file]) => String(file) === path.join(root, 'main.ts'))
  ).toHaveLength(1);
});

it('includes target identity in the unresolved verification cache key', async () => {
  const root = await fixture();
  await write(root, 'main.ts', "import './dist/target';\n");
  await write(root, 'dist/target.ts', 'export const target = true;\n');
  await index(root);
  const stored = await sidecar(root);
  const edge = stored.value.graph.unresolvedEdges[0];
  if (!edge) throw new Error('Expected unresolved import');
  stored.value.graph.unresolvedEdges.push({ ...edge, target: 'dist/another.ts' });
  await stored.save();
  expect(await query(root)).toMatchObject({
    status: 'stale_edges',
    unresolved: [expect.objectContaining({ target: 'dist/target.ts' })],
    staleUnresolvedEdges: [expect.objectContaining({ target: 'dist/another.ts' })]
  });
});
