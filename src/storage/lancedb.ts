/**
 * LanceDB Storage Provider
 * Embedded vector database for storing and searching code embeddings
 */

import { promises as fs } from 'fs';
import { VectorStorageProvider, CodeChunkWithEmbedding, VectorSearchResult } from './types.js';
import { CodeChunk, SearchFilters } from '../types/index.js';
import { IndexCorruptedError } from '../errors/index.js';

export class LanceDBStorageProvider implements VectorStorageProvider {
  readonly name = 'lancedb';

  private db: any = null;
  private table: any = null;
  private storagePath: string = '';
  private initialized = false;

  async initialize(storagePath: string): Promise<void> {
    if (this.initialized) return;

    try {
      this.storagePath = storagePath;

      // Ensure directory exists
      await fs.mkdir(storagePath, { recursive: true });

      // Dynamic import to avoid issues at require time
      const lancedb = await import('@lancedb/lancedb');

      // Connect to database
      this.db = await lancedb.connect(storagePath);

      // Check if table exists and has valid schema
      const tableNames = await this.db.tableNames();
      if (tableNames.includes('code_chunks')) {
        this.table = await this.db.openTable('code_chunks');

        // Validate schema has vector column (required for semantic search)
        try {
          const schema = await this.table.schema();
          const hasVectorColumn = schema.fields.some((f: any) => f.name === 'vector');

          if (!hasVectorColumn) {
            console.error('Stale index detected (missing vector column). Rebuilding...');
            await this.db.dropTable('code_chunks');
            this.table = null;
            throw new IndexCorruptedError('LanceDB index corrupted: missing vector column');
          } else {
            console.error('Opened existing LanceDB table');
          }
        } catch (schemaError) {
          if (schemaError instanceof IndexCorruptedError) {
            throw schemaError;
          }
          // If schema check fails, table is likely corrupted - drop and rebuild
          console.error('Failed to validate table schema, rebuilding index...');
          await this.db.dropTable('code_chunks');
          this.table = null;
          throw new IndexCorruptedError('LanceDB index corrupted: schema validation failed');
        }
      } else {
        // Table missing entirely - not necessarily an error during initialization
        this.table = null;
      }

      this.initialized = true;
      console.error(`LanceDB initialized at: ${storagePath}`);
    } catch (error) {
      if (error instanceof IndexCorruptedError) {
        throw error;
      }
      console.error('Failed to initialize LanceDB:', error);
      throw error;
    }
  }

  async store(chunks: CodeChunkWithEmbedding[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('Storage not initialized');
    }

    if (chunks.length === 0) return;

    try {
      // Convert chunks to LanceDB format
      const records = chunks.map((chunk) => ({
        id: chunk.id,
        vector: chunk.embedding,
        content: chunk.content,
        filePath: chunk.filePath,
        relativePath: chunk.relativePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        language: chunk.language,
        framework: chunk.framework || '',
        componentType: chunk.componentType || '',
        layer: chunk.layer || '',
        dependencies: JSON.stringify(chunk.dependencies),
        imports: JSON.stringify(chunk.imports),
        exports: JSON.stringify(chunk.exports),
        tags: JSON.stringify(chunk.tags),
        metadata: JSON.stringify(chunk.metadata)
      }));

      // Create or overwrite table
      if (this.table) {
        // Add to existing table
        await this.table.add(records);
      } else {
        // Create new table
        this.table = await this.db.createTable('code_chunks', records, {
          mode: 'overwrite'
        });
      }

      console.error(`Stored ${chunks.length} chunks in LanceDB`);
    } catch (error) {
      console.error('Failed to store chunks:', error);
      throw error;
    }
  }

  async search(
    queryVector: number[],
    limit: number,
    filters?: SearchFilters
  ): Promise<VectorSearchResult[]> {
    if (!this.initialized || !this.table) {
      // If table is missing, throw so auto-heal can fix it
      throw new IndexCorruptedError('LanceDB index corrupted: no table available for search');
    }

    try {
      // Build query
      let query = this.table.vectorSearch(queryVector).limit(limit);

      // Apply filters if provided
      if (filters) {
        const whereConditions: string[] = [];

        if (filters.framework) {
          whereConditions.push(`framework = '${filters.framework}'`);
        }
        if (filters.componentType) {
          whereConditions.push(`componentType = '${filters.componentType}'`);
        }
        if (filters.layer) {
          whereConditions.push(`layer = '${filters.layer}'`);
        }
        if (filters.language) {
          whereConditions.push(`language = '${filters.language}'`);
        }

        if (whereConditions.length > 0) {
          query = query.where(whereConditions.join(' AND '));
        }
      }

      // Execute search
      const results = await query.toArray();

      // Convert to VectorSearchResult format
      return results.map((result: any) => ({
        chunk: {
          id: result.id,
          content: result.content,
          filePath: result.filePath,
          relativePath: result.relativePath,
          startLine: result.startLine,
          endLine: result.endLine,
          language: result.language,
          framework: result.framework || undefined,
          componentType: result.componentType || undefined,
          layer: result.layer || undefined,
          dependencies: JSON.parse(result.dependencies || '[]'),
          imports: JSON.parse(result.imports || '[]'),
          exports: JSON.parse(result.exports || '[]'),
          tags: JSON.parse(result.tags || '[]'),
          metadata: JSON.parse(result.metadata || '{}')
        } as CodeChunk,
        score: 1 - (result._distance || 0), // Convert distance to similarity
        distance: result._distance || 0
      }));
    } catch (error) {
      if (!(error instanceof Error)) {
        console.error('[LanceDB] Unknown search error:', error);
        return [];
      }

      const message = error.message.toLowerCase();

      // Known corruption patterns that require re-indexing
      const corruptionPatterns = [
        'no vector column',
        'schema mismatch',
        'invalid schema',
        'corrupted table',
        'cannot read table',
        'table metadata',
        'invalid arrow format'
      ];

      const isCorruption = corruptionPatterns.some((pattern) => message.includes(pattern));

      if (isCorruption) {
        console.error('[LanceDB] Index corruption detected:', error.message);
        throw new IndexCorruptedError(`LanceDB index corrupted: ${error.message}`);
      }

      // Transient errors - log and fallback to keyword search
      console.error('[LanceDB] Transient search error:', error.message);
      return [];
    }
  }

  async clear(): Promise<void> {
    if (!this.initialized) return;

    try {
      // Drop table if exists
      const tableNames = await this.db.tableNames();
      if (tableNames.includes('code_chunks')) {
        await this.db.dropTable('code_chunks');
        this.table = null;
      }

      console.error('Cleared LanceDB storage');
    } catch (error) {
      console.error('Failed to clear storage:', error);
      throw error;
    }
  }

  async count(): Promise<number> {
    if (!this.initialized || !this.table) {
      return 0;
    }

    try {
      const result = await this.table.countRows();
      return result;
    } catch (error) {
      console.error('Failed to count rows:', error);
      return 0;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Create a LanceDB storage provider
 */
export async function createLanceDBStorage(storagePath: string): Promise<VectorStorageProvider> {
  const provider = new LanceDBStorageProvider();
  await provider.initialize(storagePath);
  return provider;
}
