import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { handle } from '../src/tools/search-codebase.js';
import type { ToolContext } from '../src/tools/types.js';

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

describe('search_codebase scoped memories', () => {
  let tempRoot: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    searchMocks.search.mockReset();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'search-scoped-memory-'));

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

    await fs.writeFile(
      ctx.paths.memory,
      JSON.stringify(
        [
          {
            id: 'scoped-memory',
            type: 'gotcha',
            category: 'architecture',
            memory: 'Avoid direct token reads',
            reason: 'They bypass AuthService refresh logic.',
            date: '2026-04-17T00:00:00.000Z',
            scope: {
              kind: 'symbol',
              file: 'src/auth/auth.service.ts',
              symbol: 'AuthService'
            }
          },
          {
            id: 'global-memory',
            type: 'decision',
            category: 'architecture',
            memory: 'Use auth interceptors',
            reason: 'They keep HTTP token injection consistent.',
            date: '2026-04-17T00:00:00.000Z'
          }
        ],
        null,
        2
      )
    );

    await fs.writeFile(
      ctx.paths.intelligence,
      JSON.stringify(
        {
          header: { buildId: 'build-1', formatVersion: 1 },
          generatedAt: '2026-04-17T00:00:00.000Z',
          patterns: {
            stateManagement: {
              primary: {
                name: 'Signals',
                frequency: '78%',
                trend: 'Stable'
              }
            }
          },
          goldenFiles: [{ file: 'src/auth/auth.service.ts', score: 0.97 }]
        },
        null,
        2
      )
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('prioritizes scoped memories in search output', async () => {
    searchMocks.search.mockResolvedValueOnce([
      {
        summary: 'Auth service token management',
        snippet: 'export class AuthService { getToken() { return token; } }',
        filePath: 'src/auth/auth.service.ts',
        startLine: 1,
        endLine: 20,
        score: 0.91,
        language: 'ts',
        metadata: { symbolName: 'AuthService', symbolKind: 'class', symbolPath: ['AuthService'] },
        relevanceReason: 'Matches auth service token query'
      }
    ]);

    const response = await handle({ query: 'auth service token', intent: 'edit' }, ctx);
    const payload = JSON.parse(response.content?.[0]?.text ?? '{}') as {
      relatedMemories?: string[];
    };

    expect(payload.relatedMemories?.[0]).toContain('src/auth/auth.service.ts#AuthService');
  });
});
