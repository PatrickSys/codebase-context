import { promises as fs } from 'fs';
import path from 'path';
import { CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME } from '../constants/codebase-context.js';
import { IndexCorruptedError } from '../errors/index.js';
import type { UsageLocation } from '../types/index.js';
import { detectLanguage } from '../utils/language-detection.js';
import { isPathWithin } from '../utils/project-discovery.js';
import { findIdentifierOccurrences } from '../utils/tree-sitter.js';

interface IndexedChunk {
  relativePath?: unknown;
  filePath?: unknown;
}

export interface SymbolUsage extends UsageLocation {
  preview: string;
}

interface SymbolReferencesSuccess {
  status: 'success';
  symbol: string;
  usageCount: number;
  usages: SymbolUsage[];
  confidence: 'syntactic';
  isComplete: boolean;
}

interface SymbolReferencesError {
  status: 'error';
  message: string;
}

export type SymbolReferencesResult = SymbolReferencesSuccess | SymbolReferencesError;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ResolvedChunkLocation {
  relativePath: string;
  absolutePath: string;
}

function resolveProjectLocation(
  rootPath: string,
  candidatePath: string
): ResolvedChunkLocation | null {
  const resolvedRoot = path.resolve(rootPath);
  const absolutePath = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(resolvedRoot, candidatePath);
  const relativePath = path.relative(resolvedRoot, absolutePath);

  if (!relativePath || !isPathWithin(resolvedRoot, absolutePath)) {
    return null;
  }

  return { absolutePath, relativePath: relativePath.replace(/\\/g, '/') };
}

async function resolveChunkLocation(
  rootPath: string,
  chunk: IndexedChunk,
  fileExistence: Map<string, boolean>
): Promise<ResolvedChunkLocation | null> {
  for (const candidate of [chunk.filePath, chunk.relativePath]) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const location = resolveProjectLocation(rootPath, candidate.trim());
    if (!location) continue;
    if (!fileExistence.has(location.absolutePath)) {
      fileExistence.set(location.absolutePath, await fileExists(location.absolutePath));
    }
    if (fileExistence.get(location.absolutePath)) return location;
  }
  return null;
}

function buildPreviewFromFileLines(lines: string[], line: number): string {
  const start = Math.max(0, line - 2);
  const end = Math.min(lines.length, line + 1);
  return lines.slice(start, end).join('\n').trim();
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function findSymbolReferences(
  rootPath: string,
  symbol: string,
  limit = 10
): Promise<SymbolReferencesResult> {
  const normalizedSymbol = symbol.trim();
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;

  if (!normalizedSymbol) {
    return {
      status: 'error',
      message: 'Symbol is required'
    };
  }

  const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);

  let chunksRaw: unknown;
  try {
    const content = await fs.readFile(indexPath, 'utf-8');
    chunksRaw = JSON.parse(content);
  } catch (error) {
    throw new IndexCorruptedError(
      `Keyword index missing or unreadable (rebuild required): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (Array.isArray(chunksRaw)) {
    throw new IndexCorruptedError(
      'Legacy keyword index format detected (missing header). Rebuild required.'
    );
  }

  const chunks =
    chunksRaw !== null &&
    typeof chunksRaw === 'object' &&
    'chunks' in chunksRaw &&
    Array.isArray(chunksRaw.chunks)
      ? (chunksRaw.chunks as unknown[])
      : null;

  if (!chunks) {
    throw new IndexCorruptedError('Keyword index corrupted: expected { header, chunks }');
  }

  const usages: SymbolUsage[] = [];
  let usageCount = 0;

  const escapedSymbol = escapeRegex(normalizedSymbol);
  const prefilter = new RegExp(`\\b${escapedSymbol}\\b`);
  const matcher = new RegExp(`\\b${escapedSymbol}\\b`, 'g');

  // Use the index to nominate files, not to rule out symbols added since indexing.
  // Both the symbol prefilter and reference locations must use current source.
  const candidateFiles = new Map<string, ResolvedChunkLocation>();
  const fileExistence = new Map<string, boolean>();

  for (const chunkRaw of chunks) {
    const chunk = chunkRaw as IndexedChunk;
    const location = await resolveChunkLocation(rootPath, chunk, fileExistence);
    if (!location) continue;
    candidateFiles.set(location.relativePath, location);
  }

  for (const { relativePath, absolutePath } of candidateFiles.values()) {
    let content: string;
    try {
      content = (await fs.readFile(absolutePath, 'utf-8')).replace(/\r\n/g, '\n');
    } catch {
      // A source file may disappear or become unreadable after index lookup.
      // Cached chunks cannot substantiate a current source location.
      continue;
    }

    if (!prefilter.test(content)) continue;

    const lines = content.split('\n');
    const occurrences = await findIdentifierOccurrences(
      content,
      detectLanguage(absolutePath),
      normalizedSymbol
    ).catch(() => null);

    if (occurrences) {
      usageCount += occurrences.length;
      for (const occurrence of occurrences) {
        if (usages.length >= normalizedLimit) break;
        usages.push({
          file: relativePath,
          line: occurrence.line,
          preview: buildPreviewFromFileLines(lines, occurrence.line)
        });
      }
      continue;
    }

    // Without a parser, count text matches in the current file, not stale or
    // overlapping indexed chunks. Line numbers and previews share that source.
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      matcher.lastIndex = 0;
      while (matcher.exec(lines[lineIndex]) !== null) {
        usageCount += 1;
        if (usages.length < normalizedLimit) {
          usages.push({
            file: relativePath,
            line: lineIndex + 1,
            preview: buildPreviewFromFileLines(lines, lineIndex + 1)
          });
        }
      }
    }
  }

  return {
    status: 'success',
    symbol: normalizedSymbol,
    usageCount,
    usages,
    confidence: 'syntactic',
    isComplete: usageCount < normalizedLimit
  };
}
