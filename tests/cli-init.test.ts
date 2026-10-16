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

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn()
}));

import * as fsMod from 'node:fs/promises';
import { confirm, select } from '@inquirer/prompts';
import {
  generateMcpConfig,
  generateInstructionBlock,
  resolveInstructionFilePath,
  resolveInitRoot,
  _appendInstructionBlock,
  _buildMergedMcpContent,
  _buildMergedCodexContent,
  handleInitCli
} from '../src/cli-init.js';

// --- generateMcpConfig ---

describe('generateMcpConfig', () => {
  const projectRoot = path.resolve('C:/projects/Example Project');
  const nodeExecutable = path.resolve('C:/Program Files/nodejs/node.exe');
  const serverEntrypoint = path.resolve('C:/Program Files/codebase-context/dist/index.js');

  it('Claude Code gets a project stdio config that passes the project root', () => {
    const result = generateMcpConfig('claude-code', {
      rootPath: projectRoot,
      nodeExecutable,
      serverEntrypoint
    });

    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe(path.join(projectRoot, '.mcp.json'));
    expect(JSON.parse(result.content)).toEqual({
      mcpServers: {
        'codebase-context': {
          command: nodeExecutable,
          args: [serverEntrypoint, projectRoot]
        }
      }
    });
  });

  it('cursor returns a file at .cursor/mcp.json with http type', () => {
    const result = generateMcpConfig('cursor');
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe(path.resolve('.cursor/mcp.json'));
    const parsed = JSON.parse(result.content) as {
      mcpServers: { 'codebase-context': { type: string } };
    };
    expect(parsed.mcpServers['codebase-context'].type).toBe('http');
  });

  it('Codex gets a project TOML config that passes paths containing spaces safely', () => {
    const result = generateMcpConfig('codex', {
      rootPath: projectRoot,
      nodeExecutable,
      serverEntrypoint
    });

    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe(path.join(projectRoot, '.codex', 'config.toml'));
    expect(result.content).toBe(
      `[mcp_servers.codebase-context]\ncommand = ${JSON.stringify(nodeExecutable)}\nargs = [${JSON.stringify(serverEntrypoint)}, ${JSON.stringify(projectRoot)}]\nstartup_timeout_sec = 120\n`
    );
  });

  it('opencode returns a file at opencode.json with remote type', () => {
    const result = generateMcpConfig('opencode');
    expect(result.kind).toBe('file');
    if (result.kind !== 'file') return;
    expect(result.path).toBe(path.resolve('opencode.json'));
    const parsed = JSON.parse(result.content) as {
      mcp: { 'codebase-context': { type: string } };
    };
    expect(parsed.mcp['codebase-context'].type).toBe('remote');
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

  it('preserves existing Claude Code mcpServers entries and adds codebase-context', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          'existing-server': { type: 'stdio', command: 'node', args: ['server.js'] }
        },
        someOtherKey: true
      }) as unknown as Buffer
    );

    const generated = generateMcpConfig('claude-code', {
      rootPath: path.resolve('C:/projects/app'),
      nodeExecutable: 'C:/node.exe',
      serverEntrypoint: path.resolve('C:/cbc/index.js')
    });
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
      command: 'C:/node.exe',
      args: [path.resolve('C:/cbc/index.js'), path.resolve('C:/projects/app')]
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
      nodeExecutable: 'C:/node.exe',
      serverEntrypoint: path.resolve('C:/cbc/index.js')
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
});

