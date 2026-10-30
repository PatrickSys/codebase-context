import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getEmbeddingProvider cache key', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/embeddings/openai.js');
  });

  it('rebuilds the OpenAI provider when apiEndpoint changes', async () => {
    const endpoints: string[] = [];
    vi.doMock('../src/embeddings/openai.js', () => ({
      OpenAIEmbeddingProvider: class {
        constructor(_model: string, _apiKey?: string, apiEndpoint?: string) {
          endpoints.push(apiEndpoint ?? '');
        }

        async initialize(): Promise<void> {
          return undefined;
        }
      }
    }));

    const { getEmbeddingProvider } = await import('../src/embeddings/index.js');
    await getEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      apiEndpoint: 'http://127.0.0.1:11434/v1'
    });
    await getEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      apiEndpoint: 'http://127.0.0.1:8080/v1'
    });

    expect(endpoints).toEqual(['http://127.0.0.1:11434/v1', 'http://127.0.0.1:8080/v1']);
  });
});
