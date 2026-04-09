import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  RELATIONSHIPS_FILENAME,
  VECTOR_DB_DIRNAME
} from '../src/constants/codebase-context.js';

const searchMocks = vi.hoisted(() => ({
  search: vi.fn()
}));

vi.mock('../src/core/search.js', async () => {
  class CodebaseSearcher {
    constructor(_rootPath: string) {}

    async search(query: string, limit: number, filters?: unknown) {
      return searchMocks.search(query, limit, filters);
    }
  }

  return { CodebaseSearcher };
});

// A minimal SearchResult-like object for mocking
function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    summary: 'Auth service token management',
    snippet: 'export class AuthService { getToken() { return token; } }',
    filePath: 'src/auth/auth.service.ts',
    startLine: 1,
    endLine: 20,
    score: 0.82,
    language: 'ts',
    metadata: {},
    relevanceReason: 'Matches auth token query',
    ...overrides
  };
}

// Produces a strong set of 3+ results with good scores (> 0.4)
function makeStrongResults() {
  return [
    makeResult({ filePath: 'src/auth/auth.service.ts', score: 0.85 }),
    makeResult({ filePath: 'src/auth/token.service.ts', score: 0.78 }),
    makeResult({ filePath: 'src/auth/interceptor.ts', score: 0.71 })
  ];
}

// Returns ISO string for N hours ago
function hoursAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}

