import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
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
});
