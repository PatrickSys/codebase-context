#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

const DEFAULT_PAYLOADS =
  'benchmark-runs/contextbench/phase40/task-payloads/contextbench-phase40-task-payloads.json';
const DEFAULT_TASK_ID = 'Multi-SWE-Bench__c__maintenance__bugfix__5e659108';
const DEFAULT_GOLD =
  'benchmark-runs/contextbench/phase40/scoring-inputs/Multi-SWE-Bench__c__maintenance__bugfix__5e659108-gold.json';
const DEFAULT_LANES = ['raw-native', 'codebase-context'];
const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.h',
  '.hpp',
  '.hh',
  '.go',
  '.java',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.rs',
  '.php',
  '.swift',
  '.kt',
  '.scala',
  '.cs',
  '.m',
  '.mm',
  '.pony',
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.sql',
  '.sh',
  '.bat',
  '.ps1'
]);
const EXCLUDED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.codebase-context',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'target',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.gradle',
  '.idea',
  '.vscode'
]);

function help() {
  console.log(`ContextBench retrieval-only diagnostic gate

Usage:
  node scripts/contextbench-retrieval-gate.mjs --out benchmark-runs/contextbench/phase40/<session_id>
  node scripts/contextbench-retrieval-gate.mjs --out <dir> --task-id <id> --lanes raw-native,codebase-context,jcodemunch-repomapper,codegraphcontext --score

Options:
  --out <dir>             Required output session under benchmark-runs/contextbench/phase40/.
  --task-payloads <file>  Materialized task payloads JSON. Defaults to Phase 40 payloads.
  --task-id <id>          Frozen ContextBench instance id. Defaults to the first Phase 40 task.
  --gold <file>           Scorer-only gold JSON. Used only after trajectory artifacts are written.
  --lanes <csv>           Lanes to run. Supported: raw-native, codebase-context, jcodemunch-repomapper, codegraphcontext.
  --limit <n>             Max retrieved files per lane. Default: 6.
  --window <n>            Line window around lexical hits or parsed result spans. Default: 40.
  --repeat <n>            Repeat index for manifest/run id. Default: 1.
  --index-timeout-ms <n>  Per-lane indexing timeout. Default: 300000.
  --query-timeout-ms <n>  Per-lane query timeout. Default: 180000.
  --evaluator-cwd <dir>   Optional checkout containing contextbench/evaluate.py.
  --score                 Run official ContextBench evaluator after writing each trajectory.

This is retrieval-only evidence. It does not run an agent, write a patch, execute tests, or prove task success.
`);
}

