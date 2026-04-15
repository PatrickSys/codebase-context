import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { SearchResult } from '../src/types/index.js';
import { rmWithRetries } from './test-helpers.js';

const transformersMocks = vi.hoisted(() => ({
  tokenizerFromPretrained: vi.fn(),
  modelFromPretrained: vi.fn(),
  env: { cacheDir: null as string | null }
}));

vi.mock('@huggingface/transformers', () => ({
  AutoTokenizer: {
    from_pretrained: transformersMocks.tokenizerFromPretrained
  },
  AutoModelForSequenceClassification: {
    from_pretrained: transformersMocks.modelFromPretrained
  },
  env: transformersMocks.env
}));

function makeResult(score: number, filePath: string): SearchResult {
  return {
    summary: `Result from ${filePath}`,
    snippet: 'export class Foo {}',
    filePath,
    startLine: 1,
    endLine: 10,
    score,
    language: 'typescript',
    metadata: {}
  } as SearchResult;
}

describe('reranker corruption recovery', () => {
  let tempCacheRoot: string | null = null;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    transformersMocks.tokenizerFromPretrained.mockReset();
    transformersMocks.modelFromPretrained.mockReset();
    tempCacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'reranker-cache-'));
    transformersMocks.env.cacheDir = tempCacheRoot;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleErrorSpy.mockRestore();
    transformersMocks.env.cacheDir = null;
    if (tempCacheRoot) {
      await rmWithRetries(tempCacheRoot);
      tempCacheRoot = null;
    }
  });

  it('clears corrupt cache and retries on the next same-process call', async () => {
    if (!tempCacheRoot) throw new Error('tempCacheRoot not initialized');

    const modelCacheDir = path.join(tempCacheRoot, 'Xenova', 'ms-marco-MiniLM-L-6-v2');
    await fs.mkdir(modelCacheDir, { recursive: true });
    await fs.writeFile(path.join(modelCacheDir, 'model.onnx'), 'corrupt');

    const tokenizer = vi.fn((query: string, passage: string) => ({ query, passage }));
    const model = vi.fn(async (inputs: { passage: string }) => {
      if (inputs.passage.includes('/a.ts')) return { logits: { data: [1] } };
      if (inputs.passage.includes('/b.ts')) return { logits: { data: [3] } };
      return { logits: { data: [2] } };
    });

    transformersMocks.tokenizerFromPretrained.mockResolvedValue(tokenizer);
    transformersMocks.modelFromPretrained
      .mockRejectedValueOnce(new Error('Protobuf parse failure while loading model'))
      .mockResolvedValueOnce(model);

    const { rerank, getRerankerStatus } = await import('../src/core/reranker.js');
    const results = [
      makeResult(0.85, '/a.ts'),
      makeResult(0.83, '/b.ts'),
      makeResult(0.82, '/c.ts')
    ];

    await expect(rerank('auth token', results)).rejects.toThrow(/Protobuf|parse/i);
    await expect(fs.access(modelCacheDir)).rejects.toThrow();
    expect(getRerankerStatus()).toBe('unavailable');

    const reranked = await rerank('auth token', results);
    expect(transformersMocks.tokenizerFromPretrained).toHaveBeenCalledTimes(2);
    expect(transformersMocks.modelFromPretrained).toHaveBeenCalledTimes(2);
    expect(reranked.map((result) => result.filePath)).toEqual(['/b.ts', '/c.ts', '/a.ts']);
    expect(getRerankerStatus()).toBe('active');
  });
});
