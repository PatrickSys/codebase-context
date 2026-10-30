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

export function parseEmbeddingProviderName(
  value: unknown
): EmbeddingConfig['provider'] | undefined {
  if (value === 'transformers' || value === 'ollama' || value === 'openai' || value === 'custom') {
    return value;
  }
  return undefined;
}

export const DEFAULT_OLLAMA_MODEL = 'nomic-embed-text';
export const DEFAULT_TRANSFORMERS_MODEL = 'Xenova/bge-small-en-v1.5';
export const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';

// Default: bge-small (fast, ~2min indexing, consumer-hardware safe)
// Opt-in: set EMBEDDING_MODEL=onnx-community/granite-embedding-small-english-r2-ONNX for
// better conceptual search at the cost of 5-10x slower indexing and higher RAM usage
export const DEFAULT_MODEL = process.env.EMBEDDING_MODEL || DEFAULT_TRANSFORMERS_MODEL;

const DEFAULT_OPENAI_API_ENDPOINT = 'https://api.openai.com/v1';
const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveOpenAiApiEndpoint(): string {
  const fromEnv = process.env.OPENAI_BASE_URL?.trim();
  if (!fromEnv) {
    return DEFAULT_OPENAI_API_ENDPOINT;
  }
  return stripTrailingSlashes(fromEnv);
}

export function resolveOllamaHost(): string {
  const fromEnv = process.env.OLLAMA_HOST?.trim();
  if (!fromEnv) {
    return DEFAULT_OLLAMA_HOST;
  }
  return stripTrailingSlashes(fromEnv);
}

export function resolveEmbeddingModel(
  provider: EmbeddingConfig['provider'],
  envModel: string | undefined = process.env.EMBEDDING_MODEL
): string {
  if (envModel) {
    return envModel;
  }
  if (provider === 'openai') {
    return DEFAULT_OPENAI_MODEL;
  }
  if (provider === 'ollama') {
    return DEFAULT_OLLAMA_MODEL;
  }
  return DEFAULT_TRANSFORMERS_MODEL;
}

function resolveDefaultApiEndpoint(provider: EmbeddingConfig['provider']): string | undefined {
  if (provider === 'openai') {
    return resolveOpenAiApiEndpoint();
  }
  if (provider === 'ollama') {
    return resolveOllamaHost();
  }
  return undefined;
}

const defaultProvider =
  parseEmbeddingProviderName(process.env.EMBEDDING_PROVIDER) ?? 'transformers';

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: defaultProvider,
  model: resolveEmbeddingModel(defaultProvider),
  batchSize: 32,
  maxRetries: 3,
  apiKey: process.env.OPENAI_API_KEY,
  apiEndpoint: resolveDefaultApiEndpoint(defaultProvider)
};
