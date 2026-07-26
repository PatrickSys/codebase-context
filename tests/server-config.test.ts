import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProjectConfig, loadServerConfig } from '../src/server/config.js';

// Helper: write a temp config file and set CODEBASE_CONTEXT_CONFIG_PATH
async function withTempConfig(content: string, fn: (filePath: string) => Promise<void>) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccc-config-test-'));
  const filePath = path.join(tmpDir, 'config.json');
  await fs.writeFile(filePath, content, 'utf8');
  try {
    await fn(filePath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe('loadServerConfig', () => {
  afterEach(() => {
    delete process.env.CODEBASE_CONTEXT_CONFIG_PATH;
    vi.restoreAllMocks();
  });

  it('returns null silently when config file does not exist (ENOENT)', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    process.env.CODEBASE_CONTEXT_CONFIG_PATH = '/tmp/nonexistent-ccc-config-99999.json';
    const result = await loadServerConfig();
    expect(result).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null and logs to stderr on malformed JSON', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    await withTempConfig('{ invalid json }', async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[config\] Failed to load config:/);
    });
  });

  it('returns null when top-level value is an array', async () => {
    await withTempConfig('[]', async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).toBeNull();
    });
  });

  it('returns null when top-level value is a string', async () => {
    await withTempConfig('"just a string"', async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).toBeNull();
    });
  });

  it('resolves ~/my-repo to an absolute path using os.homedir()', async () => {
    const config = JSON.stringify({
      projects: [{ root: '~/my-repo' }]
    });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).not.toBeNull();
      expect(result!.projects).toHaveLength(1);
      const resolved = result!.projects![0].root;
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved).toBe(path.join(os.homedir(), 'my-repo'));
    });
  });

  it('resolves a relative path via path.resolve()', async () => {
    const config = JSON.stringify({
      projects: [{ root: 'relative/path' }]
    });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).not.toBeNull();
      const resolved = result!.projects![0].root;
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved).toBe(path.resolve('relative/path'));
    });
  });

  it('skips project entries with missing or empty roots instead of resolving cwd', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({
      projects: [{}, { root: '   ' }, { root: 'valid-root' }]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();

      expect(result).not.toBeNull();
      expect(result!.projects).toEqual([{ root: path.resolve('valid-root') }]);
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy.mock.calls[0][0]).toMatch(
        /\[config\] Skipping project entry with missing or empty root/
      );
      expect(errorSpy.mock.calls[1][0]).toMatch(
        /\[config\] Skipping project entry with missing or empty root/
      );
    });
  });

  it('returns valid config for well-formed input with projects and server.port', async () => {
    // Use absolute paths that are valid on all platforms
    const projA = path.join(os.tmpdir(), 'ccc-test-proj-a');
    const projB = path.join(os.tmpdir(), 'ccc-test-proj-b');
    const config = JSON.stringify({
      projects: [
        { root: projA, excludePatterns: ['**/dist/**'] },
        { root: projB }
      ],
      server: { port: 5199, host: '0.0.0.0' }
    });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).not.toBeNull();
      expect(result!.projects).toHaveLength(2);
      expect(result!.projects![0].root).toBe(path.resolve(projA));
      expect(result!.projects![0].excludePatterns).toEqual(['**/dist/**']);
      expect(result!.projects![1].root).toBe(path.resolve(projB));
      expect(result!.server?.port).toBe(5199);
      expect(result!.server?.host).toBe('0.0.0.0');
    });
  });

  it('parses analyzer hints with trimmed analyzer name and non-empty extensions', async () => {
    const config = JSON.stringify({
      projects: [
        {
          root: '~/hinted-repo',
          analyzerHints: {
            analyzer: '  generic  ',
            extensions: ['sfc', ' .astro ', '', 42, null]
          }
        }
      ]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();

      expect(result).not.toBeNull();
      expect(result!.projects).toHaveLength(1);
      expect(result!.projects![0].analyzerHints).toEqual({
        analyzer: 'generic',
        extensions: ['sfc', '.astro']
      });
    });
  });

  it('parses a positive per-project maxChunks value', async () => {
    const config = JSON.stringify({
      projects: [{ root: '~/large-repo', parsing: { maxChunks: 25000 } }]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();

      expect(result?.projects?.[0].parsing).toEqual({ maxChunks: 25000 });
    });
  });

  it('loads parsing configuration for the requested CLI project root', async () => {
    const projectRoot = path.join(os.tmpdir(), 'ccc-large-cli-project');
    const config = JSON.stringify({
      projects: [
        { root: path.join(os.tmpdir(), 'ccc-other-project') },
        { root: projectRoot, parsing: { maxChunks: 25000 } }
      ]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const projectConfig = await loadProjectConfig(projectRoot);

      expect(projectConfig).toEqual({
        root: projectRoot,
        parsing: { maxChunks: 25000 }
      });
    });
  });

  it('ignores an invalid per-project maxChunks value', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({
      projects: [{ root: '~/large-repo', parsing: { maxChunks: 0 } }]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();

      expect(result?.projects?.[0].parsing).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        '[config] Ignoring invalid project parsing.maxChunks: 0'
      );
    });
  });

  it('drops empty analyzerHints objects after parsing', async () => {
    const config = JSON.stringify({
      projects: [
        {
          root: '~/hinted-repo',
          analyzerHints: {
            analyzer: '   ',
            extensions: ['', '   ']
          }
        }
      ]
    });

    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();

      expect(result).not.toBeNull();
      expect(result!.projects).toHaveLength(1);
      expect(result!.projects![0].analyzerHints).toBeUndefined();
    });
  });

  it('drops server.port with a warning when value is 0', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({ server: { port: 0 } });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).not.toBeNull();
      expect(result!.server?.port).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[config\] Ignoring invalid server\.port: 0/);
    });
  });

  it('drops server.port with a warning when value is negative', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({ server: { port: -1 } });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result!.server?.port).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[config\] Ignoring invalid server\.port: -1/);
    });
  });

  it('drops server.port with a warning when value is a non-numeric string', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({ server: { port: 'abc' } });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result!.server?.port).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[config\] Ignoring invalid server\.port: abc/);
    });
  });

  it('drops server.port with a warning when value exceeds 65535', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const config = JSON.stringify({ server: { port: 65536 } });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result!.server?.port).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[config\] Ignoring invalid server\.port: 65536/);
    });
  });

  it('respects CODEBASE_CONTEXT_CONFIG_PATH env var', async () => {
    const config = JSON.stringify({ server: { port: 4242 } });
    await withTempConfig(config, async (filePath) => {
      process.env.CODEBASE_CONTEXT_CONFIG_PATH = filePath;
      const result = await loadServerConfig();
      expect(result).not.toBeNull();
      expect(result!.server?.port).toBe(4242);
    });
  });
});
