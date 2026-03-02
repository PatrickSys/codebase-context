import { EmbeddingProvider } from './types.js';

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

/**
 * OpenAI Embedding Provider
 * Uses native fetch to avoid adding the heavy openai npm package dependency.
 * Minimal implementation focusing on high ROI and low bloat.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  get dimensions(): number {
    return this.modelName.includes('large') ? 3072 : 1536;
  }

  constructor(
    readonly modelName: string = 'text-embedding-3-small',
    private apiKey?: string,
    private apiEndpoint: string = 'https://api.openai.com/v1'
  ) {}

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error(
        'OpenAI API key is missing. Set OPENAI_API_KEY environment variable or configure it in the MCP settings.'
      );
    }
  }

  isReady(): boolean {
    return !!this.apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const batch = await this.embedBatch([text]);
    return batch[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    try {
      const response = await fetch(`${this.apiEndpoint}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.modelName,
          input: texts,
          encoding_format: 'float'
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API Error ${response.status}: ${error}`);
      }

      const data = (await response.json()) as OpenAIEmbeddingResponse;

      // OpenAI guarantees order matches input
      return data.data.map((item) => item.embedding);
    } catch (error) {
      console.error('OpenAI Embedding Failed:', error);
      throw error;
    }
  }
}
