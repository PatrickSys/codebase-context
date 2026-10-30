import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import chokidar from 'chokidar';
import { z } from 'zod';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { CodebaseSearcher, type SearchOptions } from '../src/core/search.js';
import { analyzerRegistry } from '../src/core/analyzer-registry.js';
import { GenericAnalyzer } from '../src/analyzers/generic/index.js';
import { startFileWatcher } from '../src/core/file-watcher.js';
import { readReferenceManifest } from '../src/core/manifest.js';
import { readIndexMeta } from '../src/core/index-meta.js';
import { resolveIndexArtifact, withIndexSnapshot } from '../src/core/index-generation.js';
import { IndexCorruptedError } from '../src/errors/index.js';
import { makePaths } from '../src/project-state.js';
import { handle as relationships } from '../src/tools/get-code-relationships.js';
import type { ToolContext } from '../src/tools/types.js';
import * as embeddingProviders from '../src/embeddings/index.js';
import { InternalSourceResolver } from '../src/utils/internal-source-resolver.js';
import * as reranker from '../src/core/reranker.js';
import * as searchQuality from '../src/core/search-quality.js';
import Fuse from 'fuse.js';

const roots: string[] = [];
const RelationshipReply = z
  .object({
    status: z.string(),
    paths: z.array(z.unknown()),
    unresolved: z.array(z.unknown()),
    truncated: z.boolean(),
    outputNote: z.string().optional()
  })
  .passthrough();
const StoredKeyword = z
  .object({
    chunks: z.array(
      z.object({ content: z.string(), metadata: z.record(z.string(), z.unknown()) }).passthrough()
    )
  })
  .passthrough();
beforeAll(() => analyzerRegistry.register(new GenericAnalyzer()));
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('confines watcher exclusions to descendants, including Windows case and different-drive paths', async () => {
  const root = await fixture();
  const watch = vi.spyOn(chokidar, 'watch');
  const stop = startFileWatcher({ rootPath: root, onChanged: () => undefined });
  try {
    const ignored = watch.mock.calls[0]?.[1]?.ignored;
    if (typeof ignored !== 'function')
      throw new Error('Watcher must supply its root-scoped predicate');
    expect(ignored(root)).toBe(false);
    expect(ignored(path.join(root, 'src', 'main.ts'))).toBe(false);
    expect(ignored(path.join(root, 'node_modules', 'nested.ts'))).toBe(true);
    expect(ignored(path.join(root, '..', 'sibling', 'main.ts'))).toBe(true);
    if (process.platform === 'win32') {
      expect(ignored(root.toUpperCase())).toBe(false);
      expect(ignored(path.join(root.toUpperCase(), 'src', 'main.ts'))).toBe(false);
      const drive = path.parse(root).root.toUpperCase().startsWith('C:') ? 'D:' : 'C:';
      expect(ignored(`${drive}\\elsewhere\\main.ts`)).toBe(true);
    }
  } finally {
    await stop();
  }
});

it('rejects a mismatched source manifest before attempting a recorded semantic provider', async () => {
  const root = await fixture();
  await write(root, 'main.ts', 'export const quartzBeacon = true;\n');
  await index(root);
  const meta = await readIndexMeta(root);
  const manifestPath = await resolveIndexArtifact(root, 'manifest.json');
  const original = await fs.readFile(manifestPath);
  const manifest = await readReferenceManifest(root, meta);
  if (manifest.header) manifest.header.buildId = 'foreign';
  meta.artifacts.vectorDb.embeddingEnabled = true;
  await fs.writeFile(path.join(root, '.codebase-context', 'index-meta.json'), JSON.stringify(meta));
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const provider = vi
    .spyOn(embeddingProviders, 'getEmbeddingProvider')
    .mockRejectedValue(new Error('Controlled unavailable model; no network'));
  await expect(new CodebaseSearcher(root).initialize()).rejects.toBeInstanceOf(IndexCorruptedError);
  expect(provider).not.toHaveBeenCalled();
  await fs.writeFile(manifestPath, original);
  await new CodebaseSearcher(root).initialize();
  expect(provider).toHaveBeenCalledTimes(1);
});

