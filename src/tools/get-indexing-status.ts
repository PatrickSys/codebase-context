import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INDEX_META_FILENAME,
  INDEXING_STATS_FILENAME,
  KEYWORD_INDEX_FILENAME
} from '../constants/codebase-context.js';
import { resolveIndexArtifact } from '../core/index-generation.js';
import { readIndexMeta, type IndexMeta } from '../core/index-meta.js';
import type { IndexingStats } from '../types/index.js';
import type { ToolContext, ToolResponse } from './types.js';

interface PersistedIndexingStats {
  indexedFiles: number;
  totalChunks: number;
  totalFiles: number;
  generatedAt: string;
}

interface DiskIndexSummary {
  /** Absent for a legacy index that predates generation metadata. */
  buildId?: string;
  stats: PersistedIndexingStats;
  searchableChunks: number;
}

interface StatusSnapshot {
  lastIndexed?: string;
  stats: {
    totalFiles: number;
    indexedFiles: number;
    totalChunks: number;
    duration?: string;
    incremental?: IndexingStats['incremental'];
    searchableChunks?: number;
    omittedChunks?: number;
  };
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

function keywordIndexBuildId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('header' in value)) return undefined;
  const header = (value as { header?: unknown }).header;
  if (typeof header !== 'object' || header === null) return undefined;
  const buildId = (header as { buildId?: unknown }).buildId;
  return typeof buildId === 'string' ? buildId : undefined;
}

/** A legacy index has no published metadata, so it has no generation id either. */
async function readPublishedMeta(rootPath: string): Promise<IndexMeta | undefined> {
  try {
    await fs.access(path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, INDEX_META_FILENAME));
  } catch {
    return undefined;
  }
  return readIndexMeta(rootPath);
}

/**
 * Reads one committed generation. The metadata is read once and both artifact paths
 * are resolved from that same metadata, so the totals and the searchable count cannot
 * come from two different builds, and the keyword index must carry the same build id.
 */
async function readDiskIndexSummary(rootPath: string): Promise<DiskIndexSummary | null> {
  try {
    const meta = await readPublishedMeta(rootPath);
    const [keywordPath, statsPath] = await Promise.all([
      resolveIndexArtifact(rootPath, KEYWORD_INDEX_FILENAME, meta),
      resolveIndexArtifact(rootPath, INDEXING_STATS_FILENAME, meta)
    ]);
    const [statsRaw, indexRaw] = await Promise.all([
      fs.readFile(statsPath, 'utf-8'),
      fs.readFile(keywordPath, 'utf-8')
    ]);
    const statsParsed: unknown = JSON.parse(statsRaw);
    const indexParsed: unknown = JSON.parse(indexRaw);
    const searchableChunks = searchableChunkCount(indexParsed);
    if (!isPersistedIndexingStats(statsParsed) || searchableChunks === null) return null;
    if (meta && keywordIndexBuildId(indexParsed) !== meta.buildId) return null;
    return { buildId: meta?.buildId, stats: statsParsed, searchableChunks };
  } catch {
    return null;
  }
}

function capFields(totalChunks: number, searchableChunks: number | undefined) {
  return searchableChunks !== undefined && totalChunks > searchableChunks
    ? { searchableChunks, omittedChunks: totalChunks - searchableChunks }
    : {};
}

function runFields(memory: IndexingStats) {
  return { duration: `${(memory.duration / 1000).toFixed(2)}s`, incremental: memory.incremental };
}

/**
 * Picks the counts and their timestamp from exactly one generation. The published
 * generation on disk wins. In-memory stats describe the same generation only when
 * both carry the same build id; otherwise they are stale or unidentifiable, and none
 * of their numbers may be mixed in. Memory is the fallback when no disk index is
 * readable, and then only its own counts are used.
 */
function selectStatusSnapshot(
  disk: DiskIndexSummary | null,
  memory: IndexingStats | undefined,
  memoryLastIndexed: Date | undefined
): StatusSnapshot | undefined {
  if (disk) {
    const sameGeneration =
      memory !== undefined && disk.buildId !== undefined && memory.buildId === disk.buildId;
    return {
      lastIndexed: sameGeneration
        ? (memoryLastIndexed?.toISOString() ?? disk.stats.generatedAt)
        : disk.stats.generatedAt,
      stats: {
        totalFiles: disk.stats.totalFiles,
        indexedFiles: disk.stats.indexedFiles,
        totalChunks: disk.stats.totalChunks,
        ...(sameGeneration ? runFields(memory) : {}),
        ...capFields(disk.stats.totalChunks, disk.searchableChunks)
      }
    };
  }
  if (!memory) return undefined;
  return {
    lastIndexed: memoryLastIndexed?.toISOString(),
    stats: {
      totalFiles: memory.totalFiles,
      indexedFiles: memory.indexedFiles,
      totalChunks: memory.totalChunks,
      ...runFields(memory),
      ...capFields(memory.totalChunks, memory.searchableChunks)
    }
  };
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
  const snapshot = selectStatusSnapshot(
    await readDiskIndexSummary(ctx.rootPath),
    ctx.indexState.stats,
    ctx.indexState.lastIndexed
  );

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: ctx.indexState.status,
            rootPath: ctx.rootPath,
            loadedStatusModulePath,
            lastIndexed: snapshot?.lastIndexed,
            stats: snapshot?.stats,
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
