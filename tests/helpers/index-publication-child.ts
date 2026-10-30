import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CodebaseIndexer } from '../../src/core/indexer.js';

const [rootPath, mode, edge] = process.argv.slice(2);
if (!rootPath || !mode || !edge) throw new Error('Expected root, mode and edge');

const pause = async () => {
  process.send?.({ edge });
  await new Promise(() => undefined);
};
const rename = fs.rename.bind(fs);
fs.rename = async (source, target) => {
  await rename(source, target);
  if (
    edge === 'published-meta' &&
    String(target) === path.join(rootPath, '.codebase-context', 'index-meta.json')
  ) {
    await pause();
  }
};
const writeFile = fs.writeFile.bind(fs);
fs.writeFile = async (...args) => {
  await writeFile(...args);
  if (edge === 'vector-marker' && path.basename(String(args[0])) === 'index-build.json')
    await pause();
};

await new CodebaseIndexer({
  rootPath,
  config: { skipEmbedding: true },
  incrementalOnly: mode === 'incremental'
}).index();
process.send?.({ completed: true });
