import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CodebaseIndexer } from '../../src/core/indexer.js';
import { handleMapCli } from '../../src/cli-map.js';
import { TransformersEmbeddingProvider } from '../../src/embeddings/transformers.js';

const [root, action] = process.argv.slice(2);
if (!root) throw new Error('Expected test root');
// Stub only model computation; real indexer, native storage, leases and publication run.
Object.assign(TransformersEmbeddingProvider.prototype, {
  initialize: async () => undefined,
  embedBatch: async (texts: string[]) =>
    texts.map(() => Array.from({ length: 384 }, (_, i) => i / 1000))
});
const release = () => new Promise<void>((resolve) => process.once('message', () => resolve()));
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
    if (!ticket.choosing && ticket.ticket > 0) {
      process.send?.({ type: action === 'publish' ? 'held' : 'queued' });
      if (action === 'publish') await release();
    }
  }
};
const write = fs.writeFile.bind(fs);
fs.writeFile = async (...args) => {
  if (action === 'semantic-stage' && path.basename(String(args[0])) === 'index-build.json') {
    process.send?.({ type: 'native' });
    await release();
  }
  await write(...args);
};
try {
  if (action === 'map') {
    process.env.CODEBASE_ROOT = root;
    process.env.CODEBASE_CONTEXT_CONFIG_PATH = path.join(root, 'server-config.json');
    await handleMapCli(['--json']);
  } else {
    await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: false } }).index();
  }
  process.send?.({ type: 'complete' });
} catch (error) {
  process.send?.({
    type: 'failed',
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
} finally {
  process.disconnect?.();
}
