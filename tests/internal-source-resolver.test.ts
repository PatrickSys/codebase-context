import { afterAll, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { extractSourceReexports, InternalSourceResolver } from '../src/utils/internal-source-resolver.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-source-resolver-'));
afterAll(async () => fs.rm(root, { recursive: true, force: true }));

it('resolves only indexed TS/TSX files, directory indexes, aliases, and JS specifiers to source', async () => {
  const importer = path.join(root, 'apps/web/src/entry.ts');
  const jsAliasTarget = path.join(root, 'apps/web/src/actual.ts');
  const targets = [
    path.join(root, 'apps/web/src/view.tsx'),
    path.join(root, 'packages/core/src/index.ts'),
    path.join(root, 'packages/core/src/actual.ts')
  ];
  await fs.mkdir(path.dirname(importer), { recursive: true });
  await fs.mkdir(path.dirname(targets[0]!), { recursive: true });
  await fs.mkdir(path.dirname(targets[1]!), { recursive: true });
  await Promise.all([fs.writeFile(importer, ''), fs.writeFile(jsAliasTarget, ''), ...targets.map((file) => fs.writeFile(file, ''))]);
  const resolver = await InternalSourceResolver.create(root, [importer, jsAliasTarget, ...targets], {
    baseUrl: '.', paths: { '@core/*': ['packages/core/src/*'] }
  });

  expect(await resolver.resolve(importer, './view')).toMatchObject({ status: 'resolved', path: targets[0] });
  expect(await resolver.resolve(importer, '../../../packages/core/src')).toMatchObject({ status: 'resolved', path: targets[1] });
  expect(await resolver.resolve(importer, '@core/actual')).toMatchObject({ status: 'resolved', path: targets[2] });
  expect(await resolver.resolve(importer, '@core/missing')).toMatchObject({ status: 'unresolved', reason: 'not-found' });
  expect(await resolver.resolve(importer, 'external-package')).toMatchObject({ status: 'unresolved', reason: 'external' });
  expect(await resolver.resolve(importer, './ghost')).toMatchObject({ status: 'unresolved', reason: 'not-found' });
  expect(await resolver.resolve(importer, './actual.js')).toMatchObject({ status: 'resolved', path: jsAliasTarget });
});

it('extracts only explicit AST re-exports and rejects paths resolving outside the root', async () => {
  expect(extractSourceReexports("export { thing } from './impl';\nexport * from './other';", 'index.ts'))
    .toEqual([{ specifier: './impl', line: 1 }, { specifier: './other', line: 2 }]);
  expect(extractSourceReexports("import './impl';", 'index.ts')).toEqual([]);

  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-outside-'));
  const importer = path.join(root, 'src/in-root.ts');
  const escape = path.join(root, 'src/escape');
  await fs.mkdir(path.dirname(importer), { recursive: true });
  await fs.writeFile(importer, '');
  let symlinkCreated = false;
  try {
    await fs.writeFile(path.join(outside, 'file.ts'), 'export const outside = true;');
    await fs.symlink(outside, escape, 'junction');
    symlinkCreated = true;
  } catch {
    // Junction creation can be disabled by the host; direct traversal tests still cover outside-root paths.
  }
  if (symlinkCreated) {
    const resolver = await InternalSourceResolver.create(root, [importer, path.join(escape, 'file.ts')]);
    expect(await resolver.resolve(importer, './escape/file')).toMatchObject({ status: 'unresolved', reason: 'outside-root' });
  }
  await fs.rm(outside, { recursive: true, force: true });
});
