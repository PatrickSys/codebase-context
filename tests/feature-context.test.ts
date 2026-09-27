import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compileFeatureContexts,
  FeatureContextIndexSchema,
  FeatureContextManifestSchema,
  parseFeatureContextManifest,
  queryFeatureContext,
  type CapturedRunReceipt,
  type FeatureContextManifest,
  type IndexedSymbolRef
} from '../src/core/feature-context.js';

const COMMIT = 'a'.repeat(40);
const SHA256 = /^[a-f0-9]{64}$/;

async function writeFile(rootPath: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(rootPath, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
}

async function digest(rootPath: string, relativePath: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const bytes = await fs.readFile(path.join(rootPath, ...relativePath.split('/')));
  return createHash('sha256').update(bytes).digest('hex');
}

function manifest(receiptPaths: string[] = []): FeatureContextManifest {
  return {
    schemaVersion: 1,
    attachments: [
      {
        requirementId: 'CART-17',
        source: { path: 'requirements/checkout.yaml', locator: 'requirements[2]' },
        appliesTo: [
          { path: 'src/cart.ts', symbol: 'CartComponent' },
          { path: 'src/cart-template.ts' }
        ],
        declaredTests: [{ path: 'tests/cart.spec.ts', name: 'checkout succeeds' }],
        evidenceReceipts: receiptPaths
      }
    ]
  };
}

async function createFixture(
  rootPath: string,
  options: { outcome?: 'passed' | 'failed' | 'skipped' } = {}
) {
  await writeFile(rootPath, 'requirements/checkout.yaml', 'id: CART-17\ntext: checkout succeeds\n');
  await writeFile(rootPath, 'src/cart.ts', 'export class CartComponent {}\n');
  await writeFile(rootPath, 'src/cart-template.ts', '<button>Checkout</button>\n');
  await writeFile(rootPath, 'src/shared-store.ts', 'export class SharedStore {}\n');
  await writeFile(rootPath, 'tests/cart.spec.ts', 'test("checkout succeeds", () => {});\n');
  await writeFile(rootPath, 'test-results/report.json', '{"passed":true}\n');
  const receiptPath = 'test-results/checkout.receipt.json';
  const receipt: CapturedRunReceipt = {
    schemaVersion: 1,
    runner: 'vitest',
    runId: 'run-1',
    test: { path: 'tests/cart.spec.ts', name: 'checkout succeeds' },
    outcome: options.outcome ?? 'passed',
    code: { commit: COMMIT, clean: true },
    source: {
      path: 'requirements/checkout.yaml',
      sha256: await digest(rootPath, 'requirements/checkout.yaml')
    },
    environment: { node: process.version, os: process.platform },
    report: {
      path: 'test-results/report.json',
      sha256: await digest(rootPath, 'test-results/report.json')
    }
  };
  await writeFile(rootPath, receiptPath, JSON.stringify(receipt));
  const manifestPath = 'checkout.context.json';
  const manifestText = JSON.stringify(manifest([receiptPath]));
  await writeFile(rootPath, manifestPath, manifestText);
  const indexedSymbols: IndexedSymbolRef[] = [
    { path: 'src/cart.ts', name: 'CartComponent', startLine: 1, endLine: 1 },
    { path: 'src/shared-store.ts', name: 'SharedStore', startLine: 1, endLine: 1 }
  ];
  const index = await compileFeatureContexts({
    rootPath,
    manifestFiles: [{ path: manifestPath, text: manifestText }],
    receiptFiles: [{ path: receiptPath, text: JSON.stringify(receipt) }],
    indexedSymbols,
    codeCommit: COMMIT,
    codeIsClean: true,
    ignoredPaths: ['test-results/**']
  });
  return { index, indexedSymbols, manifestPath, receiptPath, receipt };
}

describe('feature context core', () => {
  let rootPath: string;
  let outsidePath: string;

  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-feature-context-'));
    outsidePath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-feature-context-outside-'));
  });

  afterEach(async () => {
    await fs.rm(rootPath, { recursive: true, force: true });
    await fs.rm(outsidePath, { recursive: true, force: true });
  });

  it('uses strict manifest and receipt schemas and rejects path escapes', () => {
    expect(
      FeatureContextManifestSchema.safeParse({
        ...manifest(),
        unexpected: true
      }).success
    ).toBe(false);
    expect(
      FeatureContextManifestSchema.safeParse({
        schemaVersion: 1,
        attachments: [
          {
            ...manifest().attachments[0],
            source: { path: '../secret.yaml', locator: 'x' }
          }
        ]
      }).success
    ).toBe(false);
    expect(parseFeatureContextManifest('checkout.context.json', '{bad').manifest).toBeUndefined();
    expect(SHA256.test('a'.repeat(64))).toBe(true);
  });

  it('turns an unsafe manifest discovery path into a diagnostic instead of throwing', async () => {
    const index = await compileFeatureContexts({
      rootPath,
      manifestFiles: [{ path: '../outside.context.json', text: '{}' }],
      receiptFiles: [],
      indexedSymbols: [],
      codeCommit: COMMIT,
      codeIsClean: true,
      ignoredPaths: []
    });
    expect(index.diagnostics[0]?.code).toBe('invalid-manifest');
  });

  it('compiles valid data with exact symbol tuples and returns only explicitly scoped targets', async () => {
    const { index } = await createFixture(rootPath);
    expect(FeatureContextIndexSchema.safeParse(index).success).toBe(true);
    expect(index.attachments[0]?.appliesTo[0]?.identity).toEqual({
      path: 'src/cart.ts',
      name: 'CartComponent',
      startLine: 1,
      endLine: 1
    });

    const cart = await queryFeatureContext({
      rootPath,
      index,
      target: { path: 'src/cart.ts', symbol: 'CartComponent' },
      currentGit: { commit: COMMIT, isClean: true }
    });
    expect(cart.matches).toHaveLength(1);
    expect(cart.matches[0]?.recordedEvidence[0]?.fresh).toBe(true);
    expect(cart.matches[0]?.source.current).toBe(true);

    const sharedService = await queryFeatureContext({
      rootPath,
      index,
      target: { path: 'src/shared-store.ts', symbol: 'SharedStore' },
      currentGit: { commit: COMMIT, isClean: true }
    });
    expect(sharedService.matches).toHaveLength(0);
  });

  it('marks evidence stale when any referenced bytes change after indexing', async () => {
    const { index } = await createFixture(rootPath);
    await writeFile(rootPath, 'requirements/checkout.yaml', 'id: CART-17\ntext: changed\n');
    await writeFile(rootPath, 'src/cart.ts', 'export class CartComponent { changed = true; }\n');
    await writeFile(rootPath, 'tests/cart.spec.ts', 'test("changed", () => {});\n');
    await writeFile(rootPath, 'test-results/report.json', '{"passed":false}\n');

    const reply = await queryFeatureContext({
      rootPath,
      index,
      target: { path: 'src/cart.ts', symbol: 'CartComponent' },
      currentGit: { commit: COMMIT, isClean: true }
    });
    const match = reply.matches[0];
    expect(match?.source.current).toBe(false);
    expect(match?.appliesTo[0]?.current).toBe(false);
    expect(match?.declaredTests[0]?.current).toBe(false);
    expect(match?.recordedEvidence[0]?.fresh).toBe(false);
    expect(match?.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['stale-source', 'stale-target', 'stale-test', 'stale-evidence'])
    );
  });

  it('requires the same clean Git commit and a passed captured result', async () => {
    const { index } = await createFixture(rootPath);
    const dirty = await queryFeatureContext({
      rootPath,
      index,
      target: { path: 'src/cart.ts' },
      currentGit: { commit: COMMIT, isClean: false }
    });
    expect(dirty.matches[0]?.recordedEvidence[0]?.fresh).toBe(false);
    expect(dirty.diagnostics.some((entry) => entry.code === 'dirty-code')).toBe(true);

    const otherCommit = await queryFeatureContext({
      rootPath,
      index,
      target: { path: 'src/cart.ts' },
      currentGit: { commit: 'b'.repeat(40), isClean: true }
    });
    expect(otherCommit.matches[0]?.recordedEvidence[0]?.fresh).toBe(false);

    await fs.rm(rootPath, { recursive: true, force: true });
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-feature-context-failed-'));
    const failed = await createFixture(rootPath, { outcome: 'failed' });
    const failedReply = await queryFeatureContext({
      rootPath,
      index: failed.index,
      target: { path: 'src/cart.ts' },
      currentGit: { commit: COMMIT, isClean: true }
    });
    expect(failedReply.matches[0]?.recordedEvidence[0]?.fresh).toBe(false);
    expect(
      failedReply.matches[0]?.recordedEvidence[0]?.diagnostics.some(
        (entry) => entry.code === 'run-not-passed'
      )
    ).toBe(true);
  });

  it('revalidates the manifest and receipt files after indexing', async () => {
    const { index, manifestPath, receiptPath, receipt } = await createFixture(rootPath);
    await writeFile(rootPath, manifestPath, JSON.stringify({ ...manifest(), changed: true }));
    await writeFile(rootPath, receiptPath, JSON.stringify({ ...receipt, runId: 'run-replaced' }));

    const reply = await queryFeatureContext({
      rootPath,
      index,
      target: { path: 'src/cart.ts' },
      currentGit: { commit: COMMIT, isClean: true }
    });
    expect(reply.matches[0]?.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['stale-manifest', 'stale-evidence'])
    );
    expect(reply.matches[0]?.recordedEvidence[0]?.fresh).toBe(false);
  });

  it('fails closed when receipt preload bytes differ from the file or attachment binding', async () => {
    const fixture = await createFixture(rootPath);
    const manifestText = await fs.readFile(path.join(rootPath, fixture.manifestPath), 'utf8');
    const stalePreload = JSON.stringify({ ...fixture.receipt, runId: 'preload-version' });
    const staleIndex = await compileFeatureContexts({
      rootPath,
      manifestFiles: [{ path: fixture.manifestPath, text: manifestText }],
      receiptFiles: [{ path: fixture.receiptPath, text: stalePreload }],
      indexedSymbols: fixture.indexedSymbols,
      codeCommit: COMMIT,
      codeIsClean: true,
      ignoredPaths: ['test-results/**']
    });
    expect(staleIndex.attachments[0]?.recordedEvidence[0]?.receipt).toBeUndefined();
    const stalePreloadReply = await queryFeatureContext({
      rootPath,
      index: staleIndex,
      target: { path: 'src/cart.ts' },
      currentGit: { commit: COMMIT, isClean: true }
    });
    expect(stalePreloadReply.matches[0]?.recordedEvidence[0]?.fresh).toBe(false);

    await writeFile(rootPath, 'requirements/other.yaml', 'id: OTHER\n');
    await writeFile(rootPath, 'tests/other.spec.ts', 'test("other", () => {});\n');
    const mismatchedReceipt = {
      ...fixture.receipt,
      test: { path: 'tests/other.spec.ts', name: 'other' },
      source: {
        path: 'requirements/other.yaml',
        sha256: await digest(rootPath, 'requirements/other.yaml')
      }
    };
    await writeFile(rootPath, fixture.receiptPath, JSON.stringify(mismatchedReceipt));
    const mismatchedIndex = await compileFeatureContexts({
      rootPath,
      manifestFiles: [{ path: fixture.manifestPath, text: manifestText }],
      receiptFiles: [{ path: fixture.receiptPath, text: JSON.stringify(mismatchedReceipt) }],
      indexedSymbols: fixture.indexedSymbols,
      codeCommit: COMMIT,
      codeIsClean: true,
      ignoredPaths: ['test-results/**']
    });
    expect(
      mismatchedIndex.attachments[0]?.recordedEvidence[0]?.diagnostics.filter(
        (entry) => entry.code === 'invalid-receipt'
      )
    ).toHaveLength(2);
    const mismatchedReply = await queryFeatureContext({
      rootPath,
      index: mismatchedIndex,
      target: { path: 'src/cart.ts' },
      currentGit: { commit: COMMIT, isClean: true }
    });
    expect(mismatchedReply.matches[0]?.recordedEvidence[0]?.fresh).toBe(false);
  });

  it('reports ambiguous same-name symbols instead of selecting one', async () => {
    const fixture = await createFixture(rootPath);
    const ambiguous = await compileFeatureContexts({
      rootPath,
      manifestFiles: [
        { path: fixture.manifestPath, text: JSON.stringify(manifest([fixture.receiptPath])) }
      ],
      receiptFiles: [{ path: fixture.receiptPath, text: JSON.stringify(fixture.receipt) }],
      indexedSymbols: [
        { path: 'src/cart.ts', name: 'CartComponent', startLine: 1, endLine: 1 },
        { path: 'src/cart.ts', name: 'CartComponent', startLine: 8, endLine: 12 }
      ],
      codeCommit: COMMIT,
      codeIsClean: true,
      ignoredPaths: ['test-results/**']
    });
    expect(ambiguous.attachments[0]?.appliesTo[0]?.status).toBe('ambiguous');
    expect(
      ambiguous.attachments[0]?.diagnostics.some((entry) => entry.code === 'ambiguous-target')
    ).toBe(true);
  });

  it('rejects symlink escapes and does not serialize external file contents', async () => {
    await writeFile(outsidePath, 'secret.yaml', 'outside authority');
    const linkPath = path.join(rootPath, 'requirements');
    try {
      await fs.symlink(outsidePath, linkPath, 'junction');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') return;
      throw error;
    }
    await writeFile(rootPath, 'src/cart.ts', 'export class CartComponent {}\n');
    await writeFile(rootPath, 'tests/cart.spec.ts', 'test("checkout succeeds", () => {});\n');
    const manifestText = JSON.stringify({
      schemaVersion: 1,
      attachments: [
        {
          ...manifest().attachments[0],
          source: { path: 'requirements/secret.yaml', locator: 'secret' },
          evidenceReceipts: []
        }
      ]
    });
    await writeFile(rootPath, 'checkout.context.json', manifestText);
    const index = await compileFeatureContexts({
      rootPath,
      manifestFiles: [{ path: 'checkout.context.json', text: manifestText }],
      receiptFiles: [],
      indexedSymbols: [{ path: 'src/cart.ts', name: 'CartComponent', startLine: 1, endLine: 1 }],
      codeCommit: COMMIT,
      codeIsClean: true,
      ignoredPaths: []
    });
    expect(index.attachments[0]?.source.sha256).toBeUndefined();
    expect(JSON.stringify(index)).not.toContain('outside authority');
    expect(
      index.attachments[0]?.diagnostics.some((entry) => entry.code === 'path-outside-root')
    ).toBe(true);
  });

  it('bounds output and reports omitted matches rather than cutting records', async () => {
    const fixture = await createFixture(rootPath);
    const expanded = {
      ...fixture.index,
      attachments: [...fixture.index.attachments, ...fixture.index.attachments]
    };
    const reply = await queryFeatureContext({
      rootPath,
      index: expanded,
      target: { path: 'src/cart.ts' },
      currentGit: { commit: COMMIT, isClean: true },
      tokenLimit: 100
    });
    expect(reply.counts.matches).toBe(2);
    expect(reply.counts.omitted).toBeGreaterThan(0);
    expect(reply.truncated).toBe(true);
    expect(reply.diagnostics.some((entry) => entry.code === 'matches-omitted')).toBe(true);
    expect(FeatureContextIndexSchema.safeParse(expanded).success).toBe(true);
  });

  it('caps diagnostic text and arrays while preserving exact omission counts', async () => {
    const fixture = await createFixture(rootPath);
    const noisy = {
      ...fixture.index,
      diagnostics: Array.from({ length: 1000 }, () => ({
        code: 'invalid-manifest' as const,
        path: 'checkout.context.json',
        message: 'x'.repeat(160)
      }))
    };
    const reply = await queryFeatureContext({
      rootPath,
      index: noisy,
      target: { path: 'src/cart.ts' },
      currentGit: { commit: COMMIT, isClean: true }
    });
    expect(reply.diagnostics.length).toBeLessThanOrEqual(8);
    expect(reply.diagnostics.every((entry) => entry.message.length <= 160)).toBe(true);
    expect(reply.diagnostics.some((entry) => entry.code === 'diagnostics-truncated')).toBe(true);
    expect(reply.counts.omittedDiagnostics).toBeGreaterThan(0);
    expect(Math.ceil(JSON.stringify(reply).length / 3)).toBeLessThanOrEqual(900);
  });
});