describe('search_codebase SAFE-01 edit-readiness gating', () => {
  let tempRoot: string | null = null;
  let originalArgv: string[] | null = null;
  let originalEnvRoot: string | undefined;

  async function seedIndex(generatedAt: string) {
    if (!tempRoot) throw new Error('tempRoot not set');
    const ctxDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(ctxDir, { recursive: true });

    const buildId = 'test-build-safe01';

    await fs.mkdir(path.join(ctxDir, VECTOR_DB_DIRNAME), { recursive: true });
    await fs.writeFile(
      path.join(ctxDir, VECTOR_DB_DIRNAME, 'index-build.json'),
      JSON.stringify({ buildId, formatVersion: INDEX_FORMAT_VERSION }),
      'utf-8'
    );

    await fs.writeFile(
      path.join(ctxDir, KEYWORD_INDEX_FILENAME),
      JSON.stringify({ header: { buildId, formatVersion: INDEX_FORMAT_VERSION }, chunks: [] }),
      'utf-8'
    );

    await fs.writeFile(
      path.join(ctxDir, INDEX_META_FILENAME),
      JSON.stringify(
        {
          metaVersion: INDEX_META_VERSION,
          formatVersion: INDEX_FORMAT_VERSION,
          buildId,
          generatedAt,
          toolVersion: 'test',
          artifacts: {
            keywordIndex: { path: KEYWORD_INDEX_FILENAME },
            vectorDb: { path: VECTOR_DB_DIRNAME, provider: 'lancedb' },
            intelligence: { path: INTELLIGENCE_FILENAME }
          }
        },
        null,
        2
      ),
      'utf-8'
    );

    await fs.writeFile(
      path.join(ctxDir, INTELLIGENCE_FILENAME),
      JSON.stringify(
        {
          header: { buildId, formatVersion: INDEX_FORMAT_VERSION },
          generatedAt,
          internalFileGraph: {
            imports: {
              'src/app/app.module.ts': ['src/auth/auth.service.ts'],
              'src/app/login.component.ts': ['src/auth/auth.service.ts']
            }
          },
          patterns: {
            componentArchitecture: {
              primary: {
                name: 'Standalone Components',
                frequency: '97%',
                trend: 'Stable'
              }
            },
            stateManagement: {
              primary: {
                name: 'Signals',
                frequency: '78%',
                trend: 'Rising'
              }
            }
          },
          goldenFiles: [{ file: 'src/auth/auth.service.ts', score: 0.95 }]
        },
        null,
        2
      ),
      'utf-8'
    );

    await fs.writeFile(
      path.join(ctxDir, RELATIONSHIPS_FILENAME),
      JSON.stringify(
        {
          header: { buildId, formatVersion: INDEX_FORMAT_VERSION },
          stats: { files: 5, edges: 10 },
          graph: {
            imports: {
              'src/app/app.module.ts': ['src/auth/auth.service.ts'],
              'src/app/login.component.ts': ['src/auth/auth.service.ts']
            },
            importedBy: {
              'src/auth/auth.service.ts': ['src/app/app.module.ts', 'src/app/login.component.ts']
            },
            exports: {
              'src/auth/auth.service.ts': [
                { name: 'AuthService', type: 'class' },
                { name: 'getToken', type: 'function' }
              ]
            }
          }
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  beforeEach(async () => {
    searchMocks.search.mockReset();
    vi.resetModules();

    originalArgv = [...process.argv];
    originalEnvRoot = process.env.CODEBASE_ROOT;

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'search-safe01-test-'));
    process.env.CODEBASE_ROOT = tempRoot;
    process.argv[2] = tempRoot;
  });

  afterEach(async () => {
    if (originalArgv) process.argv = originalArgv;
    if (originalEnvRoot === undefined) {
      delete process.env.CODEBASE_ROOT;
    } else {
      process.env.CODEBASE_ROOT = originalEnvRoot;
    }

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  // Test 1: Low-confidence + edit intent → preflight.abstain === true, preflight.ready === false
  it('low-confidence retrieval with edit intent sets abstain=true and ready=false', async () => {
    // 0 results → assessSearchQuality returns low_confidence immediately
    searchMocks.search.mockResolvedValueOnce([]);
    await seedIndex(new Date().toISOString()); // fresh index

    const { server } = await import('../src/index.js');
    const handler = (
      server as {
        _requestHandlers?: Map<
          string,
          (r: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>
        >;
      }
    )._requestHandlers?.get('tools/call');
    if (!handler) throw new Error('Expected tools/call handler');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'auth token service', intent: 'edit' }
      }
    });

    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      preflight?: { ready: boolean; abstain?: boolean; nextAction?: string };
      results: unknown[];
    };

    expect(payload.status).toBe('success');
    expect(payload.preflight).toBeDefined();
    expect(payload.preflight!.ready).toBe(false);
    expect(payload.preflight!.abstain).toBe(true);
    // Results still returned (soft abstain)
    expect(Array.isArray(payload.results)).toBe(true);
  });

  // Test 2: Fresh index + edit intent → normal preflight (no abstain)
  it('fresh index with strong evidence and edit intent does not set abstain', async () => {
    searchMocks.search.mockResolvedValueOnce(makeStrongResults());
    await seedIndex(new Date().toISOString()); // fresh

    const { server } = await import('../src/index.js');
    const handler = (
      server as {
        _requestHandlers?: Map<
          string,
          (r: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>
        >;
      }
    )._requestHandlers?.get('tools/call');
    if (!handler) throw new Error('Expected tools/call handler');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'auth token service', intent: 'edit' }
      }
    });

    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      preflight?: { ready: boolean; abstain?: boolean };
      results: unknown[];
    };

    expect(payload.status).toBe('success');
    expect(payload.preflight).toBeDefined();
    // No abstain for fresh index with good evidence
    expect(payload.preflight!.abstain).toBeUndefined();
    expect(payload.results.length).toBeGreaterThan(0);
  });

  // Test 3: Aging index + edit intent → preflight.warnings includes aging notice, ready can be true
  it('aging index with edit intent surfaces aging warning without blocking', async () => {
    searchMocks.search.mockResolvedValueOnce(makeStrongResults());
    await seedIndex(hoursAgo(25)); // aging: >24h, <168h

    const { server } = await import('../src/index.js');
    const handler = (
      server as {
        _requestHandlers?: Map<
          string,
          (r: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>
        >;
      }
    )._requestHandlers?.get('tools/call');
    if (!handler) throw new Error('Expected tools/call handler');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'auth token service', intent: 'edit' }
      }
    });

    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      preflight?: { ready: boolean; abstain?: boolean; warnings?: string[] };
      results: unknown[];
    };

    expect(payload.status).toBe('success');
    expect(payload.preflight).toBeDefined();
    // No hard block for aging
    expect(payload.preflight!.abstain).toBeUndefined();
    // Aging warning surfaced
    const warnings = payload.preflight!.warnings ?? [];
    const hasAgingWarning = warnings.some((w) => w.toLowerCase().includes('aging'));
    expect(hasAgingWarning).toBe(true);
    // Results still returned
    expect(payload.results.length).toBeGreaterThan(0);
  });

  // Test 4: Stale index + edit intent → abstain=true, ready=false, nextAction mentions refresh_index
  it('stale index with edit intent sets abstain=true and includes refresh_index guidance', async () => {
    searchMocks.search.mockResolvedValueOnce(makeStrongResults());
    await seedIndex(hoursAgo(8 * 24)); // stale: >168h (8 days)

    const { server } = await import('../src/index.js');
    const handler = (
      server as {
        _requestHandlers?: Map<
          string,
          (r: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>
        >;
      }
    )._requestHandlers?.get('tools/call');
    if (!handler) throw new Error('Expected tools/call handler');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'auth token service', intent: 'edit' }
      }
    });

    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      preflight?: { ready: boolean; abstain?: boolean; nextAction?: string };
      results: unknown[];
    };

    expect(payload.status).toBe('success');
    expect(payload.preflight).toBeDefined();
    expect(payload.preflight!.ready).toBe(false);
    expect(payload.preflight!.abstain).toBe(true);
    // nextAction must mention refresh_index
    expect(payload.preflight!.nextAction).toMatch(/refresh_index/i);
    // Results still returned (soft abstain)
    expect(Array.isArray(payload.results)).toBe(true);
  });

  // Test 5: Explore intent with stale index → no abstain field, results returned normally
  it('explore intent with stale index has no abstain field and returns results', async () => {
    searchMocks.search.mockResolvedValueOnce(makeStrongResults());
    await seedIndex(hoursAgo(8 * 24)); // stale: >168h

    const { server } = await import('../src/index.js');
    const handler = (
      server as {
        _requestHandlers?: Map<
          string,
          (r: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>
        >;
      }
    )._requestHandlers?.get('tools/call');
    if (!handler) throw new Error('Expected tools/call handler');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'auth token service', intent: 'explore' }
      }
    });

    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      preflight?: { ready: boolean; abstain?: boolean };
      results: unknown[];
    };

    expect(payload.status).toBe('success');
    // Explore intent uses lite preflight path — no abstain field
    if (payload.preflight) {
      expect(payload.preflight.abstain).toBeUndefined();
    }
    // Results are returned regardless
    expect(payload.results.length).toBeGreaterThan(0);
  });

  // Test 6: indexFreshness correctly propagated — aging gaps appear in preflight
  it('indexFreshness aging signal propagates to preflight evidence gaps', async () => {
    searchMocks.search.mockResolvedValueOnce(makeStrongResults());
    await seedIndex(hoursAgo(48)); // 48h — aging

    const { server } = await import('../src/index.js');
    const handler = (
      server as {
        _requestHandlers?: Map<
          string,
          (r: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>
        >;
      }
    )._requestHandlers?.get('tools/call');
    if (!handler) throw new Error('Expected tools/call handler');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'auth token service', intent: 'refactor' }
      }
    });

    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      preflight?: {
        ready: boolean;
        abstain?: boolean;
        warnings?: string[];
        nextAction?: string;
      };
    };

    expect(payload.status).toBe('success');
    expect(payload.preflight).toBeDefined();
    // indexFreshness=aging should not block — no abstain
    expect(payload.preflight!.abstain).toBeUndefined();
    // Aging warning must be surfaced via warnings
    const warnings = payload.preflight!.warnings ?? [];
    const nextAction = payload.preflight!.nextAction ?? '';
    const hasAgingSignal =
      warnings.some((w) => w.toLowerCase().includes('aging')) ||
      nextAction.toLowerCase().includes('aging');
    expect(hasAgingSignal).toBe(true);
  });
});
