import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import Fuse, { type IFuseOptions } from 'fuse.js';
import { CodebaseSearcher } from '../src/core/search.js';
import type { CodeChunk } from '../src/types/index.js';
import { asSearcherTestHarness, materializeSourceSnapshot } from './helpers/source-snapshot.js';

interface DensityChunkSpec {
  id: string;
  filePath: string;
  content: string;
  startLine?: number;
  metadata?: CodeChunk['metadata'];
}

interface DensityCase {
  id: string;
  query: string;
  chunks: DensityChunkSpec[];
  expectedIds: string[];
  expectedPathPatterns: string[];
  limitation?: string;
}

interface GeneratedChunkCase {
  count: number;
  idPattern: string;
  filePathPattern: string;
  content: string;
}

interface SourceValidationCase {
  id: string;
  query: string;
  chunks?: DensityChunkSpec[];
  staleChunkGenerator?: GeneratedChunkCase;
  currentChunks?: DensityChunkSpec[];
  mutateFilePath?: string;
  mutateFilePathPattern?: string;
  replacementSource: string;
  expectedIds: string[];
}

interface DensityFixture {
  cases: DensityCase[];
  sourceValidationCases: SourceValidationCase[];
}

interface DensityHarness {
  chunks: CodeChunk[];
  fuseIndex: Fuse<CodeChunk>;
  rescueKeywordMatches: (
    query: string,
    limit: number
  ) => Promise<Array<{ item: CodeChunk; refIndex: number; score?: number }>>;
}

const fixture = JSON.parse(
  await fs.readFile(new URL('./fixtures/search-rescue-density.json', import.meta.url), 'utf8')
) as DensityFixture;

const fuseOptions: IFuseOptions<CodeChunk> = {
  keys: [
    { name: 'content', weight: 0.4 },
    { name: 'metadata.componentName', weight: 0.25 },
    { name: 'filePath', weight: 0.15 },
    { name: 'relativePath', weight: 0.15 },
    { name: 'componentType', weight: 0.15 },
    { name: 'layer', weight: 0.1 },
    { name: 'tags', weight: 0.15 }
  ],
  includeScore: true,
  threshold: 0.4,
  useExtendedSearch: true,
  ignoreLocation: true
};

function makeChunk(spec: DensityChunkSpec, index = 0): CodeChunk {
  const startLine = spec.startLine ?? 1;
  return {
    id: spec.id || `density-${index}`,
    filePath: spec.filePath,
    relativePath: spec.filePath,
    content: spec.content,
    startLine,
    endLine: startLine + spec.content.split('\n').length - 1,
    language: 'typescript',
    framework: 'generic',
    componentType: 'module',
    dependencies: [],
    imports: [],
    exports: [],
    tags: [],
    metadata: spec.metadata ?? {}
  };
}

async function setup(chunks: CodeChunk[]) {
  const snapshot = await materializeSourceSnapshot(chunks, 'cbc-rescue-density-');
  const searcher = new CodebaseSearcher(snapshot.rootPath);
  const base = asSearcherTestHarness(searcher);
  base.initialized = true;
  base.sourceManifest = snapshot.manifest;
  base.embeddingProvider = null;
  base.storageProvider = null;
  const fuse = new Fuse(chunks, fuseOptions);
  base.fuseIndex = fuse;
  const harness = searcher as unknown as DensityHarness;
  harness.chunks = chunks;
  return { ...snapshot, harness, fuse };
}

describe('frozen rescue density behavior controls', () => {
  it.each(fixture.cases)('$id', async (control) => {
    const subject = await setup(control.chunks.map(makeChunk));
    try {
      const results = await subject.harness.rescueKeywordMatches(control.query, 10);
      expect(results.map(({ item }) => item.id)).toEqual(control.expectedIds);
      expect(results.map(({ item }) => item.relativePath)).toEqual(control.expectedPathPatterns);
    } finally {
      await subject.cleanup();
    }
  });

  it.each(fixture.sourceValidationCases)('$id', async (control) => {
    const chunks = control.staleChunkGenerator
      ? Array.from({ length: control.staleChunkGenerator.count }, (_, index) => {
          const generated = control.staleChunkGenerator!;
          return makeChunk({
            id: generated.idPattern.replace('{index}', String(index)),
            filePath: generated.filePathPattern.replace('{index}', String(index)),
            content: generated.content
          });
        }).concat((control.currentChunks ?? []).map(makeChunk))
      : (control.chunks ?? []).map(makeChunk);
    const subject = await setup(chunks);
    try {
      const changedChunks = control.mutateFilePathPattern
        ? chunks.filter(({ id }) => id.startsWith('stale-'))
        : chunks.filter(({ relativePath }) => relativePath === control.mutateFilePath);
      for (const stale of changedChunks) {
        await fs.writeFile(stale.filePath, control.replacementSource);
      }

      const results = await subject.harness.rescueKeywordMatches(control.query, 5);
      expect(results.map(({ item }) => item.id)).toEqual(control.expectedIds);
    } finally {
      await subject.cleanup();
    }
  });
});
