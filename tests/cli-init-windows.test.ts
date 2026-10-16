import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { generateMcpConfig } from '../src/cli-init.js';

describe.skipIf(process.platform !== 'win32')('Windows init launch', () => {
  it.each(['An App', 'App&MissingCbcLaunchCommand', 'App%cbc_literal%End'])(
    'passes the repository path %s as one literal argument',
    async (name) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'cbc-launch-'));
      const root = path.join(directory, name);
      await writeFile(
        path.join(directory, 'npx.cmd'),
        '@echo off\r\nnode "%~dp0capture.cjs" %*\r\n'
      );
      await writeFile(
        path.join(directory, 'capture.cjs'),
        'console.log(JSON.stringify({jsonrpc:"2.0",method:"captured",params:{args:process.argv.slice(2)}}));'
      );
      const generated = generateMcpConfig('claude-code', { rootPath: root });
      const server = JSON.parse(generated.content).mcpServers['codebase-context'] as {
        command: string;
        args: string[];
      };
      const transport = new StdioClientTransport({
        ...server,
        env: { PATH: directory + path.delimiter + process.env.PATH, cbc_literal: 'expanded' },
        stderr: 'pipe'
      });
      const captured = new Promise<unknown>((resolve, reject) => {
        transport.onmessage = (message) => resolve(message);
        transport.onerror = reject;
      });
      try {
        await transport.start();
        const result = await Promise.race([
          captured,
          new Promise((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Launch did not return arguments')),
              3000
            );
            timer.unref();
          })
        ]);
        expect(result).toMatchObject({
          params: { args: ['--yes', expect.stringMatching(/^codebase-context@/), root] }
        });
      } finally {
        await transport.close();
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
});
