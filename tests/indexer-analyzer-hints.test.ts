import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { analyzerRegistry } from '../src/core/analyzer-registry.js';
import { AngularAnalyzer } from '../src/analyzers/angular/index.js';
import { GenericAnalyzer } from '../src/analyzers/generic/index.js';
import { findSymbolReferences } from '../src/core/symbol-references.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  KEYWORD_INDEX_FILENAME
} from '../src/constants/codebase-context.js';

type IndexChunk = {
  filePath: string;
  relativePath?: string;
  componentType?: string;
  content?: string;
  startLine?: number;
};

async function readIndexedChunks(rootPath: string): Promise<IndexChunk[]> {
  const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
  const indexRaw = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as Record<string, unknown>;

  if (Array.isArray(indexRaw)) {
    return indexRaw as IndexChunk[];
  }

  if (Array.isArray(indexRaw.chunks)) {
    return indexRaw.chunks as IndexChunk[];
  }

  throw new Error(`Unexpected index format in ${indexPath}`);
}

describe('Indexer analyzer hints', () => {
  let tempDir: string;

  beforeAll(() => {
    if (!analyzerRegistry.get('angular')) {
      analyzerRegistry.register(new AngularAnalyzer());
    }
    if (!analyzerRegistry.get('generic')) {
      analyzerRegistry.register(new GenericAnalyzer());
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('indexes project-local extra extensions when a preferred analyzer is configured', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-analyzer-hints-'));
    await fs.writeFile(
      path.join(tempDir, 'widget.sfc'),
      'export function renderWidget() { return "ok"; }\n'
    );

    const indexer = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      projectOptions: {
        preferredAnalyzer: 'generic',
        extraFileExtensions: ['.sfc']
      }
    });

    const stats = await indexer.index();
    const chunks = await readIndexedChunks(tempDir);

    expect(stats.indexedFiles).toBe(1);
    expect(chunks.some((chunk) => chunk.filePath.endsWith('widget.sfc'))).toBe(true);
  });

  it('uses current source lines when a reused index has no supported reference parser', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-current-reference-lines-'));
    const sourcePath = path.join(tempDir, 'widget.sfc');
    const originalSource = [
      'export function staleToken() {',
      '  return "ok";',
      '}',
      'staleToken();'
    ].join('\n');
    await fs.writeFile(sourcePath, originalSource, 'utf-8');
    const indexer = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      projectOptions: { preferredAnalyzer: 'generic', extraFileExtensions: ['.sfc'] }
    });
    await indexer.index();
    const indexPath = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
    const indexedBytes = await fs.readFile(indexPath);

    const movedSource = `// Newly inserted header\n\n${originalSource}`;
    await fs.writeFile(sourcePath, movedSource, 'utf-8');
    const moved = await findSymbolReferences(tempDir, 'staleToken', 10);
    expect(moved.status).toBe('success');
    if (moved.status !== 'success') throw new Error(moved.message);
    expect(moved.usageCount).toBe(2);
    expect(moved.usages.map((usage) => usage.line)).toEqual([3, 6]);
    for (const usage of moved.usages) {
      expect(usage.file).toBe('widget.sfc');
      const openedSource = await fs.readFile(path.join(tempDir, usage.file), 'utf-8');
      expect(openedSource.split('\n')[usage.line - 1]).toContain('staleToken');
    }

    await fs.writeFile(sourcePath, 'export function replacement() { return "new"; }\n');
    const removed = await findSymbolReferences(tempDir, 'staleToken', 10);
    expect(removed).toMatchObject({ status: 'success', usageCount: 0, usages: [] });
    expect(await fs.readFile(indexPath)).toEqual(indexedBytes);
  });

  it('stores and returns exact project-relative source paths across launch roots and index reuse', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-paths-'));
    const monorepoRoot = path.join(tempDir, 'evidence', 'repo with spaces');
    const rootPath = path.join(monorepoRoot, 'packages', 'api');
    const sourcePath = path.join(rootPath, 'src', 'auth', 'auth.service.ts');
    const siblingPackageSourcePath = path.join(
      monorepoRoot,
      'packages',
      'web',
      'src',
      'auth',
      'auth.service.ts'
    );
    const source = [
      'export function registerToken() {',
      "  return 'token';",
      '}',
      'registerToken();'
    ].join('\n');
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, source, 'utf-8');
    await fs.mkdir(path.dirname(siblingPackageSourcePath), { recursive: true });
    await fs.writeFile(siblingPackageSourcePath, source, 'utf-8');

    const previousCwd = process.cwd();
    try {
      process.chdir(tempDir);
      await new CodebaseIndexer({
        rootPath,
        config: { skipEmbedding: true }
      }).index();

      const chunks = await readIndexedChunks(rootPath);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((chunk) => chunk.relativePath === 'src/auth/auth.service.ts')).toBe(true);

      const freshResult = await findSymbolReferences(rootPath, 'registerToken');
      expect(freshResult.status).toBe('success');
      if (freshResult.status !== 'success') return;
      expect(freshResult.usages.map((usage) => usage.file)).toEqual([
        'src/auth/auth.service.ts',
        'src/auth/auth.service.ts'
      ]);
      expect(freshResult.usages.map((usage) => usage.line).sort((a, b) => a - b)).toEqual([1, 4]);

      const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
      const indexRaw = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as {
        chunks: IndexChunk[];
        header: Record<string, unknown>;
      };
      for (const chunk of indexRaw.chunks) {
        chunk.relativePath = path.relative(tempDir, sourcePath).replace(/\\/g, '/');
      }
      await fs.writeFile(indexPath, JSON.stringify(indexRaw), 'utf-8');

      process.chdir(os.tmpdir());
      const reusedResult = await findSymbolReferences(rootPath, 'registerToken');
      expect(reusedResult.status).toBe('success');
      if (reusedResult.status !== 'success') return;

      for (const usage of reusedResult.usages) {
        expect(usage.file).toBe('src/auth/auth.service.ts');
        const resolvedUsagePath = path.resolve(rootPath, usage.file);
        expect(path.relative(rootPath, resolvedUsagePath).replace(/\\/g, '/')).toBe(
          'src/auth/auth.service.ts'
        );
        const lines = (await fs.readFile(resolvedUsagePath, 'utf-8')).split('\n');
        expect(lines[usage.line - 1]).toContain('registerToken');
      }
      expect(reusedResult.usages.map((usage) => usage.line).sort((a, b) => a - b)).toEqual([1, 4]);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('keeps valid ..-prefixed filenames and omits stale locations outside the project', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-path-boundary-'));
    const rootPath = path.join(tempDir, 'repo');
    const sourcePath = path.join(rootPath, '..name.ts');
    const outsidePath = path.join(tempDir, 'outside.ts');
    const source = 'export const locateToken = 1;';
    await fs.mkdir(rootPath, { recursive: true });
    await fs.writeFile(sourcePath, source, 'utf-8');
    await fs.writeFile(outsidePath, 'export const locateToken = 2;', 'utf-8');
    await fs.mkdir(path.join(rootPath, CODEBASE_CONTEXT_DIRNAME), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME),
      JSON.stringify({
        header: { buildId: 'path-boundary-test' },
        chunks: [
          {
            content: source,
            startLine: 1,
            relativePath: '..name.ts',
            filePath: sourcePath
          },
          {
            content: 'export const locateToken = 2;',
            startLine: 1,
            relativePath: '../outside.ts',
            filePath: outsidePath
          }
        ]
      }),
      'utf-8'
    );

    const result = await findSymbolReferences(rootPath, 'locateToken');
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.usages).toHaveLength(1);
    expect(result.usages[0]?.file).toBe('..name.ts');
    expect(result.usages[0]?.line).toBe(1);
    const resolvedUsagePath = path.resolve(rootPath, result.usages[0]!.file);
    expect(path.relative(rootPath, resolvedUsagePath)).toBe('..name.ts');
    expect((await fs.readFile(resolvedUsagePath, 'utf-8')).split('\n')[0]).toContain('locateToken');
  });

  it('honors extra extensions during incremental reindexing', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-analyzer-hints-'));
    const hintedFile = path.join(tempDir, 'widget.sfc');
    await fs.writeFile(hintedFile, 'export const value = 1;\n');

    const projectOptions = {
      preferredAnalyzer: 'generic',
      extraFileExtensions: ['sfc']
    };

    await new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      projectOptions
    }).index();

    await fs.writeFile(hintedFile, 'export const value = 2;\n');

    const stats = await new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      projectOptions,
      incrementalOnly: true
    }).index();

    expect(stats.incremental).toBeDefined();
    expect(stats.incremental?.changed).toBe(1);
  });

  it('warns once and falls back to default analyzer selection when the preferred analyzer is missing', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-analyzer-hints-'));
    await fs.writeFile(
      path.join(tempDir, 'app.component.ts'),
      [
        'import { Component } from "@angular/core";',
        '',
        '@Component({',
        '  selector: "app-root",',
        '  template: "<p>Hello</p>"',
        '})',
        'export class AppComponent {}'
      ].join('\n')
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      projectOptions: {
        preferredAnalyzer: 'missing-analyzer'
      }
    }).index();

    const chunks = await readIndexedChunks(tempDir);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('missing-analyzer');
    expect(chunks.some((chunk) => chunk.componentType === 'component')).toBe(true);
  });

  it('keeps default behavior unchanged when no analyzer hints are configured', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-analyzer-hints-'));
    await fs.writeFile(
      path.join(tempDir, 'widget.sfc'),
      'export function renderWidget() { return "ignored"; }\n'
    );

    const stats = await new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    }).index();
    const chunks = await readIndexedChunks(tempDir);

    expect(stats.indexedFiles).toBe(0);
    expect(chunks).toEqual([]);
  });
});
