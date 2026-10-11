import { afterAll, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { CODEBASE_CONTEXT_DIRNAME, RELATIONSHIPS_FILENAME } from '../src/constants/codebase-context.js';
import { handle as getCodeRelationships } from '../src/tools/get-code-relationships.js';
import type { ToolContext } from '../src/tools/types.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-graph-integration-'));
afterAll(async () => fs.rm(root, { recursive: true, force: true }));

async function write(relative: string, content: string): Promise<void> {
  const fullPath = path.join(root, relative);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
}

async function readGraph(): Promise<{ header: { buildId: string }; graph: { imports: Record<string, string[]>; importDetails: Record<string, Record<string, { sources?: Array<{ kind: string; specifier: string; sourceFingerprint: string; targetFingerprint: string }> }>>; unresolvedEdges?: Array<{ source: { specifier: string }; reason: string }> } }> {
  return JSON.parse(await fs.readFile(path.join(root, CODEBASE_CONTEXT_DIRNAME, RELATIONSHIPS_FILENAME), 'utf8')) as {
    header: { buildId: string };
    graph: { imports: Record<string, string[]>; importDetails: Record<string, Record<string, { sources?: Array<{ kind: string; specifier: string; sourceFingerprint: string; targetFingerprint: string }> }>>; unresolvedEdges?: Array<{ source: { specifier: string }; reason: string }> };
  };
}

function context(): ToolContext {
  const contextDir = path.join(root, CODEBASE_CONTEXT_DIRNAME);
  return {
    rootPath: root,
    paths: {
      baseDir: contextDir,
      intelligence: path.join(contextDir, 'intelligence.json'),
      memory: path.join(contextDir, 'memory.json'),
      health: path.join(contextDir, 'health.json'),
      keywordIndex: path.join(contextDir, 'keyword-index.json'),
      vectorDb: path.join(contextDir, 'vector-db')
    },
    indexState: { status: 'ready' },
    performIndexing: () => undefined
  };
}

