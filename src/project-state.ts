import path from 'path';
import {
  CODEBASE_CONTEXT_DIRNAME,
  MEMORY_FILENAME,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME
} from './constants/codebase-context.js';
import { createAutoRefreshController } from './core/auto-refresh.js';
import type { AutoRefreshController } from './core/auto-refresh.js';
import type { ToolPaths, IndexState } from './tools/types.js';

export interface ProjectState {
  rootPath: string;
  paths: ToolPaths;
  indexState: IndexState;
  autoRefresh: AutoRefreshController;
  initPromise?: Promise<void>;
  stopWatcher?: () => void;
  /** Extra glob exclusion patterns from config file — merged with EXCLUDED_GLOB_PATTERNS at index time. */
  extraExcludePatterns?: string[];
}

export function makePaths(rootPath: string): ToolPaths {
  return {
    baseDir: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME),
    memory: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, MEMORY_FILENAME),
    intelligence: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, INTELLIGENCE_FILENAME),
    keywordIndex: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME),
    vectorDb: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, VECTOR_DB_DIRNAME)
  };
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
    autoRefresh: createAutoRefreshController()
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

export function removeProject(rootPath: string): void {
  const key = normalizeRootKey(rootPath);
  const project = projects.get(key);
  project?.stopWatcher?.();
  projects.delete(key);
}

export function clearProjects(): void {
  for (const project of projects.values()) {
    project.stopWatcher?.();
  }
  projects.clear();
}
