#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AngularAnalyzer } from './analyzers/angular/index.js';
import { GenericAnalyzer } from './analyzers/generic/index.js';
import { NestJsAnalyzer } from './analyzers/nestjs/index.js';
import { NextJsAnalyzer } from './analyzers/nextjs/index.js';
import { ReactAnalyzer } from './analyzers/react/index.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  HEALTH_FILENAME,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  MEMORY_FILENAME,
  VECTOR_DB_DIRNAME
} from './constants/codebase-context.js';
import { analyzerRegistry } from './core/analyzer-registry.js';
import { CodebaseIndexer } from './core/indexer.js';
import { buildReviewContextPacket, parseNameStatus } from './review-context.js';
import { loadProjectConfig } from './server/config.js';
import { dispatchTool } from './tools/index.js';
import type { PatternResponse, SearchResponse, ToolContext, ToolResponse } from './tools/types.js';

analyzerRegistry.register(new AngularAnalyzer());
analyzerRegistry.register(new NextJsAnalyzer());
analyzerRegistry.register(new NestJsAnalyzer());
analyzerRegistry.register(new ReactAnalyzer());
analyzerRegistry.register(new GenericAnalyzer());

interface ReviewCliOptions {
  base: string;
  head: string;
  rootPath: string;
  maxQueries: number;
  maxResults: number;
  maxIdentifiers: number;
  json: boolean;
  noIndex: boolean;
}

const DEFAULT_MAX_QUERIES = 8;
const DEFAULT_MAX_RESULTS = 3;
const DEFAULT_MAX_IDENTIFIERS = 10;
const MAX_GIT_BUFFER = 16 * 1024 * 1024;

function printUsage(): void {
  console.log(`codebase-context-review --base <git-ref> [options]

Build a bounded, deterministic review-context packet from a committed git diff.
It does not call an LLM and it does not post review comments.

Required:
  --base <git-ref>         PR/base ref. Compared with merge-base semantics.

Options:
  --head <git-ref>         Head ref (default: HEAD)
  --root <path>            Repository root (default: CODEBASE_ROOT or cwd)
  --max-queries <n>        Maximum changed-file search queries (default: 8)
  --max-results <n>        Maximum related results per query (default: 3)
  --max-identifiers <n>    Identifier candidates retained per file (default: 10)
  --no-index               Fail instead of creating an index when one is missing
  --json                   Emit the complete JSON packet
  --help                   Show this help

Example:
  codebase-context-review --base origin/main --head HEAD --json
`);
}

function parsePositiveInt(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): ReviewCliOptions | undefined {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return undefined;
  }

  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const valueFlags = new Set([
    '--base',
    '--head',
    '--root',
    '--max-queries',
    '--max-results',
    '--max-identifiers'
  ]);
  const booleanFlags = new Set(['--json', '--no-index']);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (booleanFlags.has(arg)) {
      booleans.add(arg);
      continue;
    }
    if (!valueFlags.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`);
    }
    values.set(arg, value);
    index += 1;
  }

  const base = values.get('--base');
  if (!base) throw new Error('--base is required');

  return {
    base,
    head: values.get('--head') ?? 'HEAD',
    rootPath: path.resolve(values.get('--root') ?? process.env.CODEBASE_ROOT ?? process.cwd()),
    maxQueries: parsePositiveInt(values.get('--max-queries'), '--max-queries', DEFAULT_MAX_QUERIES),
    maxResults: parsePositiveInt(values.get('--max-results'), '--max-results', DEFAULT_MAX_RESULTS),
    maxIdentifiers: parsePositiveInt(
      values.get('--max-identifiers'),
      '--max-identifiers',
      DEFAULT_MAX_IDENTIFIERS
    ),
    json: booleans.has('--json'),
    noIndex: booleans.has('--no-index')
  };
}

function runGit(rootPath: string, args: string[], maxBuffer = MAX_GIT_BUFFER): string {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: rootPath,
      encoding: 'utf8',
      input: '',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer
    }).trimEnd();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(' ')} failed: ${message}`);
  }
}

function resolveCommit(rootPath: string, ref: string): string {
  const commit = runGit(rootPath, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(`Could not resolve ${ref} to a commit`);
  }
  return commit;
}

async function createToolContext(rootPath: string, noIndex: boolean): Promise<ToolContext> {
  const projectConfig = await loadProjectConfig(rootPath);
  const paths = {
    baseDir: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME),
    memory: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, MEMORY_FILENAME),
    intelligence: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, INTELLIGENCE_FILENAME),
    health: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, HEALTH_FILENAME),
    keywordIndex: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME),
    vectorDb: path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, VECTOR_DB_DIRNAME)
  };

  let indexExists = false;
  try {
    await fs.access(paths.keywordIndex);
    indexExists = true;
  } catch {
    indexExists = false;
  }

  const indexState: ToolContext['indexState'] = {
    status: indexExists ? 'ready' : 'idle'
  };

  const performIndexing = async (incrementalOnly?: boolean, reason?: string): Promise<void> => {
    indexState.status = 'indexing';
    console.error(`Indexing review target (${incrementalOnly ? 'incremental' : 'full'})${reason ? ` — ${reason}` : ''}`);

    try {
      const indexer = new CodebaseIndexer({
        rootPath,
        ...(projectConfig?.parsing ? { config: { parsing: projectConfig.parsing } } : {}),
        incrementalOnly
      });
      indexState.indexer = indexer;
      const stats = await indexer.index();
      indexState.status = 'ready';
      indexState.lastIndexed = new Date();
      indexState.stats = stats;
    } catch (error) {
      indexState.status = 'error';
      indexState.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  };

  const context: ToolContext = { indexState, paths, rootPath, performIndexing };

  if (!indexExists) {
    if (noIndex) {
      throw new Error(
        'No codebase-context index exists. Run `codebase-context reindex` or omit --no-index.'
      );
    }
    await performIndexing(false, 'review-context');
  }

  return context;
}

