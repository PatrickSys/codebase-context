import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResponse } from './types.js';
import { indexHealthByFile, normalizeHealthLookupKey, readHealthFile } from '../health/store.js';

export const definition: Tool = {
  name: 'get_codebase_health',
  description:
    'Get actionable codebase health signals from the latest index. Returns the highest-risk files and their reasons, or a single file when requested.',
  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Optional file path to inspect a single file-level health record.'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of files to return when no file is specified (default: 10).',
        default: 10
      },
      level: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Optional minimum health level to return.'
      }
    }
  }
};

export async function handle(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const file = typeof args.file === 'string' ? args.file.trim() : undefined;
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 10;
  const level =
    args.level === 'low' || args.level === 'medium' || args.level === 'high'
      ? args.level
      : undefined;

  const health = await readHealthFile(ctx.paths.health);
  if (!health) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'no_data',
              message:
                'No codebase health artifact found. Run refresh_index to generate health.json.'
            },
            null,
            2
          )
        }
      ]
    };
  }

  const orderedLevels = { high: 3, medium: 2, low: 1 };
  const minLevel = level ? orderedLevels[level] : 1;

  if (file) {
    const byFile = indexHealthByFile(health, ctx.rootPath);
    const fileHealth = byFile.get(normalizeHealthLookupKey(file, ctx.rootPath));
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            fileHealth
              ? {
                  status: 'success',
                  generatedAt: health.generatedAt,
                  file: fileHealth
                }
              : {
                  status: 'not_found',
                  message: `No health record found for ${file}.`,
                  generatedAt: health.generatedAt
                },
            null,
            2
          )
        }
      ]
    };
  }

  const files = health.files
    .filter((entry) => orderedLevels[entry.level] >= minLevel)
    .slice(0, Math.max(1, Math.floor(limit)));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: 'success',
            generatedAt: health.generatedAt,
            summary: health.summary,
            files
          },
          null,
          2
        )
      }
    ]
  };
}
