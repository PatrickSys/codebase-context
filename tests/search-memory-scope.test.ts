import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { handle } from '../src/tools/search-codebase.js';
import type { ToolContext } from '../src/tools/types.js';

const searchMocks = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock('../src/core/search.js', async () => {
  class CodebaseSearcher {
    constructor(_rootPath: string) {}

    async search(query: string, limit: number, filters?: unknown) {
      return searchMocks.search(query, limit, filters);
    }

    async searchWithCoverage(query: string, limit: number, filters?: unknown) {
      return {
        results: await this.search(query, limit, filters),
        sourceCoverage: { status: 'current', checkedFiles: 1, skippedFiles: 0 }
      };
    }
  }

  return { CodebaseSearcher };
});

describe('search_codebase memory relevance at the tool seam', () => {
  let tempRoot: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    searchMocks.search.mockReset();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'search-memory-scope-'));
    const contextDir = path.join(tempRoot, '.codebase-context');
    await fs.mkdir(contextDir, { recursive: true });

    ctx = {
      indexState: { status: 'ready' },
      paths: {
        baseDir: contextDir,
        memory: path.join(contextDir, 'memory.json'),
        intelligence: path.join(contextDir, 'intelligence.json'),
        keywordIndex: path.join(contextDir, 'index.json'),
        vectorDb: path.join(contextDir, 'index')
      },
      rootPath: tempRoot,
      performIndexing: () => undefined
    };

    const date = new Date().toISOString();
    await fs.writeFile(
      ctx.paths.memory,
      JSON.stringify([
        {
          id: 'auth-path-only',
          type: 'decision',
          category: 'architecture',
          memory: 'Prefer React Signals for local view state',
          reason: 'Keep the widget state independent of network retry behavior.',
          date,
          scope: { kind: 'file', file: 'src/auth/auth.service.ts' }
        },
        {
          id: 'cross-file-auth-decision',
          type: 'decision',
          category: 'architecture',
          memory: 'Use AuthService for CLI token bootstrap',
          reason: 'Keep CLI setup on the shared token refresh path.',
          date,
          scope: {
            kind: 'symbol',
            file: 'src/auth/auth.service.ts',
            symbol: 'AuthService'
          }
        }
      ]),
      'utf-8'
    );
    await fs.writeFile(
      ctx.paths.intelligence,
      JSON.stringify({
        header: { buildId: 'scope-test-build', formatVersion: 1 },
        generatedAt: date,
        patterns: {},
        goldenFiles: []
      }),
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('excludes path-only auth memories while retaining a relevant cross-file decision', async () => {
    searchMocks.search.mockResolvedValueOnce([
      {
        summary: 'Auth CLI bootstrap',
        snippet: 'export function bootstrapAuthCli() { return authService.refreshToken(); }',
        filePath: 'src/cli/bootstrap.ts',
        startLine: 1,
        endLine: 4,
        score: 0.92,
        language: 'ts',
        metadata: { symbolName: 'bootstrapAuthCli', symbolKind: 'function' },
        relevanceReason: 'Matches auth CLI setup'
      }
    ]);

    const response = await handle({ query: 'auth CLI', intent: 'edit', mode: 'full' }, ctx);
    const payload = JSON.parse(response.content?.[0]?.text ?? '{}') as {
      relatedMemories?: string[];
    };

    expect(payload.relatedMemories).toContainEqual(
      expect.stringContaining('Use AuthService for CLI token bootstrap')
    );
    expect(payload.relatedMemories).not.toContainEqual(
      expect.stringContaining('Prefer React Signals for local view state')
    );
  });
});
