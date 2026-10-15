import { promises as fs } from 'fs';
import path from 'path';
import { CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME } from '../constants/codebase-context.js';
import { IndexCorruptedError } from '../errors/index.js';
import { readIndexMeta, validateKeywordIndexArtifact } from './index-meta.js';
import { readReferenceManifest } from './manifest.js';
import type { UsageLocation } from '../types/index.js';
import { detectLanguage } from '../utils/language-detection.js';
import { isPathWithin } from '../utils/project-discovery.js';
import {
  findIdentifierOccurrences,
  findLexicalIdentifierOccurrences
} from '../utils/tree-sitter.js';

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
  confidence: 'syntactic' | 'lexical';
  isComplete: boolean;
  coverage: {
    candidateFiles: number;
    sourcesRead: number;
    filesWithoutText: number;
    filesUnavailable: number;
    parserCalls: number;
    lexicalFallbackFiles: number;
  };
}

interface SymbolReferencesError {
  status: 'error';
  message: string;
}

export type SymbolReferencesResult = SymbolReferencesSuccess | SymbolReferencesError;

type SourceReadResult =
  | { status: 'source'; source: string; realSourcePath: string }
  | { status: 'without-text' }
  | { status: 'unavailable' }
  | SymbolReferencesError;

// Bound both outstanding source I/O and buffered source contents. Parsing remains
// sequential because Tree-sitter caches a mutable parser for each language.
const SOURCE_READ_BATCH_SIZE = 4;

function buildPreviewFromFileLines(lines: string[], line: number): string {
  const start = Math.max(0, line - 2);
  const end = Math.min(lines.length, line + 1);
  return lines.slice(start, end).join('\n').trim();
}

function isOrdinarySourceAvailabilityError(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false;
  const code = error.code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM';
}

async function readReferenceSource(
  relativePath: string,
  absolutePath: string,
  realRootPath: string,
  symbol: string
): Promise<SourceReadResult> {
  try {
    const realSourcePath = await fs.realpath(absolutePath);
    if (!isPathWithin(realRootPath, realSourcePath)) {
      return {
        status: 'error',
        message: `Indexed source resolves outside the selected project (${relativePath}). Refresh the index before trusting reference results.`
      };
    }
    if (!(await fs.stat(realSourcePath)).isFile()) throw new Error('not a file');
    const source = (await fs.readFile(realSourcePath, 'utf-8')).replace(/\r\n/g, '\n');
    // Both exact AST matching and the Unicode-aware lexical matcher require this
    // spelling. Discard nonmatching buffers before the batch is consumed.
    return source.includes(symbol)
      ? { status: 'source', source, realSourcePath }
      : { status: 'without-text' };
  } catch (error) {
    if (isOrdinarySourceAvailabilityError(error)) return { status: 'unavailable' };
    return {
      status: 'error',
      message: `Indexed source is missing or unreadable (${relativePath}). Refresh the index before trusting reference results.`
    };
  }
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
  const meta = await readIndexMeta(rootPath);
  const manifest = await readReferenceManifest(rootPath, meta);

  let keywordIndexRaw: unknown;
  try {
    const content = await fs.readFile(indexPath, 'utf-8');
    keywordIndexRaw = JSON.parse(content);
  } catch (error) {
    throw new IndexCorruptedError(
      `Keyword index missing or unreadable (rebuild required): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (Array.isArray(keywordIndexRaw)) {
    throw new IndexCorruptedError(
      'Legacy keyword index format detected (missing header). Rebuild required.'
    );
  }

  const { chunks } = validateKeywordIndexArtifact(keywordIndexRaw, meta);

  const usages: SymbolUsage[] = [];
  let usageCount = 0;
  let sourcesRead = 0;
  let filesWithoutText = 0;
  let filesUnavailable = 0;
  let parserCalls = 0;
  let lexicalFallbackFiles = 0;

  // The manifest nominates every analyzed source; capped keyword chunks cannot define
  // the reference scope. Current source bytes determine matches, locations, and previews.
  const candidateFiles = new Map<string, string>();

  for (const relativePath of Object.keys(manifest.files)) {
    const absPath = resolveAbsoluteChunkPath(rootPath, { relativePath });
    if (!absPath) {
      throw new IndexCorruptedError(
        `Reference manifest contains an invalid source path (${relativePath}). Rebuild required.`
      );
    }
    const relPath = path.relative(rootPath, absPath).replace(/\\/g, '/');
    candidateFiles.set(relPath, absPath);
  }

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
    if (!Object.hasOwn(manifest.files, relPath)) {
      throw new IndexCorruptedError(
        `Keyword index source is absent from the build-bound manifest (${relPath}). Rebuild required.`
      );
    }
  }

  let realRootPath: string;
  try {
    realRootPath = await fs.realpath(rootPath);
  } catch {
    return { status: 'error', message: 'Selected project path is missing or unreadable.' };
  }
  const sourceFiles = [...candidateFiles];
  for (let offset = 0; offset < sourceFiles.length; offset += SOURCE_READ_BATCH_SIZE) {
    const batch = sourceFiles.slice(offset, offset + SOURCE_READ_BATCH_SIZE);
    // Reads return values even on failure. Settle every started read before a fatal
    // return, then consume in manifest order so snippets and totals stay deterministic.
    const sources = await Promise.all(
      batch.map(([relativePath, absolutePath]) =>
        readReferenceSource(relativePath, absolutePath, realRootPath, normalizedSymbol)
      )
    );
    const fatalSource = sources.find((source) => source.status === 'error');
    if (fatalSource?.status === 'error') return fatalSource;

    for (let index = 0; index < batch.length; index += 1) {
      const [relativePath] = batch[index];
      const result = sources[index];
      if (result.status === 'error') return result;
      if (result.status === 'unavailable') {
        filesUnavailable += 1;
        continue;
      }
      sourcesRead += 1;
      if (result.status === 'without-text') {
        filesWithoutText += 1;
        continue;
      }
      const { source, realSourcePath } = result;
      const lines = source.split('\n');
      parserCalls += 1;
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

      lexicalFallbackFiles += 1;
      const lexicalOccurrences = findLexicalIdentifierOccurrences(source, normalizedSymbol);
      usageCount += lexicalOccurrences.length;
      for (const occurrence of lexicalOccurrences) {
        if (usages.length >= normalizedLimit) break;
        usages.push({
          file: relativePath,
          line: occurrence.line,
          preview: buildPreviewFromFileLines(lines, occurrence.line)
        });
      }
    }
  }

  const coverageComplete = filesUnavailable === 0;
  return {
    status: 'success',
    symbol: normalizedSymbol,
    usageCount,
    usages,
    confidence: lexicalFallbackFiles === 0 ? 'syntactic' : 'lexical',
    isComplete: coverageComplete && usageCount < normalizedLimit,
    coverage: {
      candidateFiles: candidateFiles.size,
      sourcesRead,
      filesWithoutText,
      filesUnavailable,
      parserCalls,
      lexicalFallbackFiles
    }
  };
}
