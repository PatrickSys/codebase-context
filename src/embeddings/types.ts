/* eslint-disable @typescript-eslint/no-explicit-any */
export interface EmbeddingProvider {
  readonly name: string;
  readonly modelName: string;
  readonly dimensions: number;

  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  isReady(): boolean;
}

export interface EmbeddingConfig {
  provider: 'transformers' | 'ollama' | 'openai' | 'custom';
  model?: string;
  batchSize?: number;
  maxRetries?: number;
  apiKey?: string;
  apiEndpoint?: string;
}

// Default: bge-small (fast, ~2min indexing, consumer-hardware safe)
// Opt-in: set EMBEDDING_MODEL=onnx-community/granite-embedding-small-english-r2-ONNX for
// better conceptual search at the cost of 5-10x slower indexing and higher RAM usage
export const DEFAULT_MODEL = process.env.EMBEDDING_MODEL || 'Xenova/bge-small-en-v1.5';

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: (process.env.EMBEDDING_PROVIDER as any) || 'transformers',
  model: DEFAULT_MODEL,
  batchSize: 32,
  maxRetries: 3,
  apiKey: process.env.OPENAI_API_KEY
};
