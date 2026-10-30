import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateMcpConfig } from '../src/cli-init.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('saved launch arguments', () => {
  it.each(['An App', 'App&MissingCbcLaunchCommand', 'App%cbc_literal%End'])(
    'keeps the repository path %s as one argument beside the npx cache path',
    (name) => {
      const root = path.resolve('C:/projects', name);
      const nodeExecutable = path.resolve('C:/Program Files/nodejs/node.exe');
      const cacheEntrypoint = path.resolve(
        'C:/Users/dev/AppData/Local/npm-cache/_npx/hash/node_modules/codebase-context/dist/index.js'
      );
      const generated = generateMcpConfig('claude-code', {
        rootPath: root,
        nodeExecutable,
        serverEntrypoint: cacheEntrypoint
      });
      if (generated.kind !== 'file') throw new Error('expected file config');
      const server = JSON.parse(generated.content).mcpServers['codebase-context'] as {
        command: string;
        args: string[];
      };

      expect(server.command).toBe(nodeExecutable);
      expect(server.args).toEqual([cacheEntrypoint, root]);
    }
  );
});

describe('direct Node client launch', () => {
  it.each(['An App', 'App&MissingCbcLaunchCommand', 'App%cbc_literal%End'])(
    'passes %s literally through the real SDK transport',
    async (name) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'cbc-direct-launch-'));
      const root = path.join(directory, name);
      const entrypoint = path.join(directory, 'capture.cjs');
      await writeFile(
        entrypoint,
        'console.log(JSON.stringify({jsonrpc:"2.0",method:"captured",params:{args:process.argv.slice(2)}}));'
      );
      const generated = generateMcpConfig('claude-code', {
        rootPath: root,
        nodeExecutable: process.execPath,
        serverEntrypoint: entrypoint
      });
      const server: { command: string; args: string[] } = JSON.parse(generated.content).mcpServers[
        'codebase-context'
      ];
      const transport = new StdioClientTransport({ ...server, stderr: 'pipe' });
      const result = new Promise<unknown>((resolve, reject) => {
        transport.onmessage = resolve;
        transport.onerror = reject;
      });
      try {
        await transport.start();
        expect(await result).toMatchObject({ params: { args: [root] } });
      } finally {
        await transport.close();
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
});
