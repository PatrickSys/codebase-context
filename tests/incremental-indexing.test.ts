import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { readManifest } from '../src/core/manifest.js';
import { CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME, KEYWORD_INDEX_FILENAME } from '../src/constants/codebase-context.js';

describe('Incremental Indexing', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'incremental-test-'));
    // Create a minimal project
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-project', dependencies: {} })
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create manifest file after full index', async () => {
    await fs.writeFile(path.join(tempDir, 'index.ts'), 'export const x = 1;');

    const indexer = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    });

    await indexer.index();

    const manifestPath = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME);
    const manifest = await readManifest(manifestPath);
    expect(manifest).not.toBeNull();
    expect(manifest!.version).toBe(1);
    expect(Object.keys(manifest!.files).length).toBeGreaterThan(0);
  });

  it('should return early with no changes in incremental mode', async () => {
    await fs.writeFile(path.join(tempDir, 'index.ts'), 'export const x = 1;');

    // Full index first
    const indexer1 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    });
    await indexer1.index();

    // Incremental index — nothing changed
    const indexer2 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      incrementalOnly: true
    });
    const stats = await indexer2.index();

    expect(stats.incremental).toBeDefined();
    expect(stats.incremental!.added).toBe(0);
    expect(stats.incremental!.changed).toBe(0);
    expect(stats.incremental!.deleted).toBe(0);
    expect(stats.incremental!.unchanged).toBeGreaterThan(0);
    // Duration should be very fast since nothing happened
    expect(stats.duration).toBeLessThan(5000);
  });

  it('should detect changed files in incremental mode', async () => {
    await fs.writeFile(path.join(tempDir, 'index.ts'), 'export const x = 1;');

    // Full index first
    const indexer1 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    });
    await indexer1.index();

    // Modify a file
    await fs.writeFile(path.join(tempDir, 'index.ts'), 'export const x = 2; // changed');

    // Incremental index
    const indexer2 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      incrementalOnly: true
    });
    const stats = await indexer2.index();

    expect(stats.incremental).toBeDefined();
    expect(stats.incremental!.changed).toBeGreaterThanOrEqual(1);
  });

  it('should detect new files in incremental mode', async () => {
    await fs.writeFile(path.join(tempDir, 'index.ts'), 'export const x = 1;');

    // Full index first
    const indexer1 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    });
    await indexer1.index();

    // Add a new file
    await fs.writeFile(path.join(tempDir, 'utils.ts'), 'export function add(a: number, b: number) { return a + b; }');

    // Incremental index
    const indexer2 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      incrementalOnly: true
    });
    const stats = await indexer2.index();

    expect(stats.incremental).toBeDefined();
    expect(stats.incremental!.added).toBeGreaterThanOrEqual(1);
  });

  it('should detect deleted files in incremental mode', async () => {
    await fs.writeFile(path.join(tempDir, 'index.ts'), 'export const x = 1;');
    await fs.writeFile(path.join(tempDir, 'delete-me.ts'), 'export const y = 2;');

    // Full index first
    const indexer1 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    });
    await indexer1.index();

    // Delete a file
    await fs.unlink(path.join(tempDir, 'delete-me.ts'));

    // Incremental index
    const indexer2 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      incrementalOnly: true
    });
    const stats = await indexer2.index();

    expect(stats.incremental).toBeDefined();
    expect(stats.incremental!.deleted).toBeGreaterThanOrEqual(1);
  });

  it('should fall back to full-like behavior when no manifest exists', async () => {
    await fs.writeFile(path.join(tempDir, 'index.ts'), 'export const x = 1;');

    // Run incremental without prior full index (no manifest)
    const indexer = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      incrementalOnly: true
    });
    const stats = await indexer.index();

    // Should treat all files as "added" since there's no old manifest
    expect(stats.incremental).toBeDefined();
    expect(stats.incremental!.added).toBeGreaterThan(0);
    expect(stats.incremental!.unchanged).toBe(0);
    expect(stats.incremental!.deleted).toBe(0);

    // Manifest should be created
    const manifestPath = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME);
    const manifest = await readManifest(manifestPath);
    expect(manifest).not.toBeNull();
  });

  it('should update manifest after incremental index', async () => {
    await fs.writeFile(path.join(tempDir, 'index.ts'), 'export const x = 1;');

    // Full index
    const indexer1 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    });
    await indexer1.index();

    const manifestPath = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME);
    const manifest1 = await readManifest(manifestPath);

    // Add a new file
    await fs.writeFile(path.join(tempDir, 'new.ts'), 'export const y = 2;');

    // Incremental index
    const indexer2 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      incrementalOnly: true
    });
    await indexer2.index();

    const manifest2 = await readManifest(manifestPath);
    expect(manifest2).not.toBeNull();

    // New manifest should have more files
    expect(Object.keys(manifest2!.files).length).toBeGreaterThan(
      Object.keys(manifest1!.files).length
    );
  });

  it('should regenerate keyword index with all chunks during incremental', async () => {
    await fs.writeFile(path.join(tempDir, 'a.ts'), 'export const a = 1;');
    await fs.writeFile(path.join(tempDir, 'b.ts'), 'export const b = 2;');

    // Full index
    const indexer1 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    });
    await indexer1.index();

    const indexPath = path.join(tempDir, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
    const fullIndex = JSON.parse(await fs.readFile(indexPath, 'utf-8'));

    // Modify one file
    await fs.writeFile(path.join(tempDir, 'a.ts'), 'export const a = 999;');

    // Incremental index
    const indexer2 = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true },
      incrementalOnly: true
    });
    await indexer2.index();

    // Keyword index should still contain chunks from ALL files (not just changed ones)
    const incrementalIndex = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
    expect(incrementalIndex.length).toBeGreaterThanOrEqual(fullIndex.length);
  });

  it('should not include incremental stats in full index', async () => {
    await fs.writeFile(path.join(tempDir, 'index.ts'), 'export const x = 1;');

    const indexer = new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    });
    const stats = await indexer.index();

    expect(stats.incremental).toBeUndefined();
  });
});
