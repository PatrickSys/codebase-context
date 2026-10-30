import { resolveIndexArtifact } from '../src/core/index-generation.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { analyzerRegistry } from '../src/core/analyzer-registry.js';
import { GenericAnalyzer } from '../src/analyzers/generic/index.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  KEYWORD_INDEX_FILENAME
} from '../src/constants/codebase-context.js';

describe('Symbol-aware chunk merge guard', () => {
  let tempDir: string;

  beforeEach(async () => {
    analyzerRegistry.register(new GenericAnalyzer());
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symbol-chunk-merge-'));
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'symbol-chunk-test' })
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('keeps small symbol chunks separate during indexing', async () => {
    await fs.writeFile(
      path.join(tempDir, 'utils.ts'),
      [
        'export function a(): number {',
        '  return 1;',
        '}',
        '',
        'export function b(): number {',
        '  return 2;',
        '}'
      ].join('\n')
    );

    const indexer = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    });

    await indexer.index();

    const indexPath = await resolveIndexArtifact(tempDir, KEYWORD_INDEX_FILENAME);
    const indexRaw = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as any;
    const allChunks = (
      Array.isArray(indexRaw) ? indexRaw : Array.isArray(indexRaw?.chunks) ? indexRaw.chunks : []
    ) as Array<{
      filePath: string;
      relativePath: string;
      metadata?: {
        componentName?: string;
        symbolAware?: boolean;
        merged?: boolean;
      };
    }>;

    const utilsChunks = allChunks.filter((chunk) => {
      const fileNameFromFilePath = chunk.filePath.split(/[\\/]/).pop();
      const fileNameFromRelativePath = chunk.relativePath.split(/[\\/]/).pop();
      return fileNameFromFilePath === 'utils.ts' || fileNameFromRelativePath === 'utils.ts';
    });

    expect(utilsChunks.length).toBeGreaterThanOrEqual(2);

    const aChunk = utilsChunks.find((chunk) => chunk.metadata?.componentName === 'a');
    const bChunk = utilsChunks.find((chunk) => chunk.metadata?.componentName === 'b');

    expect(aChunk).toBeDefined();
    expect(bChunk).toBeDefined();
    expect(aChunk?.metadata?.symbolAware).toBe(true);
    expect(bChunk?.metadata?.symbolAware).toBe(true);
    expect(aChunk?.metadata?.merged).not.toBe(true);
    expect(bChunk?.metadata?.merged).not.toBe(true);
  });
});
