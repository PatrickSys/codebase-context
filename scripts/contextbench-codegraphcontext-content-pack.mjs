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

const durationOf = (commands) => commands.reduce((sum, command) => sum + command.durationMs, 0);

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

function norm(file) {
  let f = String(file || '').replace(/^file:\/\//, '').replaceAll('\\', '/').trim();
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

function add(locs, file, start = 1, end = start) {
  const clean = norm(file);
  if (!clean) return;
  const s = Math.max(1, Number(start) || 1);
  locs.push({ file: clean, start: s, end: Math.max(s, Number(end) || s), source: 'codegraphcontext' });
}

function collect(text, locs) {
  const cleaned = String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
  const lineRe = /^(.+?\.(?:go|mod|sum|json|yml|yaml|md|ts|tsx|js|jsx|py|rs|java|c|cc|cpp|h|hpp)):(\d+):/gm;
  let match;
  while ((match = lineRe.exec(cleaned)) !== null) add(locs, match[1], match[2], match[2]);
  const fileRe = /([A-Za-z0-9_.\/-]+\.(?:go|mod|sum|json|yml|yaml|md|ts|tsx|js|jsx|py|rs|java|c|cc|cpp|h|hpp))(?::|#L|\s+line\s+)?(\d+)?/g;
  while ((match = fileRe.exec(cleaned)) !== null) add(locs, match[1], match[2] || 1, match[2] || 1);
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

const commands = [];
const locs = [];
const setup = run('codegraphcontext', ['--help'], { timeoutMs: 60000 });
commands.push(setup);
const index = run('codegraphcontext', ['index', '.'], { cwd: repo, timeoutMs: 1200000 });
commands.push(index);
const terms = ['metrics', 'prometheus', 'insights', 'startup', 'authorization', 'Bearer', 'token', 'header', 'authentication', 'subsonic'];
const queries = [];
for (const term of terms) {
  for (const args of [['find', 'content', term], ['find', 'pattern', term]]) {
    const result = run('codegraphcontext', args, { cwd: repo, timeoutMs: 180000 });
    commands.push(result);
    queries.push(result);
    collect(result.stdout, locs);
    collect(result.stderr, locs);
  }
}

for (const [i, command] of commands.entries()) {
  writeFileSync(join(outDir, `codegraphcontext-command-${i + 1}.json`), JSON.stringify({ ...command, stdout: command.stdout.slice(0, 200000), stderr: command.stderr.slice(0, 200000) }, null, 2));
}

const candidates = uniq(locs);
const readiness = {
  lane: 'codegraphcontext',
  ready: setup.status === 0 && index.status === 0 && commands.some((command) => command.status === 0) && candidates.length > 0,
  setupStatus: setup.status === 0 ? 'completed' : 'setup_failed',
  indexStatus: index.status === 0 ? 'completed' : 'index_failed',
  toolCallable: commands.some((command) => command.status === 0),
  candidateCount: candidates.length,
  setupIndex: {
    setupDurationMs: setup.durationMs,
    indexDurationMs: index.durationMs,
    queryDurationMs: durationOf(queries),
  },
  commands: commands.map((command) => ({ command: command.command, status: command.status, error: command.error, durationMs: command.durationMs })),
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
console.log('CONTEXTBENCH_CODEGRAPHCONTEXT_READINESS_JSON_START');
console.log(JSON.stringify(pack, null, 2));
console.log('CONTEXTBENCH_CODEGRAPHCONTEXT_READINESS_JSON_END');
if (!readiness.ready) process.exitCode = 1;
