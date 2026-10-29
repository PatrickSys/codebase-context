import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { readIndexMeta, validateIndexArtifacts } from '../src/core/index-meta.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  RELATIONSHIPS_FILENAME,
  INDEX_META_FILENAME,
  INDEX_FORMAT_VERSION
} from '../src/constants/codebase-context.js';

async function createTempDir(): Promise<string> {
  const tmpDir = path.join(process.cwd(), `.tmp-rel-test-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Relationship Sidecar', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupDir(tmpDir);
  });

  it('writes relationships.json on full index', async () => {
    // Create a simple TypeScript project
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    // Create some TypeScript files
    await fs.writeFile(
      path.join(srcDir, 'a.ts'),
      `export function greet(name: string) { return 'Hello ' + name; }\n` +
        `export function farewell(name: string) { return 'Goodbye ' + name; }\n`
    );

    await fs.writeFile(
      path.join(srcDir, 'b.ts'),
      `import { greet } from './a';\n` + `export function main() { console.log(greet('World')); }\n`
    );

    // Run full index
    const indexer = new CodebaseIndexer({
      rootPath: tmpDir,
      config: { skipEmbedding: true }
    });
    await indexer.index();

    // Check relationships.json exists
    const contextDir = path.join(tmpDir, CODEBASE_CONTEXT_DIRNAME);
    const relationshipsPath = path.join(contextDir, RELATIONSHIPS_FILENAME);
    const relationshipsExists = await fs
      .access(relationshipsPath)
      .then(() => true)
      .catch(() => false);
    expect(relationshipsExists).toBe(true);

    // Read and validate structure
    const raw = await fs.readFile(relationshipsPath, 'utf-8');
    const relationships = JSON.parse(raw);

    expect(relationships.header).toBeDefined();
    expect(relationships.header.buildId).toBeDefined();
    expect(typeof relationships.header.buildId).toBe('string');
    expect(relationships.header.formatVersion).toBe(INDEX_FORMAT_VERSION);
    expect(relationships.generatedAt).toBeDefined();
    expect(relationships.graph).toBeDefined();
    expect(typeof relationships.graph.imports).toBe('object');
    expect(typeof relationships.graph.importedBy).toBe('object');
    expect(typeof relationships.graph.exports).toBe('object');

    // Rich edge details should be persisted when available
    const importDetails = relationships.graph.importDetails as
      | Record<string, Record<string, { line?: number; importedSymbols?: string[] }>>
      | undefined;
    expect(importDetails).toBeDefined();
    expect(typeof importDetails).toBe('object');

    const fromFile = Object.keys(importDetails ?? {}).find((k) => k.endsWith('src/b.ts'));
    expect(fromFile).toBeDefined();
    const edges = fromFile ? importDetails?.[fromFile] : undefined;

    const toFile = Object.keys(edges ?? {}).find((k) => k.endsWith('src/a.ts'));
    expect(toFile).toBeDefined();
    const detail = toFile ? edges?.[toFile] : undefined;

    expect(detail).toBeDefined();
    if (detail) {
      expect(detail.line).toBe(1);
      expect(Array.isArray(detail.importedSymbols)).toBe(true);
      expect(detail.importedSymbols ?? []).toContain('greet');
    }
    expect(relationships.symbols).toBeDefined();
    expect(typeof relationships.symbols.exportedBy).toBe('object');
    expect(relationships.stats).toBeDefined();
    expect(typeof relationships.stats.files).toBe('number');
    expect(typeof relationships.stats.edges).toBe('number');
  });

  it('relationships.json header matches index-meta.json', async () => {
    const contextDir = path.join(tmpDir, CODEBASE_CONTEXT_DIRNAME);

    const metaRaw = await fs.readFile(path.join(contextDir, INDEX_META_FILENAME), 'utf-8');
    const meta = JSON.parse(metaRaw);

    const relRaw = await fs.readFile(path.join(contextDir, RELATIONSHIPS_FILENAME), 'utf-8');
    const relationships = JSON.parse(relRaw);

    expect(relationships.header.buildId).toBe(meta.buildId);
    expect(relationships.header.formatVersion).toBe(meta.formatVersion);
  });

  it('index meta validates relationships artifact', async () => {
    const meta = await readIndexMeta(tmpDir);
    await validateIndexArtifacts(tmpDir, meta);
    // If this passes, the relationships sidecar header matches meta
  });

  it('updates relationships.json on incremental index', async () => {
    // Record the initial buildId
    const contextDir = path.join(tmpDir, CODEBASE_CONTEXT_DIRNAME);
    const relRaw1 = await fs.readFile(path.join(contextDir, RELATIONSHIPS_FILENAME), 'utf-8');
    const relationships1 = JSON.parse(relRaw1);

    // Add a new file
    const srcDir = path.join(tmpDir, 'src');
    await fs.writeFile(
      path.join(srcDir, 'c.ts'),
      `import { greet, farewell } from './a';\n` +
        `export function run() { greet('C'); farewell('C'); }\n`
    );

    // Run incremental index
    const indexer = new CodebaseIndexer({
      rootPath: tmpDir,
      config: { skipEmbedding: true },
      incrementalOnly: true
    });
    await indexer.index();

    // Read updated relationships
    const relRaw2 = await fs.readFile(path.join(contextDir, RELATIONSHIPS_FILENAME), 'utf-8');
    const relationships2 = JSON.parse(relRaw2);

    // The file should still have valid structure after incremental update
    expect(relationships2.header).toBeDefined();
    expect(relationships2.header.buildId).toBeDefined();
    expect(relationships2.graph).toBeDefined();
    expect(relationships2.symbols).toBeDefined();

    // After adding a file and reindexing, the stats should exist
    expect(relationships2.stats).toBeDefined();
  });

  it('reindex produces valid relationships.json', async () => {
    // Force a full reindex by deleting the context directory
    const contextDir = path.join(tmpDir, CODEBASE_CONTEXT_DIRNAME);
    await fs.rm(contextDir, { recursive: true, force: true });

    // Run full index
    const indexer = new CodebaseIndexer({
      rootPath: tmpDir,
      config: { skipEmbedding: true }
    });
    await indexer.index();

    // Check relationships.json exists again
    const relationshipsPath = path.join(contextDir, RELATIONSHIPS_FILENAME);
    const relationshipsExists = await fs
      .access(relationshipsPath)
      .then(() => true)
      .catch(() => false);
    expect(relationshipsExists).toBe(true);

    // Validate structure
    const raw = await fs.readFile(relationshipsPath, 'utf-8');
    const relationships = JSON.parse(raw);

    expect(relationships.header).toBeDefined();
    expect(relationships.header.formatVersion).toBe(INDEX_FORMAT_VERSION);
    expect(relationships.graph).toBeDefined();
    expect(relationships.symbols).toBeDefined();
    expect(relationships.stats).toBeDefined();
  });
});
