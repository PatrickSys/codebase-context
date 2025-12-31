#!/usr/bin/env node

/**
 * MCP Server for Codebase Context
 * Provides codebase indexing and semantic search capabilities
 */

import { promises as fs } from "fs";

import path from "path";
import { glob } from "glob";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
  Resource,
} from "@modelcontextprotocol/sdk/types.js";
import { CodebaseIndexer } from "./core/indexer.js";
import { IndexingStats } from "./types/index.js";
import { CodebaseSearcher } from "./core/search.js";
import { analyzerRegistry } from "./core/analyzer-registry.js";
import { AngularAnalyzer } from "./analyzers/angular/index.js";
import { GenericAnalyzer } from "./analyzers/generic/index.js";
import { InternalFileGraph } from "./utils/usage-tracker.js";


analyzerRegistry.register(new AngularAnalyzer());
analyzerRegistry.register(new GenericAnalyzer());

// Resolve root path with validation
function resolveRootPath(): string {
  const arg = process.argv[2];
  const envPath = process.env.CODEBASE_ROOT;

  // Priority: CLI arg > env var > cwd
  let rootPath = arg || envPath || process.cwd();
  rootPath = path.resolve(rootPath);

  // Warn if using cwd as fallback (guarded to avoid stderr during MCP STDIO handshake)
  if (!arg && !envPath && process.env.CODEBASE_CONTEXT_DEBUG) {
    console.error(
      `[DEBUG] No project path specified. Using current directory: ${rootPath}`
    );
    console.error(
      `[DEBUG] Hint: Specify path as CLI argument or set CODEBASE_ROOT env var`
    );
  }

  return rootPath;
}

const ROOT_PATH = resolveRootPath();

export interface IndexState {
  status: "idle" | "indexing" | "ready" | "error";
  lastIndexed?: Date;
  stats?: IndexingStats;
  error?: string;
  indexer?: CodebaseIndexer;
}

const indexState: IndexState = {
  status: "idle",
};


const server = new Server(
  {
    name: "codebase-context",
    version: "1.2.2",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

const TOOLS: Tool[] = [
  {
    name: "search_codebase",
    description:
      "Search the indexed codebase using natural language queries. Returns code summaries with file locations. " +
      "Supports framework-specific queries and architectural layer filtering. " +
      "Use the returned filePath with other tools to read complete file contents.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
          default: 5,
        },
        filters: {
          type: "object",
          description: "Optional filters",
          properties: {
            framework: {
              type: "string",
              description: "Filter by framework (angular, react, vue)",
            },
            language: {
              type: "string",
              description: "Filter by programming language",
            },
            componentType: {
              type: "string",
              description:
                "Filter by component type (component, service, directive, etc.)",
            },
            layer: {
              type: "string",
              description:
                "Filter by architectural layer (presentation, business, data, state, core, shared)",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Filter by tags",
            },
          },
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_codebase_metadata",
    description:
      "Get codebase metadata including framework information, dependencies, architecture patterns, " +
      "and project statistics.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_indexing_status",
    description:
      "Get current indexing status: state, statistics, and progress. " +
      "Use refresh_index to manually trigger re-indexing when needed.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "refresh_index",
    description:
      "Re-index the codebase. Supports full re-index or incremental mode. " +
      "Use incrementalOnly=true to only process files changed since last index.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Reason for refreshing the index (for logging)",
        },
        incrementalOnly: {
          type: "boolean",
          description: "If true, only re-index files changed since last full index (faster). Default: false (full re-index)",
        },
      },
    },
  },

  {
    name: "get_style_guide",
    description:
      "Query style guide rules and architectural patterns from project documentation.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Query for specific style guide rules (e.g., "component naming", "service patterns")',
        },
        category: {
          type: "string",
          description:
            "Filter by category (naming, structure, patterns, testing)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_team_patterns",
    description:
      "Get actionable team pattern recommendations based on codebase analysis. " +
      "Returns consensus patterns for DI, state management, testing, library wrappers, etc.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Pattern category to retrieve",
          enum: ["all", "di", "state", "testing", "libraries"],
        },
      },
    },
  },
  {
    name: "get_component_usage",
    description:
      "Find WHERE a library or component is used in the codebase. " +
      "This is 'Find Usages' - returns all files that import a given package/module. " +
      "Example: get_component_usage('@mycompany/utils') → shows all 34 files using it.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Import source to find usages for (e.g., 'primeng/table', '@mycompany/ui/button', 'lodash')",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "detect_circular_dependencies",
    description:
      "Analyze the import graph to detect circular dependencies between files. " +
      "Circular dependencies can cause initialization issues, tight coupling, and maintenance problems. " +
      "Returns all detected cycles sorted by length (shorter cycles are often more problematic).",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Optional path prefix to limit analysis (e.g., 'src/features', 'libs/shared')",
        },
      },
    },
  },
];


