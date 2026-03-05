import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIEmbeddingProvider } from '../src/embeddings/openai.js';

function makeFetchResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  } as Response);
}

describe('OpenAIEmbeddingProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct dimensions for text-embedding-3-small', () => {
    const provider = new OpenAIEmbeddingProvider('text-embedding-3-small', 'key');
    expect(provider.dimensions).toBe(1536);
  });

  it('initialize() throws when API key is missing', async () => {
    const provider = new OpenAIEmbeddingProvider('text-embedding-3-small', undefined);
    await expect(provider.initialize()).rejects.toThrow('OpenAI API key');
  });

  it('initialize() resolves when API key is present', async () => {
    const provider = new OpenAIEmbeddingProvider('text-embedding-3-small', 'sk-test');
    await expect(provider.initialize()).resolves.toBeUndefined();
  });

  it('isReady() returns false without API key', () => {
    const provider = new OpenAIEmbeddingProvider();
    expect(provider.isReady()).toBe(false);
  });

  it('isReady() returns true with API key', () => {
    const provider = new OpenAIEmbeddingProvider('text-embedding-3-small', 'sk-test');
    expect(provider.isReady()).toBe(true);
  });

  it('embedBatch() returns [] for empty input', async () => {
    const provider = new OpenAIEmbeddingProvider('text-embedding-3-small', 'sk-test');
    const result = await provider.embedBatch([]);
    expect(result).toEqual([]);
  });

  it('embedBatch() sends correct Authorization header, model, and encoding_format', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      makeFetchResponse({
        data: [{ embedding: [0.1, 0.2, 0.3] }]
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const provider = new OpenAIEmbeddingProvider('text-embedding-3-small', 'sk-abc123');
    await provider.embedBatch(['hello world']);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/embeddings');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-abc123');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('text-embedding-3-small');
    expect(body.encoding_format).toBe('float');
    expect(body.input).toEqual(['hello world']);
  });

  it('embedBatch() returns parsed embeddings in input order', async () => {
    const vec1 = [0.1, 0.2];
    const vec2 = [0.3, 0.4];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        makeFetchResponse({
          data: [{ embedding: vec1 }, { embedding: vec2 }]
        })
      )
    );

    const provider = new OpenAIEmbeddingProvider('text-embedding-3-small', 'sk-test');
    const result = await provider.embedBatch(['a', 'b']);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(vec1);
    expect(result[1]).toEqual(vec2);
  });

  it('embedBatch() throws on non-ok API response with status code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(makeFetchResponse({ error: 'Unauthorized' }, false, 401))
    );

    const provider = new OpenAIEmbeddingProvider('text-embedding-3-small', 'sk-bad');
    await expect(provider.embedBatch(['test'])).rejects.toThrow('401');
  });

  it('embed() delegates to embedBatch and returns first element', async () => {
    const vec = [0.5, 0.6, 0.7];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(makeFetchResponse({ data: [{ embedding: vec }] }))
    );

    const provider = new OpenAIEmbeddingProvider('text-embedding-3-small', 'sk-test');
    const result = await provider.embed('hello');
    expect(result).toEqual(vec);
  });
});
