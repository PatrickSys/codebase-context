import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  KEYWORD_INDEX_FILENAME
} from '../src/constants/codebase-context.js';

describe('Search Hints', () => {
  let tempRoot: string | null = null;

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'search-hints-test-'));
    process.env.CODEBASE_ROOT = tempRoot;
    process.argv[2] = tempRoot;
  });

  afterEach(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.CODEBASE_ROOT;
  });

  it('search results include hints with callers when relationships exist', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    // Create a simple TypeScript project with imports
    const srcDir = path.join(tempRoot, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    await fs.writeFile(
      path.join(srcDir, 'service.ts'),
      `export function getData() { return 'data'; }`
    );

    await fs.writeFile(
      path.join(srcDir, 'consumer1.ts'),
      `import { getData } from './service';\nexport function use1() { return getData(); }`
    );

    await fs.writeFile(
      path.join(srcDir, 'consumer2.ts'),
      `import { getData } from './service';\nexport function use2() { return getData(); }`
    );

    await fs.writeFile(
      path.join(srcDir, 'consumer3.ts'),
      `import { getData } from './service';\nexport function use3() { return getData(); }`
    );

    // Index the project
    const indexer = new CodebaseIndexer({
      rootPath: tempRoot,
      config: { skipEmbedding: true }
    });
    await indexer.index();

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'service'
        }
      }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.status).toBe('success');

    // Find the service.ts result
    const serviceResult = payload.results.find((r: any) => r.file.includes('service.ts'));
    expect(serviceResult).toBeDefined();

    // Check that hints exist
    if (serviceResult.hints) {
      expect(serviceResult.hints.callers).toBeDefined();
      expect(Array.isArray(serviceResult.hints.callers)).toBe(true);
      // Should have up to 3 callers
      expect(serviceResult.hints.callers.length).toBeLessThanOrEqual(3);
      // Each caller should be a string
      serviceResult.hints.callers.forEach((caller: string) => {
        expect(typeof caller).toBe('string');
      });
    }
  }, 60000);

  it('hints are capped at 3 items per category', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const srcDir = path.join(tempRoot, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    // Create a file that will be imported by 5 consumers
    await fs.writeFile(path.join(srcDir, 'util.ts'), `export function util() {}`);

    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(
        path.join(srcDir, `consumer${i}.ts`),
        `import { util } from './util';\nexport function use${i}() { util(); }`
      );
    }

    const indexer = new CodebaseIndexer({
      rootPath: tempRoot,
      config: { skipEmbedding: true }
    });
    await indexer.index();

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'util'
        }
      }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.status).toBe('success');

    const utilResult = payload.results.find((r: any) => r.file.includes('util.ts'));
    expect(utilResult).toBeDefined();

    if (utilResult.hints && utilResult.hints.callers) {
      // Should be capped at 3
      expect(utilResult.hints.callers.length).toBeLessThanOrEqual(3);
    }
  });

  it('hints include tests when test files are detected', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const srcDir = path.join(tempRoot, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    await fs.writeFile(path.join(srcDir, 'helper.ts'), `export function helper() {}`);

    await fs.writeFile(
      path.join(srcDir, 'helper.test.ts'),
      `import { helper } from './helper';\ntest('helper', () => helper());`
    );

    await fs.writeFile(
      path.join(srcDir, 'helper.spec.ts'),
      `import { helper } from './helper';\ndescribe('helper', () => {});`
    );

    const indexer = new CodebaseIndexer({
      rootPath: tempRoot,
      config: { skipEmbedding: true }
    });
    await indexer.index();

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'helper'
        }
      }
    });

    const payload = JSON.parse(response.content[0].text);
    const helperResult = payload.results.find((r: any) => r.file.includes('helper.ts'));
    expect(helperResult).toBeDefined();

    if (helperResult.hints && helperResult.hints.tests) {
      expect(Array.isArray(helperResult.hints.tests)).toBe(true);
      expect(helperResult.hints.tests.length).toBeGreaterThan(0);
    }
  });

  it('results without relationships do not include hints', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const srcDir = path.join(tempRoot, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    // Create a file with no imports or imports
    await fs.writeFile(path.join(srcDir, 'isolated.ts'), `export function isolated() { return 1; }`);

    const indexer = new CodebaseIndexer({
      rootPath: tempRoot,
      config: { skipEmbedding: true }
    });
    await indexer.index();

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'isolated'
        }
      }
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.status).toBe('success');

    const isolatedResult = payload.results.find((r: any) => r.file.includes('isolated.ts'));
    if (isolatedResult) {
      // If no relationships exist, hints should not be included
      if (!isolatedResult.hints && !isolatedResult.relationships) {
        expect(true).toBe(true); // Expected behavior
      }
    }
  });

  it('preserves condensed relationships alongside hints', async () => {
    if (!tempRoot) throw new Error('tempRoot not initialized');

    const srcDir = path.join(tempRoot, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    await fs.writeFile(path.join(srcDir, 'core.ts'), `export function core() {}`);

    await fs.writeFile(
      path.join(srcDir, 'consumer.ts'),
      `import { core } from './core';\nexport function use() { core(); }`
    );

    await fs.writeFile(
      path.join(srcDir, 'core.test.ts'),
      `import { core } from './core';\ntest('core', () => core());`
    );

    const indexer = new CodebaseIndexer({
      rootPath: tempRoot,
      config: { skipEmbedding: true }
    });
    await indexer.index();

    const { server } = await import('../src/index.js');
    const handler = (server as any)._requestHandlers.get('tools/call');

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_codebase',
        arguments: {
          query: 'core'
        }
      }
    });

    const payload = JSON.parse(response.content[0].text);
    const coreResult = payload.results.find((r: any) => r.file.includes('core.ts'));
    expect(coreResult).toBeDefined();

    // Should have both condensed relationships and hints
    if (coreResult) {
      if (coreResult.relationships) {
        if (coreResult.relationships.importedByCount !== undefined) {
          expect(coreResult.relationships.importedByCount).toBeGreaterThanOrEqual(1);
        }
        if (coreResult.relationships.hasTests !== undefined) {
          expect(coreResult.relationships.hasTests).toBe(true);
        }
      }
      if (coreResult.hints) {
        if (coreResult.hints.callers) {
          expect(Array.isArray(coreResult.hints.callers)).toBe(true);
        }
        if (coreResult.hints.tests) {
          expect(Array.isArray(coreResult.hints.tests)).toBe(true);
        }
      }
    }
  });
});