function parseToolJson<T>(response: ToolResponse, operation: string): T {
  const text = response.content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error(`${operation} returned no JSON payload`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }

  if (response.isError) {
    const message =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `${operation} failed`;
    throw new Error(message);
  }
  return parsed as T;
}

function printHuman(packet: Awaited<ReturnType<typeof buildReviewContextPacket>>): void {
  console.log(`Review context: ${packet.refs.base}...${packet.refs.head}`);
  console.log(`Commits: ${packet.refs.baseCommit.slice(0, 12)} -> ${packet.refs.headCommit.slice(0, 12)}`);
  console.log(`Diff: sha256:${packet.diffSha256}`);
  console.log(
    `Changed: ${packet.summary.filesChanged} files, +${packet.summary.additions}/-${packet.summary.deletions}`
  );
  console.log(`Searches: ${packet.summary.queryCount}, related results: ${packet.summary.relatedResultCount}`);
  console.log('');

  for (const file of packet.changedFiles) {
    const rename = file.previousPath ? ` (from ${file.previousPath})` : '';
    const identifiers = file.identifiers.slice(0, 5).join(', ');
    console.log(
      `${file.rawStatus.padEnd(4)} ${file.path}${rename}  +${file.additions}/-${file.deletions}${file.binary ? ' [binary]' : ''}`
    );
    if (identifiers) console.log(`     signals: ${identifiers}`);
  }

  if (packet.searches.length > 0) {
    console.log('\nRelated context');
    for (const search of packet.searches) {
      console.log(`- ${search.query}  <- ${search.sourceFiles.join(', ')}`);
      if (search.error) {
        console.log(`  error: ${search.error}`);
        continue;
      }
      for (const result of search.results) {
        console.log(`  ${result.file}  score=${result.score.toFixed(3)}  ${result.summary}`);
      }
    }
  }

  if (packet.warnings.length > 0) {
    console.log('\nWarnings');
    for (const warning of packet.warnings) console.log(`- ${warning}`);
  }

  console.log('\nUse --json for the machine-readable packet including conventions and snippets.');
}

export async function runReviewCli(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (!options) return 0;

  const gitRoot = runGit(options.rootPath, ['rev-parse', '--show-toplevel']).trim();
  const rootPath = path.resolve(gitRoot);
  const baseCommit = resolveCommit(rootPath, options.base);
  const headCommit = resolveCommit(rootPath, options.head);
  const range = `${options.base}...${options.head}`;

  const nameStatus = runGit(rootPath, ['diff', '--name-status', '--find-renames', range, '--']);
  const changedFiles = parseNameStatus(nameStatus);
  const rawDiff = runGit(rootPath, [
    'diff',
    '--no-ext-diff',
    '--binary',
    '--no-color',
    '--find-renames',
    range,
    '--'
  ]);

  const patchesByPath = new Map<string, string>();
  for (const file of changedFiles) {
    const patch = runGit(rootPath, [
      'diff',
      '--no-ext-diff',
      '--unified=0',
      '--no-color',
      '--find-renames',
      range,
      '--',
      file.path
    ]);
    patchesByPath.set(file.path, patch);
  }

  const toolContext = await createToolContext(rootPath, options.noIndex);
  const packet = await buildReviewContextPacket({
    base: options.base,
    head: options.head,
    baseCommit,
    headCommit,
    rawDiff,
    changedFiles,
    patchesByPath,
    maxQueries: options.maxQueries,
    maxResultsPerQuery: options.maxResults,
    maxIdentifiersPerFile: options.maxIdentifiers,
    search: async (query, limit) =>
      parseToolJson<SearchResponse>(
        await dispatchTool(
          'search_codebase',
          { query, includeSnippets: true, intent: 'edit', limit },
          toolContext
        ),
        `search_codebase(${query})`
      ),
    loadConventions: async () =>
      parseToolJson<PatternResponse>(
        await dispatchTool('get_team_patterns', { category: 'all' }, toolContext),
        'get_team_patterns'
      )
  });

  if (options.json) console.log(JSON.stringify(packet, null, 2));
  else printHuman(packet);

  return 0;
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return entry.replace(/\\/g, '/').endsWith('/review-cli.js');
  }
})();

if (isDirectRun) {
  runReviewCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
