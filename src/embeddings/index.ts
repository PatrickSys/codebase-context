export * from './types.js';
export * from './transformers.js';

import {
  EmbeddingProvider,
  EmbeddingConfig,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_MODEL,
  parseEmbeddingProviderName
} from './types.js';
import { TransformersEmbeddingProvider, MODEL_CONFIGS } from './transformers.js';

/**
 * Returns expected embedding dimensions for a given config without initializing any provider.
 * Used for LanceDB dimension validation before committing to an incremental update.
 *
 * Looks up dimensions from MODEL_CONFIGS (the authoritative source shared with the provider
 * implementation) so new models are automatically handled without updating this function.
 */
export function getConfiguredDimensions(config: Partial<EmbeddingConfig> = {}): number {
  const provider = config.provider ?? parseEmbeddingProviderName(process.env.EMBEDDING_PROVIDER) ?? 'transformers';
  const model = config.model ?? process.env.EMBEDDING_MODEL ?? DEFAULT_MODEL;
  if (provider === 'openai') return model.includes('large') ? 3072 : 1536; // text-embedding-3-large: 3072, all others: 1536
  // Look up from the same MODEL_CONFIGS the provider uses — avoids stale hardcoded guesses
  return MODEL_CONFIGS[model]?.dimensions ?? 384;
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

  if (mergedConfig.provider === 'custom') {
    throw new Error("Custom provider not implemented. Use 'openai' or 'transformers'.");
  }

  if (mergedConfig.provider === 'ollama') {
    console.warn('Ollama provider not yet implemented, falling back to Transformers.js');
  }

  const provider = new TransformersEmbeddingProvider(mergedConfig.model);
  await provider.initialize();
  cachedProvider = provider;
  cachedProviderType = providerKey;

  return provider;
}
