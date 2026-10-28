import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryFeatureContextMock, readIndexMetaMock, validateArtifactsMock } = vi.hoisted(() => ({
  queryFeatureContextMock: vi.fn(),
  readIndexMetaMock: vi.fn(),
  validateArtifactsMock: vi.fn()
}));

vi.mock('../../src/core/feature-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/feature-context.js')>();
  return { ...actual, queryFeatureContext: queryFeatureContextMock };
});

vi.mock('../../src/core/index-meta.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/index-meta.js')>();
  return {
    ...actual,
    readIndexMeta: readIndexMetaMock,
    validateIndexArtifacts: validateArtifactsMock
  };
});

import { dispatchTool, TOOLS } from '../../src/tools/index.js';
import type { ToolContext } from '../../src/tools/types.js';

const execFileAsync = promisify(execFile);
const validFeatureContextIndex = {
  schemaVersion: 1,
  code: { commit: null, clean: false },
  attachments: [],
  diagnostics: []
};

async function git(rootPath: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, {
    cwd: rootPath,
    timeout: 5000,
    windowsHide: true
  });
}

async function createCleanIndexedProject(
  options: { initializeGit?: boolean } = {}
): Promise<{ rootPath: string; context: ToolContext }> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-feature-context-tool-'));
  await fs.writeFile(path.join(rootPath, '.gitignore'), '.codebase-context/\n');
  await fs.mkdir(path.join(rootPath, 'src'), { recursive: true });
  await fs.writeFile(path.join(rootPath, 'src', 'cart.ts'), 'export function submitOrder() {}\n');
  if (options.initializeGit !== false) {
    await git(rootPath, ['init', '--quiet']);
    await git(rootPath, ['add', '.gitignore', 'src/cart.ts']);
    await git(rootPath, [
      '-c',
      'user.name=Feature Context Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture'
    ]);
  }

  const contextDir = path.join(rootPath, '.codebase-context');
  await fs.mkdir(contextDir, { recursive: true });
  await fs.writeFile(
    path.join(contextDir, 'relationships.json'),
    JSON.stringify({
      header: { buildId: 'build-1', formatVersion: 1 },
      featureContexts: validFeatureContextIndex
    })
  );

  const context: ToolContext = {
    indexState: { status: 'ready' },
    paths: {
      baseDir: contextDir,
      memory: path.join(contextDir, 'memory.json'),
      intelligence: path.join(contextDir, 'intelligence.json'),
      health: path.join(contextDir, 'health.json'),
      keywordIndex: path.join(contextDir, 'index.json'),
      vectorDb: path.join(contextDir, 'index')
    },
    rootPath,
    performIndexing: () => undefined
  };

  return { rootPath, context };
}

function payloadText(result: Awaited<ReturnType<typeof dispatchTool>>): string {
  return result.content?.[0]?.text ?? '';
}

