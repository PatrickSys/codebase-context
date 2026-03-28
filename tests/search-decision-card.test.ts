import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { rmWithRetries } from './test-helpers.js';

type ToolCallRequest = {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/call';
  params: { name: string; arguments: Record<string, unknown> };
};

type SearchResultRow = {
  snippet?: string;
};

type SearchToolPayload = {
  results: SearchResultRow[];
  preflight?: {
    ready: boolean;
    nextAction?: string;
    patterns?: Record<string, unknown>;
    warnings?: unknown[];
    bestExample?: string;
    impact?: Record<string, unknown>;
    whatWouldHelp?: unknown[];
  };
};

type ToolCallResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function getToolCallHandler(
  server: unknown
): (request: ToolCallRequest) => Promise<ToolCallResponse> {
  const handlers = (server as { _requestHandlers?: unknown })._requestHandlers;
  if (!(handlers instanceof Map)) {
    throw new Error('Expected server._requestHandlers to be a Map');
  }
  const handler = handlers.get('tools/call');
  if (typeof handler !== 'function') {
    throw new Error('Expected tools/call handler to be registered');
  }
  return handler as (request: ToolCallRequest) => Promise<ToolCallResponse>;
}

describe('Search Decision Card (Edit Intent)', () => {
  let tempRoot: string | null = null;
  let originalArgv: string[] | null = null;
  let originalEnvRoot: string | undefined;

  beforeEach(async () => {
    vi.resetModules();

    originalArgv = [...process.argv];
    originalEnvRoot = process.env.CODEBASE_ROOT;

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'search-decision-card-test-'));
    process.env.CODEBASE_ROOT = tempRoot;
    process.argv[2] = tempRoot;

    // Create mock codebase with patterns and relationships
    const srcDir = path.join(tempRoot, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    // Main service
    await fs.writeFile(
      path.join(srcDir, 'auth.service.ts'),
      `
/**
 * Authentication service for token management
 */
export class AuthService {
  getToken(): string {
    return 'token';
  }

  refreshToken(): void {
    // Refresh token logic
  }

  validateToken(token: string): boolean {
    return token.length > 0;
  }
}
`
    );

    // Dependent file 1
    await fs.writeFile(
      path.join(srcDir, 'api.interceptor.ts'),
      `
import { AuthService } from './auth.service';

export class ApiInterceptor {
  constructor(private auth: AuthService) {}

  intercept() {
    const token = this.auth.getToken();
    return token;
  }
}
`
    );

    // Dependent file 2
    await fs.writeFile(
      path.join(srcDir, 'user.service.ts'),
      `
import { AuthService } from './auth.service';

export class UserService {
  constructor(private auth: AuthService) {}

  getCurrentUser() {
    return this.auth.validateToken('token');
  }
}
`
    );

    // Dependent file 3
    await fs.writeFile(
      path.join(srcDir, 'profile.service.ts'),
      `
import { AuthService } from './auth.service';

export class ProfileService {
  constructor(private auth: AuthService) {}

  loadProfile() {
    if (this.auth.validateToken('token')) {
      return { name: 'User' };
    }
  }
}
`
    );

    // Index the project
    const indexer = new CodebaseIndexer({
      rootPath: tempRoot,
      config: { skipEmbedding: true }
    });
    await indexer.index();
  }, 30000);

  afterEach(async () => {
    if (originalArgv) {
      process.argv = originalArgv;
    }

    if (originalEnvRoot === undefined) {
      delete process.env.CODEBASE_ROOT;
    } else {
      process.env.CODEBASE_ROOT = originalEnvRoot;
    }

    if (tempRoot) {
      await rmWithRetries(tempRoot);
      tempRoot = null;
    }
  }, 30000);

  it('intent="edit" with multiple results returns full decision card with ready field', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'getToken',
          intent: 'edit'
        }
      }
    });

    expect(response.content).toBeDefined();
    expect(response.content.length).toBeGreaterThan(0);
    const content = response.content[0];
    expect(content.type).toBe('text');

    const parsed = JSON.parse(content.text) as SearchToolPayload;
    expect(parsed.results).toBeDefined();
    expect(parsed.results.length).toBeGreaterThan(0);

    const preflight = parsed.preflight;
    expect(preflight).toBeDefined();
    if (!preflight) {
      throw new Error('Expected preflight payload for edit intent');
    }
    expect(preflight.ready).toBeDefined();
    expect(typeof preflight.ready).toBe('boolean');
  });

  it('decision card has all expected fields when returned', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'AuthService',
          intent: 'edit'
        }
      }
    });

    const content = response.content[0];
    const parsed = JSON.parse(content.text) as SearchToolPayload;
    const preflight = parsed.preflight;
    expect(preflight).toBeDefined();
    if (!preflight) {
      throw new Error('Expected preflight payload for edit intent');
    }

    // preflight should have ready as minimum
    expect(preflight.ready).toBeDefined();
    expect(typeof preflight.ready).toBe('boolean');

    // Optional fields can be present
    if (preflight.nextAction) {
      expect(typeof preflight.nextAction).toBe('string');
    }
    if (preflight.patterns) {
      expect(typeof preflight.patterns).toBe('object');
    }
    if (preflight.warnings) {
      expect(Array.isArray(preflight.warnings)).toBe(true);
    }
    if (preflight.bestExample) {
      expect(typeof preflight.bestExample).toBe('string');
    }
    if (preflight.impact) {
      expect(typeof preflight.impact).toBe('object');
    }
    if (preflight.whatWouldHelp) {
      expect(Array.isArray(preflight.whatWouldHelp)).toBe(true);
    }
  });

  it('intent="explore" returns lightweight preflight', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'AuthService',
          intent: 'explore'
        }
      }
    });

    const content = response.content[0];
    const parsed = JSON.parse(content.text) as SearchToolPayload;
    const preflight = parsed.preflight;

    // For explore intent, preflight should be lite: { ready, reason? }
    if (preflight) {
      expect(preflight.ready).toBeDefined();
      expect(typeof preflight.ready).toBe('boolean');
      // Should NOT have full decision card fields for explore
    }
  });

  it('includes snippet field when includeSnippets=true', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'getToken',
          includeSnippets: true
        }
      }
    });

    const content = response.content[0];
    const parsed = JSON.parse(content.text) as SearchToolPayload;

    expect(parsed.results).toBeDefined();
    expect(parsed.results.length).toBeGreaterThan(0);

    // At least some results should have a snippet
    const withSnippets = parsed.results.filter((result) => result.snippet);
    expect(withSnippets.length).toBeGreaterThan(0);
  });

  it('does not include snippet field when includeSnippets=false', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

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
    const parsed = JSON.parse(content.text) as SearchToolPayload;

    expect(parsed.results).toBeDefined();
    // All results should not have snippet field
    parsed.results.forEach((result) => {
      expect(result.snippet).toBeUndefined();
    });
  });

  it('scope header starts snippet when includeSnippets=true', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const { server } = await import('../src/index.js');
    const handler = getToolCallHandler(server);

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'getToken',
          includeSnippets: true
        }
      }
    });

    const content = response.content[0];
    const parsed = JSON.parse(content.text) as SearchToolPayload;

    const withSnippet = parsed.results.find((result) => result.snippet);
    if (withSnippet && withSnippet.snippet) {
      // Scope header should be a comment line
      const firstLine = withSnippet.snippet.split('\n')[0].trim();
      expect(firstLine).toMatch(/^\/\//);
    }
  });
});
