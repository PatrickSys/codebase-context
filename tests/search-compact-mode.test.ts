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
    score: 0.85,
    language: 'ts',
    metadata: {},
    relevanceReason: 'Matches auth token query',
    ...overrides
  };
}

describe('search_codebase compact/full mode', () => {
  let tempRoot: string | null = null;
  let originalArgv: string[] | null = null;
  let originalEnvRoot: string | undefined;

  beforeEach(async () => {
    searchMocks.search.mockReset();
    vi.resetModules();

    originalArgv = [...process.argv];
    originalEnvRoot = process.env.CODEBASE_ROOT;

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'search-compact-mode-test-'));
    process.env.CODEBASE_ROOT = tempRoot;
    process.argv[2] = tempRoot;

    const ctxDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.mkdir(ctxDir, { recursive: true });

    const buildId = 'test-build-compact';
    const generatedAt = new Date().toISOString();

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
            stateManagement: {
              primary: {
                name: 'Signals',
                frequency: '78%',
                trend: 'Rising'
              }
            },
            componentArchitecture: {
              primary: {
                name: 'Standalone Components',
                frequency: '97%',
                trend: 'Stable'
              }
            }
          },
          goldenFiles: [
            { file: 'src/auth/auth.service.ts', score: 0.95 },
            { file: 'src/app/app.module.ts', score: 0.8 }
          ]
        },
        null,
        2
      ),
      'utf-8'
    );

    // Write relationships.json with header + importedBy and exports
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
                { name: 'AuthToken', type: 'interface' },
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

  // Test 1: Default (compact) mode caps results at 6
  it('default compact mode returns at most 6 results even when search returns more', async () => {
    // Return 10 results
    const manyResults = Array.from({ length: 10 }, (_, i) =>
      makeResult({ filePath: `src/file${i}.ts`, startLine: i * 10 + 1, endLine: i * 10 + 20 })
    );
    searchMocks.search.mockResolvedValueOnce(manyResults);

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
      params: { name: 'search_codebase', arguments: { query: 'auth service', limit: 10 } }
    });

    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      budget: { mode: string; resultCount: number };
      results: unknown[];
    };
    expect(payload.status).toBe('success');
    expect(payload.budget.mode).toBe('compact');
    expect(payload.results.length).toBeLessThanOrEqual(6);
    expect(payload.budget.resultCount).toBeLessThanOrEqual(6);
  });

  // Test 2: Compact results include importedByCount and topExports when available
  it('compact results include importedByCount and topExports from relationships.json', async () => {
    searchMocks.search.mockResolvedValueOnce([makeResult()]);

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
      params: { name: 'search_codebase', arguments: { query: 'auth service' } }
    });

    const payload = JSON.parse(response.content[0].text) as {
      results: Array<{ importedByCount: number; topExports?: string[] }>;
    };
    const result = payload.results[0];
    expect(typeof result.importedByCount).toBe('number');
    // Expect 2 importers (app.module.ts + login.component.ts)
    expect(result.importedByCount).toBe(2);
    // topExports should be present (we wrote exports for this file)
    expect(Array.isArray(result.topExports)).toBe(true);
    expect(result.topExports).toContain('AuthService');
  });

  // Test 3: Compact results do NOT include hints or consumers fields
  it('compact results do not include hints or consumers fields', async () => {
    searchMocks.search.mockResolvedValueOnce([makeResult()]);

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
      params: { name: 'search_codebase', arguments: { query: 'auth service' } }
    });

    const payload = JSON.parse(response.content[0].text) as {
      results: Array<Record<string, unknown>>;
    };
    const result = payload.results[0];
    expect(result.hints).toBeUndefined();
    expect((result as Record<string, unknown>).consumers).toBeUndefined();
  });

  // Test 4: Compact response includes budget, patternSummary, bestExample, nextHops
  it('compact response includes budget, patternSummary, bestExample, and nextHops', async () => {
    searchMocks.search.mockResolvedValueOnce([makeResult()]);

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
      params: { name: 'search_codebase', arguments: { query: 'auth service' } }
    });

    const payload = JSON.parse(response.content[0].text) as {
      budget: { mode: string; resultCount: number };
      patternSummary?: string;
      bestExample?: string;
      nextHops?: Array<{ tool: string; why: string }>;
    };
    expect(payload.budget).toBeDefined();
    expect(payload.budget.mode).toBe('compact');
    // patternSummary should include pattern info from intelligence.json
    expect(typeof payload.patternSummary).toBe('string');
    expect(payload.patternSummary).toContain('Signals');
    // bestExample should be the top golden file
    expect(payload.bestExample).toBe('src/auth/auth.service.ts');
    // nextHops should have at least 1 entry
    expect(Array.isArray(payload.nextHops)).toBe(true);
    expect(payload.nextHops?.length ?? 0).toBeGreaterThan(0);
  });

  it('adds an exact tokenEstimate advisory to compact responses', async () => {
    searchMocks.search.mockResolvedValueOnce([makeResult()]);

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
      params: { name: 'search_codebase', arguments: { query: 'auth service' } }
    });

    const payload = JSON.parse(response.content[0].text) as {
      searchQuality: {
        status: string;
        confidence: string;
        tokenEstimate: number;
        warning?: string;
        hint?: string;
        rerankerStatus?: string;
      };
      [key: string]: unknown;
    };

    expect(payload.searchQuality.tokenEstimate).toBe(Math.ceil(response.content[0].text.length / 4));
    expect(payload.searchQuality.warning).toBeUndefined();
  });

  it('uses filter-only guidance when a final compact payload exceeds the token threshold', async () => {
    const oversizedSummary = 'Token-heavy compact summary '.repeat(1200);
    searchMocks.search.mockResolvedValueOnce([
      makeResult({
        summary: oversizedSummary
      })
    ]);

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
      params: { name: 'search_codebase', arguments: { query: 'auth service' } }
    });

    const payload = JSON.parse(response.content[0].text) as {
      searchQuality: {
        tokenEstimate: number;
        warning?: string;
      };
    };

    expect(payload.searchQuality.tokenEstimate).toBe(Math.ceil(response.content[0].text.length / 4));
    expect(payload.searchQuality.tokenEstimate).toBeGreaterThan(4000);
    expect(payload.searchQuality.warning).toBe(
      `Large search payload: estimated ${payload.searchQuality.tokenEstimate} tokens. Try tighter filters (e.g. layer=, language=) to reduce payload size.`
    );
  });

  // Test 5: Full mode returns hints arrays and all memories + budget
  it('full mode returns hints object with callers/tests and budget metadata', async () => {
    searchMocks.search.mockResolvedValueOnce([makeResult()]);

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
      params: { name: 'search_codebase', arguments: { query: 'auth service', mode: 'full' } }
    });

    const payload = JSON.parse(response.content[0].text) as {
      budget: { mode: string; resultCount: number };
      results: Array<Record<string, unknown>>;
      totalResults: number;
    };
    expect(payload.budget.mode).toBe('full');
    expect(typeof payload.totalResults).toBe('number');
    // Full mode includes hints object (callers present because of relationships)
    const result = payload.results[0];
    expect(result.hints).toBeDefined();
    const hints = result.hints as Record<string, unknown>;
    expect(Array.isArray(hints.callers)).toBe(true);
  });

  it('adds a warning only when the final full payload exceeds the compact budget threshold', async () => {
    const oversizedSummary = 'Token-heavy summary '.repeat(1200);
    const oversizedSnippet = 'const token = authService.getToken();\n'.repeat(600);
    searchMocks.search.mockResolvedValueOnce([
      makeResult({
        summary: oversizedSummary,
        snippet: oversizedSnippet
      })
    ]);

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
        arguments: { query: 'auth service', mode: 'full', includeSnippets: true }
      }
    });

    const payload = JSON.parse(response.content[0].text) as {
      searchQuality: {
        status: string;
        confidence: string;
        tokenEstimate: number;
        warning?: string;
        hint?: string;
        rerankerStatus?: string;
      };
      [key: string]: unknown;
    };

    expect(payload.searchQuality.tokenEstimate).toBe(Math.ceil(response.content[0].text.length / 4));
    expect(payload.searchQuality.tokenEstimate).toBeGreaterThan(4000);
    expect(payload.searchQuality.warning).toBe(
      `Large search payload: estimated ${payload.searchQuality.tokenEstimate} tokens. Prefer compact mode or tighter filters before pasting into an agent.`
    );
  });

  // Test 6: relevanceReason appears in results in both modes
  it('relevanceReason is included in results for both compact and full modes', async () => {
    searchMocks.search.mockResolvedValueOnce([
      makeResult({ relevanceReason: 'Token management for auth flows' })
    ]);

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

    // Compact mode
    const compactResponse = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_codebase', arguments: { query: 'auth token' } }
    });
    const compactPayload = JSON.parse(compactResponse.content[0].text) as {
      results: Array<{ relevanceReason?: string }>;
    };
    expect(compactPayload.results[0].relevanceReason).toBe('Token management for auth flows');

    searchMocks.search.mockResolvedValueOnce([
      makeResult({ relevanceReason: 'Token management for auth flows' })
    ]);

    // Full mode
    const fullResponse = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'search_codebase', arguments: { query: 'auth token', mode: 'full' } }
    });
    const fullPayload = JSON.parse(fullResponse.content[0].text) as {
      results: Array<{ relevanceReason?: string }>;
    };
    expect(fullPayload.results[0].relevanceReason).toBe('Token management for auth flows');
  });

  // Test 7: consumers field is absent in both modes
  it('consumers field is absent from hints in both compact and full modes', async () => {
    searchMocks.search.mockResolvedValueOnce([makeResult()]);

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

    // Compact
    const compactResp = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_codebase', arguments: { query: 'auth service' } }
    });
    const compactPayload = JSON.parse(compactResp.content[0].text) as {
      results: Array<Record<string, unknown>>;
    };
    const compactResult = compactPayload.results[0];
    expect(compactResult.consumers).toBeUndefined();
    if (compactResult.hints) {
      expect((compactResult.hints as Record<string, unknown>).consumers).toBeUndefined();
    }

    searchMocks.search.mockResolvedValueOnce([makeResult()]);

    // Full
    const fullResp = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'search_codebase', arguments: { query: 'auth service', mode: 'full' } }
    });
    const fullPayload = JSON.parse(fullResp.content[0].text) as {
      results: Array<Record<string, unknown>>;
    };
    const fullResult = fullPayload.results[0];
    expect(fullResult.consumers).toBeUndefined();
    if (fullResult.hints) {
      expect((fullResult.hints as Record<string, unknown>).consumers).toBeUndefined();
    }
  });

  // Test 8: Strongly relevant memory filter — weak matches excluded in compact, included in full
  it('compact mode excludes weak memories; full mode includes all keyword-matched memories', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    // Seed a memory file with a weak (single-term) match memory
    const ctxDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
    await fs.writeFile(
      path.join(ctxDir, 'memories.json'),
      JSON.stringify([
        {
          id: 'mem001',
          type: 'convention',
          category: 'auth',
          memory: 'Always inject AuthService via constructor, never manually instantiate',
          reason: 'Ensures testability and DI compliance',
          date: new Date().toISOString(),
          source: 'user'
        },
        {
          id: 'mem002',
          type: 'convention',
          category: 'general',
          // This memory only matches a single stop word from the query — should be excluded in compact
          memory: 'Use consistent spacing',
          reason: 'Style guide compliance',
          date: new Date().toISOString(),
          source: 'user'
        }
      ]),
      'utf-8'
    );

    // Query with multiple non-stop-word terms that match mem001 but not mem002
    searchMocks.search.mockResolvedValueOnce([makeResult()]);

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

    // Compact: only strongly relevant memories (≥2 non-stop-word matches + confidence ≥ 0.5)
    const compactResp = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'inject AuthService constructor testing' }
      }
    });
    const compactPayload = JSON.parse(compactResp.content[0].text) as {
      relatedMemories?: string[];
    };
    // mem001 matches "inject", "AuthService", "constructor" — strong match
    // mem002 only matches "spacing" (if at all) — weak/no match → excluded
    if (compactPayload.relatedMemories) {
      expect(compactPayload.relatedMemories.some((m) => m.includes('AuthService'))).toBe(true);
      expect(compactPayload.relatedMemories.some((m) => m.includes('consistent spacing'))).toBe(
        false
      );
    }

    searchMocks.search.mockResolvedValueOnce([makeResult()]);

    // Full: all keyword-matched memories (single-term match is sufficient)
    const fullResp = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: { query: 'inject AuthService constructor testing', mode: 'full' }
      }
    });
    const fullPayload = JSON.parse(fullResp.content[0].text) as {
      relatedMemories?: string[];
    };
    // Full mode: keyword match (any term). "inject" matches mem001.
    if (fullPayload.relatedMemories) {
      expect(fullPayload.relatedMemories.some((m) => m.includes('AuthService'))).toBe(true);
    }
  });
});
