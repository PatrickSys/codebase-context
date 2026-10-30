import { EmbeddingProvider } from './types.js';

/** Common Ollama embedding models and their vector sizes (for LanceDB dimension checks). */
export const OLLAMA_MODEL_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  'snowflake-arctic-embed:137m': 768,
  'snowflake-arctic-embed:335m': 1024
};

interface OllamaEmbedResponse {
  embeddings: number[][];
}

interface OllamaShowResponse {
  modelfile?: string;
  parameters?: string;
}

function normalizeOllamaHost(host: string): string {
  return host.replace(/\/+$/, '');
}

export function getOllamaModelDimensions(modelName: string): number {
  const direct = OLLAMA_MODEL_DIMENSIONS[modelName];
  if (direct !== undefined) {
    return direct;
  }
  const baseName = modelName.split(':')[0] ?? modelName;
  const fromBase = OLLAMA_MODEL_DIMENSIONS[baseName];
  if (fromBase !== undefined) {
    return fromBase;
  }
  const fromEnv = process.env.OLLAMA_EMBEDDING_DIMENSIONS;
  if (fromEnv) {
    const parsed = parseInt(fromEnv, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 768;
}

/**
 * Ollama embedding provider — HTTP client for a local Ollama server (`/api/embed`).
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  private resolvedDimensions: number;

  constructor(
    readonly modelName: string,
    private host: string = 'http://localhost:11434'
  ) {
    this.host = normalizeOllamaHost(host);
    this.resolvedDimensions = getOllamaModelDimensions(modelName);
  }

  get dimensions(): number {
    return this.resolvedDimensions;
  }

  async initialize(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.host}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.modelName })
      });
    } catch (error) {
      throw new Error(
        `Cannot reach Ollama at ${this.host}. Start the server (ollama serve) or set OLLAMA_HOST. ${String(error)}`
      );
    }

    if (response.status === 404) {
      throw new Error(
        `Ollama model "${this.modelName}" is not available. Pull it first: ollama pull ${this.modelName}`
      );
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API Error ${response.status}: ${error}`);
    }

    const show = (await response.json()) as OllamaShowResponse;
    const fromModelfile = parseEmbeddingLengthFromShow(show);
    if (fromModelfile !== undefined) {
      this.resolvedDimensions = fromModelfile;
    }
  }

  isReady(): boolean {
    return true;
  }

  async embed(text: string): Promise<number[]> {
    const batch = await this.embedBatch([text]);
    return batch[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    try {
      const response = await fetch(`${this.host}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          input: texts.length === 1 ? texts[0] : texts
        })
      });

      if (!response.ok) {
        const error = await response.text();
        if (response.status === 404 && error.includes('not found')) {
          throw new Error(
            `Ollama model "${this.modelName}" is not available. Pull it first: ollama pull ${this.modelName}`
          );
        }
        throw new Error(`Ollama API Error ${response.status}: ${error}`);
      }

      const data = (await response.json()) as OllamaEmbedResponse;
      if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
        throw new Error(
          `Ollama returned ${data.embeddings?.length ?? 0} embeddings for ${texts.length} inputs`
        );
      }

      if (data.embeddings[0]?.length && data.embeddings[0].length !== this.resolvedDimensions) {
        this.resolvedDimensions = data.embeddings[0].length;
      }

      return data.embeddings;
    } catch (error) {
      console.error('Ollama Embedding Failed:', error);
      throw error;
    }
  }
}

function parseEmbeddingLengthFromShow(show: OllamaShowResponse): number | undefined {
  const haystack = `${show.modelfile ?? ''}\n${show.parameters ?? ''}`;
  const match = haystack.match(/embedding[_\s-]?length[\s=:]+(\d+)/i);
  if (!match) {
    return undefined;
  }
  const parsed = parseInt(match[1] ?? '', 10);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
}
