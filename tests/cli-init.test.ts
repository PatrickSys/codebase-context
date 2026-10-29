import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { homedir } from 'node:os';

// Mock node:fs/promises at the top level so Vitest can hoist it correctly.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    access: vi.fn(),
    lstat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
  };
});

import * as fsMod from 'node:fs/promises';
import {
  generateMcpConfig,
  generateInstructionBlock,
  resolveInstructionFilePath,
  handleInitCli,
  _appendInstructionBlock,
  _buildMergedMcpContent,
  _buildCodexMcpContent
} from '../src/cli-init.js';

// --- generateMcpConfig ---

describe('generateMcpConfig', () => {
  it('claude-code exposes the executable and exact project-scoped stdio argv', () => {
    expect(generateMcpConfig('claude-code')).toEqual({
      kind: 'command',
      executable: 'claude',
      args: [
        'mcp',
        'add',
        '--scope',
        'project',
        'codebase-context',
        '--',
        'npx',
        '-y',
        'codebase-context'
      ]
    });
  });

  it('cursor returns a project stdio file at .cursor/mcp.json', () => {
    const result = generateMcpConfig('cursor');
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe('.cursor/mcp.json');
    const parsed = JSON.parse(result.content) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.mcpServers['codebase-context']).toEqual({
      command: 'npx',
      args: ['-y', 'codebase-context']
    });
  });

  it('codex writes a project config with an absolute root argument', () => {
    const root = path.resolve('projects/example');
    const result = generateMcpConfig('codex', root);
    expect(result).toEqual({
      kind: 'file',
      path: path.join(root, '.codex', 'config.toml'),
      content:
        '[mcp_servers.codebase-context]\n' +
        'command = "npx"\n' +
        `cwd = ${JSON.stringify(root)}\n` +
        `args = ["-y", "codebase-context", ${JSON.stringify(root)}]\n`
    });
  });

  it('opencode returns the stable local config with an enabled 120-second timeout', () => {
    const result = generateMcpConfig('opencode');
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe('opencode.json');
    const parsed = JSON.parse(result.content) as {
      mcp: Record<string, unknown>;
    };
    expect(parsed.mcp['codebase-context']).toEqual({
      type: 'local',
      command: ['npx', '-y', 'codebase-context'],
      enabled: true,
      timeout: 120000
    });
  });
});

describe('_executeMcpCommand', () => {
  it('passes the explicit executable and argv to the injected runner', async () => {
    const { _executeMcpCommand } = await import('../src/cli-init.js');
    const config = generateMcpConfig('claude-code');
    if (config.kind !== 'command') throw new Error('expected command config');
    const runner = vi.fn();

    _executeMcpCommand(config, runner);

    expect(runner).toHaveBeenCalledExactlyOnceWith('claude', config.args, { stdio: 'inherit' });
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

  it('codex leaves AGENTS.md untouched', () => {
    const result = resolveInstructionFilePath('codex', cwd);
    expect(result).toBeNull();
  });

  it('opencode returns null', () => {
    const result = resolveInstructionFilePath('opencode', cwd);
    expect(result).toBeNull();
  });
});

describe('_buildCodexMcpContent', () => {
  const readFileMock = vi.mocked(fsMod.readFile);
  const lstatMock = vi.mocked(fsMod.lstat);
  const writeFileMock = vi.mocked(fsMod.writeFile);

  beforeEach(() => {
    vi.resetAllMocks();
    writeFileMock.mockResolvedValue(undefined);
    lstatMock.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => true } as Awaited<
      ReturnType<typeof fsMod.lstat>
    >);
  });

  it('preserves unrelated TOML text and adds the project server', async () => {
    const existing = '# keep this comment\n[other]\nvalue = "preserved"\n';
    readFileMock.mockResolvedValue(existing as unknown as Buffer);
    const root = path.resolve('project');
    const generated = generateMcpConfig('codex', root);
    if (generated.kind !== 'file') throw new Error('expected file config');

    const merged = await _buildCodexMcpContent(generated.path, generated.content, root);

    expect(merged.changed).toBe(true);
    expect(merged.content).toBe(existing + '\n' + generated.content);
  });

  it('is idempotent when the existing project server matches', async () => {
    const root = path.resolve('project');
    const generated = generateMcpConfig('codex', root);
    if (generated.kind !== 'file') throw new Error('expected file config');
    readFileMock.mockResolvedValue(generated.content as unknown as Buffer);

    const merged = await _buildCodexMcpContent(generated.path, generated.content, root);

    expect(merged).toEqual({ content: generated.content, changed: false });
  });

  it('fails clearly for malformed TOML and conflicting server settings', async () => {
    const root = path.resolve('project');
    const generated = generateMcpConfig('codex', root);
    if (generated.kind !== 'file') throw new Error('expected file config');

    readFileMock.mockResolvedValue('not valid toml' as unknown as Buffer);
    await expect(_buildCodexMcpContent(generated.path, generated.content, root)).rejects.toThrow(
      /Cannot parse Codex config/
    );

    readFileMock.mockResolvedValue(
      '[mcp_servers.codebase-context]\ncommand = "other"\nargs = []\n' as unknown as Buffer
    );
    await expect(_buildCodexMcpContent(generated.path, generated.content, root)).rejects.toThrow(
      /conflict/
    );
  });

  it('refuses linked or unreadable config files', async () => {
    const root = path.resolve('project');
    const generated = generateMcpConfig('codex', root);
    if (generated.kind !== 'file') throw new Error('expected file config');

    lstatMock.mockResolvedValue({ isSymbolicLink: () => true } as Awaited<ReturnType<typeof fsMod.lstat>>);
    await expect(_buildCodexMcpContent(generated.path, generated.content, root)).rejects.toThrow(
      /symbolic link/
    );

    lstatMock.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => true } as Awaited<
      ReturnType<typeof fsMod.lstat>
    >);
    const denied = Object.assign(new Error('access denied'), { code: 'EACCES' });
    readFileMock.mockRejectedValue(denied);
    await expect(_buildCodexMcpContent(generated.path, generated.content, root)).rejects.toThrow(
      /Cannot read Codex config/
    );
  });
});

