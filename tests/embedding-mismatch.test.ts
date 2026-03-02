import { describe, it, expect } from 'vitest';
import { checkEmbeddingMismatch } from '../src/core/index-meta.js';
import type { IndexMeta } from '../src/core/index-meta.js';
import { getConfiguredDimensions } from '../src/embeddings/index.js';

function makeMeta(overrides: {
  embeddingProvider?: string;
  embeddingModel?: string;
}): IndexMeta {
  return {
    metaVersion: 1,
    formatVersion: 1,
    buildId: 'test-build',
    generatedAt: new Date().toISOString(),
    toolVersion: '1.8.0',
    artifacts: {
      keywordIndex: { path: 'keyword-index.json' },
      vectorDb: {
        path: 'vector-db',
        provider: 'lancedb',
        ...overrides
      }
    }
  };
}

describe('checkEmbeddingMismatch', () => {
  it('returns false for legacy meta with no embeddingProvider or embeddingModel', () => {
    const meta = makeMeta({});
    expect(checkEmbeddingMismatch(meta, 'transformers', 'Xenova/bge-small-en-v1.5')).toBe(false);
  });

  it('returns false when provider and model match', () => {
    const meta = makeMeta({
      embeddingProvider: 'transformers',
      embeddingModel: 'Xenova/bge-small-en-v1.5'
    });
    expect(checkEmbeddingMismatch(meta, 'transformers', 'Xenova/bge-small-en-v1.5')).toBe(false);
  });

  it('returns true when provider differs', () => {
    const meta = makeMeta({
      embeddingProvider: 'transformers',
      embeddingModel: 'Xenova/bge-small-en-v1.5'
    });
    expect(checkEmbeddingMismatch(meta, 'openai', 'Xenova/bge-small-en-v1.5')).toBe(true);
  });

  it('returns true when model differs', () => {
    const meta = makeMeta({
      embeddingProvider: 'transformers',
      embeddingModel: 'Xenova/bge-small-en-v1.5'
    });
    expect(
      checkEmbeddingMismatch(meta, 'transformers', 'onnx-community/granite-embedding-small-english-r2-ONNX')
    ).toBe(true);
  });

  it('returns true when both provider and model differ', () => {
    const meta = makeMeta({
      embeddingProvider: 'transformers',
      embeddingModel: 'Xenova/bge-small-en-v1.5'
    });
    expect(checkEmbeddingMismatch(meta, 'openai', 'text-embedding-3-small')).toBe(true);
  });
});

describe('getConfiguredDimensions', () => {
  it('returns 384 for default bge-small model', () => {
    expect(getConfiguredDimensions({ provider: 'transformers', model: 'Xenova/bge-small-en-v1.5' })).toBe(384);
  });

  it('returns 768 for bge-base-en-v1.5 (not 384)', () => {
    // This is the correctness regression: bge-base is 768 dims, not 384
    expect(getConfiguredDimensions({ provider: 'transformers', model: 'Xenova/bge-base-en-v1.5' })).toBe(768);
  });

  it('returns 384 for Granite small model', () => {
    expect(
      getConfiguredDimensions({
        provider: 'transformers',
        model: 'onnx-community/granite-embedding-small-english-r2-ONNX'
      })
    ).toBe(384);
  });

  it('returns 1536 for text-embedding-3-small', () => {
    expect(getConfiguredDimensions({ provider: 'openai', model: 'text-embedding-3-small' })).toBe(1536);
  });

  it('returns 3072 for text-embedding-3-large', () => {
    expect(getConfiguredDimensions({ provider: 'openai', model: 'text-embedding-3-large' })).toBe(3072);
  });

  it('returns 384 as fallback for unknown transformers model', () => {
    expect(getConfiguredDimensions({ provider: 'transformers', model: 'some/unknown-model' })).toBe(384);
  });
});
