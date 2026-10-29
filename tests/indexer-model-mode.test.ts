import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import structuralFixture from './fixtures/structural-context-regressions.json';
import type { CodeChunk } from '../src/types/index.js';
import {
  resolveSkipEmbedding,
  checkEmbeddingMismatch,
  type IndexMeta
} from '../src/core/index-meta.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  HEALTH_FILENAME,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  MANIFEST_FILENAME,
  RELATIONSHIPS_FILENAME,
  VECTOR_DB_DIRNAME
} from '../src/constants/codebase-context.js';

const { embeddingInit, storageInit, embeddingRuntimeAssert, storageRuntimeAssert, rerankInit } =
  vi.hoisted(() => ({
    embeddingInit: vi.fn(),
    storageInit: vi.fn(),
    embeddingRuntimeAssert: vi.fn(),
    storageRuntimeAssert: vi.fn(),
    rerankInit: vi.fn(async (_query: string, results: unknown) => results)
  }));
vi.mock('../src/embeddings/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/embeddings/index.js')>();
  return {
    ...actual,
    assertEmbeddingRuntimeAvailable: embeddingRuntimeAssert,
    getEmbeddingProvider: embeddingInit
  };
});
vi.mock('../src/storage/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/storage/index.js')>();
  return {
    ...actual,
    assertStorageRuntimeAvailable: storageRuntimeAssert,
    getStorageProvider: storageInit
  };
});
vi.mock('../src/core/reranker.js', () => ({
  rerank: rerankInit,
  getRerankerStatus: vi.fn(() => 'fallback')
}));

import { CodebaseSearcher } from '../src/core/search.js';
import { CodebaseIndexer } from '../src/core/indexer.js';

