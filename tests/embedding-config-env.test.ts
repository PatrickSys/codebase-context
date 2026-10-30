import { afterEach, describe, expect, it, vi } from 'vitest';

describe('DEFAULT_EMBEDDING_CONFIG environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses OPENAI_BASE_URL when set', async () => {
    vi.stubEnv('EMBEDDING_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:11434/v1/');
    const { DEFAULT_EMBEDDING_CONFIG } = await import('../src/embeddings/types.js');
    expect(DEFAULT_EMBEDDING_CONFIG.apiEndpoint).toBe('http://127.0.0.1:11434/v1');
  });

  it('defaults to the official OpenAI endpoint when OPENAI_BASE_URL is unset', async () => {
    vi.stubEnv('EMBEDDING_PROVIDER', 'openai');
    vi.unstubAllEnvs();
    vi.stubEnv('EMBEDDING_PROVIDER', 'openai');
    const { DEFAULT_EMBEDDING_CONFIG } = await import('../src/embeddings/types.js');
    expect(DEFAULT_EMBEDDING_CONFIG.apiEndpoint).toBe('https://api.openai.com/v1');
  });

  it('uses OLLAMA_HOST when provider is ollama', async () => {
    vi.stubEnv('EMBEDDING_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_HOST', 'http://127.0.0.1:11434/');
    const { DEFAULT_EMBEDDING_CONFIG } = await import('../src/embeddings/types.js');
    expect(DEFAULT_EMBEDDING_CONFIG.provider).toBe('ollama');
    expect(DEFAULT_EMBEDDING_CONFIG.apiEndpoint).toBe('http://127.0.0.1:11434');
    expect(DEFAULT_EMBEDDING_CONFIG.model).toBe('nomic-embed-text');
  });

  it('resolveEmbeddingModel picks provider-specific defaults', async () => {
    const { resolveEmbeddingModel } = await import('../src/embeddings/types.js');
    expect(resolveEmbeddingModel('ollama', undefined)).toBe('nomic-embed-text');
    expect(resolveEmbeddingModel('openai', undefined)).toBe('text-embedding-3-small');
    expect(resolveEmbeddingModel('transformers', undefined)).toBe('Xenova/bge-small-en-v1.5');
  });
});
