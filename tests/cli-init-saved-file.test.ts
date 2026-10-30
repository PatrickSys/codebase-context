import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleInitCli } from '../src/cli-init.js';

describe('Codex init with an existing saved config', () => {
  it.each([
    {
      name: 'bare dotted keys',
      toml: 'mcp_servers.codebase-context = { command = "old", args = [] }\n'
    },
    {
      name: 'a double-quoted root key',
      toml: '"mcp_servers".codebase-context = { command = "old", args = [] }\n'
    },
    {
      name: 'a double-quoted server key',
      toml: 'mcp_servers."codebase-context" = { command = "old", args = [] }\n'
    },
    {
      name: 'double-quoted root and server keys',
      toml: '"mcp_servers"."codebase-context" = { command = "old", args = [] }\n'
    },
    {
      name: 'single-quoted root and server keys',
      toml: "'mcp_servers'.'codebase-context' = { command = \"old\", args = [] }\n"
    }
  ])('refuses $name without changing the saved file', async ({ toml }) => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'cbc-codex-init-'));
    const configPath = path.join(projectRoot, '.codex', 'config.toml');
    const initialBytes = Buffer.from(toml, 'utf8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const previousExitCode = process.exitCode;

    try {
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, initialBytes);
      process.exitCode = undefined;

      await handleInitCli(['--client', 'codex', '--yes', '--skip-index', '--root', projectRoot]);

      const persistedBytes = await readFile(configPath);
      expect({ exitCode: process.exitCode, persistedBytes }).toEqual({
        exitCode: 1,
        persistedBytes: initialBytes
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('already contains a different codebase-context configuration')
      );
    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
      logSpy.mockRestore();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
