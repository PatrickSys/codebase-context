#!/usr/bin/env node

/**
 * MCP Server for Codebase Context
 * Provides codebase indexing and semantic search capabilities
 */

import { promises as fs } from 'fs';

import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  RootsListChangedNotificationSchema,
  Resource
} from '@modelcontextprotocol/sdk/types.js';
import { CodebaseIndexer } from './core/indexer.js';
import type {
  IntelligenceData,
  PatternsData,
  PatternEntry,
  PatternCandidate
} from './types/index.js';
import { analyzerRegistry } from './core/analyzer-registry.js';
import { AngularAnalyzer } from './analyzers/angular/index.js';
import { GenericAnalyzer } from './analyzers/generic/index.js';
import { IndexCorruptedError } from './errors/index.js';
import { appendMemoryFile } from './memory/store.js';
import { handleCliCommand } from './cli.js';
import { startFileWatcher } from './core/file-watcher.js';
import { parseGitLogLineToMemory } from './memory/git-memory.js';
import {
  isComplementaryPatternCategory,
  shouldSkipLegacyTestingFrameworkCategory
} from './patterns/semantics.js';
import { CONTEXT_RESOURCE_URI, isContextResourceUri } from './resources/uri.js';
import { readIndexMeta, validateIndexArtifacts } from './core/index-meta.js';
import { TOOLS, dispatchTool, type ToolContext, type ToolResponse } from './tools/index.js';
import type { ToolPaths } from './tools/types.js';
import {
  getOrCreateProject,
  getAllProjects,
  makeLegacyPaths,
  normalizeRootKey,
  removeProject,
  type ProjectState
} from './project-state.js';

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
    console.error(`[DEBUG] No project path specified. Using current directory: ${rootPath}`);
    console.error(`[DEBUG] Hint: Specify path as CLI argument or set CODEBASE_ROOT env var`);
  }

  return rootPath;
}

const primaryRootPath = resolveRootPath();
const primaryProject = getOrCreateProject(primaryRootPath);
const toolNames = new Set(TOOLS.map((tool) => tool.name));
const knownRoots = new Map<string, string>();
let clientRootsEnabled = false;
const debounceEnv = Number.parseInt(process.env.CODEBASE_CONTEXT_DEBOUNCE_MS ?? '', 10);
const watcherDebounceMs = Number.isFinite(debounceEnv) && debounceEnv >= 0 ? debounceEnv : 2000;

type ProjectResolution =
  | { ok: true; project: ProjectState }
  | { ok: false; response: ToolResponse };

function registerKnownRoot(rootPath: string): string {
  const resolvedRootPath = path.resolve(rootPath);
  knownRoots.set(normalizeRootKey(resolvedRootPath), resolvedRootPath);
  return resolvedRootPath;
}

function getKnownRootPaths(): string[] {
  return Array.from(knownRoots.values()).sort((a, b) => a.localeCompare(b));
}

function syncKnownRoots(rootPaths: string[]): void {
  const nextRoots = new Map<string, string>();
  const normalizedRoots = rootPaths.length > 0 ? rootPaths : [primaryRootPath];

  for (const rootPath of normalizedRoots) {
    const resolvedRootPath = path.resolve(rootPath);
    nextRoots.set(normalizeRootKey(resolvedRootPath), resolvedRootPath);
  }

  for (const [rootKey, existingRootPath] of knownRoots.entries()) {
    if (!nextRoots.has(rootKey)) {
      removeProject(existingRootPath);
    }
  }

  knownRoots.clear();
  for (const [rootKey, rootPath] of nextRoots.entries()) {
    knownRoots.set(rootKey, rootPath);
  }
}

function parseProjectDirectory(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmedValue = value.trim();
  if (!trimmedValue) return undefined;

  return trimmedValue.startsWith('file://')
    ? path.resolve(fileURLToPath(trimmedValue))
    : path.resolve(trimmedValue);
}

function buildProjectSelectionError(
  errorCode: 'ambiguous_project' | 'unknown_project',
  message: string
): ToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: 'error',
            errorCode,
            message,
            availableRoots: getKnownRootPaths()
          },
          null,
          2
        )
      }
    ],
    isError: true
  };
}

