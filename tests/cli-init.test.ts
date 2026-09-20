import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// Mock node:fs/promises at the top level so Vitest can hoist it correctly.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('child_process', () => ({
  execFileSync: vi.fn()
}));

import * as fsMod from 'node:fs/promises';
import * as childProcess from 'child_process';
import {
  generateMcpConfig,
  generateInstructionBlock,
  resolveInstructionFilePath,
  _appendInstructionBlock,
  _buildMergedMcpContent,
  _runMcpRegistration
} from '../src/cli-init.js';

// --- generateMcpConfig ---

describe('generateMcpConfig', () => {
  const repoPath = '/test/repo';

  it('defaults Claude Code to an absolute-path stdio registration', () => {
    const result = generateMcpConfig('claude-code', repoPath);
    expect(result.kind).toBe('command');
    if (result.kind !== 'command') return;
    expect(result.args[0]).toBe('mcp');
    expect(result.args).toContain('--transport');
    expect(result.args).toContain('stdio');
    expect(result.args).toContain('codebase-context');
    expect(result.args).toContain('--');
    expect(result.command).toBe('claude');
    expect(result.args).toEqual([
      'mcp',
      'add',
      '--transport',
      'stdio',
      'codebase-context',
      '--',
      'npx',
      '-y',
      'codebase-context',
      repoPath
    ]);
  });

  it('cursor defaults to a path-scoped stdio config', () => {
    const result = generateMcpConfig('cursor', repoPath);
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe('.cursor/mcp.json');
    const parsed = JSON.parse(result.content) as {
      mcpServers: { 'codebase-context': { command: string; args: string[] } };
    };
    expect(parsed.mcpServers['codebase-context']).toEqual({
      command: 'npx',
      args: ['-y', 'codebase-context', repoPath]
    });
  });

  it('Codex defaults to the current documented stdio syntax', () => {
    const result = generateMcpConfig('codex', repoPath);
    expect(result.kind).toBe('command');
    if (result.kind !== 'command') return;
    expect(result.command).toBe('codex');
    expect(result.args).toEqual([
      'mcp',
      'add',
      'codebase-context',
      '--',
      'npx',
      '-y',
      'codebase-context',
      repoPath
    ]);
  });

  it('OpenCode defaults to a path-scoped local config', () => {
    const result = generateMcpConfig('opencode', repoPath);
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe('opencode.json');
    const parsed = JSON.parse(result.content) as {
      mcp: { 'codebase-context': { type: string; command: string[]; enabled: boolean } };
    };
    expect(parsed.mcp['codebase-context']).toEqual({
      type: 'local',
      command: ['npx', '-y', 'codebase-context', repoPath],
      enabled: true
    });
  });

  it('keeps HTTP explicit and generates current Claude/Codex registrations', () => {
    const claude = generateMcpConfig('claude-code', repoPath, 'http');
    const codex = generateMcpConfig('codex', repoPath, 'http');

    expect(claude).toEqual({
      kind: 'command',
      command: 'claude',
      args: ['mcp', 'add', '--transport', 'http', 'codebase-context', 'http://127.0.0.1:3100/mcp']
    });
    expect(codex).toEqual({
      kind: 'command',
      command: 'codex',
      args: ['mcp', 'add', 'codebase-context', '--url', 'http://127.0.0.1:3100/mcp']
    });
  });
});

// --- generateInstructionBlock ---

describe('generateInstructionBlock', () => {
  it('contains opening and closing delimiters', () => {
    const block = generateInstructionBlock();
    expect(block).toContain('<!-- codebase-context:start -->');
    expect(block).toContain('<!-- codebase-context:end -->');
  });

  it('contains all five tool call rules', () => {
    const block = generateInstructionBlock();
    expect(block).toContain('codebase://context');
    expect(block).toContain('get_memory');
    expect(block).toContain('search_codebase');
    expect(block).toContain('get_team_patterns');
    expect(block).toContain('remember');
    expect(block).toContain('detect_circular_dependencies');
  });
});

describe('_runMcpRegistration', () => {
  const execFileSyncMock = vi.mocked(childProcess.execFileSync);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes the client executable separately from its mcp arguments', () => {
    const result = generateMcpConfig('claude-code', '/test/repo');
    if (result.kind !== 'command') throw new Error('expected command config');

    expect(_runMcpRegistration(result)).toBe(true);
    expect(execFileSyncMock).toHaveBeenCalledWith('claude', result.args, { stdio: 'inherit' });
  });

  it('returns false when the client executable is unavailable', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('missing executable');
    });
    const result = generateMcpConfig('codex', '/test/repo');
    if (result.kind !== 'command') throw new Error('expected command config');

    expect(_runMcpRegistration(result)).toBe(false);
  });
});

// --- resolveInstructionFilePath ---

