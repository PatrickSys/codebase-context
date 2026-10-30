import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maybePrintInitUpdateNotice } from '../src/cli-init-version-notice.js';

describe('maybePrintInitUpdateNotice', () => {
  let tempHome = '';

  afterEach(async () => {
    if (tempHome) await rm(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  it('prints at most once per day using the cache', async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), 'cbc-init-notice-'));
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message) => {
      logs.push(String(message));
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '9.9.9' })
    });
    const nowMs = Date.now();

    try {
      await maybePrintInitUpdateNotice('2.3.0', {
        env: { HOME: tempHome },
        nowMs,
        fetchImpl: fetchImpl as unknown as typeof fetch
      });
      await maybePrintInitUpdateNotice('2.3.0', {
        env: { HOME: tempHome },
        nowMs: nowMs + 1000,
        fetchImpl: fetchImpl as unknown as typeof fetch
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('9.9.9');
    const cache = JSON.parse(
      await readFile(path.join(tempHome, '.codebase-context', 'init-update-notice.json'), 'utf8')
    ) as { latestVersion: string };
    expect(cache.latestVersion).toBe('9.9.9');
  });

  it('respects CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE', async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), 'cbc-init-notice-skip-'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetchImpl = vi.fn();

    try {
      await maybePrintInitUpdateNotice('2.3.0', {
        env: { HOME: tempHome, CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE: '1' },
        fetchImpl: fetchImpl as unknown as typeof fetch
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
