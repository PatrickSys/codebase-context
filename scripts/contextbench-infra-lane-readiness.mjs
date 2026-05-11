import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const laneId = process.env.LANE_ID;
const targetTaskId = process.env.TARGET_TASK_ID || 'SWE-Bench-Pro__go__maintenance__bugfix__4df06349';
const root = process.env.ROOT || `/tmp/contextbench-infra-lane/${laneId || 'unknown'}`;
const outDir = join(root, 'pack');
const logsDir = join(root, 'logs');
const supportedLanes = ['grepai', 'codegraphcontext'];
if (!supportedLanes.includes(laneId)) throw new Error(`unsupported LANE_ID: ${laneId}`);
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

function add(locs, file, start = 1, end = start, source = 'tool') {
  const clean = norm(file);
  if (!clean) return;
  const s = Math.max(1, Number(start) || 1);
  locs.push({ file: clean, start: s, end: Math.max(s, Number(end) || s), source });
}

function jsonish(text) {
  const cleaned = stripAnsi(text).trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {}
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = cleaned.indexOf(open);
    const end = cleaned.lastIndexOf(close);
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {}
    }
  }
  return null;
}

function pathFromObject(value) {
  return value.file || value.path || value.file_path || value.filePath || value.relative_path || value.filename || value.source_path || value.uri || value.caller_file_path || value.called_file_path || value.importer_file_path || value.parent_file_path || value.child_file_path || value.class_file_path;
}

function startFromObject(value) {
  return value.start_line || value.startLine || value.line || value.line_number || value.start || value.caller_line_number || value.called_line_number || value.import_line_number || value.parent_line_number || value.child_line_number || value.function_line_number || 1;
}

function endFromObject(value) {
  return value.end_line || value.endLine || value.end || value.line || value.line_number || value.endLineNumber || startFromObject(value);
}

function walk(value, locs, source) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, locs, source);
    return;
  }
  add(locs, pathFromObject(value), startFromObject(value), endFromObject(value), source);
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

const relevantPathTerms = ['metrics', 'prometheus', 'auth', 'subsonic', 'root', 'header', 'token'];
function collectRelevantInventory(text, locs, source) {
  const inventory = [];
  collect(text, inventory, source);
  for (const loc of inventory) {
    const file = loc.file.toLowerCase();
    if (relevantPathTerms.some((term) => file.includes(term))) locs.push({ ...loc, source });
  }
}

function uniq(locs, max = 160) {
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
    writeFileSync(join(outDir, `${lane}-command-${i + 1}.json`), JSON.stringify({
      ...command,
      stdout: command.stdout.slice(0, 300000),
      stderr: command.stderr.slice(0, 300000),
    }, null, 2));
  }
}

function commandSummary(command) {
  return {
    command: command.command,
    status: command.status,
    signal: command.signal,
    error: command.error,
    durationMs: command.durationMs,
    stdoutExcerpt: stripAnsi(command.stdout).slice(0, 1200),
    stderrExcerpt: stripAnsi(command.stderr).slice(0, 1200),
  };
}