function parseArgs(argv) {
  const args = {
    taskPayloads: DEFAULT_PAYLOADS,
    taskId: DEFAULT_TASK_ID,
    gold: DEFAULT_GOLD,
    lanes: DEFAULT_LANES,
    limit: 6,
    window: 40,
    repeat: 1,
    indexTimeoutMs: 300_000,
    queryTimeoutMs: 180_000,
    score: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--out') args.out = argv[++i] ?? '';
    else if (arg === '--task-payloads') args.taskPayloads = argv[++i] ?? '';
    else if (arg === '--task-id') args.taskId = argv[++i] ?? '';
    else if (arg === '--gold') args.gold = argv[++i] ?? '';
    else if (arg === '--lanes')
      args.lanes = String(argv[++i] ?? '')
        .split(',')
        .filter(Boolean);
    else if (arg === '--limit') args.limit = Number(argv[++i] ?? '6');
    else if (arg === '--window') args.window = Number(argv[++i] ?? '40');
    else if (arg === '--repeat') args.repeat = Number(argv[++i] ?? '1');
    else if (arg === '--index-timeout-ms') args.indexTimeoutMs = Number(argv[++i] ?? '300000');
    else if (arg === '--query-timeout-ms') args.queryTimeoutMs = Number(argv[++i] ?? '180000');
    else if (arg === '--evaluator-cwd') args.evaluatorCwd = argv[++i] ?? '';
    else if (arg === '--score') args.score = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function sha256Text(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function sha256File(filePath) {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function normalizeRepoPath(repoRoot, filePath) {
  const normalized = normalizePath(filePath);
  const root = normalizePath(repoRoot).replace(/\/$/, '');
  if (normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return normalized.slice(root.length + 1);
  }
  return normalized;
}

function ensurePhase40Out(outDir) {
  if (!outDir) throw new Error('--out is required');
  const resolved = resolve(outDir);
  const normalized = normalizePath(resolved);
  if (!normalized.includes('/benchmark-runs/contextbench/phase40/')) {
    throw new Error(
      'retrieval gate output must be under benchmark-runs/contextbench/phase40/<session_id>'
    );
  }
  if (normalized.includes('/outputs/'))
    throw new Error('retrieval gate output must not be under outputs/');
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

function sanitize(value) {
  return value
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function loadTask(payloadPath, taskId) {
  const payload = readJson(resolve(payloadPath));
  const tasks = Array.isArray(payload.tasks)
    ? payload.tasks
    : Object.entries(payload.tasksById ?? {}).map(([instanceId, value]) => ({
        instance_id: instanceId,
        ...value
      }));
  const task = tasks.find((candidate) => candidate.instance_id === taskId);
  if (!task) throw new Error(`task id not found in payloads: ${taskId}`);
  if (!task.problem_statement || !task.repo_checkout_path) {
    throw new Error(
      `task ${taskId} is not materialized with problem_statement and repo_checkout_path`
    );
  }
  const checkout = isAbsolute(task.repo_checkout_path)
    ? task.repo_checkout_path
    : resolve(dirname(resolve(payloadPath)), task.repo_checkout_path);
  if (!existsSync(checkout)) throw new Error(`task checkout does not exist: ${checkout}`);
  return { ...task, repo_checkout_path: checkout };
}

function tokenize(query) {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'from',
    'with',
    'this',
    'that',
    'when',
    'into',
    'are',
    'not',
    'but',
    'should',
    'would',
    'could',
    'have',
    'has',
    'had',
    'body',
    'bodies',
    'method',
    'methods'
  ]);
  return [
    ...new Set(
      String(query)
        .toLowerCase()
        .match(/[a-z_][a-z0-9_]{2,}|#[0-9]+/g)
        ?.filter((token) => !stopWords.has(token)) ?? []
    )
  ];
}

function isTextLike(filePath, stats) {
  if (stats.size > 1_000_000) return false;
  const ext = extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return ext === '' && stats.size < 200_000;
}

function collectFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) stack.push(join(dir, entry.name));
      } else if (entry.isFile()) {
        const filePath = join(dir, entry.name);
        const stats = statSync(filePath);
        if (isTextLike(filePath, stats)) files.push(filePath);
      }
    }
  }
  return files;
}

function countOccurrences(text, token) {
  let count = 0;
  let start = 0;
  while (start < text.length) {
    const index = text.indexOf(token, start);
    if (index === -1) break;
    count += 1;
    start = index + token.length;
  }
  return count;
}

function spanAround(lineNumber, totalLines, window) {
  const radius = Math.max(1, Math.floor(window / 2));
  return {
    start: Math.max(1, lineNumber - radius),
    end: Math.min(totalLines, lineNumber + radius),
    full_file: false
  };
}

function mergeSpans(spans) {
  return spans
    .sort(
      (a, b) =>
        a.start - b.start || (a.end ?? Number.MAX_SAFE_INTEGER) - (b.end ?? Number.MAX_SAFE_INTEGER)
    )
    .reduce((merged, span) => {
      const previous = merged[merged.length - 1];
      if (
        !previous ||
        previous.full_file ||
        span.full_file ||
        previous.end === null ||
        span.end === null
      ) {
        merged.push(span);
      } else if (span.start <= previous.end + 1) {
        previous.end = Math.max(previous.end, span.end);
      } else {
        merged.push(span);
      }
      return merged;
    }, []);
}

function buildTrajectory(task, retrieval) {
  const predSpans = {};
  for (const item of retrieval.items) {
    const file = normalizeRepoPath(task.repo_checkout_path, item.file);
    predSpans[file] = mergeSpans([...(predSpans[file] ?? []), ...item.spans]);
  }
  const predFiles = Object.keys(predSpans).sort();
  return {
    instance_id: task.instance_id,
    repo_url: task.repo_url,
    commit: task.base_commit,
    traj_data: {
      pred_steps: [{ files: predFiles, spans: predSpans }],
      pred_files: predFiles,
      pred_spans: predSpans
    },
    model_patch: ''
  };
}

function buildStructuredAnswer(task, retrieval) {
  return {
    answer: {
      diagnosticRetrievalOnly: true,
      laneId: retrieval.laneId,
      method: retrieval.method,
      itemCount: retrieval.items.length
    },
    confidence: retrieval.items.length > 0 ? 'medium' : 'low',
    evidence: retrieval.items.flatMap((item) =>
      item.spans.map((span) => ({
        file: normalizeRepoPath(task.repo_checkout_path, item.file),
        lineRange: { start: span.start, end: span.end ?? span.start },
        reason: item.reason
      }))
    ),
    filesReferenced: retrieval.items.map((item) =>
      normalizeRepoPath(task.repo_checkout_path, item.file)
    ),
    symbolsReferenced: [],
    unsupportedClaims: ['retrieval_only_diagnostic_not_task_success'],
    readyToEdit: false
  };
}