function createToolContext(project: ProjectState): ToolContext {
  return {
    indexState: project.indexState,
    paths: project.paths,
    rootPath: project.rootPath,
    performIndexing: (incrementalOnly?: boolean) => performIndexing(project, incrementalOnly)
  };
}

registerKnownRoot(primaryRootPath);

export const INDEX_CONSUMING_TOOL_NAMES = [
  'search_codebase',
  'get_symbol_references',
  'detect_circular_dependencies',
  'get_team_patterns',
  'get_codebase_metadata'
] as const;

export const INDEX_CONSUMING_RESOURCE_NAMES = ['Codebase Intelligence'] as const;

type IndexStatus = 'ready' | 'rebuild-required' | 'indexing' | 'unknown';
type IndexConfidence = 'high' | 'low';
type IndexAction = 'served' | 'rebuild-started' | 'rebuilt-and-served' | 'rebuild-failed';

export type IndexSignal = {
  status: IndexStatus;
  confidence: IndexConfidence;
  action: IndexAction;
  reason?: string;
};

async function requireValidIndex(rootPath: string, paths: ToolPaths): Promise<IndexSignal> {
  const meta = await readIndexMeta(rootPath);
  await validateIndexArtifacts(rootPath, meta);

  // Optional artifact presence informs confidence.
  const hasIntelligence = await fileExists(paths.intelligence);

  return {
    status: 'ready',
    confidence: hasIntelligence ? 'high' : 'low',
    action: 'served',
    ...(hasIntelligence ? {} : { reason: 'Optional intelligence artifact missing' })
  };
}

async function ensureValidIndexOrAutoHeal(project: ProjectState): Promise<IndexSignal> {
  if (project.indexState.status === 'indexing') {
    return {
      status: 'indexing',
      confidence: 'low',
      action: 'served',
      reason: 'Indexing in progress'
    };
  }

  try {
    return await requireValidIndex(project.rootPath, project.paths);
  } catch (error) {
    if (error instanceof IndexCorruptedError) {
      const reason = error.message;
      console.error(`[Index] ${reason}`);
      console.error('[Auto-Heal] Triggering background re-index...');

      // Fire-and-forget: don't block the tool call
      void performIndexing(project);

      return {
        status: 'indexing',
        confidence: 'low',
        action: 'rebuild-started',
        reason: `Auto-heal triggered: ${reason}`
      };
    }

    throw error;
  }
}

/**
 * Check if file/directory exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrate legacy file structure to .codebase-context/ folder.
 * Idempotent, fail-safe. Rollback compatibility is not required.
 */
async function migrateToNewStructure(
  paths: ToolPaths,
  legacyPaths: ReturnType<typeof makeLegacyPaths>
): Promise<boolean> {
  let migrated = false;

  try {
    await fs.mkdir(paths.baseDir, { recursive: true });

    // intelligence.json
    if (!(await fileExists(paths.intelligence))) {
      if (await fileExists(legacyPaths.intelligence)) {
        await fs.copyFile(legacyPaths.intelligence, paths.intelligence);
        migrated = true;
        if (process.env.CODEBASE_CONTEXT_DEBUG) {
          console.error('[DEBUG] Migrated intelligence.json');
        }
      }
    }

    // index.json (keyword index)
    if (!(await fileExists(paths.keywordIndex))) {
      if (await fileExists(legacyPaths.keywordIndex)) {
        await fs.copyFile(legacyPaths.keywordIndex, paths.keywordIndex);
        migrated = true;
        if (process.env.CODEBASE_CONTEXT_DEBUG) {
          console.error('[DEBUG] Migrated index.json');
        }
      }
    }

    // Vector DB directory
    if (!(await fileExists(paths.vectorDb))) {
      if (await fileExists(legacyPaths.vectorDb)) {
        await fs.rename(legacyPaths.vectorDb, paths.vectorDb);
        migrated = true;
        if (process.env.CODEBASE_CONTEXT_DEBUG) {
          console.error('[DEBUG] Migrated vector database');
        }
      }
    }

    return migrated;
  } catch (error) {
    if (process.env.CODEBASE_CONTEXT_DEBUG) {
      console.error('[DEBUG] Migration error:', error);
    }
    return false;
  }
}

