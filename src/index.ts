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
import { createServer } from './server/factory.js';
import { startHttpServer } from './server/http.js';
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
import {
  CONTEXT_RESOURCE_URI,
  buildProjectContextResourceUri,
  getProjectPathFromContextResourceUri,
  isContextResourceUri
} from './resources/uri.js';
import {
  discoverProjectsWithinRoot,
  findNearestProjectBoundary,
  isPathWithin
} from './utils/project-discovery.js';
import { readIndexMeta, validateIndexArtifacts } from './core/index-meta.js';
import { TOOLS, dispatchTool, type ToolContext, type ToolResponse } from './tools/index.js';
import type { ProjectDescriptor, ToolPaths } from './tools/types.js';
import {
  getOrCreateProject,
  getAllProjects,
  getProject,
  makePaths,
  makeLegacyPaths,
  normalizeRootKey,
  removeProject,
  type ProjectState
} from './project-state.js';

analyzerRegistry.register(new AngularAnalyzer());
analyzerRegistry.register(new GenericAnalyzer());

// Flags that are NOT project paths — skip them when resolving the bootstrap root.
const KNOWN_FLAGS = new Set(['--http', '--port', '--help']);

// Resolve optional bootstrap root with validation handled later in main().
function resolveRootPath(): string | undefined {
  const envPath = process.env.CODEBASE_ROOT;

  // Walk argv starting at position 2, skip known flags and their values.
  let arg: string | undefined;
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i];
    if (!token) continue;
    if (KNOWN_FLAGS.has(token)) {
      if (token === '--port') i++; // skip the value that follows --port
      continue;
    }
    if (!token.startsWith('-')) {
      arg = token;
      break;
    }
  }

  // Priority: CLI arg > env var. Do not fall back to cwd in MCP mode.
  const configuredRoot = arg || envPath;
  if (!configuredRoot) {
    return undefined;
  }

  return path.resolve(configuredRoot);
}

const primaryRootPath = resolveRootPath();
const toolNames = new Set(TOOLS.map((tool) => tool.name));
const knownRoots = new Map<string, { rootPath: string; label?: string }>();
const discoveredProjectPaths = new Map<string, string>();
let clientRootsEnabled = false;
const projectSourcesByKey = new Map<string, ProjectDescriptor['source']>();
const projectAccessOrder = new Map<string, number>();
let activeProjectKey: string | undefined;
let nextProjectAccessOrder = 1;
const MAX_WATCHED_PROJECTS = 5;
const PROJECT_DISCOVERY_MAX_DEPTH = 4;
const debounceEnv = Number.parseInt(process.env.CODEBASE_CONTEXT_DEBOUNCE_MS ?? '', 10);
const watcherDebounceMs = Number.isFinite(debounceEnv) && debounceEnv >= 0 ? debounceEnv : 2000;

type ProjectResolution =
  | { ok: true; project: ProjectState }
  | { ok: false; response: ToolResponse };

function registerKnownRoot(rootPath: string): string {
  const resolvedRootPath = path.resolve(rootPath);
  knownRoots.set(normalizeRootKey(resolvedRootPath), { rootPath: resolvedRootPath });
  rememberProjectPath(resolvedRootPath, 'root');
  return resolvedRootPath;
}

function getKnownRootPaths(): string[] {
  return Array.from(knownRoots.values())
    .map((entry) => entry.rootPath)
    .sort((a, b) => a.localeCompare(b));
}

function getKnownRootLabel(rootPath: string): string | undefined {
  return knownRoots.get(normalizeRootKey(rootPath))?.label;
}

function getContainingKnownRoot(rootPath: string): string | undefined {
  const orderedRoots = getKnownRootPaths().sort((a, b) => b.length - a.length);
  return orderedRoots.find((knownRootPath) => isPathWithin(knownRootPath, rootPath));
}

function classifyProjectSource(rootPath: string): ProjectDescriptor['source'] {
  const rootKey = normalizeRootKey(rootPath);
  if (knownRoots.has(rootKey)) {
    return 'root';
  }
  return getContainingKnownRoot(rootPath) ? 'subdirectory' : 'ad_hoc';
}

function touchProject(rootPath: string): void {
  projectAccessOrder.set(normalizeRootKey(rootPath), nextProjectAccessOrder++);
}

function rememberProjectPath(
  rootPath: string,
  source: ProjectDescriptor['source'] = classifyProjectSource(rootPath),
  options: { touch?: boolean } = {}
): void {
  const resolvedRootPath = path.resolve(rootPath);
  const rootKey = normalizeRootKey(resolvedRootPath);
  const existingSource = projectSourcesByKey.get(rootKey);

  if (
    !existingSource ||
    source === 'root' ||
    (source === 'subdirectory' && existingSource === 'ad_hoc')
  ) {
    projectSourcesByKey.set(rootKey, source);
  }

  if (options.touch !== false) {
    touchProject(resolvedRootPath);
  }
}

