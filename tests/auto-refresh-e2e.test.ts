import { resolveIndexArtifact } from '../src/core/index-generation.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { startFileWatcher } from '../src/core/file-watcher.js';
import { createAutoRefreshController } from '../src/core/auto-refresh.js';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { rmWithRetries } from './test-helpers.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  KEYWORD_INDEX_FILENAME
} from '../src/constants/codebase-context.js';

type IndexStatus = 'idle' | 'indexing' | 'ready' | 'error';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getKeywordChunks(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) {
    return raw.filter(isRecord);
  }
  if (!isRecord(raw)) return [];
  if (!Array.isArray(raw.chunks)) return [];
  return raw.chunks.filter(isRecord);
}

async function readIndexedContent(rootPath: string): Promise<string> {
  const indexPath = await resolveIndexArtifact(rootPath, KEYWORD_INDEX_FILENAME);
  const raw = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as unknown;
  const chunks = getKeywordChunks(raw);
  return chunks.map((chunk) => (typeof chunk.content === 'string' ? chunk.content : '')).join('\n');
}

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await condition()) return;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const reason =
    lastError instanceof Error && lastError.message
      ? ` Last transient error: ${lastError.message}`
      : '';
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition.${reason}`);
}

describe('Auto-refresh E2E', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-refresh-e2e-'));
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'watch-test' }));
    await fs.writeFile(
      path.join(tempDir, 'src', 'app.ts'),
      'export const token = "INITIAL_TOKEN";\n'
    );
  });

  afterEach(async () => {
    await rmWithRetries(tempDir);
  });

  it('updates index after a file edit without manual refresh_index', async () => {
    await new CodebaseIndexer({
      rootPath: tempDir,
      config: { skipEmbedding: true }
    }).index();

    const initialContent = await readIndexedContent(tempDir);
    expect(initialContent).toContain('INITIAL_TOKEN');
    expect(initialContent).not.toContain('UPDATED_TOKEN');

    const autoRefresh = createAutoRefreshController();
    let indexStatus: IndexStatus = 'ready';
    let incrementalRuns = 0;

    const runIncrementalIndex = async (): Promise<void> => {
      if (indexStatus === 'indexing') return;
      indexStatus = 'indexing';

      try {
        await new CodebaseIndexer({
          rootPath: tempDir,
          config: { skipEmbedding: true },
          incrementalOnly: true
        }).index();
        indexStatus = 'ready';
      } catch (error) {
        indexStatus = 'error';
        throw error;
      }

      if (autoRefresh.consumeQueuedRefresh(indexStatus)) {
        incrementalRuns++;
        void runIncrementalIndex();
      }
    };

    let resolveReady!: () => void;
    const watcherReady = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const stopWatcher = startFileWatcher({
      rootPath: tempDir,
      debounceMs: 200,
      onReady: () => resolveReady(),
      onChanged: () => {
        const shouldRunNow = autoRefresh.onFileChange(indexStatus === 'indexing');
        if (!shouldRunNow) return;
        incrementalRuns++;
        void runIncrementalIndex();
      }
    });

    try {
      await watcherReady;
      await fs.writeFile(
        path.join(tempDir, 'src', 'app.ts'),
        'export const token = "UPDATED_TOKEN";\n'
      );

      await waitFor(
        async () => {
          const content = await readIndexedContent(tempDir);
          return content.includes('UPDATED_TOKEN');
        },
        15000,
        200
      );

      const updatedContent = await readIndexedContent(tempDir);
      expect(updatedContent).toContain('UPDATED_TOKEN');
      expect(incrementalRuns).toBeGreaterThan(0);
    } finally {
      await stopWatcher();
    }
  }, 20000);
});