describe('persisted embedding mode', () => {
  let rootPath: string | undefined;

  async function retainLegacyFormat(legacyRoot: string, formatVersion: number): Promise<IndexMeta> {
    const contextDir = path.join(legacyRoot, CODEBASE_CONTEXT_DIRNAME);
    const metaPath = path.join(contextDir, INDEX_META_FILENAME);
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as IndexMeta;
    meta.formatVersion = formatVersion;
    await fs.writeFile(metaPath, JSON.stringify(meta));
    for (const filename of [
      KEYWORD_INDEX_FILENAME,
      INTELLIGENCE_FILENAME,
      RELATIONSHIPS_FILENAME,
      HEALTH_FILENAME,
      MANIFEST_FILENAME
    ]) {
      const artifactPath = path.join(contextDir, filename);
      const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8')) as {
        header: { formatVersion: number };
      };
      artifact.header.formatVersion = formatVersion;
      await fs.writeFile(artifactPath, JSON.stringify(artifact));
    }
    await fs.writeFile(
      path.join(contextDir, VECTOR_DB_DIRNAME, 'index-build.json'),
      JSON.stringify({ buildId: meta.buildId, formatVersion })
    );
    return meta;
  }

  afterEach(async () => {
    if (rootPath) await fs.rm(rootPath, { recursive: true, force: true });
    rootPath = undefined;
  });

  it('defaults a genuinely fresh folder to model-free and honors explicit semantic opt-in', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-mode-fresh-'));
    await expect(resolveSkipEmbedding(rootPath)).resolves.toBe(true);
    await expect(resolveSkipEmbedding(rootPath, false)).resolves.toBe(false);
  });

  it.each([1, 2, 3])(
    'preserves a format-%i recorded semantic or model-free mode when no choice is supplied',
    async (formatVersion) => {
      rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-mode-existing-'));
      await fs.mkdir(path.join(rootPath, '.codebase-context'), { recursive: true });
      const writeMeta = async (embeddingEnabled: boolean): Promise<void> => {
        const meta: IndexMeta = {
          metaVersion: 1,
          formatVersion,
          buildId: 'build-1',
          generatedAt: new Date().toISOString(),
          toolVersion: '1.0.0',
          artifacts: {
            keywordIndex: { path: 'index.json' },
            vectorDb: {
              path: 'vector-db',
              provider: 'lancedb',
              embeddingProvider: 'transformers',
              embeddingModel: 'Xenova/bge-small-en-v1.5',
              embeddingEnabled
            }
          }
        };
        await fs.writeFile(
          path.join(rootPath!, '.codebase-context', 'index-meta.json'),
          JSON.stringify(meta)
        );
      };

      await writeMeta(false);
      await expect(resolveSkipEmbedding(rootPath)).resolves.toBe(true);
      await expect(resolveSkipEmbedding(rootPath, false)).resolves.toBe(false);
      await writeMeta(true);
      await expect(resolveSkipEmbedding(rootPath)).resolves.toBe(false);
    }
  );

  it('fails closed when index artifacts exist but mode metadata cannot be read', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-mode-corrupt-'));
    const contextDir = path.join(rootPath, '.codebase-context');
    await fs.mkdir(contextDir);
    await fs.writeFile(path.join(contextDir, 'index.json'), '{}');
    await expect(resolveSkipEmbedding(rootPath)).rejects.toThrow(/Cannot recover embedding mode/);
    await expect(resolveSkipEmbedding(rootPath, true)).resolves.toBe(true);
  });

  it('fails closed on unknown state under the index directory but accepts memory-only state', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-mode-unknown-'));
    const contextDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(contextDir);
    await fs.writeFile(path.join(contextDir, 'unrecognized-state.json'), '{}');
    await expect(resolveSkipEmbedding(rootPath)).rejects.toThrow(/Cannot recover embedding mode/);

    await fs.rm(contextDir, { recursive: true, force: true });
    await fs.mkdir(contextDir);
    await fs.writeFile(path.join(contextDir, 'memory.json'), '{}');
    await expect(resolveSkipEmbedding(rootPath)).resolves.toBe(true);
  });

  it('forces rebuilds when enabled state changes, while mode-free provider changes do not matter', () => {
    const meta = {
      metaVersion: 1,
      formatVersion: 1,
      buildId: 'build-1',
      generatedAt: new Date().toISOString(),
      toolVersion: '1.0.0',
      artifacts: {
        keywordIndex: { path: 'index.json' },
        vectorDb: {
          path: 'vector-db',
          provider: 'lancedb',
          embeddingEnabled: false
        }
      }
    } satisfies IndexMeta;
    expect(checkEmbeddingMismatch(meta, 'openai', 'some-model', false)).toBe(false);
    expect(checkEmbeddingMismatch(meta, 'transformers', 'some-model', true)).toBe(true);
  });

  it('initializes keyword search without embedding or vector storage in model-free mode', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-search-model-free-'));
    const contextDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
    const vectorDir = path.join(contextDir, VECTOR_DB_DIRNAME);
    const buildId = 'model-free-build';
    await fs.mkdir(vectorDir, { recursive: true });
    await fs.writeFile(
      path.join(contextDir, KEYWORD_INDEX_FILENAME),
      JSON.stringify({ header: { buildId, formatVersion: INDEX_FORMAT_VERSION }, chunks: [] })
    );
    await fs.writeFile(
      path.join(contextDir, INTELLIGENCE_FILENAME),
      JSON.stringify({ header: { buildId, formatVersion: INDEX_FORMAT_VERSION }, patterns: {} })
    );
    await fs.writeFile(
      path.join(contextDir, MANIFEST_FILENAME),
      JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), files: {} })
    );
    await fs.writeFile(
      path.join(vectorDir, 'index-build.json'),
      JSON.stringify({ buildId, formatVersion: INDEX_FORMAT_VERSION })
    );
    await fs.writeFile(
      path.join(contextDir, INDEX_META_FILENAME),
      JSON.stringify({
        metaVersion: INDEX_META_VERSION,
        formatVersion: INDEX_FORMAT_VERSION,
        buildId,
        generatedAt: new Date().toISOString(),
        toolVersion: '1.0.0',
        artifacts: {
          keywordIndex: { path: KEYWORD_INDEX_FILENAME },
          vectorDb: {
            path: VECTOR_DB_DIRNAME,
            provider: 'lancedb',
            embeddingEnabled: false
          }
        }
      })
    );

    const searcher = new CodebaseSearcher(rootPath);
    await searcher.initialize();
    await searcher.search('source', 5, undefined, {
      useSemanticSearch: true,
      enableReranker: true
    });
    expect(embeddingInit).not.toHaveBeenCalled();
    expect(storageInit).not.toHaveBeenCalled();
    expect(rerankInit).not.toHaveBeenCalled();
  });

  it('indexes real source by default and preserves the model-free mode on rebuild', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-index-model-free-'));
    const sourcePath = path.join(rootPath, 'source.ts');
    await fs.writeFile(sourcePath, 'export const sourcePreserved = "original source";\n');

    const first = new CodebaseIndexer({ rootPath });
    const firstStats = await first.index();
    expect(firstStats.errors).toEqual([]);

    const contextDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
    const firstMeta = JSON.parse(
      await fs.readFile(path.join(contextDir, INDEX_META_FILENAME), 'utf8')
    ) as { artifacts: { vectorDb: { embeddingEnabled: boolean } } };
    expect(firstMeta.artifacts.vectorDb.embeddingEnabled).toBe(false);
    expect(embeddingRuntimeAssert).not.toHaveBeenCalled();
    expect(storageRuntimeAssert).not.toHaveBeenCalled();
    expect(embeddingInit).not.toHaveBeenCalled();
    const indexPath = path.join(contextDir, KEYWORD_INDEX_FILENAME);
    const initialIndex = await fs.readFile(indexPath, 'utf8');
    expect(initialIndex).toContain('original source');

    await fs.writeFile(sourcePath, 'export const sourcePreserved = "updated source";\n');
    const second = new CodebaseIndexer({ rootPath });
    const secondStats = await second.index();
    expect(secondStats.errors).toEqual([]);
    const secondMeta = JSON.parse(
      await fs.readFile(path.join(contextDir, INDEX_META_FILENAME), 'utf8')
    ) as { artifacts: { vectorDb: { embeddingEnabled: boolean } } };
    expect(secondMeta.artifacts.vectorDb.embeddingEnabled).toBe(false);
    const rebuiltIndex = await fs.readFile(indexPath, 'utf8');
    expect(rebuiltIndex).toContain('updated source');
    expect(rebuiltIndex).not.toContain('original source');
    expect(embeddingInit).not.toHaveBeenCalled();
  }, 60000);

  it('persists exact raw AST bodies, keeps same-line siblings separate, and preserves prefix-like source comments', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-raw-ast-'));
    const fixture = structuralFixture.cases.find(
      (item) => item.id === 'same-line-property-callback-bodies-stay-distinct'
    );
    expect(fixture).toBeDefined();
    await fs.writeFile(path.join(rootPath, 'handlers.js'), fixture!.source);
    const commented = 'function consume() {\n// consume :: ()\n  consumeMessage();\n}\n';
    await fs.writeFile(path.join(rootPath, 'consume.js'), commented);
    await new CodebaseIndexer({ rootPath }).index();
    const persisted = JSON.parse(
      await fs.readFile(
        path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME),
        'utf8'
      )
    ) as { chunks: CodeChunk[] };
    for (const fact of fixture!.sourceSymbols) {
      const own = persisted.chunks.filter(
        (chunk) => JSON.stringify(chunk.metadata.symbolPath) === JSON.stringify(fact.ownerChain)
      );
      expect(own.length).toBeGreaterThan(0);
      for (const marker of fact.bodyMarkers)
        expect(own.some((chunk) => chunk.content.includes(marker))).toBe(true);
      for (const chunk of own) {
        expect(fixture!.source).toContain(chunk.content);
        if ('forbiddenSiblingBodyMarkers' in fact) {
          for (const marker of fact.forbiddenSiblingBodyMarkers ?? [])
            expect(chunk.content).not.toContain(marker);
        }
      }
    }
    const consume = persisted.chunks.find((chunk) => chunk.metadata.symbolName === 'consume');
    expect(consume).toBeDefined();
    expect(consume!.content).toBe(commented.trimEnd());
    expect(consume!.content.match(/\/\/ consume :: \(\)/g)).toHaveLength(1);
  }, 60000);

  it('persists concise descriptor implementations under their nearest static owner', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-concise-descriptor-'));
    const source =
      'function createHandlers() { return { shutdown: { value() { closeConnections(); } }, state: { get() { return readState(); }, set: next => writeState(next) }, sibling: { value() { reloadConnections(); } } }; }';
    await fs.writeFile(path.join(rootPath, 'handlers.js'), source);
    await new CodebaseIndexer({ rootPath }).index();
    const persisted = JSON.parse(
      await fs.readFile(
        path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME),
        'utf8'
      )
    ) as { chunks: CodeChunk[] };
    for (const fact of [
      {
        name: 'shutdown',
        body: 'shutdown: { value() { closeConnections(); } }',
        forbidden: ['readState()', 'reloadConnections()']
      },
      {
        name: 'state',
        body: 'state: { get() { return readState(); }, set: next => writeState(next) }',
        forbidden: ['closeConnections()', 'reloadConnections()']
      }
    ]) {
      const own = persisted.chunks.filter((chunk) => chunk.metadata.symbolName === fact.name);
      expect(own).toHaveLength(1);
      expect(own[0].content).toBe(fact.body);
      expect(own[0].metadata.symbolPath).toEqual(['createHandlers', fact.name]);
      for (const marker of fact.forbidden) expect(own[0].content).not.toContain(marker);
    }
  }, 60000);

  it.each([1, 2, 3])(
    'rebuilds an otherwise consistent format-%i index on an unchanged incremental pass',
    async (formatVersion) => {
      rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-format-recovery-'));
      await fs.writeFile(
        path.join(rootPath, 'source.ts'),
        'export function handle() { return dispatch(); }\n'
      );
      await new CodebaseIndexer({ rootPath }).index();
      const contextDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
      const metaPath = path.join(contextDir, INDEX_META_FILENAME);
      const oldMeta = await retainLegacyFormat(rootPath, formatVersion);
      await expect(resolveSkipEmbedding(rootPath)).resolves.toBe(true);
      const stats = await new CodebaseIndexer({ rootPath, incrementalOnly: true }).index();
      expect(stats.errors).toEqual([]);
      const rebuilt = JSON.parse(await fs.readFile(metaPath, 'utf8')) as IndexMeta;
      expect(rebuilt.formatVersion).toBe(4);
      expect(rebuilt.buildId).not.toBe(oldMeta.buildId);
      expect(rebuilt.artifacts.vectorDb.embeddingEnabled).toBe(false);
    },
    60000
  );

  it.each([1, 2, 3])(
    'preserves a format-%i successful index when semantic migration opt-in cannot initialize',
    async (formatVersion) => {
      rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-format-atomic-'));
      await fs.writeFile(
        path.join(rootPath, 'source.ts'),
        'export function handle() { return dispatch(); }\n'
      );
      await new CodebaseIndexer({ rootPath }).index();
      const contextDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
      const metaPath = path.join(contextDir, INDEX_META_FILENAME);
      await retainLegacyFormat(rootPath, formatVersion);
      const originalMeta = await fs.readFile(metaPath, 'utf8');
      const originalIndex = await fs.readFile(
        path.join(contextDir, KEYWORD_INDEX_FILENAME),
        'utf8'
      );
      await expect(resolveSkipEmbedding(rootPath)).resolves.toBe(true);
      const unavailable = new Error('migration semantic runtime unavailable');
      embeddingRuntimeAssert.mockImplementationOnce(() => {
        throw unavailable;
      });
      await expect(
        new CodebaseIndexer({
          rootPath,
          incrementalOnly: true,
          config: { skipEmbedding: false }
        }).index()
      ).rejects.toBe(unavailable);
      expect(await fs.readFile(metaPath, 'utf8')).toBe(originalMeta);
      expect(await fs.readFile(path.join(contextDir, KEYWORD_INDEX_FILENAME), 'utf8')).toBe(
        originalIndex
      );
    },
    60000
  );

  it('checks semantic dependencies before creating or replacing index artifacts', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-semantic-runtime-'));
    await fs.writeFile(path.join(rootPath, 'source.ts'), 'export const source = 1;\n');
    const missingRuntime = new Error('semantic dependency unavailable');
    embeddingRuntimeAssert.mockImplementationOnce(() => {
      throw missingRuntime;
    });

    const indexer = new CodebaseIndexer({ rootPath, config: { skipEmbedding: false } });
    await expect(indexer.index()).rejects.toBe(missingRuntime);
    await expect(fs.access(path.join(rootPath, CODEBASE_CONTEXT_DIRNAME))).rejects.toMatchObject({
      code: 'ENOENT'
    });
    expect(storageRuntimeAssert).not.toHaveBeenCalled();
  });

  it('binds the manifest digest to the exact bytes analyzed, even if the file changes during analysis', async () => {
    // Frozen S2 regression: analyzer receives snapshot A, source changes to B before publish.
    // The manifest must not certify stale chunks as if they came from B.
    const { analyzerRegistry } = await import('../src/core/analyzer-registry.js');
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-manifest-snapshot-'));
    const sourcePath = path.join(rootPath, 'snapshot.ts');
    const analyzed = 'export const snapshotTarget = "A";\n';
    const changed = 'export const replacementTarget = "B";\n';
    await fs.writeFile(sourcePath, analyzed);
    const original = analyzerRegistry.analyzeFile.bind(analyzerRegistry);
    const spy = vi.spyOn(analyzerRegistry, 'analyzeFile').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[0] === sourcePath) await fs.writeFile(sourcePath, changed);
      return result;
    });
    try {
      await new CodebaseIndexer({ rootPath }).index();
    } finally {
      spy.mockRestore();
    }
    const manifest = JSON.parse(
      await fs.readFile(path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME), 'utf8')
    ) as { files: Record<string, string> };
    const expected = (await import('node:crypto'))
      .createHash('sha256')
      .update(analyzed)
      .digest('hex')
      .slice(0, 16);
    expect(manifest.files['snapshot.ts']).toBe(expected);
  });

  it('fails an incremental build when a pre-hashed unchanged file drifts before analysis', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-incremental-snapshot-'));
    const triggerPath = path.join(rootPath, 'a-trigger.ts');
    const unchangedPath = path.join(rootPath, 'z-unchanged.ts');
    await fs.writeFile(triggerPath, 'export const trigger = 1;\n');
    await fs.writeFile(unchangedPath, 'export const stableTarget = "old";\n');
    await new CodebaseIndexer({ rootPath }).index();
    const metaPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, INDEX_META_FILENAME);
    const priorMeta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as { buildId: string };

    await fs.writeFile(triggerPath, 'export const trigger = 2;\n');
    let mutated = false;
    await expect(
      new CodebaseIndexer({
        rootPath,
        incrementalOnly: true,
        onProgress: (progress) => {
          if (progress.phase === 'analyzing' && !mutated) {
            mutated = true;
            writeFileSync(unchangedPath, 'export const replacementTarget = "new";\n');
          }
        }
      }).index()
    ).rejects.toThrow(/Source changed during incremental scan/);
    expect(mutated).toBe(true);
    const currentMeta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as { buildId: string };
    expect(currentMeta.buildId).toBe(priorMeta.buildId);
  }, 60000);
});
