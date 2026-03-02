/**
 * Storage module
 * Provides vector storage using LanceDB
 */

export * from './types.js';
export * from './lancedb.js';

import { VectorStorageProvider, StorageConfig, DEFAULT_STORAGE_CONFIG } from './types.js';
import { LanceDBStorageProvider } from './lancedb.js';

/**
 * Get a storage provider based on configuration
 */
export async function getStorageProvider(
  config: Partial<StorageConfig> = {},
  options?: { expectExisting?: boolean; expectedDimensions?: number }
): Promise<VectorStorageProvider> {
  const mergedConfig = { ...DEFAULT_STORAGE_CONFIG, ...config };

  const provider = new LanceDBStorageProvider();
  await provider.initialize(mergedConfig.path, options);

  return provider;
}