it('keeps exact candidate bodies through real keyword rescue and test fallback, then a reranker permutation', async () => {
  const root = await fixture();
  await write(
    root,
    'main.ts',
    'function start(){ before(); const hooks={onReady:()=>routing()}; after(); }\n'
  );
  await write(
    root,
    'main.test.ts',
    'function check(){ beforeTest(); const hooks={onReady:()=>routing()}; afterTest(); }\n'
  );
  await index(root);
  const meta = await readIndexMeta(root);
  // Admit the reranking path while making model initialization fail without any
  // network/storage request. Actual file indexing and keyword retrieval are real.
  meta.artifacts.vectorDb.embeddingEnabled = true;
  await fs.writeFile(path.join(root, '.codebase-context', 'index-meta.json'), JSON.stringify(meta));
  vi.spyOn(embeddingProviders, 'getEmbeddingProvider').mockRejectedValue(
    new Error('Controlled unavailable model')
  );
  vi.spyOn(searchQuality, 'assessSearchQuality').mockReturnValue({
    status: 'low_confidence',
    confidence: 0,
    signals: ['Controlled branch selection']
  });
  const queries = vi.spyOn(Fuse.prototype, 'search');
  const rerank = vi
    .spyOn(reranker, 'rerank')
    .mockImplementation(async (_query, candidates) => candidates.slice().reverse());
  const result = await new CodebaseSearcher(root).searchWithCoverage('routing', 5, undefined, {
    ...options,
    enableLowConfidenceRescue: true,
    enableReranker: true
  });
  expect(rerank).toHaveBeenCalledTimes(1);
  expect(
    queries.mock.calls.some(
      ([query]) => typeof query === 'string' && query !== 'routing' && query.includes('routing')
    )
  ).toBe(true);
  expect(result.results.map((hit) => path.basename(hit.filePath)).sort()).toEqual([
    'main.test.ts',
    'main.ts'
  ]);
  for (const hit of result.results) {
    expect(hit.metadata.symbolName).toBe('onReady');
    expect(hit.snippet).toBe('onReady:()=>routing()');
  }
});

it('serves a complete legacy fixed layout with a matching header and rejects a later mixed manifest', async () => {
  const root = await fixture();
  await write(root, 'main.ts', 'export const quartzBeacon = true;\n');
  await index(root);
  const meta = await readIndexMeta(root);
  const context = path.join(root, '.codebase-context');
  for (const artifact of Object.values(meta.artifacts)) {
    if (!artifact) continue;
    const original = path.join(context, artifact.path);
    artifact.path = path.basename(artifact.path);
    await fs.cp(original, path.join(context, artifact.path), { recursive: true });
  }
  await fs.writeFile(path.join(context, 'index-meta.json'), JSON.stringify(meta));
  const result = await new CodebaseSearcher(root).search('quartzBeacon', 5, undefined, options);
  expect(result.length).toBeGreaterThan(0);
  const manifest = await readReferenceManifest(root, meta);
  if (manifest.header) manifest.header.buildId = 'another-legacy-build';
  await fs.writeFile(path.join(context, 'manifest.json'), JSON.stringify(manifest));
  await expect(new CodebaseSearcher(root).initialize()).rejects.toBeInstanceOf(IndexCorruptedError);
});

it.each(['escaping-path', 'malformed-date', 'missing-file'])(
  'rejects a %s source manifest with current build identity',
  async (variant) => {
    const root = await fixture();
    await write(root, 'main.ts', 'export const quartzBeacon = true;\n');
    await index(root);
    const meta = await readIndexMeta(root);
    const manifest = await readReferenceManifest(root, meta);
    const manifestPath = await resolveIndexArtifact(root, 'manifest.json');
    if (variant === 'missing-file') await fs.unlink(manifestPath);
    else {
      if (variant === 'escaping-path') manifest.files['../outside.ts'] = '0123456789abcdef';
      else manifest.generatedAt = 'not a timestamp';
      await fs.writeFile(manifestPath, JSON.stringify(manifest));
    }
    await expect(new CodebaseSearcher(root).initialize()).rejects.toBeInstanceOf(
      IndexCorruptedError
    );
  }
);

