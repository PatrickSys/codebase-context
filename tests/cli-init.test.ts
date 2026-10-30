import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import path from 'path';

// Mock node:fs/promises at the top level so Vitest can hoist it correctly.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      access: vi.fn(),
      stat: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined)
    }
  };
});

vi.mock('@inquirer/prompts', () => ({
  checkbox: vi.fn()
}));

import { promises as fsMod } from 'node:fs';
import { checkbox } from '@inquirer/prompts';
import {
  CLIENTS,
  generateMcpConfig,
  detectClients,
  resolveInitRoot,
  _buildMergedMcpContent,
  _buildMergedCodexContent,
  handleInitCli
} from '../src/cli-init.js';

// --- generateMcpConfig ---

const nodeExecutable = path.resolve('C:/Program Files/nodejs/node.exe');
const cacheEntrypoint = path.resolve(
  'C:/npm-cache/_npx/hash/node_modules/codebase-context/dist/index.js'
);

function savedLaunch(rootPath: string) {
  return {
    rootPath,
    nodeExecutable,
    serverEntrypoint: cacheEntrypoint
  };
}

describe('generateMcpConfig', () => {
  const projectRoot = path.resolve('C:/projects/Example Project');

  it('saves the npx cache path for Claude Code', () => {
    const result = generateMcpConfig('claude-code', savedLaunch(projectRoot));

    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe(path.join(projectRoot, '.mcp.json'));
    expect(JSON.parse(result.content)).toEqual({
      mcpServers: {
        'codebase-context': {
          command: nodeExecutable,
          args: [cacheEntrypoint, projectRoot]
        }
      }
    });
  });

  it('Cursor gets a project stdio config that saves the npx cache path', () => {
    const result = generateMcpConfig('cursor', savedLaunch(projectRoot));
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe(path.join(projectRoot, '.cursor', 'mcp.json'));
    const parsed = JSON.parse(result.content) as {
      mcpServers: { 'codebase-context': { type: string; command: string; args: string[] } };
    };
    expect(parsed.mcpServers['codebase-context']).toEqual({
      type: 'stdio',
      command: nodeExecutable,
      args: [cacheEntrypoint, projectRoot]
    });
  });

  it('defaults to the current Node binary and the running package file', () => {
    const result = generateMcpConfig('claude-code', { rootPath: projectRoot });
    if (result.kind !== 'file') throw new Error('expected file config');
    const parsed = JSON.parse(result.content) as {
      mcpServers: { 'codebase-context': { command: string; args: string[] } };
    };
    const server = parsed.mcpServers['codebase-context'];
    expect(server.command).toBe(path.resolve(process.execPath));
    expect(server.args?.[0]).toBe(path.resolve(process.argv[1] ?? ''));
    expect(server.args?.[1]).toBe(projectRoot);
  });

  it('Codex saves the node binary and the npx cache path', () => {
    const result = generateMcpConfig('codex', savedLaunch(projectRoot));

    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe(path.join(projectRoot, '.codex', 'config.toml'));
    expect(result.content).toBe(
      `[mcp_servers.codebase-context]\ncommand = ${JSON.stringify(nodeExecutable)}\nargs = [${JSON.stringify(cacheEntrypoint)}, ${JSON.stringify(projectRoot)}]\nstartup_timeout_sec = 120\n`
    );
  });

  it('OpenCode uses a local command that saves the npx cache path', () => {
    const result = generateMcpConfig('opencode', savedLaunch(projectRoot));
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe(path.join(projectRoot, 'opencode.json'));
    const parsed = JSON.parse(result.content) as {
      mcp: { 'codebase-context': { type: string; command: string[] } };
    };
    expect(parsed.mcp['codebase-context']).toEqual({
      type: 'local',
      command: [nodeExecutable, cacheEntrypoint, projectRoot]
    });
  });
});