function laneResult(lane, commands, locs, setupStatus, indexStatus, setupIndex, notes = []) {
  writeCommands(lane, commands);
  const candidates = uniq(locs);
  return {
    lane,
    ready: setupStatus === 'completed' && indexStatus === 'completed' && commands.some((command) => command.status === 0) && candidates.length > 0,
    setupStatus,
    indexStatus,
    toolCallable: commands.some((command) => command.status === 0),
    candidateCount: candidates.length,
    setupIndex,
    notes,
    commands: commands.map(commandSummary),
    candidates,
  };
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

function runGrepai() {
  const commands = [];
  const locs = [];
  const env = { ...process.env, OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434' };
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
    echo 'grepai watch exited before readiness'
    tail -200 "$LOG" || true
    exit 1
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo 'grepai watch did not report readiness before timeout'
  tail -200 "$STATUSLOG" || true
  tail -200 "$LOG" || true
  kill -INT "$pid" 2>/dev/null || true
  wait "$pid" || true
  exit 1
fi
kill -INT "$pid" 2>/dev/null || true
for i in $(seq 1 60); do
  if ! kill -0 "$pid" 2>/dev/null; then
    break
  fi
  sleep 1
done
kill -TERM "$pid" 2>/dev/null || true
wait "$pid" || true
grepai status --no-ui || true
tail -200 "$STATUSLOG" || true
tail -200 "$LOG" || true
`;
  const index = run('bash', ['-lc', indexScript], { cwd: repo, env, timeoutMs: 900000 });
  commands.push(index);
  const searches = [];
  for (const q of queryVariants) {
    const search = run('grepai', ['search', q, '--json', '--compact', '--limit', '50'], { cwd: repo, env, timeoutMs: 240000 });
    commands.push(search);
    searches.push(search);
    collect(search.stdout, locs, 'grepai-search');
    collect(search.stderr, locs, 'grepai-search');
  }
  return laneResult('grepai', commands, locs, setup.status === 0 && ollama.status === 0 && init.status === 0 ? 'completed' : 'setup_failed', index.status === 0 && locs.length > 0 ? 'completed' : 'index_failed', {
    setupDurationMs: setup.durationMs + ollama.durationMs + init.durationMs,
    indexDurationMs: index.durationMs,
    queryDurationMs: durationOf(searches),
  }, ['Uses grepai foreground --no-ui indexing in CI because documented background mode can return failure before long initial scans finish.']);
}

function runCodeGraphContext() {
  const commands = [];
  const locs = [];
  const env = { ...process.env, DEFAULT_DATABASE: 'kuzudb', CGC_RUNTIME_DB_TYPE: 'kuzudb' };
  const setup = run('cgc', ['--version'], { env, timeoutMs: 60000 });
  commands.push(setup);
  const index = run('cgc', ['--database', 'kuzudb', 'index', '.', '--force'], { cwd: repo, env, timeoutMs: 1200000 });
  commands.push(index);
  const queries = [];
  const stats = run('cgc', ['--database', 'kuzudb', 'stats', '--all'], { cwd: repo, env, timeoutMs: 180000 });
  commands.push(stats);
  queries.push(stats);
  const fileInventory = run('cgc', ['--database', 'kuzudb', 'find', 'type', 'file'], { cwd: repo, env, timeoutMs: 180000 });
  commands.push(fileInventory);
  queries.push(fileInventory);
  collectRelevantInventory(fileInventory.stdout, locs, 'codegraphcontext-file-inventory-filtered');
  collectRelevantInventory(fileInventory.stderr, locs, 'codegraphcontext-file-inventory-filtered');
  for (const term of ['metrics', 'prometheus', 'authorization', 'bearer', 'token', 'header', 'subsonic', 'startup']) {
    for (const mode of ['pattern', 'content']) {
      const found = run('cgc', ['--database', 'kuzudb', 'find', mode, term], { cwd: repo, env, timeoutMs: 180000 });
      commands.push(found);
      queries.push(found);
      collect(found.stdout, locs, `codegraphcontext-${mode}-${term}`);
      collect(found.stderr, locs, `codegraphcontext-${mode}-${term}`);
    }
  }
  const py = `
import json
from codegraphcontext.core.database import DatabaseManager
from codegraphcontext.tools.code_finder import CodeFinder
terms = ['metrics','prometheus','authorization','bearer','token','header','subsonic','startup']
functions = ['init','main','ServeHTTP','getUser','authenticate','Prometheus','WriteInitialMetrics']
db = DatabaseManager()
cf = CodeFinder(db)
out = {'files': cf.find_by_type('file', 1000), 'content': {}, 'related': {}, 'functions': {}}
for term in terms:
    try:
        out['content'][term] = cf.find_by_content(term)
    except Exception as exc:
        out['content'][term] = {'error': str(exc)}
    try:
        out['related'][term] = cf.find_related_code(term, True, 2)
    except Exception as exc:
        out['related'][term] = {'error': str(exc)}
for fn in functions:
    try:
        out['functions'][fn] = cf.find_by_function_name(fn, True)
    except Exception as exc:
        out['functions'][fn] = {'error': str(exc)}
print(json.dumps(out))
db.close_driver()
`;
  const api = run('python', ['-c', py], { cwd: repo, env, timeoutMs: 300000 });
  commands.push(api);
  queries.push(api);
  collect(api.stdout, locs, 'codegraphcontext-codefinder');
  collect(api.stderr, locs, 'codegraphcontext-codefinder');
  return laneResult('codegraphcontext', commands, locs, setup.status === 0 ? 'completed' : 'setup_failed', index.status === 0 && locs.length > 0 ? 'completed' : 'index_failed', {
    setupDurationMs: setup.durationMs,
    indexDurationMs: index.durationMs,
    queryDurationMs: durationOf(queries),
  }, ['Uses documented cgc find/query surface plus CodeFinder API; avoids raw Cypher against backend-specific driver wrappers.']);
}

const result = laneId === 'grepai' ? runGrepai() : runCodeGraphContext();
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
console.log('CONTEXTBENCH_INFRA_LANE_READINESS_JSON_START');
console.log(JSON.stringify(pack, null, 2));
console.log('CONTEXTBENCH_INFRA_LANE_READINESS_JSON_END');
if (!result.ready) process.exitCode = 1;