export type { IndexState } from './tools/types.js';

// Read version from package.json so it never drifts
const PKG_VERSION: string = JSON.parse(
  await fs.readFile(new URL('../package.json', import.meta.url), 'utf-8')
).version;

const server: Server = new Server(
  {
    name: 'codebase-context',
    version: PKG_VERSION
  },
  {
    capabilities: {
      tools: {},
      resources: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// MCP Resources - Proactive context injection
const RESOURCES: Resource[] = [
  {
    uri: CONTEXT_RESOURCE_URI,
    name: 'Codebase Intelligence',
    description:
      'Automatic codebase context: libraries used, team patterns, and conventions. ' +
      'Read this BEFORE generating code to follow team standards.',
    mimeType: 'text/plain'
  }
];

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources: RESOURCES };
});

async function generateCodebaseContext(project: ProjectState): Promise<string> {
  const intelligencePath = project.paths.intelligence;

  const index = await ensureValidIndexOrAutoHeal(project);
  if (index.status === 'indexing') {
    return (
      '# Codebase Intelligence\n\n' +
      'Index is still being built. Retry in a moment.\n\n' +
      `Index: ${index.status} (${index.confidence}, ${index.action})` +
      (index.reason ? `\nReason: ${index.reason}` : '')
    );
  }
  if (index.action === 'rebuild-failed') {
    return (
      '# Codebase Intelligence\n\n' +
      'Index rebuild required before intelligence can be served.\n\n' +
      `Index: ${index.status} (${index.confidence}, ${index.action})` +
      (index.reason ? `\nReason: ${index.reason}` : '')
    );
  }

  try {
    const content = await fs.readFile(intelligencePath, 'utf-8');
    const intelligence = JSON.parse(content) as IntelligenceData;

    const lines: string[] = [];
    lines.push('# Codebase Intelligence');
    lines.push('');
    lines.push(
      `Index: ${index.status} (${index.confidence}, ${index.action})${
        index.reason ? ` — ${index.reason}` : ''
      }`
    );
    lines.push('');
    lines.push('WARNING: This is what YOUR codebase actually uses, not generic recommendations.');
    lines.push('These are FACTS from analyzing your code, not best practices from the internet.');
    lines.push('');

    // Library usage - sorted by count
    const libraryEntries = Object.entries(intelligence.libraryUsage || {})
      .map(([lib, data]) => ({
        lib,
        count: data.count
      }))
      .sort((a, b) => b.count - a.count);

    if (libraryEntries.length > 0) {
      lines.push('## Libraries Actually Used (Top 15)');
      lines.push('');

      for (const { lib, count } of libraryEntries.slice(0, 15)) {
        lines.push(`- **${lib}** (${count} uses)`);
      }
      lines.push('');
    }

    // Show tsconfig paths if available (helps AI understand internal imports)
    if (intelligence.tsconfigPaths && Object.keys(intelligence.tsconfigPaths).length > 0) {
      lines.push('## Import Aliases (from tsconfig.json)');
      lines.push('');
      lines.push('These path aliases map to internal project code:');
      for (const [alias, paths] of Object.entries(intelligence.tsconfigPaths)) {
        lines.push(`- \`${alias}\` -> ${(paths as string[]).join(', ')}`);
      }
      lines.push('');
    }

    // Pattern consensus
    if (intelligence.patterns && Object.keys(intelligence.patterns).length > 0) {
      const patterns: PatternsData = intelligence.patterns;
      lines.push("## YOUR Codebase's Actual Patterns (Not Generic Best Practices)");
      lines.push('');
      lines.push('These patterns were detected by analyzing your actual code.');
      lines.push('This is what YOUR team does in practice, not what tutorials recommend.');
      lines.push('');

      for (const [category, data] of Object.entries(patterns)) {
        if (shouldSkipLegacyTestingFrameworkCategory(category, patterns)) {
          continue;
        }

        const patternData: PatternEntry = data;
        const primary: PatternCandidate | undefined = patternData.primary;
        const alternatives: PatternCandidate[] = patternData.alsoDetected ?? [];

        if (!primary) continue;

        if (
          isComplementaryPatternCategory(
            category,
            [primary.name, ...alternatives.map((alt) => alt.name)].filter(Boolean)
          )
        ) {
          const secondary = alternatives[0];
          if (secondary) {
            const categoryName = category
              .replace(/([A-Z])/g, ' $1')
              .trim()
              .replace(/^./, (str: string) => str.toUpperCase());
            lines.push(
              `### ${categoryName}: **${primary.name}** (${primary.frequency}) + **${secondary.name}** (${secondary.frequency})`
            );
            lines.push(
              '   -> Computed and effect are complementary Signals primitives and are commonly used together.'
            );
            lines.push('   -> Treat this as balanced usage, not a hard split decision.');
            lines.push('');
            continue;
          }
        }

        const percentage = parseInt(primary.frequency);
        const categoryName = category
          .replace(/([A-Z])/g, ' $1')
          .trim()
          .replace(/^./, (str: string) => str.toUpperCase());

        if (percentage === 100) {
          lines.push(`### ${categoryName}: **${primary.name}** (${primary.frequency} - unanimous)`);
          lines.push(`   -> Your codebase is 100% consistent - ALWAYS use ${primary.name}`);
        } else if (percentage >= 80) {
          lines.push(
            `### ${categoryName}: **${primary.name}** (${primary.frequency} - strong consensus)`
          );
          lines.push(`   -> Your team strongly prefers ${primary.name}`);
          if (alternatives.length) {
            const alt = alternatives[0];
            lines.push(
              `   -> Minority pattern: ${alt.name} (${alt.frequency}) - avoid for new code`
            );
          }
        } else if (percentage >= 60) {
          lines.push(`### ${categoryName}: **${primary.name}** (${primary.frequency} - majority)`);
          lines.push(`   -> Most code uses ${primary.name}, but not unanimous`);
          if (alternatives.length) {
            lines.push(
              `   -> Also detected: ${alternatives[0].name} (${alternatives[0].frequency})`
            );
          }
        } else {
          // Split decision
          lines.push(`### ${categoryName}: WARNING: NO TEAM CONSENSUS`);
          lines.push(`   Your codebase is split between multiple approaches:`);
          lines.push(`   - ${primary.name} (${primary.frequency})`);
          if (alternatives.length) {
            for (const alt of alternatives.slice(0, 2)) {
              lines.push(`   - ${alt.name} (${alt.frequency})`);
            }
          }
          lines.push(`   -> ASK the team which approach to use for new features`);
        }
        lines.push('');
      }
    }

    lines.push('---');
    lines.push(`Generated: ${intelligence.generatedAt || new Date().toISOString()}`);

    return lines.join('\n');
  } catch (error) {
    return (
      '# Codebase Intelligence\n\n' +
      'Intelligence data not yet generated. Run indexing first.\n' +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  if (isContextResourceUri(uri)) {
    const project = await resolveProjectForResource();
    const content = project
      ? await generateCodebaseContext(project)
      : '# Codebase Intelligence\n\n' +
        'Multiple project roots are available. Use a tool call with `project_directory` to choose a project.';

    return {
      contents: [
        {
          uri: CONTEXT_RESOURCE_URI,
          mimeType: 'text/plain',
          text: content
        }
      ]
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

/**
 * Extract memories from conventional git commits (refactor:, migrate:, fix:, revert:).
 * Scans last 90 days. Deduplicates via content hash. Zero friction alternative to manual memory.
 */
async function extractGitMemories(rootPath: string, memoryPath: string): Promise<number> {
  // Quick check: skip if not a git repo
  if (!(await fileExists(path.join(rootPath, '.git')))) return 0;

  const { execSync } = await import('child_process');

  let log: string;
  try {
    // Format: ISO-date<TAB>hash subject  (e.g. "2026-01-15T10:00:00+00:00\tabc1234 fix: race condition")
    log = execSync('git log --format="%aI\t%h %s" --since="90 days ago" --no-merges', {
      cwd: rootPath,
      encoding: 'utf-8',
      timeout: 5000
    }).trim();
  } catch {
    // Git not available or command failed — silently skip
    return 0;
  }

  if (!log) return 0;

  const lines = log.split('\n').filter(Boolean);
  let added = 0;

  for (const line of lines) {
    const parsedMemory = parseGitLogLineToMemory(line);
    if (!parsedMemory) continue;

    const result = await appendMemoryFile(memoryPath, parsedMemory);
    if (result.status === 'added') added++;
  }

  return added;
}

async function performIndexingOnce(
  project: ProjectState,
  incrementalOnly?: boolean
): Promise<void> {
  project.indexState.status = 'indexing';
  const mode = incrementalOnly ? 'incremental' : 'full';
  console.error(`Indexing (${mode}): ${project.rootPath}`);

  try {
    let lastLoggedProgress = { phase: '', percentage: -1 };
    const indexer = new CodebaseIndexer({
      rootPath: project.rootPath,
      incrementalOnly,
      onProgress: (progress) => {
        // Only log when phase or percentage actually changes (prevents duplicate logs)
        const shouldLog =
          progress.phase !== lastLoggedProgress.phase ||
          (progress.percentage % 10 === 0 && progress.percentage !== lastLoggedProgress.percentage);

        if (shouldLog) {
          console.error(`[${progress.phase}] ${progress.percentage}%`);
          lastLoggedProgress = { phase: progress.phase, percentage: progress.percentage };
        }
      }
    });

    project.indexState.indexer = indexer;
    const stats = await indexer.index();

    project.indexState.status = 'ready';
    project.indexState.lastIndexed = new Date();
    project.indexState.stats = stats;

    console.error(
      `Complete: ${stats.indexedFiles} files, ${stats.totalChunks} chunks in ${(
        stats.duration / 1000
      ).toFixed(2)}s`
    );

    // Auto-extract memories from git history (non-blocking, best-effort)
    try {
      const gitMemories = await extractGitMemories(project.rootPath, project.paths.memory);
      if (gitMemories > 0) {
        console.error(
          `[git-memory] Extracted ${gitMemories} new memor${gitMemories === 1 ? 'y' : 'ies'} from git history`
        );
      }
    } catch {
      // Git memory extraction is optional — never fail indexing over it
    }
  } catch (error) {
    project.indexState.status = 'error';
    project.indexState.error = error instanceof Error ? error.message : String(error);
    console.error('Indexing failed:', project.indexState.error);
  }
}

async function performIndexing(
  project: ProjectState,
  incrementalOnly?: boolean
): Promise<void> {
  let nextMode = incrementalOnly;
  for (;;) {
    await performIndexingOnce(project, nextMode);

    const shouldRunQueuedRefresh = project.autoRefresh.consumeQueuedRefresh(
      project.indexState.status
    );
    if (!shouldRunQueuedRefresh) return;

    if (process.env.CODEBASE_CONTEXT_DEBUG) {
      console.error('[file-watcher] Running queued auto-refresh');
    }
    nextMode = true;
  }
}

async function shouldReindex(paths: ToolPaths): Promise<boolean> {
  try {
    await fs.access(paths.keywordIndex);
    return false;
  } catch {
    return true;
  }
}

async function refreshKnownRootsFromClient(): Promise<void> {
  try {
    const { roots } = await server.listRoots();
    const fileRoots = roots
      .map((root) => root.uri)
      .filter((uri) => uri.startsWith('file://'))
      .map((uri) => fileURLToPath(uri));

    clientRootsEnabled = fileRoots.length > 0;
    syncKnownRoots(fileRoots);
  } catch {
    clientRootsEnabled = false;
    syncKnownRoots([primaryRootPath]);
  }
}

async function resolveProjectForTool(args: Record<string, unknown>): Promise<ProjectResolution> {
  const requestedProjectDirectory = parseProjectDirectory(args.project_directory);
  const availableRoots = getKnownRootPaths();

  if (requestedProjectDirectory) {
    const requestedRootKey = normalizeRootKey(requestedProjectDirectory);
    const knownRootPath = knownRoots.get(requestedRootKey);

    if (clientRootsEnabled && availableRoots.length > 0 && !knownRootPath) {
      return {
        ok: false,
        response: buildProjectSelectionError(
          'unknown_project',
          'Requested project is not part of the active MCP roots.'
        )
      };
    }

    const rootPath = knownRootPath ?? registerKnownRoot(requestedProjectDirectory);
    const project = getOrCreateProject(rootPath);
    await initProject(project.rootPath, watcherDebounceMs);
    return { ok: true, project };
  }

  if (availableRoots.length !== 1) {
    return {
      ok: false,
      response: buildProjectSelectionError(
        'ambiguous_project',
        'Multiple project roots are available. Pass project_directory to choose one.'
      )
    };
  }

  const [rootPath] = availableRoots;
  const project = getOrCreateProject(rootPath);
  await initProject(project.rootPath, watcherDebounceMs);
  return { ok: true, project };
}

async function resolveProjectForResource(): Promise<ProjectState | undefined> {
  const availableRoots = getKnownRootPaths();
  if (availableRoots.length !== 1) {
    return undefined;
  }

  const [rootPath] = availableRoots;
  const project = getOrCreateProject(rootPath);
  await initProject(project.rootPath, watcherDebounceMs);
  return project;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const normalizedArgs =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};

  try {
    if (!toolNames.has(name)) {
      return await dispatchTool(name, normalizedArgs, createToolContext(primaryProject));
    }

    const projectResolution = await resolveProjectForTool(normalizedArgs);
    if (!projectResolution.ok) {
      return projectResolution.response;
    }

    const project = projectResolution.project;

    // Gate INDEX_CONSUMING tools on a valid, healthy index
    let indexSignal: IndexSignal | undefined;
    if ((INDEX_CONSUMING_TOOL_NAMES as readonly string[]).includes(name)) {
      if (project.indexState.status === 'indexing') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'indexing',
                message: 'Index build in progress — please retry shortly'
              })
            }
          ]
        };
      }
      if (project.indexState.status === 'error') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                message: `Indexer error: ${project.indexState.error}`
              })
            }
          ]
        };
      }
      indexSignal = await ensureValidIndexOrAutoHeal(project);
      if (
        indexSignal.action === 'rebuild-started' ||
        indexSignal.action === 'rebuild-failed'
      ) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'indexing',
                message: 'Index rebuild in progress — please retry shortly',
                index: indexSignal
              })
            }
          ]
        };
      }
    }

    const result = await dispatchTool(name, normalizedArgs, createToolContext(project));

    // Inject IndexSignal into response so callers can inspect index health
    if (indexSignal !== undefined && result.content?.[0]) {
      try {
        const parsed = JSON.parse(result.content[0].text);
        result.content[0] = {
          type: 'text',
          text: JSON.stringify({ ...parsed, index: indexSignal })
        };
      } catch {
        /* response wasn't JSON, skip injection */
      }
    }

    return result;
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
        }
      ],
      isError: true
    };
  }
});

