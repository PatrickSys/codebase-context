import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { rmWithRetries } from './test-helpers.js';

vi.mock('../src/core/reranker.js', () => ({
  rerank: vi.fn(async (_query: string, results: unknown) => results),
  getRerankerStatus: vi.fn(() => 'fallback'),
  isAmbiguous: vi.fn(() => false)
}));

const SLOW_WINDOWS_TEST_TIMEOUT_MS = 60000;

describe('Search Snippets with Scope Headers', () => {
  let tempRoot: string | null = null;

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'search-snippets-test-'));
    process.env.CODEBASE_ROOT = tempRoot;
    process.argv[2] = tempRoot;

    const srcDir = path.join(tempRoot, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    // File with class and methods
    await fs.writeFile(
      path.join(srcDir, 'auth.service.ts'),
      `
export class AuthService {
  /**
   * Get authentication token
   */
  getToken(): string {
    const token = localStorage.getItem('auth_token');
    return token || '';
  }

  /**
   * Refresh token from server
   */
  refreshToken(): Promise<string> {
    return fetch('/api/refresh')
      .then(res => res.json())
      .then(data => data.token);
  }

  /**
   * Validate token format
   */
  validateToken(token: string): boolean {
    return token && token.length > 0;
  }

  /**
   * Clear stored token
   */
  clearToken(): void {
    localStorage.removeItem('auth_token');
  }
}
`
    );

    // File with standalone functions
    await fs.writeFile(
      path.join(srcDir, 'utils.ts'),
      `
export function formatDate(date: Date): string {
  return date.toISOString();
}

export function parseJSON(str: string): any {
  return JSON.parse(str);
}

export class DataProcessor {
  process(data: any): void {
    console.log(data);
  }
}
`
    );

    // File with no meaningful structure
    await fs.writeFile(
      path.join(srcDir, 'constants.ts'),
      `
export const API_URL = 'https://api.example.com';
export const TIMEOUT = 5000;
export const VERSION = '1.0.0';
`
    );

    // Index the project
    const indexer = new CodebaseIndexer({
      rootPath: tempRoot,
      config: { skipEmbedding: true }
    });
    await indexer.index();
  }, SLOW_WINDOWS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    if (tempRoot) {
      await rmWithRetries(tempRoot);
      tempRoot = null;
    }
    delete process.env.CODEBASE_ROOT;
  }, SLOW_WINDOWS_TEST_TIMEOUT_MS);

  it('returns snippets when includeSnippets=true', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'getToken',
          mode: 'full',
          includeSnippets: true
        }
      }
    });

    const content = response.content[0];
    const parsed = JSON.parse(content.text);

    expect(parsed.results).toBeDefined();
    expect(parsed.results.length).toBeGreaterThan(0);

    const withSnippets = parsed.results.filter((r: any) => r.snippet);
    expect(withSnippets.length).toBeGreaterThan(0);
  }, SLOW_WINDOWS_TEST_TIMEOUT_MS);

  it('scope header is a comment line starting with //', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'getToken',
          mode: 'full',
          includeSnippets: true
        }
      }
    });

    const content = response.content[0];
    const parsed = JSON.parse(content.text);

    const withSnippet = parsed.results.find((r: any) => r.snippet);
    if (withSnippet && withSnippet.snippet) {
      const firstLine = withSnippet.snippet.split('\n')[0];
      // Scope header should be a comment line
      expect(firstLine).toMatch(/^\/\//);
    }
  });

  it('does not include snippet when includeSnippets=false', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'getToken',
          includeSnippets: false
        }
      }
    });

    const content = response.content[0];
    const parsed = JSON.parse(content.text);

    // No results should have snippet field
    parsed.results.forEach((r: any) => {
      expect(r.snippet).toBeUndefined();
    });
  });

  it('snippet is a string starting with code or comment', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'formatDate',
          mode: 'full',
          includeSnippets: true
        }
      }
    });

    const content = response.content[0];
    const parsed = JSON.parse(content.text);

    const withSnippet = parsed.results.find((r: any) => r.snippet);
    if (withSnippet && withSnippet.snippet) {
      expect(typeof withSnippet.snippet).toBe('string');
      expect(withSnippet.snippet.length).toBeGreaterThan(0);
    }
  });
});
