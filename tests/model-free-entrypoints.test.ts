import { describe, expect, it, vi } from 'vitest';
import { parseEmbeddingModeFlags, handleCliCommand } from '../src/cli.js';
import { definition, handle as refreshIndex } from '../src/tools/refresh-index.js';
import { makePaths } from '../src/project-state.js';
import type { ToolContext } from '../src/tools/types.js';

describe('model-free entrypoint contract', () => {
  it('uses absence to preserve the last successful mode, not to select semantic mode', () => {
    expect(parseEmbeddingModeFlags(['reindex', '--incremental'])).toBeUndefined();
    expect(parseEmbeddingModeFlags(['--no-embeddings', '/project'])).toBe(true);
    expect(parseEmbeddingModeFlags(['reindex', '--embeddings'])).toBe(false);
  });

  it.each([['--embeddings', '--no-embeddings'], ['--embeddings=true'], ['--no-embeddings=false']])(
    'rejects ambiguous mode flags %j',
    (...args) => {
      expect(() => parseEmbeddingModeFlags(args)).toThrow(/mutually exclusive|without a value/);
    }
  );

  it.each(['search', 'map', 'memory'])(
    'does not silently ignore a mode flag on %s',
    async (command) => {
      await expect(handleCliCommand([command, '--no-embeddings'])).rejects.toThrow(/with reindex/);
    }
  );

  function context(status: ToolContext['indexState']['status'] = 'ready'): ToolContext {
    return {
      rootPath: '/unused-model-free-contract',
      paths: makePaths('/unused-model-free-contract'),
      indexState: { status },
      performIndexing: vi.fn()
    };
  }

  it('exposes the optional mode selection in MCP without changing existing omitted calls', async () => {
    expect(definition.inputSchema.properties?.skipEmbedding).toMatchObject({ type: 'boolean' });
    const ctx = context();
    await refreshIndex({ incrementalOnly: true }, ctx);
    expect(ctx.performIndexing).toHaveBeenCalledWith(true, undefined, undefined);
  });

  it.each([true, false])(
    'forwards an explicit MCP skipEmbedding=%s without truthiness loss',
    async (skipEmbedding) => {
      const ctx = context();
      await refreshIndex({ incrementalOnly: true, reason: 'mode transition', skipEmbedding }, ctx);
      expect(ctx.performIndexing).toHaveBeenCalledWith(true, 'mode transition', skipEmbedding);
    }
  );

  it.each(['false', null, 1])(
    'rejects non-boolean MCP mode %j before indexing',
    async (skipEmbedding) => {
      const ctx = context();
      const result = await refreshIndex({ skipEmbedding }, ctx);
      expect(result.isError).toBe(true);
      expect(ctx.performIndexing).not.toHaveBeenCalled();
    }
  );

  it('does not start an overlapping build or apply a mode change while indexing', async () => {
    const ctx = context('indexing');
    const result = await refreshIndex({ skipEmbedding: false }, ctx);
    expect(JSON.parse(result.content![0].text).status).toBe('busy');
    expect(result.isError).toBe(true);
    expect(ctx.performIndexing).not.toHaveBeenCalled();
  });
});
