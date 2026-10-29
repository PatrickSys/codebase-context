import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, access, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { handleMapCli } from '../src/cli-map.js';

describe('handleMapCli --export', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes CODEBASE_MAP.md to rootPath', async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cli-map-export-'));
    const original = process.env.CODEBASE_ROOT;
    process.env.CODEBASE_ROOT = tmpDir;
    try {
      await handleMapCli(['--export']);
      // File must exist
      await access(path.join(tmpDir, 'CODEBASE_MAP.md'));
      // Content must be markdown (starts with # Codebase Map)
      const content = await readFile(path.join(tmpDir, 'CODEBASE_MAP.md'), 'utf-8');
      expect(content).toContain('# Codebase Map');
    } finally {
      if (original === undefined) delete process.env.CODEBASE_ROOT;
      else process.env.CODEBASE_ROOT = original;
    }
  });

  it('--export takes precedence over --json', async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cli-map-export-'));
    const original = process.env.CODEBASE_ROOT;
    process.env.CODEBASE_ROOT = tmpDir;
    try {
      await handleMapCli(['--export', '--json']);
      // Must write the file (not print JSON and skip)
      await access(path.join(tmpDir, 'CODEBASE_MAP.md'));
      // File content must be markdown, not JSON
      const content = await readFile(path.join(tmpDir, 'CODEBASE_MAP.md'), 'utf-8');
      expect(content).toContain('# Codebase Map');
      expect(content).not.toMatch(/^\{/);
    } finally {
      if (original === undefined) delete process.env.CODEBASE_ROOT;
      else process.env.CODEBASE_ROOT = original;
    }
  });

  it('--export takes precedence over --pretty', async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cli-map-export-'));
    const original = process.env.CODEBASE_ROOT;
    process.env.CODEBASE_ROOT = tmpDir;
    try {
      await handleMapCli(['--export', '--pretty']);
      await access(path.join(tmpDir, 'CODEBASE_MAP.md'));
      const content = await readFile(path.join(tmpDir, 'CODEBASE_MAP.md'), 'utf-8');
      expect(content).toContain('# Codebase Map');
    } finally {
      if (original === undefined) delete process.env.CODEBASE_ROOT;
      else process.env.CODEBASE_ROOT = original;
    }
  });

  it('indexes a project that has no index before printing the map', async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cli-map-index-'));
    await writeFile(path.join(tmpDir, 'server.ts'), 'export const port = 3000;\n', 'utf-8');
    const original = process.env.CODEBASE_ROOT;
    process.env.CODEBASE_ROOT = tmpDir;
    try {
      await handleMapCli(['--export']);
      await access(path.join(tmpDir, '.codebase-context', 'index.json'));
      const content = await readFile(path.join(tmpDir, 'CODEBASE_MAP.md'), 'utf-8');
      expect(content).toMatch(/Files: [1-9]/);
    } finally {
      if (original === undefined) delete process.env.CODEBASE_ROOT;
      else process.env.CODEBASE_ROOT = original;
    }
  });
});
