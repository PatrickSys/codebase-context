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

describe('Indexer recursive exclude patterns', () => {
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
      'export const main = () => console.log("hello");\n'
    );

    // Nested coverage (simulates packages/ui/coverage/prettify.js)
    await fs.mkdir(path.join(tempDir, 'packages', 'ui', 'coverage'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'packages', 'ui', 'coverage', 'prettify.js'),
      'function prettify() { return "coverage artifact"; }\n'
    );

    // .claude worktree (simulates .claude/worktrees/branch/src/app.ts)
    await fs.mkdir(path.join(tempDir, '.claude', 'worktrees', 'branch', 'src'), {
      recursive: true
    });
    await fs.writeFile(
      path.join(tempDir, '.claude', 'worktrees', 'branch', 'src', 'app.ts'),
      'export const shadow = true;\n'
    );

    // Git worktree (simulates worktrees/portal30-pr/src/real.ts)
    await fs.mkdir(path.join(tempDir, 'worktrees', 'portal30-pr', 'src'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'worktrees', 'portal30-pr', 'src', 'real.ts'),
      'export const worktreeCode = 1;\n'
    );

    // Nested dist (simulates apps/web/dist/bundle.js)
    await fs.mkdir(path.join(tempDir, 'apps', 'web', 'dist'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'apps', 'web', 'dist', 'bundle.js'),
      'var a=1,b=2;module.exports={a,b};\n'
    );

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
    const indexRaw = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as any;
    const chunks = (
      Array.isArray(indexRaw) ? indexRaw : Array.isArray(indexRaw?.chunks) ? indexRaw.chunks : []
    ) as Array<{ filePath: string }>;
    const indexedFiles = new Set(chunks.map((chunk) => chunk.filePath));

    // Normalize paths to forward slashes for comparison
    const normalizedFiles = new Set(
      [...indexedFiles].map((f) => f.replace(/\\/g, '/'))
    );

    // Only the legitimate source file should be indexed
    const hasLegitimate = [...normalizedFiles].some((f) => f.endsWith('src/app.ts'));
    expect(hasLegitimate).toBe(true);

    // None of the polluted files should appear
    const hasCoverage = [...normalizedFiles].some((f) => f.includes('/coverage/'));
    const hasWorktrees = [...normalizedFiles].some((f) => f.includes('/worktrees/'));
    const hasClaude = [...normalizedFiles].some((f) => f.includes('/.claude/'));
    const hasDist = [...normalizedFiles].some((f) => f.includes('/dist/'));

    expect(hasCoverage).toBe(false);
    expect(hasWorktrees).toBe(false);
    expect(hasClaude).toBe(false);
    expect(hasDist).toBe(false);
  });
});
