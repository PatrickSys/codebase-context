import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withManagedStdioClientSession } from '../managed-mcp-session.mjs';
import {
  countUtf8Bytes,
  estimateTokens,
  normalizeRelativePath,
  scoreTaskResult
} from './scoring.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const aiderScript = path.join(__dirname, 'aider-repomap-query.py');
const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

function runCommand(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: options.timeoutMs ?? 300_000,
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env
  });
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs: Date.now() - started,
    error: result.error?.message ?? null
  };
}

function collectPatternExemplarPaths(patternsValue) {
  const paths = [];
  if (!patternsValue) return paths;
  const entries = Array.isArray(patternsValue)
    ? patternsValue
    : typeof patternsValue === 'object'
      ? Object.values(patternsValue)
      : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const primary = entry.primary ?? entry;
    const canonical = primary?.canonicalExample?.file ?? entry.bestExample ?? entry.example;
    if (canonical) paths.push(canonical);
    const examples = primary?.examples;
    if (Array.isArray(examples)) {
      for (const example of examples) {
        if (typeof example === 'string') paths.push(example);
      }
    }
  }
  return paths;
}

export function extractSearchFilesFromJson(value) {
  const topFiles = [];
  if (!value || typeof value !== 'object') return topFiles;
  const push = (candidate) => {
    const normalized = normalizeRelativePath(candidate);
    if (normalized && !topFiles.includes(normalized)) topFiles.push(normalized);
  };
  const results = Array.isArray(value.results) ? value.results : [];
  for (const entry of results) {
    push(entry.file ?? entry.path ?? '');
  }
  if (Array.isArray(value.rankedExemplars)) {
    for (const row of value.rankedExemplars) {
      push(row?.file ?? row?.path ?? '');
    }
  }
  if (Array.isArray(value.goldenFiles)) {
    for (const golden of value.goldenFiles) {
      push(golden?.file ?? '');
    }
  }
  for (const filePath of collectPatternExemplarPaths(value.patterns)) {
    push(filePath);
  }
  return topFiles;
}

function codebaseContextCommand(projectRoot) {
  const distIndex = path.join(projectRoot, 'dist', 'index.js');
  if (existsSync(distIndex)) {
    return { command: process.execPath, args: [distIndex] };
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['exec', '--', 'codebase-context']
  };
}

export function ensureRepoCheckout(repo, projectRoot) {
  const cloneRoot = path.join(projectRoot, 'benchmark-repos');
  const checkout = path.join(cloneRoot, repo.id);
  mkdirSync(cloneRoot, { recursive: true });
  if (!existsSync(path.join(checkout, '.git'))) {
    const clone = runCommand('git', ['clone', '--filter=blob:none', repo.repositoryUrl, checkout], {
      timeoutMs: 600_000
    });
    if (clone.status !== 0) {
      throw new Error(`git clone failed for ${repo.id}: ${clone.stderr || clone.error}`);
    }
  }
  const fetch = runCommand(
    'git',
    ['fetch', '--depth', '1', 'origin', repo.repositoryRef],
    { cwd: checkout, timeoutMs: 600_000 }
  );
  if (fetch.status !== 0) {
    throw new Error(`git fetch failed for ${repo.id}: ${fetch.stderr || fetch.error}`);
  }
  const checkoutRun = runCommand('git', ['checkout', '--force', repo.repositoryRef], {
    cwd: checkout,
    timeoutMs: 120_000
  });
  if (checkoutRun.status !== 0) {
    throw new Error(`git checkout failed for ${repo.id}: ${checkoutRun.stderr || checkoutRun.error}`);
  }
  return checkout;
}

export async function warmCodebaseContextIndex(repoPath, projectRoot) {
  const base = codebaseContextCommand(projectRoot);
  const env = {
    ...process.env,
    CODEBASE_ROOT: repoPath,
    CODEBASE_CONTEXT_ASCII: '1'
  };
  return runCommand(
    base.command,
    [...base.args, 'reindex', '--no-embeddings', '--json'],
    { env, timeoutMs: 900_000 }
  );
}

