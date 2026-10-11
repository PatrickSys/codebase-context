import { describe, expect, it } from 'vitest';
import Fuse from 'fuse.js';
import type { CodeChunk, SearchFilters } from '../src/types/index.js';
import { CodebaseSearcher } from '../src/core/search.js';
import { asSearcherTestHarness, materializeSourceSnapshot } from './helpers/source-snapshot.js';

function chunk(filePath: string, content: string, symbolName?: string): CodeChunk {
  return {
    id: filePath,
    content,
    filePath,
    relativePath: filePath,
    startLine: 1,
    endLine: content.split('\n').length,
    language: 'typescript',
    framework: 'generic',
    componentType: 'module',
    dependencies: [],
    imports: [],
    exports: [],
    tags: [],
    metadata: symbolName ? { symbolName, componentName: symbolName } : {}
  };
}

async function searchFixture(chunks: CodeChunk[]) {
  const snapshot = await materializeSourceSnapshot(chunks, 'cbc-model-free-query-');
  const searcher = new CodebaseSearcher(snapshot.rootPath);
  const harness = asSearcherTestHarness(searcher) as ReturnType<
    typeof asSearcherTestHarness
  > & { chunks: CodeChunk[] };
  harness.initialized = true;
  harness.sourceManifest = snapshot.manifest;
  harness.chunks = chunks;
  harness.embeddingProvider = null;
  harness.storageProvider = null;
  harness.fuseIndex = new Fuse(chunks, {
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
  });
  const search = (query: string, filters?: SearchFilters) =>
    searcher.search(query, 5, filters, {
      useSemanticSearch: false,
      enableQueryExpansion: false,
      enableLowConfidenceRescue: false,
      enableReranker: false
    });
  return { search, cleanup: snapshot.cleanup };
}

describe('model-free query fallback', () => {
  it('recovers separate source and policy files without requiring a manually written OR query', async () => {
    const fixture = await searchFixture([
      chunk(
        'src/target.ts',
        'import { REQUIRED_POLICY } from "./policy.js";\nexport function resolvePilotPolicy(kind: string) { return kind + REQUIRED_POLICY; }',
        'resolvePilotPolicy'
      ),
      chunk('src/policy.ts', 'export const REQUIRED_POLICY = "review-before-deploy";')
    ]);
    try {
      const results = await fixture.search('resolvePilotPolicy review-before-deploy');
      expect(results.map((result) => result.filePath.split(/[\\/]/).pop())).toEqual(
        expect.arrayContaining(['target.ts', 'policy.ts'])
      );
      const explicitOr = await fixture.search('resolvePilotPolicy | review-before-deploy');
      expect(explicitOr.map((result) => result.filePath.split(/[\\/]/).pop())).toEqual(
        expect.arrayContaining(['target.ts', 'policy.ts'])
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('finds an implementation from an ordinary negative-limit suggestion question', async () => {
    const fixture = await searchFixture([
      chunk(
        'packages/nx/src/utils/string-similarity.ts',
        'Returns up to limit candidates. Candidates not similar enough to input are excluded from suggestions.\nexport function findClosestMatches(input: string, candidates: string[], limit = 3) { return candidates.slice(0, limit); }',
        'findClosestMatches'
      ),
      chunk('packages/nx/src/utils/worker-limit.ts', 'export const workerLimit = 100;'),
      chunk('packages/nx/src/utils/catalog-helper.ts', 'export function formatSuggestions() { return "suggestions"; }')
    ]);
    try {
      const results = await fixture.search(
        'Why do negative limits still yield multiple Nx typo suggestions?'
      );
      expect(results[0]?.filePath).toContain('string-similarity.ts');
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not manufacture matches from irrelevant text or weaken exact symbol search', async () => {
    const fixture = await searchFixture([
      chunk('src/session.ts', 'export function authenticateUser() { return "token"; }', 'authenticateUser'),
      chunk('src/policy.ts', 'export const SESSION_POLICY = "login-required";')
    ]);
    try {
      expect(await fixture.search('holographic pineapple zebra quantum')).toEqual([]);
      const exact = await fixture.search('authenticateUser');
      expect(exact[0]?.filePath).toContain('session.ts');
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not promote unrelated single-term hits into a cross-file answer', async () => {
    const fixture = await searchFixture([
      chunk('src/green.ts', 'export const hydroponics = 1;'),
      chunk('src/red.ts', 'export const transcendence = 1;')
    ]);
    try {
      expect(await fixture.search('hydroponics transcendence')).toEqual([]);
      expect(await fixture.search('hydroponics transcendence', { language: 'python' })).toEqual(
        []
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('respects filters when the fallback has enough supporting words', async () => {
    const fixture = await searchFixture([
      chunk('src/policy.ts', 'export const deploymentPolicy = "review before deploy";')
    ]);
    try {
      expect(await fixture.search('review deploy', { language: 'python' })).toEqual([]);
      expect((await fixture.search('review deploy')).at(0)?.filePath).toContain('policy.ts');
    } finally {
      await fixture.cleanup();
    }
  });

  it('combines evidence from separate chunks in one source file without repeating that file', async () => {
    const first = chunk('src/combined.ts', 'export const hydroponics = true;');
    first.id = 'combined-first';
    const second = chunk('src/combined.ts', 'export const transcendence = true;');
    second.id = 'combined-second';
    second.startLine = 2;
    second.endLine = 2;
    const fixture = await searchFixture([first, second]);
    try {
      const results = await fixture.search('hydroponics transcendence');
      expect(results).toHaveLength(1);
      expect(results[0].filePath).toContain('combined.ts');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects an exact symbol when all the other substantive query terms are unsupported', async () => {
    const fixture = await searchFixture([
      chunk('src/auth.ts', 'export function authenticateUser() { return true; }', 'authenticateUser')
    ]);
    try {
      expect(
        await fixture.search('authenticateUser holographic pineapple zebra quantum')
      ).toEqual([]);
      expect((await fixture.search('authenticateUser'))[0]?.filePath).toContain('auth.ts');
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not corroborate an exact symbol using evidence from an unrelated file', async () => {
    const fixture = await searchFixture([
      chunk('src/auth.ts', 'export function authenticateUser() { return true; }', 'authenticateUser'),
      chunk('src/billing.ts', 'export const billing = { invoice: "paid", refund: "pending" };')
    ]);
    try {
      const matches = await fixture.search('authenticateUser billing invoice refund');
      expect(matches.map((result) => result.filePath.split(/[\\/]/).pop())).toEqual([
        'billing.ts'
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not turn generic TypeScript syntax words into a confident match', async () => {
    const fixture = await searchFixture([
      chunk('src/unconnected.ts', 'export function unconnected() { return 1; }')
    ]);
    try {
      expect(await fixture.search('configure function return on thing')).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('applies a language filter before the bounded rescue-candidate cutoff', async () => {
    const decoys = Array.from({ length: 1050 }, (_, index) => {
      const item = chunk(`src/noise-${index}.py`, 'system error algorithm');
      item.language = 'python';
      return item;
    });
    const target = chunk('src/algorithm.ts', 'export const algorithm = "cohesion";');
    const fixture = await searchFixture([...decoys, target]);
    try {
      const matches = await fixture.search('system error algorithm cohesion', {
        language: 'typescript'
      });
      expect(matches[0]?.filePath).toContain('algorithm.ts');
      expect(matches).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });
});
