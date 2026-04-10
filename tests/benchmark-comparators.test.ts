import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function importHelper() {
  return import(pathToFileURL(path.resolve(__dirname, '..', 'scripts', 'lib', 'managed-mcp-session.mjs')).href);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Process ${pid} still alive after ${timeoutMs}ms`);
}

describe('managed MCP benchmark sessions', () => {
  it('kills the child when connect times out', async () => {
    const { withManagedStdioClientSession } = await importHelper();
    const hangingServer = path.resolve(__dirname, 'fixtures', 'mcp', 'hanging-server.mjs');

    let pid: number | null = null;

    await expect(
      withManagedStdioClientSession(
        {
          serverCommand: process.execPath,
          serverArgs: [hangingServer],
          connectTimeoutMs: 200,
          onSpawn: (childPid: number) => {
            pid = childPid;
          }
        },
        async () => undefined
      )
    ).rejects.toThrow('MCP client connect timed out');

    expect(pid).toBeTypeOf('number');
    await waitForProcessExit(pid as number);
  });

  it('kills the child when work fails after a successful connection', async () => {
    const { withManagedStdioClientSession } = await importHelper();
    const echoServer = path.resolve(__dirname, 'fixtures', 'mcp', 'echo-server.mjs');

    let pid: number | null = null;

    await expect(
      withManagedStdioClientSession(
        {
          serverCommand: process.execPath,
          serverArgs: [echoServer],
          connectTimeoutMs: 5000,
          onSpawn: (childPid: number) => {
            pid = childPid;
          }
        },
        async ({
          client,
          transport
        }: {
          client: {
            listTools: () => Promise<{ tools: Array<{ name: string }> }>;
          };
          transport: { pid: number | null };
        }) => {
          pid = transport.pid ?? pid;
          const tools = await client.listTools();
          expect(tools.tools.map((tool) => tool.name)).toContain('echo_search');
          throw new Error('forced failure');
        }
      )
    ).rejects.toThrow('forced failure');

    expect(pid).toBeTypeOf('number');
    await waitForProcessExit(pid as number);
  });
});