describe('resolveInitRoot', () => {
  it('uses explicit root before CODEBASE_ROOT and cwd', () => {
    expect(
      resolveInitRoot(['--root', 'C:/projects/Explicit Project'], 'C:/projects/Env', 'C:/other')
    ).toBe(path.resolve('C:/projects/Explicit Project'));
  });

  it('uses CODEBASE_ROOT when no explicit root is supplied', () => {
    expect(resolveInitRoot([], 'C:/projects/Env Project', 'C:/other')).toBe(
      path.resolve('C:/projects/Env Project')
    );
  });

  it('uses cwd when neither root override is supplied', () => {
    expect(resolveInitRoot([], undefined, 'C:/projects/Current Project')).toBe(
      path.resolve('C:/projects/Current Project')
    );
  });

  it('treats an empty CODEBASE_ROOT as unset', () => {
    expect(resolveInitRoot([], '', 'C:/projects/Current Project')).toBe(
      path.resolve('C:/projects/Current Project')
    );
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

    const generated = generateMcpConfig('cursor', { platform: 'linux' });
    if (generated.kind !== 'file') throw new Error('expected file config');

    const merged = await _buildMergedMcpContent(
      '/test/.cursor/mcp.json',
      generated.content,
      'cursor'
    );
    const parsed = JSON.parse(merged.content) as {
      mcpServers: Record<string, { type: string; url?: string }>;
      someOtherKey: boolean;
    };

    expect(merged.mergedFromExisting).toBe(true);
    expect(parsed.someOtherKey).toBe(true);
    expect(parsed.mcpServers['existing-server']).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:4000/mcp'
    });
    expect(parsed.mcpServers['codebase-context']).toMatchObject({
      type: 'stdio',
      command: path.resolve(process.execPath)
    });
  });

  it('preserves existing Claude Code mcpServers entries and adds codebase-context', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          'existing-server': { type: 'stdio', command: 'node', args: ['server.js'] }
        },
        someOtherKey: true
      }) as unknown as Buffer
    );

    const generated = generateMcpConfig(
      'claude-code',
      savedLaunch(path.resolve('C:/projects/app'))
    );
    if (generated.kind !== 'file') throw new Error('expected file config');

    const merged = await _buildMergedMcpContent(
      '/test/.mcp.json',
      generated.content,
      'claude-code'
    );
    const parsed = JSON.parse(merged.content) as {
      mcpServers: Record<string, unknown>;
      someOtherKey: boolean;
    };

    expect(merged.mergedFromExisting).toBe(true);
    expect(parsed.someOtherKey).toBe(true);
    expect(parsed.mcpServers['existing-server']).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['server.js']
    });
    expect(parsed.mcpServers['codebase-context']).toEqual({
      command: nodeExecutable,
      args: [cacheEntrypoint, path.resolve('C:/projects/app')]
    });
  });

  it('refuses to overwrite a disabled Claude Code codebase-context entry', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          'codebase-context': {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            disabled: true
          }
        }
      }) as unknown as Buffer
    );
    const generated = generateMcpConfig('claude-code', {
      rootPath: path.resolve('C:/projects/app'),
      platform: 'win32'
    });
    if (generated.kind !== 'file') throw new Error('expected file config');

    await expect(
      _buildMergedMcpContent('/test/.mcp.json', generated.content, 'claude-code')
    ).rejects.toThrow(/already contains a different codebase-context configuration/i);
  });

  it('refuses to overwrite an existing conflicting OpenCode codebase-context entry', async () => {
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

    await expect(
      _buildMergedMcpContent('/test/opencode.json', generated.content, 'opencode')
    ).rejects.toThrow(/already contains a different codebase-context configuration/i);
  });

  it('treats a custom Cursor HTTP entry as a conflict', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: { 'codebase-context': { type: 'http', url: 'https://custom/mcp' } }
      }) as unknown as Buffer
    );
    const generated = generateMcpConfig('cursor', { rootPath: '/test', platform: 'linux' });
    if (generated.kind !== 'file') throw new Error('expected file config');

    await expect(
      _buildMergedMcpContent('/test/.cursor/mcp.json', generated.content, 'cursor')
    ).rejects.toThrow(/already contains a different codebase-context configuration/i);
  });

  it('updates a generated JSON launch when the project root moves and preserves entry extras', async () => {
    const oldRoot = path.resolve('C:/projects/Old App');
    const newRoot = path.resolve('C:/projects/New App');
    readFileMock.mockResolvedValue(
      JSON.stringify({
        customSetting: true,
        mcpServers: {
          'codebase-context': {
            command: 'C:/node.exe',
            args: ['C:/cache/node_modules/codebase-context/dist/index.js', oldRoot],
            customTimeout: 8
          }
        }
      }) as unknown as Buffer
    );
    const generated = generateMcpConfig('claude-code', savedLaunch(newRoot));
    if (generated.kind !== 'file') throw new Error('expected file config');

    const merged = await _buildMergedMcpContent(
      '/test/.mcp.json',
      generated.content,
      'claude-code'
    );
    const parsed = JSON.parse(merged.content) as {
      customSetting: boolean;
      mcpServers: { 'codebase-context': Record<string, unknown> };
    };
    expect(parsed.customSetting).toBe(true);
    expect(parsed.mcpServers['codebase-context']).toEqual({
      command: nodeExecutable,
      args: [cacheEntrypoint, newRoot],
      customTimeout: 8
    });
  });

  it('updates a previously generated pinned npx command when the project root moves', async () => {
    const oldRoot = path.resolve('C:/projects/Old Pinned App');
    const newRoot = path.resolve('C:/projects/New Pinned App');
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          'codebase-context': {
            command: 'npx',
            args: ['--yes', 'codebase-context@2.3.0', oldRoot],
            customLabel: 'preserve'
          }
        }
      }) as unknown as Buffer
    );
    const generated = generateMcpConfig('claude-code', savedLaunch(newRoot));
    if (generated.kind !== 'file') throw new Error('expected file config');

    const merged = await _buildMergedMcpContent(
      '/test/.mcp.json',
      generated.content,
      'claude-code'
    );
    const parsed = JSON.parse(merged.content) as {
      mcpServers: { 'codebase-context': { command: string; args: string[]; customLabel: string } };
    };
    expect(parsed.mcpServers['codebase-context']).toEqual({
      command: nodeExecutable,
      args: [cacheEntrypoint, newRoot],
      customLabel: 'preserve'
    });
  });
});

