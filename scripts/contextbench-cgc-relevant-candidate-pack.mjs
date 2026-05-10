import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const targetTaskId = process.env.TARGET_TASK_ID || 'SWE-Bench-Pro__go__maintenance__bugfix__4df06349';
const root = process.env.ROOT || '/tmp/contextbench-cgc-relevant';
const outDir = join(root, 'pack');
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

function norm(file) {
  let f = stripAnsi(file).replace(/^file:\/\//, '').replaceAll('\\', '/').trim();
  if (!f) return '';
  const repoNorm = repo.replaceAll('\\', '/');
  if (f.startsWith(repoNorm)) f = relative(repo, f).replaceAll('\\', '/');
  f = f.replace(/^\/+/, '').replace(/^\.\//, '');
  if (!f || f.includes('://') || f.includes('..')) return '';
  if (repoFileSet.has(f)) return f;
  if (existsSync(join(repo, f))) return f;
  const byName = basenameMap.get(basename(f));
  if (byName?.length === 1) return byName[0];
  return '';
}

function add(locs, file, start = 1, end = start, source = 'codegraphcontext') {
  const clean = norm(file);
  if (!clean) return;
  const s = Math.max(1, Number(start) || 1);
  locs.push({ file: clean, start: s, end: Math.max(s, Number(end) || s), source });
}

function parseJson(text) {
  const cleaned = stripAnsi(text).trim();
  if (!cleaned) return null;
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  return null;
}

function walk(value, locs, source) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, locs, source);
    return;
  }
  add(locs, value.path || value.file || value.file_path || value.name || value.uri, value.line_number || value.line || 1, value.end_line || value.line_number || 1, source);
  for (const item of Object.values(value)) walk(item, locs, source);
}

function collect(text, locs, source) {
  const parsed = parseJson(text);
  if (parsed) walk(parsed, locs, source);
  const cleaned = stripAnsi(text);
  const fileLine = /([A-Za-z0-9_.\/-]+\.(?:go|mod|sum|json|yml|yaml|md|ts|tsx|js|jsx|py|rs|java|c|cc|cpp|h|hpp|rb|php|cs|kt|swift|vue|svelte))(?::|#L|\s+line\s+)?(\d+)?/g;
  let m;
  while ((m = fileLine.exec(cleaned)) !== null) add(locs, m[1], m[2] || 1, m[2] || 1, source);
}

const relevantTerms = ['metrics', 'prometheus', 'insights', 'auth', 'authorization', 'bearer', 'token', 'header', 'subsonic', 'root'];
function isRelevant(loc) {
  const file = loc.file.toLowerCase();
  return relevantTerms.some((term) => file.includes(term));
}

function uniq(locs, max = 80) {
  const seen = new Set();
  const out = [];
  for (const loc of locs.filter(isRelevant)) {
    const key = `${loc.file}:${loc.start}:${loc.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(loc);
    if (out.length >= max) break;
  }
  return out;
}

function writeCommands(commands) {
  for (const [i, command] of commands.entries()) {
    writeFileSync(join(outDir, `codegraphcontext-command-${i + 1}.json`), JSON.stringify({
      ...command,
      stdout: command.stdout.slice(0, 200000),
      stderr: command.stderr.slice(0, 200000),
    }, null, 2));
  }
}

const env = { ...process.env, DEFAULT_DATABASE: 'kuzudb', CGC_RUNTIME_DB_TYPE: 'kuzudb' };
const commands = [];
const locs = [];
const setup = run('cgc', ['--version'], { env, timeoutMs: 60000 });
commands.push(setup);
const index = run('cgc', ['index', '.', '--force'], { cwd: repo, env, timeoutMs: 1200000 });
commands.push(index);
const queryCommands = [];
for (const term of relevantTerms) {
  const apiQuery = run('python', ['-c', `import json\nfrom codegraphcontext.core.database import DatabaseManager\ndb=DatabaseManager()\nwith db.get_driver().session() as s:\n    rows=s.run("MATCH (f:File) WHERE toLower(f.path) CONTAINS '${term}' RETURN f.path as path LIMIT 100").data()\nprint(json.dumps(rows))\ndb.close_driver()`], { cwd: repo, env, timeoutMs: 180000 });
  commands.push(apiQuery);
  queryCommands.push(apiQuery);
  collect(apiQuery.stdout, locs, `codegraphcontext-query-${term}`);
  collect(apiQuery.stderr, locs, `codegraphcontext-query-${term}`);
}
for (const pattern of ['Metrics', 'Prometheus', 'Authorization', 'Bearer', 'Token', 'Subsonic', 'Header']) {
  const found = run('cgc', ['find', 'pattern', pattern], { cwd: repo, env, timeoutMs: 180000 });
  commands.push(found);
  queryCommands.push(found);
  collect(found.stdout, locs, 'codegraphcontext-pattern');
  collect(found.stderr, locs, 'codegraphcontext-pattern');
}

writeCommands(commands);
const candidates = uniq(locs);
const result = {
  lane: 'codegraphcontext',
  ready: setup.status === 0 && index.status === 0 && candidates.length > 0,
  setupStatus: setup.status === 0 ? 'completed' : 'setup_failed',
  indexStatus: index.status === 0 && candidates.length > 0 ? 'completed' : 'index_failed',
  toolCallable: commands.some((command) => command.status === 0),
  candidateCount: candidates.length,
  setupIndex: {
    setupDurationMs: setup.durationMs,
    indexDurationMs: index.durationMs,
    queryDurationMs: queryCommands.reduce((sum, command) => sum + command.durationMs, 0),
  },
  commands: commands.map((command) => ({ command: command.command, status: command.status, signal: command.signal, error: command.error, durationMs: command.durationMs })),
  candidates,
};

const pack = {
  createdAt: new Date().toISOString(),
  targetTaskId,
  task: {
    instance_id: task.instance_id,
    repo: task.repo,
    base_commit: task.base_commit,
    problem_statement: task.problem_statement,
  },
  readiness: result,
};
writeFileSync(join(outDir, 'codegraphcontext-candidate-pack.json'), JSON.stringify(pack, null, 2));
writeFileSync(join(outDir, 'codegraphcontext-readiness.json'), JSON.stringify(result, null, 2));
console.log('CONTEXTBENCH_CGC_RELEVANT_READINESS_JSON_START');
console.log(JSON.stringify(pack, null, 2));
console.log('CONTEXTBENCH_CGC_RELEVANT_READINESS_JSON_END');
if (!result.ready) process.exitCode = 1;
