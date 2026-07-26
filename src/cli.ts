/**
 * CLI subcommands for codebase-context.
 * Memory list/add/remove — vendor-neutral access without any AI agent.
 * search/metadata/status/reindex/style-guide/patterns/refs/cycles — human-facing wrappers over core read/query tools.
 */

import path from 'path';
import { promises as fs } from 'fs';
import {
  CODEBASE_CONTEXT_DIRNAME,
  MEMORY_FILENAME,
  INTELLIGENCE_FILENAME,
  HEALTH_FILENAME,
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME
} from './constants/codebase-context.js';
import { CodebaseIndexer } from './core/indexer.js';
import { dispatchTool } from './tools/index.js';
import type { ToolContext } from './tools/index.js';
import type { IndexState } from './tools/types.js';
import { analyzerRegistry } from './core/analyzer-registry.js';
import { AngularAnalyzer } from './analyzers/angular/index.js';
import { NextJsAnalyzer } from './analyzers/nextjs/index.js';
import { NestJsAnalyzer } from './analyzers/nestjs/index.js';
import { ReactAnalyzer } from './analyzers/react/index.js';
import { GenericAnalyzer } from './analyzers/generic/index.js';
import { formatJson } from './cli-formatters.js';
import { handleMemoryCli } from './cli-memory.js';
export { handleMemoryCli } from './cli-memory.js';
import { handleInitCli } from './cli-init.js';
import { handleMapCli } from './cli-map.js';
import { loadProjectConfig } from './server/config.js';

analyzerRegistry.register(new AngularAnalyzer());
analyzerRegistry.register(new NextJsAnalyzer());
analyzerRegistry.register(new NestJsAnalyzer());
analyzerRegistry.register(new ReactAnalyzer());
analyzerRegistry.register(new GenericAnalyzer());

const _CLI_COMMANDS = [
  'memory',
  'search',
  'metadata',
  'status',
  'reindex',
  'style-guide',
  'patterns',
  'refs',
  'cycles',
  'init',
  'map'
] as const;

type CliCommand = (typeof _CLI_COMMANDS)[number];

const CLI_COMMAND_SET: ReadonlySet<string> = new Set(_CLI_COMMANDS);
function isCliCommand(value: string): value is CliCommand {
  return CLI_COMMAND_SET.has(value);
}

const SEARCH_INTENTS = ['explore', 'edit', 'refactor', 'migrate'] as const;
type SearchIntent = (typeof SEARCH_INTENTS)[number];
const SEARCH_INTENT_SET: ReadonlySet<string> = new Set(SEARCH_INTENTS);
function isSearchIntent(value: string): value is SearchIntent {
  return SEARCH_INTENT_SET.has(value);
}

const TEAM_PATTERN_CATEGORIES = ['all', 'di', 'state', 'testing', 'libraries'] as const;
type TeamPatternCategory = (typeof TEAM_PATTERN_CATEGORIES)[number];
const TEAM_PATTERN_CATEGORY_SET: ReadonlySet<string> = new Set(TEAM_PATTERN_CATEGORIES);
function isTeamPatternCategory(value: string): value is TeamPatternCategory {
  return TEAM_PATTERN_CATEGORY_SET.has(value);
}

function printUsage(): void {
  console.log('codebase-context <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  memory <list|add|remove>           Memory CRUD');
  console.log('  search --query <q>                 Search the indexed codebase');
  console.log('         [--intent explore|edit|refactor|migrate]');
  console.log('         [--limit <n>] [--lang <l>] [--framework <f>] [--layer <l>]');
  console.log('  metadata                           Project structure, frameworks, deps');
  console.log('  status                             Index state and progress');
  console.log('  reindex [--incremental] [--reason <r>]  Re-index the codebase');
  console.log('  style-guide [--query <q>] [--category <c>]  Style guide rules');
  console.log('  patterns [--category all|di|state|testing|libraries]  Team patterns');
  console.log('  refs --symbol <name> [--limit <n>]  Symbol references');
  console.log('  cycles [--scope <path>]            Circular dependency detection');
  console.log('  init                               Interactive setup wizard for AI clients');
  console.log('  map [--json] [--pretty]              Conventions map');
  console.log('');
  console.log('Global flags:');
  console.log('  --json    Output raw JSON (default: human-readable)');
  console.log('  --help    Show this help');
  console.log('');
  console.log('Environment:');
  console.log('  CODEBASE_ROOT    Project root path (default: cwd for CLI only)');
  console.log('  CODEBASE_CONTEXT_ASCII=1  Force ASCII-only box output');
  console.log('  CODEBASE_CONTEXT_DEBUG=1  Enable verbose logs');
}

function resolveCliRootPath(): string {
  return path.resolve(process.env.CODEBASE_ROOT || process.cwd());
}

