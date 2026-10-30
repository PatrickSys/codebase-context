import { withToolIndexSnapshot } from './index-snapshot.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import { glob } from 'glob';
import path from 'path';
import type { ToolContext, ToolResponse } from './types.js';

export const definition: Tool = {
  name: 'get_style_guide',
  description: 'Query style guide rules and architectural patterns from project documentation.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Query for specific style guide rules (e.g., "component naming", "service patterns")'
      },
      category: {
        type: 'string',
        description: 'Filter by category (naming, structure, patterns, testing)'
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
  const { query, category } = args as {
    query?: string;
    category?: string;
  };
  const queryStr = typeof query === 'string' ? query.trim() : '';
  const queryLower = queryStr.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(Boolean);
  const categoryLower = typeof category === 'string' ? category.trim().toLowerCase() : '';
  const limitedMode = queryTerms.length === 0;
  const LIMITED_MAX_FILES = 3;
  const LIMITED_MAX_SECTIONS_PER_FILE = 2;

  const styleGuidePatterns = [
    'STYLE_GUIDE.md',
    'CODING_STYLE.md',
    'ARCHITECTURE.md',
    'CONTRIBUTING.md',
    'docs/style-guide.md',
    'docs/coding-style.md',
    'docs/ARCHITECTURE.md'
  ];

  const foundGuides: Array<{
    file: string;
    content: string;
    relevantSections: string[];
  }> = [];

  for (const pattern of styleGuidePatterns) {
    try {
      const files = await glob(pattern, {
        cwd: ctx.rootPath,
        absolute: true
      });
      for (const file of files) {
        try {
          // Normalize line endings to \n for consistent output
          const rawContent = await fs.readFile(file, 'utf-8');
          const content = rawContent.replace(/\r\n/g, '\n');
          const relativePath = path.relative(ctx.rootPath, file);

          // Find relevant sections based on query
          const sections = content.split(/^##\s+/m);
          const relevantSections: string[] = [];
          if (limitedMode) {
            const headings = (content.match(/^##\s+.+$/gm) || [])
              .map((h) => h.trim())
              .filter(Boolean)
              .slice(0, LIMITED_MAX_SECTIONS_PER_FILE);

            if (headings.length > 0) {
              relevantSections.push(...headings);
            } else {
              const words = content.split(/\s+/).filter(Boolean);
              if (words.length > 0) {
                relevantSections.push(`Overview: ${words.slice(0, 80).join(' ')}...`);
              }
            }
          } else {
            for (const section of sections) {
              const sectionLower = section.toLowerCase();
              const isRelevant = queryTerms.some((term) => sectionLower.includes(term));
              if (isRelevant) {
                // Limit section size to ~500 words
                const words = section.split(/\s+/);
                const truncated = words.slice(0, 500).join(' ');
                relevantSections.push(
                  '## ' + (words.length > 500 ? truncated + '...' : section.trim())
                );
              }
            }
          }

          const categoryMatch =
            !categoryLower ||
            relativePath.toLowerCase().includes(categoryLower) ||
            relevantSections.some((section) => section.toLowerCase().includes(categoryLower));
          if (!categoryMatch) {
            continue;
          }

          if (relevantSections.length > 0) {
            foundGuides.push({
              file: relativePath,
              content: content.slice(0, 200) + '...',
              relevantSections: relevantSections.slice(
                0,
                limitedMode ? LIMITED_MAX_SECTIONS_PER_FILE : 3
              )
            });
          }
        } catch (_e) {
          // Skip unreadable files
        }
      }
    } catch (_e) {
      // Pattern didn't match, continue
    }
  }

  const results = limitedMode ? foundGuides.slice(0, LIMITED_MAX_FILES) : foundGuides;

  if (results.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'no_results',
              message: limitedMode
                ? 'No style guide files found in the default locations.'
                : `No style guide content found matching: ${queryStr}`,
              searchedPatterns: styleGuidePatterns,
              hint: limitedMode
                ? "Run get_style_guide with a query or category (e.g. category: 'testing') for targeted results."
                : "Try broader terms like 'naming', 'patterns', 'testing', 'components'"
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
            query: queryStr || undefined,
            category,
            limited: limitedMode,
            notice: limitedMode
              ? 'No query provided. Results are capped. Provide query and/or category for targeted guidance.'
              : undefined,
            resultLimits: limitedMode
              ? {
                  maxFiles: LIMITED_MAX_FILES,
                  maxSectionsPerFile: LIMITED_MAX_SECTIONS_PER_FILE
                }
              : undefined,
            results,
            totalFiles: results.length,
            totalMatches: foundGuides.length
          },
          null,
          2
        )
      }
    ]
  };
}
