import { describe, expect, it } from 'vitest';
import { createAutoRefreshController } from '../src/core/auto-refresh.js';
import {
  createIndexingCoordinator,
  type IndexingOutcome
} from '../src/core/indexing-coordinator.js';
import { handle as handleRefreshIndex } from '../src/tools/refresh-index.js';
import type { ToolContext } from '../src/tools/types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('IndexingCoordinator', () => {
  it('serializes requests and coalesces pending modes with full taking precedence', async () => {
    const autoRefresh = createAutoRefreshController();
    const gates: Array<ReturnType<typeof deferred<IndexingOutcome>>> = [];
    const modes: string[] = [];
    const statuses: string[] = [];
    let activePasses = 0;
    let maxActivePasses = 0;
    const coordinator = createIndexingCoordinator({
      runPass: async (mode) => {
        modes.push(mode);
        if (modes.length === 1) expect(autoRefresh.onFileChange(true)).toBe(false);
        activePasses++;
        maxActivePasses = Math.max(maxActivePasses, activePasses);
        const gate = deferred<IndexingOutcome>();
        gates.push(gate);
        const outcome = await gate.promise;
        activePasses--;
        return outcome;
      },
      onStarted: () => statuses.push('indexing'),
      onFinished: (outcome) => statuses.push(outcome),
      afterPass: (outcome, queue) => {
        if (autoRefresh.consumeQueuedRefresh(outcome)) queue('incremental');
      }
    });

    const first = coordinator.request('full');
    const queuedFullA = coordinator.request('full');
    const queuedFullB = coordinator.request('full');
    const queuedIncremental = coordinator.request('incremental');
    await flushMicrotasks();

    expect(modes).toEqual(['full']);
    expect(statuses).toEqual(['indexing']);
    gates[0].resolve('ready');
    await flushMicrotasks();

    expect(modes).toEqual(['full', 'full']);
    expect(statuses).toEqual(['indexing']);
    gates[1].resolve('ready');
    await expect(
      Promise.all([first, queuedFullA, queuedFullB, queuedIncremental])
    ).resolves.toEqual(['ready', 'ready', 'ready', 'ready']);
    expect(maxActivePasses).toBe(1);
    expect(statuses).toEqual(['indexing', 'ready']);
    expect(autoRefresh.consumeQueuedRefresh('ready')).toBe(false);
  });

  it('runs a full follow-up after an incremental pass and a request during that follow-up', async () => {
    const gates: Array<ReturnType<typeof deferred<IndexingOutcome>>> = [];
    const modes: string[] = [];
    const coordinator = createIndexingCoordinator({
      runPass: (mode) => {
        modes.push(mode);
        const gate = deferred<IndexingOutcome>();
        gates.push(gate);
        return gate.promise;
      },
      onStarted: () => undefined,
      onFinished: () => undefined
    });

    const initial = coordinator.request('incremental');
    const full = coordinator.request('full');
    await flushMicrotasks();
    gates[0].resolve('ready');
    await flushMicrotasks();
    expect(modes).toEqual(['incremental', 'full']);

    const duringFollowUp = coordinator.request('incremental');
    gates[1].resolve('ready');
    await flushMicrotasks();
    expect(modes).toEqual(['incremental', 'full', 'incremental']);
    gates[2].resolve('ready');
    await expect(Promise.all([initial, full, duringFollowUp])).resolves.toEqual([
      'ready',
      'ready',
      'ready'
    ]);
  });

  it('does not publish ready until the pass and its awaited extraction work finish', async () => {
    const indexing = deferred<void>();
    const extraction = deferred<void>();
    const statuses: string[] = [];
    const coordinator = createIndexingCoordinator({
      runPass: async () => {
        await indexing.promise;
        await extraction.promise;
        return 'ready';
      },
      onStarted: () => statuses.push('indexing'),
      onFinished: (outcome) => statuses.push(outcome)
    });

    const request = coordinator.request('full');
    indexing.resolve();
    await flushMicrotasks();
    expect(statuses).toEqual(['indexing']);
    extraction.resolve();
    await expect(request).resolves.toBe('ready');
    expect(statuses).toEqual(['indexing', 'ready']);
  });

  it('converts unexpected pass rejection into an error outcome for fire-and-forget callers', async () => {
    const coordinator = createIndexingCoordinator({
      runPass: async () => {
        throw new Error('unexpected index failure');
      },
      onStarted: () => undefined,
      onFinished: () => undefined
    });

    await expect(coordinator.request('full')).resolves.toBe('error');
  });

  it('keeps explicit work after failure while preserving watcher error-clear behavior', async () => {
    const autoRefresh = createAutoRefreshController();
    const gates: Array<ReturnType<typeof deferred<IndexingOutcome>>> = [];
    const modes: string[] = [];
    const statuses: string[] = [];
    const coordinator = createIndexingCoordinator({
      runPass: (mode) => {
        modes.push(mode);
        if (modes.length === 1) expect(autoRefresh.onFileChange(true)).toBe(false);
        const gate = deferred<IndexingOutcome>();
        gates.push(gate);
        return gate.promise;
      },
      onStarted: () => statuses.push('indexing'),
      onFinished: (outcome) => statuses.push(outcome),
      afterPass: (outcome, queue) => {
        if (autoRefresh.consumeQueuedRefresh(outcome)) queue('incremental');
      }
    });

    const failedInitial = coordinator.request('incremental');
    const explicitFull = coordinator.request('full');
    await flushMicrotasks();
    gates[0].resolve('error');
    await flushMicrotasks();

    expect(modes).toEqual(['incremental', 'full']);
    expect(autoRefresh.consumeQueuedRefresh('ready')).toBe(false);
    expect(statuses).toEqual(['indexing']);
    gates[1].resolve('ready');
    await expect(Promise.all([failedInitial, explicitFull])).resolves.toEqual(['error', 'ready']);
    expect(statuses).toEqual(['indexing', 'ready']);
  });

  it('leaves the MCP refresh response immediate while the scheduled pass is pending', async () => {
    const gate = deferred<IndexingOutcome>();
    const coordinator = createIndexingCoordinator({
      runPass: () => gate.promise,
      onStarted: () => undefined,
      onFinished: () => undefined
    });
    const ctx = {
      performIndexing: () => {
        void coordinator.request('full');
      }
    } as ToolContext;

    const response = await handleRefreshIndex({}, ctx);
    const payload = JSON.parse(response.content?.[0]?.text ?? '{}') as { status?: string };

    expect(payload.status).toBe('started');
    gate.resolve('ready');
  });
});
