import path from 'node:path';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  detectClients,
  generateMcpConfig,
  handleInitCli,
  _buildMergedMcpContent,
  _buildMergedCodexContent
} from '../src/cli-init.js';
import { resolveRootPath } from '../src/index.js';
import { parse as parseToml } from 'smol-toml';

describe('init bootstrap root', () => {
  it('passes the configured project root through the MCP server argv path', () => {
    const projectRoot = path.resolve('C:/projects/An App With Spaces');
    const previousArgv = process.argv;
    const previousEnvRoot = process.env.CODEBASE_ROOT;
    const generated = generateMcpConfig('claude-code', {
      rootPath: projectRoot,
      nodeExecutable: process.execPath,
      serverEntrypoint: path.resolve('C:/codebase-context/dist/index.js')
    });
    if (generated.kind !== 'file') throw new Error('expected project MCP config');

    const parsed = JSON.parse(generated.content) as {
      mcpServers: { 'codebase-context': { command: string; args: string[] } };
    };
    const server = parsed.mcpServers['codebase-context'];
    expect(server.command).toBe(path.resolve(process.execPath));
    expect(server.args).toEqual([path.resolve('C:/codebase-context/dist/index.js'), projectRoot]);
    process.argv = [server.command, ...server.args];
    process.env.CODEBASE_ROOT = path.resolve('C:/projects/Other App');

    try {
      expect(resolveRootPath()).toBe(projectRoot);
    } finally {
      process.argv = previousArgv;
      if (previousEnvRoot === undefined) delete process.env.CODEBASE_ROOT;
      else process.env.CODEBASE_ROOT = previousEnvRoot;
    }
  });
});

