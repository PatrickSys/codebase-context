import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import Fuse, { type FuseResult, type IFuseOptions } from 'fuse.js';
import { CodebaseSearcher } from '../src/core/search.js';
import { IndexCorruptedError } from '../src/errors/index.js';
import type { CodeChunk, SearchFilters } from '../src/types/index.js';
import { asSearcherTestHarness, materializeSourceSnapshot } from './helpers/source-snapshot.js';

interface ChunkSpec {
  id?: string;
  filePath?: string;
  content: string;
  startLine?: number;
  language?: string;
  metadata?: CodeChunk['metadata'];
  exports?: string[];
  tags?: string[];
}

interface NominationFixture {
  lexicalCases: Array<
    ChunkSpec & { id: string; query: string; expected: boolean; expectedScore?: number }
  >;
  representativeCases: Array<{
    id: string;
    query: string;
    chunks: Array<ChunkSpec & { id: string; filePath: string }>;
    expectedIds: string[];
  }>;
  populationCases: Array<{
    id: string;
    limit: number;
    count: number;
    cap: number;
    exhausted: boolean;
  }>;
  lifecycleCases: Array<'changed' | 'missing' | 'directory' | 'invalid-manifest' | 'outside-root'>;
  graphCases: Array<'current' | 'no-edge' | 'changed-companion' | 'directory-companion'>;
  strictCases: Array<{ id: string; query: string; expectsResult: boolean }>;
}

interface Validation {
  sources: Map<string, string[] | null>;
  candidateBudgetExhausted?: true;
}

interface RescueHarness {
  chunks: CodeChunk[];
  indexedImports: Map<string, Map<string, string[]>>;
  indexedFileKey: (file: string) => string;
  lexicalEvidence: (text: string) => Set<string>;
  rescueKeywordMatches: (
    query: string,
    limit: number,
    filters?: SearchFilters,
    validation?: Validation
  ) => Promise<FuseResult<CodeChunk>[]>;
  keywordSearch: (
    query: string,
    limit: number,
    filters?: SearchFilters
  ) => Promise<Array<{ chunk: CodeChunk; score: number }>>;
}

const fixture = JSON.parse(
  await fs.readFile(new URL('./fixtures/search-rescue-nomination.json', import.meta.url), 'utf8')
) as NominationFixture;

