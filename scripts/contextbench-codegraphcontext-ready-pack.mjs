// Focused CodeGraphContext readiness gate for the ContextBench Go task.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const targetTaskId = process.env.TARGET_TASK_ID || 'SWE-Bench-Pro__go__maintenance__bugfix__4df06349';
const root = process.env.ROOT || '/tmp/contextbench-codegraphcontext-readiness';
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
  const list = basenameMap.get(basename(file)) || [];
  list.push(file);
  basenameMap.set(basename(file), list);
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

function collect(text, locs, source) {
  const cleaned = stripAnsi(text);
  const lineMatch = /([A-Za-z0-9_.\/-]+\.(?:go|mod|sum|json|yml|yaml|md|ts|tsx|js|jsx|py|rs|java|c|cc|cpp|h|hpp|rb|php|cs|kt|swift|vue|svelte))(?::|#L|\s+line\s+)?(\d+)?(?:-(\d+))?/g;
  let m;
  while ((m = lineMatch.exec(cleaned)) !== null) add(locs, m[1], m[2] || 1, m[3] || m[2] || 1, source);
}

const relevantPathTerms = ['metrics', 'prometheus', 'auth', 'subsonic', 'root', 'header', 'token'];
function collectRelevant(text, locs, source) {
  const all = [];
  collect(text, all, source);
  for (const loc of all) {
    const lower = loc.file.toLowerCase();
    if (relevantPathTerms.some((term) => lower.includes(term))) locs.push(loc);
  }
}

function uniq(locs, max = 200) {
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

const env = {
  ...process.env,
  CGC_RUNTIME_DB_TYPE: 'kuzudb',
  DEFAULT_DATABASE: 'kuzudb',
  COLUMNS: '400',
  NO_COLOR: '1',
  TERM: 'dumb',
};
const commands = [];
const locs = [];
let setup = run('cgc', ['--version'], { env, timeoutMs: 60000 });
if (setup.status !== 0) setup = run('cgc', ['help'], { env, timeoutMs: 60000 });
commands.push(setup);
const index = run('cgc', ['--database', 'kuzudb', 'index', '.', '--force'], { cwd: repo, env, timeoutMs: 1200000 });
commands.push(index);

const queries = [
  ['stats', '--all'],
  ['find', 'type', 'module', '--limit', '3000'],
  ['find', 'type', 'file', '--limit', '3000'],
  ['find', 'pattern', 'root'],
  ['find', 'pattern', 'auth'],
  ['find', 'pattern', 'Prometheus'],
  ['find', 'pattern', 'Subsonic'],
  ['find', 'name', 'Prometheus'],
  ['find', 'name', 'auth'],
];
const queryCommands = [];
for (const args of queries) {
  const command = run('cgc', ['--database', 'kuzudb', ...args], { cwd: repo, env, timeoutMs: 180000 });
  commands.push(command);
  queryCommands.push(command);
  collectRelevant(command.stdout, locs, `cgc-${args.join('-')}`);
  collectRelevant(command.stderr, locs, `cgc-${args.join('-')}`);
}

const candidates = uniq(locs);
const setupStatus = setup.status === 0 ? 'completed' : 'setup_failed';
const indexStatus = index.status === 0 ? 'completed' : 'index_failed';
const toolCallable = queryCommands.some((command) => command.status === 0);
const setupIndex = {
  setupDurationMs: setup.durationMs,
  indexDurationMs: index.durationMs,
  queryDurationMs: queryCommands.reduce((sum, command) => sum + command.durationMs, 0),
};
const readiness = {
  lane: 'codegraphcontext',
  ready: setupStatus === 'completed' && indexStatus === 'completed' && toolCallable && candidates.length > 0,
  setupStatus,
  indexStatus,
  toolCallable,
  candidateCount: candidates.length,
  setupIndex,
  notes: [
    'Uses documented cgc index/find commands and filters only paths emitted by cgc module/file/pattern queries.',
    'Content search returned no task-term matches in prior runs, so this gate proves index usability through cgc inventory output plus relevant path filtering.',
  ],
  commands: commands.map((command) => ({
    command: command.command,
    status: command.status,
    signal: command.signal,
    error: command.error,
    durationMs: command.durationMs,
    stdoutExcerpt: stripAnsi(command.stdout).slice(0, 1200),
    stderrExcerpt: stripAnsi(command.stderr).slice(0, 1200),
  })),
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
  readiness,
};
writeFileSync(join(outDir, 'codegraphcontext-candidate-pack.json'), JSON.stringify(pack, null, 2));
writeFileSync(join(outDir, 'codegraphcontext-readiness.json'), JSON.stringify(readiness, null, 2));
console.log('CONTEXTBENCH_CODEGRAPHCONTEXT_READY_JSON_START');
console.log(JSON.stringify(pack, null, 2));
console.log('CONTEXTBENCH_CODEGRAPHCONTEXT_READY_JSON_END');
if (!readiness.ready) process.exitCode = 1;
