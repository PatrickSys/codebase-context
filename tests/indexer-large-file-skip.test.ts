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

describe('Indexer large file skip regression', () => {
  let tempDir: string;

  beforeEach(async () => {
    analyzerRegistry.register(new GenericAnalyzer());
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-large-file-skip-'));
    await fs.mkdir(path.join(tempDir, 'src', 'generated'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('indexes small files and skips oversized regular and generated files', async () => {
    await fs.writeFile(path.join(tempDir, 'small.ts'), 'export const keep = 1;\n');

    const oversizedBody = `export const huge = '${'x'.repeat(600)}';\n`;
    await fs.writeFile(path.join(tempDir, 'big.ts'), oversizedBody);
    await fs.writeFile(path.join(tempDir, 'src', 'generated', 'big.generated.ts'), oversizedBody);

    const indexer = new CodebaseIndexer({
      rootPath: tempDir,
      config: {
        skipEmbedding: true,
        parsing: {
          maxFileSize: 256,
          chunkSize: 50,
          chunkOverlap: 0,
          parseTests: true,
          parseNodeModules: false
        }
      }
    });

    await indexer.index();

    const indexPath = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
    const indexRaw = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as any;
    const chunks = (
      Array.isArray(indexRaw) ? indexRaw : Array.isArray(indexRaw?.chunks) ? indexRaw.chunks : []
    ) as Array<{ filePath: string }>;
    const indexedFiles = new Set(chunks.map((chunk) => chunk.filePath.split(/[\\/]/).pop()));

    expect(indexedFiles.has('small.ts')).toBe(true);
    expect(indexedFiles.has('big.ts')).toBe(false);
    expect(indexedFiles.has('big.generated.ts')).toBe(false);
  });

  it('limits the keyword index to the configured maximum chunk count', async () => {
    await Promise.all(
      ['one.ts', 'two.ts', 'three.ts'].map((fileName, index) =>
        fs.writeFile(path.join(tempDir, fileName), `export const value${index} = ${index};\n`)
      )
    );

    const indexer = new CodebaseIndexer({
      rootPath: tempDir,
      config: {
        skipEmbedding: true,
        parsing: { maxChunks: 2 }
      }
    });

    await indexer.index();

    const indexPath = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
    const indexRaw = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as {
      chunks?: unknown[];
    };

    expect(indexRaw.chunks).toHaveLength(2);
  });
});
