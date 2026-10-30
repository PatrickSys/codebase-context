import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { renameSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodebaseIndexer, selectFilesForIndex } from '../src/core/indexer.js';
import { handleCliCommand } from '../src/cli.js';
import { resolveIndexArtifact } from '../src/core/index-generation.js';

describe('index preview enumeration', () => {
  let root: string;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it.each(['reindex', 'map'])(
    'applies configured exclusions and analyzer hints to the actual CLI %s index',
    async (command) => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-cli-project-options-'));
      await fs.mkdir(path.join(root, 'src'));
      await fs.mkdir(path.join(root, 'private'));
      await fs.writeFile(path.join(root, 'src', 'keep.customcode'), 'export const keep = 1;');
      await fs.writeFile(path.join(root, 'private', 'secret.ts'), 'export const secret = 1;');
      const configPath = path.join(root, 'server-config.json');
      await fs.writeFile(
        configPath,
        JSON.stringify({
          projects: [
            {
              root,
              excludePatterns: ['**/private/**'],
              analyzerHints: { analyzer: 'generic', extensions: ['.customcode'] }
            }
          ]
        })
      );
      const previousConfig = process.env.CODEBASE_CONTEXT_CONFIG_PATH;
      const previousRoot = process.env.CODEBASE_ROOT;
      const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = configPath;
      process.env.CODEBASE_ROOT = root;
      try {
        await handleCliCommand(
          command === 'reindex' ? ['reindex', '--no-embeddings'] : ['map', '--json']
        );
        const artifact: { chunks: Array<{ relativePath: string }> } = JSON.parse(
          await fs.readFile(await resolveIndexArtifact(root, 'index.json'), 'utf8')
        );
        const paths = artifact.chunks.map((chunk) => chunk.relativePath);
        expect({
          privateIncluded: paths.includes('private/secret.ts'),
          customIncluded: paths.includes('src/keep.customcode')
        }).toEqual({ privateIncluded: false, customIncluded: true });
      } finally {
        output.mockRestore();
        if (previousConfig === undefined) delete process.env.CODEBASE_CONTEXT_CONFIG_PATH;
        else process.env.CODEBASE_CONTEXT_CONFIG_PATH = previousConfig;
        if (previousRoot === undefined) delete process.env.CODEBASE_ROOT;
        else process.env.CODEBASE_ROOT = previousRoot;
      }
    }
  );

  it('reports only files the indexer will select and explains observed skips', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-preview-'));
    await fs.mkdir(path.join(root, 'packages', 'api'), { recursive: true });
    await fs.mkdir(path.join(root, 'packages', 'web', 'dist'), { recursive: true });
    await fs.writeFile(path.join(root, '.gitignore'), 'ignored.ts\n');
    await fs.writeFile(path.join(root, 'packages', 'api', 'keep.ts'), 'export const keep = 1;\n');
    await fs.writeFile(path.join(root, 'ignored.ts'), 'export const ignored = 1;\n');
    await fs.writeFile(path.join(root, 'large.ts'), `export const large = '${'x'.repeat(80)}';\n`);
    await fs.writeFile(
      path.join(root, 'packages', 'web', 'dist', 'bundle.ts'),
      'export const bundle = 1;\n'
    );
    await fs.writeFile(path.join(root, 'notes.txt'), 'not a supported source file');

    const preview = await new CodebaseIndexer({
      rootPath: root,
      config: { skipEmbedding: true, parsing: { maxFileSize: 48 } }
    }).previewFiles();

    expect(preview.rootPath).toBe(root);
    expect(preview.eligibleFiles).toEqual(['packages/api/keep.ts']);
    expect(preview.skippedFiles).toEqual([
      { path: 'ignored.ts', reason: 'ignored by .gitignore' },
      { path: 'large.ts', reason: 'exceeds configured maximum file size' }
    ]);
    expect(preview.excludedPatterns).toContain('**/dist/**');
    expect(preview.excludedPatterns.some((pattern) => pattern.includes('dist/bundle.ts'))).toBe(
      false
    );
    await expect(fs.access(path.join(root, '.codebase-context'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('honors project config exclusions in the Codex init preview', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-preview-config-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(root, 'private'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'keep.ts'), 'export const keep = 1;\n');
    await fs.writeFile(path.join(root, 'private', 'secret.ts'), 'export const secret = 1;\n');
    const configPath = path.join(root, 'server-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({ projects: [{ root, excludePatterns: ['**/private/**'] }] })
    );
    const previousConfigPath = process.env.CODEBASE_CONTEXT_CONFIG_PATH;
    process.env.CODEBASE_CONTEXT_CONFIG_PATH = configPath;
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await handleCliCommand(['init', '--client', 'codex', '--root', root, '--preview']);
      const rendered = output.mock.calls.flat().join('\n');
      expect(rendered).toContain('src/keep.ts');
      expect(rendered).not.toContain('private/secret.ts');
      expect(rendered).toContain('**/private/**');
    } finally {
      output.mockRestore();
      if (previousConfigPath === undefined) delete process.env.CODEBASE_CONTEXT_CONFIG_PATH;
      else process.env.CODEBASE_CONTEXT_CONFIG_PATH = previousConfigPath;
    }
  });

  it('reports overflow with a count and bounded examples, without materializing an overflow list', () => {
    const files = Array.from({ length: 10025 }, (_, index) => `file-${index}.ts`);

    const selection = selectFilesForIndex(files);

    expect(selection.selected).toHaveLength(10000);
    expect(selection.overLimitCount).toBe(25);
    expect(selection.overLimitSamples).toHaveLength(20);
    expect(selection.overLimitSamples[0]).toBe('file-10000.ts');
  });

  it('rechecks gitignore after preview instead of indexing a stale selection', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-preview-stale-'));
    await fs.writeFile(path.join(root, 'keep.ts'), 'export const keep = 1;\n');
    await fs.writeFile(path.join(root, 'stale.ts'), 'export const stale = 1;\n');
    const indexer = new CodebaseIndexer({
      rootPath: root,
      config: { skipEmbedding: true }
    });

    const preview = await indexer.previewFiles();
    expect(preview.eligibleFiles).toContain('stale.ts');
    await fs.writeFile(path.join(root, '.gitignore'), 'stale.ts\n');

    const stats = await indexer.index();

    expect(stats.totalFiles).toBe(1);
  });

  it('does not enumerate source symlinks whose canonical target is outside the root', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-preview-symlink-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-preview-outside-'));
    try {
      const outsideFile = path.join(outsideRoot, 'outside.ts');
      const linkPath = path.join(root, 'linked.ts');
      await fs.writeFile(outsideFile, 'export const outside = true;\n');
      try {
        await fs.symlink(outsideFile, linkPath, 'file');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
          throw new Error(
            `Symlink containment oracle could not run: Windows denied symlink creation (${code}).`
          );
        }
        throw error;
      }

      const preview = await new CodebaseIndexer({ rootPath: root }).previewFiles();

      expect(preview.eligibleFiles).not.toContain('linked.ts');
      expect(preview.skippedFiles).toContainEqual({
        path: 'linked.ts',
        reason: 'source resolves outside selected root'
      });
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not let an in-root alias bypass a configured exclusion', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-preview-inroot-alias-'));
    const privateDir = path.join(root, 'private');
    await fs.mkdir(privateDir, { recursive: true });
    const canonicalFile = path.join(privateDir, 'secret.ts');
    const aliasPath = path.join(root, 'alias.ts');
    await fs.writeFile(canonicalFile, 'export const secret = true;\n');
    try {
      await fs.symlink(canonicalFile, aliasPath, 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
        throw new Error(
          `In-root alias oracle could not run: Windows denied symlink creation (${code}).`
        );
      }
      throw error;
    }

    const preview = await new CodebaseIndexer({
      rootPath: root,
      config: { exclude: ['**/private/**'] }
    }).previewFiles();

    expect(preview.eligibleFiles).not.toContain('alias.ts');
    expect(preview.eligibleFiles).not.toContain('private/secret.ts');
    expect(preview.skippedFiles).toContainEqual({
      path: 'alias.ts',
      reason: 'source alias is not indexed; use its canonical path'
    });
  });

  it('counts one canonical source when multiple in-root aliases point to it', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-preview-aliases-'));
    const canonicalFile = path.join(root, 'real.ts');
    await fs.writeFile(canonicalFile, 'export const real = true;\n');
    for (const name of ['first.ts', 'second.ts']) {
      try {
        await fs.symlink(canonicalFile, path.join(root, name), 'file');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
          throw new Error(
            `Alias deduplication oracle could not run: Windows denied symlink creation (${code}).`
          );
        }
        throw error;
      }
    }

    const preview = await new CodebaseIndexer({ rootPath: root }).previewFiles();

    expect(preview.eligibleFiles).toEqual(['real.ts']);
    expect(preview.skippedFileCount).toBe(2);
    expect(preview.skippedFiles.map((file) => file.path).sort()).toEqual(['first.ts', 'second.ts']);
  });

  it('rechecks containment immediately before reading a source replaced by an outside symlink', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-read-symlink-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-read-outside-'));
    const sourcePath = path.join(root, 'source.ts');
    const replacementPath = path.join(root, 'replacement-link');
    try {
      const outsideFile = path.join(outsideRoot, 'outside.ts');
      await fs.writeFile(sourcePath, 'export const inside = true;\n');
      await fs.writeFile(outsideFile, 'export const outside = true;\n');
      try {
        await fs.symlink(outsideFile, replacementPath, 'file');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
          throw new Error(
            `Pre-read containment oracle could not run: Windows denied symlink creation (${code}).`
          );
        }
        throw error;
      }

      let replaced = false;
      const indexer = new CodebaseIndexer({
        rootPath: root,
        config: { skipEmbedding: true },
        onProgress: ({ phase }) => {
          if (phase !== 'analyzing' || replaced) return;
          unlinkSync(sourcePath);
          renameSync(replacementPath, sourcePath);
          replaced = true;
        }
      });

      const stats = await indexer.index();

      expect(replaced).toBe(true);
      expect(stats.indexedFiles).toBe(0);
      expect(
        stats.errors.some((error) => error.error.includes('Source resolves outside selected root'))
      ).toBe(true);
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects a source replaced before read by an alias to another in-root file', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-read-inroot-alias-'));
    const sourcePath = path.join(root, 'source.ts');
    const canonicalPath = path.join(root, 'canonical.ts');
    const replacementPath = path.join(root, 'replacement-link');
    await fs.writeFile(sourcePath, 'export const original = true;\n');
    await fs.writeFile(canonicalPath, 'export const canonical = true;\n');
    try {
      await fs.symlink(canonicalPath, replacementPath, 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
        throw new Error(
          `In-root read-alias oracle could not run: Windows denied symlink creation (${code}).`
        );
      }
      throw error;
    }

    let replaced = false;
    const indexer = new CodebaseIndexer({
      rootPath: root,
      config: { skipEmbedding: true },
      onProgress: ({ phase }) => {
        if (phase !== 'analyzing' || replaced) return;
        unlinkSync(sourcePath);
        renameSync(replacementPath, sourcePath);
        replaced = true;
      }
    });

    const stats = await indexer.index();

    expect(replaced).toBe(true);
    expect(stats.indexedFiles).toBe(1);
    expect(stats.errors.some((error) => error.error.includes('Source alias is not indexed'))).toBe(
      true
    );
  });
});
