import { withToolIndexSnapshot } from './index-snapshot.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import type { ToolContext, ToolResponse } from './types.js';
import { InternalFileGraph } from '../utils/usage-tracker.js';
import type { FileExport } from '../utils/usage-tracker.js';
import { RELATIONSHIPS_FILENAME } from '../constants/codebase-context.js';

export const definition: Tool = {
  name: 'detect_circular_dependencies',
  description:
    'Analyze the import graph to detect circular dependencies between files. ' +
    'Circular dependencies can cause initialization issues, tight coupling, and maintenance problems. ' +
    'Returns all detected cycles sorted by length (shorter cycles are often more problematic).',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: "Optional path prefix to limit analysis (e.g., 'src/features', 'libs/shared')"
      }
    }
  }
};

export async function handle(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  return withToolIndexSnapshot(ctx, (pinned) => handlePinned(args, pinned));
}

async function handlePinned(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const { scope } = args as { scope?: string };

  try {
    // Try relationships sidecar first (preferred), then intelligence
    let graphDataSource: {
      imports?: Record<string, string[]>;
      exports?: Record<string, FileExport[]>;
    } | null = null;
    let graphStats: unknown = null;

    const relationshipsPath = path.join(
      path.dirname(ctx.paths.intelligence),
      RELATIONSHIPS_FILENAME
    );
    try {
      const relationshipsContent = await fs.readFile(relationshipsPath, 'utf-8');
      const relationships = JSON.parse(relationshipsContent);
      if (relationships?.graph) {
        graphDataSource = relationships.graph;
        graphStats = relationships.stats;
      }
    } catch {
      // Relationships sidecar not available, try intelligence
    }

    if (!graphDataSource) {
      const intelligencePath = ctx.paths.intelligence;
      const content = await fs.readFile(intelligencePath, 'utf-8');
      const intelligence = JSON.parse(content);
      if (intelligence.internalFileGraph) {
        graphDataSource = intelligence.internalFileGraph;
        graphStats = intelligence.internalFileGraph.stats;
      }
    }

    if (!graphDataSource) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'error',
                message:
                  'Internal file graph not found. Please run refresh_index to rebuild the index with cycle detection support.'
              },
              null,
              2
            )
          }
        ]
      };
    }

    // Reconstruct the graph from stored data
    const graph = InternalFileGraph.fromJSON(graphDataSource, ctx.rootPath);
    const cycles = graph.findCycles(scope);
    const stats = graphStats || graph.getStats();

    if (cycles.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'success',
                message: scope
                  ? `No circular dependencies detected in scope: ${scope}`
                  : 'No circular dependencies detected in the codebase.',
                scope,
                graphStats: stats
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
              status: 'warning',
              message: `Found ${cycles.length} circular dependency cycle(s).`,
              scope,
              cycles: cycles.map((c) => ({
                files: c.files,
                length: c.length,
                severity: c.length === 2 ? 'high' : c.length <= 3 ? 'medium' : 'low'
              })),
              count: cycles.length,
              graphStats: stats,
              advice:
                'Shorter cycles (length 2-3) are typically more problematic. Consider breaking the cycle by extracting shared dependencies.'
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
              message: 'Failed to detect circular dependencies. Run indexing first.',
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
