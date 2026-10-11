import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import os from 'node:os';
import { promises as nativeFs } from 'node:fs';

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
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn()
}));

import * as fsMod from 'node:fs/promises';
import { select } from '@inquirer/prompts';
import {
  generateMcpConfig,
  generateInstructionBlock,
  resolveInstructionFilePath,
  _appendInstructionBlock,
  _buildMergedMcpContent,
  _mergeCodexMcpContent,
  handleInitCli
} from '../src/cli-init.js';

// --- generateMcpConfig ---

describe('generateMcpConfig', () => {
  it('claude-code returns a command with mcp add --transport http', () => {
    const result = generateMcpConfig('claude-code');
    expect(result.kind).toBe('command');
    if (result.kind !== 'command') return;
    expect(result.args[0]).toBe('mcp');
    expect(result.args).toContain('--transport');
    expect(result.args).toContain('http');
    expect(result.args).toContain('codebase-context');
    expect(result.args).toContain('http://127.0.0.1:3100/mcp');
  });

  it('cursor returns a file at .cursor/mcp.json with http type', () => {
    const result = generateMcpConfig('cursor');
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe('.cursor/mcp.json');
    const parsed = JSON.parse(result.content) as {
      mcpServers: { 'codebase-context': { type: string } };
    };
    expect(parsed.mcpServers['codebase-context'].type).toBe('http');
  });

  it('codex returns project-scoped stdio config for the selected root', () => {
    const result = generateMcpConfig('codex');
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toContain(path.join('.codex', 'config.toml'));
    expect(result.content).toContain(`command = ${JSON.stringify(process.execPath)}`);
    expect(result.content).toContain(
      `args = [${JSON.stringify(path.resolve(process.argv[1] ?? ''))},`
    );
    expect(result.content).not.toContain('http://');
  });

  it('Codex setup targets this installed CLI through project-scoped stdio config', () => {
    const root = path.resolve('project with spaces');
    const result = generateMcpConfig('codex', root);
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe(path.join(root, '.codex', 'config.toml'));
    expect(result.content).toContain('command =');
    expect(result.content).toContain('cwd =');
    expect(result.content).toContain('args =');
    expect(result.content).not.toContain('http://');
    expect(result.content).not.toContain('codebase-context@2.2.0');
    expect(result.content).toContain(JSON.stringify(root));
  });

  it('opencode returns a file at opencode.json with remote type', () => {
    const result = generateMcpConfig('opencode');
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe('opencode.json');
    const parsed = JSON.parse(result.content) as {
      mcp: { 'codebase-context': { type: string } };
    };
    expect(parsed.mcp['codebase-context'].type).toBe('remote');
  });
});

describe('_mergeCodexMcpContent', () => {
  const generated =
    '[mcp_servers.codebase-context]\ncommand = "node"\ncwd = "C:/project with spaces"\nargs = ["C:/package/dist/index.js", "C:/project with spaces"]\n';

  it('preserves unrelated TOML and appends project server settings', () => {
    const result = _mergeCodexMcpContent('[profiles.safe]\nmodel = "gpt-6"\n', generated);
    expect(result.changed).toBe(true);
    expect(result.content).toContain('[profiles.safe]\nmodel = "gpt-6"');
    expect(result.content).toContain(generated);
  });

  it('leaves a matching entry unchanged and refuses to overwrite a conflict', () => {
    const existing = `# preserved\n${generated}enabled = true\ncustom_setting = "preserve me"\n`;
    expect(_mergeCodexMcpContent(existing, generated)).toEqual({
      content: existing,
      changed: false
    });
    expect(() =>
      _mergeCodexMcpContent(existing.replace('command = "node"', 'command = "other"'), generated)
    ).toThrow('conflict');
  });

  it('refuses to treat an explicitly disabled server as a ready idempotent entry', () => {
    const disabled = `${generated}enabled = false\n`;
    expect(() => _mergeCodexMcpContent(disabled, generated)).toThrow(/disabled/i);
  });
});

describe('Codex global config alias protection', () => {
  it('rejects CODEX_HOME when a junction aliases the project .codex directory', async () => {
    const tempRoot = await nativeFs.mkdtemp(path.join(os.tmpdir(), 'cbc codex alias '));
    const projectRoot = path.join(tempRoot, 'project');
    const projectCodex = path.join(projectRoot, '.codex');
    const globalAlias = path.join(tempRoot, 'codex-home-alias');
    const oldCodexHome = process.env.CODEX_HOME;
    const oldExitCode = process.exitCode;
    try {
      await nativeFs.mkdir(projectCodex, { recursive: true });
      await nativeFs.symlink(
        projectCodex,
        globalAlias,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      process.env.CODEX_HOME = globalAlias;
      process.exitCode = 0;
      vi.mocked(fsMod.writeFile).mockClear().mockResolvedValue(undefined);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await handleInitCli(['--client', 'codex', '--yes', '--root', projectRoot], {
        prepareIndex: async () => ({ status: 'ready' })
      });

      expect(process.exitCode).toBe(1);
      expect(errors.mock.calls.flat().join('\n')).toMatch(/global config/i);
      expect(fsMod.writeFile).not.toHaveBeenCalled();
      errors.mockRestore();
      output.mockRestore();
    } finally {
      if (oldCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = oldCodexHome;
      process.exitCode = oldExitCode;
      await nativeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('non-interactive init arguments', () => {
  it('prints init help without invoking the client picker', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(select).mockClear();
    const previousExitCode = process.exitCode;
    await handleInitCli(['--help']);
    expect(output.mock.calls.flat().join('\n')).toContain('--client <name>');
    expect(select).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(previousExitCode);
    output.mockRestore();
  });

  it('rejects an unknown client with a nonzero exit code', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const previousExitCode = process.exitCode;
    process.exitCode = 0;
    await handleInitCli(['--client', 'unknown', '--yes']);
    expect(process.exitCode).toBe(1);
    expect(errors.mock.calls.flat().join('\n')).toContain('Unknown client');
    process.exitCode = previousExitCode;
    errors.mockRestore();
  });

  it('rejects missing flag values and --yes without a client', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const previousExitCode = process.exitCode;
    for (const argv of [['--client', '--yes'], ['--root'], ['--yes']]) {
      process.exitCode = 0;
      await handleInitCli(argv);
      expect(process.exitCode).toBe(1);
    }
    expect(errors.mock.calls.flat().join('\n')).toContain('requires a value');
    expect(errors.mock.calls.flat().join('\n')).toContain('--yes requires --client');
    process.exitCode = previousExitCode;
    errors.mockRestore();
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
    expect(block).toContain('get_memory');
    expect(block).toContain('search_codebase');
    expect(block).toContain('get_team_patterns');
    expect(block).toContain('remember');
    expect(block).toContain('detect_circular_dependencies');
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

    expect(result).toBe('skipped');
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

    const generated = generateMcpConfig('cursor');
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

    const generated = generateMcpConfig('opencode');
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
