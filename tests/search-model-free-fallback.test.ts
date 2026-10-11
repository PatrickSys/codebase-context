import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import Fuse from 'fuse.js';
import type { CodeChunk, SearchFilters } from '../src/types/index.js';
import { CodebaseSearcher } from '../src/core/search.js';
import { IndexCorruptedError } from '../src/errors/index.js';
import { assessSearchQuality } from '../src/core/search-quality.js';
import { GenericAnalyzer } from '../src/analyzers/generic/index.js';
import { InternalFileGraph } from '../src/utils/usage-tracker.js';
import {
  InternalSourceResolver,
  loadTsconfigCompilerOptions
} from '../src/utils/internal-source-resolver.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INTELLIGENCE_FILENAME
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
      path.join(snapshot.rootPath, CODEBASE_CONTEXT_DIRNAME, INTELLIGENCE_FILENAME),
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
  return { search, graph: graph.toJSON(), reloadGraph, cleanup: snapshot.cleanup };
}

describe('model-free query fallback', () => {
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

  it('rejects a graph witness whose current source no longer matches its indexed snapshot', async () => {
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
      await expect(fixture.search('authenticateUser billing invoice refund')).rejects.toBeInstanceOf(
        IndexCorruptedError
      );
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
