import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INDEX_FORMAT_VERSION, KEYWORD_INDEX_FILENAME } from '../src/constants/codebase-context.js';
import { IndexMetaSchema, validateKeywordIndexArtifact } from '../src/core/index-meta.js';
import { resolveIndexArtifact } from '../src/core/index-generation.js';

const root = resolve(import.meta.dirname, '..');
const entrypoint = resolve(root, 'src', 'index.ts');

type MapJson = {
  project?: string;
  architecture?: object;
  activePatterns?: unknown[];
};

describe('CLI entrypoint runtime', () => {
  function runCli(args: string[], projectRoot = root) {
    return spawnSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), entrypoint, ...args],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          CODEBASE_ROOT: projectRoot
        },
        encoding: 'utf8',
        timeout: 120_000
      }
    );
  }

  it('dispatches map without loading MCP server runtime on the CLI path', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'cbc-cli-map-runtime-'));
    try {
      await writeFile(join(projectRoot, 'example.ts'), 'export const answer = 42;\n');
      const result = runCli(['map', '--json'], projectRoot);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
      expect(result.stderr).not.toContain('@modelcontextprotocol/sdk/server/stdio.js');

      const parsed = JSON.parse(result.stdout) as MapJson;
      expect(typeof parsed.project).toBe('string');
      expect(parsed.architecture).toBeTruthy();
      expect(Array.isArray(parsed.activePatterns)).toBe(true);
      expect(parsed).toMatchObject({ graphStats: { files: 1 } });

      const metadataPath = join(projectRoot, '.codebase-context', 'index-meta.json');
      const metadataBytes = await readFile(metadataPath, 'utf8');
      const metadata = IndexMetaSchema.parse(JSON.parse(metadataBytes));
      expect(metadata.formatVersion).toBe(INDEX_FORMAT_VERSION);
      const keywordPath = await resolveIndexArtifact(projectRoot, KEYWORD_INDEX_FILENAME);
      expect(keywordPath).toBe(
        join(projectRoot, '.codebase-context', metadata.artifacts.keywordIndex.path)
      );
      const keyword = validateKeywordIndexArtifact(
        JSON.parse(await readFile(keywordPath, 'utf8')),
        metadata
      );
      expect(keyword.header.buildId).toBe(metadata.buildId);
      expect(keyword.chunks).toContainEqual(
        expect.objectContaining({
          relativePath: 'example.ts',
          content: expect.stringContaining('export const answer = 42;')
        })
      );

      const repeated = runCli(['map', '--json'], projectRoot);
      expect(repeated.status, repeated.stderr).toBe(0);
      expect(repeated.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
      expect(repeated.stderr).not.toContain('@modelcontextprotocol/sdk/server/stdio.js');
      expect(JSON.parse(repeated.stdout)).toEqual(parsed);
      expect(await readFile(metadataPath, 'utf8')).toBe(metadataBytes);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
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
  it('dispatches reindex when invoked through an npm-style symlink entrypoint', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'cbc-cli-reindex-entrypoint-'));
    const tempDirectory = join(tmpdir(), `cbc-cli-bin-${Date.now()}`);
    const linkedEntrypoint = join(tempDirectory, 'codebase-context');

    await writeFile(join(projectRoot, 'example.ts'), 'export const value = 1;\n');
    await mkdir(tempDirectory, { recursive: true });
    symlinkSync(entrypoint, linkedEntrypoint, 'file');

    try {
      const result = spawnSync(
        process.execPath,
        ['--import', import.meta.resolve('tsx'), linkedEntrypoint, 'reindex', '--no-embeddings'],
        {
          cwd: projectRoot,
          env: { ...process.env },
          encoding: 'utf8',
          timeout: 120_000
        }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain('Complete:');
      expect(result.stderr).not.toContain('@modelcontextprotocol/sdk/server/stdio.js');
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
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
});
