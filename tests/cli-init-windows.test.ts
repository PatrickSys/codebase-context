import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateMcpConfig } from '../src/cli-init.js';

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
