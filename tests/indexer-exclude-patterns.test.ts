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

describe('Indexer exclude patterns — nested directories', () => {
  let tempDir: string;

  beforeEach(async () => {
    analyzerRegistry.register(new GenericAnalyzer());
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-exclude-patterns-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('excludes nested coverage, worktrees, .claude, and dist directories', async () => {
    // Legitimate source file
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'src', 'app.ts'),
      'export function main() { return "hello"; }\n'
    );

    // Polluters — nested paths that should be excluded
    const polluters = [
      ['packages', 'ui', 'coverage', 'prettify.js'],
      ['.claude', 'worktrees', 'branch', 'src', 'app.ts'],
      ['worktrees', 'portal30-pr', 'src', 'real.ts'],
      ['apps', 'web', 'dist', 'bundle.js']
    ];

    for (const segments of polluters) {
      const dir = path.join(tempDir, ...segments.slice(0, -1));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(tempDir, ...segments),
        'export const polluter = true;\n'
      );
    }

    const indexer = new CodebaseIndexer({
      rootPath: tempDir,
      config: {
        skipEmbedding: true,
        parsing: {
          maxFileSize: 1048576,
          chunkSize: 50,
          chunkOverlap: 0,
          parseTests: true,
          parseNodeModules: false
        }
      }
    });

    await indexer.index();

    const indexPath = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
    const indexRaw = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as Record<string, unknown>;
    const chunks = (
      Array.isArray(indexRaw)
        ? indexRaw
        : Array.isArray(indexRaw?.chunks)
          ? indexRaw.chunks
          : []
    ) as Array<{ filePath: string }>;
    const indexedPaths = chunks.map((chunk) => chunk.filePath);

    // The legitimate file must be indexed
    expect(indexedPaths.some((p) => p.includes('src/app.ts') || p.includes('src\\app.ts'))).toBe(
      true
    );

    // None of the polluter paths should appear
    const polluterMarkers = ['coverage', '.claude', 'worktrees', 'dist'];
    for (const marker of polluterMarkers) {
      const leaked = indexedPaths.filter((p) => p.includes(marker));
      expect(leaked, `paths containing "${marker}" should not be indexed`).toEqual([]);
    }
  });
});
