import { resolveIndexArtifact } from './core/index-generation.js';
import path from 'path';
import {
  CODEBASE_CONTEXT_DIRNAME,
  MEMORY_FILENAME,
  INTELLIGENCE_FILENAME,
  HEALTH_FILENAME,
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME
} from './constants/codebase-context.js';
import { createAutoRefreshController } from './core/auto-refresh.js';
import type { AutoRefreshController } from './core/auto-refresh.js';
import type { ToolPaths, IndexState } from './tools/types.js';

export interface ProjectRuntimeOverrides {
  /** Explicit embedding mode; absent preserves the recorded project mode. */
  skipEmbedding?: boolean;
  /** Extra glob exclusion patterns merged with the default index-time exclusions. */
  extraExcludePatterns?: string[];
  /** Maximum chunks retained in semantic and keyword indexes for this project. */
  maxChunks?: number;
  /** Analyzer name to prefer for this project without mutating global registry order. */
  preferredAnalyzer?: string;
  /** Additional source extensions treated as code for this project only. */
  extraSourceExtensions?: string[];
}

export interface ProjectState {
  rootPath: string;
  paths: ToolPaths;
  indexState: IndexState;
  autoRefresh: AutoRefreshController;
  initPromise?: Promise<void>;
  stopWatcher?: () => Promise<void>;
  watcherClosePromise?: Promise<void>;
  runtimeOverrides: ProjectRuntimeOverrides;
}

export function makePaths(rootPath: string): ToolPaths {
  return {
    baseDir: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME),
    memory: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, MEMORY_FILENAME),
    intelligence: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, INTELLIGENCE_FILENAME),
    health: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, HEALTH_FILENAME),
    keywordIndex: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME),
    vectorDb: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, VECTOR_DB_DIRNAME)
  };
}

export async function resolveProjectPaths(rootPath: string): Promise<ToolPaths> {
  const legacy = makePaths(rootPath);
  const [intelligence, health, keywordIndex, vectorDb] = await Promise.all([
    resolveIndexArtifact(rootPath, INTELLIGENCE_FILENAME),
    resolveIndexArtifact(rootPath, HEALTH_FILENAME),
    resolveIndexArtifact(rootPath, KEYWORD_INDEX_FILENAME),
    resolveIndexArtifact(rootPath, VECTOR_DB_DIRNAME)
  ]);
  return { ...legacy, intelligence, health, keywordIndex, vectorDb };
}

export function makeLegacyPaths(rootPath: string) {
  return {
    intelligence: path.join(rootPath, '.codebase-intelligence.json'),
    keywordIndex: path.join(rootPath, '.codebase-index.json'),
    vectorDb: path.join(rootPath, '.codebase-index')
  };
}

export function normalizeRootKey(rootPath: string): string {
  let normalized = path.resolve(rootPath);
  // Strip trailing separator
  while (normalized.length > 1 && (normalized.endsWith('/') || normalized.endsWith('\\'))) {
    normalized = normalized.slice(0, -1);
  }
  // Case-insensitive on Windows
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

const projects = new Map<string, ProjectState>();

export function createProjectState(rootPath: string): ProjectState {
  return {
    rootPath,
    paths: makePaths(rootPath),
    indexState: { status: 'idle' },
    autoRefresh: createAutoRefreshController(),
    runtimeOverrides: {}
  };
}

export function getOrCreateProject(rootPath: string): ProjectState {
  const key = normalizeRootKey(rootPath);
  let project = projects.get(key);
  if (!project) {
    project = createProjectState(rootPath);
    projects.set(key, project);
  }
  return project;
}

export function getProject(rootPath: string): ProjectState | undefined {
  return projects.get(normalizeRootKey(rootPath));
}

export function getAllProjects(): ProjectState[] {
  return Array.from(projects.values());
}

export function stopAllProjectWatchers(): Promise<void> {
  const closing = Array.from(projects.values(), stopProjectWatcher);
  return Promise.all(closing).then(() => undefined);
}

export function stopProjectWatcher(project: ProjectState): Promise<void> {
  if (project.watcherClosePromise) return project.watcherClosePromise;
  const stop = project.stopWatcher;
  if (!stop) return Promise.resolve();

  let closing: Promise<void>;
  try {
    closing = Promise.resolve(stop());
  } catch (error) {
    console.error(`[file-watcher] Failed to close watcher for ${project.rootPath}:`, error);
    delete project.stopWatcher;
    return Promise.resolve();
  }

  delete project.stopWatcher;
  project.watcherClosePromise = closing
    .catch((error: unknown) => {
      console.error(`[file-watcher] Failed to close watcher for ${project.rootPath}:`, error);
    })
    .finally(() => {
      delete project.watcherClosePromise;
    });
  return project.watcherClosePromise;
}

export function removeProject(rootPath: string): Promise<void> {
  const key = normalizeRootKey(rootPath);
  const project = projects.get(key);
  projects.delete(key);
  return project ? stopProjectWatcher(project) : Promise.resolve();
}

export function clearProjects(): Promise<void> {
  const closing = stopAllProjectWatchers();
  projects.clear();
  return closing;
}
