import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { analyzerRegistry } from '../src/core/analyzer-registry.js';
import { AngularAnalyzer } from '../src/analyzers/angular/index.js';
import { GenericAnalyzer } from '../src/analyzers/generic/index.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  KEYWORD_INDEX_FILENAME
} from '../src/constants/codebase-context.js';

type IndexChunk = {
  filePath: string;
  componentType?: string;
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
