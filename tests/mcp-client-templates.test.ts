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
// README references templates and all four target clients
// ---------------------------------------------------------------------------

describe('README.md client setup documentation', () => {
  const readme = readText('README.md');

  it('references the stdio template path', () => {
    expect(readme).toContain('templates/mcp/stdio/.mcp.json');
  });

  it('references the HTTP template path', () => {
    expect(readme).toContain('templates/mcp/http/.mcp.json');
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

  it('includes the HTTP endpoint URL', () => {
    expect(readme).toContain('127.0.0.1:3100/mcp');
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
    expect(caps).toContain('Claude Code');
    expect(caps).toContain('Cursor');
    expect(caps).toContain('Codex');
    expect(caps).toContain('Windsurf');
  });

  it('states the roots-first routing fallback explicitly', () => {
    expect(caps).toContain('roots-capable hosts');
    expect(caps).toContain('explicit fallback is still required');
  });
});

describe('docs/client-setup.md multi-project guidance', () => {
  const clientSetup = readText('docs/client-setup.md');

  it('documents the project routing contract', () => {
    expect(clientSetup).toContain(
      'Automatic multi-project routing is evidence-backed only when the MCP host announces workspace roots.'
    );
    expect(clientSetup).toContain(
      'the server returns `selection_required` instead of guessing'
    );
  });

  it('keeps the three verification flows aligned with the roots-first contract', () => {
    expect(clientSetup).toContain('Multiple projects on a roots-capable host');
    expect(clientSetup).toContain('Ambiguous or no-roots selection');
  });
});
