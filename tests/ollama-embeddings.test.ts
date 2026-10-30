import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaEmbeddingProvider } from '../src/embeddings/ollama.js';

function makeFetchResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  } as Response);
}

describe('OllamaEmbeddingProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses known dimensions for nomic-embed-text', () => {
    const provider = new OllamaEmbeddingProvider('nomic-embed-text');
    expect(provider.dimensions).toBe(768);
  });

  it('initialize() throws when the model is missing on the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(makeFetchResponse({ error: 'not found' }, false, 404))
    );

    const provider = new OllamaEmbeddingProvider('nomic-embed-text', 'http://127.0.0.1:11434');
    await expect(provider.initialize()).rejects.toThrow('not available');
  });

  it('initialize() resolves when /api/show succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(makeFetchResponse({ modelfile: 'FROM nomic-embed-text' }))
    );

    const provider = new OllamaEmbeddingProvider('nomic-embed-text');
    await expect(provider.initialize()).resolves.toBeUndefined();
  });

  it('embedBatch() posts to /api/embed with model and input', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      makeFetchResponse({
        embeddings: [[0.1, 0.2, 0.3]]
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const provider = new OllamaEmbeddingProvider('nomic-embed-text', 'http://localhost:11434');
    const result = await provider.embedBatch(['hello world']);

    expect(result).toEqual([[0.1, 0.2, 0.3]]);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/embed');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('nomic-embed-text');
    expect(body.input).toBe('hello world');
  });

  it('embedBatch() sends array input for multiple texts', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      makeFetchResponse({
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4]
        ]
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const provider = new OllamaEmbeddingProvider('nomic-embed-text');
    await provider.embedBatch(['a', 'b']);

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.input).toEqual(['a', 'b']);
  });

  it('embedBatch() returns [] for empty input', async () => {
    const provider = new OllamaEmbeddingProvider('nomic-embed-text');
    await expect(provider.embedBatch([])).resolves.toEqual([]);
  });

  it('embedBatch() throws on non-ok API response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(makeFetchResponse({ error: 'server error' }, false, 500))
    );

    const provider = new OllamaEmbeddingProvider('nomic-embed-text');
    await expect(provider.embedBatch(['test'])).rejects.toThrow('500');
  });

  it('embed() delegates to embedBatch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(makeFetchResponse({ embeddings: [[0.5, 0.6]] }))
    );

    const provider = new OllamaEmbeddingProvider('nomic-embed-text');
    await expect(provider.embed('hello')).resolves.toEqual([0.5, 0.6]);
  });
});
