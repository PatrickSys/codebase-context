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
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

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
    expect(elapsed).toBeLessThan(7_000);
  }, 10_000);
});
