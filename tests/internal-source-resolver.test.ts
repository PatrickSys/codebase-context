import { afterAll, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import {
  extractSourceReexports,
  InternalSourceResolver,
  loadTsconfigCompilerOptions
} from '../src/utils/internal-source-resolver.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-source-resolver-'));
afterAll(async () => fs.rm(root, { recursive: true, force: true }));

it('captures the same physical target from selected and unindexed resolution through root aliases', async () => {
  const project = path.join(root, 'physical-root');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.mkdir(path.join(project, 'physical'), { recursive: true });
  await fs.writeFile(path.join(project, 'src/main.ts'), "import '../linked/target';\n");
  await fs.writeFile(path.join(project, 'physical/target.ts'), 'export const target = true;\n');
  await fs.symlink(path.join(project, 'physical'), path.join(project, 'linked'), 'junction');
  const alias = path.join(root, 'root-alias');
  await fs.symlink(project, alias, 'junction');
  const importer = path.join(alias, 'src/main.ts');
  const target = path.join(alias, 'physical/target.ts');
  const selected = await InternalSourceResolver.create(alias, [importer, target]);
  expect(await selected.resolve(importer, '../linked/target')).toEqual({
    status: 'resolved',
    path: target,
    target: 'physical/target.ts'
  });
  const unindexed = await InternalSourceResolver.create(alias, [importer]);
  expect(await unindexed.resolve(importer, '../linked/target')).toEqual({
    status: 'unresolved',
    reason: 'not-indexed',
    target: 'physical/target.ts'
  });
});

async function configProject(name: string): Promise<string> {
  const project = path.join(root, name, 'project');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(
    path.join(root, name, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@ancestor/*': ['ancestor/*'] } }
    })
  );
  return project;
}

it('loads aliases from the selected root tsconfig.base.json instead of an ancestor config', async () => {
  const project = await configProject('base-only');
  await fs.writeFile(
    path.join(project, 'tsconfig.base.json'),
    JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@shared/*': ['src/*'] } }
    })
  );
  await fs.mkdir(path.join(project, 'src'));
  const importer = path.join(project, 'src/entry.ts');
  const target = path.join(project, 'src/util.ts');
  await Promise.all([
    fs.writeFile(importer, ''),
    fs.writeFile(target, 'export const value = true;')
  ]);

  const compilerOptions = loadTsconfigCompilerOptions(project);
  expect(path.resolve(compilerOptions.baseUrl ?? '')).toBe(project);
  expect(compilerOptions.paths).toEqual({ '@shared/*': ['src/*'] });
  const resolver = await InternalSourceResolver.create(project, [importer, target], {
    compilerOptions
  });
  expect(await resolver.resolve(importer, '@shared/util')).toEqual({
    status: 'resolved',
    path: target,
    target: 'src/util.ts'
  });
  expect(await resolver.resolve(importer, '@unmapped/util')).toEqual({
    status: 'unresolved',
    reason: 'external'
  });
});

it('prefers the selected root tsconfig.json without merging its base-config sibling', async () => {
  const project = await configProject('primary');
  await fs.writeFile(
    path.join(project, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@primary/*': ['primary/*'] } }
    })
  );
  await fs.writeFile(
    path.join(project, 'tsconfig.base.json'),
    JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@base/*': ['base/*'] } }
    })
  );

  const compilerOptions = loadTsconfigCompilerOptions(project);
  expect(path.resolve(compilerOptions.baseUrl ?? '')).toBe(project);
  expect(compilerOptions.paths).toEqual({ '@primary/*': ['primary/*'] });
});

it('uses resolver defaults when the selected root has no config, without borrowing an ancestor', async () => {
  const project = await configProject('no-config');
  expect(loadTsconfigCompilerOptions(project)).toEqual({
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler
  });
});

it.each(['tsconfig.json', 'tsconfig.base.json'])(
  'preserves explicit extends from the selected %s',
  async (configName) => {
    const project = await configProject(`extends-${configName}`);
    await fs.writeFile(
      path.join(path.dirname(project), 'shared.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: './project',
          paths: { '@inherited/*': ['src/*'] },
          strict: true
        }
      })
    );
    await fs.writeFile(
      path.join(project, configName),
      JSON.stringify({ extends: '../shared.json' })
    );

    const compilerOptions = loadTsconfigCompilerOptions(project);
    expect(path.resolve(compilerOptions.baseUrl ?? '')).toBe(project);
    expect(compilerOptions.paths).toEqual({ '@inherited/*': ['src/*'] });
    expect(compilerOptions.strict).toBe(true);
  }
);

it('keeps defaults for a malformed primary config instead of silently loading the base sibling', async () => {
  const project = await configProject('malformed-primary');
  await fs.writeFile(path.join(project, 'tsconfig.json'), '{');
  await fs.writeFile(
    path.join(project, 'tsconfig.base.json'),
    JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@base/*': ['src/*'] } }
    })
  );
  expect(loadTsconfigCompilerOptions(project)).toEqual({
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler
  });
});

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
  await Promise.all([
    fs.writeFile(importer, ''),
    fs.writeFile(jsAliasTarget, ''),
    ...targets.map((file) => fs.writeFile(file, ''))
  ]);
  const resolver = await InternalSourceResolver.create(
    root,
    [importer, jsAliasTarget, ...targets],
    {
      baseUrl: '.',
      paths: { '@core/*': ['packages/core/src/*'] }
    }
  );

  expect(await resolver.resolve(importer, './view')).toMatchObject({
    status: 'resolved',
    path: targets[0]
  });
  expect(await resolver.resolve(importer, '../../../packages/core/src')).toMatchObject({
    status: 'resolved',
    path: targets[1]
  });
  expect(await resolver.resolve(importer, '@core/actual')).toMatchObject({
    status: 'resolved',
    path: targets[2]
  });
  expect(await resolver.resolve(importer, '@core/missing')).toMatchObject({
    status: 'unresolved',
    reason: 'not-found'
  });
  expect(await resolver.resolve(importer, 'external-package')).toMatchObject({
    status: 'unresolved',
    reason: 'external'
  });
  expect(await resolver.resolve(importer, './ghost')).toMatchObject({
    status: 'unresolved',
    reason: 'not-found'
  });
  expect(await resolver.resolve(importer, './actual.js')).toMatchObject({
    status: 'resolved',
    path: jsAliasTarget
  });
});

it('extracts only explicit AST re-exports and rejects paths resolving outside the root', async () => {
  expect(
    extractSourceReexports("export { thing } from './impl';\nexport * from './other';", 'index.ts')
  ).toEqual([
    { specifier: './impl', line: 1 },
    { specifier: './other', line: 2 }
  ]);
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
    const resolver = await InternalSourceResolver.create(root, [
      importer,
      path.join(escape, 'file.ts')
    ]);
    expect(await resolver.resolve(importer, './escape/file')).toMatchObject({
      status: 'unresolved',
      reason: 'outside-root'
    });
  }
  await fs.rm(outside, { recursive: true, force: true });
});
