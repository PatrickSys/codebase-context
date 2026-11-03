import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { INDEXING_STATS_FILENAME, KEYWORD_INDEX_FILENAME } from '../constants/codebase-context.js';
import { resolveIndexArtifact } from '../core/index-generation.js';
import type { ToolContext, ToolResponse } from './types.js';

interface PersistedIndexingStats {
  indexedFiles: number;
  totalChunks: number;
  totalFiles: number;
  generatedAt: string;
}

interface DiskIndexSummary {
  stats: PersistedIndexingStats;
  searchableChunks: number;
}

function isPersistedIndexingStats(value: unknown): value is PersistedIndexingStats {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.indexedFiles === 'number' &&
    Number.isFinite(record.indexedFiles) &&
    typeof record.totalChunks === 'number' &&
    Number.isFinite(record.totalChunks) &&
    typeof record.totalFiles === 'number' &&
    Number.isFinite(record.totalFiles) &&
    typeof record.generatedAt === 'string'
  );
}

function searchableChunkCount(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || !('chunks' in value)) return null;
  const chunks = (value as { chunks?: unknown }).chunks;
  return Array.isArray(chunks) ? chunks.length : null;
}

async function readDiskIndexSummary(rootPath: string): Promise<DiskIndexSummary | null> {
  try {
    const keywordPath = await resolveIndexArtifact(rootPath, KEYWORD_INDEX_FILENAME);
    const statsPath = path.join(path.dirname(keywordPath), INDEXING_STATS_FILENAME);
    const [statsRaw, indexRaw] = await Promise.all([
      fs.readFile(statsPath, 'utf-8'),
      fs.readFile(keywordPath, 'utf-8')
    ]);
    const statsParsed: unknown = JSON.parse(statsRaw);
    const indexParsed: unknown = JSON.parse(indexRaw);
    const searchableChunks = searchableChunkCount(indexParsed);
    if (!isPersistedIndexingStats(statsParsed) || searchableChunks === null) return null;
    return { stats: statsParsed, searchableChunks };
  } catch {
    return null;
  }
}

const loadedStatusModulePath = fileURLToPath(import.meta.url);

export const definition: Tool = {
  name: 'get_indexing_status',
  description:
    'Get current indexing status: state, statistics, and progress. ' +
    'Use refresh_index to manually trigger re-indexing when needed.',
  inputSchema: {
    type: 'object',
    properties: {}
  }
};

export async function handle(
  _args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const progress = ctx.indexState.indexer?.getProgress();
  const disk = await readDiskIndexSummary(ctx.rootPath);
  const memory = ctx.indexState.stats;
  const omittedChunks =
    disk && disk.stats.totalChunks > disk.searchableChunks
      ? disk.stats.totalChunks - disk.searchableChunks
      : undefined;
  const capFields = omittedChunks
    ? { searchableChunks: disk?.searchableChunks, omittedChunks }
    : {};

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: ctx.indexState.status,
            rootPath: ctx.rootPath,
            loadedStatusModulePath,
            lastIndexed: ctx.indexState.lastIndexed?.toISOString() ?? disk?.stats.generatedAt,
            stats: memory
              ? {
                  totalFiles: memory.totalFiles,
                  indexedFiles: memory.indexedFiles,
                  totalChunks: memory.totalChunks,
                  duration: `${(memory.duration / 1000).toFixed(2)}s`,
                  incremental: memory.incremental,
                  ...capFields
                }
              : disk
                ? {
                    totalFiles: disk.stats.totalFiles,
                    indexedFiles: disk.stats.indexedFiles,
                    totalChunks: disk.stats.totalChunks,
                    ...capFields
                  }
                : undefined,
            progress: progress
              ? {
                  phase: progress.phase,
                  percentage: progress.percentage,
                  filesProcessed: progress.filesProcessed,
                  totalFiles: progress.totalFiles
                }
              : undefined,
            error: ctx.indexState.error,
            hint: 'Use refresh_index to manually trigger re-indexing when needed.'
          },
          null,
          2
        )
      }
    ]
  };
}
