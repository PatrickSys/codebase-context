import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const laneId = process.env.LANE_ID;
const targetTaskId = process.env.TARGET_TASK_ID || 'SWE-Bench-Pro__go__maintenance__bugfix__4df06349';
const root = process.env.ROOT || `/tmp/contextbench-rescue-${laneId || 'unknown'}`;
const outDir = join(root, 'pack');
const supportedLanes = ['raw-native', 'codebase-context', 'codebase-memory-mcp', 'grepai', 'codegraphcontext'];
if (!supportedLanes.includes(laneId)) throw new Error(`unsupported LANE_ID: ${laneId}`);
mkdirSync(outDir, { recursive: true });

const payloads = JSON.parse(readFileSync(process.env.TASK_PAYLOADS, 'utf8'));
const task = payloads.tasks.find((candidate) => candidate.instance_id === targetTaskId);
if (!task) throw new Error(`target task ${targetTaskId} missing from payloads`);
const repo = task.repo_checkout_path;

function run(cmd, args, opts = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || process.cwd(),
    env: opts.env || process.env,
    encoding: 'utf8',
    timeout: opts.timeoutMs || 300000,
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    command: [cmd, ...args].join(' '),
    cwd: opts.cwd || process.cwd(),
    status: typeof r.status === 'number' ? r.status : null,
    signal: r.signal,
    error: r.error?.message || null,
    durationMs: Date.now() - started,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const durationOf = (commands) => commands.reduce((sum, command) => sum + command.durationMs, 0);

function queryOf(text) {
  const stop = new Set(['that', 'this', 'with', 'from', 'when', 'then', 'into', 'should', 'would', 'could', 'there', 'where', 'which', 'about', 'after', 'before', 'have', 'will', 'been', 'than', 'also', 'only', 'some', 'using', 'must']);
  return String(text || '')
    .replace(/[`*_#>\[\](){},.;:!?/\\]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w.toLowerCase()))
    .slice(0, 24)
    .join(' ');
}

function collectRepoFiles(dir, prefix = '', files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'vendor' || entry.name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) collectRepoFiles(abs, rel, files);
    else files.push(rel.replaceAll('\\', '/'));
  }
  return files;
}

const repoFiles = collectRepoFiles(repo);
const repoFileSet = new Set(repoFiles);
const basenameMap = new Map();
for (const file of repoFiles) {
  const name = basename(file);
  const list = basenameMap.get(name) || [];
  list.push(file);
  basenameMap.set(name, list);
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function jsonish(s) {
  const t = stripAnsi(s).trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {}
  for (const [a, b] of [['{', '}'], ['[', ']']]) {
    const i = t.indexOf(a);
    const j = t.lastIndexOf(b);
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(t.slice(i, j + 1));
      } catch {}
    }
  }
  return null;
}

function norm(file) {
  let f = stripAnsi(file).replace(/^file:\/\//, '').replaceAll('\\', '/').trim();
  if (!f) return '';
  const repoNorm = repo.replaceAll('\\', '/');
  if (f.startsWith(repoNorm)) f = relative(repo, f).replaceAll('\\', '/');
  const marker = '/tmp/contextbench-checkouts-';
  const tmpIdx = f.indexOf(marker);
  if (tmpIdx >= 0) {
    const parts = f.slice(tmpIdx + marker.length).split('/');
    f = parts.slice(1).join('/');
  }
  f = f.replace(/^\/+/, '').replace(/^\.\//, '');
  if (!f || f.includes('://') || f.includes('..') || f.startsWith('tmp/')) return '';
  if (repoFileSet.has(f)) return f;
  if (existsSync(join(repo, f))) return f;
  const byName = basenameMap.get(basename(f));
  if (byName?.length === 1) return byName[0];
  return '';
}

function add(locs, file, start = 1, end = start, source = laneId) {
  const clean = norm(file);
  if (!clean) return;
  const s = Math.max(1, Number(start) || 1);
  locs.push({ file: clean, start: s, end: Math.max(s, Number(end) || s), source });
}

function walk(value, locs, source) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, locs, source);
    return;
  }
  add(
    locs,
    value.file || value.path || value.file_path || value.relative_path || value.filename || value.source_path || value.uri,
    value.start_line || value.startLine || value.line || value.line_number || value.start || 1,
    value.end_line || value.endLine || value.end || value.line || 1,
    source,
  );
  for (const item of Object.values(value)) walk(item, locs, source);
}

function collect(text, locs, source = laneId) {
  const cleaned = stripAnsi(text);
  const parsed = jsonish(cleaned);
  if (parsed) walk(parsed, locs, source);
  const rgLine = /^(.+?\.(?:go|mod|sum|json|yml|yaml|md|ts|tsx|js|jsx|py|rs|java|c|cc|cpp|h|hpp|rb|php|cs|kt|swift|vue|svelte)):(\d+):/gm;
  let m;
  while ((m = rgLine.exec(cleaned)) !== null) add(locs, m[1], m[2], m[2], source);
  const fileLine = /([A-Za-z0-9_.\/-]+\.(?:go|mod|sum|json|yml|yaml|md|ts|tsx|js|jsx|py|rs|java|c|cc|cpp|h|hpp|rb|php|cs|kt|swift|vue|svelte))(?::|#L|\s+line\s+)?(\d+)?/g;
  while ((m = fileLine.exec(cleaned)) !== null) add(locs, m[1], m[2] || 1, m[2] || 1, source);
}

function uniq(locs, max = 120) {
  const seen = new Set();
  const out = [];
  for (const loc of locs) {
    const key = `${loc.file}:${loc.start}:${loc.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(loc);
    if (out.length >= max) break;
  }
  return out;
}

function writeCommands(lane, commands) {
  for (const [i, command] of commands.entries()) {
    writeFileSync(join(outDir, `${lane}-command-${i + 1}.json`), JSON.stringify({ ...command, stdout: command.stdout.slice(0, 200000), stderr: command.stderr.slice(0, 200000) }, null, 2));
  }
}

function laneResult(lane, commands, locs, setupStatus, indexStatus, setupIndex) {
  writeCommands(lane, commands);
  const candidates = uniq(locs);
  return {
    lane,
    ready: (setupStatus === 'completed' || setupStatus === 'not_required') && (indexStatus === 'completed' || indexStatus === 'not_required') && commands.some((command) => command.status === 0) && candidates.length > 0,
    setupStatus,
    indexStatus,
    toolCallable: commands.some((command) => command.status === 0),
    candidateCount: candidates.length,
    setupIndex,
    commands: commands.map((command) => ({ command: command.command, status: command.status, signal: command.signal, error: command.error, durationMs: command.durationMs })),
    candidates,
  };
}

const baseQuery = queryOf(task.problem_statement);
const queryVariants = [
  baseQuery,
  'system metrics written on start prometheus writer insights',
  'Bearer token custom authorization header authentication',
  'Subsonic authorization header token parsing',
  'startup metrics insights prometheus initialization',
];

function runRawNative() {
  const commands = [];
  const locs = [];
  for (const term of ['metrics', 'prometheus', 'insights', 'startup', 'start', 'written', 'authorization', 'Bearer', 'token', 'header', 'authentication', 'subsonic']) {
    const r = run('rg', ['-n', '-i', '--glob', '!.git', '--glob', '!vendor/**', '--glob', '!node_modules/**', term, '.'], { cwd: repo, timeoutMs: 60000 });
    commands.push(r);
    collect(r.stdout, locs, 'raw-native');
    collect(r.stderr, locs, 'raw-native');
  }
  return laneResult('raw-native', commands, locs, 'not_required', 'not_required', { setupDurationMs: 0, indexDurationMs: 0, queryDurationMs: durationOf(commands) });
}

function runCodebaseContext() {
  const commands = [];
  const locs = [];
  const env = { ...process.env, CODEBASE_ROOT: repo, CODEBASE_CONTEXT_ASCII: '1' };
  const setup = run('node', ['dist/index.js', '--version'], { env, timeoutMs: 60000 });
  commands.push(setup);
  const index = run('node', ['dist/index.js', 'reindex'], { env, timeoutMs: 420000 });
  commands.push(index);
  const searches = [];
  if (index.status === 0) {
    for (const q of queryVariants) {
      const search = run('node', ['dist/index.js', 'search', '--query', q, '--intent', 'edit', '--limit', '40', '--json'], { env, timeoutMs: 90000 });
      commands.push(search);
      searches.push(search);
      collect(search.stdout, locs, 'codebase-context');
      collect(search.stderr, locs, 'codebase-context');
    }
  }
  return laneResult('codebase-context', commands, locs, setup.status === 0 ? 'completed' : 'setup_failed', index.status === 0 ? 'completed' : 'index_failed', { setupDurationMs: setup.durationMs, indexDurationMs: index.durationMs, queryDurationMs: durationOf(searches) });
}

function runCodebaseMemoryMcp() {
  const commands = [];
  const locs = [];
  const env = { ...process.env, CBM_CACHE_DIR: join(outDir, 'cbm-cache'), CBM_DIAGNOSTICS: '1' };
  const setup = run(process.env.CBM_BIN, ['--version'], { env, timeoutMs: 60000 });
  commands.push(setup);
  const index = run(process.env.CBM_BIN, ['cli', 'index_repository', JSON.stringify({ repo_path: repo })], { cwd: repo, env, timeoutMs: 1800000 });
  commands.push(index);
  const project = (jsonish(index.stdout) || jsonish(index.stderr) || {}).project || basename(repo);
  const searches = [];
  if (index.status === 0) {
    for (const q of queryVariants) {
      const graph = run(process.env.CBM_BIN, ['cli', 'search_graph', JSON.stringify({ project, query: q, limit: 50 })], { cwd: repo, env, timeoutMs: 120000 });
      commands.push(graph);
      searches.push(graph);
      collect(graph.stdout, locs, 'codebase-memory-mcp');
      collect(graph.stderr, locs, 'codebase-memory-mcp');
    }
    for (const term of ['metrics', 'prometheus', 'authorization', 'Bearer', 'token']) {
      const code = run(process.env.CBM_BIN, ['cli', 'search_code', JSON.stringify({ project, pattern: term, mode: 'compact', limit: 50 })], { cwd: repo, env, timeoutMs: 120000 });
      commands.push(code);
      searches.push(code);
      collect(code.stdout, locs, 'codebase-memory-mcp');
      collect(code.stderr, locs, 'codebase-memory-mcp');
    }
  }
  return laneResult('codebase-memory-mcp', commands, locs, setup.status === 0 ? 'completed' : 'setup_failed', index.status === 0 ? 'completed' : 'index_failed', { setupDurationMs: setup.durationMs, indexDurationMs: index.durationMs, queryDurationMs: durationOf(searches) });
}

async function runGrepai() {
  const commands = [];
  const locs = [];
  const setup = run('grepai', ['version'], { timeoutMs: 60000 });
  commands.push(setup);
  const init = run('grepai', ['init', '--yes', '--provider', 'synthetic', '--backend', 'gob'], { cwd: repo, timeoutMs: 120000 });
  commands.push(init);

  const started = Date.now();
  const watcher = spawn('grepai', ['watch', '--no-ui'], { cwd: repo, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let watchStdout = '';
  let watchStderr = '';
  let watchExitCode = null;
  let watchSignal = null;
  watcher.stdout.on('data', (chunk) => { watchStdout = `${watchStdout}${chunk}`.slice(-200000); });
  watcher.stderr.on('data', (chunk) => { watchStderr = `${watchStderr}${chunk}`.slice(-200000); });
  watcher.on('exit', (code, signal) => { watchExitCode = code; watchSignal = signal; });

  const statusChecks = [];
  let indexed = false;
  for (let i = 0; i < 18; i += 1) {
    await sleep(i === 0 ? 3000 : 5000);
    const status = run('grepai', ['status', '--no-ui'], { cwd: repo, timeoutMs: 60000 });
    commands.push(status);
    statusChecks.push(status);
    const text = `${status.stdout}\n${status.stderr}\n${watchStdout}\n${watchStderr}`;
    if (/chunks?\D+[1-9][0-9]*|indexed files?\D+[1-9][0-9]*|files indexed\D+[1-9][0-9]*/i.test(text)) {
      indexed = true;
      break;
    }
    if (watchExitCode !== null && i > 1) break;
  }

  const searches = [];
  if (indexed) {
    for (const q of queryVariants) {
      const search = run('grepai', ['search', q, '--json', '--compact', '--limit', '40'], { cwd: repo, timeoutMs: 90000 });
      commands.push(search);
      searches.push(search);
      collect(search.stdout, locs, 'grepai');
      collect(search.stderr, locs, 'grepai');
    }
  }

  const stop = run('grepai', ['watch', '--stop'], { cwd: repo, timeoutMs: 60000 });
  if (watchExitCode === null) watcher.kill('SIGTERM');
  await sleep(1000);
  commands.push({
    command: 'grepai watch --no-ui',
    cwd: repo,
    status: indexed ? 0 : watchExitCode,
    signal: watchSignal,
    error: null,
    durationMs: Date.now() - started,
    stdout: watchStdout,
    stderr: watchStderr,
  });
  commands.push(stop);

  return laneResult('grepai', commands, locs, setup.status === 0 && init.status === 0 ? 'completed' : 'setup_failed', indexed ? 'completed' : 'index_failed', { setupDurationMs: setup.durationMs + init.durationMs, indexDurationMs: durationOf(statusChecks), queryDurationMs: durationOf(searches), teardownDurationMs: stop.durationMs });
}

function runCodeGraphContext() {
  const commands = [];
  const locs = [];
  const cgcProbe = run('cgc', ['--help'], { timeoutMs: 60000 });
  const command = cgcProbe.status === 0 ? 'cgc' : 'codegraphcontext';
  const setup = cgcProbe.status === 0 ? cgcProbe : run(command, ['--help'], { timeoutMs: 60000 });
  commands.push(setup);
  const index = run(command, ['index', '.'], { cwd: repo, timeoutMs: 900000 });
  commands.push(index);
  const stats = run(command, ['stats'], { cwd: repo, timeoutMs: 60000 });
  commands.push(stats);
  const queries = [stats];
  collect(stats.stdout, locs, 'codegraphcontext');
  collect(stats.stderr, locs, 'codegraphcontext');

  if (index.status === 0) {
    for (const q of ['metrics', 'prometheus', 'insights', 'startup metrics', 'authorization header', 'Bearer token', 'subsonic authentication', 'helpers', 'root command']) {
      const found = run(command, ['find', q], { cwd: repo, timeoutMs: 90000 });
      commands.push(found);
      queries.push(found);
      collect(found.stdout, locs, 'codegraphcontext');
      collect(found.stderr, locs, 'codegraphcontext');
    }
    for (const args of [
      ['query', 'callers', 'main'],
      ['query', 'callees', 'main'],
      ['query', 'callers', 'GetUser'],
      ['query', 'callees', 'GetUser'],
      ['query', 'callers', 'ServeHTTP'],
      ['query', 'dead-code', ''],
    ]) {
      const cleanArgs = args.filter(Boolean);
      const q = run(command, cleanArgs, { cwd: repo, timeoutMs: 90000 });
      commands.push(q);
      queries.push(q);
      collect(q.stdout, locs, 'codegraphcontext');
      collect(q.stderr, locs, 'codegraphcontext');
    }
  }

  return laneResult('codegraphcontext', commands, locs, setup.status === 0 ? 'completed' : 'setup_failed', index.status === 0 ? 'completed' : 'index_failed', { setupDurationMs: setup.durationMs, indexDurationMs: index.durationMs, queryDurationMs: durationOf(queries) });
}

const result = laneId === 'raw-native'
  ? runRawNative()
  : laneId === 'codebase-context'
    ? runCodebaseContext()
    : laneId === 'codebase-memory-mcp'
      ? runCodebaseMemoryMcp()
      : laneId === 'grepai'
        ? await runGrepai()
        : runCodeGraphContext();

const pack = {
  createdAt: new Date().toISOString(),
  targetTaskId,
  task: {
    instance_id: task.instance_id,
    repo: task.repo,
    base_commit: task.base_commit,
    problem_statement: task.problem_statement,
  },
  queryVariants,
  readiness: result,
};

writeFileSync(join(outDir, `${laneId}-candidate-pack.json`), JSON.stringify(pack, null, 2));
writeFileSync(join(outDir, `${laneId}-readiness.json`), JSON.stringify(result, null, 2));
console.log('CONTEXTBENCH_RESCUE_LANE_READINESS_JSON_START');
console.log(JSON.stringify(pack, null, 2));
console.log('CONTEXTBENCH_RESCUE_LANE_READINESS_JSON_END');
if (!result.ready) process.exitCode = 1;
