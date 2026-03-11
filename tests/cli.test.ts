import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';

const toolMocks = vi.hoisted(() => ({
  dispatchTool: vi.fn()
}));

vi.mock('../src/tools/index.js', () => ({
  dispatchTool: toolMocks.dispatchTool
}));

import { handleCliCommand, handleMemoryCli } from '../src/cli.js';

describe('CLI', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalEnvRoot: string | undefined;

  beforeEach(() => {
    toolMocks.dispatchTool.mockReset();

    originalEnvRoot = process.env.CODEBASE_ROOT;
    delete process.env.CODEBASE_ROOT;

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number): never => {
      throw new Error(`process.exit:${_code ?? ''}`);
    }) as unknown as typeof process.exit);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();

    if (originalEnvRoot === undefined) delete process.env.CODEBASE_ROOT;
    else process.env.CODEBASE_ROOT = originalEnvRoot;
  });

  it('search errors when --query has no value', async () => {
    await expect(handleCliCommand(['search', '--query', '--json'])).rejects.toThrow(
      /process\.exit:1/
    );
    expect(toolMocks.dispatchTool).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('search dispatches with typed args', async () => {
    toolMocks.dispatchTool.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }]
    });

    await handleCliCommand([
      'search',
      '--query',
      'foo',
      '--intent',
      'edit',
      '--limit',
      '3',
      '--lang',
      'ts',
      '--framework',
      'angular',
      '--layer',
      'core',
      '--json'
    ]);

    expect(toolMocks.dispatchTool).toHaveBeenCalledTimes(1);
    const [toolName, toolArgs] = toolMocks.dispatchTool.mock.calls[0] ?? [];
    expect(toolName).toBe('search_codebase');
    expect(toolArgs).toEqual({
      query: 'foo',
      includeSnippets: true,
      intent: 'edit',
      limit: 3,
      filters: { language: 'ts', framework: 'angular', layer: 'core' }
    });
  });

  it('patterns errors on invalid category', async () => {
    await expect(handleCliCommand(['patterns', '--category', 'nope'])).rejects.toThrow(
      /process\.exit:1/
    );
    expect(toolMocks.dispatchTool).not.toHaveBeenCalled();
  });

  it('status renders human output (not raw JSON)', async () => {
    const originalAscii = process.env.CODEBASE_CONTEXT_ASCII;
    process.env.CODEBASE_CONTEXT_ASCII = '1';

    try {
      toolMocks.dispatchTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'indexing',
              rootPath: '/tmp/repo',
              stats: { indexedFiles: 10, totalChunks: 42, duration: '1.23s', incremental: true },
              progress: { phase: 'embedding', percentage: 60 },
              hint: 'Use refresh_index to manually trigger re-indexing when needed.'
            })
          }
        ]
      });

      await handleCliCommand(['status']);

      const out = logSpy.mock.calls.map((c) => String(c[0] ?? '')).join('\n');
      expect(out).toMatch(/Index Status/);
      expect(out).toMatch(/\+\- Index Status/);
      expect(out).toMatch(/Progress:/);
    } finally {
      if (originalAscii === undefined) delete process.env.CODEBASE_CONTEXT_ASCII;
      else process.env.CODEBASE_CONTEXT_ASCII = originalAscii;
    }
  });

  it('formatting falls back safely on unexpected JSON', async () => {
    toolMocks.dispatchTool.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ foo: 'bar' }) }]
    });

    await handleCliCommand(['search', '--query', 'foo']);
    expect(toolMocks.dispatchTool).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalled();
  });

  it('memory list errors on invalid --type', async () => {
    await expect(handleMemoryCli(['list', '--type', 'nope'])).rejects.toThrow(/process\.exit:1/);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('memory add/remove support --json output', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-memory-json-'));
    const originalEnvRoot = process.env.CODEBASE_ROOT;
    process.env.CODEBASE_ROOT = tempDir;

    try {
      logSpy.mockClear();
      await handleMemoryCli([
        'add',
        '--type',
        'decision',
        '--category',
        'tooling',
        '--memory',
        'Use pnpm, not npm',
        '--reason',
        'Workspace support and speed',
        '--json'
      ]);

      const addedText = String(logSpy.mock.calls.at(-1)?.[0] ?? '');
      const added = JSON.parse(addedText) as { status: string; memory?: { id?: string } };
      expect(added.status).toBe('added');
      const id = added.memory?.id;
      expect(typeof id).toBe('string');

      logSpy.mockClear();
      await handleMemoryCli([
        'add',
        '--type',
        'decision',
        '--category',
        'tooling',
        '--memory',
        'Use pnpm, not npm',
        '--reason',
        'Workspace support and speed',
        '--json'
      ]);
      const dupText = String(logSpy.mock.calls.at(-1)?.[0] ?? '');
      const dup = JSON.parse(dupText) as { status: string };
      expect(dup.status).toBe('duplicate');

      logSpy.mockClear();
      await handleMemoryCli(['remove', String(id), '--json']);
      const removedText = String(logSpy.mock.calls.at(-1)?.[0] ?? '');
      const removed = JSON.parse(removedText) as { status: string; id: string };
      expect(removed).toEqual({ status: 'removed', id });

      logSpy.mockClear();
      await expect(handleMemoryCli(['remove', 'does-not-exist', '--json'])).rejects.toThrow(
        /process\.exit:1/
      );
      const notFoundText = String(logSpy.mock.calls.at(-1)?.[0] ?? '');
      const notFound = JSON.parse(notFoundText) as { status: string; id: string };
      expect(notFound).toEqual({ status: 'not_found', id: 'does-not-exist' });
    } finally {
      if (originalEnvRoot === undefined) delete process.env.CODEBASE_ROOT;
      else process.env.CODEBASE_ROOT = originalEnvRoot;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