describe('handleInitCli Codex flow', () => {
  const lstatMock = vi.mocked(fsMod.lstat);
  const writeFileMock = vi.mocked(fsMod.writeFile);

  beforeEach(() => {
    vi.resetAllMocks();
    lstatMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    writeFileMock.mockResolvedValue(undefined);
    process.exitCode = undefined;
  });

  it('reports index failure and leaves the instruction path untouched', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const prepareIndex = vi.fn().mockResolvedValue({ status: 'error', error: 'disk full' as string });
    const root = path.resolve('.');

    await handleInitCli(['--client', 'codex', '--yes', '--root', root], { prepareIndex });

    expect(prepareIndex).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith('Index preparation failed: disk full');
    expect(errorSpy).toHaveBeenCalledWith(
      `Next action: change directory to "${root}" and run npx codebase-context reindex`
    );
    expect(process.exitCode).toBe(1);
    expect(writeFileMock).not.toHaveBeenCalledWith(expect.stringContaining('AGENTS.md'), expect.anything(), 'utf8');
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('refuses a project root whose config is the CODEX_HOME global config', async () => {
    const root = path.resolve('.');
    const originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(root, '.codex');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const prepareIndex = vi.fn();

    await handleInitCli(['--client', 'codex', '--yes', '--root', root], { prepareIndex });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('global config'));
    expect(prepareIndex).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    process.exitCode = undefined;
  });

  it('refuses the default home Codex config even when CODEX_HOME is overridden', async () => {
    const originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(path.resolve('.'), 'scratch-codex-home');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handleInitCli(['--client', 'codex', '--yes', '--root', homedir()]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('global config'));
    expect(writeFileMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    process.exitCode = undefined;
  });

  it('rejects stray positional arguments, missing roots, and non-Codex --root', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await handleInitCli(['codex']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unexpected positional'));
    process.exitCode = undefined;

    await handleInitCli(['--client', 'codex', '--yes', '--root', path.join(path.resolve('.'), 'missing-root')]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Project root is missing'));
    process.exitCode = undefined;

    await handleInitCli(['--client', 'cursor', '--yes', '--root', path.resolve('.')]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--root is supported only'));
    errorSpy.mockRestore();
    process.exitCode = undefined;
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
      mcpServers: Record<string, unknown>;
      someOtherKey: boolean;
    };

    expect(merged.mergedFromExisting).toBe(true);
    expect(parsed.someOtherKey).toBe(true);
    expect(parsed.mcpServers['existing-server']).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:4000/mcp'
    });
    expect(parsed.mcpServers['codebase-context']).toEqual({
      command: 'npx',
      args: ['-y', 'codebase-context']
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
      mcp: Record<string, unknown>;
      extra: string;
    };

    expect(merged.mergedFromExisting).toBe(true);
    expect(parsed.extra).toBe('value');
    expect(parsed.mcp['existing-server']).toEqual({
      type: 'remote',
      url: 'http://127.0.0.1:5000/mcp'
    });
    expect(parsed.mcp['codebase-context']).toEqual({
      type: 'local',
      command: ['npx', '-y', 'codebase-context'],
      enabled: true,
      timeout: 120000
    });
  });
});