it('resolves source aliases, directory indexes, typed barrels and three hops, then refreshes after delete/rename', async () => {
  await write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@core/*': ['packages/core/src/*'] } } }));
  await write('src/main.ts', "import './barrel';\nimport './present';\nimport './missing';\nimport './dir';\nimport '@core/actual';\nimport 'external-pkg';\n");
  await write('src/barrel.ts', "export { actual } from '@core/actual';\n");
  await write('src/present.tsx', 'export const present = true;\n');
  await write('src/dir/index.ts', 'export const indexed = true;\n');
  await write('packages/core/src/actual.ts', "import './impl';\nexport const actual = true;\n");
  await write('packages/core/src/impl.ts', "import { actual } from '@core/actual';\nexport const impl = actual;\n");

  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
  const graph = await readGraph();
  const main = Object.keys(graph.graph.imports).find((file) => file.endsWith('src/main.ts'));
  expect(main).toBeDefined();
  const targets = graph.graph.imports[main ?? ''] ?? [];
  expect(targets).toContain('src/present.tsx');
  expect(targets).toContain('src/dir/index.ts');
  expect(targets).not.toContain('src/missing.ts');
  expect(graph.graph.unresolvedEdges).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: expect.objectContaining({ specifier: './missing' }), reason: 'not-found' }),
    expect.objectContaining({ source: expect.objectContaining({ specifier: 'external-pkg' }), reason: 'external' })
  ]));
  expect(graph.graph.importDetails['src/barrel.ts']?.['packages/core/src/actual.ts']?.sources?.[0]).toMatchObject({
    kind: 'reexport', specifier: '@core/actual', sourceFingerprint: expect.any(String), targetFingerprint: expect.any(String)
  });

  const response = await getCodeRelationships({ file: 'src/main.ts', direction: 'outgoing', max_hops: 3, max_nodes: 30 }, context());
  const result = JSON.parse(response.content?.[0]?.text ?? '{}') as { status: string; paths: Array<{ nodes: string[] }>; unresolved: unknown[] };
  expect(result.status).toBe('success');
  expect(result.paths.some(({ nodes }) => nodes.join('|') === 'src/main.ts|src/barrel.ts|packages/core/src/actual.ts|packages/core/src/impl.ts')).toBe(true);
  expect(result.unresolved).toHaveLength(2);

  await fs.rename(path.join(root, 'packages/core/src/actual.ts'), path.join(root, 'packages/core/src/actual-renamed.ts'));
  await fs.rm(path.join(root, 'packages/core/src/impl.ts'));
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true }, incrementalOnly: true }).index();
  const refreshed = await readGraph();
  expect(refreshed.header.buildId).not.toBe(graph.header.buildId);
  expect(refreshed.graph.imports['src/barrel.ts'] ?? []).not.toContain('packages/core/src/actual.ts');
  expect(refreshed.graph.unresolvedEdges).toEqual(expect.arrayContaining([
    expect.objectContaining({ from: 'src/barrel.ts', source: expect.objectContaining({ specifier: '@core/actual' }) })
  ]));
});

it('rejects graph edges after either current endpoint changes without reindexing', async () => {
  await Promise.all([
    fs.rm(path.join(root, 'src'), { recursive: true, force: true }),
    fs.rm(path.join(root, 'packages'), { recursive: true, force: true }),
    fs.rm(path.join(root, CODEBASE_CONTEXT_DIRNAME), { recursive: true, force: true }),
    fs.rm(path.join(root, 'tsconfig.json'), { force: true })
  ]);
  await write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@core/*': ['packages/core/src/*'] } } }));
  await write('src/main.ts', "import '@core/actual';\n");
  await write('packages/core/src/actual.ts', 'export const actual = true;\n');
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
  await fs.appendFile(path.join(root, 'packages/core/src/actual.ts'), 'export const changed = true;\n');

  const response = await getCodeRelationships({ file: 'src/main.ts', max_hops: 1 }, context());
  const result = JSON.parse(response.content?.[0]?.text ?? '{}') as { status: string; paths: unknown[]; staleEdges?: unknown[] };
  expect(result.status).toBe('stale_edges');
  expect(result.paths).toHaveLength(0);
  expect(result.staleEdges).toHaveLength(1);

  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
  await fs.appendFile(path.join(root, 'src/main.ts'), '// changed importer\n');
  const changedSourceResponse = await getCodeRelationships({ file: 'src/main.ts', max_hops: 1 }, context());
  const changedSource = JSON.parse(changedSourceResponse.content?.[0]?.text ?? '{}') as {
    status: string; paths: unknown[]; staleEdges?: unknown[];
  };
  expect(changedSource.status).toBe('stale_edges');
  expect(changedSource.paths).toHaveLength(0);
  expect(changedSource.staleEdges).toHaveLength(1);
});

it('marks edges stale when current tsconfig resolution changes or a higher priority target appears', async () => {
  await Promise.all([
    fs.rm(path.join(root, 'src'), { recursive: true, force: true }),
    fs.rm(path.join(root, 'packages'), { recursive: true, force: true }),
    fs.rm(path.join(root, CODEBASE_CONTEXT_DIRNAME), { recursive: true, force: true }),
    fs.rm(path.join(root, 'tsconfig.json'), { force: true })
  ]);
  await write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@core/*': ['packages/core/src/*'] } } }));
  await write('src/main.ts', "import './feature';\nimport '@core/actual';\n");
  await write('src/feature.tsx', 'export const feature = true;\n');
  await write('packages/core/src/actual.ts', 'export const actual = true;\n');
  await write('packages/alternate/src/actual.ts', 'export const actual = false;\n');
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
  const original = await getCodeRelationships({ file: 'src/main.ts', max_hops: 1 }, context());
  expect(JSON.parse(original.content?.[0]?.text ?? '{}')).toMatchObject({ status: 'success' });

  await write('src/feature.ts', 'export const feature = false;\n');
  await write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@core/*': ['packages/alternate/src/*'] } } }));
  const changedResolution = await getCodeRelationships({ file: 'src/main.ts', max_hops: 1 }, context());
  const result = JSON.parse(changedResolution.content?.[0]?.text ?? '{}') as {
    status: string; paths: unknown[]; staleEdges: Array<{ from: string; to: string; specifier: string }>;
  };
  expect(result.status).toBe('stale_edges');
  expect(result.paths).toHaveLength(0);
  expect(result.staleEdges).toEqual(expect.arrayContaining([
    expect.objectContaining({ specifier: './feature', to: 'src/feature.tsx' }),
    expect.objectContaining({ specifier: '@core/actual', to: 'packages/core/src/actual.ts' })
  ]));
});

it('bounds the complete serialized branching response and reports truncation', async () => {
  await Promise.all([
    fs.rm(path.join(root, 'src'), { recursive: true, force: true }),
    fs.rm(path.join(root, CODEBASE_CONTEXT_DIRNAME), { recursive: true, force: true }),
    fs.rm(path.join(root, 'tsconfig.json'), { force: true })
  ]);
  const imports: string[] = [];
  for (let index = 0; index < 36; index += 1) {
    const target = `branch-${String(index).padStart(2, '0')}-long-diagnostic-target-name.ts`;
    imports.push(`import './${target.slice(0, -3)}';`);
    await write(`src/${target}`, `export const branch${index} = ${index};\n`);
  }
  await write('src/main.ts', `${imports.join('\n')}\n`);
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();

  const response = await getCodeRelationships({ file: 'src/main.ts', max_hops: 1, max_nodes: 100 }, context());
  const payload = response.content?.[0]?.text ?? '';
  const result = JSON.parse(payload) as { paths: unknown[]; truncated: boolean };
  expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(4000);
  expect(result.paths.length).toBeGreaterThan(0);
  expect(result.truncated).toBe(true);
});

it('rejects legacy proofless edges and reports a missing sidecar', async () => {
  await Promise.all([
    fs.rm(path.join(root, 'src'), { recursive: true, force: true }),
    fs.rm(path.join(root, CODEBASE_CONTEXT_DIRNAME), { recursive: true, force: true }),
    fs.rm(path.join(root, 'tsconfig.json'), { force: true })
  ]);
  await write('src/from.ts', "import './to';\n");
  await write('src/to.ts', 'export const value = true;\n');
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();

  const sidecarPath = path.join(root, CODEBASE_CONTEXT_DIRNAME, RELATIONSHIPS_FILENAME);
  const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8')) as {
    graph: { imports: Record<string, string[]>; importDetails: Record<string, Record<string, unknown>> };
  };
  sidecar.graph.importDetails = { 'src/from.ts': { 'src/to.ts': {} } };
  await fs.writeFile(sidecarPath, JSON.stringify(sidecar));
  const legacy = await getCodeRelationships({ file: 'src/from.ts', max_hops: 1 }, context());
  expect(JSON.parse(legacy.content?.[0]?.text ?? '{}')).toMatchObject({ status: 'stale_edges', paths: [], truncated: false });

  await fs.rm(sidecarPath);
  const missing = await getCodeRelationships({ file: 'src/from.ts', max_hops: 1 }, context());
  expect(JSON.parse(missing.content?.[0]?.text ?? '{}')).toMatchObject({ status: 'graph_unavailable' });
});
