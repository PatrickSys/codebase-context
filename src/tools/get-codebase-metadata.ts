import type { Tool } from '@modelcontextprotocol/server';
import { promises as fs } from 'fs';
import type { ToolContext, ToolResponse } from './types.js';
import { CodebaseIndexer } from '../core/indexer.js';

export const definition: Tool = {
  name: 'get_codebase_metadata',
  description:
    'Get codebase metadata including framework information, dependencies, architecture patterns, ' +
    'and project statistics.',
  inputSchema: {
    type: 'object',
    properties: {}
  }
};

export async function handle(
  _args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const indexer = new CodebaseIndexer({ rootPath: ctx.rootPath });
  const metadata = await indexer.detectMetadata();

  // Load team patterns from intelligence file
  let teamPatterns = {};
  try {
    const intelligencePath = ctx.paths.intelligence;
    const intelligenceContent = await fs.readFile(intelligencePath, 'utf-8');
    const intelligence = JSON.parse(intelligenceContent);

    if (intelligence.patterns) {
      teamPatterns = {
        dependencyInjection: intelligence.patterns.dependencyInjection,
        stateManagement: intelligence.patterns.stateManagement,
        componentInputs: intelligence.patterns.componentInputs
      };
    }
  } catch (_error) {
    // No intelligence file or parsing error
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: 'success',
            metadata: {
              name: metadata.name,
              framework: metadata.framework,
              languages: metadata.languages,
              dependencies: metadata.dependencies.slice(0, 20),
              architecture: metadata.architecture,
              projectStructure: metadata.projectStructure,
              statistics: metadata.statistics,
              teamPatterns
            }
          },
          null,
          2
        )
      }
    ]
  };
}
