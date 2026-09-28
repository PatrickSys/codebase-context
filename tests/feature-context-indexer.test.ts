import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CODEBASE_CONTEXT_DIRNAME,
  KEYWORD_INDEX_FILENAME,
  RELATIONSHIPS_FILENAME
} from '../src/constants/codebase-context.js';
import { FeatureContextIndexSchema } from '../src/core/feature-context.js';
import { analyzerRegistry } from '../src/core/analyzer-registry.js';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { AngularAnalyzer } from '../src/analyzers/angular/index.js';
import { MAX_TREE_SITTER_PARSE_BYTES } from '../src/utils/tree-sitter.js';

interface RelationshipsFixture {
  header: { buildId: string };
  featureContexts?: unknown;
}

interface KeywordIndexFixture {
  chunks: Array<{ filePath: string }>;
}

const temporaryRoots: string[] = [];

async function createProject(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-feature-context-indexer-'));
  temporaryRoots.push(rootPath);
  await fs.mkdir(path.join(rootPath, 'src'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'tests'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'requirements'), { recursive: true });
  await fs.writeFile(
    path.join(rootPath, 'src', 'checkout.ts'),
    'export function checkoutFlow(item: string): string { return item; }\n'
  );
  await fs.writeFile(path.join(rootPath, 'tests', 'checkout.spec.ts'), 'export {};\n');
  await fs.writeFile(
    path.join(rootPath, 'requirements', 'checkout.md'),
    'Checkout must persist the cart.\n'
  );
  return rootPath;
}

function manifest(requirementId: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    attachments: [
      {
        requirementId,
        source: { path: 'requirements/checkout.md', locator: 'checkout persistence' },
        appliesTo: [{ path: 'src/checkout.ts', symbol: 'checkoutFlow' }],
        declaredTests: [{ path: 'tests/checkout.spec.ts', name: 'persists cart' }],
        evidenceReceipts: []
      }
    ]
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readSidecars(rootPath: string): Promise<{
  relationships: RelationshipsFixture;
  keywordIndex: KeywordIndexFixture;
}> {
  const contextDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
  const [relationshipsRaw, keywordRaw] = await Promise.all([
    fs.readFile(path.join(contextDir, RELATIONSHIPS_FILENAME), 'utf-8'),
    fs.readFile(path.join(contextDir, KEYWORD_INDEX_FILENAME), 'utf-8')
  ]);
  return {
    relationships: JSON.parse(relationshipsRaw) as RelationshipsFixture,
    keywordIndex: JSON.parse(keywordRaw) as KeywordIndexFixture
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => fs.rm(rootPath, { recursive: true, force: true }))
  );
});

