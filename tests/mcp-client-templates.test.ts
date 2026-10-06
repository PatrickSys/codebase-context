import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function readJson(relPath: string): unknown {
  const content = readFileSync(resolve(root, relPath), 'utf8');
  return JSON.parse(content);
}

function readText(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// Template JSON validity
// ---------------------------------------------------------------------------

describe('templates/mcp/stdio/.mcp.json', () => {
  it('parses as valid JSON', () => {
    expect(() => readJson('templates/mcp/stdio/.mcp.json')).not.toThrow();
  });

  it('has an mcpServers key at the top level', () => {
    const config = readJson('templates/mcp/stdio/.mcp.json') as Record<string, unknown>;
    expect(config).toHaveProperty('mcpServers');
    expect(typeof config.mcpServers).toBe('object');
  });

  it('contains the codebase-context server entry', () => {
    const config = readJson('templates/mcp/stdio/.mcp.json') as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers).toHaveProperty('codebase-context');
  });

  it('server entry uses npx command', () => {
    const config = readJson('templates/mcp/stdio/.mcp.json') as {
      mcpServers: Record<string, { command?: string; args?: string[] }>;
    };
    const entry = config.mcpServers['codebase-context'];
    expect(entry.command).toBe('npx');
    expect(entry.args).toContain('codebase-context');
  });
});

describe('templates/mcp/http/.mcp.json', () => {
  it('parses as valid JSON', () => {
    expect(() => readJson('templates/mcp/http/.mcp.json')).not.toThrow();
  });

  it('has an mcpServers key at the top level', () => {
    const config = readJson('templates/mcp/http/.mcp.json') as Record<string, unknown>;
    expect(config).toHaveProperty('mcpServers');
  });

  it('contains the codebase-context server entry', () => {
    const config = readJson('templates/mcp/http/.mcp.json') as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers).toHaveProperty('codebase-context');
  });

  it('server entry points to the local HTTP endpoint', () => {
    const config = readJson('templates/mcp/http/.mcp.json') as {
      mcpServers: Record<string, { url?: string; type?: string }>;
    };
    const entry = config.mcpServers['codebase-context'];
    expect(entry.url).toBe('http://127.0.0.1:3100/mcp');
    expect(entry.type).toBe('http');
  });
});

// ---------------------------------------------------------------------------
// README links the shipped guide for advanced templates and covers target clients
// ---------------------------------------------------------------------------

describe('README.md client setup documentation', () => {
  const readme = readText('README.md');
  const clientSetup = readText('docs/client-setup.md');

  it('references the stdio template path', () => {
    expect(readme).toContain('./docs/client-setup.md');
    expect(clientSetup).toContain('templates/mcp/stdio/.mcp.json');
  });

  it('references the HTTP template path', () => {
    expect(readme).toContain('./docs/client-setup.md');
    expect(clientSetup).toContain('templates/mcp/http/.mcp.json');
  });

  it('mentions Claude Code', () => {
    expect(readme).toContain('Claude Code');
  });

  it('mentions Cursor', () => {
    expect(readme).toContain('Cursor');
  });

  it('mentions Codex', () => {
    expect(readme).toContain('Codex');
  });

  it('mentions Windsurf', () => {
    expect(readme).toContain('Windsurf');
  });

  it('links the advanced HTTP endpoint without making it the default setup', () => {
    expect(readme).toContain('./docs/client-setup.md');
    expect(readme).toContain('stdio');
    expect(clientSetup).toContain('127.0.0.1:3100/mcp');
    expect(clientSetup).toContain('not part of the default setup proof');
  });
});

// ---------------------------------------------------------------------------
// docs/capabilities.md transport notes
// ---------------------------------------------------------------------------

describe('docs/capabilities.md transport documentation', () => {
  const caps = readText('docs/capabilities.md');

  it('references the stdio template path', () => {
    expect(caps).toContain('templates/mcp/stdio/.mcp.json');
  });

  it('references the HTTP template path', () => {
    expect(caps).toContain('templates/mcp/http/.mcp.json');
  });

  it('mentions the HTTP endpoint URL', () => {
    expect(caps).toContain('127.0.0.1:3100/mcp');
  });

  it('covers all four target clients', () => {
    expect(caps).toContain('./client-setup.md');
    const clientSetup = readText('docs/client-setup.md');
    for (const client of ['Claude Code', 'Cursor', 'Codex', 'Windsurf']) {
      expect(clientSetup).toContain(client);
    }
  });

  it('states explicit selection as the portable default and scopes compatibility behavior', () => {
    expect(caps).toContain('portable default is explicit selection');
    expect(caps).toContain('absolute path as `project`');
    expect(caps).toContain('server returns `selection_required` instead of guessing');
    expect(caps).toContain('Roots are not required for the documented setup');
    expect(caps).toContain(
      'does not establish native agent continuation or concurrent HTTP isolation'
    );
  });
});

describe('docs/client-setup.md multi-project guidance', () => {
  const clientSetup = readText('docs/client-setup.md');

  it('documents the project routing contract', () => {
    expect(clientSetup).toContain("current repository's absolute path as `project`");
    expect(clientSetup).toContain(
      'Without a configured folder, known root or explicit selection, tools return `selection_required`'
    );
    expect(clientSetup).toContain("They do not guess or index the user's home directory");
    expect(clientSetup).toContain('One valid root can auto-select');
    expect(clientSetup).toContain(
      'several roots with no active selection return `selection_required`'
    );
    expect(clientSetup).toContain('Explicit selectors must stay within announced roots');
  });

  it('separates process-local routing proof from native and HTTP acceptance', () => {
    expect(clientSetup).toContain('A to B to A in one no-roots stdio process');
    expect(clientSetup).toContain('CBC routes omitted-project calls using its selected project');
    expect(clientSetup).toContain(
      'Select again after a server restart or when changing repositories'
    );
    expect(clientSetup).toContain('native retrieval and continuation did not pass');
    expect(clientSetup).toContain(
      'stdio process-local selection does not establish concurrent HTTP isolation'
    );
  });
});
