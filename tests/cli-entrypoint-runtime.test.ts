import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const entrypoint = resolve(root, 'src', 'index.ts');

type MapJson = {
  project?: string;
  architecture?: object;
  activePatterns?: unknown[];
};

describe('CLI entrypoint runtime', () => {
  function runCli(args: string[]) {
    return spawnSync(process.execPath, ['--import', 'tsx', entrypoint, ...args], {
      cwd: root,
      env: {
        ...process.env,
        CODEBASE_ROOT: root
      },
      encoding: 'utf8',
      timeout: 120_000
    });
  }

  it('dispatches map without loading MCP server runtime on the CLI path', () => {
    const result = runCli(['map', '--json']);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).not.toContain('@modelcontextprotocol/sdk/server/stdio.js');

    const parsed = JSON.parse(result.stdout) as MapJson;
    expect(typeof parsed.project).toBe('string');
    expect(parsed.architecture).toBeTruthy();
    expect(Array.isArray(parsed.activePatterns)).toBe(true);
  }, 120_000);

  it('dispatches status without loading MCP server runtime on the CLI path', () => {
    const result = runCli(['status', '--json']);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).not.toContain('@modelcontextprotocol/sdk/server/stdio.js');

    const parsed = JSON.parse(result.stdout) as {
      status?: string;
      rootPath?: string;
      hint?: string;
    };

    expect(typeof parsed.status).toBe('string');
    expect(parsed.rootPath).toBe(root);
    expect(parsed.hint).toContain('refresh_index');
  }, 120_000);

  it('dispatches CLI help when invoked through a symlink entrypoint', (context) => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'cbc-cli-entrypoint-'));
    const linkedEntrypoint = join(tempDirectory, 'codebase-context.ts');

    try {
      symlinkSync(entrypoint, linkedEntrypoint, 'file');
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : undefined;
      rmSync(tempDirectory, { recursive: true, force: true });
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOSYS'].includes(code ?? '')) {
        context.skip();
        return;
      }
      throw error;
    }

    try {
      const result = spawnSync(process.execPath, ['--import', 'tsx', linkedEntrypoint, '--help'], {
        cwd: root,
        env: { ...process.env, CODEBASE_ROOT: root },
        encoding: 'utf8',
        timeout: 120_000
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('codebase-context <command> [options]');
      expect(result.stdout).toContain('init [--client <name>]');
      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  }, 120_000);

  it('does not run the server or CLI when imported by an unrelated index.js wrapper', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'cbc-cli-import-'));
    const wrapper = join(tempDirectory, 'index.js');
    const importUrl = pathToFileURL(entrypoint).href;
    writeFileSync(
      wrapper,
      `process.argv[2] = '--help'; import(${JSON.stringify(importUrl)}).then(() => console.log('IMPORT_COMPLETE'), (error) => { console.error(error); process.exitCode = 1; });`,
      'utf8'
    );

    try {
      const result = spawnSync(process.execPath, ['--import', 'tsx', wrapper], {
        cwd: root,
        env: { ...process.env, CODEBASE_ROOT: root },
        encoding: 'utf8',
        timeout: 120_000
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('IMPORT_COMPLETE');
      expect(result.stderr).toBe('');
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  }, 120_000);

  it('registers once for the user from two repos without indexing either or changing unrelated settings', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'cbc-user-init-'));
    const userHome = join(sandbox, 'user config');
    const configPath = join(userHome, 'config.toml');
    const settings =
      '# keep this comment\nmodel = "owner-model"\n[windows]\nsandbox = "unelevated"\n';
    const repos = [join(sandbox, 'repo one'), join(sandbox, 'repo two')];
    mkdirSync(userHome);
    writeFileSync(configPath, settings);
    try {
      let firstConfig: string | undefined;
      for (const repo of repos) {
        mkdirSync(repo);
        writeFileSync(join(repo, 'package.json'), '{"private":true}');
        const result = spawnSync(
          process.execPath,
          [
            '--import',
            import.meta.resolve('tsx'),
            entrypoint,
            'init',
            '--client',
            'codex',
            '--yes'
          ],
          {
            cwd: repo,
            env: {
              ...process.env,
              CODEX_HOME: userHome,
              CODEBASE_ROOT: join(sandbox, 'missing inherited root')
            },
            encoding: 'utf8',
            timeout: 30_000
          }
        );
        expect(result.status, result.stderr).toBe(0);
        const content = readFileSync(configPath, 'utf8');
        expect(content.startsWith(settings)).toBe(true);
        expect(content).toContain('env = { CODEBASE_ROOT = "" }');
        expect(content).not.toContain('cwd =');
        expect(content).not.toContain(repo);
        expect(existsSync(join(repo, '.codex'))).toBe(false);
        expect(existsSync(join(repo, '.codebase-context'))).toBe(false);
        expect(existsSync(join(repo, 'AGENTS.md'))).toBe(false);
        expect(result.stdout).toContain('No repository was indexed during setup');
        if (firstConfig !== undefined) expect(content).toBe(firstConfig);
        firstConfig = content;
      }

      const disabled = `${firstConfig}enabled = false\n`;
      writeFileSync(configPath, disabled);
      const refused = spawnSync(
        process.execPath,
        ['--import', import.meta.resolve('tsx'), entrypoint, 'init', '--client', 'codex', '--yes'],
        {
          cwd: repos[0],
          env: { ...process.env, CODEX_HOME: userHome, CODEBASE_ROOT: '' },
          encoding: 'utf8',
          timeout: 30_000
        }
      );
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain('disabled');
      expect(readFileSync(configPath, 'utf8')).toBe(disabled);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 90_000);
});
