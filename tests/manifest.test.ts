import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  hashFileContent,
  readManifest,
  writeManifest,
  computeFileHashes,
  diffManifest,
  type FileManifest
} from '../src/core/manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Manifest System', () => {
  const testDir = path.join(__dirname, 'test-workspace-manifest');
  const manifestPath = path.join(testDir, 'manifest.json');

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('hashFileContent', () => {
    it('should produce consistent SHA-256 prefix', () => {
      const hash1 = hashFileContent('hello world');
      const hash2 = hashFileContent('hello world');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
      expect(hash1).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = hashFileContent('file A content');
      const hash2 = hashFileContent('file B content');
      expect(hash1).not.toBe(hash2);
    });

    it('should be sensitive to whitespace changes', () => {
      const hash1 = hashFileContent('const x = 1;');
      const hash2 = hashFileContent('const x  = 1;');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('readManifest / writeManifest', () => {
    it('should round-trip a valid manifest', async () => {
      const manifest: FileManifest = {
        version: 1,
        generatedAt: '2026-02-08T00:00:00.000Z',
        files: {
          'src/index.ts': 'abcdef1234567890',
          'src/utils.ts': '1234567890abcdef'
        }
      };

      await writeManifest(manifestPath, manifest);
      const read = await readManifest(manifestPath);
      expect(read).toEqual(manifest);
    });

    it('should return null for missing file', async () => {
      const result = await readManifest(path.join(testDir, 'nonexistent.json'));
      expect(result).toBeNull();
    });

    it('should return null for corrupt JSON', async () => {
      const corruptPath = path.join(testDir, 'corrupt.json');
      await fs.writeFile(corruptPath, 'not valid json{{{');
      const result = await readManifest(corruptPath);
      expect(result).toBeNull();
    });

    it('should return null for wrong version', async () => {
      const wrongVersionPath = path.join(testDir, 'wrong-version.json');
      await fs.writeFile(wrongVersionPath, JSON.stringify({ version: 99, files: {} }));
      const result = await readManifest(wrongVersionPath);
      expect(result).toBeNull();
    });

    it('should return null for missing files field', async () => {
      const noFilesPath = path.join(testDir, 'no-files.json');
      await fs.writeFile(noFilesPath, JSON.stringify({ version: 1 }));
      const result = await readManifest(noFilesPath);
      expect(result).toBeNull();
    });
  });

  describe('computeFileHashes', () => {
    it('should compute hashes for files relative to root', async () => {
      const fileA = path.join(testDir, 'a.ts');
      const fileB = path.join(testDir, 'b.ts');
      await fs.writeFile(fileA, 'export const a = 1;');
      await fs.writeFile(fileB, 'export const b = 2;');

      const hashes = await computeFileHashes([fileA, fileB], testDir);
      expect(Object.keys(hashes)).toHaveLength(2);
      expect(hashes['a.ts']).toMatch(/^[0-9a-f]{16}$/);
      expect(hashes['b.ts']).toMatch(/^[0-9a-f]{16}$/);
      expect(hashes['a.ts']).not.toBe(hashes['b.ts']);
    });

    it('should skip unreadable files', async () => {
      const hashes = await computeFileHashes(['/nonexistent/file.ts'], testDir);
      expect(Object.keys(hashes)).toHaveLength(0);
    });

    it('should accept custom readFile function', async () => {
      const mockRead = async () => 'mock content';
      const hashes = await computeFileHashes(
        [path.join(testDir, 'virtual.ts')],
        testDir,
        mockRead
      );
      expect(hashes['virtual.ts']).toBe(hashFileContent('mock content'));
    });
  });

  describe('diffManifest', () => {
    it('should treat all files as added when old manifest is null', () => {
      const currentHashes = {
        'src/a.ts': 'aaaa000000000000',
        'src/b.ts': 'bbbb000000000000'
      };
      const diff = diffManifest(null, currentHashes);
      expect(diff.added).toEqual(['src/a.ts', 'src/b.ts']);
      expect(diff.changed).toEqual([]);
      expect(diff.deleted).toEqual([]);
      expect(diff.unchanged).toEqual([]);
    });

    it('should correctly categorize added, changed, deleted, unchanged', () => {
      const oldManifest: FileManifest = {
        version: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        files: {
          'src/unchanged.ts': 'aaaa000000000000',
          'src/changed.ts': 'bbbb000000000000',
          'src/deleted.ts': 'cccc000000000000'
        }
      };

      const currentHashes = {
        'src/unchanged.ts': 'aaaa000000000000', // same hash
        'src/changed.ts': 'dddd111111111111', // different hash
        'src/added.ts': 'eeee222222222222' // new file
      };

      const diff = diffManifest(oldManifest, currentHashes);
      expect(diff.added).toEqual(['src/added.ts']);
      expect(diff.changed).toEqual(['src/changed.ts']);
      expect(diff.deleted).toEqual(['src/deleted.ts']);
      expect(diff.unchanged).toEqual(['src/unchanged.ts']);
    });

    it('should handle empty manifests', () => {
      const oldManifest: FileManifest = {
        version: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        files: {}
      };

      const diff = diffManifest(oldManifest, {});
      expect(diff.added).toEqual([]);
      expect(diff.changed).toEqual([]);
      expect(diff.deleted).toEqual([]);
      expect(diff.unchanged).toEqual([]);
    });

    it('should handle all files deleted', () => {
      const oldManifest: FileManifest = {
        version: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        files: {
          'a.ts': 'aaaa000000000000',
          'b.ts': 'bbbb000000000000'
        }
      };

      const diff = diffManifest(oldManifest, {});
      expect(diff.added).toEqual([]);
      expect(diff.changed).toEqual([]);
      expect(diff.deleted).toEqual(['a.ts', 'b.ts']);
      expect(diff.unchanged).toEqual([]);
    });
  });
});
