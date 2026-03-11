export * from './types.js';

import {
  EmbeddingProvider,
  EmbeddingConfig,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_MODEL,
  parseEmbeddingProviderName
} from './types.js';

// Model configs for dimension lookups (sync, no heavy dependencies)
// This avoids loading the full transformers module at import time
const TRANSFORMERS_MODEL_CONFIGS: Record<string, { dimensions: number; maxContext: number }> = {
  'Xenova/bge-small-en-v1.5': { dimensions: 384, maxContext: 512 },
  'Xenova/all-MiniLM-L6-v2': { dimensions: 384, maxContext: 512 },
  'Xenova/bge-base-en-v1.5': { dimensions: 768, maxContext: 512 },
  'onnx-community/granite-embedding-small-english-r2-ONNX': { dimensions: 384, maxContext: 8192 }
};

/**
 * Returns expected embedding dimensions for a given config without initializing any provider.
 * Used for LanceDB dimension validation before committing to an incremental update.
 *
 * Looks up dimensions from TRANSFORMERS_MODEL_CONFIGS for local models and handles
 * remote providers (OpenAI, Ollama) with their specific dimension logic.
 */
export function getConfiguredDimensions(config: Partial<EmbeddingConfig> = {}): number {
  const provider =
    config.provider ?? parseEmbeddingProviderName(process.env.EMBEDDING_PROVIDER) ?? 'transformers';
  const model = config.model ?? process.env.EMBEDDING_MODEL ?? DEFAULT_MODEL;
  if (provider === 'openai') return model.includes('large') ? 3072 : 1536; // text-embedding-3-large: 3072, all others: 1536
  if (provider === 'ollama') {
    // Common Ollama embedding model dimensions
    const ollamaDimensions: Record<string, number> = {
      'nomic-embed-text': 768,
      'nomic-embed-text:latest': 768,
      'mxbai-embed-large': 1024,
      'mxbai-embed-large:latest': 1024,
      'all-minilm': 384,
      'all-minilm:latest': 384
    };
    return ollamaDimensions[model] || 768;
  }
  // Look up from the local config for transformers provider
  return TRANSFORMERS_MODEL_CONFIGS[model]?.dimensions ?? 384;
}

let cachedProvider: EmbeddingProvider | null = null;
let cachedProviderType: string | null = null;

export async function getEmbeddingProvider(
  config: Partial<EmbeddingConfig> = {}
): Promise<EmbeddingProvider> {
  const mergedConfig = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
  const providerKey = `${mergedConfig.provider}:${mergedConfig.model}`;

  if (cachedProvider && cachedProviderType === providerKey) {
    return cachedProvider;
  }

  if (mergedConfig.provider === 'openai') {
    const { OpenAIEmbeddingProvider } = await import('./openai.js');
    const provider = new OpenAIEmbeddingProvider(
      mergedConfig.model || 'text-embedding-3-small',
      mergedConfig.apiKey,
      mergedConfig.apiEndpoint
    );
    await provider.initialize();
    cachedProvider = provider;
    cachedProviderType = providerKey;
    return provider;
  }

  if (mergedConfig.provider === 'ollama') {
    const { OllamaEmbeddingProvider } = await import('./ollama.js');
    const provider = new OllamaEmbeddingProvider(
      mergedConfig.model || 'nomic-embed-text',
      mergedConfig.apiEndpoint || 'http://localhost:11434'
    );
    await provider.initialize();
    cachedProvider = provider;
    cachedProviderType = providerKey;
    return provider;
  }

  // Default: transformers (lazy loaded)
  const { TransformersEmbeddingProvider } = await import('./transformers.js');
  const provider = new TransformersEmbeddingProvider(mergedConfig.model);
  await provider.initialize();
  cachedProvider = provider;
  cachedProviderType = providerKey;

  return provider;
}

// Re-export TransformersEmbeddingProvider and MODEL_CONFIGS for consumers who need them
// These will trigger transformers loading, but only when explicitly imported
export { TransformersEmbeddingProvider, MODEL_CONFIGS } from './transformers.js';
