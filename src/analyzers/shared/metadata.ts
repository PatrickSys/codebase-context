import { promises as fs } from 'fs';
import path from 'path';
import type { CodebaseMetadata } from '../../types/index.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  KEYWORD_INDEX_FILENAME
} from '../../constants/codebase-context.js';
import { normalizePackageVersion } from '../../utils/workspace-detection.js';

interface PackageJsonShape {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface IndexChunkLike {
  filePath: string;
  startLine: number;
  endLine: number;
  componentType?: string;
  layer?: string;
}

interface KeywordIndexFile {
  chunks?: unknown;
}

const DEFAULT_INDEX_STATS_MAX_MB = 20;

export interface AnalyzerPackageInfo {
  projectName: string;
  allDependencies: Record<string, string>;
}

export async function readAnalyzerPackageInfo(rootPath: string): Promise<AnalyzerPackageInfo> {
  const packageJsonPath = path.join(rootPath, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as PackageJsonShape;

  return {
    projectName: packageJson.name || path.basename(rootPath),
    allDependencies: {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
      ...(packageJson.peerDependencies || {})
    }
  };
}

export function normalizeAnalyzerVersion(version: string | undefined): string {
  return normalizePackageVersion(version) || 'unknown';
}

export function createEmptyStatistics(): CodebaseMetadata['statistics'] {
  return {
    totalFiles: 0,
    totalLines: 0,
    totalComponents: 0,
    componentsByType: {},
    componentsByLayer: {
      presentation: 0,
      business: 0,
      data: 0,
      state: 0,
      core: 0,
      shared: 0,
      feature: 0,
      infrastructure: 0,
      unknown: 0
    }
  };
}

export async function loadAnalyzerIndexStatistics(
  rootPath: string
): Promise<CodebaseMetadata['statistics']> {
  const statistics = createEmptyStatistics();
  const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);

  try {
    const stat = await fs.stat(indexPath);
    const maxBytes = getIndexStatsMaxBytes();
    if (maxBytes === 0 || stat.size > maxBytes) {
      return statistics;
    }

    const parsed = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as
      | KeywordIndexFile
      | unknown[];
    if (Array.isArray(parsed)) {
      return statistics;
    }

    const chunks = Array.isArray(parsed.chunks) ? parsed.chunks : null;
    if (!chunks) {
      return statistics;
    }

    const typedChunks = chunks.filter(isIndexChunkLike);
    if (typedChunks.length === 0) {
      return statistics;
    }

    statistics.totalFiles = new Set(typedChunks.map((chunk) => chunk.filePath)).size;
    statistics.totalLines = typedChunks.reduce(
      (sum, chunk) => sum + (chunk.endLine - chunk.startLine + 1),
      0
    );

    for (const chunk of typedChunks) {
      if (chunk.componentType) {
        statistics.componentsByType[chunk.componentType] =
          (statistics.componentsByType[chunk.componentType] || 0) + 1;
        statistics.totalComponents++;
      }

      if (isArchitecturalLayer(chunk.layer, statistics.componentsByLayer)) {
        statistics.componentsByLayer[chunk.layer] =
          (statistics.componentsByLayer[chunk.layer] || 0) + 1;
      }
    }
  } catch {
    return statistics;
  }

  return statistics;
}

export function isFileNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function getIndexStatsMaxBytes(): number {
  const rawValue = process.env.CODEBASE_CONTEXT_INDEX_STATS_MAX_MB;
  if (rawValue && rawValue.trim()) {
    const parsedValue = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsedValue) || Number.isNaN(parsedValue)) {
      return DEFAULT_INDEX_STATS_MAX_MB * 1024 * 1024;
    }
    if (parsedValue <= 0) {
      return 0;
    }
    return parsedValue * 1024 * 1024;
  }

  return DEFAULT_INDEX_STATS_MAX_MB * 1024 * 1024;
}

function isIndexChunkLike(value: unknown): value is IndexChunkLike {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<IndexChunkLike>;
  return (
    typeof candidate.filePath === 'string' &&
    typeof candidate.startLine === 'number' &&
    typeof candidate.endLine === 'number'
  );
}

function isArchitecturalLayer(
  layer: unknown,
  layers: CodebaseMetadata['statistics']['componentsByLayer']
): layer is keyof typeof layers {
  return typeof layer === 'string' && layer in layers;
}
