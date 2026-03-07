export type { ToolContext, ToolResponse, ToolPaths } from './types.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { definition as d1, handle as h1 } from './search-codebase.js';
import { definition as d2, handle as h2 } from './get-codebase-metadata.js';
import { definition as d3, handle as h3 } from './get-indexing-status.js';
import { definition as d4, handle as h4 } from './refresh-index.js';
import { definition as d5, handle as h5 } from './get-style-guide.js';
import { definition as d6, handle as h6 } from './get-team-patterns.js';
import { definition as d7, handle as h7 } from './get-symbol-references.js';
import { definition as d8, handle as h8 } from './detect-circular-dependencies.js';
import { definition as d9, handle as h9 } from './remember.js';
import { definition as d10, handle as h10 } from './get-memory.js';

import type { ToolContext, ToolResponse } from './types.js';

const PROJECT_DIRECTORY_PROPERTY: Record<string, string> = {
  type: 'string',
  description:
    'Optional absolute path or file:// URI for the project root to use when multiple roots are available.'
};

function withProjectDirectory(definition: Tool): Tool {
  const schema = definition.inputSchema;
  if (!schema || schema.type !== 'object') {
    return definition;
  }

  const properties = { ...(schema.properties ?? {}) };
  if ('project_directory' in properties) {
    return definition;
  }

  return {
    ...definition,
    inputSchema: {
      ...schema,
      properties: {
        ...properties,
        project_directory: PROJECT_DIRECTORY_PROPERTY
      }
    }
  };
}

export const TOOLS: Tool[] = [d1, d2, d3, d4, d5, d6, d7, d8, d9, d10].map(withProjectDirectory);

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  switch (name) {
    case 'search_codebase':
      return h1(args, ctx);
    case 'get_codebase_metadata':
      return h2(args, ctx);
    case 'get_indexing_status':
      return h3(args, ctx);
    case 'refresh_index':
      return h4(args, ctx);
    case 'get_style_guide':
      return h5(args, ctx);
    case 'get_team_patterns':
      return h6(args, ctx);
    case 'get_symbol_references':
      return h7(args, ctx);
    case 'detect_circular_dependencies':
      return h8(args, ctx);
    case 'remember':
      return h9(args, ctx);
    case 'get_memory':
      return h10(args, ctx);
    default:
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true
      };
  }
}