describe('detectClients', () => {
  const accessMock = vi.mocked(fsMod.access);
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });

  beforeEach(() => {
    vi.resetAllMocks();
    accessMock.mockRejectedValue(missing());
    vi.mocked(fsMod.stat).mockImplementation(async (candidate) => {
      const executable = String(candidate)
        .replace(/\\/g, '/')
        .toLowerCase()
        .startsWith('c:/tools/');
      return { isFile: () => executable, isDirectory: () => !executable } as Awaited<
        ReturnType<typeof fsMod.stat>
      >;
    });
  });

  it('uses one four-client table and detects installed tools through PATH candidates', async () => {
    accessMock.mockImplementation(async (candidate) => {
      const pathValue = String(candidate).toLowerCase();
      if (pathValue.startsWith('c:\\tools\\') && pathValue.endsWith('codex.exe')) return undefined;
      throw missing();
    });

    const clients = await detectClients('/project', { PATH: 'C:/tools' }, 'win32');

    expect(CLIENTS.map(({ id }) => id)).toEqual(['claude-code', 'codex', 'cursor', 'opencode']);
    expect(clients).toContain('codex');
    expect(clients).not.toContain('claude-code');
    expect(
      accessMock.mock.calls.some(([candidate]) => String(candidate).includes('C:\\tools'))
    ).toBe(true);
  });

  it.each([
    {
      name: 'CODEX_HOME',
      env: { PATH: '', CODEX_HOME: 'C:/custom-codex-home' },
      marker: 'custom-codex-home',
      client: 'codex'
    },
    {
      name: 'CLAUDE_CONFIG_DIR',
      env: { PATH: '', CLAUDE_CONFIG_DIR: 'C:/custom-claude-config' },
      marker: 'custom-claude-config',
      client: 'claude-code'
    },
    {
      name: 'XDG_CONFIG_HOME',
      env: { PATH: '', XDG_CONFIG_HOME: 'C:/custom-xdg-config' },
      marker: 'custom-xdg-config',
      client: 'opencode'
    }
  ])('checks $name when detecting installed clients', async ({ env, marker, client }) => {
    accessMock.mockImplementation(async (candidate) => {
      if (String(candidate).toLowerCase().includes(marker)) return undefined;
      throw missing();
    });

    const clients = await detectClients('/project', env, 'win32');

    expect(clients).toContain(client);
    expect(accessMock.mock.calls.some(([candidate]) => String(candidate).includes(marker))).toBe(
      true
    );
  });
});

