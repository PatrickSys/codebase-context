import type { Tool } from '@modelcontextprotocol/server';
import type { ToolContext, ToolResponse } from './types.js';

export const definition: Tool = {
  name: 'refresh_index',
  description:
    'Re-index the codebase. Supports full re-index or incremental mode. ' +
    'Use incrementalOnly=true to only process files changed since last index.',
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
      }
    }
  }
};

export async function handle(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const { reason, incrementalOnly } = args as { reason?: string; incrementalOnly?: boolean };

  const mode = incrementalOnly ? 'incremental' : 'full';
  console.error(`Refresh requested (${mode}): ${reason || 'Manual trigger'}`);

  ctx.performIndexing(incrementalOnly);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: 'started',
            mode,
            message: incrementalOnly
              ? 'Incremental re-indexing started. Only changed files will be re-embedded.'
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