async function graphQuery(rootPath: string) {
  const ctx: ToolContext = {
    rootPath,
    paths: makePaths(rootPath),
    indexState: { status: 'ready' },
    performIndexing: () => undefined
  };
  const response = await relationships({ file: 'main.ts', direction: 'outgoing' }, ctx);
  return RelationshipReply.parse(JSON.parse(response.content[0]?.text ?? '{}'));
}

it('rechecks aliases and extension priority without changes to importer bytes', async () => {
  const root = await fixture();
  await write(root, 'main.ts', "import '@late';\nimport './choice';\n");
  await write(
    root,
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@late': ['absent.ts'] } } })
  );
  await write(root, 'target.ts', 'export const target = true;\n');
  await write(root, 'choice.tsx', 'export const choice = true;\n');
  await index(root);
  expect(await graphQuery(root)).toMatchObject({ status: 'success' });
  await write(
    root,
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@late': ['target.ts'] } } })
  );
  await write(root, 'choice.ts', 'export const alternate = true;\n');
  expect(await graphQuery(root)).toMatchObject({
    status: 'stale_edges',
    paths: [],
    staleUnresolvedEdges: [expect.objectContaining({ source: { line: 1, specifier: '@late' } })]
  });
  await index(root);
  expect(await graphQuery(root)).toMatchObject({ status: 'success', unresolved: [] });
});

it('does not call an outside-root target current when it appears through a directory link', async () => {
  const base = await fixture();
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await write(root, 'main.ts', "import './linked/target';\n");
  await write(outside, 'target.ts', 'export const outside = true;\n');
  await index(root);
  expect(await graphQuery(root)).toMatchObject({
    status: 'success',
    unresolved: [expect.objectContaining({ reason: 'not-found' })]
  });
  await fs.symlink(outside, path.join(root, 'linked'), 'junction');
  expect(await graphQuery(root)).toMatchObject({
    status: 'stale_edges',
    paths: [],
    unresolved: []
  });
});

it('resolves repeated unresolved proofs once per operation and observes later appearance', async () => {
  const root = await fixture();
  await write(root, 'main.ts', "import './missing';\nimport './missing';\n");
  await index(root);
  const resolve = vi.spyOn(InternalSourceResolver.prototype, 'resolve');
  expect(await graphQuery(root)).toMatchObject({ status: 'success' });
  expect(resolve).toHaveBeenCalledTimes(1);
  resolve.mockClear();
  await write(root, 'missing.ts', 'export const available = true;\n');
  expect(await graphQuery(root)).toMatchObject({ status: 'stale_edges', paths: [] });
  expect(resolve).toHaveBeenCalledTimes(1);
});

it('checks only the unresolved candidates already admitted by the shared inspection allowance', async () => {
  const root = await fixture();
  await write(
    root,
    'main.ts',
    Array.from({ length: 1005 }, (_, n) => `import './missing${n}';`).join('\n')
  );
  await index(root);
  const resolve = vi.spyOn(InternalSourceResolver.prototype, 'resolve');
  const result = await graphQuery(root);
  expect(resolve).toHaveBeenCalledTimes(1000);
  expect(result).toMatchObject({ status: 'success', truncated: true });
  expect(result.outputNote).toContain('inspection budget');
  expect(result.unresolved.length).toBeLessThanOrEqual(20);
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-review-repair-'));
  roots.push(root);
  return root;
}
async function write(root: string, file: string, content: string) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
}
function index(rootPath: string) {
  return new CodebaseIndexer({
    rootPath,
    config: { skipEmbedding: true },
    projectOptions: { preferredAnalyzer: 'generic' }
  }).index();
}
const options: SearchOptions = {
  useSemanticSearch: false,
  useKeywordSearch: true,
  enableQueryExpansion: false,
  enableLowConfidenceRescue: false,
  enableReranker: false,
  profile: 'explore'
};

