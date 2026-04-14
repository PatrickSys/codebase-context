import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { dispatchTool } from '../src/tools/index.js';
import type { ToolContext } from '../src/tools/types.js';
import { rmWithRetries } from './test-helpers.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME,
  MEMORY_FILENAME,
  RELATIONSHIPS_FILENAME
} from '../src/constants/codebase-context.js';

vi.mock('../src/core/reranker.js', () => ({
  rerank: vi.fn(async (_query: string, results: unknown) => results),
  getRerankerStatus: vi.fn(() => 'fallback')
}));

describe('Impact candidates (2-hop)', () => {
  let tempRoot: string | null = null;
  const token = 'UNIQUETOKEN123';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'impact-2hop-'));
    const srcDir = path.join(tempRoot, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'impact-2hop' }));

    await fs.writeFile(
      path.join(srcDir, 'c.ts'),
      `export function cFn() { return '${token}'; }\n`
    );
    await fs.writeFile(path.join(srcDir, 'b.ts'), `import { cFn } from './c';\nexport const b = cFn();\n`);
    await fs.writeFile(path.join(srcDir, 'a.ts'), `import { b } from './b';\nexport const a = b;\n`);

    const indexer = new CodebaseIndexer({
      rootPath: tempRoot,
      config: { skipEmbedding: true }
    });
    await indexer.index();
  });

  afterEach(async () => {
    if (tempRoot) {
      await rmWithRetries(tempRoot);
      tempRoot = null;
    }
  });

  it('includes hop 1 and hop 2 candidates in preflight impact.details', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const rootPath = tempRoot;
    const paths = {
      baseDir: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME),
      memory: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, MEMORY_FILENAME),
      intelligence: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, INTELLIGENCE_FILENAME),
      keywordIndex: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME),
      vectorDb: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, VECTOR_DB_DIRNAME)
    };

    const ctx: ToolContext = {
      indexState: { status: 'ready' },
      paths,
      rootPath,
      performIndexing: () => {}
    };

    const relationshipsPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, RELATIONSHIPS_FILENAME);
    const relationshipsRaw = await fs.readFile(relationshipsPath, 'utf-8');
    const relationships = JSON.parse(relationshipsRaw) as {
      graph?: { imports?: Record<string, string[]> };
    };
    const imports = relationships.graph?.imports ?? {};
    const hasInternalEdge =
      (imports['src/b.ts'] ?? []).some((d) => d.endsWith('src/c.ts') || d === 'src/c.ts') &&
      (imports['src/a.ts'] ?? []).some((d) => d.endsWith('src/b.ts') || d === 'src/b.ts');
    if (!hasInternalEdge) {
      throw new Error(
        `Expected relationships graph to include src/a.ts -> src/b.ts and src/b.ts -> src/c.ts, got imports keys=${JSON.stringify(
          Object.keys(imports)
        )}`
      );
    }

    const resp = await dispatchTool(
      'search_codebase',
      { query: token, intent: 'edit', includeSnippets: false, limit: 1 },
      ctx
    );

    const text = resp.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text) as {
      status?: string;
      results?: Array<{ file?: string }>;
      preflight?: { impact?: { details?: Array<{ file: string; hop: 1 | 2 }> } };
    };
    const results = parsed.results ?? [];
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(
        `Expected at least one search result for token, got status=${String(parsed.status)} results=${JSON.stringify(
          results
        )}`
      );
    }
    const details = parsed.preflight?.impact?.details ?? [];

    const hasHop1 = details.some((d) => d.file.endsWith('src/b.ts') && d.hop === 1);
    if (!hasHop1) {
      throw new Error(
        `Expected hop 1 candidate src/b.ts, got impact.details=${JSON.stringify(details)}`
      );
    }
    const hasHop2 = details.some((d) => d.file.endsWith('src/a.ts') && d.hop === 2);
    if (!hasHop2) {
      throw new Error(
        `Expected hop 2 candidate src/a.ts, got impact.details=${JSON.stringify(details)}`
      );
    }
  });
});