describe('init preserves custom launchers', () => {
  it('updates the real launch while preserving an earlier apparent launch inside instructions', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'cbc-codex-real-table-'));
    const entrypoint = path.join(root, 'package', 'dist', 'index.js');
    const generated = generateMcpConfig('codex', { rootPath: root, serverEntrypoint: entrypoint });
    const instructions =
      'developer_instructions = """\n[mcp_servers.codebase-context]\ncommand = "npx"\nargs = ["--yes", "codebase-context@2.2.0", "C:/fake"]\n"""\n';
    const original =
      instructions +
      '\n[mcp_servers.codebase-context]\ncommand = "npx" # real\nargs = ["--yes", "codebase-context@2.2.0", "C:/old"]\nstartup_timeout_sec = 75\n';
    await fs.mkdir(path.dirname(generated.path), { recursive: true });
    await fs.writeFile(generated.path, original);
    try {
      const merged = await _buildMergedCodexContent(generated.path, generated.content);
      expect(merged.content.startsWith(instructions)).toBe(true);
      const parsed = parseToml(merged.content);
      expect(parsed.mcp_servers).toEqual({
        'codebase-context': {
          command: process.execPath,
          args: [entrypoint, root],
          startup_timeout_sec: 75
        }
      });
      expect(parsed.developer_instructions).toBe(parseToml(original).developer_instructions);
      expect(merged.content).toContain('# real');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['basic multiline', '"""', 'escaped quote: \\" and escaped delimiter: \\"""\n'],
    ['literal multiline', "'''", 'literal quotes: " and \\n\n']
  ])(
    'preserves apparent tables inside a %s instruction string',
    async (_name, delimiter, prefix) => {
      const root = await fs.mkdtemp(path.join(tmpdir(), 'cbc-codex-multiline-'));
      const generated = generateMcpConfig('codex', { rootPath: root });
      const original = `developer_instructions = ${delimiter}\n${prefix}[mcp_servers.codebase-context]\ncommand = "npx"\nargs = ["--yes", "codebase-context@2.2.0", "C:/project"]\n${delimiter}\n`;
      await fs.mkdir(path.dirname(generated.path), { recursive: true });
      await fs.writeFile(generated.path, original);
      try {
        const merged = await _buildMergedCodexContent(generated.path, generated.content);
        expect(merged.content.startsWith(original)).toBe(true);
        expect(merged.content.slice(original.length)).toContain(generated.content.trim());
        const parsed = parseToml(merged.content);
        expect(parsed.developer_instructions).toBe(parseToml(original).developer_instructions);
        expect(parsed.mcp_servers).toEqual(parseToml(generated.content).mcp_servers);
        expect(await fs.readFile(generated.path, 'utf8')).toBe(original);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  );

  it('distinguishes executable files from directories while detecting tools', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'cbc-detect-files-'));
    const bin = path.join(root, 'bin');
    const home = path.join(root, 'home');
    await fs.mkdir(path.join(bin, 'claude'), { recursive: true });
    await fs.writeFile(path.join(root, '.codex'), 'This is a file, not a tool directory.');
    const env = {
      PATH: bin,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, '.config')
    };
    try {
      expect(await detectClients(root, env)).toEqual([]);
      const executable = path.join(bin, process.platform === 'win32' ? 'codex.cmd' : 'codex');
      await fs.writeFile(executable, 'Detection must never execute this file.');
      await fs.chmod(executable, 0o755);
      expect(await detectClients(root, env)).toEqual(['codex']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('leaves a matching Codex launch and extra settings byte-for-byte unchanged', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'cbc-codex-format-'));
    const generated = generateMcpConfig('codex', { rootPath: root });
    const original = (
      'model = "example"\n\n' +
      generated.content +
      'custom_label = "keep"\n'
    ).replace(/\n/g, '\r\n');
    await fs.mkdir(path.dirname(generated.path), { recursive: true });
    await fs.writeFile(generated.path, original);
    try {
      await handleInitCli(['--client', 'codex', '--yes', '--skip-index', '--root', root]);
      expect(await fs.readFile(generated.path, 'utf8')).toBe(original);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['claude-code', 'other package'],
    ['codex', 'other package'],
    ['claude-code', 'custom npx'],
    ['codex', 'custom npx']
  ] as const)('preserves %s config with a %s launcher', async (client, kind) => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'cbc-custom-launch-'));
    const generated = generateMcpConfig(client, { rootPath: root });
    const launcher = path.join(root, 'node_modules', 'other-package', 'dist', 'index.js');
    const command = kind === 'custom npx' ? path.join(root, 'custom', 'npx.cmd') : 'node';
    const args =
      kind === 'custom npx' ? ['--yes', 'codebase-context@2.3.0', root] : [launcher, root];
    const original =
      client === 'codex'
        ? `[mcp_servers.codebase-context]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\nstartup_timeout_sec = 75\n`
        : JSON.stringify({
            mcpServers: {
              'codebase-context': {
                command,
                args,
                env: { KEEP: 'yes' }
              }
            },
            customSetting: true
          });
    await fs.mkdir(path.dirname(generated.path), { recursive: true });
    await fs.writeFile(generated.path, original);
    try {
      const merge =
        client === 'codex'
          ? _buildMergedCodexContent(generated.path, generated.content)
          : _buildMergedMcpContent(generated.path, generated.content, client);
      await expect(merge).rejects.toThrow('different codebase-context');
      expect(await fs.readFile(generated.path, 'utf8')).toBe(original);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('writes no selected configs when a later client uses a custom launcher', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'cbc-batch-launch-'));
    const claude = path.join(root, '.mcp.json');
    const codex = path.join(root, '.codex', 'config.toml');
    const originalClaude = JSON.stringify({
      mcpServers: { other: { command: 'custom' } },
      customSetting: true
    });
    const originalCodex = `[mcp_servers.codebase-context]\ncommand = "node"\nargs = [${JSON.stringify(path.join(root, 'other-package', 'dist', 'index.js'))}, ${JSON.stringify(root)}]\n`;
    await fs.mkdir(path.dirname(codex), { recursive: true });
    await fs.writeFile(claude, originalClaude);
    await fs.writeFile(codex, originalCodex);
    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      await handleInitCli([
        '--client',
        'claude-code',
        '--client',
        'codex',
        '--yes',
        '--skip-index',
        '--root',
        root
      ]);
      expect(process.exitCode).toBe(1);
      expect(await fs.readFile(claude, 'utf8')).toBe(originalClaude);
      expect(await fs.readFile(codex, 'utf8')).toBe(originalCodex);
    } finally {
      process.exitCode = previousExitCode;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
