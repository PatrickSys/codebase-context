/**
 * Storage module
 * Provides vector storage using LanceDB
 */

export * from './types.js';
export * from './lancedb.js';

import { VectorStorageProvider, StorageConfig, DEFAULT_STORAGE_CONFIG } from './types.js';
import { LanceDBStorageProvider } from './lancedb.js';
import { assertOptionalDependency } from '../utils/optional-dependency.js';

export function assertStorageRuntimeAvailable(): void {
  assertOptionalDependency('@lancedb/lancedb', '^0.4.0');
}

/**
 * Get a storage provider based on configuration
 */
export async function getStorageProvider(
  config: Partial<StorageConfig> = {},
  options?: { expectExisting?: boolean; expectedDimensions?: number }
): Promise<VectorStorageProvider> {
  assertStorageRuntimeAvailable();
  const mergedConfig = { ...DEFAULT_STORAGE_CONFIG, ...config };

  const provider = new LanceDBStorageProvider();
  await provider.initialize(mergedConfig.path, options);

  return provider;
}