function registerDiscoveredProjectPath(
  rootPath: string,
  source: ProjectDescriptor['source'] = 'subdirectory'
): void {
  const resolvedRootPath = path.resolve(rootPath);
  discoveredProjectPaths.set(normalizeRootKey(resolvedRootPath), resolvedRootPath);
  rememberProjectPath(resolvedRootPath, source, { touch: false });
}

function clearDiscoveredProjectPaths(): void {
  discoveredProjectPaths.clear();
}

function getTrackedRootPathByKey(rootKey: string): string | undefined {
  if (knownRoots.has(rootKey)) {
    return knownRoots.get(rootKey)?.rootPath;
  }

  const project = Array.from(getAllProjects()).find(
    (entry) => normalizeRootKey(entry.rootPath) === rootKey
  );
  return project?.rootPath;
}

function forgetProjectPath(rootPath: string): void {
  const rootKey = normalizeRootKey(rootPath);
  projectSourcesByKey.delete(rootKey);
  projectAccessOrder.delete(rootKey);
  if (activeProjectKey === rootKey) {
    activeProjectKey = undefined;
  }
}

function formatProjectLabel(rootPath: string): string {
  const knownRootLabel = getKnownRootLabel(rootPath);
  if (knownRootLabel) {
    return knownRootLabel;
  }

  const containingRoot = getContainingKnownRoot(rootPath);
  if (containingRoot) {
    const relativePath = path.relative(containingRoot, rootPath);
    if (!relativePath) {
      return getKnownRootLabel(containingRoot) ?? (path.basename(rootPath) || rootPath);
    }
    return relativePath.replace(/\\/g, '/');
  }
  return path.basename(rootPath) || rootPath;
}

function getRelativeProjectPath(rootPath: string): string | undefined {
  const containingRoot = getContainingKnownRoot(rootPath);
  if (!containingRoot) return undefined;

  const relativePath = path.relative(containingRoot, rootPath).replace(/\\/g, '/');
  return relativePath || undefined;
}

function getProjectIndexStatus(rootPath: string): ProjectDescriptor['indexStatus'] {
  return getProject(rootPath)?.indexState.status ?? 'idle';
}

function buildProjectDescriptor(rootPath: string): ProjectDescriptor {
  const resolvedRootPath = path.resolve(rootPath);
  const rootKey = normalizeRootKey(resolvedRootPath);
  rememberProjectPath(resolvedRootPath, classifyProjectSource(resolvedRootPath), { touch: false });
  return {
    project: resolvedRootPath,
    label: formatProjectLabel(resolvedRootPath),
    rootPath: resolvedRootPath,
    relativePath: getRelativeProjectPath(resolvedRootPath),
    active: activeProjectKey === rootKey,
    source: projectSourcesByKey.get(rootKey) ?? classifyProjectSource(resolvedRootPath),
    indexStatus: getProjectIndexStatus(resolvedRootPath)
  };
}

function listProjectDescriptors(): ProjectDescriptor[] {
  const rootPaths = new Map<string, string>();
  for (const rootPath of getKnownRootPaths()) {
    rootPaths.set(normalizeRootKey(rootPath), rootPath);
  }
  for (const [projectKey, rootPath] of discoveredProjectPaths.entries()) {
    rootPaths.set(projectKey, rootPath);
  }
  for (const project of getAllProjects()) {
    rootPaths.set(normalizeRootKey(project.rootPath), project.rootPath);
  }

  const descriptors = Array.from(rootPaths.values())
    .map((rootPath) => buildProjectDescriptor(rootPath))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.source !== b.source) {
        const weight: Record<ProjectDescriptor['source'], number> = {
          root: 0,
          subdirectory: 1,
          ad_hoc: 2
        };
        return weight[a.source] - weight[b.source];
      }
      return a.label.localeCompare(b.label);
    });

  const duplicates = new Set<string>();
  const counts = new Map<string, number>();
  for (const descriptor of descriptors) {
    counts.set(descriptor.label, (counts.get(descriptor.label) ?? 0) + 1);
  }
  for (const [label, count] of counts.entries()) {
    if (count > 1) {
      duplicates.add(label);
    }
  }

  return descriptors.map((descriptor) => {
    if (!duplicates.has(descriptor.label)) {
      return descriptor;
    }

    const containingRoot = getContainingKnownRoot(descriptor.rootPath);
    const rootHint =
      (containingRoot && getKnownRootLabel(containingRoot)) ||
      (containingRoot && path.basename(containingRoot)) ||
      path.basename(descriptor.rootPath);

    return {
      ...descriptor,
      label: `${descriptor.label} (${rootHint})`
    };
  });
}

