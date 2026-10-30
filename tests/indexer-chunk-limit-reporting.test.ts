import { describe, expect, it } from 'vitest';
import {
  formatIndexingCompleteLine,
  formatIndexingProgressSummary
} from '../src/core/indexer.js';
import type { IndexingStats } from '../src/types/index.js';

function baseStats(overrides: Partial<IndexingStats> = {}): IndexingStats {
  return {
    totalFiles: 100,
    indexedFiles: 90,
    skippedFiles: 10,
    totalChunks: 88424,
    searchableChunks: 5000,
    chunkLimitApplied: true,
    totalLines: 1,
    duration: 2500,
    avgChunkSize: 100,
    componentsByType: {},
    componentsByLayer: {
      core: 0,
      feature: 0,
      shared: 0,
      infrastructure: 0,
      unknown: 0
    },
    errors: [],
    startedAt: new Date(),
    ...overrides
  };
}

describe('indexer chunk limit reporting', () => {
  it('formatIndexingProgressSummary distinguishes analyzed vs searchable counts', () => {
    const line = formatIndexingProgressSummary(baseStats());
    expect(line).toContain('88424 chunks analyzed');
    expect(line).toContain('5000 chunks searchable');
  });

  it('formatIndexingCompleteLine shows searchable fraction when capped', () => {
    const line = formatIndexingCompleteLine(baseStats());
    expect(line).toBe('Complete: 90 files, 5000/88424 chunks searchable in 2.50s');
  });

  it('formatIndexingCompleteLine stays compact when no cap applied', () => {
    const line = formatIndexingCompleteLine(
      baseStats({ totalChunks: 120, searchableChunks: 120, chunkLimitApplied: false })
    );
    expect(line).toBe('Complete: 90 files, 120 chunks in 2.50s');
  });
});
