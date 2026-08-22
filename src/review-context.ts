import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  DecisionCard,
  PatternResponse,
  SearchQuality,
  SearchResultItem,
  SearchResponse
} from './tools/types.js';

const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;

const IDENTIFIER_STOPWORDS = new Set([
  'abstract',
  'any',
  'array',
  'async',
  'await',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'func',
  'function',
  'implements',
  'import',
  'interface',
  'let',
  'map',
  'namespace',
  'never',
  'new',
  'null',
  'number',
  'object',
  'package',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'self',
  'static',
  'string',
  'struct',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'unknown',
  'using',
  'var',
  'void',
  'while',
  'with',
  'yield'
]);

export interface ChangedFileDescriptor {
  path: string;
  previousPath?: string;
  status: string;
  rawStatus: string;
}

export interface ChangedFileContext extends ChangedFileDescriptor {
  additions: number;
  deletions: number;
  binary: boolean;
  identifiers: string[];
}

export interface ReviewQuery {
  query: string;
  sourceFiles: string[];
  identifiers: string[];
}

export interface ReviewRelatedResult {
  file: string;
  summary: string;
  score: number;
  relevanceReason?: string;
  type?: string;
  trend?: 'Rising' | 'Declining';
  patternWarning?: string;
  symbol?: string;
  scope?: string;
  signaturePreview?: string;
  snippet?: string;
  importedByCount?: number;
  hasTests?: boolean;
}

export interface ReviewSearchResult {
  query: string;
  sourceFiles: string[];
  searchQuality?: SearchQuality;
  preflight?: DecisionCard | SearchResponse['preflight'];
  results: ReviewRelatedResult[];
  error?: string;
}

export interface ReviewContextPacket {
  schemaVersion: 'review-context-v1';
  refs: {
    base: string;
    head: string;
    baseCommit: string;
    headCommit: string;
    range: string;
  };
  diffSha256: string;
  limits: {
    maxQueries: number;
    maxResultsPerQuery: number;
    maxIdentifiersPerFile: number;
  };
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
    queryCount: number;
    relatedResultCount: number;
  };
  changedFiles: ChangedFileContext[];
  searches: ReviewSearchResult[];
  conventions?: PatternResponse;
  warnings: string[];
}

export interface PatchStats {
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface BuildReviewContextOptions {
  base: string;
  head: string;
  baseCommit: string;
  headCommit: string;
  rawDiff: string;
  changedFiles: ChangedFileDescriptor[];
  patchesByPath: ReadonlyMap<string, string>;
  maxQueries?: number;
  maxResultsPerQuery?: number;
  maxIdentifiersPerFile?: number;
  search: (query: string, limit: number) => Promise<SearchResponse>;
  loadConventions?: () => Promise<PatternResponse | undefined>;
}

export function parseNameStatus(output: string): ChangedFileDescriptor[] {
  const files: ChangedFileDescriptor[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split('\t');
    const rawStatus = parts[0] ?? '';
    const status = rawStatus.charAt(0);
    if (!status) continue;

    if ((status === 'R' || status === 'C') && parts.length >= 3) {
      const previousPath = parts[1];
      const currentPath = parts[2];
      if (previousPath && currentPath) {
        files.push({ path: currentPath, previousPath, status, rawStatus });
      }
      continue;
    }

    const filePath = parts[1];
    if (filePath) {
      files.push({ path: filePath, status, rawStatus });
    }
  }

  return files;
}

export function inspectPatch(patch: string): PatchStats {
  let additions = 0;
  let deletions = 0;
  let binary = false;

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      binary = true;
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }

  return { additions, deletions, binary };
}

export function extractChangedIdentifiers(patch: string, limit = 10): string[] {
  const scores = new Map<string, number>();

  for (const line of patch.split(/\r?\n/)) {
    const isAddition = line.startsWith('+') && !line.startsWith('+++');
    const isDeletion = line.startsWith('-') && !line.startsWith('---');
    if (!isAddition && !isDeletion) continue;

    const source = line.slice(1);
    for (const match of source.matchAll(IDENTIFIER_RE)) {
      const identifier = match[0];
      if (identifier.length < 3) continue;
      if (IDENTIFIER_STOPWORDS.has(identifier.toLowerCase())) continue;

      let score = isAddition ? 3 : 2;
      if (/^[A-Z][A-Za-z0-9_$]+$/.test(identifier)) score += 2;
      if (/[a-z][A-Z]/.test(identifier)) score += 1;
      if (identifier.length >= 8) score += 1;

      scores.set(identifier, (scores.get(identifier) ?? 0) + score);
    }
  }

  return Array.from(scores.entries())
    .sort(([nameA, scoreA], [nameB, scoreB]) => scoreB - scoreA || nameA.localeCompare(nameB))
    .slice(0, Math.max(0, limit))
    .map(([identifier]) => identifier);
}

