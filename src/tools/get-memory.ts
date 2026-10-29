import type { Tool } from '@modelcontextprotocol/server';
import type { ToolContext, ToolResponse } from './types.js';
import type { MemoryCategory, MemoryType } from '../types/index.js';
import {
  readMemoriesFile,
  filterMemories,
  applyUnfilteredLimit,
  withConfidence
} from '../memory/store.js';

export const definition: Tool = {
  name: 'get_memory',
  description:
    'Retrieves team conventions, architectural decisions, and known gotchas.\n' +
    'CALL BEFORE suggesting patterns, libraries, or architecture.\n\n' +
    'Filters: category (tooling/architecture/testing/dependencies/conventions), type (convention/decision/gotcha), query (keyword search).',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category',
        enum: ['tooling', 'architecture', 'testing', 'dependencies', 'conventions']
      },
      type: {
        type: 'string',
        description: 'Filter by memory type',
        enum: ['convention', 'decision', 'gotcha', 'failure']
      },
      query: {
        type: 'string',
        description: 'Keyword search across memory and reason'
      }
    }
  }
};

export async function handle(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const { category, type, query } = args as {
    category?: MemoryCategory;
    type?: MemoryType;
    query?: string;
  };

  try {
    const memoryPath = ctx.paths.memory;
    const allMemories = await readMemoriesFile(memoryPath);

    if (allMemories.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'success',
                message:
                  "No team conventions recorded yet. Use 'remember' to build tribal knowledge or memory when the user corrects you over a repeatable pattern.",
                memories: [],
                count: 0
              },
              null,
              2
            )
          }
        ]
      };
    }

    const filtered = filterMemories(allMemories, { category, type, query });
    const limited = applyUnfilteredLimit(filtered, { category, type, query }, 20);

    // Enrich with confidence decay
    const enriched = withConfidence(limited.memories);
    const staleCount = enriched.filter((m) => m.stale).length;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'success',
              count: enriched.length,
              totalCount: limited.totalCount,
              truncated: limited.truncated,
              ...(staleCount > 0 && {
                staleCount,
                staleNote: `${staleCount} memor${staleCount === 1 ? 'y' : 'ies'} below 30% confidence. Consider reviewing or removing.`
              }),
              message: limited.truncated
                ? 'Showing 20 most recent. Use filters (category/type/query) for targeted results.'
                : undefined,
              memories: enriched
            },
            null,
            2
          )
        }
      ]
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'error',
              message: 'Failed to retrieve memories.',
              error: error instanceof Error ? error.message : String(error)
            },
            null,
            2
          )
        }
      ]
    };
  }
}
