import type { Tool } from '@modelcontextprotocol/server';
import type { ToolContext, ToolResponse } from './types.js';

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

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: ctx.indexState.status,
            rootPath: ctx.rootPath,
            lastIndexed: ctx.indexState.lastIndexed?.toISOString(),
            stats: ctx.indexState.stats
              ? {
                  totalFiles: ctx.indexState.stats.totalFiles,
                  indexedFiles: ctx.indexState.stats.indexedFiles,
                  totalChunks: ctx.indexState.stats.totalChunks,
                  duration: `${(ctx.indexState.stats.duration / 1000).toFixed(2)}s`,
                  incremental: ctx.indexState.stats.incremental
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
