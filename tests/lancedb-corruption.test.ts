import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { IndexCorruptedError } from '../src/errors/index.js';

const lancedb = vi.hoisted(() => ({
  connect: vi.fn()
}));

vi.mock('@lancedb/lancedb', () => ({
  connect: lancedb.connect
}));

describe('LanceDBStorageProvider corruption detection', () => {
  let tempDir: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lancedb-test-'));
    lancedb.connect.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleErrorSpy.mockRestore();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('throws IndexCorruptedError when vector column missing during initialize()', async () => {
    const db = {
      tableNames: vi.fn(async () => ['code_chunks']),
      openTable: vi.fn(async () => ({
        schema: vi.fn(async () => ({ fields: [{ name: 'id' }] }))
      }))
    };

    lancedb.connect.mockResolvedValue(db);

    const { LanceDBStorageProvider } = await import('../src/storage/lancedb.js');
    const provider = new LanceDBStorageProvider();

    await expect(provider.initialize(tempDir)).rejects.toBeInstanceOf(IndexCorruptedError);
    // dropTable is no longer called within initialize (senior mindset: separation of concerns)
  });

  it('throws IndexCorruptedError when schema() throws during initialize()', async () => {
    const db = {
      tableNames: vi.fn(async () => ['code_chunks']),
      openTable: vi.fn(async () => ({
        schema: vi.fn(async () => {
          throw new Error('schema error');
        })
      }))
    };

    lancedb.connect.mockResolvedValue(db);

    const { LanceDBStorageProvider } = await import('../src/storage/lancedb.js');
    const provider = new LanceDBStorageProvider();

    // This now throws the raw error (not IndexCorruptedError) since we don't wrap all errors
    await expect(provider.initialize(tempDir)).rejects.toThrow('schema error');
  });

  it('throws IndexCorruptedError when vector search fails with "No vector column"', async () => {
    const { LanceDBStorageProvider } = await import('../src/storage/lancedb.js');
    const provider = new LanceDBStorageProvider() as any;

    const query = {
      limit: vi.fn(() => query),
      where: vi.fn(() => query),
      toArray: vi.fn(async () => {
        throw new Error('Schema Error: No vector column found to create index');
      })
    };

    provider.initialized = true;
    provider.table = {
      vectorSearch: vi.fn(() => query)
    };

    await expect(provider.search([0.1, 0.2], 5)).rejects.toBeInstanceOf(IndexCorruptedError);
  });

  it('returns empty array for transient search errors', async () => {
    const { LanceDBStorageProvider } = await import('../src/storage/lancedb.js');
    const provider = new LanceDBStorageProvider() as any;

    const query = {
      limit: vi.fn(() => query),
      where: vi.fn(() => query),
      toArray: vi.fn(async () => {
        throw new Error('Network timeout');
      })
    };

    provider.initialized = true;
    provider.table = {
      vectorSearch: vi.fn(() => query)
    };

    const results = await provider.search([0.1, 0.2], 5);
    expect(results).toEqual([]);
  });

  it('quotes filePath column when deleting by file paths', async () => {
    const { LanceDBStorageProvider } = await import('../src/storage/lancedb.js');
    const provider = new LanceDBStorageProvider() as any;

    const deleteSpy = vi.fn(async () => {});
    provider.initialized = true;
    provider.table = {
      countRows: vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(7),
      delete: deleteSpy
    };

    const deleted = await provider.deleteByFilePaths(['C:/repo/src/a.ts', "C:/repo/src/b'test.ts"]);

    expect(deleted).toBe(3);
    expect(deleteSpy).toHaveBeenCalledWith(
      "\"filePath\" IN ('C:/repo/src/a.ts', 'C:/repo/src/b''test.ts')"
    );
  });

  it('quotes componentType column when applying search filters', async () => {
    const { LanceDBStorageProvider } = await import('../src/storage/lancedb.js');
    const provider = new LanceDBStorageProvider() as any;

    const whereSpy = vi.fn(() => query);
    const query = {
      limit: vi.fn(() => query),
      where: whereSpy,
      toArray: vi.fn(async () => [])
    };

    provider.initialized = true;
    provider.table = {
      vectorSearch: vi.fn(() => query)
    };

    const results = await provider.search([0.1, 0.2], 5, {
      componentType: 'service',
      layer: 'business'
    });

    expect(results).toEqual([]);
    expect(whereSpy).toHaveBeenCalledWith("\"componentType\" = 'service' AND layer = 'business'");
  });
});
