/**
 * File hash manifest for incremental indexing.
 * Tracks SHA-256 hashes of indexed files to detect changes between runs.
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';

import { CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME } from '../constants/codebase-context.js';
import { IndexCorruptedError } from '../errors/index.js';
import {
  ArtifactHeaderSchema,
  validateArtifactBuildIdentity,
  type ArtifactHeader,
  type IndexMeta
} from './index-meta.js';
import { isPathWithin } from '../utils/project-discovery.js';

export interface FileManifest {
  version: 1;
  generatedAt: string;
  files: Record<string, string>; // relativePath → SHA-256 hash (first 16 hex chars)
  header?: ArtifactHeader;
}

const ReferenceManifestSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.string().datetime(),
    header: ArtifactHeaderSchema,
    files: z.record(z.string(), z.string().regex(/^[a-f0-9]{16}$/i))
  })
  .strict();

export interface ManifestDiff {
  added: string[]; // new files (not in old manifest)
  changed: string[]; // hash differs
  deleted: string[]; // in old manifest but not on disk
  unchanged: string[]; // hash matches
}

/**
 * Hash file content using SHA-256, returning first 16 hex chars.
 * 16 hex chars = 64 bits of entropy — collision-safe for per-project file counts.
 */
export function hashFileContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Read a manifest from disk. Returns null if missing or corrupt.
 */
export async function readManifest(manifestPath: string): Promise<FileManifest | null> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || typeof parsed.files !== 'object') {
      return null;
    }
    return parsed as FileManifest;
  } catch {
    return null;
  }
}

function fullReindexError(message: string, detail?: string): IndexCorruptedError {
  const suffix = detail ? ` ${detail}` : '';
  return new IndexCorruptedError(
    `${message} Full reindex required: run codebase-context reindex without --incremental.${suffix}`
  );
}

function isSafeManifestSourcePath(rootPath: string, relativePath: string): boolean {
  if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) return false;
  const normalized = relativePath.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized)) return false;
  if (normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return false;
  }

  const resolved = path.resolve(rootPath, relativePath);
  if (!isPathWithin(rootPath, resolved)) return false;
  return path.relative(rootPath, resolved).replace(/\\/g, '/') === normalized;
}

/** Read the build-bound source nominator used by current-source reference lookup. */
export async function readReferenceManifest(
  rootPath: string,
  meta: IndexMeta
): Promise<FileManifest> {
  if (meta.artifacts.manifest?.path !== MANIFEST_FILENAME) {
    throw fullReindexError('Reference manifest path is missing or invalid.');
  }

  let realRoot: string;
  let realContext: string;
  try {
    realRoot = await fs.realpath(rootPath);
    realContext = await fs.realpath(path.join(realRoot, CODEBASE_CONTEXT_DIRNAME));
  } catch (error) {
    throw fullReindexError(
      'Reference manifest directory is missing or unreadable.',
      error instanceof Error ? error.message : String(error)
    );
  }
  if (!isPathWithin(realRoot, realContext)) {
    throw fullReindexError('Reference manifest directory resolves outside the selected project.');
  }

  const expectedManifestPath = path.join(realContext, MANIFEST_FILENAME);
  let realManifestPath: string;
  try {
    realManifestPath = await fs.realpath(expectedManifestPath);
  } catch (error) {
    throw fullReindexError(
      'Reference manifest is missing or unreadable.',
      error instanceof Error ? error.message : String(error)
    );
  }
  if (!isPathWithin(realContext, realManifestPath)) {
    throw fullReindexError('Reference manifest resolves outside the index directory.');
  }

  let json: unknown;
  try {
    json = JSON.parse(await fs.readFile(realManifestPath, 'utf8'));
  } catch (error) {
    throw fullReindexError(
      'Reference manifest is malformed or unreadable.',
      error instanceof Error ? error.message : String(error)
    );
  }

  const parsed = ReferenceManifestSchema.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.issues.some((issue) => issue.path[0] === 'header')
      ? 'The source manifest is legacy or has an invalid build header.'
      : `Manifest schema mismatch: ${parsed.error.message}`;
    throw fullReindexError('Reference manifest is invalid.', details);
  }

  try {
    validateArtifactBuildIdentity(
      parsed.data.header,
      meta,
      'Reference manifest',
      MANIFEST_FILENAME
    );
  } catch (error) {
    throw fullReindexError(
      'Reference manifest build identity does not match index metadata.',
      error instanceof Error ? error.message : String(error)
    );
  }

  for (const relativePath of Object.keys(parsed.data.files)) {
    if (!isSafeManifestSourcePath(realRoot, relativePath)) {
      throw new IndexCorruptedError(
        `Reference manifest contains an invalid or escaping source path (${relativePath}). Rebuild required.`
      );
    }
  }

  return parsed.data;
}

/**
 * Write a manifest to disk.
 */
export async function writeManifest(manifestPath: string, manifest: FileManifest): Promise<void> {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
}

/**
 * Compute SHA-256 hashes for a list of absolute file paths.
 * Returns a map of relativePath → hash.
 */
export async function computeFileHashes(
  files: string[],
  rootPath: string,
  readFile: (p: string) => Promise<string> = (p) => fs.readFile(p, 'utf-8')
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const file of files) {
    try {
      const content = await readFile(file);
      const relativePath = path.relative(rootPath, file).replace(/\\/g, '/');
      hashes[relativePath] = hashFileContent(content);
    } catch {
      // Skip files that can't be read
    }
  }
  return hashes;
}

/**
 * Diff an old manifest against current file hashes.
 * If oldManifest is null (first run), all files are "added".
 */
export function diffManifest(
  oldManifest: FileManifest | null,
  currentHashes: Record<string, string>
): ManifestDiff {
  const oldFiles = oldManifest?.files ?? {};
  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  const deleted: string[] = [];

  // Check current files against old manifest
  for (const [filePath, hash] of Object.entries(currentHashes)) {
    if (!(filePath in oldFiles)) {
      added.push(filePath);
    } else if (oldFiles[filePath] !== hash) {
      changed.push(filePath);
    } else {
      unchanged.push(filePath);
    }
  }

  // Check for deleted files (in old manifest but not in current)
  for (const filePath of Object.keys(oldFiles)) {
    if (!(filePath in currentHashes)) {
      deleted.push(filePath);
    }
  }

  return { added, changed, deleted, unchanged };
}