describe('handleInitCli', () => {
  const readFileMock = vi.mocked(fsMod.readFile);
  const writeFileMock = vi.mocked(fsMod.writeFile);
  const mkdirMock = vi.mocked(fsMod.mkdir);
  const accessMock = vi.mocked(fsMod.access);
  const statMock = vi.mocked(fsMod.stat);
  const previousExitCode = process.exitCode;
  const previousIsTTY = process.stdin.isTTY;
  const previousStdoutIsTTY = process.stdout.isTTY;

  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const detectDirectories = (...names: string[]) => {
    accessMock.mockImplementation(async (candidate) => {
      const basename = String(candidate).toLowerCase().split(/[\\/]/).at(-1);
      if (names.some((name) => basename === (name === 'opencode' ? 'opencode' : `.${name}`)))
        return undefined;
      throw missing();
    });
  };

  beforeEach(() => {
    vi.resetAllMocks();
    writeFileMock.mockResolvedValue(undefined);
    vi.mocked(fsMod.rename).mockResolvedValue(undefined);
    vi.mocked(fsMod.rm).mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    readFileMock.mockRejectedValue(missing());
    accessMock.mockRejectedValue(missing());
    statMock.mockResolvedValue({ isDirectory: () => true } as Awaited<
      ReturnType<typeof fsMod.stat>
    >);
    process.exitCode = undefined;
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
  });

  afterAll(() => {
    process.exitCode = previousExitCode;
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: previousIsTTY });
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: previousStdoutIsTTY
    });
  });

  it('configures all detected clients with --yes', async () => {
    const projectRoot = path.resolve('C:/projects/Configured App');
    detectDirectories('claude', 'codex');

    await handleInitCli(['--yes', '--root', projectRoot]);

    expect(checkbox).not.toHaveBeenCalled();
    expect(vi.mocked(fsMod.rename).mock.calls.map(([, filePath]) => filePath)).toEqual(
      expect.arrayContaining([
        path.join(projectRoot, '.mcp.json'),
        path.join(projectRoot, '.codex', 'config.toml')
      ])
    );
    expect(writeFileMock).toHaveBeenCalledTimes(2);
  });

  it('configures all detected clients without a terminal even without --yes', async () => {
    const projectRoot = path.resolve('C:/projects/No Terminal');
    detectDirectories('cursor', 'opencode');

    await handleInitCli(['--root', projectRoot]);

    expect(checkbox).not.toHaveBeenCalled();
    expect(vi.mocked(fsMod.rename).mock.calls.map(([, filePath]) => filePath)).toEqual(
      expect.arrayContaining([
        path.join(projectRoot, '.cursor', 'mcp.json'),
        path.join(projectRoot, 'opencode.json')
      ])
    );
    expect(writeFileMock).toHaveBeenCalledTimes(2);
  });

  it('lets repeated --client options override detection', async () => {
    const projectRoot = path.resolve('C:/projects/Explicit Clients');

    await handleInitCli([
      '--client',
      'claude-code',
      '--client',
      'codex',
      '--yes',
      '--root',
      projectRoot
    ]);

    expect(accessMock).not.toHaveBeenCalled();
    expect(vi.mocked(fsMod.rename).mock.calls.map(([, filePath]) => filePath)).toEqual(
      expect.arrayContaining([
        path.join(projectRoot, '.mcp.json'),
        path.join(projectRoot, '.codex', 'config.toml')
      ])
    );
    expect(writeFileMock).toHaveBeenCalledTimes(2);
  });

  it('reports no detected clients without writing when there is no terminal', async () => {
    await handleInitCli(['--yes', '--root', path.resolve('C:/projects/Empty')]);

    expect(writeFileMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('shows detected clients checked in the terminal multi-select', async () => {
    detectDirectories('claude', 'codex');
    vi.mocked(checkbox).mockResolvedValue(['claude-code']);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });

    await handleInitCli(['--root', path.resolve('C:/projects/Interactive')]);

    const choices = vi.mocked(checkbox).mock.calls[0]?.[0].choices;
    expect(choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'claude-code', checked: true }),
        expect.objectContaining({ value: 'codex', checked: true }),
        expect.objectContaining({ value: 'cursor', checked: false }),
        expect.objectContaining({ value: 'opencode', checked: false })
      ])
    );
    expect(writeFileMock).toHaveBeenCalledOnce();
  });

  it('leaves all no-detection terminal choices unchecked and writes nothing on empty selection', async () => {
    vi.mocked(checkbox).mockResolvedValue([]);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });

    await handleInitCli(['--root', path.resolve('C:/projects/Cancelled')]);

    const choices = vi.mocked(checkbox).mock.calls[0]?.[0].choices;
    expect(choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'claude-code', checked: false }),
        expect.objectContaining({ value: 'codex', checked: false }),
        expect.objectContaining({ value: 'cursor', checked: false }),
        expect.objectContaining({ value: 'opencode', checked: false })
      ])
    );
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('does not write when the terminal prompt throws its cancellation error', async () => {
    detectDirectories('claude');
    vi.mocked(checkbox).mockRejectedValue(
      Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' })
    );
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });

    await handleInitCli(['--root', path.resolve('C:/projects/Prompt Cancelled')]);

    expect(writeFileMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
  });

  it('requires an existing directory for --root', async () => {
    statMock.mockResolvedValue({ isDirectory: () => false } as Awaited<
      ReturnType<typeof fsMod.stat>
    >);

    await handleInitCli(['--client', 'codex', '--yes', '--root', path.resolve('C:/projects/File')]);

    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('does not create configs when --root does not exist', async () => {
    statMock.mockRejectedValue(missing());

    await handleInitCli([
      '--client',
      'codex',
      '--yes',
      '--root',
      path.resolve('C:/projects/Missing Directory')
    ]);

    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('leaves an identical generated config untouched', async () => {
    const projectRoot = path.resolve('C:/projects/Already Configured');
    const generated = generateMcpConfig('claude-code', { rootPath: projectRoot });
    readFileMock.mockResolvedValue(generated.content as unknown as Buffer);

    await handleInitCli(['--client', 'claude-code', '--yes', '--root', projectRoot]);

    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('prepares every selected config before writing when a later client conflicts', async () => {
    const projectRoot = path.resolve('C:/projects/Batch Conflict');
    const opencodePath = path.join(projectRoot, 'opencode.json');
    readFileMock.mockImplementation(async (filePath) => {
      if (String(filePath) === opencodePath) {
        return JSON.stringify({
          mcp: { 'codebase-context': { type: 'remote', url: 'https://custom' } }
        }) as unknown as Buffer;
      }
      throw missing();
    });

    await handleInitCli([
      '--client',
      'claude-code',
      '--client',
      'opencode',
      '--yes',
      '--root',
      projectRoot
    ]);

    expect(process.exitCode).toBe(1);
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('shows help without prompting or writing files', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await handleInitCli(['--help']);
      expect(log.mock.calls.flat().join('\n')).toContain(
        'codex mcp add codebase-context -- npx -y codebase-context'
      );
    } finally {
      log.mockRestore();
    }

    expect(checkbox).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});

describe('_buildMergedCodexContent', () => {
  const readFileMock = vi.mocked(fsMod.readFile);
  const writeFileMock = vi.mocked(fsMod.writeFile);
  const mkdirMock = vi.mocked(fsMod.mkdir);
  const statMock = vi.mocked(fsMod.stat);

  beforeEach(() => {
    vi.resetAllMocks();
    writeFileMock.mockResolvedValue(undefined);
    vi.mocked(fsMod.rename).mockResolvedValue(undefined);
    vi.mocked(fsMod.rm).mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    statMock.mockResolvedValue({ isDirectory: () => true } as Awaited<
      ReturnType<typeof fsMod.stat>
    >);
    readFileMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  });

  const runCodexSetupWithExistingConfig = async (existingToml: string) => {
    const projectRoot = path.resolve('C:/projects/Codex Existing');
    const initialBytes = Buffer.from(existingToml, 'utf8');
    let persistedBytes = Buffer.from(initialBytes);
    readFileMock.mockResolvedValue(existingToml as unknown as Buffer);
    writeFileMock.mockImplementation(async (_filePath, content) => {
      persistedBytes = Buffer.from(content as string, 'utf8');
    });

    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await handleInitCli(['--client', 'codex', '--yes', '--root', projectRoot]);
      return { initialBytes, persistedBytes, exitCode: process.exitCode };
    } finally {
      process.exitCode = previousExitCode;
    }
  };

  it('preserves unrelated Codex TOML settings when adding the project server', async () => {
    readFileMock.mockResolvedValue(
      '[model]\nmodel = "gpt-example"\n\n[mcp_servers.other]\ncommand = "other"\n' as unknown as Buffer
    );
    const generated = generateMcpConfig('codex', {
      rootPath: 'C:/projects/app',
      platform: 'win32'
    });
    if (generated.kind !== 'file') throw new Error('expected file config');

    const merged = await _buildMergedCodexContent(generated.path, generated.content);

    expect(merged.mergedFromExisting).toBe(true);
    expect(merged.content).toContain('[model]\nmodel = "gpt-example"');
    expect(merged.content).toContain('[mcp_servers.other]\ncommand = "other"');
    expect(merged.content).toContain('[mcp_servers.codebase-context]');
  });

  it('leaves the same Codex codebase-context entry unchanged on a repeated setup', async () => {
    const generated = generateMcpConfig('codex', {
      rootPath: path.resolve('C:/projects/app'),
      platform: 'win32'
    });
    if (generated.kind !== 'file') throw new Error('expected file config');
    readFileMock.mockResolvedValue(generated.content as unknown as Buffer);

    const merged = await _buildMergedCodexContent(generated.path, generated.content);

    expect(merged).toEqual({ content: generated.content, mergedFromExisting: true });
  });

  it('treats quoted table keys as the same idempotent Codex entry', async () => {
    const generated = generateMcpConfig('codex', {
      rootPath: path.resolve('C:/projects/app'),
      platform: 'win32'
    });
    if (generated.kind !== 'file') throw new Error('expected file config');
    const existing = generated.content.replace(
      '[mcp_servers.codebase-context]',
      '["mcp_servers"."codebase-context"]'
    );
    readFileMock.mockResolvedValue(existing as unknown as Buffer);

    const merged = await _buildMergedCodexContent(generated.path, generated.content);

    expect(merged).toEqual({ content: existing, mergedFromExisting: true });
  });

  it('refuses a conflicting or disabled Codex codebase-context entry', async () => {
    readFileMock.mockResolvedValue(
      '[mcp_servers.codebase-context]\ndisabled = true\ncommand = "old"\n' as unknown as Buffer
    );
    const generated = generateMcpConfig('codex', {
      rootPath: 'C:/projects/app',
      platform: 'win32'
    });
    if (generated.kind !== 'file') throw new Error('expected file config');

    await expect(_buildMergedCodexContent(generated.path, generated.content)).rejects.toThrow(
      /already contains a different codebase-context configuration/i
    );
  });

  it('updates a generated Codex launch for a moved root while preserving custom settings', async () => {
    const oldRoot = path.resolve('C:/projects/Old Codex App');
    const newRoot = path.resolve('C:/projects/New Codex App');
    const existing =
      '[mcp_servers.codebase-context]\n' +
      'command = "node"\n' +
      `args = ["C:/cache/node_modules/codebase-context/dist/index.js", ${JSON.stringify(oldRoot)}]\n` +
      'startup_timeout_sec = 75\n' +
      'custom_label = "keep me"\n';
    readFileMock.mockResolvedValue(existing as unknown as Buffer);
    const generated = generateMcpConfig('codex', savedLaunch(newRoot));
    if (generated.kind !== 'file') throw new Error('expected file config');

    const merged = await _buildMergedCodexContent(generated.path, generated.content);

    expect(merged.content).toContain(`command = ${JSON.stringify(nodeExecutable)}`);
    expect(merged.content).toContain(
      `args = [${JSON.stringify(cacheEntrypoint)}, ${JSON.stringify(newRoot)}]`
    );
    expect(merged.content).toContain('startup_timeout_sec = 75');
    expect(merged.content).toContain('custom_label = "keep me"');
  });

  it.each([
    {
      name: 'double-quoted parent and child keys',
      toml: '["mcp_servers"."codebase-context"]\ncommand = "old"\n'
    },
    {
      name: 'double-quoted parent and bare child key',
      toml: '["mcp_servers".codebase-context]\ncommand = "old"\n'
    }
  ])(
    'refuses to replace a Codex entry under $name without changing its bytes',
    async ({ toml }) => {
      const result = await runCodexSetupWithExistingConfig(toml);

      expect(result.exitCode).toBe(1);
      expect(writeFileMock).not.toHaveBeenCalled();
      expect(result.persistedBytes).toEqual(result.initialBytes);
    }
  );

  it.each([
    {
      name: 'inline child in the bare parent table',
      toml: '[mcp_servers]\ncodebase-context = { command = "old", args = [] }\n'
    },
    {
      name: 'dotted child in the double-quoted parent table',
      toml: '["mcp_servers"]\ncodebase-context.command = "old"\n'
    },
    {
      name: 'dotted child in the single-quoted parent table',
      toml: "['mcp_servers']\n'codebase-context'.command = \"old\"\n"
    },
    {
      name: 'inline root table under a double-quoted key',
      toml: '"mcp_servers" = { "codebase-context" = { command = "old", args = [] } }\n'
    }
  ])(
    'refuses to replace a Codex entry under $name without changing its bytes',
    async ({ toml }) => {
      const result = await runCodexSetupWithExistingConfig(toml);

      expect(result.exitCode).toBe(1);
      expect(writeFileMock).not.toHaveBeenCalled();
      expect(result.persistedBytes).toEqual(result.initialBytes);
    }
  );
});