describe('feature-context index projection', () => {
  it('resolves Angular AST-backed class identities on full and no-op indexing', async () => {
    const rootPath = await createProject();
    const angularSource = [
      "import { Component, Injectable } from '@angular/core';",
      '',
      '@Component({',
      "  selector: 'app-checkout',",
      "  template: '<div></div>'",
      '})',
      'export class CheckoutComponent {',
      '  submit(): void {}',
      '}',
      '',
      "@Injectable({ providedIn: 'root' })",
      'export class CheckoutService {',
      '  checkout(): void {}',
      '}'
    ].join('\n');
    await fs.writeFile(path.join(rootPath, 'src', 'checkout.ts'), angularSource);
    const angularManifest = JSON.parse(manifest('checkout-classes')) as {
      attachments: Array<{
        appliesTo: Array<{ path: string; symbol: string }>;
      }>;
    };
    angularManifest.attachments[0]!.appliesTo = [
      { path: 'src/checkout.ts', symbol: 'CheckoutComponent' },
      { path: 'src/checkout.ts', symbol: 'CheckoutService' }
    ];
    await fs.writeFile(
      path.join(rootPath, 'checkout.context.json'),
      JSON.stringify(angularManifest)
    );

    const previousAngularAnalyzer = analyzerRegistry.get('angular');
    analyzerRegistry.register(new AngularAnalyzer());
    try {
      await new CodebaseIndexer({ rootPath, config: { skipEmbedding: true } }).index();
      const first = await readSidecars(rootPath);
      const firstProjection = FeatureContextIndexSchema.parse(first.relationships.featureContexts);
      expect(firstProjection.attachments[0]?.appliesTo).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target: { path: 'src/checkout.ts', symbol: 'CheckoutComponent' },
            status: 'resolved',
            identity: {
              path: 'src/checkout.ts',
              name: 'CheckoutComponent',
              startLine: 7,
              endLine: 9
            }
          }),
          expect.objectContaining({
            target: { path: 'src/checkout.ts', symbol: 'CheckoutService' },
            status: 'resolved',
            identity: {
              path: 'src/checkout.ts',
              name: 'CheckoutService',
              startLine: 12,
              endLine: 14
            }
          })
        ])
      );

      await new CodebaseIndexer({
        rootPath,
        incrementalOnly: true,
        config: { skipEmbedding: true }
      }).index();
      const refreshed = await readSidecars(rootPath);
      const refreshedProjection = FeatureContextIndexSchema.parse(
        refreshed.relationships.featureContexts
      );
      expect(refreshed.relationships.header.buildId).toBe(first.relationships.header.buildId);
      expect(refreshedProjection.attachments[0]?.appliesTo).toEqual(
        firstProjection.attachments[0]?.appliesTo
      );

      await fs.writeFile(
        path.join(rootPath, 'src', 'checkout.ts'),
        `${angularSource}\nexport class CheckoutComponent {}\n`
      );
      await new CodebaseIndexer({
        rootPath,
        incrementalOnly: true,
        config: { skipEmbedding: true }
      }).index();
      const duplicate = await readSidecars(rootPath);
      const duplicateProjection = FeatureContextIndexSchema.parse(
        duplicate.relationships.featureContexts
      );
      expect(
        duplicateProjection.attachments[0]?.appliesTo.find(
          (target) => target.target.symbol === 'CheckoutComponent'
        )?.status
      ).toBe('ambiguous');
      expect(
        duplicateProjection.attachments[0]?.diagnostics.some(
          (entry) => entry.code === 'ambiguous-target' && entry.path === 'src/checkout.ts'
        )
      ).toBe(true);
    } finally {
      if (previousAngularAnalyzer) analyzerRegistry.register(previousAngularAnalyzer);
      else analyzerRegistry.unregister('angular');
    }
  });

  it('marks same-line duplicate declarations ambiguous and unsupported binding collisions non-green', async () => {
    const rootPath = await createProject();
    await fs.writeFile(
      path.join(rootPath, 'src', 'duplicates.ts'),
      'export class DuplicateComponent {} export class DuplicateComponent {}\n'
    );
    await fs.writeFile(
      path.join(rootPath, 'src', 'binding.ts'),
      'const BoundComponent = 1;\nexport class BoundComponent {}\n'
    );
    await fs.writeFile(
      path.join(rootPath, 'src', 'import-binding.ts'),
      "import { ImportedComponent } from './other';\nexport class ImportedComponent {}\n"
    );
    await fs.writeFile(
      path.join(rootPath, 'src', 'bare-arrow-binding.ts'),
      'export class BareArrowComponent {}\nconst use = BareArrowComponent => BareArrowComponent;\n'
    );
    await fs.writeFile(
      path.join(rootPath, 'src', 'large.ts'),
      `export class LargeComponent {}\n${' '.repeat(MAX_TREE_SITTER_PARSE_BYTES)}`
    );
    await fs.writeFile(
      path.join(rootPath, 'src', 'example.py'),
      'def render_checkout():\n    return "checkout"\n'
    );
    const attachment = (requirementId: string, targetPath: string, symbol?: string) => ({
      requirementId,
      source: { path: 'requirements/checkout.md', locator: requirementId },
      appliesTo: [symbol ? { path: targetPath, symbol } : { path: targetPath }],
      declaredTests: [],
      evidenceReceipts: []
    });
    await fs.writeFile(
      path.join(rootPath, 'symbols.context.json'),
      JSON.stringify({
        schemaVersion: 1,
        attachments: [
          attachment('DUPLICATE', 'src/duplicates.ts', 'DuplicateComponent'),
          attachment('BINDING', 'src/binding.ts', 'BoundComponent'),
          attachment('IMPORT', 'src/import-binding.ts', 'ImportedComponent'),
          attachment('BARE_ARROW', 'src/bare-arrow-binding.ts', 'BareArrowComponent'),
          attachment('LARGE', 'src/large.ts', 'LargeComponent'),
          attachment('PYTHON_SYMBOL', 'src/example.py', 'render_checkout'),
          attachment('PYTHON_FILE', 'src/example.py')
        ]
      })
    );

    await new CodebaseIndexer({ rootPath, config: { skipEmbedding: true } }).index();
    const sidecars = await readSidecars(rootPath);
    const projection = FeatureContextIndexSchema.parse(sidecars.relationships.featureContexts);
    const duplicate = projection.attachments.find((item) => item.requirementId === 'DUPLICATE');
    const binding = projection.attachments.find((item) => item.requirementId === 'BINDING');
    const imported = projection.attachments.find((item) => item.requirementId === 'IMPORT');
    const bareArrow = projection.attachments.find((item) => item.requirementId === 'BARE_ARROW');
    const large = projection.attachments.find((item) => item.requirementId === 'LARGE');
    const pythonSymbol = projection.attachments.find(
      (item) => item.requirementId === 'PYTHON_SYMBOL'
    );
    const pythonFile = projection.attachments.find((item) => item.requirementId === 'PYTHON_FILE');

    expect(duplicate?.appliesTo[0]?.status).toBe('ambiguous');
    expect(binding?.appliesTo[0]?.status).toBe('unsupported');
    expect(binding?.appliesTo[0]?.identity?.name).toBe('BoundComponent');
    expect(imported?.appliesTo[0]?.status).toBe('unsupported');
    expect(bareArrow?.appliesTo[0]?.status).toBe('unsupported');
    expect(large?.appliesTo[0]?.status).toBe('unsupported');
    expect(pythonSymbol?.appliesTo[0]?.status).toBe('unsupported');
    expect(pythonFile?.appliesTo[0]?.status).toBe('resolved');
  });

  it('refreshes added, edited, and deleted manifests on an unchanged source index', async () => {
    const rootPath = await createProject();
    const firstManifest = path.join(rootPath, 'checkout.context.json');
    const secondManifest = path.join(rootPath, 'cart.context.json');
    await fs.writeFile(firstManifest, manifest('checkout-original'));

    await new CodebaseIndexer({ rootPath, config: { skipEmbedding: true } }).index();
    const first = await readSidecars(rootPath);
    const firstProjection = FeatureContextIndexSchema.parse(first.relationships.featureContexts);
    const firstAttachment = firstProjection.attachments[0];
    expect(firstAttachment?.requirementId).toBe('checkout-original');
    expect(firstAttachment?.appliesTo[0]).toMatchObject({
      target: { path: 'src/checkout.ts', symbol: 'checkoutFlow' },
      status: 'resolved',
      identity: { path: 'src/checkout.ts', name: 'checkoutFlow' }
    });
    expect(
      first.keywordIndex.chunks.some((chunk) => chunk.filePath.endsWith('checkout.context.json'))
    ).toBe(false);

    await fs.writeFile(firstManifest, manifest('checkout-updated'));
    await fs.writeFile(secondManifest, manifest('cart-requirement'));
    const incrementalIndexer = new CodebaseIndexer({
      rootPath,
      incrementalOnly: true,
      config: { skipEmbedding: true }
    });
    await incrementalIndexer.index();
    const afterAddAndEdit = await readSidecars(rootPath);
    const editedProjection = FeatureContextIndexSchema.parse(
      afterAddAndEdit.relationships.featureContexts
    );
    expect(afterAddAndEdit.relationships.header.buildId).toBe(first.relationships.header.buildId);
    expect(
      editedProjection.attachments.map((attachment) => attachment.requirementId).sort()
    ).toEqual(['cart-requirement', 'checkout-updated']);

    await fs.rm(secondManifest);
    await incrementalIndexer.index();
    const afterDelete = await readSidecars(rootPath);
    const deletedProjection = FeatureContextIndexSchema.parse(
      afterDelete.relationships.featureContexts
    );
    expect(afterDelete.relationships.header.buildId).toBe(first.relationships.header.buildId);
    expect(deletedProjection.attachments.map((attachment) => attachment.requirementId)).toEqual([
      'checkout-updated'
    ]);
  });

  it('honors gitignore and preserves invalid manifests as non-green diagnostics', async () => {
    const rootPath = await createProject();
    await fs.writeFile(path.join(rootPath, '.gitignore'), 'ignored.context.json\n');
    await fs.writeFile(path.join(rootPath, 'ignored.context.json'), manifest('ignored'));
    await fs.writeFile(
      path.join(rootPath, 'invalid.context.json'),
      JSON.stringify({ schemaVersion: 1, unknown: true, attachments: [] })
    );

    await new CodebaseIndexer({ rootPath, config: { skipEmbedding: true } }).index();
    const { relationships } = await readSidecars(rootPath);
    const projection = FeatureContextIndexSchema.parse(relationships.featureContexts);
    expect(projection.attachments).toEqual([]);
    expect(projection.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid-manifest' })])
    );
  });

  it('keeps explicitly attached receipts and their reports out of source chunks', async () => {
    const rootPath = await createProject();
    const report = JSON.stringify({ passed: true });
    await fs.mkdir(path.join(rootPath, 'evidence'), { recursive: true });
    await fs.writeFile(path.join(rootPath, 'evidence', 'report.json'), report);
    await fs.writeFile(
      path.join(rootPath, 'evidence', 'capture.json'),
      JSON.stringify({
        schemaVersion: 1,
        runner: 'vitest',
        runId: 'run-01',
        test: { path: 'tests/checkout.spec.ts', name: 'persists cart' },
        outcome: 'passed',
        code: { commit: 'a'.repeat(40), clean: true },
        source: {
          path: 'requirements/checkout.md',
          sha256: sha256('Checkout must persist the cart.\n')
        },
        environment: { node: process.version, os: process.platform },
        report: { path: 'evidence/report.json', sha256: sha256(report) }
      })
    );
    const attachedManifest = JSON.parse(manifest('checkout-with-proof')) as {
      attachments: Array<{ evidenceReceipts: string[] }>;
    };
    attachedManifest.attachments[0]!.evidenceReceipts = ['evidence/capture.json'];
    await fs.writeFile(
      path.join(rootPath, 'checkout.context.json'),
      JSON.stringify(attachedManifest)
    );

    await new CodebaseIndexer({ rootPath, config: { skipEmbedding: true } }).index();
    const { keywordIndex } = await readSidecars(rootPath);
    const indexedPaths = keywordIndex.chunks.map((chunk) => chunk.filePath.replace(/\\/g, '/'));
    expect(indexedPaths.some((filePath) => filePath.endsWith('/evidence/capture.json'))).toBe(
      false
    );
    expect(indexedPaths.some((filePath) => filePath.endsWith('/evidence/report.json'))).toBe(false);
  });

  it('does not follow an external .codebase-context junction during a no-change refresh', async () => {
    const rootPath = await createProject();
    await new CodebaseIndexer({ rootPath, config: { skipEmbedding: true } }).index();

    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-external-index-artifacts-'));
    temporaryRoots.push(externalDir);
    const externalSidecar = path.join(externalDir, RELATIONSHIPS_FILENAME);
    const sentinel = 'leave external sidecar untouched';
    await fs.writeFile(externalSidecar, sentinel);

    const contextDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
    await fs.rm(contextDir, { recursive: true, force: true });
    await fs.symlink(externalDir, contextDir, 'junction');

    const incrementalIndexer = new CodebaseIndexer({
      rootPath,
      incrementalOnly: true,
      config: { skipEmbedding: true }
    });
    await expect(incrementalIndexer.index()).rejects.toThrow(
      /linked or non-directory index artifact/i
    );
    expect(await fs.readFile(externalSidecar, 'utf-8')).toBe(sentinel);
  });
});
