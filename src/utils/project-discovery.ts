import { promises as fs } from 'fs';
import type { Dirent } from 'fs';
import path from 'path';
import { EXCLUDED_DIRECTORY_NAMES, DISCOVERY_ONLY_IGNORED } from '../constants/codebase-context.js';

export type ProjectEvidence =
  | 'existing_index'
  | 'repo_root'
  | 'workspace_manifest'
  | 'project_manifest';

export interface DiscoveredProjectCandidate {
  rootPath: string;
  evidence: ProjectEvidence;
}

export interface DiscoverProjectsOptions {
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 4;

const IGNORED_DIRECTORY_NAMES: Set<string> = new Set([
  ...EXCLUDED_DIRECTORY_NAMES,
  ...DISCOVERY_ONLY_IGNORED
]);

const STRONG_DIRECTORY_MARKERS = new Set(['.codebase-context', '.git']);
const WORKSPACE_MARKERS = new Set(['lerna.json', 'nx.json', 'pnpm-workspace.yaml', 'turbo.json']);
const PROJECT_MANIFEST_NAMES = new Set([
  'Cargo.toml',
  'Gemfile',
  'composer.json',
  'deno.json',
  'deno.jsonc',
  'go.mod',
  'mix.exs',
  'package.json',
  'pom.xml',
  'pyproject.toml'
]);
const PROJECT_MANIFEST_SUFFIXES = ['.csproj', '.fsproj', '.vbproj'];
const GRADLE_MANIFESTS = new Set([
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts'
]);

function normalizePathKey(filePath: string): string {
  let normalized = path.resolve(filePath);
  while (normalized.length > 1 && (normalized.endsWith('/') || normalized.endsWith('\\'))) {
    normalized = normalized.slice(0, -1);
  }
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isPathWithin(basePath: string, candidatePath: string): boolean {
  const resolvedBasePath = path.resolve(basePath);
  const resolvedCandidatePath = path.resolve(candidatePath);
  if (resolvedBasePath === resolvedCandidatePath) return true;
  const relative = path.relative(resolvedBasePath, resolvedCandidatePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function isWorkspacePackageJson(directoryPath: string): Promise<boolean> {
  const packageJsonPath = path.join(directoryPath, 'package.json');
  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const parsed = JSON.parse(content) as { workspaces?: unknown };
    if (Array.isArray(parsed.workspaces)) {
      return parsed.workspaces.length > 0;
    }
    if (
      parsed.workspaces &&
      typeof parsed.workspaces === 'object' &&
      !Array.isArray(parsed.workspaces) &&
      'packages' in parsed.workspaces
    ) {
      return Array.isArray((parsed.workspaces as { packages?: unknown }).packages);
    }
    return false;
  } catch {
    return false;
  }
}

async function classifyDirectory(
  directoryPath: string,
  fileNames: Set<string>,
  directoryNames: Set<string>
): Promise<{ candidate?: DiscoveredProjectCandidate; continueScanning: boolean }> {
  if (directoryNames.has('.codebase-context')) {
    return {
      candidate: { rootPath: directoryPath, evidence: 'existing_index' },
      continueScanning: false
    };
  }

  if (directoryNames.has('.git')) {
    return {
      candidate: { rootPath: directoryPath, evidence: 'repo_root' },
      continueScanning: false
    };
  }

  for (const marker of WORKSPACE_MARKERS) {
    if (fileNames.has(marker)) {
      return {
        candidate: { rootPath: directoryPath, evidence: 'workspace_manifest' },
        continueScanning: true
      };
    }
  }

  if (fileNames.has('package.json') && (await isWorkspacePackageJson(directoryPath))) {
    return {
      candidate: { rootPath: directoryPath, evidence: 'workspace_manifest' },
      continueScanning: true
    };
  }

  for (const fileName of fileNames) {
    if (PROJECT_MANIFEST_NAMES.has(fileName) || GRADLE_MANIFESTS.has(fileName)) {
      return {
        candidate: { rootPath: directoryPath, evidence: 'project_manifest' },
        continueScanning: false
      };
    }
    if (PROJECT_MANIFEST_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) {
      return {
        candidate: { rootPath: directoryPath, evidence: 'project_manifest' },
        continueScanning: false
      };
    }
  }

  return { continueScanning: true };
}

export async function discoverProjectsWithinRoot(
  trustedRootPath: string,
  options: DiscoverProjectsOptions = {}
): Promise<DiscoveredProjectCandidate[]> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const resolvedTrustedRootPath = path.resolve(trustedRootPath);
  const discovered = new Map<string, DiscoveredProjectCandidate>();

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const directoryNames = new Set(
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    );
    const classification = await classifyDirectory(currentPath, fileNames, directoryNames);
    const currentKey = normalizePathKey(currentPath);
    const isTrustedRoot = currentKey === normalizePathKey(resolvedTrustedRootPath);

    if (classification.candidate && !isTrustedRoot) {
      discovered.set(currentKey, classification.candidate);
    }

    const shouldContinueScanning = isTrustedRoot ? true : classification.continueScanning;
    if (depth >= maxDepth || !shouldContinueScanning) {
      return;
    }

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !IGNORED_DIRECTORY_NAMES.has(entry.name))
        .filter((entry) => !STRONG_DIRECTORY_MARKERS.has(entry.name))
        .map((entry) => walk(path.join(currentPath, entry.name), depth + 1))
    );
  }

  await walk(resolvedTrustedRootPath, 0);
  return Array.from(discovered.values()).sort((a, b) => a.rootPath.localeCompare(b.rootPath));
}

export async function findNearestProjectBoundary(
  inputPath: string,
  trustedRootPath?: string
): Promise<DiscoveredProjectCandidate | undefined> {
  const resolvedTrustedRootPath = trustedRootPath ? path.resolve(trustedRootPath) : undefined;
  let currentPath = path.resolve(inputPath);

  for (;;) {
    if (resolvedTrustedRootPath && !isPathWithin(resolvedTrustedRootPath, currentPath)) {
      return undefined;
    }

    let stats;
    try {
      stats = await fs.stat(currentPath);
    } catch {
      return undefined;
    }

    const directoryPath = stats.isDirectory() ? currentPath : path.dirname(currentPath);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      entries = [];
    }

    const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const directoryNames = new Set(
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    );
    const classification = await classifyDirectory(directoryPath, fileNames, directoryNames);
    if (classification.candidate) {
      return classification.candidate;
    }

    if (
      resolvedTrustedRootPath &&
      normalizePathKey(directoryPath) === normalizePathKey(resolvedTrustedRootPath)
    ) {
      return undefined;
    }

    const parentPath = path.dirname(directoryPath);
    if (parentPath === directoryPath) {
      return undefined;
    }

    currentPath = parentPath;
  }
}
