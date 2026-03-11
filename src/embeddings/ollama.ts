import { EmbeddingProvider } from './types.js';

interface OllamaEmbeddingResponse {
  embedding: number[];
}

/**
 * Ollama Embedding Provider
 * Supports local embedding models via Ollama API.
 * API endpoint: POST /api/embeddings
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  
  // Default dimensions for nomic-embed-text (768)
  // Override via EMBEDDING_MODEL env var for other models
  get dimensions(): number {
    // Common Ollama embedding model dimensions
    const modelDimensions: Record<string, number> = {
      'nomic-embed-text': 768,
      'nomic-embed-text:latest': 768,
      'mxbai-embed-large': 1024,
      'mxbai-embed-large:latest': 1024,
      'all-minilm': 384,
      'all-minilm:latest': 384,
    };
    return modelDimensions[this.modelName] || 768;
  }

  constructor(
    readonly modelName: string = 'nomic-embed-text',
    private apiEndpoint: string = 'http://localhost:11434'
  ) {}

  async initialize(): Promise<void> {
    // Ollama doesn't require an API key
    // We could test connectivity here if needed
  }

  isReady(): boolean {
    // Ollama is always "ready" - no auth required
    return true;
  }

  async embed(text: string): Promise<number[]> {
    const batch = await this.embedBatch([text]);
    return batch[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    const embeddings: number[][] = [];

    // Ollama embeddings API processes one text at a time
    for (const text of texts) {
      try {
        const response = await fetch(`${this.apiEndpoint}/api/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.modelName,
            prompt: text,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Ollama API Error ${response.status}: ${error}`);
        }

        const data = (await response.json()) as OllamaEmbeddingResponse;
        embeddings.push(data.embedding);
      } catch (error) {
        console.error('Ollama Embedding Failed:', error);
        throw error;
      }
    }

    return embeddings;
  }
}
