import { afterEach, describe, expect, it, vi } from 'vitest';

describe('DEFAULT_EMBEDDING_CONFIG environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses OPENAI_BASE_URL when set', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:11434/v1/');
    const { DEFAULT_EMBEDDING_CONFIG } = await import('../src/embeddings/types.js');
    expect(DEFAULT_EMBEDDING_CONFIG.apiEndpoint).toBe('http://127.0.0.1:11434/v1');
  });

  it('defaults to the official OpenAI endpoint when OPENAI_BASE_URL is unset', async () => {
    vi.unstubAllEnvs();
    const { DEFAULT_EMBEDDING_CONFIG } = await import('../src/embeddings/types.js');
    expect(DEFAULT_EMBEDDING_CONFIG.apiEndpoint).toBe('https://api.openai.com/v1');
  });
});
