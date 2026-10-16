import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateMcpConfig } from '../src/cli-init.js';
import { resolveRootPath } from '../src/index.js';

describe('init bootstrap root', () => {
  it('passes the configured project root through the MCP server argv path', () => {
    const projectRoot = path.resolve('C:/projects/An App With Spaces');
    const previousArgv = process.argv;
    const previousEnvRoot = process.env.CODEBASE_ROOT;
    const generated = generateMcpConfig('claude-code', {
      rootPath: projectRoot,
      nodeExecutable: process.execPath,
      serverEntrypoint: path.resolve('C:/codebase-context/dist/index.js')
    });
    if (generated.kind !== 'file') throw new Error('expected project MCP config');

    const parsed = JSON.parse(generated.content) as {
      mcpServers: { 'codebase-context': { command: string; args: string[] } };
    };
    const server = parsed.mcpServers['codebase-context'];
    process.argv = [server.command, ...server.args];
    process.env.CODEBASE_ROOT = path.resolve('C:/projects/Other App');

    try {
      expect(resolveRootPath()).toBe(projectRoot);
    } finally {
      process.argv = previousArgv;
      if (previousEnvRoot === undefined) delete process.env.CODEBASE_ROOT;
      else process.env.CODEBASE_ROOT = previousEnvRoot;
    }
  });
});