function getActiveProjectDescriptor(): ProjectDescriptor | undefined {
  if (!activeProjectKey) return undefined;
  const trackedRootPath = getTrackedRootPathByKey(activeProjectKey);

  if (!trackedRootPath) {
    activeProjectKey = undefined;
    return undefined;
  }

  return buildProjectDescriptor(trackedRootPath);
}

function setActiveProject(rootPath: string): void {
  const resolvedRootPath = path.resolve(rootPath);
  activeProjectKey = normalizeRootKey(resolvedRootPath);
  rememberProjectPath(resolvedRootPath);
}

function syncKnownRoots(rootEntries: Array<{ rootPath: string; label?: string }>): void {
  const nextRoots = new Map<string, { rootPath: string; label?: string }>();
  const normalizedRoots =
    rootEntries.length > 0 ? rootEntries : primaryRootPath ? [{ rootPath: primaryRootPath }] : [];

  for (const entry of normalizedRoots) {
    const resolvedRootPath = path.resolve(entry.rootPath);
    nextRoots.set(normalizeRootKey(resolvedRootPath), {
      rootPath: resolvedRootPath,
      label: entry.label?.trim() || undefined
    });
  }

  for (const [rootKey, existingRoot] of knownRoots.entries()) {
    if (!nextRoots.has(rootKey)) {
      removeProject(existingRoot.rootPath);
      forgetProjectPath(existingRoot.rootPath);
    }
  }

  for (const project of getAllProjects()) {
    const stillAllowed = Array.from(nextRoots.values()).some((knownRoot) =>
      isPathWithin(knownRoot.rootPath, project.rootPath)
    );
    if (!stillAllowed) {
      removeProject(project.rootPath);
      forgetProjectPath(project.rootPath);
    }
  }

  knownRoots.clear();
  clearDiscoveredProjectPaths();
  for (const [rootKey, rootEntry] of nextRoots.entries()) {
    knownRoots.set(rootKey, rootEntry);
    rememberProjectPath(rootEntry.rootPath, 'root', { touch: false });
  }

  if (activeProjectKey) {
    if (!getTrackedRootPathByKey(activeProjectKey)) {
      activeProjectKey = undefined;
    }
  }
}

function parseProjectSelector(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmedValue = value.trim();
  if (!trimmedValue) return undefined;

  return trimmedValue;
}

function parseProjectDirectory(value: unknown): string | undefined {
  const selector = parseProjectSelector(value);
  if (!selector) return undefined;

  return selector.startsWith('file://')
    ? path.resolve(fileURLToPath(selector))
    : path.resolve(selector);
}

function getProjectSourceForResolvedPath(rootPath: string): ProjectDescriptor['source'] {
  return getContainingKnownRoot(rootPath) ? 'subdirectory' : 'ad_hoc';
}

async function resolveProjectFromAbsolutePath(resolvedPath: string): Promise<ProjectResolution> {
  const absolutePath = path.resolve(resolvedPath);
  const containingRoot = getContainingKnownRoot(absolutePath);

  if (clientRootsEnabled && getKnownRootPaths().length > 0 && !containingRoot) {
    return {
      ok: false,
      response: buildProjectSelectionError(
        'unknown_project',
        'Requested project is not under an active MCP root.'
      )
    };
  }

  let stats;
  try {
    stats = await fs.stat(absolutePath);
  } catch {
    return {
      ok: false,
      response: buildProjectSelectionError(
        'unknown_project',
        `project does not exist: ${absolutePath}`
      )
    };
  }

  const lookupPath = stats.isDirectory() ? absolutePath : path.dirname(absolutePath);
  const exactDescriptor = listProjectDescriptors().find(
    (descriptor) => normalizeRootKey(descriptor.rootPath) === normalizeRootKey(lookupPath)
  );
  if (exactDescriptor) {
    const project = getOrCreateProject(exactDescriptor.rootPath);
    if (exactDescriptor.source === 'subdirectory') {
      registerDiscoveredProjectPath(exactDescriptor.rootPath, 'subdirectory');
    } else {
      rememberProjectPath(exactDescriptor.rootPath, exactDescriptor.source, { touch: false });
    }
    return { ok: true, project };
  }

  const nearestBoundary = await findNearestProjectBoundary(absolutePath, containingRoot);
  const resolvedProjectPath =
    nearestBoundary?.rootPath ?? containingRoot ?? (stats.isDirectory() ? absolutePath : undefined);

  if (!resolvedProjectPath) {
    return {
      ok: false,
      response: buildProjectSelectionError(
        'unknown_project',
        `project was not found from path: ${absolutePath}`
      )
    };
  }

  const invalidProjectResponse = await validateResolvedProjectPath(resolvedProjectPath);
  if (invalidProjectResponse) {
    return { ok: false, response: invalidProjectResponse };
  }

  const projectSource = getProjectSourceForResolvedPath(resolvedProjectPath);
  if (projectSource === 'subdirectory') {
    registerDiscoveredProjectPath(resolvedProjectPath, 'subdirectory');
  } else {
    rememberProjectPath(resolvedProjectPath, projectSource, { touch: false });
  }

  const project = getOrCreateProject(resolvedProjectPath);
  return { ok: true, project };
}