const options: IFuseOptions<CodeChunk> = {
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

function chunk(spec: ChunkSpec, index = 0): CodeChunk {
  const startLine = spec.startLine ?? 1;
  return {
    id: spec.id ?? `chunk-${index}`,
    filePath: spec.filePath ?? 'src/a.ts',
    relativePath: spec.filePath ?? 'src/a.ts',
    content: spec.content,
    startLine,
    endLine: startLine + spec.content.split('\n').length - 1,
    language: spec.language ?? 'typescript',
    framework: 'generic',
    componentType: 'module',
    dependencies: [],
    imports: [],
    exports: spec.exports ?? [],
    tags: spec.tags ?? [],
    metadata: spec.metadata ?? {}
  };
}

async function setup(chunks: CodeChunk[]) {
  const snapshot = await materializeSourceSnapshot(chunks, 'cbc-nomination-contract-');
  const searcher = new CodebaseSearcher(snapshot.rootPath);
  const base = asSearcherTestHarness(searcher);
  base.initialized = true;
  base.sourceManifest = snapshot.manifest;
  base.embeddingProvider = null;
  base.storageProvider = null;
  const fuse = new Fuse(chunks, options);
  base.fuseIndex = fuse;
  const harness = searcher as unknown as RescueHarness;
  harness.chunks = chunks;
  return { ...snapshot, searcher, harness, fuse };
}

describe('frozen rescue-only literal nomination contract', () => {
  // These are lexical unit controls, not an accuracy score. In particular, a
  // comment can provide a lexical clue without proving a program relationship.
  it.each(fixture.lexicalCases)('$id', async (control) => {
    const source = chunk(control);
    const subject = await setup([source]);
    try {
      const results = await subject.harness.rescueKeywordMatches(control.query, 5);
      expect(results.map(({ item }) => item.id)).toEqual(control.expected ? [source.id] : []);
      if (control.expected) expect(results[0]?.score).toBe(control.expectedScore);
    } finally {
      await subject.cleanup();
    }
  });

  it.each(fixture.representativeCases)('$id', async (control) => {
    const subject = await setup(control.chunks.map(chunk));
    try {
      const results = await subject.harness.rescueKeywordMatches(control.query, 5);
      expect(results.map(({ item }) => item.id)).toEqual(control.expectedIds);
      expect(results.every(({ score }) => score !== undefined && score >= 0 && score <= 1)).toBe(
        true
      );
    } finally {
      await subject.cleanup();
    }
  });

  it('does not invoke corpus fuzzy matching to nominate or rank a rescue witness', async () => {
    const subject = await setup([chunk({ content: '// archiving policies' })]);
    const fuzzy = vi.spyOn(Fuse.prototype, 'search');
    try {
      expect(await subject.harness.rescueKeywordMatches('archive policy', 5)).toHaveLength(1);
      expect(fuzzy).not.toHaveBeenCalled();
    } finally {
      fuzzy.mockRestore();
      await subject.cleanup();
    }
  });

  it.each(fixture.populationCases)('$id', async (control) => {
    const chunks = Array.from({ length: control.count }, (_, index) =>
      chunk({
        id: `nominee-${index}`,
        filePath: index === control.cap ? 'src/b.ts' : 'src/a.ts',
        content: '// archive policy'
      })
    );
    const subject = await setup(chunks);
    const evidence = vi.spyOn(subject.harness, 'lexicalEvidence');
    const validation: Validation = { sources: new Map() };
    try {
      const results = await subject.harness.rescueKeywordMatches(
        'archive policy',
        control.limit,
        undefined,
        validation
      );
      // Overflow is a declared bounded miss, not an invented complete search.
      expect(results.map(({ item }) => item.id)).toEqual(['nominee-0']);
      expect(Boolean(validation.candidateBudgetExhausted)).toBe(control.exhausted);
      expect(evidence.mock.calls.length).toBeLessThanOrEqual(control.cap * 2);
    } finally {
      await subject.cleanup();
    }
  });

  it.each(['language', 'framework', 'componentType', 'layer', 'tags'] as const)(
    'applies %s before the candidate window',
    async (field) => {
      const rejected = Array.from({ length: 760 }, (_, index) =>
        chunk({
          id: `excluded-${index}`,
          filePath: 'src/a.ts',
          content: '// archive policy'
        })
      );
      const target = chunk({ id: 'included', filePath: 'src/b.ts', content: '// archive policy' });
      const filters: SearchFilters = {};
      if (field === 'language') {
        filters.language = 'python';
        target.language = 'python';
      }
      if (field === 'framework') {
        filters.framework = 'test-framework';
        target.framework = 'test-framework';
      }
      if (field === 'componentType') {
        filters.componentType = 'function';
        target.componentType = 'function';
      }
      if (field === 'layer') {
        filters.layer = 'business';
        target.layer = 'business';
      }
      if (field === 'tags') {
        filters.tags = ['included'];
        target.tags = ['included'];
      }
      const subject = await setup([...rejected, target]);
      const validation: Validation = { sources: new Map() };
      try {
        const results = await subject.harness.rescueKeywordMatches(
          'archive policy',
          1,
          filters,
          validation
        );
        expect(results.map(({ item }) => item.id)).toEqual(['included']);
        expect(validation.candidateBudgetExhausted).toBeUndefined();
      } finally {
        await subject.cleanup();
      }
    }
  );

  it.each(fixture.lifecycleCases)('preserves %s source handling', async (state) => {
    const source = chunk({ content: '// archive policy' });
    const subject = await setup([source]);
    const validation: Validation = { sources: new Map() };
    try {
      if (state === 'changed') await fs.writeFile(source.filePath, '// replacement\n');
      if (state === 'missing' || state === 'directory') await fs.unlink(source.filePath);
      if (state === 'directory') await fs.mkdir(source.filePath);
      if (state === 'invalid-manifest') subject.manifest.files['src/a.ts'] = 'invalid';
      if (state === 'outside-root')
        source.filePath = path.resolve(subject.rootPath, '../escape.ts');
      const operation = subject.harness.rescueKeywordMatches(
        'archive policy',
        5,
        undefined,
        validation
      );
      if (state === 'changed' || state === 'missing') {
        expect(await operation).toEqual([]);
        expect(validation.sources.get(source.filePath)).toBeNull();
      } else {
        await expect(operation).rejects.toBeInstanceOf(IndexCorruptedError);
      }
    } finally {
      await subject.cleanup();
    }
  });

  it('refills past all chunks of a stale source without rerunning Fuse', async () => {
    const stale = Array.from({ length: 270 }, (_, index) =>
      chunk({
        id: `stale-${index}`,
        content: '// archive policy'
      })
    );
    const current = chunk({ id: 'current', filePath: 'src/b.ts', content: '// archive policy' });
    const subject = await setup([...stale, current]);
    const fuzzy = vi.spyOn(Fuse.prototype, 'search');
    try {
      await fs.writeFile(stale[0].filePath, '// replacement\n');
      const results = await subject.harness.rescueKeywordMatches('archive policy', 1);
      expect(results.map(({ item }) => item.id)).toEqual(['current']);
      expect(fuzzy).not.toHaveBeenCalled();
    } finally {
      fuzzy.mockRestore();
      await subject.cleanup();
    }
  });

  it('exposes nomination overflow through the public source coverage result', async () => {
    const chunks = Array.from({ length: 752 }, (_, index) =>
      chunk({
        id: `split-${index}`,
        content: index % 2 === 0 ? '// archive' : '// policy',
        startLine: index % 2 === 0 ? 1 : 3
      })
    );
    const subject = await setup(chunks);
    try {
      const outcome = await subject.searcher.searchWithCoverage('archive policy', 1, undefined, {
        useSemanticSearch: false,
        enableQueryExpansion: false,
        enableLowConfidenceRescue: false,
        enableReranker: false
      });
      expect(outcome.results).toHaveLength(1);
      expect(outcome.sourceCoverage.status).toBe('partial');
      expect(outcome.sourceCoverage.candidateBudgetExhausted).toBe(true);
    } finally {
      await subject.cleanup();
    }
  });

  it.each(fixture.graphCases)('requires current resolved graph proof: %s', async (state) => {
    const anchor = chunk({
      id: 'anchor',
      content: 'import { rules } from "./b.js";\nexport class LedgerGateway {}',
      metadata: { className: 'LedgerGateway' }
    });
    const companion = chunk({
      id: 'companion',
      filePath: 'src/b.ts',
      content: 'export const rules = { archive: true, policy: true };'
    });
    const subject = await setup([anchor, companion]);
    if (state !== 'no-edge') {
      subject.harness.indexedImports = new Map([
        [
          subject.harness.indexedFileKey(anchor.filePath),
          new Map([[subject.harness.indexedFileKey(companion.filePath), ['./b.js']]])
        ]
      ]);
    }
    try {
      if (state === 'changed-companion')
        await fs.writeFile(companion.filePath, 'export const rules = {};\n');
      if (state === 'directory-companion') {
        await fs.unlink(companion.filePath);
        await fs.mkdir(companion.filePath);
      }
      const operation = subject.harness.rescueKeywordMatches('LedgerGateway archive policy', 5);
      if (state === 'directory-companion') {
        await expect(operation).rejects.toBeInstanceOf(IndexCorruptedError);
      } else {
        const ids = (await operation).map(({ item }) => item.id);
        expect(ids.includes('anchor')).toBe(state === 'current');
      }
    } finally {
      await subject.cleanup();
    }
  });

  it.each(fixture.strictCases)('retains original strict Fuse route: $id', async (control) => {
    const source = chunk({ content: 'export class ArchivePolicy {}\n// archive policy' });
    const subject = await setup([source]);
    const fuzzy = vi.spyOn(subject.fuse, 'search');
    try {
      const results = await subject.harness.keywordSearch(control.query, 5);
      expect(fuzzy).toHaveBeenCalledWith(control.query);
      expect(results.length > 0).toBe(control.expectsResult);
    } finally {
      await subject.cleanup();
    }
  });

  it.each([
    'archive | policy',
    '^archive policy',
    'archive policy$',
    '!archive policy',
    '=archive policy'
  ])('keeps explicit syntax out of lexical rescue: %s', async (query) => {
    const subject = await setup([chunk({ content: '// archive policy' })]);
    const fuzzy = vi.spyOn(subject.fuse, 'search');
    try {
      expect(await subject.harness.rescueKeywordMatches(query, 5)).toEqual([]);
      expect(fuzzy).not.toHaveBeenCalled();
    } finally {
      await subject.cleanup();
    }
  });
});
