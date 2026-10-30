import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { withIndexWriter } from '../src/core/index-generation.js';
import { atomicWrite } from '../src/utils/atomic-write.js';

const roots: string[] = [];
const children = new Map<ChildProcess, Promise<void>>();
const Ticket = z.object({ pid: z.number(), choosing: z.boolean(), ticket: z.number() });
const ChildMessage = z.object({
  type: z.enum(['ready', 'held', 'closed', 'entered', 'leaving', 'finished', 'failed']),
  bytes: z.string().optional(),
  time: z.number().optional(),
  message: z.string().optional()
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const [child] of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await Promise.all(children.values());
  children.clear();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-ticket-replacement-'));
  roots.push(root);
  return root;
}
function bounded<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Lease control barrier timed out')), 5000);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
function child(mode: 'reader' | 'writer', target: string) {
  const process = fork(
    fileURLToPath(new URL('./helpers/index-lease-control-child.ts', import.meta.url)),
    [mode, target],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true
    }
  );
  const history: z.infer<typeof ChildMessage>[] = [];
  const listeners = new Set<(message: z.infer<typeof ChildMessage>) => void>();
  process.on('message', (value) => {
    const message = ChildMessage.parse(value);
    history.push(message);
    for (const listener of listeners) listener(message);
  });
  const exited = new Promise<void>((resolve) => process.once('exit', () => resolve()));
  children.set(process, exited);
  const wait = (type: z.infer<typeof ChildMessage>['type']) =>
    bounded(
      new Promise<z.infer<typeof ChildMessage>>((resolve, reject) => {
        const existing = history.find((message) => message.type === type);
        if (existing) return resolve(existing);
        const receive = (message: z.infer<typeof ChildMessage>) => {
          if (message.type === type) {
            listeners.delete(receive);
            resolve(message);
          } else if (message.type === 'failed') {
            listeners.delete(receive);
            reject(new Error(message.message));
          }
        };
        listeners.add(receive);
      })
    );
  return { process, wait, exited, history };
}
async function hold(target: string, mode: string, warmed?: ReturnType<typeof child>) {
  if (mode === 'same') {
    const handle = await fs.open(target, 'r');
    return { bytes: (await handle.readFile()).toString('utf8'), close: () => handle.close() };
  }
  const reader = warmed ?? child('reader', target);
  await reader.wait('ready');
  reader.process.send({ target });
  const held = await reader.wait('held');
  return {
    bytes: held.bytes,
    close: async () => {
      const closed = reader.wait('closed');
      reader.process.send({ close: true });
      await closed;
      await bounded(reader.exited);
    }
  };
}
function writerTarget(target: unknown) {
  return (
    String(target).includes(`${path.sep}.writers${path.sep}`) && String(target).endsWith('.json')
  );
}
async function nextTicket(
  source: Parameters<typeof fs.rename>[0],
  target: Parameters<typeof fs.rename>[1]
) {
  if (!writerTarget(target)) return null;
  return Ticket.parse(JSON.parse(await fs.readFile(source, 'utf8')));
}

it.skipIf(process.platform !== 'win32').each([
  { phase: 'numbered', mode: 'same' },
  { phase: 'numbered', mode: 'cross' },
  { phase: 'released', mode: 'same' },
  { phase: 'released', mode: 'cross' }
])(
  'publishes a complete $phase ticket after an ordinary $mode-process reader closes',
  async ({ phase, mode }) => {
    const root = await fixture();
    const reader = mode === 'cross' ? child('reader', root) : undefined;
    if (reader) await reader.wait('ready');
    const rename = fs.rename.bind(fs);
    let held: Awaited<ReturnType<typeof hold>> | undefined;
    let admitted = false;
    let failures = 0;
    let successes = 0;
    let oldBytes: string | undefined;
    const publish = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      const next = await nextTicket(source, target);
      const selected =
        next && !next.choosing && (phase === 'numbered' ? next.ticket > 0 : next.ticket === 0);
      if (!selected) return rename(source, target);
      const proposed = await fs.readFile(source, 'utf8');
      if (!held) {
        oldBytes = await fs.readFile(target, 'utf8');
        held = await hold(String(target), mode, reader);
        expect(held.bytes).toBe(oldBytes);
      }
      try {
        await rename(source, target);
        successes++;
        expect(await fs.readFile(target, 'utf8')).toBe(proposed);
      } catch (error) {
        failures++;
        expect(error).toMatchObject({ code: 'EPERM', syscall: 'rename', dest: String(target) });
        expect(admitted).toBe(phase === 'released');
        expect(await fs.readFile(target, 'utf8')).toBe(oldBytes);
        await held.close();
        throw error;
      }
    });
    await expect(
      withIndexWriter(root, async () => {
        admitted = true;
        return 'successful-operation';
      })
    ).resolves.toBe('successful-operation');
    expect(failures).toBe(1);
    expect(successes).toBe(1);
    expect(admitted).toBe(true);
    expect(await fs.readdir(path.join(root, '.codebase-context/.writers'))).toEqual([]);
    publish.mockRestore();
    await expect(withIndexWriter(root, async () => 'next-operation')).resolves.toBe(
      'next-operation'
    );
  }
);

