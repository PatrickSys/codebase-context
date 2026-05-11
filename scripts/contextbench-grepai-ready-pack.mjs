import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const targetTaskId = process.env.TARGET_TASK_ID || 'SWE-Bench-Pro__go__maintenance__bugfix__4df06349';
const root = process.env.ROOT || '/tmp/contextbench-grepai-readiness';
const outDir = join(root, 'pack');
const logsDir = join(root, 'logs');
mkdirSync(outDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });

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

function add(locs, file, start = 1, end = start, source = 'grepai-search') {
  const clean = norm(file);
  if (!clean) return;
  const s = Math.max(1, Number(start) || 1);
  locs.push({ file: clean, start: s, end: Math.max(s, Number(end) || s), source });
}

function jsonish(text) {
  const cleaned = stripAnsi(text).trim();
  if (!cleaned) return null;
  try { return JSON.parse(cleaned); } catch {}
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = cleaned.indexOf(open);
    const end = cleaned.lastIndexOf(close);
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
    }
  }
  return null;
}

function pathFromObject(value) {
  return value.file || value.path || value.file_path || value.filePath || value.relative_path || value.filename || value.source_path || value.uri;
}

function walk(value, locs, source) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, locs, source);
    return;
  }
  add(locs, pathFromObject(value), value.start_line || value.startLine || value.line || value.start || 1, value.end_line || value.endLine || value.end || value.line || 1, source);
  for (const item of Object.values(value)) walk(item, locs, source);
}

function collect(text, locs, source) {
  const cleaned = stripAnsi(text);
  const parsed = jsonish(cleaned);
  if (parsed) walk(parsed, locs, source);
  const lineMatch = /^(.+?\.(?:go|mod|sum|json|yml|yaml|md|ts|tsx|js|jsx|py|rs|java|c|cc|cpp|h|hpp|rb|php|cs|kt|swift|vue|svelte)):(\d+)(?:-(\d+))?/gm;
  let m;
  while ((m = lineMatch.exec(cleaned)) !== null) add(locs, m[1], m[2], m[3] || m[2], source);
  const fileMatch = /([A-Za-z0-9_.\/-]+\.(?:go|mod|sum|json|yml|yaml|md|ts|tsx|js|jsx|py|rs|java|c|cc|cpp|h|hpp|rb|php|cs|kt|swift|vue|svelte))(?::|#L|\s+line\s+)?(\d+)?(?:-(\d+))?/g;
  while ((m = fileMatch.exec(cleaned)) !== null) add(locs, m[1], m[2] || 1, m[3] || m[2] || 1, source);
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

function queryOf(text) {
  const stop = new Set(['that', 'this', 'with', 'from', 'when', 'then', 'into', 'should', 'would', 'could', 'there', 'where', 'which', 'about', 'after', 'before', 'have', 'will', 'been', 'than', 'also', 'only', 'some', 'using', 'must']);
  return String(text || '')
    .replace(/[`*_#>\[\](){},.;:!?/\\]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w.toLowerCase()))
    .slice(0, 24)
    .join(' ');
}

const queryVariants = [
  queryOf(task.problem_statement),
  'system metrics written on start prometheus writer insights',
  'Bearer token custom authorization header authentication',
  'Subsonic authorization header token parsing',
  'startup metrics insights prometheus initialization',
];

const env = { ...process.env, OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434' };
const commands = [];
const locs = [];
const setup = run('grepai', ['version'], { env, timeoutMs: 60000 });
commands.push(setup);
const ollama = run('ollama', ['list'], { env, timeoutMs: 60000 });
commands.push(ollama);
const init = run('grepai', ['init', '--yes', '--provider', 'ollama', '--model', 'nomic-embed-text', '--backend', 'gob'], { cwd: repo, env, timeoutMs: 120000 });
commands.push(init);

const indexScript = `
set -euo pipefail
LOG=${JSON.stringify(join(logsDir, 'grepai-watch-no-ui.log'))}
STATUSLOG=${JSON.stringify(join(logsDir, 'grepai-status-loop.log'))}
: > "$LOG"
: > "$STATUSLOG"
grepai watch --no-ui > "$LOG" 2>&1 &
pid=$!
ready=0
for i in $(seq 1 180); do
  status="$(grepai status --no-ui 2>&1 || true)"
  printf -- '--- status attempt %s ---\n%s\n' "$i" "$status" >> "$STATUSLOG"
  if printf -- '%s\n' "$status" | grep -Eiq 'Files indexed:[[:space:]]*[1-9][0-9]*|Total chunks:[[:space:]]*[1-9][0-9]*|[1-9][0-9]* chunks created|[1-9][0-9]* files indexed'; then
    ready=1
    break
  fi
  if grep -Eiq 'Initial scan complete|[1-9][0-9]* files indexed|[1-9][0-9]* chunks created' "$LOG"; then
    ready=1
    break
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo 'grepai watch exited before textual readiness; search will be used as the functional readiness proof'
    tail -200 "$LOG" || true
    exit 2
  fi
  sleep 2
done
kill -INT "$pid" 2>/dev/null || true
for i in $(seq 1 30); do
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  sleep 1
done
kill -TERM "$pid" 2>/dev/null || true
wait "$pid" || true
grepai status --no-ui || true
tail -200 "$STATUSLOG" || true
tail -200 "$LOG" || true
if [ "$ready" -ne 1 ]; then exit 2; fi
`;
const index = run('bash', ['-lc', indexScript], { cwd: repo, env, timeoutMs: 600000 });
commands.push(index);

const searches = [];
for (const q of queryVariants) {
  const search = run('grepai', ['search', q, '--json', '--compact', '--limit', '50'], { cwd: repo, env, timeoutMs: 240000 });
  commands.push(search);
  searches.push(search);
  collect(search.stdout, locs, 'grepai-search');
  collect(search.stderr, locs, 'grepai-search');
}

const candidates = uniq(locs);
const setupStatus = setup.status === 0 && ollama.status === 0 && init.status === 0 ? 'completed' : 'setup_failed';
const searchSucceeded = searches.some((command) => command.status === 0);
const indexFunctional = index.status === 0 || (searchSucceeded && candidates.length > 0);
const setupIndex = {
  setupDurationMs: setup.durationMs + ollama.durationMs + init.durationMs,
  indexDurationMs: index.durationMs,
  queryDurationMs: searches.reduce((sum, command) => sum + command.durationMs, 0),
};
const notes = [
  'Readiness requires setup, callable grepai search, and non-empty candidate spans/files from real repo queries.',
];
if (index.status !== 0 && indexFunctional) {
  notes.push(`grepai watch exited with status ${index.status}; readiness accepts the lane because subsequent grepai search returned ${candidates.length} repo locations from the persisted index.`);
}

const readiness = {
  lane: 'grepai',
  ready: setupStatus === 'completed' && indexFunctional && searchSucceeded && candidates.length > 0,
  setupStatus,
  indexStatus: indexFunctional ? 'completed' : 'index_failed',
  toolCallable: searchSucceeded,
  candidateCount: candidates.length,
  setupIndex,
  notes,
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
  queryVariants,
  readiness,
};

writeFileSync(join(outDir, 'grepai-candidate-pack.json'), JSON.stringify(pack, null, 2));
writeFileSync(join(outDir, 'grepai-readiness.json'), JSON.stringify(readiness, null, 2));
console.log('CONTEXTBENCH_GREPAI_READY_JSON_START');
console.log(JSON.stringify(pack, null, 2));
console.log('CONTEXTBENCH_GREPAI_READY_JSON_END');
if (!readiness.ready) process.exitCode = 1;