/**
 * Initialize a project: migrate legacy structure, check index, start watcher.
 * Deduplicates via normalized root key.
 */
async function initProject(rootPath: string, debounceMs: number): Promise<void> {
  const project = getOrCreateProject(rootPath);

  // Skip if already initialized
  if (
    project.indexState.status === 'indexing' ||
    project.indexState.status === 'ready' ||
    project.stopWatcher
  ) {
    return;
  }

  // Migrate legacy structure
  try {
    const legacyPaths = makeLegacyPaths(project.rootPath);
    const migrated = await migrateToNewStructure(project.paths, legacyPaths);
    if (migrated && process.env.CODEBASE_CONTEXT_DEBUG) {
      console.error(`[DEBUG] Migrated to .codebase-context/ structure: ${project.rootPath}`);
    }
  } catch {
    // Non-fatal
  }

  // Check if indexing is needed
  const needsIndex = await shouldReindex(project.paths);
  if (needsIndex) {
    if (process.env.CODEBASE_CONTEXT_DEBUG) {
      console.error(`[DEBUG] Starting indexing: ${project.rootPath}`);
    }
    void performIndexing(project);
  } else {
    if (process.env.CODEBASE_CONTEXT_DEBUG) {
      console.error(`[DEBUG] Index found. Ready: ${project.rootPath}`);
    }
    project.indexState.status = 'ready';
    project.indexState.lastIndexed = new Date();
  }

  // Start file watcher
  project.stopWatcher = startFileWatcher({
    rootPath: project.rootPath,
    debounceMs,
    onChanged: () => {
      const shouldRunNow = project.autoRefresh.onFileChange(
        project.indexState.status === 'indexing'
      );
      if (!shouldRunNow) {
        if (process.env.CODEBASE_CONTEXT_DEBUG) {
          console.error(
            `[file-watcher] Index in progress — queueing auto-refresh: ${project.rootPath}`
          );
        }
        return;
      }
      if (process.env.CODEBASE_CONTEXT_DEBUG) {
        console.error(
          `[file-watcher] Changes detected — incremental reindex starting: ${project.rootPath}`
        );
      }
      void performIndexing(project, true);
    }
  });
}

