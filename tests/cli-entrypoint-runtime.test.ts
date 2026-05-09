import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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

  it('dispatches package build without treating package as a root path', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'entrypoint-package-'));
    try {
      mkdirSync(join(tempRoot, 'src'), { recursive: true });
      writeFileSync(
        join(tempRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@example/entrypoint-package',
            version: '1.0.0',
            exports: {
              '.': './src/index.ts'
            }
          },
          null,
          2
        )
      );
      writeFileSync(
        join(tempRoot, 'src', 'index.ts'),
        'export function packageEntrypoint(): string { return "ok"; }\n'
      );

      const result = runCli(['package', 'build', tempRoot, '--out', join(tempRoot, '.context'), '--json']);

      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain('Root path does not exist');
      expect(result.stderr).not.toContain('@modelcontextprotocol/sdk/server/stdio.js');

      const parsed = JSON.parse(result.stdout) as { publicSurfaceCount?: number };
      expect(parsed.publicSurfaceCount).toBeGreaterThan(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
