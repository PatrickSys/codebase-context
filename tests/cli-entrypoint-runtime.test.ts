import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const entrypoint = resolve(root, 'src', 'index.ts');

type MapJson = {
  project?: string;
  architecture?: object;
  activePatterns?: unknown[];
};

describe('CLI entrypoint runtime', () => {
  function runCli(args: string[], projectRoot = root) {
    return spawnSync(process.execPath, ['--import', 'tsx', entrypoint, ...args], {
      cwd: root,
      env: {
        ...process.env,
        CODEBASE_ROOT: projectRoot
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

  it('exits cleanly after a real model-free staging failure without aborting native handles', () => {
    const fixture = mkdtempSync(resolve(tmpdir(), 'cbc-cli-stage-failure-'));
    try {
      mkdirSync(resolve(fixture, 'src'));
      writeFileSync(
        resolve(fixture, 'src', 'probe.ts'),
        'export function sourceProbe() { return 1; }\n'
      );
      mkdirSync(resolve(fixture, '.codebase-context'));
      const occupied = resolve(fixture, '.codebase-context', '.staging');
      writeFileSync(occupied, 'owned failure fixture');

      const result = runCli(['reindex', '--no-embeddings', '--json'], fixture);

      expect(result.status).toBe(1);
      expect(result.error).toBeUndefined();
      expect(result.stderr).toContain('Indexing failed:');
      expect(result.stderr).not.toContain('Assertion failed:');
      expect(result.stderr).not.toContain('Creating embeddings');
      expect(readFileSync(occupied, 'utf8')).toBe('owned failure fixture');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 120_000);
});
