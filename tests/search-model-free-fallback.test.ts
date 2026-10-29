import { resolveIndexArtifact } from '../src/core/index-generation.js';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import Fuse from 'fuse.js';
import type { CodeChunk, SearchFilters } from '../src/types/index.js';
import { CodebaseSearcher } from '../src/core/search.js';
import { assessSearchQuality } from '../src/core/search-quality.js';
import { GenericAnalyzer } from '../src/analyzers/generic/index.js';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { analyzerRegistry } from '../src/core/analyzer-registry.js';
import { InternalFileGraph } from '../src/utils/usage-tracker.js';
import {
  InternalSourceResolver,
  loadTsconfigCompilerOptions
} from '../src/utils/internal-source-resolver.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INTELLIGENCE_FILENAME,
  MANIFEST_FILENAME
} from '../src/constants/codebase-context.js';
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

async function searchFixture(chunks: CodeChunk[], withImportGraph = false) {
  const snapshot = await materializeSourceSnapshot(chunks, 'cbc-model-free-query-');
  const searcher = new CodebaseSearcher(snapshot.rootPath);
  const harness = asSearcherTestHarness(searcher) as ReturnType<typeof asSearcherTestHarness> & {
    chunks: CodeChunk[];
    loadPatternIntelligence: () => Promise<void>;
    semanticSearch: (
      query: string,
      limit: number,
      filters?: SearchFilters
    ) => Promise<Array<{ chunk: CodeChunk; score: number }>>;
  };
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
  // Use the same analyzer, resolver and graph serializer as indexing. Text in
  // comments/strings and unproven chunk.imports must not become graph edges.
  const graph = new InternalFileGraph(snapshot.rootPath);
  const reloadGraph = async (data: ReturnType<InternalFileGraph['toJSON']>) => {
    await fs.writeFile(
      await resolveIndexArtifact(snapshot.rootPath, INTELLIGENCE_FILENAME),
      JSON.stringify({ internalFileGraph: data })
    );
    await harness.loadPatternIntelligence();
  };
  if (withImportGraph) {
    const files = [...new Set(chunks.map((item) => item.filePath))];
    const resolver = await InternalSourceResolver.create(snapshot.rootPath, files, {
      compilerOptions: {
        ...loadTsconfigCompilerOptions(snapshot.rootPath),
        resolveJsonModule: true
      }
    });
    const analyzer = new GenericAnalyzer();
    for (const file of files.filter((file) => file.endsWith('.ts'))) {
      const content = await fs.readFile(file, 'utf8');
      const analysis = await analyzer.analyze(file, content);
      for (const imported of analysis.imports) {
        const target = await resolver.resolve(file, imported.source);
        if (target.status !== 'resolved' || !target.path) continue;
        graph.trackImport(file, target.path, imported.line, imported.imports, {
          kind: 'import',
          specifier: imported.source,
          sourceFingerprint: createHash('sha256').update(content).digest('hex'),
          targetFingerprint: createHash('sha256')
            .update(await fs.readFile(target.path))
            .digest('hex')
        });
      }
    }
    await reloadGraph(graph.toJSON());
  }
  const search = (query: string, filters?: SearchFilters) =>
    searcher.search(query, 5, filters, {
      useSemanticSearch: false,
      enableQueryExpansion: false,
      enableLowConfidenceRescue: false,
      enableReranker: false
    });
  const searchWithSemantic = (query: string) =>
    searcher.search(query, 5, undefined, {
      useSemanticSearch: true,
      useKeywordSearch: true,
      enableQueryExpansion: false,
      enableLowConfidenceRescue: false,
      enableReranker: false
    });
  return {
    rootPath: snapshot.rootPath,
    search,
    searchWithSemantic,
    searcher: harness,
    graph: graph.toJSON(),
    reloadGraph,
    cleanup: snapshot.cleanup
  };
}

