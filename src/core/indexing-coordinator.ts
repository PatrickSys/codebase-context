export type IndexingMode = 'full' | 'incremental';
export type IndexingOutcome = 'ready' | 'error';

interface PendingBatch {
  mode: IndexingMode;
  waiters: Array<(outcome: IndexingOutcome) => void>;
}

export interface IndexingCoordinatorOptions {
  runPass: (mode: IndexingMode) => Promise<IndexingOutcome>;
  onStarted: () => void;
  onFinished: (outcome: IndexingOutcome) => void;
  afterPass?: (outcome: IndexingOutcome, queue: (mode: IndexingMode) => void) => void;
}

export interface IndexingCoordinator {
  /** Request a pass and resolve with the outcome of the pass that covers it. */
  request: (mode: IndexingMode) => Promise<IndexingOutcome>;
}

function strongerMode(left: IndexingMode, right: IndexingMode): IndexingMode {
  return left === 'full' || right === 'full' ? 'full' : 'incremental';
}

function createPendingBatch(mode: IndexingMode): PendingBatch {
  return { mode, waiters: [] };
}

export function createIndexingCoordinator(
  options: IndexingCoordinatorOptions
): IndexingCoordinator {
  let activeDrain: Promise<void> | undefined;
  let pending: PendingBatch | undefined;

  const enqueue = (mode: IndexingMode, waiter?: (outcome: IndexingOutcome) => void): void => {
    if (!pending) pending = createPendingBatch(mode);
    else pending.mode = strongerMode(pending.mode, mode);
    if (waiter) pending.waiters.push(waiter);
  };

  const drain = async (first: PendingBatch): Promise<void> => {
    let batch: PendingBatch | undefined = first;
    let finalOutcome: IndexingOutcome = 'error';

    while (batch) {
      let outcome: IndexingOutcome;
      try {
        outcome = await options.runPass(batch.mode);
      } catch {
        outcome = 'error';
      }

      try {
        options.afterPass?.(outcome, (mode) => enqueue(mode));
      } catch {
        outcome = 'error';
      }

      finalOutcome = outcome;
      for (const resolve of batch.waiters) resolve(outcome);

      batch = pending;
      pending = undefined;
    }

    activeDrain = undefined;
    try {
      options.onFinished(finalOutcome);
    } catch {
      // Status publication is best-effort; it must not reject fire-and-forget callers.
    }
  };

  const startDrain = (first: PendingBatch): void => {
    const drainPromise = Promise.resolve().then(() => drain(first));
    activeDrain = drainPromise;
    void drainPromise.catch(() => {
      if (activeDrain !== drainPromise) return;
      activeDrain = undefined;
      try {
        options.onFinished('error');
      } catch {
        // Avoid an unhandled rejection from the background drain.
      }
    });
  };

  return {
    request: (mode) =>
      new Promise<IndexingOutcome>((resolve) => {
        if (activeDrain) {
          enqueue(mode, resolve);
          return;
        }

        try {
          options.onStarted();
        } catch {
          // Keep the pass lifecycle contained even if a status observer fails.
        }
        const first = createPendingBatch(mode);
        first.waiters.push(resolve);
        startDrain(first);
      })
  };
}
