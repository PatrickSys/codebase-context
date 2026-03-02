/**
 * LanceDB Storage Provider
 * Embedded vector database for storing and searching code embeddings
 */

import { promises as fs } from 'fs';
import type { Connection, Table } from '@lancedb/lancedb';
import { VectorStorageProvider, CodeChunkWithEmbedding, VectorSearchResult } from './types.js';
import { CodeChunk, SearchFilters } from '../types/index.js';
import { IndexCorruptedError } from '../errors/index.js';

interface LanceDBRecord {
  id: string;
  content: string;
  filePath: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  language: string;
  framework?: string;
  componentType?: string;
  layer?: string;
  dependencies?: string;
  imports?: string;
  exports?: string;
  tags?: string;
  metadata?: string;
  _distance?: number;
}

export class LanceDBStorageProvider implements VectorStorageProvider {
  readonly name = 'lancedb';

  private db: Connection | null = null;
  private table: Table | null = null;
  private storagePath: string = '';
  private initialized = false;

  /**
   * Initialize the storage provider at the given path.
   * @param storagePath - Directory path for LanceDB storage
   * @param options - Optional configuration
   * @param options.expectExisting - If true, throws IndexCorruptedError if table doesn't exist
   * @param options.expectedDimensions - If set, verifies the stored vector column has this many dimensions
   */
  async initialize(
    storagePath: string,
    options?: { expectExisting?: boolean; expectedDimensions?: number }
  ): Promise<void> {
    if (this.initialized) return;

    try {
      this.storagePath = storagePath;
      await fs.mkdir(storagePath, { recursive: true });

      const lancedb = await import('@lancedb/lancedb');
      this.db = await lancedb.connect(storagePath);

      // Check if table exists and validate schema
      const tableNames = await this.db.tableNames();
      if (tableNames.includes('code_chunks')) {
        this.table = await this.db.openTable('code_chunks');

        const schema = await this.table.schema();
        const hasVectorColumn = schema.fields.some((f: { name: string }) => f.name === 'vector');

        if (!hasVectorColumn) {
          throw new IndexCorruptedError('LanceDB index corrupted: missing vector column');
        }

        // Check vector dimensions if caller specifies expected dims (e.g. switching providers)
        if (options?.expectedDimensions !== undefined) {
          const vectorField = schema.fields.find((f: { name: string }) => f.name === 'vector');
          const storedDims = (vectorField?.type as { listSize?: number } | undefined)?.listSize;
          if (storedDims !== undefined && storedDims !== options.expectedDimensions) {
            throw new IndexCorruptedError(
              `LanceDB dimension mismatch: stored=${storedDims}, expected=${options.expectedDimensions} (rebuild required)`
            );
          }
        }

        if (process.env.CODEBASE_CONTEXT_DEBUG) console.error('Opened existing LanceDB table');
      } else if (options?.expectExisting) {
        throw new IndexCorruptedError(
          `LanceDB index missing: no code_chunks table found at ${storagePath}`
        );
      } else {
        this.table = null;
      }

      this.initialized = true;
      console.error(`LanceDB initialized at: ${storagePath}`);
    } catch (error) {
      if (error instanceof IndexCorruptedError) {
        throw error;
      }
      console.error('Failed to initialize LanceDB:', error);
      // Wrap connection/open failures as corruption errors for fail-closed behavior
      throw new IndexCorruptedError(
        `LanceDB initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async store(chunks: CodeChunkWithEmbedding[]): Promise<void> {
    if (!this.initialized || !this.db) {
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
    if (!this.initialized) {
      throw new IndexCorruptedError(
        'LanceDB index corrupted: storage not initialized (rebuild required)'
      );
    }
    if (!this.table) {
      // No semantic index was built (e.g. skipEmbedding) or it hasn't been created yet.
      // Degrade gracefully to keyword-only search instead of forcing an auto-heal rebuild.
      if (process.env.CODEBASE_CONTEXT_DEBUG) {
        console.error('[LanceDB] No table available for semantic search (keyword-only mode).');
      }
      return [];
    }

    try {
      // Build query
      let query = this.table.vectorSearch(queryVector).distanceType('cosine').limit(limit);

      // Apply filters if provided
      if (filters) {
        const whereConditions: string[] = [];

        if (filters.framework) {
          whereConditions.push(`framework = '${filters.framework}'`);
        }
        if (filters.componentType) {
          whereConditions.push(`"componentType" = '${filters.componentType}'`);
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
      return (results as LanceDBRecord[]).map((result) => ({
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
        score: Math.max(0, 1 - (result._distance || 0)), // Cosine distance → similarity, clamped to [0, 1]
        distance: result._distance || 0
      }));
    } catch (error) {
      // Fail closed: treat search errors as corruption requiring rebuild
      const errorMsg =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (
        errorMsg.includes('no vector column') ||
        errorMsg.includes('not found') ||
        errorMsg.includes('does not exist') ||
        errorMsg.includes('corrupted') ||
        errorMsg.includes('schema')
      ) {
        throw new IndexCorruptedError(
          `LanceDB query failed (rebuild required): ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Transient errors - log and gracefully degrade (don't trigger rebuild for network/IO hiccups)
      console.error('[LanceDB] Search error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  async deleteByFilePaths(filePaths: string[]): Promise<number> {
    if (!this.initialized || !this.table || filePaths.length === 0) {
      return 0;
    }

    try {
      const countBefore = await this.table.countRows();

      // LanceDB supports SQL-style filter for delete
      // Escape single quotes in file paths to prevent SQL injection
      const escaped = filePaths.map((p) => p.replace(/'/g, "''"));
      const inClause = escaped.map((p) => `'${p}'`).join(', ');
      await this.table.delete(`"filePath" IN (${inClause})`);

      const countAfter = await this.table.countRows();
      const deleted = countBefore - countAfter;
      console.error(`Deleted ${deleted} chunks for ${filePaths.length} files from LanceDB`);
      return deleted;
    } catch (error) {
      console.error('Failed to delete chunks by file paths:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    if (!this.initialized) return;

    try {
      // Drop table if exists
      if (!this.db) return;
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
      return await this.table.countRows();
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
