import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResponse } from './types.js';
import { findSymbolReferences, type SymbolReferencesResult } from '../core/symbol-references.js';
import { IndexCorruptedError } from '../errors/index.js';

export const definition: Tool = {
  name: 'get_symbol_references',
  description:
    'Find current-source references across the files recorded by the last successful index. Returns observed usageCount, bounded snippets, parser confidence, and coverage.',
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

  let result: SymbolReferencesResult;
  try {
    result = await findSymbolReferences(ctx.rootPath, normalizedSymbol, normalizedLimit);
  } catch (error) {
    if (!(error instanceof IndexCorruptedError)) throw error;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'error',
              symbol: normalizedSymbol,
              message: error.message
            },
            null,
            2
          )
        }
      ],
      isError: true
    };
  }

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
      ],
      isError: true
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
            isComplete: result.isComplete,
            coverage: result.coverage
          },
          null,
          2
        )
      }
    ]
  };
}