describe('resolveInstructionFilePath', () => {
  const cwd = '/test-cwd';

  it('claude-code resolves to CLAUDE.md', () => {
    const result = resolveInstructionFilePath('claude-code', cwd);
    expect(result).toBe(path.join(cwd, 'CLAUDE.md'));
  });

  it('cursor resolves to .cursorrules', () => {
    const result = resolveInstructionFilePath('cursor', cwd);
    expect(result).toBe(path.join(cwd, '.cursorrules'));
  });

  it('codex resolves to AGENTS.md', () => {
    const result = resolveInstructionFilePath('codex', cwd);
    expect(result).toBe(path.join(cwd, 'AGENTS.md'));
  });

  it('opencode returns null', () => {
    const result = resolveInstructionFilePath('opencode', cwd);
    expect(result).toBeNull();
  });
});

// --- _appendInstructionBlock file-write behavior ---

describe('_appendInstructionBlock', () => {
  const accessMock = vi.mocked(fsMod.access);
  const readFileMock = vi.mocked(fsMod.readFile);
  const writeFileMock = vi.mocked(fsMod.writeFile);

  beforeEach(() => {
    vi.resetAllMocks();
    writeFileMock.mockResolvedValue(undefined);
  });

  it('appends block when file exists and block not yet present', async () => {
    // Simulate file exists (access resolves) and has content without the delimiter
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue('# existing content' as unknown as Buffer);

    await _appendInstructionBlock('/test/CLAUDE.md');

    expect(writeFileMock).toHaveBeenCalledOnce();
    const callArgs = writeFileMock.mock.calls[0] as [string, string, ...unknown[]];
    const content = callArgs[1];
    expect(content).toContain('# existing content');
    expect(content).toContain('<!-- codebase-context:start -->');
  });

  it('skips when block already present', async () => {
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(
      '# existing content\n<!-- codebase-context:start -->\nsome block\n<!-- codebase-context:end -->' as unknown as Buffer
    );

    const result = await _appendInstructionBlock('/test/CLAUDE.md');

    expect(result).toBe('preserved');
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('skips the current generated block without prompting or writing', async () => {
    readFileMock.mockResolvedValue(
      `prefix\n${generateInstructionBlock().trimEnd()}\nsuffix` as unknown as Buffer
    );

    const result = await _appendInstructionBlock('/test/AGENTS.md', {
      confirmUpgrade: async () => {
        throw new Error('current content must not prompt');
      }
    });

    expect(result).toBe('skipped');
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('preserves the whole file when instruction markers are duplicated or orphaned', async () => {
    for (const content of [
      `a\n<!-- codebase-context:start -->\none\n<!-- codebase-context:end -->\n<!-- codebase-context:start -->\ntwo\n<!-- codebase-context:end -->\nz`,
      'a\n<!-- codebase-context:end -->\nz'
    ]) {
      readFileMock.mockResolvedValue(content as unknown as Buffer);
      const result = await _appendInstructionBlock('/test/AGENTS.md', {
        confirmUpgrade: async () => {
          throw new Error('ambiguous markers must not prompt');
        }
      });
      expect(result).toBe('preserved');
      expect(writeFileMock).not.toHaveBeenCalled();
    }
  });

  it('upgrades an exact old generated block after explicit consent, preserving surrounding text', async () => {
    const legacy = `<!-- codebase-context:start -->
## Codebase Context (MCP)

**Start of every task:** Call \`get_memory\` to load team conventions before writing any code.

**Before editing existing code:** Call \`search_codebase\` with \`intent: "edit"\`. If the preflight card says \`ready: false\`, read the listed files before touching anything.

**Before writing new code:** Call \`get_team_patterns\` to check how the team handles DI, state, testing, and library wrappers — don't introduce a new pattern if one already exists.

**When asked to "remember" or "record" something:** Call \`remember\` immediately, before doing anything else.

**When adding imports that cross module boundaries:** Call \`detect_circular_dependencies\` with the relevant scope after adding the import.
<!-- codebase-context:end -->`;
    const existing = `# user prefix\n${legacy}\n# user suffix`;
    readFileMock.mockResolvedValue(existing as unknown as Buffer);

    const result = await _appendInstructionBlock('/test/AGENTS.md', {
      confirmUpgrade: async () => true
    });

    expect(result).toBe('upgraded');
    const content = (writeFileMock.mock.calls[0] as [string, string])[1];
    expect(content).toContain('# user prefix');
    expect(content).toContain('# user suffix');
    expect(content).toContain('Read `codebase://context`');
    expect(content).not.toContain('Call `get_memory` to load team conventions');
  });

  it('preserves the exact old block when upgrade consent is declined', async () => {
    const legacy = `<!-- codebase-context:start -->
## Codebase Context (MCP)

**Start of every task:** Call \`get_memory\` to load team conventions before writing any code.

**Before editing existing code:** Call \`search_codebase\` with \`intent: "edit"\`. If the preflight card says \`ready: false\`, read the listed files before touching anything.

**Before writing new code:** Call \`get_team_patterns\` to check how the team handles DI, state, testing, and library wrappers — don't introduce a new pattern if one already exists.

**When asked to "remember" or "record" something:** Call \`remember\` immediately, before doing anything else.

**When adding imports that cross module boundaries:** Call \`detect_circular_dependencies\` with the relevant scope after adding the import.
<!-- codebase-context:end -->`;
    readFileMock.mockResolvedValue(`prefix\n${legacy}\nsuffix` as unknown as Buffer);

    const result = await _appendInstructionBlock('/test/AGENTS.md', {
      confirmUpgrade: async () => false
    });

    expect(result).toBe('preserved');
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('recognizes and upgrades the legacy block with CRLF while retaining CRLF in the replacement', async () => {
    const legacy = `<!-- codebase-context:start -->
## Codebase Context (MCP)

**Start of every task:** Call \`get_memory\` to load team conventions before writing any code.

**Before editing existing code:** Call \`search_codebase\` with \`intent: "edit"\`. If the preflight card says \`ready: false\`, read the listed files before touching anything.

**Before writing new code:** Call \`get_team_patterns\` to check how the team handles DI, state, testing, and library wrappers — don't introduce a new pattern if one already exists.

**When asked to "remember" or "record" something:** Call \`remember\` immediately, before doing anything else.

**When adding imports that cross module boundaries:** Call \`detect_circular_dependencies\` with the relevant scope after adding the import.
<!-- codebase-context:end -->`.replace(/\n/g, '\r\n');
    readFileMock.mockResolvedValue(`prefix\r\n${legacy}\r\nsuffix` as unknown as Buffer);

    const result = await _appendInstructionBlock('/test/AGENTS.md', {
      confirmUpgrade: async () => true
    });

    expect(result).toBe('upgraded');
    const content = (writeFileMock.mock.calls[0] as [string, string])[1];
    expect(content).toContain('\r\n');
    expect(content).not.toMatch(/(^|[^\r])\n/);
    expect(content.startsWith('prefix\r\n')).toBe(true);
    expect(content.endsWith('\r\nsuffix')).toBe(true);
  });

  it('does not replace a customized block', async () => {
    readFileMock.mockResolvedValue(
      'prefix\n<!-- codebase-context:start -->\ncustom instructions\n<!-- codebase-context:end -->\nsuffix' as unknown as Buffer
    );

    const result = await _appendInstructionBlock('/test/AGENTS.md', {
      confirmUpgrade: async () => {
        throw new Error('custom content must not prompt');
      }
    });

    expect(result).toBe('preserved');
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('does not treat unreadable files as missing files', async () => {
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    readFileMock.mockRejectedValue(error);

    await expect(_appendInstructionBlock('/test/AGENTS.md')).rejects.toThrow('permission denied');
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});

describe('_buildMergedMcpContent', () => {
  const readFileMock = vi.mocked(fsMod.readFile);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('preserves existing cursor mcpServers entries and adds codebase-context', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          'existing-server': { type: 'http', url: 'http://127.0.0.1:4000/mcp' }
        },
        someOtherKey: true
      }) as unknown as Buffer
    );

    const generated = generateMcpConfig('cursor', '/test/repo', 'http');
    if (generated.kind !== 'file') throw new Error('expected file config');

    const merged = await _buildMergedMcpContent(
      '/test/.cursor/mcp.json',
      generated.content,
      'cursor'
    );
    const parsed = JSON.parse(merged.content) as {
      mcpServers: Record<string, { type: string; url: string }>;
      someOtherKey: boolean;
    };

    expect(merged.mergedFromExisting).toBe(true);
    expect(parsed.someOtherKey).toBe(true);
    expect(parsed.mcpServers['existing-server']).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:4000/mcp'
    });
    expect(parsed.mcpServers['codebase-context']).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:3100/mcp'
    });
  });

  it('preserves existing opencode mcp entries and updates codebase-context deterministically', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          'existing-server': { type: 'remote', url: 'http://127.0.0.1:5000/mcp' },
          'codebase-context': { type: 'remote', url: 'http://old-host/mcp' }
        },
        extra: 'value'
      }) as unknown as Buffer
    );

    const generated = generateMcpConfig('opencode', '/test/repo', 'http');
    if (generated.kind !== 'file') throw new Error('expected file config');

    const merged = await _buildMergedMcpContent(
      '/test/opencode.json',
      generated.content,
      'opencode'
    );
    const parsed = JSON.parse(merged.content) as {
      mcp: Record<string, { type: string; url: string }>;
      extra: string;
    };

    expect(merged.mergedFromExisting).toBe(true);
    expect(parsed.extra).toBe('value');
    expect(parsed.mcp['existing-server']).toEqual({
      type: 'remote',
      url: 'http://127.0.0.1:5000/mcp'
    });
    expect(parsed.mcp['codebase-context']).toEqual({
      type: 'remote',
      url: 'http://127.0.0.1:3100/mcp'
    });
  });
});
