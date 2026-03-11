import { EmbeddingProvider } from './types.js';

interface OllamaEmbeddingResponse {
  embedding: number[];
}

// Context window sizes for common Ollama embedding models (in tokens)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'nomic-embed-text': 2048,
  'nomic-embed-text:latest': 2048,
  embeddinggemma: 2048,
  'embeddinggemma:latest': 2048,
  'mxbai-embed-large': 512,
  'mxbai-embed-large:latest': 512,
  'all-minilm': 512,
  'all-minilm:latest': 512
};

// Conservative character limit (approx 2 chars per token for code)
// Code has more tokens per character due to punctuation and symbols
function getMaxChars(modelName: string): number {
  const tokens = MODEL_CONTEXT_WINDOWS[modelName] || 2048;
  return tokens * 2; // Very conservative: 2 chars per token
}

/**
 * Ollama Embedding Provider
 * Supports local embedding models via Ollama API.
 * API endpoint: POST /api/embeddings
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  private maxChars: number;

  // Default dimensions for nomic-embed-text (768)
  // Override via EMBEDDING_DIMENSIONS env var for custom models
  get dimensions(): number {
    // Allow explicit dimension override via env var
    if (process.env.EMBEDDING_DIMENSIONS) {
      const parsed = parseInt(process.env.EMBEDDING_DIMENSIONS, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    // Common Ollama embedding model dimensions
    const modelDimensions: Record<string, number> = {
      'nomic-embed-text': 768,
      'nomic-embed-text:latest': 768,
      embeddinggemma: 768,
      'embeddinggemma:latest': 768,
      'mxbai-embed-large': 1024,
      'mxbai-embed-large:latest': 1024,
      'all-minilm': 384,
      'all-minilm:latest': 384
    };
    return modelDimensions[this.modelName] || 768;
  }

  constructor(
    readonly modelName: string = 'nomic-embed-text',
    private apiEndpoint: string = 'http://localhost:11434'
  ) {
    this.maxChars = getMaxChars(modelName);
  }

  async initialize(): Promise<void> {
    // Ollama doesn't require an API key
    // We could test connectivity here if needed
  }

  isReady(): boolean {
    // Ollama is always "ready" - no auth required
    return true;
  }

  private truncateText(text: string): string {
    if (text.length <= this.maxChars) {
      return text;
    }
    return text.slice(0, this.maxChars);
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
        // Truncate text to fit within model's context window
        const truncatedText = this.truncateText(text);

        const response = await fetch(`${this.apiEndpoint}/api/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.modelName,
            prompt: truncatedText
          })
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