describe('handleInitCli', () => {
  const readFileMock = vi.mocked(fsMod.readFile);
  const writeFileMock = vi.mocked(fsMod.writeFile);
  const mkdirMock = vi.mocked(fsMod.mkdir);
  const accessMock = vi.mocked(fsMod.access);

  beforeEach(() => {
    vi.resetAllMocks();
    writeFileMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    readFileMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  });

  it('writes only the selected project config in non-interactive mode', async () => {
    const projectRoot = path.resolve('C:/projects/Configured App');

    await handleInitCli(['--client', 'claude-code', '--yes', '--root', projectRoot]);

    expect(select).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = writeFileMock.mock.calls[0] as [
      string,
      string,
      ...unknown[]
    ];
    expect(writtenPath).toBe(path.join(projectRoot, '.mcp.json'));
    const parsed = JSON.parse(writtenContent) as {
      mcpServers: { 'codebase-context': { args: string[] } };
    };
    expect(parsed.mcpServers['codebase-context'].args.at(-1)).toBe(projectRoot);
    expect(mkdirMock).toHaveBeenCalledWith(projectRoot, { recursive: true });
  });

  it('writes a project Codex TOML file when Codex is selected non-interactively', async () => {
    const projectRoot = path.resolve('C:/projects/Codex App');

    await handleInitCli(['--client', 'codex', '--yes', '--root', projectRoot]);

    expect(writeFileMock).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = writeFileMock.mock.calls[0] as [
      string,
      string,
      ...unknown[]
    ];
    expect(writtenPath).toBe(path.join(projectRoot, '.codex', 'config.toml'));
    expect(writtenContent).toContain('[mcp_servers.codebase-context]');
    expect(writtenContent).toContain(`args = [`);
    expect(writtenContent).toContain(JSON.stringify(projectRoot));
    expect(mkdirMock).toHaveBeenCalledWith(path.join(projectRoot, '.codex'), { recursive: true });
  });

  it('uses cwd as the project when init is run without a root override', async () => {
    const previousEnvRoot = process.env.CODEBASE_ROOT;
    delete process.env.CODEBASE_ROOT;

    try {
      await handleInitCli(['--client', 'codex', '--yes']);
    } finally {
      if (previousEnvRoot === undefined) delete process.env.CODEBASE_ROOT;
      else process.env.CODEBASE_ROOT = previousEnvRoot;
    }

    const [writtenPath, writtenContent] = writeFileMock.mock.calls[0] as [
      string,
      string,
      ...unknown[]
    ];
    expect(writtenPath).toBe(path.join(process.cwd(), '.codex', 'config.toml'));
    expect(writtenContent).toContain(JSON.stringify(path.resolve(process.cwd())));
  });

  it('does not overwrite a conflicting project MCP entry', async () => {
    const projectRoot = path.resolve('C:/projects/Configured App');
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          'codebase-context': { disabled: true, command: 'old-server' }
        }
      }) as unknown as Buffer
    );
    const previousExitCode = process.exitCode;

    await handleInitCli(['--client', 'claude-code', '--yes', '--root', projectRoot]);

    expect(writeFileMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = previousExitCode;
  });

  it('does not create a project config when the selected root is missing', async () => {
    const projectRoot = path.resolve('C:/projects/Missing App');
    accessMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const previousExitCode = process.exitCode;

    await handleInitCli(['--client', 'codex', '--yes', '--root', projectRoot]);

    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = previousExitCode;
  });

  it('shows init help without prompting or writing files', async () => {
    await handleInitCli(['--help']);

    expect(select).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('keeps the interactive preview read-only when the user declines', async () => {
    vi.mocked(select).mockResolvedValue('claude-code');
    vi.mocked(confirm).mockResolvedValue(false);

    await handleInitCli([]);

    expect(writeFileMock).not.toHaveBeenCalled();
  });
});

describe('_buildMergedCodexContent', () => {
  const readFileMock = vi.mocked(fsMod.readFile);
  const writeFileMock = vi.mocked(fsMod.writeFile);
  const mkdirMock = vi.mocked(fsMod.mkdir);

  beforeEach(() => {
    vi.resetAllMocks();
    writeFileMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
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
      nodeExecutable: 'C:/node.exe',
      serverEntrypoint: 'C:/cbc/index.js'
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
      nodeExecutable: 'C:/node.exe',
      serverEntrypoint: path.resolve('C:/cbc/index.js')
    });
    if (generated.kind !== 'file') throw new Error('expected file config');
    readFileMock.mockResolvedValue(generated.content as unknown as Buffer);

    const merged = await _buildMergedCodexContent(generated.path, generated.content);

    expect(merged).toEqual({ content: generated.content, mergedFromExisting: true });
  });

  it('treats quoted table keys as the same idempotent Codex entry', async () => {
    const generated = generateMcpConfig('codex', {
      rootPath: path.resolve('C:/projects/app'),
      nodeExecutable: 'C:/node.exe',
      serverEntrypoint: path.resolve('C:/cbc/index.js')
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
      nodeExecutable: 'C:/node.exe',
      serverEntrypoint: 'C:/cbc/index.js'
    });
    if (generated.kind !== 'file') throw new Error('expected file config');

    await expect(_buildMergedCodexContent(generated.path, generated.content)).rejects.toThrow(
      /already contains a different codebase-context configuration/i
    );
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