function runRawNative(task, options) {
  const tokens = tokenize(task.problem_statement);
  const files = collectFiles(task.repo_checkout_path);
  const scored = [];
  const startedAt = Date.now();
  for (const filePath of files) {
    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const relativePath = normalizePath(relative(task.repo_checkout_path, filePath));
    const lowerPath = relativePath.toLowerCase();
    const lines = content.split(/\r?\n/);
    let score = 0;
    for (const token of tokens) {
      score += countOccurrences(lowerPath, token) * 8;
    }
    let bestLine = 1;
    let bestLineScore = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const lowerLine = lines[index].toLowerCase();
      let lineScore = 0;
      for (const token of tokens) lineScore += countOccurrences(lowerLine, token);
      if (lineScore > bestLineScore) {
        bestLineScore = lineScore;
        bestLine = index + 1;
      }
      score += lineScore;
    }
    if (score > 0) {
      scored.push({
        file: relativePath,
        score,
        bestLine,
        totalLines: lines.length,
        reason: `lexical token match: ${tokens.join(', ')}`
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const items = scored.slice(0, options.limit).map((item) => ({
    file: item.file,
    score: item.score,
    spans: [spanAround(item.bestLine, item.totalLines, options.window)],
    reason: item.reason
  }));
  return {
    laneId: 'raw-native',
    method: 'deterministic lexical repository scan over problem statement tokens',
    status: items.length > 0 ? 'completed' : 'no_answer',
    setup: {
      setupCommand: 'none',
      indexCommand: 'none',
      setupStatus: 'not_required',
      indexStatus: 'not_required',
      setupDurationMs: 0,
      indexDurationMs: 0
    },
    trace: {
      tokens,
      filesScanned: files.length,
      scoredFiles: scored.length,
      durationMs: Date.now() - startedAt,
      topScores: scored.slice(0, options.limit).map(({ file, score, bestLine }) => ({
        file,
        score,
        bestLine
      }))
    },
    items
  };
}

function runCommand(command, args, options) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    input: '',
    timeout: options.timeoutMs ?? 120_000
  });
  return {
    command,
    args,
    cwd: options.cwd,
    status: typeof result.status === 'number' ? result.status : null,
    signal: result.signal ?? null,
    error: result.error?.message ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs: Date.now() - startedAt
  };
}

