import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { formatRefs } from '../src/cli-formatters.js';

const toolMocks = vi.hoisted(() => ({
  dispatchTool: vi.fn()
}));

const cliContextMocks = vi.hoisted(() => ({
  loadProjectConfig: vi.fn(),
  indexer: vi.fn()
}));

vi.mock('../src/tools/index.js', () => ({
  dispatchTool: toolMocks.dispatchTool
}));

vi.mock('../src/server/config.js', () => ({
  loadProjectConfig: cliContextMocks.loadProjectConfig
}));

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
  confirm: vi.fn().mockResolvedValue(true)
}));

vi.mock('../src/core/indexer.js', () => ({
  CodebaseIndexer: class {
    index = cliContextMocks.indexer;
    getProgress = vi.fn();
  }
}));

import { handleCliCommand, handleMemoryCli } from '../src/cli.js';

describe('CLI', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalEnvRoot: string | undefined;

  beforeEach(() => {
    toolMocks.dispatchTool.mockReset();
    cliContextMocks.loadProjectConfig.mockReset().mockResolvedValue(undefined);
    cliContextMocks.indexer.mockReset().mockResolvedValue({
      indexedFiles: 0,
      totalChunks: 0,
      duration: 0
    });

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

  it('init configures cursor JSON without indexing when skipped', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-init-only-'));
    const previousExitCode = process.exitCode;
    process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE = '1';
    try {
      process.exitCode = undefined;
      await handleCliCommand([
        'init',
        '--clients',
        'cursor',
        '--yes',
        '--root',
        root
      ]);
      expect(cliContextMocks.indexer).not.toHaveBeenCalled();
      expect(await fs.readFile(path.join(root, '.cursor', 'mcp.json'), 'utf8')).toContain(
        'codebase-context'
      );
    } finally {
      process.exitCode = previousExitCode;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('search errors when --query has no value', async () => {
    await expect(handleCliCommand(['search', '--query', '--json'])).rejects.toThrow(
      /process\.exit:1/
    );
    expect(toolMocks.dispatchTool).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('reindex help returns before context creation, indexing, or dispatch', async () => {
    await handleCliCommand(['reindex', '--help']);

    const output = logSpy.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
    expect(output).toContain('reindex [--incremental]');
    expect(cliContextMocks.loadProjectConfig).not.toHaveBeenCalled();
    expect(cliContextMocks.indexer).not.toHaveBeenCalled();
    expect(toolMocks.dispatchTool).not.toHaveBeenCalled();
  });

  it('read-command help returns before context creation or dispatch', async () => {
    await handleCliCommand(['status', '--help']);

    const output = logSpy.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
    expect(output).toContain('status');
    expect(cliContextMocks.loadProjectConfig).not.toHaveBeenCalled();
    expect(toolMocks.dispatchTool).not.toHaveBeenCalled();
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
      expect(out).toMatch(/\+- Index Status/);
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

  it('reports unavailable reference sources and labels lexical fallback uncertainty', () => {
    const result = {
      symbol: 'activeToken',
      usageCount: 1,
      confidence: 'lexical',
      usages: [{ file: 'src/active.ts', line: 1, preview: 'activeToken();' }],
      isComplete: false,
      coverage: { filesUnavailable: 1 }
    };

    formatRefs(result, 'C:/repo');

    const output = logSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .join('\n')
      .replace(/\s+/g, ' ');
    expect(output).toContain('incomplete coverage: 1 indexed source unavailable');
    expect(output).not.toContain('results capped at limit');
    expect(output).toContain('lexical');
    expect(output).toContain('Raw-text fallback may match comments or strings.');
  });

  it('retains the limit message when complete reference coverage reaches the limit', () => {
    const result = {
      symbol: 'activeToken',
      usageCount: 10,
      confidence: 'syntactic',
      usages: [{ file: 'src/active.ts', line: 1, preview: 'activeToken();' }],
      isComplete: false,
      coverage: { filesUnavailable: 0 }
    };

    formatRefs(result, 'C:/repo');

    const output = logSpy.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
    expect(output).toContain('results capped at limit');
    expect(output).not.toContain('incomplete coverage');
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
