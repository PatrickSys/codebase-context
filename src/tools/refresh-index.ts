import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResponse } from './types.js';

export const definition: Tool = {
  name: 'refresh_index',
  description:
    'Re-index the codebase. Supports full re-index or incremental mode. ' +
    'Use incrementalOnly=true to process changed files. Omit skipEmbedding to preserve the last ' +
    'successful mode; true disables both embedding and reranker models. Mode changes force a full rebuild.',
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
          'True: model-free indexing and search (no embeddings or reranker). False: opt into semantic models. Omitted: preserve the successful build mode.'
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
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'invalid_input',
            message: 'skipEmbedding must be a boolean'
          })
        }
      ]
    };
  }
  if (ctx.indexState.status === 'indexing') {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'busy',
            message:
              'An index build is already running. Retry this refresh after it completes; no new mode has been applied.'
          })
        }
      ]
    };
  }
  const { reason, incrementalOnly, skipEmbedding } = args as {
    reason?: string;
    incrementalOnly?: boolean;
    skipEmbedding?: boolean;
  };

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
