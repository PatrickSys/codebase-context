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

function buildPreviewFromFileLines(lines: string[], line: number): string {
  const start = Math.max(0, line - 2);
  const end = Math.min(lines.length, line + 1);
  return lines.slice(start, end).join('\n').trim();
}

function resolveAbsoluteChunkPath(rootPath: string, chunk: IndexedChunk): string | null {
  const resolvedRoot = path.resolve(rootPath);
  const isWithinRoot = (candidate: string): boolean => {
    return isPathWithin(resolvedRoot, candidate);
  };

  if (typeof chunk.filePath === 'string' && chunk.filePath.trim()) {
    const raw = chunk.filePath.trim();
    if (path.isAbsolute(raw)) {
      return isWithinRoot(raw) ? raw : null;
    }
    const resolved = path.resolve(resolvedRoot, raw);
    return isWithinRoot(resolved) ? resolved : null;
  }

  if (typeof chunk.relativePath === 'string' && chunk.relativePath.trim()) {
    const resolved = path.resolve(resolvedRoot, chunk.relativePath.trim());
    return isWithinRoot(resolved) ? resolved : null;
  }

  return null;
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
  const matcher = new RegExp(`\\b${escapedSymbol}\\b`, 'g');

  // The index nominates source files only. Current source bytes determine matches,
  // locations, and previews, including when parser support is unavailable.
  const candidateFiles = new Map<string, string>();

  for (const chunkRaw of chunks) {
    const chunk = chunkRaw as IndexedChunk;
    const absPath = resolveAbsoluteChunkPath(rootPath, chunk);
    if (!absPath) {
      return {
        status: 'error',
        message:
          'Indexed source location is invalid. Refresh the index before trusting reference results.'
      };
    }
    const relPath = path.relative(rootPath, absPath).replace(/\\/g, '/');
    candidateFiles.set(relPath, absPath);
  }

  let realRootPath: string;
  try {
    realRootPath = await fs.realpath(rootPath);
  } catch {
    return { status: 'error', message: 'Selected project path is missing or unreadable.' };
  }
  for (const [relativePath, absolutePath] of candidateFiles) {
    let realSourcePath: string;
    try {
      realSourcePath = await fs.realpath(absolutePath);
    } catch {
      return {
        status: 'error',
        message: `Indexed source is missing or unreadable (${relativePath}). Refresh the index before trusting reference results.`
      };
    }
    if (!isPathWithin(realRootPath, realSourcePath)) {
      return {
        status: 'error',
        message: `Indexed source resolves outside the selected project (${relativePath}). Refresh the index before trusting reference results.`
      };
    }

    let source: string;
    try {
      if (!(await fs.stat(realSourcePath)).isFile()) throw new Error('not a file');
      source = (await fs.readFile(realSourcePath, 'utf-8')).replace(/\r\n/g, '\n');
    } catch {
      return {
        status: 'error',
        message: `Indexed source is missing or unreadable (${relativePath}). Refresh the index before trusting reference results.`
      };
    }
    const lines = source.split('\n');
    const occurrences = await findIdentifierOccurrences(
      source,
      detectLanguage(realSourcePath),
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
