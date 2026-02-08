/**
 * File hash manifest for incremental indexing.
 * Tracks SHA-256 hashes of indexed files to detect changes between runs.
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export interface FileManifest {
  version: 1;
  generatedAt: string;
  files: Record<string, string>; // relativePath → SHA-256 hash (first 16 hex chars)
}

export interface ManifestDiff {
  added: string[];    // new files (not in old manifest)
  changed: string[];  // hash differs
  deleted: string[];  // in old manifest but not on disk
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
