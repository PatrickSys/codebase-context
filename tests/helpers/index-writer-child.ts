import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CodebaseIndexer } from '../../src/core/indexer.js';

const [rootPath, hold] = process.argv.slice(2);
if (!rootPath) throw new Error('Expected project root');
const rename = fs.rename.bind(fs);
fs.rename = async (source, target) => {
  await rename(source, target);
  if (
    String(target).includes(`${path.sep}.writers${path.sep}`) &&
    String(target).endsWith('.json')
  ) {
    const ticket: { choosing: boolean; ticket: number } = JSON.parse(
      await fs.readFile(target, 'utf8')
    );
    if (!ticket.choosing && ticket.ticket > 0) process.send?.({ type: 'queued' });
  }
};
const writeFile = fs.writeFile.bind(fs);
fs.writeFile = async (...args) => {
  await writeFile(...args);
  if (hold === 'hold' && path.basename(String(args[0])) === 'index-build.json') {
    process.send?.({ type: 'staged' });
    await new Promise<void>((resolve) => process.once('message', () => resolve()));
  }
};
try {
  const stats = await new CodebaseIndexer({
    rootPath,
    config: { skipEmbedding: true },
    incrementalOnly: true
  }).index();
  process.send?.({ type: 'complete', incremental: stats.incremental });
} catch (error) {
  process.send?.({
    type: 'failed',
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
} finally {
  process.disconnect?.();
}
