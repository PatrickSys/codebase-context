import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { CodebaseIndexer } from '../../../dist/core/indexer.js';
import { withManagedStdioClientSession } from '../../../scripts/lib/managed-mcp-session.mjs';

const root = process.cwd();
const tsPath = 'examples/context-demo/src/app/checkout/checkout.component.ts';
const pyPath = 'examples/context-demo/python/checkout.py';
const target = { path: tsPath, symbol: 'CheckoutComponent' };
const original = await readFile(path.join(root, tsPath));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain', '--', tsPath)) throw new Error('Sample file has local changes; refusing to modify it.');
const revision = git('rev-parse', 'HEAD');
const index = async () => {
  const indexer = new CodebaseIndexer({ rootPath: root, config: {
    include: ['examples/context-demo/**/*.{ts,html,py}'], skipEmbedding: true,
    documentation: { autoDetect: false, includeReadmes: false, includeChangelogs: false },
    styleGuides: { autoDetect: false, paths: [], parseMarkdown: false }
  }});
  await indexer.index();
};
const call = async (args) => withManagedStdioClientSession({
  serverCommand: process.execPath, serverArgs: [path.join(root, 'dist/index.js'), root], cwd: root,
  connectTimeoutMs: 30000
}, async ({ client }) => {
  const result = await client.callTool({ name: 'get_feature_context', arguments: { ...args, project: root } });
  if (result.isError) throw new Error(JSON.stringify(result));
  return JSON.parse(result.content[0].text);
});
const print = (name, value) => console.log(`${name} ${JSON.stringify(value)}`);
const expected = original.toString('utf8');
if (!expected.includes('export class CheckoutComponent')) throw new Error('Expected declaration missing.');
try {
  await index();
  const sidecar = JSON.parse(await readFile(path.join(root, '.codebase-context/relationships.json'), 'utf8'));
  print('revision', { gitHead: revision, indexedCommit: sidecar.featureContexts.code.commit });
  print('requirement_source', (await readFile(path.join(root, 'examples/context-demo/context/requirements.yaml'), 'utf8')).split(/\r?\n/).slice(0, 6).join('\n'));
  const before = await call(target);
  print('typescript_before', before);
  const py = await call({ path: pyPath, symbol: 'checkout_total' });
  print('python_symbol', py);
  const matched = (reply, symbol) => reply.matches.flatMap((m) => m.appliesTo).find((t) => t.target.symbol === symbol);
  const ts = matched(before, target.symbol);
  if (sidecar.featureContexts.code.commit !== revision || ts?.status !== 'resolved' || !ts.current || ts.identity?.name !== target.symbol || !ts.identity.startLine || !ts.identity.endLine || matched(py, 'checkout_total')?.status !== 'unsupported') throw new Error('Baseline proof expectations failed');
  await writeFile(path.join(root, tsPath), expected.replace('export class CheckoutComponent', 'export class RenamedCheckoutComponent'));
  const stale = await call(target);
  print('typescript_changed_without_refresh', stale);
  if (matched(stale, target.symbol)?.current !== false) throw new Error('Changed target was not marked stale');
  await index();
  const refreshed = await call(target);
  print('typescript_changed_after_refresh', refreshed);
  if (matched(refreshed, target.symbol)?.status !== 'unsupported') throw new Error('Removed symbol was not reported unsupported');
} finally {
  await writeFile(path.join(root, tsPath), original);
  await index();
}