export async function runCodebaseContextTask(task, repoPath, projectRoot, indexElapsedMs) {
  const base = codebaseContextCommand(projectRoot);
  const env = {
    ...process.env,
    CODEBASE_ROOT: repoPath,
    CODEBASE_CONTEXT_ASCII: '1'
  };
  const cc = task.codebaseContext;
  const args = [...base.args, cc.command];
  if (cc.command === 'search') {
    args.push('--query', task.query);
  }
  args.push(...cc.args);
  const started = Date.now();
  const result = runCommand(base.command, args, { env, timeoutMs: 180_000 });
  const queryElapsedMs = Date.now() - started;
  let payload = `${result.stdout}\n${result.stderr}`.trim();
  let topFiles = [];
  if (result.status === 0) {
    try {
      const parsed = JSON.parse(result.stdout);
      payload = JSON.stringify(parsed);
      topFiles = extractSearchFilesFromJson(parsed).map((filePath) => {
        const resolvedRepo = path.resolve(repoPath);
        const resolvedFile = path.resolve(filePath);
        if (resolvedFile.startsWith(resolvedRepo + path.sep)) {
          return normalizeRelativePath(path.relative(resolvedRepo, resolvedFile));
        }
        return normalizeRelativePath(filePath);
      });
    } catch {
      topFiles = [];
    }
  }
  const score = scoreTaskResult(task, { payload, topFiles });
  return {
    status: result.status === 0 ? 'completed' : 'tool_error',
    niche: task.niche,
    ...score,
    payloadBytes: countUtf8Bytes(payload),
    estimatedTokens: estimateTokens(countUtf8Bytes(payload)),
    queryElapsedMs,
    indexElapsedMs: indexElapsedMs ?? 0,
    topFiles
  };
}

function tokenizeQuery(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_+#./-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

export function runRipgrepTask(task, repoPath, indexElapsedMs = 0) {
  const tokens = tokenizeQuery(task.query);
  const pattern = tokens.slice(0, 8).join('|') || task.query.slice(0, 80);
  const started = Date.now();
  const result = runCommand(
    process.env.RG_PATH || 'rg',
    ['--json', '-n', '--hidden', '--glob', '!.git/**', '--glob', '!node_modules/**', '--glob', '!dist/**', pattern, '.'],
    { cwd: repoPath, timeoutMs: 120_000 }
  );
  const queryElapsedMs = Date.now() - started;
  const topFiles = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== 'match') continue;
    const normalized = normalizeRelativePath(event.data?.path?.text ?? '');
    if (normalized && !topFiles.includes(normalized)) topFiles.push(normalized);
    if (topFiles.length >= 5) break;
  }
  const payload = result.stdout.slice(0, 20_000);
  const score = scoreTaskResult(task, { payload, topFiles });
  return {
    status: result.status === 0 || result.status === 1 ? 'completed' : 'tool_error',
    niche: task.niche,
    ...score,
    payloadBytes: countUtf8Bytes(payload),
    estimatedTokens: estimateTokens(countUtf8Bytes(payload)),
    queryElapsedMs,
    indexElapsedMs,
    topFiles
  };
}

function parseJCodeMunchPayload(result) {
  const textParts = Array.isArray(result?.content)
    ? result.content
        .map((item) => (typeof item?.text === 'string' ? item.text.trim() : ''))
        .filter(Boolean)
    : [];
  const payload = textParts.join('\n');
  let topFiles = [];
  try {
    const parsed = JSON.parse(payload);
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    for (const entry of results) {
      const normalized = normalizeRelativePath(entry.file ?? entry.path ?? '');
      if (normalized && !topFiles.includes(normalized)) topFiles.push(normalized);
    }
  } catch {
    for (const line of payload.split('\n')) {
      if (!line.startsWith('s,')) continue;
      const columns = line.split(',');
      const fileColumn = columns[3] ?? columns[4];
      const normalized = normalizeRelativePath(fileColumn ?? '');
      if (normalized && !topFiles.includes(normalized)) topFiles.push(normalized);
    }
  }
  return { payload, topFiles };
}

export async function warmJCodeMunchRepo(repoPath) {
  return withManagedStdioClientSession(
    {
      serverCommand: pythonCmd,
      serverArgs: ['-m', 'jcodemunch_mcp.server', 'serve', '--transport', 'stdio', '--log-level', 'ERROR'],
      serverEnv: { ...process.env, JCODEMUNCH_USE_AI_SUMMARIES: 'false' },
      cwd: repoPath,
      connectTimeoutMs: 30_000
    },
    async ({ client }) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const started = Date.now();
      const indexResult = await client.callTool({
        name: 'index_folder',
        arguments: {
          path: path.resolve(repoPath),
          use_ai_summaries: false,
          incremental: true,
          follow_symlinks: false,
          extra_ignore_patterns: ['.codebase-context/**', 'node_modules/**']
        }
      });
      const { payload } = parseJCodeMunchPayload(indexResult);
      let repoName = null;
      try {
        const parsed = JSON.parse(payload || '{}');
        repoName = typeof parsed.repo === 'string' ? parsed.repo : parsed.name ?? null;
      } catch {
        repoName = null;
      }
      return { repoName, indexElapsedMs: Date.now() - started };
    }
  );
}