function buildProjectSelectionPayload(
  status: 'success' | 'selection_required' | 'error',
  message: string,
  project?: ProjectState,
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    status,
    message,
    activeProject: project
      ? buildProjectDescriptor(project.rootPath)
      : (getActiveProjectDescriptor() ?? null),
    availableProjects: listProjectDescriptors(),
    ...extras
  };
}

function buildProjectSelectionError(
  errorCode: 'selection_required' | 'unknown_project',
  message: string,
  extras: Record<string, unknown> = {}
): ToolResponse {
  const status = errorCode === 'selection_required' ? 'selection_required' : 'error';
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          { ...buildProjectSelectionPayload(status, message, undefined, extras), errorCode },
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
    project: buildProjectDescriptor(project.rootPath),
    performIndexing: (incrementalOnly?: boolean) => performIndexing(project, incrementalOnly),
    listProjects: () => listProjectDescriptors(),
    getActiveProject: () => getActiveProjectDescriptor()
  };
}

function createWorkspaceToolContext(): ToolContext {
  const fallbackRootPath = primaryRootPath ?? path.resolve(process.cwd());
  return {
    indexState: { status: 'idle' },
    paths: makePaths(fallbackRootPath),
    rootPath: fallbackRootPath,
    performIndexing: () => undefined,
    listProjects: () => listProjectDescriptors(),
    getActiveProject: () => getActiveProjectDescriptor()
  };
}

if (primaryRootPath) {
  registerKnownRoot(primaryRootPath);
}

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
type IndexAction = 'served' | 'rebuild-started' | 'rebuilt-and-served';

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

async function validateResolvedProjectPath(rootPath: string): Promise<ToolResponse | undefined> {
  try {
    const stats = await fs.stat(rootPath);
    if (!stats.isDirectory()) {
      return buildProjectSelectionError(
        'unknown_project',
        `project is not a directory: ${rootPath}`
      );
    }

    if (clientRootsEnabled && getKnownRootPaths().length > 0 && !getContainingKnownRoot(rootPath)) {
      return buildProjectSelectionError(
        'unknown_project',
        'Requested project is not under an active MCP root.'
      );
    }

    return undefined;
  } catch {
    return buildProjectSelectionError('unknown_project', `project does not exist: ${rootPath}`);
  }
}

async function resolveProjectSelector(selector: string): Promise<ProjectResolution> {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector) {
    return {
      ok: false,
      response: buildProjectSelectionError(
        'unknown_project',
        'project must be a non-empty absolute path, file:// URI, or relative subproject path.'
      )
    };
  }

  if (trimmedSelector.startsWith('file://') || path.isAbsolute(trimmedSelector)) {
    const resolvedPath = parseProjectDirectory(trimmedSelector);
    if (!resolvedPath) {
      return {
        ok: false,
        response: buildProjectSelectionError(
          'unknown_project',
          'project must be a non-empty absolute path, file:// URI, or relative subproject path.'
        )
      };
    }
    return resolveProjectFromAbsolutePath(resolvedPath);
  }

  const normalizedSelector = trimmedSelector.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const descriptorMatches = listProjectDescriptors().filter(
    (descriptor) =>
      descriptor.label === normalizedSelector ||
      descriptor.relativePath === normalizedSelector ||
      path.basename(descriptor.rootPath) === normalizedSelector
  );

  if (descriptorMatches.length === 1) {
    const matchedRootPath = descriptorMatches[0].rootPath;
    if (descriptorMatches[0].source === 'subdirectory') {
      registerDiscoveredProjectPath(matchedRootPath, 'subdirectory');
    } else {
      rememberProjectPath(matchedRootPath, classifyProjectSource(matchedRootPath), {
        touch: false
      });
    }
    const project = getOrCreateProject(matchedRootPath);
    return { ok: true, project };
  }

  if (descriptorMatches.length > 1) {
    return {
      ok: false,
      response: buildProjectSelectionError(
        'selection_required',
        `Project selector "${normalizedSelector}" matches multiple known projects. Retry with an absolute path.`,
        {
          reason: 'project_selector_ambiguous',
          nextAction: 'retry_with_project'
        }
      )
    };
  }

  const matchingProjects = getKnownRootPaths()
    .map((rootPath) => ({ rootPath, candidatePath: path.resolve(rootPath, normalizedSelector) }))
    .filter(({ rootPath, candidatePath }) => isPathWithin(rootPath, candidatePath))
    .map(({ candidatePath }) => candidatePath);

  const resolvedMatches = new Map<string, ProjectState>();
  for (const candidatePath of matchingProjects) {
    const resolution = await resolveProjectFromAbsolutePath(candidatePath);
    if (resolution.ok) {
      resolvedMatches.set(normalizeRootKey(resolution.project.rootPath), resolution.project);
      continue;
    }

    const payload = JSON.parse(resolution.response.content?.[0]?.text ?? '{}') as {
      errorCode?: string;
    };
    if (payload.errorCode !== 'unknown_project') {
      return resolution;
    }
  }

  if (resolvedMatches.size === 1) {
    const project = Array.from(resolvedMatches.values())[0];
    return { ok: true, project };
  }

  if (resolvedMatches.size > 1) {
    return {
      ok: false,
      response: buildProjectSelectionError(
        'selection_required',
        `Relative project path "${normalizedSelector}" matches multiple configured roots. Retry with an absolute path.`,
        {
          reason: 'relative_project_ambiguous',
          nextAction: 'retry_with_project'
        }
      )
    };
  }

  return {
    ok: false,
    response: buildProjectSelectionError(
      'unknown_project',
      `Relative project path "${normalizedSelector}" was not found under any configured root.`
    )
  };
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

