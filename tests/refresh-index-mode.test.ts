import { describe, expect, it, vi } from 'vitest';
import * as embeddings from '../src/embeddings/index.js';
import { OptionalDependencyError } from '../src/errors/index.js';
import * as storage from '../src/storage/index.js';
import { handle } from '../src/tools/refresh-index.js';
import type { ToolContext } from '../src/tools/types.js';

function makeContext(status: ToolContext['indexState']['status'] = 'idle') {
  const indexer = {} as NonNullable<ToolContext['indexState']['indexer']>;
  const stats = {} as NonNullable<ToolContext['indexState']['stats']>;
  return {
    indexState: { status, lastIndexed: new Date(1), indexer, stats },
    paths: {} as ToolContext['paths'],
    rootPath: '/project',
    performIndexing: vi.fn()
  } satisfies ToolContext;
}

describe('refresh_index embedding mode', () => {
  it('forwards explicit semantic opt-in and preserves omission for recorded mode resolution', async () => {
    const context = makeContext();
    const embeddingAssert = vi
      .spyOn(embeddings, 'assertEmbeddingRuntimeAvailable')
      .mockImplementation(() => {});
    const storageAssert = vi
      .spyOn(storage, 'assertStorageRuntimeAvailable')
      .mockImplementation(() => {});
    try {
      await handle(
        { skipEmbedding: false, incrementalOnly: true, reason: 'owner choice' },
        context
      );
      await handle({ incrementalOnly: true }, context);

      expect(embeddingAssert).toHaveBeenCalledTimes(1);
      expect(storageAssert).toHaveBeenCalledTimes(1);
      expect(context.performIndexing).toHaveBeenNthCalledWith(1, true, 'owner choice', false);
      expect(context.performIndexing).toHaveBeenNthCalledWith(2, true, undefined, undefined);
    } finally {
      embeddingAssert.mockRestore();
      storageAssert.mockRestore();
    }
  });

  it('rejects invalid or busy mode changes before starting indexing', async () => {
    const invalidContext = makeContext();
    const invalid = await handle({ skipEmbedding: 'false' }, invalidContext);
    expect(invalid.isError).toBe(true);
    expect(invalidContext.performIndexing).not.toHaveBeenCalled();

    const busyContext = makeContext('indexing');
    const busy = await handle({ skipEmbedding: false }, busyContext);
    expect(busy.isError).toBe(true);
    expect(busyContext.performIndexing).not.toHaveBeenCalled();
  });

  it('rejects missing embedding runtime before dispatch and preserves prior ready state', async () => {
    const context = makeContext('ready');
    const originalState = { ...context.indexState };
    const missingRuntime = new OptionalDependencyError('@huggingface/transformers', '^4.2.0');
    const embeddingAssert = vi
      .spyOn(embeddings, 'assertEmbeddingRuntimeAvailable')
      .mockImplementationOnce(() => {
        throw missingRuntime;
      });
    const storageAssert = vi.spyOn(storage, 'assertStorageRuntimeAvailable');

    try {
      const response = await handle({ skipEmbedding: false }, context);
      expect(response.isError).toBe(true);
      expect(response.content?.[0].text).toContain('@huggingface/transformers');
      expect(response.content?.[0].text).toContain('npm install');
      expect(context.performIndexing).not.toHaveBeenCalled();
      expect(context.indexState).toEqual(originalState);
      expect(embeddingAssert).toHaveBeenCalledTimes(1);
      expect(storageAssert).not.toHaveBeenCalled();
    } finally {
      embeddingAssert.mockRestore();
      storageAssert.mockRestore();
    }
  });

  it('rejects missing vector storage after embedding preflight without changing project state', async () => {
    const context = makeContext('ready');
    const originalState = { ...context.indexState };
    const embeddingAssert = vi
      .spyOn(embeddings, 'assertEmbeddingRuntimeAvailable')
      .mockImplementation(() => {});
    const missingRuntime = new OptionalDependencyError('@lancedb/lancedb', '^0.4.0');
    const storageAssert = vi
      .spyOn(storage, 'assertStorageRuntimeAvailable')
      .mockImplementationOnce(() => {
        throw missingRuntime;
      });

    try {
      const response = await handle({ skipEmbedding: false }, context);
      expect(response.isError).toBe(true);
      expect(response.content?.[0].text).toContain('@lancedb/lancedb');
      expect(response.content?.[0].text).toContain('npm install');
      expect(context.performIndexing).not.toHaveBeenCalled();
      expect(context.indexState).toEqual(originalState);
      expect(embeddingAssert).toHaveBeenCalledTimes(1);
      expect(storageAssert).toHaveBeenCalledTimes(1);
    } finally {
      embeddingAssert.mockRestore();
      storageAssert.mockRestore();
    }
  });
});