server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// MCP Resources - Proactive context injection
const RESOURCES: Resource[] = [
  {
    uri: "codebase://context",
    name: "Codebase Intelligence",
    description:
      "Automatic codebase context: libraries used, team patterns, and conventions. " +
      "Read this BEFORE generating code to follow team standards.",
    mimeType: "text/plain",
  },
];

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources: RESOURCES };
});

async function generateCodebaseContext(): Promise<string> {
  const intelligencePath = path.join(ROOT_PATH, ".codebase-intelligence.json");

  try {
    const content = await fs.readFile(intelligencePath, "utf-8");
    const intelligence = JSON.parse(content);

    const lines: string[] = [];
    lines.push("# Codebase Intelligence");
    lines.push("");
    lines.push(
      "⚠️  CRITICAL: This is what YOUR codebase actually uses, not generic recommendations."
    );
    lines.push(
      "These are FACTS from analyzing your code, not best practices from the internet."
    );
    lines.push("");

    // Library usage - sorted by count
    const libraryEntries = Object.entries(intelligence.libraryUsage || {})
      .map(([lib, data]: [string, any]) => ({
        lib,
        count: data.count,
      }))
      .sort((a, b) => b.count - a.count);

    if (libraryEntries.length > 0) {
      lines.push("## Libraries Actually Used (Top 15)");
      lines.push("");

      for (const { lib, count } of libraryEntries.slice(0, 15)) {
        lines.push(`- **${lib}** (${count} uses)`);
      }
      lines.push("");
    }

    // Show tsconfig paths if available (helps AI understand internal imports)
    if (intelligence.tsconfigPaths && Object.keys(intelligence.tsconfigPaths).length > 0) {
      lines.push("## Import Aliases (from tsconfig.json)");
      lines.push("");
      lines.push("These path aliases map to internal project code:");
      for (const [alias, paths] of Object.entries(intelligence.tsconfigPaths)) {
        lines.push(`- \`${alias}\` → ${(paths as string[]).join(", ")}`);
      }
      lines.push("");
    }

    // Pattern consensus
    if (intelligence.patterns && Object.keys(intelligence.patterns).length > 0) {
      lines.push("## YOUR Codebase's Actual Patterns (Not Generic Best Practices)");
      lines.push("");
      lines.push("These patterns were detected by analyzing your actual code.");
      lines.push("This is what YOUR team does in practice, not what tutorials recommend.");
      lines.push("");

      for (const [category, data] of Object.entries(intelligence.patterns)) {
        const patternData: any = data;
        const primary = patternData.primary;

        if (!primary) continue;

        const percentage = parseInt(primary.frequency);
        const categoryName = category
          .replace(/([A-Z])/g, " $1")
          .trim()
          .replace(/^./, (str: string) => str.toUpperCase());

        if (percentage === 100) {
          lines.push(`### ${categoryName}: **${primary.name}** (${primary.frequency} - unanimous)`);
          lines.push(`   → Your codebase is 100% consistent - ALWAYS use ${primary.name}`);
        } else if (percentage >= 80) {
          lines.push(`### ${categoryName}: **${primary.name}** (${primary.frequency} - strong consensus)`);
          lines.push(`   → Your team strongly prefers ${primary.name}`);
          if (patternData.alsoDetected?.length) {
            const alt = patternData.alsoDetected[0];
            lines.push(`   → Minority pattern: ${alt.name} (${alt.frequency}) - avoid for new code`);
          }
        } else if (percentage >= 60) {
          lines.push(`### ${categoryName}: **${primary.name}** (${primary.frequency} - majority)`);
          lines.push(`   → Most code uses ${primary.name}, but not unanimous`);
          if (patternData.alsoDetected?.length) {
            lines.push(
              `   → Also detected: ${patternData.alsoDetected[0].name} (${patternData.alsoDetected[0].frequency})`
            );
          }
        } else {
          // Split decision
          lines.push(`### ${categoryName}: ⚠️ NO TEAM CONSENSUS`);
          lines.push(`   Your codebase is split between multiple approaches:`);
          lines.push(`   - ${primary.name} (${primary.frequency})`);
          if (patternData.alsoDetected?.length) {
            for (const alt of patternData.alsoDetected.slice(0, 2)) {
              lines.push(`   - ${alt.name} (${alt.frequency})`);
            }
          }
          lines.push(`   → ASK the team which approach to use for new features`);
        }
        lines.push("");
      }
    }

    lines.push("---");
    lines.push(
      `Generated: ${intelligence.generatedAt || new Date().toISOString()}`
    );

    return lines.join("\n");
  } catch (error) {
    return (
      "# Codebase Intelligence\n\n" +
      "Intelligence data not yet generated. Run indexing first.\n" +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  if (uri === "codebase://context") {
    const content = await generateCodebaseContext();

    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: content,
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

async function performIndexing(): Promise<void> {
  indexState.status = "indexing";
  console.error(`Indexing: ${ROOT_PATH}`);

  try {
    let lastLoggedProgress = { phase: "", percentage: -1 };
    const indexer = new CodebaseIndexer({
      rootPath: ROOT_PATH,
      onProgress: (progress) => {
        // Only log when phase or percentage actually changes (prevents duplicate logs)
        const shouldLog =
          progress.phase !== lastLoggedProgress.phase ||
          (progress.percentage % 10 === 0 && progress.percentage !== lastLoggedProgress.percentage);

        if (shouldLog) {
          console.error(`[${progress.phase}] ${progress.percentage}%`);
          lastLoggedProgress = { phase: progress.phase, percentage: progress.percentage };
        }
      },
    });

    indexState.indexer = indexer;
    const stats = await indexer.index();

    indexState.status = "ready";
    indexState.lastIndexed = new Date();
    indexState.stats = stats;

    console.error(
      `Complete: ${stats.indexedFiles} files, ${stats.totalChunks} chunks in ${(
        stats.duration / 1000
      ).toFixed(2)}s`
    );
  } catch (error) {
    indexState.status = "error";
    indexState.error = error instanceof Error ? error.message : String(error);
    console.error("Indexing failed:", indexState.error);
  }
}

async function shouldReindex(): Promise<boolean> {
  const indexPath = path.join(ROOT_PATH, ".codebase-index.json");
  try {
    await fs.access(indexPath);
    return false;
  } catch {
    return true;
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_codebase": {
        const { query, limit, filters } = args as any;

        if (indexState.status === "indexing") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "indexing",
                    message: "Index is still being built. Retry in a moment.",
                    progress: indexState.indexer?.getProgress(),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        if (indexState.status === "error") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "error",
                    message: `Indexing failed: ${indexState.error}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const searcher = new CodebaseSearcher(ROOT_PATH);
        const results = await searcher.search(query, limit || 5, filters);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "success",
                  results: results.map((r) => ({
                    summary: r.summary,
                    snippet: r.snippet,
                    filePath: `${r.filePath}:${r.startLine}-${r.endLine}`,
                    score: r.score,
                    relevanceReason: r.relevanceReason,
                    componentType: r.componentType,
                    layer: r.layer,
                    framework: r.framework,
                    // v1.2: Pattern momentum awareness
                    trend: r.trend,
                    patternWarning: r.patternWarning,
                  })),
                  totalResults: results.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_indexing_status": {
        const progress = indexState.indexer?.getProgress();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: indexState.status,
                  rootPath: ROOT_PATH,
                  lastIndexed: indexState.lastIndexed?.toISOString(),
                  stats: indexState.stats
                    ? {
                      totalFiles: indexState.stats.totalFiles,
                      indexedFiles: indexState.stats.indexedFiles,
                      totalChunks: indexState.stats.totalChunks,
                      duration: `${(indexState.stats.duration / 1000).toFixed(2)}s`,
                    }
                    : undefined,
                  progress: progress
                    ? {
                      phase: progress.phase,
                      percentage: progress.percentage,
                      filesProcessed: progress.filesProcessed,
                      totalFiles: progress.totalFiles,
                    }
                    : undefined,
                  error: indexState.error,
                  hint: "Use refresh_index to manually trigger re-indexing when needed.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "refresh_index": {
        const { reason, incrementalOnly } = args as { reason?: string; incrementalOnly?: boolean };

        const mode = incrementalOnly ? "incremental" : "full";
        console.error(`Refresh requested (${mode}): ${reason || "Manual trigger"}`);

        // TODO: When incremental indexing is implemented (Phase 2),
        // use `incrementalOnly` to only re-index changed files.
        // For now, always do full re-index but acknowledge the intention.
        performIndexing();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "started",
                  mode,
                  message: incrementalOnly
                    ? "Incremental re-indexing requested. Check status with get_indexing_status."
                    : "Full re-indexing started. Check status with get_indexing_status.",
                  reason,
                  note: incrementalOnly
                    ? "Incremental mode requested. Full re-index for now; true incremental indexing coming in Phase 2."
                    : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_codebase_metadata": {
        const indexer = new CodebaseIndexer({ rootPath: ROOT_PATH });
        const metadata = await indexer.detectMetadata();

        // Load team patterns from intelligence file
        let teamPatterns = {};
        try {
          const intelligencePath = path.join(ROOT_PATH, ".codebase-intelligence.json");
          const intelligenceContent = await fs.readFile(intelligencePath, "utf-8");
          const intelligence = JSON.parse(intelligenceContent);

          if (intelligence.patterns) {
            teamPatterns = {
              dependencyInjection: intelligence.patterns.dependencyInjection,
              stateManagement: intelligence.patterns.stateManagement,
              componentInputs: intelligence.patterns.componentInputs,
            };
          }
        } catch (error) {
          // No intelligence file or parsing error
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "success",
                  metadata: {
                    name: metadata.name,
                    framework: metadata.framework,
                    languages: metadata.languages,
                    dependencies: metadata.dependencies.slice(0, 20),
                    architecture: metadata.architecture,
                    projectStructure: metadata.projectStructure,
                    statistics: metadata.statistics,
                    teamPatterns,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_style_guide": {
        const { query, category } = args as {
          query: string;
          category?: string;
        };

        const styleGuidePatterns = [
          "STYLE_GUIDE.md",
          "CODING_STYLE.md",
          "ARCHITECTURE.md",
          "CONTRIBUTING.md",
          "docs/style-guide.md",
          "docs/coding-style.md",
          "docs/ARCHITECTURE.md",
        ];

        const foundGuides: Array<{
          file: string;
          content: string;
          relevantSections: string[];
        }> = [];
        const queryLower = query.toLowerCase();
        const queryTerms = queryLower.split(/\s+/);

        for (const pattern of styleGuidePatterns) {
          try {
            const files = await glob(pattern, {
              cwd: ROOT_PATH,
              absolute: true,
            });
            for (const file of files) {
              try {
                // Normalize line endings to \n for consistent output
                const rawContent = await fs.readFile(file, "utf-8");
                const content = rawContent.replace(/\r\n/g, "\n");
                const relativePath = path.relative(ROOT_PATH, file);

                // Find relevant sections based on query
                const sections = content.split(/^##\s+/m);
                const relevantSections: string[] = [];

                for (const section of sections) {
                  const sectionLower = section.toLowerCase();
                  const isRelevant = queryTerms.some((term) =>
                    sectionLower.includes(term)
                  );
                  if (isRelevant) {
                    // Limit section size to ~500 words
                    const words = section.split(/\s+/);
                    const truncated = words.slice(0, 500).join(" ");
                    relevantSections.push(
                      "## " +
                      (words.length > 500
                        ? truncated + "..."
                        : section.trim())
                    );
                  }
                }

                if (relevantSections.length > 0) {
                  foundGuides.push({
                    file: relativePath,
                    content: content.slice(0, 200) + "...",
                    relevantSections: relevantSections.slice(0, 3), // Max 3 sections per file
                  });
                }
              } catch (e) {
                // Skip unreadable files
              }
            }
          } catch (e) {
            // Pattern didn't match, continue
          }
        }

        if (foundGuides.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "no_results",
                    message: `No style guide content found matching: ${query}`,
                    searchedPatterns: styleGuidePatterns,
                    hint: "Try broader terms like 'naming', 'patterns', 'testing', 'components'",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "success",
                  query,
                  category,
                  results: foundGuides,
                  totalFiles: foundGuides.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }
      case "get_team_patterns": {
        const { category } = args as { category?: string };

        try {
          const intelligencePath = path.join(ROOT_PATH, ".codebase-intelligence.json");
          const content = await fs.readFile(intelligencePath, "utf-8");
          const intelligence = JSON.parse(content);

          const result: any = { status: "success" };

          if (category === "all" || !category) {
            result.patterns = intelligence.patterns || {};
            result.goldenFiles = intelligence.goldenFiles || [];
            if (intelligence.tsconfigPaths) {
              result.tsconfigPaths = intelligence.tsconfigPaths;
            }
          } else if (category === "di") {
            result.dependencyInjection = intelligence.patterns?.dependencyInjection;
          } else if (category === "state") {
            result.stateManagement = intelligence.patterns?.stateManagement;
          } else if (category === "testing") {
            result.testingFramework = intelligence.patterns?.testingFramework;
            result.testMocking = intelligence.patterns?.testMocking;
          } else if (category === "libraries") {
            result.topUsed = intelligence.importGraph?.topUsed || [];
            if (intelligence.tsconfigPaths) {
              result.tsconfigPaths = intelligence.tsconfigPaths;
            }
          }

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "error",
                  message: "Failed to load team patterns",
                  error: error instanceof Error ? error.message : String(error),
                }, null, 2),
              },
            ],
          };
        }
      }

      case "get_component_usage": {
        const { name: componentName } = args as { name: string };

        try {
          const intelligencePath = path.join(ROOT_PATH, ".codebase-intelligence.json");
          const content = await fs.readFile(intelligencePath, "utf-8");
          const intelligence = JSON.parse(content);

          const importGraph = intelligence.importGraph || {};
          const usages = importGraph.usages || {};

          // Find matching usages (exact match or partial match)
          let matchedUsage = usages[componentName];

          // Try partial match if exact match not found
          if (!matchedUsage) {
            const matchingKeys = Object.keys(usages).filter(key =>
              key.includes(componentName) || componentName.includes(key)
            );
            if (matchingKeys.length > 0) {
              matchedUsage = usages[matchingKeys[0]];
            }
          }

          if (matchedUsage) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  component: componentName,
                  usageCount: matchedUsage.usageCount,
                  usedIn: matchedUsage.usedIn,
                }, null, 2),
              }],
            };
          } else {
            // Show top used as alternatives
            const topUsed = importGraph.topUsed || [];
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "not_found",
                  component: componentName,
                  message: `No usages found for '${componentName}'.`,
                  suggestions: topUsed.slice(0, 10),
                }, null, 2),
              }],
            };
          }
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "error",
                message: "Failed to get component usage. Run indexing first.",
                error: error instanceof Error ? error.message : String(error),
              }, null, 2),
            }],
          };
        }
      }

      case "detect_circular_dependencies": {
        const { scope } = args as { scope?: string };

        try {
          const intelligencePath = path.join(ROOT_PATH, ".codebase-intelligence.json");
          const content = await fs.readFile(intelligencePath, "utf-8");
          const intelligence = JSON.parse(content);

          if (!intelligence.internalFileGraph) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "error",
                  message: "Internal file graph not found. Please run refresh_index to rebuild the index with cycle detection support.",
                }, null, 2),
              }],
            };
          }

          // Reconstruct the graph from stored data
          const graph = InternalFileGraph.fromJSON(intelligence.internalFileGraph, ROOT_PATH);
          const cycles = graph.findCycles(scope);
          const graphStats = intelligence.internalFileGraph.stats || graph.getStats();

          if (cycles.length === 0) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  message: scope
                    ? `No circular dependencies detected in scope: ${scope}`
                    : "No circular dependencies detected in the codebase.",
                  scope,
                  graphStats,
                }, null, 2),
              }],
            };
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "warning",
                message: `Found ${cycles.length} circular dependency cycle(s).`,
                scope,
                cycles: cycles.map(c => ({
                  files: c.files,
                  length: c.length,
                  severity: c.length === 2 ? "high" : c.length <= 3 ? "medium" : "low",
                })),
                count: cycles.length,
                graphStats,
                advice: "Shorter cycles (length 2-3) are typically more problematic. Consider breaking the cycle by extracting shared dependencies.",
              }, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "error",
                message: "Failed to detect circular dependencies. Run indexing first.",
                error: error instanceof Error ? error.message : String(error),
              }, null, 2),
            }],
          };
        }
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: `Unknown tool: ${name}`,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  // Server startup banner (guarded to avoid stderr during MCP STDIO handshake)
  if (process.env.CODEBASE_CONTEXT_DEBUG) {
    console.error("[DEBUG] Codebase Context MCP Server");
    console.error(`[DEBUG] Root: ${ROOT_PATH}`);
    console.error(
      `[DEBUG] Analyzers: ${analyzerRegistry
        .getAll()
        .map((a) => a.name)
        .join(", ")}`
    );
  }

  // Validate root path exists and is a directory
  try {
    const stats = await fs.stat(ROOT_PATH);
    if (!stats.isDirectory()) {
      console.error(`ERROR: Root path is not a directory: ${ROOT_PATH}`);
      console.error(`Please specify a valid project directory.`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: Root path does not exist: ${ROOT_PATH}`);
    console.error(`Please specify a valid project directory.`);
    process.exit(1);
  }

  // Check for package.json to confirm it's a project root (guarded to avoid stderr during handshake)
  if (process.env.CODEBASE_CONTEXT_DEBUG) {
    try {
      await fs.access(path.join(ROOT_PATH, "package.json"));
      console.error(`[DEBUG] Project detected: ${path.basename(ROOT_PATH)}`);
    } catch {
      console.error(
        `[DEBUG] WARNING: No package.json found. This may not be a project root.`
      );
    }
  }

  const needsIndex = await shouldReindex();

  if (needsIndex) {
    if (process.env.CODEBASE_CONTEXT_DEBUG) console.error("[DEBUG] Starting indexing...");
    performIndexing();
  } else {
    if (process.env.CODEBASE_CONTEXT_DEBUG) console.error("[DEBUG] Index found. Ready.");
    indexState.status = "ready";
    indexState.lastIndexed = new Date();
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (process.env.CODEBASE_CONTEXT_DEBUG) console.error("[DEBUG] Server ready");
}

// Export server components for programmatic use
export { server, performIndexing, resolveRootPath, shouldReindex, TOOLS };

// Only auto-start when run directly as CLI (not when imported as module)
// Check if this module is the entry point
const isDirectRun =
  process.argv[1]?.replace(/\\/g, "/").endsWith("index.js") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("index.ts");

if (isDirectRun) {
  main().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
  });
}