function runJCodeMunchMcpCalls(calls, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const command = 'python';
    const args = [
      '-m',
      'jcodemunch_mcp.server',
      'serve',
      '--transport',
      'stdio',
      '--log-level',
      'ERROR'
    ];
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, JCODEMUNCH_USE_AI_SUMMARIES: 'false' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const messages = new Map();
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    let settled = false;
    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill();
      resolve({
        command,
        args,
        cwd: process.cwd(),
        status,
        error,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        messages: calls.map((call, index) => messages.get(index + 2) ?? null)
      });
    };
    const send = (message) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const maybeComplete = () => {
      if (calls.every((_, index) => messages.has(index + 2))) finish(0);
    };
    const handleMessage = (message) => {
      if (message.id === 1) {
        send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
        calls.forEach((call, index) => {
          send({
            jsonrpc: '2.0',
            id: index + 2,
            method: 'tools/call',
            params: { name: call.name, arguments: call.arguments }
          });
        });
        return;
      }
      if (typeof message.id === 'number' && message.id >= 2) {
        messages.set(message.id, message);
        maybeComplete();
      }
    };
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleMessage(JSON.parse(line));
        } catch (error) {
          stderr += `\nfailed to parse MCP stdout line: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (status) => {
      if (!settled) finish(status);
    });
    const timer = setTimeout(
      () => finish(null, `jCodeMunch MCP timed out after ${timeoutMs}ms`),
      timeoutMs
    );
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'contextbench-retrieval-gate', version: '0.0.0' }
      }
    });
  });
}

function codebaseContextBaseCommand() {
  const distIndex = resolve('dist/index.js');
  if (existsSync(distIndex))
    return { command: process.execPath, prefixArgs: [distIndex], source: 'local-dist' };
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return {
    command: npmCommand,
    prefixArgs: ['exec', '--', 'codebase-context'],
    source: 'npm-exec'
  };
}

function parseJsonOutput(commandResult) {
  const trimmed = commandResult.stdout.trim();
  if (!trimmed) return { value: null, error: 'empty_stdout' };
  try {
    return { value: JSON.parse(trimmed), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseSearchFile(value) {
  const normalized = normalizePath(String(value ?? ''));
  const rangeMatch = normalized.match(/^(.*):(\d+)-(\d+)$/);
  if (rangeMatch) {
    return {
      file: rangeMatch[1],
      span: { start: Number(rangeMatch[2]), end: Number(rangeMatch[3]), full_file: false }
    };
  }
  const lineMatch = normalized.match(/^(.*):(\d+)$/);
  if (lineMatch) {
    const line = Number(lineMatch[2]);
    return { file: lineMatch[1], span: { start: line, end: line, full_file: false } };
  }
  return { file: normalized, span: { start: 1, end: null, full_file: true } };
}

function expandSpan(span, window) {
  if (span.full_file || span.end === null) return span;
  const radius = Math.max(0, Math.floor(window / 2));
  return {
    start: Math.max(1, span.start - radius),
    end: Math.max(span.end, span.end + radius),
    full_file: false
  };
}

function capSpanToFile(repoRoot, file, span) {
  if (span.full_file || span.end === null) return span;
  try {
    const lineCount = readFileSync(join(repoRoot, file), 'utf8').split(/\r?\n/).length;
    return { ...span, end: Math.min(lineCount, span.end) };
  } catch {
    return span;
  }
}

function runCodebaseContext(task, options) {
  const base = codebaseContextBaseCommand();
  const env = {
    ...process.env,
    CODEBASE_ROOT: task.repo_checkout_path,
    CODEBASE_CONTEXT_ASCII: '1'
  };
  const reindex = runCommand(base.command, [...base.prefixArgs, 'reindex', '--json'], {
    cwd: process.cwd(),
    env,
    timeoutMs: options.indexTimeoutMs
  });
  if (reindex.status !== 0) {
    return {
      laneId: 'codebase-context',
      method: 'codebase-context CLI reindex/search JSON output',
      status: 'index_failed',
      setup: {
        setupCommand: base.source,
        indexCommand: `${base.command} ${[...base.prefixArgs, 'reindex', '--json'].join(' ')}`,
        setupStatus: 'completed',
        indexStatus: 'index_failed',
        setupDurationMs: 0,
        indexDurationMs: reindex.durationMs
      },
      trace: { commandSource: base.source, reindex, search: null, parseError: null },
      items: []
    };
  }
  const searchArgs = [
    ...base.prefixArgs,
    'search',
    '--query',
    task.problem_statement,
    '--intent',
    'explore',
    '--limit',
    String(options.limit),
    '--json'
  ];
  const search = runCommand(base.command, searchArgs, {
    cwd: process.cwd(),
    env,
    timeoutMs: options.queryTimeoutMs
  });
  const parsed = parseJsonOutput(search);
  if (search.status !== 0 || parsed.error) {
    return {
      laneId: 'codebase-context',
      method: 'codebase-context CLI reindex/search JSON output',
      status: search.status === 0 ? 'invalid_schema' : 'tool_error',
      setup: {
        setupCommand: base.source,
        indexCommand: `${base.command} ${[...base.prefixArgs, 'reindex', '--json'].join(' ')}`,
        setupStatus: 'completed',
        indexStatus: 'completed',
        setupDurationMs: 0,
        indexDurationMs: reindex.durationMs
      },
      trace: { commandSource: base.source, reindex, search, parseError: parsed.error },
      items: []
    };
  }
  const rawResults = Array.isArray(parsed.value?.results) ? parsed.value.results : [];
  const itemsByFile = new Map();
  for (const result of rawResults.slice(0, options.limit)) {
    const parsedFile = parseSearchFile(result.file);
    if (!parsedFile.file) continue;
    const existing = itemsByFile.get(parsedFile.file) ?? {
      file: parsedFile.file,
      score: Number(result.score ?? 0),
      spans: [],
      reason: result.relevanceReason || result.summary || 'codebase-context search result'
    };
    existing.score = Math.max(existing.score, Number(result.score ?? 0));
    existing.spans.push(
      capSpanToFile(
        task.repo_checkout_path,
        parsedFile.file,
        expandSpan(parsedFile.span, options.window)
      )
    );
    itemsByFile.set(parsedFile.file, existing);
  }
  const items = [...itemsByFile.values()].sort(
    (a, b) => b.score - a.score || a.file.localeCompare(b.file)
  );
  return {
    laneId: 'codebase-context',
    method: 'codebase-context CLI reindex/search JSON output',
    status: items.length > 0 ? 'completed' : 'no_answer',
    setup: {
      setupCommand: base.source,
      indexCommand: `${base.command} ${[...base.prefixArgs, 'reindex', '--json'].join(' ')}`,
      setupStatus: 'completed',
      indexStatus: 'completed',
      setupDurationMs: 0,
      indexDurationMs: reindex.durationMs
    },
    trace: {
      commandSource: base.source,
      reindex,
      search,
      parseError: null,
      searchQuality: parsed.value?.searchQuality ?? null,
      totalResults: parsed.value?.totalResults ?? rawResults.length,
      rawResultFiles: rawResults.map((result) => result.file)
    },
    items
  };
}

function parseJCodeMunchToolJson(message) {
  const text = message?.result?.content?.find?.((part) => part?.type === 'text')?.text;
  if (!text) return { value: null, error: 'missing_text_content' };
  try {
    return { value: JSON.parse(text), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runJCodeMunch(task, options) {
  const indexCall = {
    name: 'index_folder',
    arguments: {
      path: task.repo_checkout_path,
      use_ai_summaries: false,
      incremental: true,
      follow_symlinks: false,
      extra_ignore_patterns: ['.codebase-context/**']
    }
  };
  const index = await runJCodeMunchMcpCalls([indexCall], options.indexTimeoutMs);
  const indexMessage = index.messages[0];
  const indexParsed = parseJCodeMunchToolJson(indexMessage);
  const repo = indexParsed.value?.repo;
  if (index.status !== 0 || index.error || !repo) {
    return {
      laneId: 'jcodemunch-repomapper',
      method: 'jCodeMunch MCP index_folder plus search_symbols over deterministic problem tokens',
      status: 'index_failed',
      setup: {
        setupCommand: 'python -m jcodemunch_mcp.server --version',
        indexCommand: 'MCP index_folder',
        setupStatus: 'completed',
        indexStatus: 'index_failed',
        setupDurationMs: 0,
        indexDurationMs: index.durationMs
      },
      trace: { index, indexParseError: indexParsed.error, repo: repo ?? null, searches: [] },
      items: []
    };
  }

  const searchCalls = codeGraphContextQueries(task.problem_statement).map((query) => ({
    name: 'search_symbols',
    arguments: {
      repo,
      query,
      max_results: options.limit,
      detail_level: 'compact',
      semantic: false
    }
  }));
  const search = await runJCodeMunchMcpCalls(searchCalls, options.queryTimeoutMs);
  const itemsByFile = new Map();
  const searches = search.messages.map((message, index) => {
    const parsed = parseJCodeMunchToolJson(message);
    const query = searchCalls[index]?.arguments?.query ?? '';
    const results = Array.isArray(parsed.value?.results) ? parsed.value.results : [];
    for (const [resultIndex, result] of results.entries()) {
      const file = normalizeRepoPath(task.repo_checkout_path, String(result.file ?? ''));
      const line = Number(result.line ?? 1);
      if (!file || file.startsWith('..') || !Number.isFinite(line)) continue;
      const existing = itemsByFile.get(file) ?? {
        file,
        score: 0,
        spans: [],
        reason: `jCodeMunch search_symbols match for problem-derived query "${query}"`
      };
      existing.score += 1 / (index + 1 + resultIndex / 100);
      existing.spans.push(spanAround(line, Number.MAX_SAFE_INTEGER, options.window));
      itemsByFile.set(file, existing);
    }
    return { query, message, parsed, resultCount: results.length };
  });
  const items = [...itemsByFile.values()]
    .map((item) => ({
      ...item,
      spans: item.spans.map((span) => capSpanToFile(task.repo_checkout_path, item.file, span))
    }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, options.limit);
  return {
    laneId: 'jcodemunch-repomapper',
    method: 'jCodeMunch MCP index_folder plus search_symbols over deterministic problem tokens',
    status: items.length > 0 ? 'completed' : 'no_answer',
    setup: {
      setupCommand: 'python -m jcodemunch_mcp.server --version',
      indexCommand: 'MCP index_folder',
      setupStatus: 'completed',
      indexStatus: 'completed',
      setupDurationMs: 0,
      indexDurationMs: index.durationMs
    },
    trace: {
      repo,
      index,
      indexSummary: indexParsed.value,
      search,
      queryCount: searches.length,
      searches,
      rawResultFiles: items.map((item) => item.file)
    },
    items
  };
}

function parseCodeGraphContextTable(stdout) {
  const rows = [];
  let current = null;
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line.includes('│')) continue;
    const parts = line.split('│').slice(1, -1);
    if (parts.length < 3) continue;
    const name = parts[0].trim();
    const type = parts[1].trim();
    const locationPart = parts[2].trim();
    if (name === 'Name' || type === 'Type' || locationPart === 'Location') continue;
    if (name) {
      if (current) rows.push(current);
      current = { name, type, locationParts: locationPart ? [locationPart] : [] };
    } else if (current && locationPart) {
      current.locationParts.push(locationPart);
    }
  }
  if (current) rows.push(current);
  return rows
    .map((row) => {
      const location = row.locationParts.join('');
      const match = location.match(/^(.*):(\d+)$/);
      if (!match) return null;
      return {
        name: row.name,
        type: row.type,
        file: normalizePath(match[1]),
        line: Number(match[2])
      };
    })
    .filter(Boolean);
}

function codeGraphContextQueries(problemStatement) {
  const tokens = tokenize(problemStatement).filter((token) => !token.startsWith('#'));
  const rankedTokens = [...tokens].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return [problemStatement.replace(/\s+/g, ' ').trim(), ...rankedTokens].filter(Boolean);
}

function runCodeGraphContext(task, options) {
  const env = {
    ...process.env,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8'
  };
  const index = runCommand('python', ['-m', 'codegraphcontext', 'index', task.repo_checkout_path], {
    cwd: process.cwd(),
    env,
    timeoutMs: options.indexTimeoutMs
  });
  if (index.status !== 0) {
    return {
      laneId: 'codegraphcontext',
      method: 'CodeGraphContext CLI index plus find content over deterministic problem tokens',
      status: 'index_failed',
      setup: {
        setupCommand: 'python -m codegraphcontext --version',
        indexCommand: `python -m codegraphcontext index ${task.repo_checkout_path}`,
        setupStatus: 'completed',
        indexStatus: 'index_failed',
        setupDurationMs: 0,
        indexDurationMs: index.durationMs
      },
      trace: { index, queries: [], parseError: null },
      items: []
    };
  }

  const queries = [];
  const itemsByFile = new Map();
  for (const query of codeGraphContextQueries(task.problem_statement)) {
    if (itemsByFile.size >= options.limit) break;
    const queryResult = runCommand('python', ['-m', 'codegraphcontext', 'find', 'content', query], {
      cwd: process.cwd(),
      env,
      timeoutMs: options.queryTimeoutMs
    });
    const parsedRows =
      queryResult.status === 0
        ? parseCodeGraphContextTable(`${queryResult.stdout}\n${queryResult.stderr}`)
        : [];
    queries.push({ query, result: queryResult, parsedRows });
    for (const [indexInResult, row] of parsedRows.entries()) {
      const file = normalizeRepoPath(task.repo_checkout_path, row.file);
      if (!file || file.startsWith('..')) continue;
      const existing = itemsByFile.get(file) ?? {
        file,
        score: 0,
        spans: [],
        reason: `CodeGraphContext content match for problem-derived query "${query}"`
      };
      existing.score += 1 / (queries.length + indexInResult / 100);
      existing.spans.push(spanAround(row.line, Number.MAX_SAFE_INTEGER, options.window));
      itemsByFile.set(file, existing);
      if (itemsByFile.size >= options.limit) break;
    }
  }

  const items = [...itemsByFile.values()]
    .map((item) => ({
      ...item,
      spans: item.spans.map((span) => capSpanToFile(task.repo_checkout_path, item.file, span))
    }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, options.limit);
  return {
    laneId: 'codegraphcontext',
    method: 'CodeGraphContext CLI index plus find content over deterministic problem tokens',
    status: items.length > 0 ? 'completed' : 'no_answer',
    setup: {
      setupCommand: 'python -m codegraphcontext --version',
      indexCommand: `python -m codegraphcontext index ${task.repo_checkout_path}`,
      setupStatus: 'completed',
      indexStatus: 'completed',
      setupDurationMs: 0,
      indexDurationMs: index.durationMs
    },
    trace: {
      index,
      queryCount: queries.length,
      queries,
      rawResultFiles: items.map((item) => item.file)
    },
    items
  };
}

async function runLane(lane, task, options) {
  if (lane === 'raw-native') return runRawNative(task, options);
  if (lane === 'codebase-context') return runCodebaseContext(task, options);
  if (lane === 'jcodemunch-repomapper') return runJCodeMunch(task, options);
  if (lane === 'codegraphcontext') return runCodeGraphContext(task, options);
  throw new Error(`unsupported retrieval lane: ${lane}`);
}

function hasOfficialEvaluator(cwd) {
  return existsSync(join(cwd, 'contextbench', 'evaluate.py'));
}

function resolveEvaluatorCwd(args) {
  if (args.evaluatorCwd) {
    const resolved = resolve(args.evaluatorCwd);
    if (!hasOfficialEvaluator(resolved)) {
      throw new Error(`--evaluator-cwd does not contain contextbench/evaluate.py: ${resolved}`);
    }
    return resolved;
  }
  const moduleCheck = runCommand('python', ['-m', 'contextbench.evaluate', '--help'], {
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 30_000
  });
  if (moduleCheck.status === 0) return process.cwd();
  const candidates = [
    'benchmark-runs/contextbench/phase40/evaluator-probe-20260427/ContextBench-official'
  ];
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (hasOfficialEvaluator(resolved)) return resolved;
  }
  throw new Error(
    'official evaluator unavailable; pass --evaluator-cwd <ContextBench checkout> or run the evaluator probe first'
  );
}

function scoreTrajectory(goldPath, trajectoryPath, outputPath, evaluatorCwd, cachePath) {
  const args = [
    '-m',
    'contextbench.evaluate',
    '--gold',
    goldPath,
    '--pred',
    trajectoryPath,
    '--cache',
    cachePath,
    '--out',
    outputPath
  ];
  const result = runCommand('python', args, {
    cwd: evaluatorCwd,
    env: process.env,
    timeoutMs: 120_000
  });
  let metrics = null;
  if (result.status === 0 && existsSync(outputPath)) {
    const firstLine = readFileSync(outputPath, 'utf8').trim().split('\n')[0];
    if (firstLine) {
      try {
        metrics = JSON.parse(firstLine);
      } catch {
        metrics = null;
      }
    }
  }
  return {
    status: result.status === 0 ? 'completed' : 'judge_failed',
    mode: result.status === 0 ? 'official_evaluator' : 'official_evaluator_failed',
    claimBearing: false,
    retrievalOnly: true,
    command: `python ${args.join(' ')}`,
    evaluatorCwd,
    exitStatus: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    outputPath,
    metrics
  };
}

function buildRunPaths(sessionRoot, runId) {
  const runDir = join(sessionRoot, 'runs', runId);
  return {
    runDir,
    prompt: join(runDir, 'retrieval-query.txt'),
    setupIndex: join(runDir, 'setup-index.json'),
    rawTrace: join(runDir, 'raw-trace.json'),
    structuredAnswer: join(runDir, 'structured-answer.json'),
    trajectory: join(runDir, 'trajectory.json'),
    score: join(runDir, 'score.json'),
    officialResults: join(runDir, 'official-results.jsonl')
  };
}

function appendManifest(sessionRoot, row) {
  appendFileSync(join(sessionRoot, 'run-manifest.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
}

function artifactHashIfPresent(filePath) {
  return existsSync(filePath) ? sha256File(filePath) : null;
}

function writeSessionScratchpad(sessionRoot, task, args) {
  const scratchpadPath = join(sessionRoot, 'RETRIEVAL-GATE-SCRATCHPAD.json');
  const value = {
    createdAt: new Date().toISOString(),
    claimBearing: false,
    evidenceType: 'retrieval_only_diagnostic',
    claimLimits: [
      'No agent patch was produced.',
      'No tests were run in the target repository.',
      'Official evaluator scores measure retrieved context overlap only.',
      'Scorer-only gold is used after trajectories are materialized, never during retrieval.'
    ],
    task: {
      instance_id: task.instance_id,
      repo_url: task.repo_url,
      base_commit: task.base_commit,
      repo_checkout_path: task.repo_checkout_path,
      problem_statement_hash: task.problem_statement_hash
    },
    args: {
      lanes: args.lanes,
      limit: args.limit,
      window: args.window,
      repeat: args.repeat,
      score: args.score,
      gold: args.score ? resolve(args.gold) : null
    }
  };
  writeJson(scratchpadPath, value);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }
  if (!Number.isInteger(args.limit) || args.limit < 1)
    throw new Error('--limit must be a positive integer');
  if (!Number.isInteger(args.window) || args.window < 1)
    throw new Error('--window must be a positive integer');
  if (!Number.isInteger(args.repeat) || args.repeat < 1)
    throw new Error('--repeat must be a positive integer');
  if (!Number.isInteger(args.indexTimeoutMs) || args.indexTimeoutMs < 1)
    throw new Error('--index-timeout-ms must be a positive integer');
  if (!Number.isInteger(args.queryTimeoutMs) || args.queryTimeoutMs < 1)
    throw new Error('--query-timeout-ms must be a positive integer');
  const sessionRoot = ensurePhase40Out(args.out);
  const task = loadTask(args.taskPayloads, args.taskId);
  const goldPath = resolve(args.gold);
  if (args.score && !existsSync(goldPath)) throw new Error(`gold file missing: ${goldPath}`);
  const evaluatorCwd = args.score ? resolveEvaluatorCwd(args) : null;
  writeSessionScratchpad(sessionRoot, task, args);

  const rows = [];
  for (const lane of args.lanes) {
    const runId = sanitize(`${lane}-${task.instance_id}-${args.repeat}-retrieval`);
    const paths = buildRunPaths(sessionRoot, runId);
    if (existsSync(paths.runDir))
      throw new Error(`run directory already exists; refusing overwrite: ${paths.runDir}`);
    const startedAt = new Date().toISOString();
    const retrieval = await runLane(lane, task, {
      limit: args.limit,
      window: args.window,
      indexTimeoutMs: args.indexTimeoutMs,
      queryTimeoutMs: args.queryTimeoutMs
    });
    const trajectory = buildTrajectory(task, retrieval);
    const answer = buildStructuredAnswer(task, retrieval);
    writeText(paths.prompt, task.problem_statement);
    writeJson(paths.setupIndex, retrieval.setup);
    writeJson(paths.rawTrace, {
      laneId: lane,
      claimBearing: false,
      retrievalOnly: true,
      notAgentTaskSuccess: true,
      workingDirectory: task.repo_checkout_path,
      task: {
        instance_id: task.instance_id,
        repo_url: task.repo_url,
        base_commit: task.base_commit,
        problem_statement_hash: task.problem_statement_hash
      },
      method: retrieval.method,
      status: retrieval.status,
      trace: retrieval.trace,
      retrievedItems: retrieval.items,
      scriptedAgentDecisions: true,
      scorerGoldReadDuringRetrieval: false
    });
    writeJson(paths.structuredAnswer, answer);
    writeJson(paths.trajectory, trajectory);
    const score = args.score
      ? scoreTrajectory(
          goldPath,
          paths.trajectory,
          paths.officialResults,
          evaluatorCwd,
          join(sessionRoot, 'score-cache')
        )
      : {
          status: 'not_scored',
          mode: 'not_requested',
          claimBearing: false,
          retrievalOnly: true,
          fallbackReason: 'run_without_score_flag'
        };
    writeJson(paths.score, score);
    const completedAt = new Date().toISOString();
    const row = {
      run_id: runId,
      lane_id: lane,
      task_id: task.instance_id,
      repeat_index: args.repeat,
      status: score.status === 'completed' ? retrieval.status : score.status,
      started_at: startedAt,
      completed_at: completedAt,
      raw_trace_path: paths.rawTrace,
      structured_answer_path: paths.structuredAnswer,
      trajectory_path: paths.trajectory,
      score_path: paths.score,
      setup_index_path: paths.setupIndex,
      prompt_path: paths.prompt,
      setupIndex: retrieval.setup,
      taskExecution: {
        executor: 'retrieval-script',
        retrievalOnly: true,
        taskWallTimeMs: new Date(completedAt).getTime() - new Date(startedAt).getTime()
      },
      scoring: {
        officialEvaluatorFirst: Boolean(args.score),
        claimBearing: false,
        retrievalOnly: true,
        officialResultsPath: args.score ? paths.officialResults : null
      },
      hashes: {
        prompt: sha256Text(task.problem_statement),
        rawTrace: artifactHashIfPresent(paths.rawTrace),
        structuredAnswer: artifactHashIfPresent(paths.structuredAnswer),
        trajectory: artifactHashIfPresent(paths.trajectory),
        score: artifactHashIfPresent(paths.score),
        officialResults: artifactHashIfPresent(paths.officialResults)
      }
    };
    appendManifest(sessionRoot, row);
    rows.push(row);
  }
  writeJson(join(sessionRoot, 'RETRIEVAL-GATE-SUMMARY.json'), {
    completedAt: new Date().toISOString(),
    claimBearing: false,
    retrievalOnly: true,
    taskId: task.instance_id,
    rows
  });
  console.log(`retrieval gate wrote ${join(sessionRoot, 'RETRIEVAL-GATE-SUMMARY.json')}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