function fallbackIdentifiersForPath(filePath: string): string[] {
  const withoutExtension = filePath.replace(/\.[^.\/]+$/, '');
  const segments = withoutExtension.split(/[\\/._-]+/).filter(Boolean);
  const basename = path.basename(withoutExtension);
  const ordered = [basename, ...segments.reverse()];
  const seen = new Set<string>();

  return ordered.filter((part) => {
    const normalized = part.toLowerCase();
    if (part.length < 3 || IDENTIFIER_STOPWORDS.has(normalized) || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function buildReviewQueries(
  files: ChangedFileContext[],
  maxQueries = 8
): ReviewQuery[] {
  const selected = [...files]
    .sort((a, b) => {
      const identifierDelta = b.identifiers.length - a.identifiers.length;
      if (identifierDelta !== 0) return identifierDelta;
      const changeDelta = b.additions + b.deletions - (a.additions + a.deletions);
      if (changeDelta !== 0) return changeDelta;
      return a.path.localeCompare(b.path);
    })
    .slice(0, Math.max(0, maxQueries));

  const queries: ReviewQuery[] = [];
  const seen = new Set<string>();

  for (const file of selected) {
    const identifiers = (file.identifiers.length > 0
      ? file.identifiers
      : fallbackIdentifiersForPath(file.path)
    ).slice(0, 3);
    if (identifiers.length === 0) continue;

    const query = identifiers.join(' ');
    const key = query.toLowerCase();
    const existing = queries.find((entry) => entry.query.toLowerCase() === key);
    if (existing) {
      if (!existing.sourceFiles.includes(file.path)) existing.sourceFiles.push(file.path);
      continue;
    }
    if (seen.has(key)) continue;

    seen.add(key);
    queries.push({ query, sourceFiles: [file.path], identifiers });
  }

  return queries;
}

export function fingerprintDiff(rawDiff: string): string {
  return createHash('sha256').update(rawDiff, 'utf8').digest('hex');
}

function compactSearchResult(result: SearchResultItem): ReviewRelatedResult {
  return {
    file: result.file,
    summary: result.summary,
    score: result.score,
    ...(result.relevanceReason ? { relevanceReason: result.relevanceReason } : {}),
    ...(result.type ? { type: result.type } : {}),
    ...(result.trend ? { trend: result.trend } : {}),
    ...(result.patternWarning ? { patternWarning: result.patternWarning } : {}),
    ...(result.symbol ? { symbol: result.symbol } : {}),
    ...(result.scope ? { scope: result.scope } : {}),
    ...(result.signaturePreview ? { signaturePreview: result.signaturePreview } : {}),
    ...(result.snippet ? { snippet: result.snippet.slice(0, 1200) } : {}),
    ...(result.relationships?.importedByCount != null
      ? { importedByCount: result.relationships.importedByCount }
      : result.importedByCount != null
        ? { importedByCount: result.importedByCount }
        : {}),
    ...(result.relationships?.hasTests != null ? { hasTests: result.relationships.hasTests } : {})
  };
}

export async function buildReviewContextPacket(
  options: BuildReviewContextOptions
): Promise<ReviewContextPacket> {
  const maxQueries = Math.max(1, Math.floor(options.maxQueries ?? 8));
  const maxResultsPerQuery = Math.max(1, Math.floor(options.maxResultsPerQuery ?? 3));
  const maxIdentifiersPerFile = Math.max(1, Math.floor(options.maxIdentifiersPerFile ?? 10));
  const warnings: string[] = [];

  const changedFiles = options.changedFiles.map((file) => {
    const patch = options.patchesByPath.get(file.path) ?? '';
    if (!patch) warnings.push(`No textual patch captured for ${file.path}`);
    const stats = inspectPatch(patch);
    return {
      ...file,
      ...stats,
      identifiers: stats.binary ? [] : extractChangedIdentifiers(patch, maxIdentifiersPerFile)
    };
  });

  const queries = buildReviewQueries(changedFiles, maxQueries);
  if (queries.length === 0 && changedFiles.length > 0) {
    warnings.push('No review search queries could be derived from the changed diff');
  }
  if (changedFiles.length > maxQueries) {
    warnings.push(
      `Search was bounded to ${maxQueries} changed-file queries for ${changedFiles.length} changed files`
    );
  }

  const searches: ReviewSearchResult[] = [];
  for (const reviewQuery of queries) {
    try {
      const response = await options.search(reviewQuery.query, maxResultsPerQuery);
      searches.push({
        query: reviewQuery.query,
        sourceFiles: reviewQuery.sourceFiles,
        searchQuality: response.searchQuality,
        ...(response.preflight ? { preflight: response.preflight } : {}),
        results: response.results.slice(0, maxResultsPerQuery).map(compactSearchResult)
      });
    } catch (error) {
      searches.push({
        query: reviewQuery.query,
        sourceFiles: reviewQuery.sourceFiles,
        results: [],
        error: error instanceof Error ? error.message : String(error)
      });
      warnings.push(`Search failed for query: ${reviewQuery.query}`);
    }
  }

  let conventions: PatternResponse | undefined;
  if (options.loadConventions) {
    try {
      conventions = await options.loadConventions();
    } catch (error) {
      warnings.push(
        `Convention lookup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const additions = changedFiles.reduce((sum, file) => sum + file.additions, 0);
  const deletions = changedFiles.reduce((sum, file) => sum + file.deletions, 0);
  const relatedResultCount = searches.reduce((sum, search) => sum + search.results.length, 0);

  return {
    schemaVersion: 'review-context-v1',
    refs: {
      base: options.base,
      head: options.head,
      baseCommit: options.baseCommit,
      headCommit: options.headCommit,
      range: `${options.base}...${options.head}`
    },
    diffSha256: fingerprintDiff(options.rawDiff),
    limits: { maxQueries, maxResultsPerQuery, maxIdentifiersPerFile },
    summary: {
      filesChanged: changedFiles.length,
      additions,
      deletions,
      queryCount: searches.length,
      relatedResultCount
    },
    changedFiles,
    searches,
    ...(conventions ? { conventions } : {}),
    warnings
  };
}