async function initToolContext(): Promise<ToolContext> {
  const rootPath = resolveCliRootPath();
  const projectConfig = await loadProjectConfig(rootPath);

  const paths = {
    baseDir: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME),
    memory: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, MEMORY_FILENAME),
    intelligence: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, INTELLIGENCE_FILENAME),
    health: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, HEALTH_FILENAME),
    keywordIndex: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME),
    vectorDb: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, VECTOR_DB_DIRNAME)
  };

  let indexExists = false;
  try {
    await fs.access(paths.keywordIndex);
    indexExists = true;
  } catch {
    // no index on disk
  }

  const indexState: IndexState = {
    status: indexExists ? 'ready' : 'idle'
  };

  const performIndexing = async (incrementalOnly?: boolean, reason?: string): Promise<void> => {
    indexState.status = 'indexing';
    const mode = incrementalOnly ? 'incremental' : 'full';
    console.error(`Indexing (${mode})${reason ? ` — ${reason}` : ''}: ${rootPath}`);

    try {
      let lastLoggedProgress = { phase: '', percentage: -1 };
      const indexer = new CodebaseIndexer({
        rootPath,
        ...(projectConfig?.parsing ? { config: { parsing: projectConfig.parsing } } : {}),
        incrementalOnly,
        onProgress: (progress) => {
          const shouldLog =
            progress.phase !== lastLoggedProgress.phase ||
            (progress.percentage % 10 === 0 &&
              progress.percentage !== lastLoggedProgress.percentage);
          if (shouldLog) {
            console.error(`[${progress.phase}] ${progress.percentage}%`);
            lastLoggedProgress = { phase: progress.phase, percentage: progress.percentage };
          }
        }
      });

      indexState.indexer = indexer;
      const stats = await indexer.index();
      indexState.status = 'ready';
      indexState.lastIndexed = new Date();
      indexState.stats = stats;

      console.error(
        `Complete: ${stats.indexedFiles} files, ${stats.totalChunks} chunks in ${(
          stats.duration / 1000
        ).toFixed(2)}s`
      );
    } catch (error) {
      indexState.status = 'error';
      indexState.error = error instanceof Error ? error.message : String(error);
      console.error('Indexing failed:', indexState.error);
    }
  };

  return {
    indexState,
    paths,
    rootPath,
    performIndexing
  };
}

function extractText(result: { content?: Array<{ type: string; text: string }> }): string {
  return result.content?.[0]?.text ?? '';
}

type FlagValue = string | true;
type Flags = Record<string, FlagValue>;

