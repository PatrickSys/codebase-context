import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { _buildMergedCodexContent, generateMcpConfig } from '../src/cli-init.js';

describe('Codex merge with an existing saved config', () => {
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
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'cbc-codex-merge-'));
    const configPath = path.join(projectRoot, '.codex', 'config.toml');
    const initialBytes = Buffer.from(toml, 'utf8');

    try {
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, initialBytes);
      const generated = generateMcpConfig('codex', { rootPath: projectRoot });
      if (generated.kind !== 'file') throw new Error('expected file config');

      await expect(_buildMergedCodexContent(generated.path, generated.content)).rejects.toThrow(
        /already contains a different codebase-context configuration/i
      );

      const persistedBytes = await readFile(configPath);
      expect(persistedBytes).toEqual(initialBytes);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
