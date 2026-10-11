import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { startFileWatcher } from '../src/core/file-watcher.js';
import { rmWithRetries } from './test-helpers.js';

describe('FileWatcher', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-watcher-test-'));
  });

  afterEach(async () => {
    await rmWithRetries(tempDir);
  });

  it('triggers onChanged after debounce window', async () => {
    const debounceMs = 400;
    let callCount = 0;

    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const stop = startFileWatcher({
      rootPath: tempDir,
      debounceMs,
      onReady: () => resolveReady(),
      onChanged: () => {
        callCount++;
      }
    });

    try {
      await ready;
      await fs.writeFile(path.join(tempDir, 'test.ts'), 'export const x = 1;');
      // Wait for chokidar to pick up the event (including awaitWriteFinish stabilityThreshold)
      // + debounce window + OS scheduling slack
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 1000));
      expect(callCount).toBe(1);
    } finally {
      stop();
    }
  }, 8000);

  it('debounces rapid changes into a single callback', async () => {
    const debounceMs = 800;
    let callCount = 0;

    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const stop = startFileWatcher({
      rootPath: tempDir,
      debounceMs,
      onReady: () => resolveReady(),
      onChanged: () => {
        callCount++;
      }
    });

    try {
      // Give chokidar a moment to finish initializing before the first write
      await ready;
      // Write 5 files in quick succession — all within the debounce window
      for (let i = 0; i < 5; i++) {
        await fs.writeFile(path.join(tempDir, `file${i}.ts`), `export const x${i} = ${i};`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      // Wait for debounce to settle
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 1200));
      expect(callCount).toBe(1);
    } finally {
      stop();
    }
  }, 8000);

  it('stop() cancels a pending callback', async () => {
    const debounceMs = 500;
    let callCount = 0;

    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const stop = startFileWatcher({
      rootPath: tempDir,
      debounceMs,
      onReady: () => resolveReady(),
      onChanged: () => {
        callCount++;
      }
    });

    // Give chokidar a moment to finish initializing before the first write
    await ready;
    await fs.writeFile(path.join(tempDir, 'cancel.ts'), 'export const y = 99;');
    // Let chokidar detect the event (including awaitWriteFinish stabilityThreshold)
    // but stop before the debounce window expires.
    await new Promise((resolve) => setTimeout(resolve, 350));
    stop();
    // Wait past where debounce would have fired
    await new Promise((resolve) => setTimeout(resolve, debounceMs + 200));
    expect(callCount).toBe(0);
  }, 5000);

  it('ignores changes to non-tracked file extensions', async () => {
    const debounceMs = 250;
    let callCount = 0;

    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const stop = startFileWatcher({
      rootPath: tempDir,
      debounceMs,
      onReady: () => resolveReady(),
      onChanged: () => {
        callCount++;
      }
    });

    try {
      await ready;
      await fs.writeFile(path.join(tempDir, 'notes.txt'), 'this should be ignored');
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 700));
      expect(callCount).toBe(0);
    } finally {
      stop();
    }
  }, 5000);

  it('triggers on .gitignore changes', async () => {
    const debounceMs = 250;
    let callCount = 0;

    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const stop = startFileWatcher({
      rootPath: tempDir,
      debounceMs,
      onReady: () => resolveReady(),
      onChanged: () => {
        callCount++;
      }
    });

    try {
      await ready;
      await fs.writeFile(path.join(tempDir, '.gitignore'), 'dist/\n');
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 700));
      expect(callCount).toBe(1);
    } finally {
      stop();
    }
  }, 5000);

  it('tracks project-local extra extensions without changing defaults', async () => {
    const debounceMs = 250;
    let callCount = 0;

    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const stop = startFileWatcher({
      rootPath: tempDir,
      debounceMs,
      extraExtensions: ['.sfc'],
      onReady: () => resolveReady(),
      onChanged: () => {
        callCount++;
      }
    });

    try {
      await ready;
      await fs.writeFile(path.join(tempDir, 'widget.sfc'), '<script>export default {};</script>');
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 700));
      expect(callCount).toBe(1);
    } finally {
      stop();
    }
  }, 5000);

  it('prunes excluded directories at any depth without hiding similar names', async () => {
    const debounceMs = 150;
    let callCount = 0;

    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const stop = startFileWatcher({
      rootPath: tempDir,
      debounceMs,
      onReady: () => resolveReady(),
      onChanged: () => {
        callCount++;
      }
    });

    try {
      await ready;
      for (const excluded of ['nested/node_modules', 'dist', '.codebase-context']) {
        const directory = path.join(tempDir, 'parent', excluded);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'ignored.ts'), 'export const ignored = true;');
      }
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 700));
      expect(callCount).toBe(0);

      const allowed = path.join(tempDir, 'nested', 'node_modules-copy');
      await fs.mkdir(allowed, { recursive: true });
      await fs.writeFile(path.join(allowed, 'included.ts'), 'export const included = true;');
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 700));
      expect(callCount).toBe(1);
    } finally {
      stop();
    }
  }, 7000);

  it('watches a literal brace-named root and reports add, change, and unlink', async () => {
    const braceRoot = path.join(tempDir, '{literal-root}');
    await fs.mkdir(braceRoot);
    const debounceMs = 100;
    let callCount = 0;

    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const stop = startFileWatcher({
      rootPath: braceRoot,
      debounceMs,
      onReady: () => resolveReady(),
      onChanged: () => {
        callCount++;
      }
    });

    const filePath = path.join(braceRoot, 'tracked.ts');
    try {
      await ready;
      await fs.writeFile(filePath, 'export const value = 1;');
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 450));
      expect(callCount).toBe(1);

      await fs.writeFile(filePath, 'export const value = 2;');
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 450));
      expect(callCount).toBe(2);

      await fs.unlink(filePath);
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 450));
      expect(callCount).toBe(3);
    } finally {
      stop();
    }
  }, 5000);
});
