import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { CodebaseIndexer } from '../../../dist/core/indexer.js';
import { withManagedStdioClientSession } from '../../../scripts/lib/managed-mcp-session.mjs';

const root = process.cwd();
const tsPath = 'examples/context-demo/src/app/checkout/checkout.component.ts';
const pyPath = 'examples/context-demo/python/checkout.py';
const manifestPath = 'examples/context-demo/checkout.context.json';
const movedPath = tsPath.replace('.component.ts', '.moved.ts');
const target = { path: tsPath, symbol: 'CheckoutComponent' };
const original = await readFile(path.join(root, tsPath));
const originalManifest = await readFile(path.join(root, manifestPath));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain', '--', tsPath, manifestPath))
  throw new Error('Sample files have local changes; refusing to modify them.');
try {
  await access(path.join(root, movedPath));
  throw new Error('Move destination already exists.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const revision = git('rev-parse', 'HEAD');
const clean = git('status', '--porcelain') === '';
const index = async () => {
  const indexer = new CodebaseIndexer({
    rootPath: root,
    config: {
      include: ['examples/context-demo/**/*.{ts,html,py}'],
      skipEmbedding: true,
      documentation: { autoDetect: false, includeReadmes: false, includeChangelogs: false },
      styleGuides: { autoDetect: false, paths: [], parseMarkdown: false },
    },
  });
  await indexer.index();
};
const call = async (args) =>
  withManagedStdioClientSession(
    {
      serverCommand: process.execPath,
      serverArgs: [path.join(root, 'dist/index.js'), root],
      cwd: root,
      connectTimeoutMs: 30000,
    },
    async ({ client }) => {
      const result = await client.callTool({
        name: 'get_feature_context',
        arguments: { ...args, project: root },
      });
      if (result.isError) throw new Error(JSON.stringify(result));
      assert.ok(
        Math.ceil(result.content[0].text.length / 3) <= 900,
        'MCP response exceeds the 900-token estimate',
      );
      return JSON.parse(result.content[0].text);
    },
  );
const print = (name, value) => console.log(`${name} ${JSON.stringify(value)}`);
const expected = original.toString('utf8');
if (!expected.includes('export class CheckoutComponent'))
  throw new Error('Expected declaration missing.');
let moved = false;
try {
  await index();
  const sidecar = JSON.parse(
    await readFile(path.join(root, '.codebase-context/relationships.json'), 'utf8'),
  );
  print('revision', {
    gitHead: revision,
    indexedCommit: sidecar.featureContexts.code.commit,
    clean,
  });
  print(
    'requirement_source',
    (await readFile(path.join(root, 'examples/context-demo/context/requirements.yaml'), 'utf8'))
      .split(/\r?\n/)
      .slice(0, 6)
      .join('\n'),
  );
  const before = await call(target);
  print('typescript_before', before);
  const py = await call({ path: pyPath, symbol: 'checkout_total' });
  print('python_symbol', py);
  const matched = (reply, symbol) =>
    reply.matches.flatMap((m) => m.appliesTo).find((t) => t.target.symbol === symbol);
  const ts = matched(before, target.symbol);
  assert.equal(sidecar.featureContexts.code.commit, revision);
  assert.equal(before.matches.length, 1);
  assert.equal(before.matches[0].requirementId, 'CART-01');
  assert.equal(before.matches[0].source.locator, 'claims[CART-01]');
  assert.equal(before.matches[0].source.status, 'resolved');
  assert.equal(before.matches[0].source.current, true);
  assert.equal(ts?.status, 'resolved');
  assert.equal(ts.current, true);
  assert.deepEqual(ts.identity, { path: tsPath, name: target.symbol, startLine: 11, endLine: 15 });
  assert.equal(matched(py, 'checkout_total')?.status, 'unsupported');

  const invalidManifest = JSON.parse(originalManifest.toString('utf8'));
  invalidManifest.attachments[0].requirementId = 'CART-DOES-NOT-EXIST';
  invalidManifest.attachments[0].source.locator = 'claims[CART-DOES-NOT-EXIST]';
  await writeFile(path.join(root, manifestPath), JSON.stringify(invalidManifest, null, 2));
  await index();
  const invalid = await call(target);
  print('nonexistent_requirement', invalid);
  assert.equal(invalid.matches[0]?.requirementId, 'CART-DOES-NOT-EXIST');
  assert.equal(invalid.matches[0]?.source.status, 'invalid');
  assert.equal(invalid.matches[0]?.source.current, false);
  assert.equal(invalid.counts.resolved, 0);
  assert.ok(invalid.matches[0]?.diagnostics.some((item) => item.code === 'invalid-source-locator'));
  await writeFile(path.join(root, manifestPath), originalManifest);
  await index();

  await writeFile(
    path.join(root, tsPath),
    expected.replace('readonly total = this.store.total;', 'readonly total = 0;'),
  );
  const bodyEdited = await call(target);
  print('body_edit_without_refresh', bodyEdited);
  assert.equal(matched(bodyEdited, target.symbol)?.current, false);
  assert.ok(bodyEdited.matches[0]?.diagnostics.some((item) => item.code === 'stale-target'));
  await writeFile(path.join(root, tsPath), original);
  await index();

  for (const operation of ['move', 'delete']) {
    if (operation === 'move') {
      await rename(path.join(root, tsPath), path.join(root, movedPath));
      moved = true;
    } else await unlink(path.join(root, tsPath));
    const staleMissing = await call(target);
    print(`${operation}_without_refresh`, staleMissing);
    assert.equal(matched(staleMissing, target.symbol)?.current, false);
    assert.ok(staleMissing.matches[0]?.diagnostics.some((item) => item.code === 'stale-target'));
    await index();
    const missing = await call(target);
    print(`${operation}_after_refresh`, missing);
    assert.equal(missing.matches.length, 1);
    assert.equal(matched(missing, target.symbol)?.status, 'missing');
    assert.equal(matched(missing, target.symbol)?.current, false);
    assert.ok(missing.matches[0]?.diagnostics.some((item) => item.code === 'missing-target'));
    assert.equal(missing.counts.omitted, 0);
    assert.equal(missing.counts.resolved, 0);
    if (moved) {
      await rename(path.join(root, movedPath), path.join(root, tsPath));
      moved = false;
    } else await writeFile(path.join(root, tsPath), original);
    await index();
  }
  await writeFile(
    path.join(root, tsPath),
    expected.replace('export class CheckoutComponent', 'export class RenamedCheckoutComponent'),
  );
  const stale = await call(target);
  print('typescript_changed_without_refresh', stale);
  if (matched(stale, target.symbol)?.current !== false)
    throw new Error('Changed target was not marked stale');
  await index();
  const refreshed = await call(target);
  print('typescript_changed_after_refresh', refreshed);
  if (matched(refreshed, target.symbol)?.status !== 'unsupported')
    throw new Error('Removed symbol was not reported unsupported');
} finally {
  if (moved) await rename(path.join(root, movedPath), path.join(root, tsPath));
  await writeFile(path.join(root, tsPath), original);
  await writeFile(path.join(root, manifestPath), originalManifest);
  await index();
}
