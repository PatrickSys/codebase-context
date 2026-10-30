import { fork, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { readIndexMeta, validateIndexArtifacts } from '../src/core/index-meta.js';
import { CodebaseSearcher } from '../src/core/search.js';

let root = '';
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await exited;
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = '';
});

function writer(hold: boolean) {
  const child = fork(
    fileURLToPath(new URL('./helpers/index-writer-child.ts', import.meta.url)),
    [root, hold ? 'hold' : 'run'],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    }
  );
  children.push(child);
  const messages: Array<{ type: string; incremental?: unknown; message?: string }> = [];
  const listeners = new Set<() => void>();
  let stderr = '';
  child.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  child.on('message', (message) => {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('type' in message) ||
      typeof message.type !== 'string'
    )
      return;
    messages.push({ ...message, type: message.type });
    for (const listener of listeners) listener();
  });
  child.on('exit', () => {
    for (const listener of listeners) listener();
  });
  const wait = (type: string) =>
    new Promise<{ type: string; incremental?: unknown }>((resolve, reject) => {
      // Test-child watchdog: stop after twenty seconds or as soon as this event arrives.
      const timer = setTimeout(
        () => finish(new Error(`Child did not report ${type}: ${stderr}`)),
        20_000
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        listeners.delete(check);
        if (error) reject(error);
      };
      const check = () => {
        const message = messages.find((candidate) => candidate.type === type);
        if (message) {
          finish();
          resolve(message);
        } else if (
          messages.some((candidate) => candidate.type === 'failed') ||
          child.exitCode !== null ||
          child.signalCode !== null
        )
          finish(new Error(`Writer stopped: ${JSON.stringify(messages)} ${stderr}`));
      };
      listeners.add(check);
      check();
    });
  return { child, wait };
}

async function fixture() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-writers-'));
  await fs.writeFile(path.join(root, 'a.ts'), 'export const first = "alpha";');
  await fs.writeFile(path.join(root, 'b.ts'), 'export const second = "alpha";');
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
}

it('serializes real processes before baseline reads while searches use the committed generation', async () => {
  await fixture();
  await fs.writeFile(path.join(root, 'a.ts'), 'export const first = "beta";');
  const first = writer(true);
  await first.wait('staged');
  // A live writer never blocks admission to the previous complete generation.
  expect((await new CodebaseSearcher(root).search('second')).length).toBeGreaterThan(0);
  await fs.writeFile(path.join(root, 'b.ts'), 'export const second = "beta";');
  const second = writer(false);
  await second.wait('queued');
  first.child.send({ release: true });
  await first.wait('complete');
  const completed = await second.wait('complete');
  expect(completed.incremental).toEqual({ added: 0, changed: 1, deleted: 0, unchanged: 1 });
  await validateIndexArtifacts(root, await readIndexMeta(root));
  expect((await new CodebaseSearcher(root).search('beta')).length).toBeGreaterThan(0);
}, 30_000);

it('recovers a killed writer without stealing a live writer lease', async () => {
  await fixture();
  await fs.writeFile(path.join(root, 'a.ts'), 'export const first = "beta";');
  const first = writer(true);
  await first.wait('staged');
  const second = writer(false);
  await second.wait('queued');
  const exited = new Promise<void>((resolve) => first.child.once('exit', () => resolve()));
  first.child.kill('SIGKILL');
  await exited;
  const completed = await second.wait('complete');
  expect(completed.incremental).toEqual({ added: 0, changed: 1, deleted: 0, unchanged: 1 });
  await validateIndexArtifacts(root, await readIndexMeta(root));
}, 30_000);