it.skipIf(process.platform !== 'win32').each(['same', 'cross'])(
  'bounds replacement failures under a persistently held %s-process read handle without admission',
  async (mode) => {
    const root = await fixture();
    const reader = mode === 'cross' ? child('reader', root) : undefined;
    if (reader) await reader.wait('ready');
    const rename = fs.rename.bind(fs);
    let held: Awaited<ReturnType<typeof hold>> | undefined;
    let admitted = false;
    let acquisitionFailures = 0;
    let lastAcquisitionError: unknown;
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      const next = await nextTicket(source, target);
      if (next && !next.choosing && next.ticket > 0) {
        if (!held) held = await hold(String(target), mode, reader);
        try {
          await rename(source, target);
        } catch (error) {
          acquisitionFailures++;
          lastAcquisitionError = error;
          expect(await fs.readFile(target, 'utf8')).toBe(held.bytes);
          throw error;
        }
        return;
      }
      return rename(source, target);
    });
    try {
      const operation = withIndexWriter(root, async () => {
        admitted = true;
      });
      await expect(operation).rejects.toMatchObject({ code: 'EPERM', syscall: 'rename' });
      await expect(operation).rejects.toBe(lastAcquisitionError);
      expect(admitted).toBe(false);
      expect(acquisitionFailures).toBeGreaterThan(1);
      expect(acquisitionFailures).toBeLessThanOrEqual(8);
      expect(await fs.readdir(path.join(root, '.codebase-context/.writers'))).toEqual([]);
    } finally {
      await held?.close();
    }
  }
);

it.skipIf(process.platform !== 'win32')(
  'starts no further replacement attempt after its retry deadline',
  async () => {
    const root = await fixture();
    const rename = fs.rename.bind(fs);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    let attempts = 0;
    let admitted = false;
    let denial: Error | undefined;
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      const next = await nextTicket(source, target);
      if (next && !next.choosing && next.ticket > 0) {
        attempts++;
        clock.mockReturnValue(now + 251);
        denial = Object.assign(new Error('Controlled replacement deadline'), {
          code: 'EPERM',
          syscall: 'rename',
          path: String(source),
          dest: String(target)
        });
        throw denial;
      }
      return rename(source, target);
    });
    await expect(
      withIndexWriter(root, async () => {
        admitted = true;
      })
    ).rejects.toMatchObject({ message: 'Controlled replacement deadline' });
    expect(attempts).toBe(1);
    expect(admitted).toBe(false);
  }
);

it.each([
  { code: 'EACCES', syscall: 'rename', mismatch: '' },
  { code: 'EPERM', syscall: 'open', mismatch: '' },
  { code: 'EIO', syscall: 'rename', mismatch: '' },
  { code: 'EPERM', syscall: 'rename', mismatch: 'destination' },
  { code: 'EPERM', syscall: 'rename', mismatch: 'temporary-uuid' },
  { code: 'EPERM', syscall: 'rename', mismatch: 'temporary-directory' },
  { code: 'EPERM', syscall: 'rename', mismatch: 'missing-destination' },
  { code: 'EPERM', syscall: 'rename', mismatch: 'non-string-source' }
])(
  'preserves permanent or unrelated $code/$syscall errors ($mismatch) without retry or admission',
  async ({ code, syscall, mismatch }) => {
    const root = await fixture();
    const rename = fs.rename.bind(fs);
    let attempts = 0;
    let admitted = false;
    let denial: Error | undefined;
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      const next = await nextTicket(source, target);
      if (next && !next.choosing && next.ticket > 0) {
        attempts++;
        denial = Object.assign(new Error('Controlled permanent or unrelated filesystem error'), {
          code,
          syscall,
          path:
            mismatch === 'non-string-source'
              ? 4
              : mismatch === 'temporary-uuid'
                ? `${target}.not-a-uuid.tmp`
                : mismatch === 'temporary-directory'
                  ? path.join(root, path.basename(String(source)))
                  : String(source),
          ...(mismatch === 'missing-destination'
            ? {}
            : {
                dest: mismatch === 'destination' ? path.join(root, 'foreign.json') : String(target)
              })
        });
        throw denial;
      }
      return rename(source, target);
    });
    const failed = withIndexWriter(root, async () => {
      admitted = true;
    });
    await expect(failed).rejects.toMatchObject({ code, syscall });
    await expect(failed).rejects.toBe(denial);
    expect(attempts).toBe(1);
    expect(admitted).toBe(false);
    expect(await fs.readdir(path.join(root, '.codebase-context/.writers'))).toEqual([]);
  }
);