it.each(['clean-first', 'forged-first'])(
  'rejects a forged sibling after source caching (%s)',
  async (order) => {
    const root = await fixture();
    await write(
      root,
      'main.ts',
      'function first(){const hooks={quartzBeacon:()=>readFirst()};}\nfunction second(){const hooks={quartzBeacon:()=>readSecond()};}\n'
    );
    await index(root);
    const file = await resolveIndexArtifact(root, 'index.json');
    const stored = StoredKeyword.parse(JSON.parse(await fs.readFile(file, 'utf8')));
    const callbacks = stored.chunks.filter((chunk) => chunk.metadata.symbolName === 'quartzBeacon');
    expect(callbacks).toHaveLength(2);
    const forged = callbacks.find((chunk) => chunk.content.includes('readSecond'));
    if (!forged) throw Error('Actual analyzer must produce the second callback');
    forged.content = '// forged context\n' + forged.content;
    if (order === 'forged-first') stored.chunks.reverse();
    const bytes = JSON.stringify(stored);
    await fs.writeFile(file, bytes);
    await expect(
      new CodebaseSearcher(root).search('quartzBeacon', 5, undefined, options)
    ).rejects.toBeInstanceOf(IndexCorruptedError);
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  }
);

it('keeps valid presentation context in metadata separate from exact partial source bodies', async () => {
  const root = await fixture();
  await write(
    root,
    'main.ts',
    'function start(){ before(); const hooks={quartzBeacon:()=>openQueue("雪")}; after(); }\r\n'
  );
  await index(root);
  const file = await resolveIndexArtifact(root, 'index.json');
  const stored = StoredKeyword.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  for (const chunk of stored.chunks)
    chunk.metadata.scopeContext = '// indexing-only signature header';
  await fs.writeFile(file, JSON.stringify(stored));
  const result = await new CodebaseSearcher(root).search('quartzBeacon', 5, undefined, options);
  expect(result[0]?.metadata.scopeContext).toBe('// indexing-only signature header');
  expect(result[0]?.snippet).toBe('quartzBeacon:()=>openQueue("雪")');
});

it.each(['worktrees', '.worktrees', 'build', 'selected-root-is-build'])(
  'watches the selected project despite excluded ancestor %s, but excludes internal build',
  async (name) => {
    const base = await fixture();
    const root =
      name === 'selected-root-is-build'
        ? path.join(base, 'build')
        : path.join(base, name, 'project');
    await write(root, 'main.ts', 'export const before = 1;\n');
    await write(root, 'build/internal.ts', 'export const excluded = 1;\n');
    const ready = Promise.withResolvers<void>();
    const changed = Promise.withResolvers<void>();
    let changes = 0;
    const stop = startFileWatcher({
      rootPath: root,
      debounceMs: 20,
      onReady: ready.resolve,
      onChanged: () => {
        changes++;
        changed.resolve();
      }
    });
    try {
      await ready.promise;
      await write(root, 'main.ts', 'export const after = 2;\n');
      const observed = await Promise.race([
        changed.promise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500))
      ]);
      expect(observed).toBe(true);
      await write(root, 'build/internal.ts', 'export const excluded = 2;\n');
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(changes).toBe(1);
    } finally {
      await stop();
    }
  }
);

it('retains the exact same-line callback owner body and abstains after drift/deletion', async () => {
  const root = await fixture();
  const source =
    'function start(){ before(); const hooks={onReady:()=>openQueue()}; after(); }\r\nfunction again(){ beforeAgain(); const hooks={onReady:()=>openAgain("雪")}; afterAgain(); }\r\n';
  await write(root, 'main.ts', source);
  await index(root);
  const searcher = new CodebaseSearcher(root);
  for (const [query, owner, expected] of [
    ['openQueue', 'start', 'onReady:()=>openQueue()'],
    ['openAgain', 'again', 'onReady:()=>openAgain("雪")']
  ]) {
    const result = await searcher.searchWithCoverage(query, 5, undefined, options);
    expect(result.sourceCoverage.status).toBe('current');
    expect(result.results[0]?.metadata.symbolPath).toContain(owner);
    expect(result.results[0]?.snippet).toBe(expected);
  }
  await write(root, 'main.ts', source.replace('openQueue()', 'changedQueue()'));
  expect(
    (await searcher.searchWithCoverage('openQueue', 5, undefined, options)).sourceCoverage.status
  ).toBe('no_fresh_results');
  await fs.unlink(path.join(root, 'main.ts'));
  expect((await searcher.searchWithCoverage('openAgain', 5, undefined, options)).results).toEqual(
    []
  );
});