async function main() {
  // Validate root path exists and is a directory
  try {
    const stats = await fs.stat(primaryRootPath);
    if (!stats.isDirectory()) {
      console.error(`ERROR: Root path is not a directory: ${primaryRootPath}`);
      console.error(`Please specify a valid project directory.`);
      process.exit(1);
    }
  } catch (_error) {
    console.error(`ERROR: Root path does not exist: ${primaryRootPath}`);
    console.error(`Please specify a valid project directory.`);
    process.exit(1);
  }

  // Server startup banner (guarded to avoid stderr during MCP STDIO handshake)
  if (process.env.CODEBASE_CONTEXT_DEBUG) {
    console.error('[DEBUG] Codebase Context MCP Server');
    console.error(`[DEBUG] Root: ${primaryRootPath}`);
    console.error(
      `[DEBUG] Analyzers: ${analyzerRegistry
        .getAll()
        .map((a) => a.name)
        .join(', ')}`
    );
  }

  // Check for package.json to confirm it's a project root (guarded to avoid stderr during handshake)
  if (process.env.CODEBASE_CONTEXT_DEBUG) {
    try {
      await fs.access(path.join(primaryRootPath, 'package.json'));
      console.error(`[DEBUG] Project detected: ${path.basename(primaryRootPath)}`);
    } catch {
      console.error(`[DEBUG] WARNING: No package.json found. This may not be a project root.`);
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (process.env.CODEBASE_CONTEXT_DEBUG) console.error('[DEBUG] Server ready');

  await refreshKnownRootsFromClient();

  // Preserve current single-project startup behavior without eagerly indexing every root.
  const startupRoots = getKnownRootPaths();
  if (startupRoots.length === 1) {
    await initProject(startupRoots[0], watcherDebounceMs);
  }

  // Subscribe to root changes
  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    try {
      await refreshKnownRootsFromClient();
    } catch {
      /* best-effort */
    }
  });

  // Cleanup all watchers on exit
  const stopAllWatchers = () => {
    for (const project of getAllProjects()) {
      project.stopWatcher?.();
    }
  };

  process.once('exit', stopAllWatchers);
  process.once('SIGINT', () => {
    stopAllWatchers();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    stopAllWatchers();
    process.exit(0);
  });
}

// Export server components for programmatic use
export { server, resolveRootPath, shouldReindex, TOOLS };
export { performIndexing };

// Only auto-start when run directly as CLI (not when imported as module)
// Check if this module is the entry point
const isDirectRun =
  process.argv[1]?.replace(/\\/g, '/').endsWith('index.js') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('index.ts');

const CLI_SUBCOMMANDS = [
  'memory',
  'search',
  'metadata',
  'status',
  'reindex',
  'style-guide',
  'patterns',
  'refs',
  'cycles'
];

if (isDirectRun) {
  const subcommand = process.argv[2];
  if (CLI_SUBCOMMANDS.includes(subcommand) || subcommand === '--help') {
    handleCliCommand(process.argv.slice(2)).catch((error) => {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  } else {
    main().catch((error) => {
      console.error('Fatal:', error);
      process.exit(1);
    });
  }
}