export async function runJCodeMunchTask(task, repoPath, repoName, indexElapsedMs) {
  if (!repoName) {
    return {
      status: 'setup_failed',
      niche: task.niche,
      top3Hit: false,
      usefulnessScore: 0,
      queryElapsedMs: 0,
      indexElapsedMs,
      payloadBytes: 0,
      estimatedTokens: 0,
      topFiles: []
    };
  }
  return withManagedStdioClientSession(
    {
      serverCommand: pythonCmd,
      serverArgs: ['-m', 'jcodemunch_mcp.server', 'serve', '--transport', 'stdio', '--log-level', 'ERROR'],
      serverEnv: { ...process.env, JCODEMUNCH_USE_AI_SUMMARIES: 'false' },
      cwd: repoPath,
      connectTimeoutMs: 30_000
    },
    async ({ client }) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const started = Date.now();
      const result = await client.callTool({
        name: 'search_symbols',
        arguments: {
          repo: repoName,
          query: task.query,
          max_results: 5,
          detail_level: 'compact',
          semantic: false
        }
      });
      const queryElapsedMs = Date.now() - started;
      const { payload, topFiles } = parseJCodeMunchPayload(result);
      const score = scoreTaskResult(task, { payload, topFiles });
      return {
        status: 'completed',
        niche: task.niche,
        ...score,
        payloadBytes: countUtf8Bytes(payload),
        estimatedTokens: estimateTokens(countUtf8Bytes(payload)),
        queryElapsedMs,
        indexElapsedMs,
        topFiles
      };
    }
  );
}

export function warmAiderRepo(repoPath) {
  return runCommand(
    pythonCmd,
    [aiderScript, '--root', repoPath, '--warm-index', '--limit', '3'],
    { cwd: repoPath, timeoutMs: 900_000 }
  );
}

export function runAiderTask(task, repoPath, indexElapsedMs) {
  const result = runCommand(
    pythonCmd,
    [aiderScript, '--root', repoPath, '--query', task.query, '--limit', '5'],
    { cwd: repoPath, timeoutMs: 300_000 }
  );
  let topFiles = [];
  let payload = result.stdout;
  try {
    const parsed = JSON.parse(result.stdout);
    topFiles = Array.isArray(parsed.topFiles) ? parsed.topFiles : [];
    payload = parsed.payload ?? result.stdout;
  } catch {
    topFiles = [];
  }
  const score = scoreTaskResult(task, { payload, topFiles });
  return {
    status: result.status === 0 ? 'completed' : 'tool_error',
    niche: task.niche,
    ...score,
    payloadBytes: countUtf8Bytes(payload),
    estimatedTokens: estimateTokens(countUtf8Bytes(payload)),
    queryElapsedMs: (() => {
      try {
        return JSON.parse(result.stdout || '{}').queryElapsedMs ?? result.durationMs;
      } catch {
        return result.durationMs;
      }
    })(),
    indexElapsedMs,
    topFiles
  };
}

function rankRepomixPack(packText, query, limit) {
  const tokens = tokenizeQuery(query);
  const sections = packText.split(/\n={32}\n/);
  const scores = new Map();
  for (const section of sections) {
    const fileMatch = section.match(/^File:\s+(.+)$/m);
    if (!fileMatch) continue;
    const filePath = fileMatch[1].trim();
    const lower = section.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (lower.includes(token)) score += 1;
    }
    if (score > 0) scores.set(filePath, score);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([filePath]) => filePath.replace(/\\/g, '/'));
}

export function warmRepomixRepo(repoPath) {
  const started = Date.now();
  const result = runCommand(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['--yes', 'repomix', '--stdout', '--quiet', '--style', 'plain'],
    { cwd: repoPath, timeoutMs: 900_000 }
  );
  return {
    packText: result.stdout,
    indexElapsedMs: Date.now() - started,
    status: result.status === 0 ? 'completed' : 'setup_failed',
    error: result.status === 0 ? null : result.stderr || result.error
  };
}

export function runRepomixTask(task, packText, indexElapsedMs) {
  const started = Date.now();
  const topFiles = rankRepomixPack(packText, task.query, 5);
  const payload = topFiles.join('\n');
  const queryElapsedMs = Date.now() - started;
  const score = scoreTaskResult(task, { payload, topFiles });
  return {
    status: packText ? 'completed' : 'setup_failed',
    niche: task.niche,
    ...score,
    payloadBytes: countUtf8Bytes(packText.slice(0, 50_000)),
    estimatedTokens: estimateTokens(countUtf8Bytes(packText)),
    queryElapsedMs,
    indexElapsedMs,
    topFiles
  };
}
