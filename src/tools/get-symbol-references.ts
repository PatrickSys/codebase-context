import type { Tool } from '@modelcontextprotocol/server';
import type { ToolContext, ToolResponse } from './types.js';
import { findSymbolReferences } from '../core/symbol-references.js';

export const definition: Tool = {
  name: 'get_symbol_references',
  description:
    'Find concrete references to a symbol in indexed chunks. Returns total usageCount and top usage snippets.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol name to find references for (for example: parseConfig or UserService)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of usage snippets to return (default: 10)',
        default: 10
      }
    },
    required: ['symbol']
  }
};

export async function handle(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const { symbol, limit } = args as { symbol?: unknown; limit?: unknown };
  const normalizedSymbol = typeof symbol === 'string' ? symbol.trim() : '';
  const normalizedLimit =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;

  if (!normalizedSymbol) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'error',
              message: "Invalid params: 'symbol' is required and must be a non-empty string."
            },
            null,
            2
          )
        }
      ],
      isError: true
    };
  }

  const result = await findSymbolReferences(ctx.rootPath, normalizedSymbol, normalizedLimit);

  if (result.status === 'error') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'error',
              symbol: normalizedSymbol,
              message: result.message
            },
            null,
            2
          )
        }
      ]
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: 'success',
            symbol: result.symbol,
            usageCount: result.usageCount,
            usages: result.usages,
            confidence: result.confidence,
            isComplete: result.isComplete
          },
          null,
          2
        )
      }
    ]
  };
}