function exitWithError(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function requireStringFlag(flags: Flags, key: string, usage: string): string {
  const value = flags[key];
  if (value === undefined) {
    exitWithError(`Error: --${key} is required\nUsage: ${usage}`);
  }
  if (typeof value !== 'string') {
    exitWithError(`Error: --${key} requires a value\nUsage: ${usage}`);
  }
  return value;
}

function optionalStringFlag(flags: Flags, key: string, usage: string): string | undefined {
  const value = flags[key];
  if (value === true) {
    exitWithError(`Error: --${key} requires a value\nUsage: ${usage}`);
  }
  return typeof value === 'string' ? value : undefined;
}

function optionalPositiveIntFlag(flags: Flags, key: string, usage: string): number | undefined {
  const value = flags[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    exitWithError(`Error: --${key} requires a value\nUsage: ${usage}`);
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    exitWithError(`Error: --${key} must be a positive number\nUsage: ${usage}`);
  }
  return Math.floor(num);
}

function booleanFlag(flags: Flags, key: string, usage: string): boolean {
  const value = flags[key];
  if (value === undefined) return false;
  if (value === true) return true;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;

  exitWithError(`Error: --${key} must be a boolean (true/false)\nUsage: ${usage}`);
}

export async function handleCliCommand(argv: string[]): Promise<void> {
  const rawCommand = argv[0];

  if (!rawCommand || rawCommand === '--help') {
    printUsage();
    return;
  }

  if (!isCliCommand(rawCommand)) {
    console.error(`Unknown command: ${rawCommand}`);
    console.error('');
    printUsage();
    process.exit(1);
  }

  const command: CliCommand = rawCommand;

  if (command === 'memory') {
    return handleMemoryCli(argv.slice(1));
  }

  if (command === 'init') {
    return handleInitCli(argv.slice(1));
  }

  if (command === 'map') {
    return handleMapCli(argv.slice(1));
  }

  const useJson = argv.includes('--json');

  const flags = parseFlags(argv);

  const ctx = await initToolContext();

  type DispatchSpec =
    | { toolName: 'search_codebase'; toolArgs: SearchToolArgs }
    | { toolName: 'get_codebase_metadata'; toolArgs: Record<never, never> }
    | { toolName: 'get_indexing_status'; toolArgs: Record<never, never> }
    | { toolName: 'get_style_guide'; toolArgs: StyleGuideToolArgs }
    | { toolName: 'get_team_patterns'; toolArgs: TeamPatternsToolArgs }
    | { toolName: 'get_symbol_references'; toolArgs: SymbolReferencesToolArgs }
    | { toolName: 'detect_circular_dependencies'; toolArgs: DetectCircularDependenciesToolArgs };

  type SearchToolArgs = {
    query: string;
    includeSnippets: boolean;
    intent?: SearchIntent;
    limit?: number;
    filters?: { language?: string; framework?: string; layer?: string };
  };

  type StyleGuideToolArgs = { query?: string; category?: string };
  type TeamPatternsToolArgs = { category?: TeamPatternCategory };
  type SymbolReferencesToolArgs = { symbol: string; limit?: number };
  type DetectCircularDependenciesToolArgs = { scope?: string };

  let dispatch: DispatchSpec;
  let formatQuery: string | undefined;
  let formatIntent: string | undefined;

  switch (command) {
    case 'search': {
      const usage = 'codebase-context search --query <text> [--intent <i>] [--limit <n>]';
      const query = requireStringFlag(flags, 'query', usage);
      const intentValue = optionalStringFlag(flags, 'intent', usage);
      let intent: SearchIntent | undefined;
      if (intentValue) {
        if (!isSearchIntent(intentValue)) {
          exitWithError(
            `Error: invalid --intent "${intentValue}". Allowed: ${SEARCH_INTENTS.join(', ')}\nUsage: ${usage}`
          );
        }
        intent = intentValue;
      }
      const limit = optionalPositiveIntFlag(flags, 'limit', usage);
      const lang = optionalStringFlag(flags, 'lang', usage);
      const framework = optionalStringFlag(flags, 'framework', usage);
      const layer = optionalStringFlag(flags, 'layer', usage);

      const filters: { language?: string; framework?: string; layer?: string } = {};
      if (lang) filters.language = lang;
      if (framework) filters.framework = framework;
      if (layer) filters.layer = layer;

      const args: SearchToolArgs = {
        query,
        includeSnippets: true,
        ...(intent ? { intent } : {}),
        ...(limit != null ? { limit } : {}),
        ...(Object.keys(filters).length > 0 ? { filters } : {})
      };
      dispatch = { toolName: 'search_codebase', toolArgs: args };
      formatQuery = query;
      formatIntent = intentValue;
      break;
    }
    case 'metadata': {
      dispatch = { toolName: 'get_codebase_metadata', toolArgs: {} };
      break;
    }
    case 'status': {
      dispatch = { toolName: 'get_indexing_status', toolArgs: {} };
      break;
    }
    case 'reindex': {
      const usage = 'codebase-context reindex [--incremental] [--reason <r>]';
      const reason = optionalStringFlag(flags, 'reason', usage);
      const incremental = booleanFlag(flags, 'incremental', usage);
      await ctx.performIndexing(incremental, reason);
      const statusResult = await dispatchTool('get_indexing_status', {}, ctx);
      formatJson(extractText(statusResult), useJson, 'status', ctx.rootPath);
      return;
    }
    case 'style-guide': {
      const usage = 'codebase-context style-guide [--query <q>] [--category <c>]';
      const query = optionalStringFlag(flags, 'query', usage);
      const category = optionalStringFlag(flags, 'category', usage);
      dispatch = {
        toolName: 'get_style_guide',
        toolArgs: {
          ...(query ? { query } : {}),
          ...(category ? { category } : {})
        }
      };
      break;
    }
    case 'patterns': {
      const usage = 'codebase-context patterns [--category all|di|state|testing|libraries]';
      const categoryValue = optionalStringFlag(flags, 'category', usage);
      let category: TeamPatternCategory | undefined;
      if (categoryValue) {
        if (!isTeamPatternCategory(categoryValue)) {
          exitWithError(
            `Error: invalid --category "${categoryValue}". Allowed: ${TEAM_PATTERN_CATEGORIES.join(', ')}\nUsage: ${usage}`
          );
        }
        category = categoryValue;
      }
      dispatch = {
        toolName: 'get_team_patterns',
        toolArgs: {
          ...(category ? { category } : {})
        }
      };
      break;
    }
    case 'refs': {
      const usage = 'codebase-context refs --symbol <name> [--limit <n>]';
      const symbol = requireStringFlag(flags, 'symbol', usage);
      const limit = optionalPositiveIntFlag(flags, 'limit', usage);
      dispatch = {
        toolName: 'get_symbol_references',
        toolArgs: {
          symbol,
          ...(limit != null ? { limit } : {})
        }
      };
      break;
    }
    case 'cycles': {
      const usage = 'codebase-context cycles [--scope <path>]';
      const scope = optionalStringFlag(flags, 'scope', usage);
      dispatch = {
        toolName: 'detect_circular_dependencies',
        toolArgs: {
          ...(scope ? { scope } : {})
        }
      };
      break;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      console.error('');
      printUsage();
      process.exit(1);
    }
  }

  try {
    const result = await dispatchTool(dispatch.toolName, dispatch.toolArgs, ctx);
    if (result.isError) {
      console.error(extractText(result));
      process.exit(1);
    }
    formatJson(extractText(result), useJson, command, ctx.rootPath, formatQuery, formatIntent);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