describe('get_feature_context MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readIndexMetaMock.mockResolvedValue({ buildId: 'build-1', formatVersion: 1 });
    validateArtifactsMock.mockResolvedValue(undefined);
    queryFeatureContextMock.mockResolvedValue({
      schemaVersion: 1,
      target: { path: 'src/cart.ts', symbol: 'submitOrder' },
      matches: [],
      counts: { matches: 0, resolved: 0, diagnostics: 0, omitted: 0 },
      truncated: false,
      diagnostics: []
    });
  });

  it('registers and dispatches the feature context query with current Git identity', async () => {
    const { rootPath, context } = await createCleanIndexedProject();
    try {
      expect(TOOLS.map((tool) => tool.name)).toContain('get_feature_context');
      const result = await dispatchTool(
        'get_feature_context',
        { path: 'src/cart.ts', symbol: 'submitOrder' },
        context
      );

      expect(result.isError).not.toBe(true);
      const output = JSON.parse(payloadText(result)) as {
        status: string;
        rootPath: string;
        counts: { omitted: number };
      };
      expect(output.status).toBe('success');
      expect(process.cwd()).not.toBe(rootPath);
      expect(output.rootPath).toBe(rootPath);
      expect(output.counts.omitted).toBe(0);
      expect(readIndexMetaMock).toHaveBeenCalledWith(rootPath);
      expect(validateArtifactsMock).toHaveBeenCalledOnce();
      expect(queryFeatureContextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          rootPath,
          target: { path: 'src/cart.ts', symbol: 'submitOrder' },
          currentGit: expect.objectContaining({ commit: expect.any(String), isClean: true }),
          tokenLimit: expect.any(Number)
        })
      );
      expect(queryFeatureContextMock.mock.calls[0]?.[0].tokenLimit).toBeLessThan(900);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it('awaits the unavailable-Git fallback for a project outside a Git worktree', async () => {
    const { rootPath, context } = await createCleanIndexedProject({ initializeGit: false });
    try {
      const result = await dispatchTool('get_feature_context', { path: 'src/cart.ts' }, context);
      const output = JSON.parse(payloadText(result)) as { status: string; warning?: string };

      expect(output.status).toBe('success');
      expect(output.warning).toContain('Git identity could not be established');
      expect(queryFeatureContextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          rootPath,
          currentGit: { commit: null, isClean: false }
        })
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it('requires refresh when a legacy sidecar has no featureContexts field', async () => {
    const { rootPath, context } = await createCleanIndexedProject();
    try {
      await fs.writeFile(
        path.join(context.paths.baseDir, 'relationships.json'),
        JSON.stringify({ header: { buildId: 'build-1', formatVersion: 1 }, graph: {} })
      );
      const result = await dispatchTool('get_feature_context', { path: 'src/cart.ts' }, context);
      const output = JSON.parse(payloadText(result)) as { status: string };

      expect(output.status).toBe('index_refresh_required');
      expect(queryFeatureContextMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it('distinguishes malformed sidecars from legacy indexes that need refresh', async () => {
    const { rootPath, context } = await createCleanIndexedProject();
    const relationshipsPath = path.join(context.paths.baseDir, 'relationships.json');
    try {
      await fs.writeFile(relationshipsPath, '{not-json');
      const malformed = await dispatchTool('get_feature_context', { path: 'src/cart.ts' }, context);
      expect(JSON.parse(payloadText(malformed))).toMatchObject({ status: 'index_invalid' });
      expect(malformed.isError).toBe(true);

      await fs.writeFile(
        relationshipsPath,
        JSON.stringify({ featureContexts: { malformed: true } })
      );
      const invalid = await dispatchTool('get_feature_context', { path: 'src/cart.ts' }, context);
      expect(JSON.parse(payloadText(invalid))).toMatchObject({ status: 'index_invalid' });
      expect(invalid.isError).toBe(true);
      expect(queryFeatureContextMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it('uses the shared target schema before reading index files', async () => {
    const context: ToolContext = {
      indexState: { status: 'idle' },
      paths: {
        baseDir: os.tmpdir(),
        memory: path.join(os.tmpdir(), 'memory.json'),
        intelligence: path.join(os.tmpdir(), 'intelligence.json'),
        health: path.join(os.tmpdir(), 'health.json'),
        keywordIndex: path.join(os.tmpdir(), 'index.json'),
        vectorDb: path.join(os.tmpdir(), 'index')
      },
      rootPath: os.tmpdir(),
      performIndexing: () => undefined
    };

    for (const unsafePath of ['../outside.ts', 'src:cart.ts', 'src//cart.ts']) {
      const result = await dispatchTool('get_feature_context', { path: unsafePath }, context);
      expect(result.isError).toBe(true);
      expect(JSON.parse(payloadText(result))).toMatchObject({ status: 'invalid_input' });
    }
    expect(readIndexMetaMock).not.toHaveBeenCalled();
    expect(validateArtifactsMock).not.toHaveBeenCalled();
  });

  it('refuses an external relationships symlink without reading its sentinel', async () => {
    const { rootPath, context } = await createCleanIndexedProject();
    const relationshipsPath = path.join(context.paths.baseDir, 'relationships.json');
    const sentinelPath = path.join(os.tmpdir(), `cbc-external-${path.basename(rootPath)}.json`);
    const readFileSpy = vi.spyOn(fs, 'readFile');
    try {
      await fs.writeFile(sentinelPath, 'external relationships sentinel');
      await fs.rm(relationshipsPath);
      await fs.symlink(sentinelPath, relationshipsPath, 'file');

      const result = await dispatchTool('get_feature_context', { path: 'src/cart.ts' }, context);
      expect(result.isError).toBe(true);
      expect(JSON.parse(payloadText(result))).toMatchObject({ status: 'index_unavailable' });
      expect(readFileSpy.mock.calls.some(([calledPath]) => calledPath === sentinelPath)).toBe(
        false
      );
      expect(queryFeatureContextMock).not.toHaveBeenCalled();
    } finally {
      readFileSpy.mockRestore();
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(sentinelPath, { force: true });
    }
  });

  it('refuses an external .codebase-context directory junction before metadata reads', async () => {
    const { rootPath, context } = await createCleanIndexedProject();
    const contextDir = context.paths.baseDir;
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-external-cache-'));
    const sentinelPath = path.join(externalDir, 'index-meta.json');
    const readFileSpy = vi.spyOn(fs, 'readFile');
    try {
      await fs.writeFile(sentinelPath, 'external metadata sentinel');
      await fs.rm(contextDir, { recursive: true, force: true });
      await fs.symlink(externalDir, contextDir, 'junction');

      const result = await dispatchTool('get_feature_context', { path: 'src/cart.ts' }, context);
      expect(result.isError).toBe(true);
      expect(JSON.parse(payloadText(result))).toMatchObject({ status: 'index_unavailable' });
      expect(readIndexMetaMock).not.toHaveBeenCalled();
      expect(readFileSpy.mock.calls.some(([calledPath]) => calledPath === sentinelPath)).toBe(
        false
      );
      expect(queryFeatureContextMock).not.toHaveBeenCalled();
    } finally {
      readFileSpy.mockRestore();
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(externalDir, { recursive: true, force: true });
    }
  });
});
