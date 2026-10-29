import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { assertEmbeddingRuntimeAvailable } from '../embeddings/index.js';
import { OptionalDependencyError } from '../errors/index.js';
import { assertStorageRuntimeAvailable } from '../storage/index.js';
import type { ToolContext, ToolResponse } from './types.js';

export const definition: Tool = {
  name: 'refresh_index',
  description:
    'Re-index the codebase. Supports full re-index or incremental mode. ' +
    'Use incrementalOnly=true to process changed files. Omit skipEmbedding to preserve the last successful mode; true disables embedding and reranker models, false opts into semantic embeddings. Mode changes require a full rebuild.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Reason for refreshing the index (for logging)'
      },
      incrementalOnly: {
        type: 'boolean',
        description:
          'If true, only re-index files changed since last full index (faster). Default: false (full re-index)'
      },
      skipEmbedding: {
        type: 'boolean',
        description:
          'True selects model-free indexing; false explicitly opts into semantic embeddings. Omit to preserve the last successful mode.'
      }
    }
  }
};

export async function handle(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  if (args.skipEmbedding !== undefined && typeof args.skipEmbedding !== 'boolean') {
    return {
      isError: true,
      content: [{ type: 'text', text: 'skipEmbedding must be a boolean' }]
    };
  }
  if (ctx.indexState.status === 'indexing') {
    return {
      isError: true,
      content: [
        { type: 'text', text: 'An index build is already running; retry after it completes.' }
      ]
    };
  }
  const { reason, incrementalOnly, skipEmbedding } = args as {
    reason?: string;
    incrementalOnly?: boolean;
    skipEmbedding?: boolean;
  };

  if (skipEmbedding === false) {
    try {
      assertEmbeddingRuntimeAvailable();
      assertStorageRuntimeAvailable();
    } catch (error) {
      if (error instanceof OptionalDependencyError) {
        return {
          isError: true,
          content: [{ type: 'text', text: error.message }]
        };
      }
      throw error;
    }
  }

  const mode = incrementalOnly ? 'incremental' : 'full';
  console.error(`Refresh requested (${mode}): ${reason || 'Manual trigger'}`);

  void ctx.performIndexing(incrementalOnly, reason, skipEmbedding);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: 'started',
            mode,
            message: incrementalOnly
              ? 'Incremental re-indexing started. A changed embedding mode requires a full rebuild.'
              : 'Full re-indexing started. Check status with get_indexing_status.',
            reason
          },
          null,
          2
        )
      }
    ]
  };
}