describe('model-free query fallback', () => {
  it.each(['ParcelApiClient', 'parcelapiclient', 'Where is ParcelApiClient retry policy?'])(
    'keeps an exact declared class ahead of a same-suffix consumer for %s',
    async (query) => {
      const declaration = chunk(
        'src/parcels.ts',
        'export class ParcelApiClient { retryPolicy = "bounded"; }'
      );
      declaration.componentType = 'unknown';
      declaration.metadata = { componentName: 'ParcelApiClient' };
      const consumer = chunk(
        'src/ParcelApiClient-consumer.ts',
        'export class CachedParcelApiClient { client: ParcelApiClient; retryPolicy = "cached"; }'
      );
      consumer.metadata = { componentName: 'CachedParcelApiClient' };
      consumer.componentType = 'service';
      consumer.layer = 'business';
      const fixture = await searchFixture([consumer, declaration]);
      try {
        const results = await fixture.search(query);
        expect(results[0]?.filePath).toContain('parcels.ts');
        const exact = await fixture.search('ParcelApiClient');
        expect(assessSearchQuality('ParcelApiClient', exact).status).toBe('ok');
        expect(await fixture.search('QuantumPineappleService')).toEqual([]);
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it('keeps a re-export mention below its indexed declaration for an exact class query', async () => {
    const declaration = chunk(
      'src/parcels.ts',
      'export class ParcelApiClient { retryPolicy = "bounded"; }'
    );
    declaration.metadata = { componentName: 'ParcelApiClient' };
    declaration.componentType = 'unknown';
    const barrel = chunk(
      'src/ParcelApiClient.ts',
      'export { ParcelApiClient } from "./parcels.js";'
    );
    barrel.exports = ['ParcelApiClient'];
    barrel.componentType = 'service';
    barrel.layer = 'business';
    const fixture = await searchFixture([barrel, declaration]);
    try {
      expect((await fixture.search('ParcelApiClient'))[0]?.filePath).toContain('parcels.ts');
    } finally {
      await fixture.cleanup();
    }
  });

  it('retrieves an inflected action in a source declaration ahead of incidental configuration words', async () => {
    const fixture = await searchFixture([
      chunk(
        'src/order-batch.ts',
        'export function batchOrders(orders: string[]) { return orders.map(order => [order]); }',
        'batchOrders'
      ),
      chunk(
        'jest.config.ts',
        'export default { displayName: "orders", coverageDirectory: "coverage/order-processing" };'
      )
    ]);
    try {
      const results = await fixture.search('How are orders batched for processing?');
      expect(results[0]?.filePath).toContain('order-batch.ts');
    } finally {
      await fixture.cleanup();
    }
  });

  it('uses the same identifier boundaries for natural questions and Python snake_case source', async () => {
    const implementation = chunk(
      'billing/archive.py',
      'def archive_invoices(records):\n    return [record for record in records if record.paid]',
      'archive_invoices'
    );
    implementation.language = 'python';
    const fixture = await searchFixture([
      implementation,
      chunk('src/invoice.ts', 'export const invoices = [];')
    ]);
    try {
      const results = await fixture.search('Where are invoices archived before deletion?', {
        language: 'python'
      });
      expect(results[0]?.filePath).toContain('archive.py');
      expect(await fixture.search('Where are photons archived before teleportation?')).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not let fuzzy full-question configuration hits hide grounded declaration evidence', async () => {
    const fixture = await searchFixture([
      chunk(
        'src/channel.ts',
        'export function setAudioVolume(volume: number) { return volume; }',
        'setAudioVolume'
      ),
      chunk(
        'tsconfig.json',
        '{ "compilerOptions": { "allowJs": true }, "adjust": "auditor", "volume": "logs" }'
      )
    ]);
    try {
      const results = await fixture.search('adjust audio volume');
      expect(results[0]?.filePath).toContain('channel.ts');
      const exact = await fixture.search('setAudioVolume');
      expect(exact[0]?.filePath).toContain('channel.ts');
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not count inflections of one clue as independent corroboration', async () => {
    const fixture = await searchFixture([
      chunk('src/archive.ts', 'export function archive() { return true; }', 'archive'),
      chunk('src/organization.ts', 'export const organization = "archive";')
    ]);
    try {
      expect(await fixture.search('Where are archives archived holographically?')).toEqual([]);
      expect(await fixture.search('Where are organic organs archived?')).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('keeps concrete declaration relevance above unrelated component and layer labels', async () => {
    const declaration = chunk(
      'src/budget.ts',
      'export function calculateRetryBudget() { return 3; }',
      'calculateRetryBudget'
    );
    declaration.componentType = 'unknown';
    const mention = chunk(
      'src/controller.ts',
      'export class Controller { label = "retry budget"; }',
      'Controller'
    );
    mention.componentType = 'service';
    mention.layer = 'business';
    const fixture = await searchFixture([mention, declaration]);
    try {
      expect((await fixture.search('How is the retry budget calculated?'))[0]?.filePath).toContain(
        'budget.ts'
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    {
      file: 'jobs/batch.ts',
      source:
        'export function batchOrders(orders: string[]) { return orders.map(order => [order]); }',
      query: 'How are orders batched for processing?',
      exact: 'batchOrders'
    },
    {
      file: 'billing/archive.py',
      source:
        'def archive_invoices(records):\n    return [record for record in records if record.paid]',
      query: 'Where are invoices archived before deletion?',
      exact: 'archive_invoices'
    }
  ])('retrieves real GenericAnalyzer chunks for $file', async ({ file, source, query, exact }) => {
    const analyzer = new GenericAnalyzer();
    const analysis = await analyzer.analyze(path.resolve(file), `${source}\n`);
    for (const item of analysis.chunks) {
      item.relativePath = file;
      item.filePath = file;
    }
    expect(analysis.chunks.length).toBeGreaterThan(0);
    const fixture = await searchFixture(analysis.chunks);
    try {
      expect((await fixture.search(query))[0]?.filePath).toContain(path.basename(file));
      expect((await fixture.search(exact))[0]?.filePath).toContain(path.basename(file));
    } finally {
      await fixture.cleanup();
    }
  });

  it('uses default model-free indexing and search for inflected TypeScript and Python questions', async () => {
    const sources = [
      chunk(
        'jobs/batch.ts',
        'export function batchOrders(orders: string[]) { return orders.map(order => [order]); }'
      ),
      chunk(
        'billing/archive.py',
        'def archive_invoices(records):\n    return [record for record in records if record.paid]'
      )
    ];
    const snapshot = await materializeSourceSnapshot(sources, 'cbc-model-free-indexed-');
    analyzerRegistry.register(new GenericAnalyzer());
    try {
      // The helper's manifest supports in-memory tests; this case starts from
      // ordinary unindexed source and lets the real indexer own all artifacts.
      await fs.unlink(await resolveIndexArtifact(snapshot.rootPath, MANIFEST_FILENAME));
      await fs.rmdir(path.join(snapshot.rootPath, CODEBASE_CONTEXT_DIRNAME));
      const indexer = new CodebaseIndexer({ rootPath: snapshot.rootPath });
      await indexer.index();
      const searcher = new CodebaseSearcher(snapshot.rootPath);
      const typescript = await searcher.search('How are orders batched for processing?');
      const python = await searcher.search('Where are invoices archived before deletion?');
      expect(typescript[0]?.filePath).toContain('batch.ts');
      expect(python[0]?.filePath).toContain('archive.py');
      expect((await searcher.search('batchOrders'))[0]?.filePath).toContain('batch.ts');
      expect((await searcher.search('archive_invoices'))[0]?.filePath).toContain('archive.py');
    } finally {
      await snapshot.cleanup();
    }
  });

  it('replenishes a saturated rescue evidence window after one source with many chunks changes', async () => {
    const stale = Array.from({ length: 800 }, (_, index) => ({
      ...chunk('src/billing.ts', 'export const billing = { invoice: true, refund: true };'),
      id: `billing-${index}`
    }));
    const support = chunk(
      'src/support.ts',
      'export const support = { invoice: true, refund: true };'
    );
    const fixture = await searchFixture([...stale, support]);
    try {
      await fs.writeFile(stale[0].filePath, 'export const changed = true;\n');
      const matches = await fixture.search('billing invoice refund scheduling');
      expect(matches.map((result) => path.basename(result.filePath))).toEqual(['support.ts']);
      expect(matches[0].snippet).toContain('support');
    } finally {
      await fixture.cleanup();
    }
  });

  it('recovers separate source and policy files without requiring a manually written OR query', async () => {
    const fixture = await searchFixture(
      [
        chunk(
          'src/target.ts',
          'import { REQUIRED_POLICY } from "./policy.js";\nexport function resolvePilotPolicy(kind: string) { return kind + REQUIRED_POLICY; }',
          'resolvePilotPolicy'
        ),
        chunk('src/policy.ts', 'export const REQUIRED_POLICY = "review-before-deploy";')
      ],
      true
    );
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
      chunk(
        'packages/nx/src/utils/catalog-helper.ts',
        'export function formatSuggestions() { return "suggestions"; }'
      )
    ]);
    try {
      const results = await fixture.search(
        'Why do negative limits still yield multiple Nx typo suggestions?'
      );
      expect(results[0]?.filePath).toContain('string-similarity.ts');
      expect(
        assessSearchQuality(
          'Why do negative limits still yield multiple Nx typo suggestions?',
          results
        ).status
      ).toBe('low_confidence');
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not manufacture matches from irrelevant text or weaken exact symbol search', async () => {
    const fixture = await searchFixture([
      chunk(
        'src/session.ts',
        'export function authenticateUser() { return "token"; }',
        'authenticateUser'
      ),
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
      expect(await fixture.search('hydroponics transcendence', { language: 'python' })).toEqual([]);
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
      chunk(
        'src/auth.ts',
        'export function authenticateUser() { return true; }',
        'authenticateUser'
      )
    ]);
    try {
      expect(await fixture.search('authenticateUser holographic pineapple zebra quantum')).toEqual(
        []
      );
      expect((await fixture.search('authenticateUser'))[0]?.filePath).toContain('auth.ts');
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not corroborate an exact symbol using evidence from an unrelated file', async () => {
    const fixture = await searchFixture([
      chunk(
        'src/auth.ts',
        'export function authenticateUser() { return true; }',
        'authenticateUser'
      ),
      chunk('src/billing.ts', 'export const billing = { invoice: "paid", refund: "pending" };')
    ]);
    try {
      const matches = await fixture.search('authenticateUser billing invoice refund');
      expect(matches.map((result) => result.filePath.split(/[\\/]/).pop())).toEqual(['billing.ts']);
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not treat a longer indexed symbol as an exact query symbol anchor', async () => {
    const fixture = await searchFixture(
      [
        chunk(
          'src/auth.ts',
          'import "./billing.js";\nexport function authenticateUserAdmin() { return true; }',
          'authenticateUserAdmin'
        ),
        chunk('src/billing.ts', 'export const billing = { invoice: "paid", refund: "pending" };')
      ],
      true
    );
    try {
      const matches = await fixture.search('authenticateUser billing invoice refund');
      expect(matches.map((result) => path.basename(result.filePath))).toEqual(['billing.ts']);
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not use a comment-only symbol mention as an exact import anchor', async () => {
    const fixture = await searchFixture(
      [
        chunk('src/auth.ts', 'import "./billing.js";\n// authenticateUser was renamed last year.'),
        chunk('src/billing.ts', 'export const billing = { invoice: "paid", refund: "pending" };')
      ],
      true
    );
    try {
      const matches = await fixture.search('authenticateUser billing invoice refund');
      expect(matches.map((result) => path.basename(result.filePath))).toEqual(['billing.ts']);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    '// import "./billing.js";',
    '/* import "./billing.js"; */',
    'const example = \'import "./billing.js";\';',
    'const example = `import "./billing.js";`;',
    'const example = \'import("./billing.js")\';',
    'const example = \'require("./billing.js")\';',
    'const example = \'from "./billing.js"\';'
  ])('does not use fake import text as cross-file evidence: %s', async (fakeImport) => {
    const auth = chunk(
      'src/auth.ts',
      `${fakeImport}\nexport function authenticateUser() { return true; }`,
      'authenticateUser'
    );
    auth.imports = ['./billing.js']; // Raw chunk metadata has no source proof either.
    const fixture = await searchFixture(
      [
        auth,
        chunk('src/billing.ts', 'export const billing = { invoice: "paid", refund: "pending" };')
      ],
      true
    );
    try {
      expect(fixture.graph.imports['src/auth.ts'] ?? []).toEqual([]);
      const matches = await fixture.search('authenticateUser billing invoice refund');
      expect(matches.map((result) => path.basename(result.filePath))).toEqual(['billing.ts']);
    } finally {
      await fixture.cleanup();
    }
  });

  it('fails closed when a genuine import has no indexed graph proof', async () => {
    const fixture = await searchFixture([
      chunk(
        'src/auth.ts',
        'import "./billing.js";\nexport function authenticateUser() { return true; }',
        'authenticateUser'
      ),
      chunk('src/billing.ts', 'export const billing = { invoice: "paid", refund: "pending" };')
    ]);
    try {
      const matches = await fixture.search('authenticateUser billing invoice refund');
      expect(matches.map((result) => path.basename(result.filePath))).toEqual(['billing.ts']);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(['legacy', 'sourceFingerprint', 'targetFingerprint'] as const)(
    'fails closed for %s graph proof',
    async (invalidProof) => {
      const fixture = await searchFixture(
        [
          chunk(
            'src/auth.ts',
            'import "./billing.js";\nexport function authenticateUser() { return true; }',
            'authenticateUser'
          ),
          chunk('src/billing.ts', 'export const billing = { invoice: "paid", refund: "pending" };')
        ],
        true
      );
      try {
        const detail = fixture.graph.importDetails!['src/auth.ts']['src/billing.ts'];
        expect(detail.sources).toHaveLength(1);
        if (invalidProof === 'legacy') delete detail.sources;
        else detail.sources![0][invalidProof] = '0'.repeat(64);
        await fixture.reloadGraph(fixture.graph);
        const matches = await fixture.search('authenticateUser billing invoice refund');
        expect(matches.map((result) => path.basename(result.filePath))).toEqual(['billing.ts']);
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it('does not conflate a resolved JSON import with a same-stem TypeScript file', async () => {
    const json = chunk('src/billing.json', '{}');
    json.language = 'json';
    const fixture = await searchFixture(
      [
        chunk(
          'src/auth.ts',
          'import "./billing.json";\nexport function authenticateUser() { return true; }',
          'authenticateUser'
        ),
        json,
        chunk('src/billing.ts', 'export const billing = { invoice: "paid", refund: "pending" };')
      ],
      true
    );
    try {
      expect(fixture.graph.imports['src/auth.ts']).toEqual(['src/billing.json']);
      const matches = await fixture.search('authenticateUser billing invoice refund', {
        language: 'typescript'
      });
      expect(matches.map((result) => path.basename(result.filePath))).toEqual(['billing.ts']);
    } finally {
      await fixture.cleanup();
    }
  });

  it('excludes an anchor when its only graph companion no longer matches the snapshot', async () => {
    const auth = chunk(
      'src/auth.ts',
      'import "./billing.js";\nexport function authenticateUser() { return true; }',
      'authenticateUser'
    );
    const billing = chunk(
      'src/billing.ts',
      'export const billing = { invoice: "paid", refund: "pending" };'
    );
    const fixture = await searchFixture([auth, billing], true);
    try {
      await fs.writeFile(billing.filePath, 'export const unrelated = true;');
      // Contract migration: drift must not become corruption or lend stale graph proof.
      expect(await fixture.search('authenticateUser billing invoice refund')).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('preserves a fresh semantic nominee while excluding its stale graph companion', async () => {
    const auth = chunk(
      'src/auth.ts',
      'import "./billing.js";\nexport function authenticateUser() { return true; }',
      'authenticateUser'
    );
    const billing = chunk(
      'src/billing.ts',
      'export const billing = { invoice: "paid", refund: "pending" };'
    );
    const fixture = await searchFixture([auth, billing], true);
    try {
      await fs.writeFile(billing.filePath, 'export const unrelated = true;');
      fixture.searcher.embeddingProvider = {};
      fixture.searcher.storageProvider = {};
      fixture.searcher.semanticSearch = async () => [{ chunk: auth, score: 0.9 }];

      const results = await fixture.searchWithSemantic('authenticateUser billing invoice refund');
      expect(results.map((result) => path.basename(result.filePath))).toEqual(['auth.ts']);
      expect(results[0].snippet).toContain('authenticateUser');
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not corroborate an anchor after alias configuration redirects its unchanged import', async () => {
    const fixture = await searchFixture([
      chunk(
        'src/auth.ts',
        'import "@billing";\nexport function authenticateUser() { return true; }',
        'authenticateUser'
      ),
      chunk('src/billing.ts', 'export const billing = { invoice: "paid", refund: "pending" };'),
      chunk('src/other.ts', 'export const unrelated = true;')
    ]);
    const configPath = path.join(fixture.rootPath, 'tsconfig.json');
    try {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          compilerOptions: { baseUrl: '.', paths: { '@billing': ['src/billing.ts'] } }
        })
      );
      const authPath = path.join(fixture.rootPath, 'src/auth.ts');
      const billingPath = path.join(fixture.rootPath, 'src/billing.ts');
      const graph = new InternalFileGraph(fixture.rootPath);
      graph.trackImport(authPath, billingPath, 1, [], {
        kind: 'import',
        specifier: '@billing',
        sourceFingerprint: createHash('sha256')
          .update(await fs.readFile(authPath))
          .digest('hex'),
        targetFingerprint: createHash('sha256')
          .update(await fs.readFile(billingPath))
          .digest('hex')
      });
      await fixture.reloadGraph(graph.toJSON());
      expect(
        (await fixture.search('authenticateUser billing invoice refund'))
          .map((result) => path.basename(result.filePath))
          .sort()
      ).toEqual(['auth.ts', 'billing.ts']);
      await fs.writeFile(
        configPath,
        JSON.stringify({
          compilerOptions: { baseUrl: '.', paths: { '@billing': ['src/other.ts'] } }
        })
      );
      // Same endpoint bytes and same initialized searcher: resolution is a per-query witness.
      expect(
        (await fixture.search('authenticateUser billing invoice refund')).map((result) =>
          path.basename(result.filePath)
        )
      ).toEqual(['billing.ts']);
    } finally {
      await fixture.cleanup();
    }
  });

  it.skipIf(process.platform !== 'linux')(
    'keeps case-distinct indexed import targets separate',
    async () => {
      const fixture = await searchFixture(
        [
          chunk(
            'src/auth.ts',
            'import "./Billing.js";\nexport function authenticateUser() { return true; }',
            'authenticateUser'
          ),
          chunk('src/Billing.ts', 'export const unrelated = true;'),
          chunk('src/billing.ts', 'export const billing = { invoice: "paid", refund: "pending" };')
        ],
        true
      );
      try {
        expect(fixture.graph.imports['src/auth.ts']).toEqual(['src/Billing.ts']);
        const matches = await fixture.search('authenticateUser billing invoice refund');
        expect(matches.map((result) => path.basename(result.filePath))).toEqual(['billing.ts']);
      } finally {
        await fixture.cleanup();
      }
    }
  );

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
    const decoys = Array.from({ length: 1051 }, (_, index) => {
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