it.each(['foreign', 'missing', 'wrong-format'])(
  'rejects a %s manifest header even when every current source hash matches',
  async (variant) => {
    const root = await fixture();
    await write(root, 'main.ts', 'export function quartzBeacon() { return "alive"; }\n');
    await index(root);
    const meta = await readIndexMeta(root);
    const manifest = await readReferenceManifest(root, meta);
    if (variant === 'missing') delete manifest.header;
    else if (manifest.header) {
      if (variant === 'foreign') manifest.header.buildId = 'another-generation';
      else manifest.header.formatVersion--;
    }
    await fs.writeFile(await resolveIndexArtifact(root, 'manifest.json'), JSON.stringify(manifest));
    await expect(
      new CodebaseSearcher(root).search('quartzBeacon', 5, undefined, options)
    ).rejects.toBeInstanceOf(IndexCorruptedError);
  }
);

it('keeps manifest reads pinned during publication and refreshes an existing searcher on its next operation', async () => {
  const root = await fixture();
  await write(root, 'main.ts', 'export const quartzBeacon = 1;\n');
  await index(root);
  const searcher = new CodebaseSearcher(root);
  expect((await searcher.search('quartzBeacon', 5, undefined, options)).length).toBeGreaterThan(0);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const reader = withIndexSnapshot(root, async () => {
    const old = await readIndexMeta(root);
    entered.resolve();
    await release.promise;
    expect((await readReferenceManifest(root, old)).header?.buildId).toBe(old.buildId);
  });
  try {
    await entered.promise;
    await write(root, 'main.ts', 'export const newBeacon = 2;\n');
    await index(root);
    const current = await readIndexMeta(root);
    const manifest = await readReferenceManifest(root, current);
    if (manifest.header) manifest.header.buildId = 'mixed-new-manifest';
    await fs.writeFile(await resolveIndexArtifact(root, 'manifest.json'), JSON.stringify(manifest));
    await expect(searcher.search('newBeacon', 5, undefined, options)).rejects.toBeInstanceOf(
      IndexCorruptedError
    );
  } finally {
    release.resolve();
    await reader;
  }
});

it.each([
  { specifier: './missing', target: 'missing.ts' },
  { specifier: './missing', target: 'missing.tsx' },
  { specifier: './missing.js', target: 'missing.ts' }
])(
  'marks an unresolved $specifier stale when $target appears, then follows it only after refresh',
  async ({ specifier, target }) => {
    const root = await fixture();
    await write(root, 'main.ts', `import '${specifier}';\nexport const value = true;\n`);
    await index(root);
    const query = () => graphQuery(root);
    expect(await query()).toMatchObject({
      status: 'success',
      paths: [],
      unresolved: [expect.objectContaining({ reason: 'not-found' })]
    });
    await write(root, target, 'export const target = true;\n');
    expect(await query()).toMatchObject({
      status: 'stale_edges',
      paths: [],
      unresolved: [],
      staleUnresolvedEdges: [expect.objectContaining({ reason: 'not-found' })]
    });
    await index(root);
    expect(await query()).toMatchObject({
      status: 'success',
      paths: [expect.objectContaining({ nodes: ['main.ts', target] })],
      unresolved: []
    });
    await fs.unlink(path.join(root, target));
    expect(await query()).toMatchObject({ status: 'stale_edges', paths: [] });
  }
);