/**
 * Register all MCP request handlers on a Server instance.
 * Exported so HTTP mode can wire up per-session servers with the
 * same handler logic that closes over module-level state.
 */
export function registerHandlers(target: Server): void {
  target.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  target.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: buildResources() };
  });

  target.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const explicitProjectPath = getProjectPathFromContextResourceUri(uri);

    if (explicitProjectPath) {
      const selection = await resolveProjectSelector(explicitProjectPath);
      if (!selection.ok) {
        throw new Error(`Unknown project resource: ${uri}`);
      }

      const project = selection.project;
      await initProject(project.rootPath, watcherDebounceMs, { enableWatcher: true });
      setActiveProject(project.rootPath);
      return {
        contents: [
          {
            uri: buildProjectContextResourceUri(project.rootPath),
            mimeType: 'text/plain',
            text: await generateCodebaseContext(project)
          }
        ]
      };
    }

    if (isContextResourceUri(uri)) {
      const project = await resolveProjectForResource();
      return {
        contents: [
          {
            uri: CONTEXT_RESOURCE_URI,
            mimeType: 'text/plain',
            text: project ? await generateCodebaseContext(project) : buildProjectSelectionMessage()
          }
        ]
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  target.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const normalizedArgs =
      args && typeof args === 'object' && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {};

    try {
      if (!toolNames.has(name)) {
        return await dispatchTool(name, normalizedArgs, createWorkspaceToolContext());
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
        if (indexSignal.action === 'rebuild-started') {
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

      // Inject routing/index metadata into JSON responses so agents can reuse the resolved project safely.
      if (indexSignal !== undefined && result.content?.[0]) {
        try {
          const parsed = JSON.parse(result.content[0].text);
          result.content[0] = {
            type: 'text',
            text: JSON.stringify({
              ...parsed,
              index: indexSignal,
              project: buildProjectDescriptor(project.rootPath)
            })
          };
        } catch {
          /* response wasn't JSON, skip injection */
        }
      } else if (result.content?.[0]) {
        try {
          const parsed = JSON.parse(result.content[0].text);
          result.content[0] = {
            type: 'text',
            text: JSON.stringify({ ...parsed, project: buildProjectDescriptor(project.rootPath) })
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
}

const server: Server = createServer(
  { name: 'codebase-context', version: PKG_VERSION },
  registerHandlers
);

function buildResources(): Resource[] {
  const resources: Resource[] = [
    {
      uri: CONTEXT_RESOURCE_URI,
      name: 'Codebase Intelligence',
      description:
        'Context for the active project in this MCP session. In multi-project sessions, this falls back to a workspace overview until a project is selected.',
      mimeType: 'text/plain'
    }
  ];

  for (const project of listProjectDescriptors()) {
    resources.push({
      uri: buildProjectContextResourceUri(project.rootPath),
      name: `Codebase Intelligence (${project.label})`,
      description: `Project-scoped context for ${project.label}.`,
      mimeType: 'text/plain'
    });
  }

  return resources;
}

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

function buildProjectSelectionMessage(): string {
  const projects = listProjectDescriptors();
  if (projects.length === 0) {
    return [
      '# Codebase Workspace',
      '',
      'This MCP session is waiting for project context.',
      'If your host supports MCP roots, project discovery will begin after the client announces its workspace roots.',
      'Otherwise retry the tool call with `project` using an absolute project path, file path, or file:// URI.'
    ].join('\n');
  }

  const lines = [
    '# Codebase Workspace',
    '',
    'This MCP session is using client-announced roots as the workspace boundary.',
    'Automatic routing is only possible when one project is unambiguous or this session already has an active project.',
    'If the MCP client does not provide enough context, retry tool calls with `project` using a root path, subproject path, or file path.',
    '',
    'Available projects:',
    ''
  ];
  for (const project of projects) {
    const projectPathHint = project.relativePath
      ? `${project.relativePath} | ${project.rootPath}`
      : project.rootPath;
    lines.push(`- ${project.label} [${project.indexStatus}]`);
    lines.push(`  project: ${projectPathHint}`);
    lines.push(`  resource: ${buildProjectContextResourceUri(project.rootPath)}`);
  }
  lines.push('');
  lines.push('Recommended flow: retry the tool call with `project`.');
  return lines.join('\n');
}

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

async function performIndexing(project: ProjectState, incrementalOnly?: boolean): Promise<void> {
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

async function refreshDiscoveredProjectsForKnownRoots(): Promise<void> {
  clearDiscoveredProjectPaths();
  await Promise.all(
    getKnownRootPaths().map(async (rootPath) => {
      const candidates = await discoverProjectsWithinRoot(rootPath, {
        maxDepth: PROJECT_DISCOVERY_MAX_DEPTH
      });
      for (const candidate of candidates) {
        registerDiscoveredProjectPath(candidate.rootPath, 'subdirectory');
      }
    })
  );
}

async function validateClientRootEntries(
  rootEntries: Array<{ rootPath: string; label?: string }>
): Promise<Array<{ rootPath: string; label?: string }>> {
  const validatedRoots = await Promise.all(
    rootEntries.map(async (entry) => {
      try {
        const stats = await fs.stat(entry.rootPath);
        if (!stats.isDirectory()) {
          return undefined;
        }

        return entry;
      } catch {
        return undefined;
      }
    })
  );

  return validatedRoots.filter((entry): entry is { rootPath: string; label?: string } => !!entry);
}

async function refreshKnownRootsFromClient(): Promise<void> {
  try {
    const { roots } = await server.listRoots();
    const fileRoots = await validateClientRootEntries(
      roots
        .map((root) => ({
          uri: root.uri,
          label: typeof root.name === 'string' && root.name.trim() ? root.name.trim() : undefined
        }))
        .filter((root) => root.uri.startsWith('file://'))
        .map((root) => ({
          rootPath: fileURLToPath(root.uri),
          label: root.label
        }))
    );

    clientRootsEnabled = fileRoots.length > 0;
    syncKnownRoots(fileRoots);
  } catch {
    clientRootsEnabled = false;
    syncKnownRoots(primaryRootPath ? [{ rootPath: primaryRootPath }] : []);
  }

  await refreshDiscoveredProjectsForKnownRoots();
}

async function resolveExplicitProjectSelection(selection: {
  project?: string;
  projectDirectory?: string;
}): Promise<ProjectResolution> {
  const explicitProject = selection.project ?? selection.projectDirectory;
  if (explicitProject) {
    const resolution = await resolveProjectSelector(explicitProject);
    if (!resolution.ok) {
      return resolution;
    }

    await initProject(resolution.project.rootPath, watcherDebounceMs, { enableWatcher: true });
    setActiveProject(resolution.project.rootPath);
    return resolution;
  }

  return {
    ok: false,
    response: buildProjectSelectionError('selection_required', 'No project selector was provided.')
  };
}

async function resolveProjectForTool(args: Record<string, unknown>): Promise<ProjectResolution> {
  const requestedProject = parseProjectSelector(args.project);
  const requestedProjectDirectory = parseProjectSelector(args.project_directory);

  if (requestedProject || requestedProjectDirectory) {
    return resolveExplicitProjectSelection({
      project: requestedProject,
      projectDirectory: requestedProjectDirectory
    });
  }

  const activeProject = activeProjectKey ? getTrackedRootPathByKey(activeProjectKey) : undefined;
  if (activeProject) {
    const project = getOrCreateProject(activeProject);
    await initProject(project.rootPath, watcherDebounceMs, { enableWatcher: true });
    touchProject(project.rootPath);
    return { ok: true, project };
  }

  const availableProjects = listProjectDescriptors();
  if (availableProjects.length === 0) {
    return {
      ok: false,
      response: buildProjectSelectionError(
        'selection_required',
        'No active project is available yet. Retry with project or wait for MCP roots to arrive.',
        {
          reason: clientRootsEnabled
            ? 'workspace_waiting_for_project_selection'
            : 'workspace_waiting_for_roots_or_project',
          nextAction: 'retry_with_project'
        }
      )
    };
  }

  if (availableProjects.length === 1) {
    const project = getOrCreateProject(availableProjects[0].rootPath);
    await initProject(project.rootPath, watcherDebounceMs, { enableWatcher: true });
    setActiveProject(project.rootPath);
    return { ok: true, project };
  }

  return {
    ok: false,
    response: buildProjectSelectionError(
      'selection_required',
      'Multiple projects are available and no active project could be inferred. Retry with project.',
      {
        reason: 'multiple_projects_configured_no_active_context',
        nextAction: 'retry_with_project'
      }
    )
  };
}

async function resolveProjectForResource(): Promise<ProjectState | undefined> {
  const activeProject = activeProjectKey ? getTrackedRootPathByKey(activeProjectKey) : undefined;
  if (activeProject) {
    const project = getOrCreateProject(activeProject);
    await initProject(project.rootPath, watcherDebounceMs, { enableWatcher: true });
    touchProject(project.rootPath);
    return project;
  }

  const availableProjects = listProjectDescriptors();
  if (availableProjects.length !== 1) {
    return undefined;
  }

  const project = getOrCreateProject(availableProjects[0].rootPath);
  await initProject(project.rootPath, watcherDebounceMs, { enableWatcher: true });
  setActiveProject(project.rootPath);
  return project;
}

/**
 * Initialize a project: migrate legacy structure, check index, start watcher.
 * Deduplicates via normalized root key.
 */
type InitProjectOptions = {
  enableWatcher: boolean;
};

async function ensureProjectInitialized(project: ProjectState): Promise<void> {
  if (project.initPromise) {
    await project.initPromise;
    return;
  }

  if (project.indexState.status !== 'idle') {
    return;
  }

  project.initPromise = (async () => {
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
  })().finally(() => {
    project.initPromise = undefined;
  });

  await project.initPromise;
}

function ensureProjectWatcher(project: ProjectState, debounceMs: number): void {
  if (project.stopWatcher) {
    touchProject(project.rootPath);
    return;
  }

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

  touchProject(project.rootPath);
  const watchedProjects = getAllProjects().filter((entry) => entry.stopWatcher);
  if (watchedProjects.length <= MAX_WATCHED_PROJECTS) {
    return;
  }

  const evictionCandidates = watchedProjects
    .filter((entry) => normalizeRootKey(entry.rootPath) !== activeProjectKey)
    .sort((a, b) => {
      const accessA = projectAccessOrder.get(normalizeRootKey(a.rootPath)) ?? 0;
      const accessB = projectAccessOrder.get(normalizeRootKey(b.rootPath)) ?? 0;
      return accessA - accessB;
    });

  const projectToEvict = evictionCandidates[0];
  if (projectToEvict?.stopWatcher) {
    projectToEvict.stopWatcher();
    delete projectToEvict.stopWatcher;
  }
}

async function initProject(
  rootPath: string,
  debounceMs: number,
  options: InitProjectOptions
): Promise<void> {
  rememberProjectPath(rootPath);
  const project = getOrCreateProject(rootPath);
  await ensureProjectInitialized(project);
  touchProject(project.rootPath);

  if (options.enableWatcher) {
    ensureProjectWatcher(project, debounceMs);
  }
}

async function main() {
  if (primaryRootPath) {
    // Validate bootstrap root path exists and is a directory when explicitly configured.
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
  }

  // Server startup banner (guarded to avoid stderr during MCP STDIO handshake)
  if (process.env.CODEBASE_CONTEXT_DEBUG) {
    console.error('[DEBUG] Codebase Context MCP Server');
    console.error(
      primaryRootPath
        ? `[DEBUG] Bootstrap root: ${primaryRootPath}`
        : '[DEBUG] Bootstrap root: <workspace-awaiting>'
    );
    console.error(
      `[DEBUG] Analyzers: ${analyzerRegistry
        .getAll()
        .map((a) => a.name)
        .join(', ')}`
    );
  }

  // Check for package.json to confirm it's a project root (guarded to avoid stderr during handshake)
  if (process.env.CODEBASE_CONTEXT_DEBUG && primaryRootPath) {
    try {
      await fs.access(path.join(primaryRootPath, 'package.json'));
      console.error(`[DEBUG] Project detected: ${path.basename(primaryRootPath)}`);
    } catch {
      console.error(`[DEBUG] WARNING: No package.json found. This may not be a project root.`);
    }
  }

  // Parent death guard — catches SIGKILL, crashes, terminal close on ALL platforms.
  // process.kill(pid, 0) throws ESRCH when the process no longer exists.
  const parentPid = process.ppid;
  if (parentPid > 1) {
    const parentGuard = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch (err: unknown) {
        // ESRCH = process gone → exit. EPERM = process alive, different UID → ignore.
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
          process.exit(0);
        }
      }
    }, 5_000);
    parentGuard.unref();
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Register cleanup before any handler that calls process.exit(), so the
  // exit listener is always in place when stdin/onclose/signals fire.
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
  process.once('SIGHUP', () => {
    stopAllWatchers();
    process.exit(0);
  });

  // Detect stdin pipe closure — the primary signal that the MCP client is gone.
  // StdioServerTransport only listens for 'data'/'error', never 'end'.
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));

  // Handle graceful MCP protocol-level disconnect.
  // Fires after SDK internal cleanup when transport.close() is called.
  server.onclose = () => process.exit(0);

  if (process.env.CODEBASE_CONTEXT_DEBUG) console.error('[DEBUG] Server ready');

  await refreshKnownRootsFromClient();

  // Keep the current single-project auto-select behavior when exactly one startup project is known.
  const startupRoots = getKnownRootPaths();
  if (startupRoots.length === 1) {
    await initProject(startupRoots[0], watcherDebounceMs, { enableWatcher: true });
    setActiveProject(startupRoots[0]);
  }

  // Subscribe to root changes
  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    try {
      await refreshKnownRootsFromClient();
    } catch {
      /* best-effort */
    }
  });
}

// Export server components for programmatic use
export { server, refreshKnownRootsFromClient, resolveRootPath, shouldReindex, TOOLS, PKG_VERSION };
export { performIndexing };

/**
 * Start the server in HTTP mode.
 * Each connecting MCP client gets its own Server+Transport pair,
 * sharing the same module-level project state.
 */
async function startHttp(port: number): Promise<void> {
  // Validate bootstrap root the same way main() does
  if (primaryRootPath) {
    try {
      const stats = await fs.stat(primaryRootPath);
      if (!stats.isDirectory()) {
        console.error(`ERROR: Root path is not a directory: ${primaryRootPath}`);
        process.exit(1);
      }
    } catch {
      console.error(`ERROR: Root path does not exist: ${primaryRootPath}`);
      process.exit(1);
    }
  }

  const handle = await startHttpServer({
    name: 'codebase-context',
    version: PKG_VERSION,
    port,
    registerHandlers,
    onSessionReady: (sessionServer) => {
      // Per-session roots change handler
      sessionServer.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
        try {
          await refreshKnownRootsFromClient();
        } catch {
          /* best-effort */
        }
      });
    }
  });

  // Register cleanup — no parent death guard or stdin listeners in HTTP mode
  const stopAllWatchers = () => {
    for (const project of getAllProjects()) {
      project.stopWatcher?.();
    }
  };

  const shutdown = async () => {
    console.error('[HTTP] Shutting down...');
    stopAllWatchers();
    await handle.close();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  process.once('exit', stopAllWatchers);

  // If a bootstrap root was provided, auto-init it
  if (primaryRootPath) {
    registerKnownRoot(primaryRootPath);
    await refreshDiscoveredProjectsForKnownRoots();
    const startupRoots = getKnownRootPaths();
    if (startupRoots.length === 1) {
      await initProject(startupRoots[0], watcherDebounceMs, { enableWatcher: true });
      setActiveProject(startupRoots[0]);
    }
  }
}

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
    // Detect HTTP mode from flags or env vars
    const httpFlag = process.argv.includes('--http') || process.env.CODEBASE_CONTEXT_HTTP === '1';

    if (httpFlag) {
      const portFlagIdx = process.argv.indexOf('--port');
      const portFromFlag =
        portFlagIdx !== -1 ? Number.parseInt(process.argv[portFlagIdx + 1], 10) : undefined;
      const portFromEnv = process.env.CODEBASE_CONTEXT_PORT
        ? Number.parseInt(process.env.CODEBASE_CONTEXT_PORT, 10)
        : undefined;
      const port =
        portFromFlag && Number.isFinite(portFromFlag)
          ? portFromFlag
          : portFromEnv && Number.isFinite(portFromEnv)
            ? portFromEnv
            : 3100;

      startHttp(port).catch((error) => {
        console.error('Fatal:', error);
        process.exit(1);
      });
    } else {
      main().catch((error) => {
        console.error('Fatal:', error);
        process.exit(1);
      });
    }
  }
}
