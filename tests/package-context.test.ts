import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { buildContextPackage } from '../src/package-context/builder.js';
import { checkContextPackage } from '../src/package-context/check.js';
import { previewContextPackage } from '../src/package-context/preview.js';
import { rmWithRetries } from './test-helpers.js';

describe('AI context package builder', () => {
  it('builds, previews, and checks a source-linked context package', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aicp-package-'));
    const outDir = path.join(tempDir, '.context');

    try {
      await writeFixturePackage(tempDir);

      const result = await buildContextPackage({ rootPath: tempDir, outDir });
      expect(result.artifactCount).toBeGreaterThan(3);
      expect(result.publicSurfaceCount).toBeGreaterThan(0);

      await expectFile(outDir, 'manifest.json');
      await expectFile(outDir, 'README.md');
      await expectFile(outDir, 'graph/artifacts.jsonl');
      await expectFile(outDir, 'graph/public-surface.jsonl');
      await expectFile(outDir, 'packets/api-surface.json');
      await expectFile(outDir, 'provenance/source-manifest.json');

      const readme = await fs.readFile(path.join(outDir, 'README.md'), 'utf-8');
      expect(readme).toContain('BEWARE: AI-GENERATED MARKDOWN FILE');
      expect(readme).toContain('createWidget');

      const preview = await previewContextPackage(outDir);
      expect(preview.packageName).toBe('@example/widgets');
      expect(preview.topPublicSurface.some((entry) => entry.name === 'createWidget')).toBe(true);

      const check = await checkContextPackage(outDir);
      expect(check.ok).toBe(true);
      expect(check.checkedFiles).toBeGreaterThan(0);
    } finally {
      await rmWithRetries(tempDir);
    }
  });
});

async function writeFixturePackage(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'test'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: '@example/widgets',
        version: '1.0.0',
        description: 'Widget helpers for tests',
        type: 'module',
        exports: {
          '.': {
            import: './src/index.ts',
            types: './src/index.ts'
          }
        },
        types: './src/index.ts'
      },
      null,
      2
    ),
    'utf-8'
  );
  await fs.writeFile(
    path.join(root, 'README.md'),
    [
      '# Widgets',
      '',
      'Use `createWidget` for public widget construction.',
      '',
      '```ts',
      "import { createWidget } from '@example/widgets';",
      '```'
    ].join('\n'),
    'utf-8'
  );
  await fs.writeFile(
    path.join(root, 'src', 'index.ts'),
    [
      'export interface Widget {',
      '  id: string;',
      '}',
      '',
      'export function createWidget(id: string): Widget {',
      '  return { id };',
      '}'
    ].join('\n'),
    'utf-8'
  );
  await fs.writeFile(
    path.join(root, 'test', 'index.test.ts'),
    [
      "import { createWidget } from '../src/index';",
      '',
      "expect(createWidget('a').id).toBe('a');"
    ].join('\n'),
    'utf-8'
  );
}

async function expectFile(root: string, relativePath: string): Promise<void> {
  const stat = await fs.stat(path.join(root, relativePath));
  expect(stat.isFile()).toBe(true);
}