it('does not retry initial ticket creation', async () => {
  const root = await fixture();
  const rename = fs.rename.bind(fs);
  let attempts = 0;
  let admitted = false;
  vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    const next = await nextTicket(source, target);
    if (next?.choosing) {
      attempts++;
      throw Object.assign(new Error('Initial ticket publication denied'), {
        code: 'EPERM',
        syscall: 'rename',
        path: String(source),
        dest: String(target)
      });
    }
    return rename(source, target);
  });
  await expect(
    withIndexWriter(root, async () => {
      admitted = true;
    })
  ).rejects.toThrow('Initial ticket publication denied');
  expect(attempts).toBe(1);
  expect(admitted).toBe(false);
});

it('keeps ticket open errors fail closed', async () => {
  const root = await fixture();
  const read = fs.readFile.bind(fs);
  let attempts = 0;
  let admitted = false;
  vi.spyOn(fs, 'readFile').mockImplementation((file, options) => {
    if (writerTarget(file)) {
      attempts++;
      return Promise.reject(
        Object.assign(new Error('Controlled ticket open denial'), {
          code: 'EPERM',
          syscall: 'open',
          path: String(file)
        })
      );
    }
    return read(file, options);
  });
  await expect(
    withIndexWriter(root, async () => {
      admitted = true;
    })
  ).rejects.toMatchObject({ code: 'EPERM', syscall: 'open' });
  expect(attempts).toBe(1);
  expect(admitted).toBe(false);
});

it('leaves generic atomic publication errors unchanged', async () => {
  const root = await fixture();
  const target = path.join(root, 'ordinary.json');
  await fs.writeFile(target, 'original');
  let attempts = 0;
  vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    attempts++;
    throw Object.assign(new Error('Generic rename denied'), {
      code: 'EPERM',
      syscall: 'rename',
      path: String(source),
      dest: String(destination)
    });
  });
  await expect(atomicWrite(target, 'replacement')).rejects.toMatchObject({ code: 'EPERM' });
  expect(attempts).toBe(1);
  expect(await fs.readFile(target, 'utf8')).toBe('original');
  expect(await fs.readdir(root)).toEqual(['ordinary.json']);
});

it('preserves cross-process writer order and excludes admission until the first operation leaves', async () => {
  const root = await fixture();
  const first = child('writer', root);
  await first.wait('entered');
  const rename = fs.rename.bind(fs);
  const queued = Promise.withResolvers<void>();
  let secondEnteredAt = 0;
  vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    const next = await nextTicket(source, target);
    await rename(source, target);
    if (next && !next.choosing && next.ticket > 0) {
      expect(next.ticket).toBe(2);
      queued.resolve();
    }
  });
  const second = withIndexWriter(root, async () => {
    secondEnteredAt = Date.now();
    return 'second-operation';
  });
  await bounded(queued.promise);
  expect(secondEnteredAt).toBe(0);
  const leaving = first.wait('leaving');
  first.process.send({ release: true });
  const exitedSection = await leaving;
  await expect(second).resolves.toBe('second-operation');
  expect(secondEnteredAt).toBeGreaterThanOrEqual(exitedSection.time ?? Infinity);
  await bounded(first.exited);
});

it('recovers the unique ticket of an actually terminated owner', async () => {
  const root = await fixture();
  const first = child('writer', root);
  await first.wait('entered');
  const directory = path.join(root, '.codebase-context/.writers');
  const abandoned = await fs.readdir(directory);
  expect(abandoned).toHaveLength(1);
  first.process.kill('SIGKILL');
  await bounded(first.exited);
  await expect(withIndexWriter(root, async () => 'recovered')).resolves.toBe('recovered');
  expect(await fs.readdir(directory)).toEqual([]);
});

it('rejects malformed foreign ticket bytes without admitting or rewriting them', async () => {
  const root = await fixture();
  const directory = path.join(root, '.codebase-context/.writers');
  await fs.mkdir(directory, { recursive: true });
  const foreign = path.join(directory, 'foreign.json');
  const original = '{"pid":"invalid"}';
  await fs.writeFile(foreign, original);
  let admitted = false;
  await expect(
    withIndexWriter(root, async () => {
      admitted = true;
    })
  ).rejects.toThrow();
  expect(admitted).toBe(false);
  expect(await fs.readFile(foreign, 'utf8')).toBe(original);
});
