/**
 * Integration tests for zombie process prevention.
 *
 * These tests verify that the MCP server exits cleanly when no client connects
 * (handshake timeout) and that project initialization is deferred until after
 * the MCP handshake completes.
 *
 * The tests spawn real child processes to exercise the actual startup path.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  KEYWORD_INDEX_FILENAME
} from '../src/constants/codebase-context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY_POINT = path.resolve(__dirname, '..', 'dist', 'index.js');

/**
 * Spawn the MCP server as a child process and wait for it to exit.
 * Returns { code, stderr, elapsed } where elapsed is in milliseconds.
 */
function spawnServer(
  args: string[],
  env: Record<string, string> = {},
  timeoutMs = 45_000
): Promise<{ code: number | null; signal: string | null; stderr: string; elapsed: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let stderr = '';

    const child = spawn(process.execPath, [ENTRY_POINT, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: timeoutMs
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stderr, elapsed: Date.now() - start });
    });

    // Don't write anything to stdin — simulate the zombie scenario
    // where no MCP client sends an `initialize` message.
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
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

async function connectClient(
  args: string[],
  env: Record<string, string> = {}
): Promise<{ client: Client; transport: StdioClientTransport; pid: number }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY_POINT, ...args],
    env: { ...process.env, ...env }
  });
  const client = new Client({ name: 'zombie-guard-test', version: '1.0.0' });
  await client.connect(transport);

  if (transport.pid === null) {
    throw new Error('Expected stdio transport pid after initialize');
  }

  return { client, transport, pid: transport.pid };
}

function createIdleTestProjectRoot(): string {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), 'codebase-context-idle-'));
  const contextDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
  mkdirSync(contextDir, { recursive: true });
  writeFileSync(path.join(contextDir, KEYWORD_INDEX_FILENAME), '{}', 'utf8');
  return rootPath;
}

describe('zombie process prevention', () => {
  beforeAll(() => {
    if (!existsSync(ENTRY_POINT)) {
      throw new Error(
        `dist/index.js not found - run \`npm run build\` before the zombie-guard tests.`
      );
    }
  });

  it('exits with code 1 when no MCP client connects within timeout', async () => {
    // Use a short timeout for the test (2 seconds instead of the default 30).
    // Use os.tmpdir() as a real existing directory so path validation passes —
    // this tests the realistic scenario where a valid path IS provided but no
    // MCP client connects (which is exactly the Codex zombie scenario).
    const result = await spawnServer(
      [os.tmpdir()],
      { CODEBASE_CONTEXT_HANDSHAKE_TIMEOUT_MS: '2000' }
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No MCP client connected within');
    expect(result.stderr).toContain('npx codebase-context --help');
    // Should exit roughly around the timeout (2s), not hang forever
    expect(result.elapsed).toBeLessThan(12_000);
  }, 15_000);

  it('exits with code 1 even when invoked with no arguments at all', async () => {
    const result = await spawnServer(
      [],
      { CODEBASE_CONTEXT_HANDSHAKE_TIMEOUT_MS: '2000' }
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No MCP client connected within');
    expect(result.elapsed).toBeLessThan(12_000);
  }, 15_000);

  it('does not start indexing or file watchers before handshake', async () => {
    // With DEBUG on, the server logs "[DEBUG] Server ready" inside oninitialized.
    // Since no client ever connects, that log must never appear.
    // Use os.tmpdir() so path validation passes before the handshake timer runs.
    const result = await spawnServer(
      [os.tmpdir()],
      {
        CODEBASE_CONTEXT_HANDSHAKE_TIMEOUT_MS: '2000',
        CODEBASE_CONTEXT_DEBUG: '1'
      }
    );

    expect(result.code).toBe(1);
    // "[DEBUG] Server ready" is printed inside oninitialized — should NOT appear
    // because no client ever sends `initialize`.
    expect(result.stderr).not.toContain('[DEBUG] Server ready');
  }, 15_000);

  it('respects custom timeout via environment variable', async () => {
    const start = Date.now();
    const result = await spawnServer(
      [],
      { CODEBASE_CONTEXT_HANDSHAKE_TIMEOUT_MS: '1000' }
    );
    const elapsed = Date.now() - start;

    expect(result.code).toBe(1);
    // Should still honor a short timeout (allow CI/Windows process jitter).
    expect(elapsed).toBeGreaterThan(800);
    expect(elapsed).toBeLessThan(8_000);
  }, 12_000);

  it('exits after post-initialize idle timeout when the client stays silent', async () => {
    const rootPath = createIdleTestProjectRoot();
    const { client, pid } = await connectClient([rootPath], {
      CODEBASE_CONTEXT_STDIO_IDLE_TIMEOUT_MS: '1000'
    });

    expect(isProcessAlive(pid)).toBe(true);
    await waitForProcessExit(pid, 6000);
    await client.close().catch(() => undefined);
  }, 12_000);

  it('resets the idle timer when MCP requests keep arriving', async () => {
    const rootPath = createIdleTestProjectRoot();
    const { client, pid } = await connectClient([rootPath], {
      CODEBASE_CONTEXT_STDIO_IDLE_TIMEOUT_MS: '1500'
    });

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(isProcessAlive(pid)).toBe(true);

    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(isProcessAlive(pid)).toBe(true);

    await waitForProcessExit(pid, 6000);
    await client.close().catch(() => undefined);
  }, 15_000);
});
