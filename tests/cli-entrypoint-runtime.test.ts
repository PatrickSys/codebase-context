import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

  it('prints usage for help from a project containing a directory named help', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'cbc-cli-help-'));
    const helpDirectory = join(projectRoot, 'help');

    const env = { ...process.env };
    delete env.CODEBASE_ROOT;

    try {
      await mkdir(helpDirectory);

      const result = spawnSync(
        process.execPath,
        ['--import', import.meta.resolve('tsx'), entrypoint, 'help'],
        {
          cwd: projectRoot,
          env,
          encoding: 'utf8',
          timeout: 10_000
        }
      );

      expect({
        errorCode: result.error?.code,
        exitCode: result.status,
        helpText: result.stdout.includes('codebase-context <command> [options]'),
        commandsSection: result.stdout.includes('Commands:'),
        stderr: result.stderr,
        projectEntries: await readdir(projectRoot),
        helpEntries: await readdir(helpDirectory)
      }).toEqual({
        errorCode: undefined,
        exitCode: 0,
        helpText: true,
        commandsSection: true,
        stderr: '',
        projectEntries: ['help'],
        helpEntries: []
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 70_000);
});
