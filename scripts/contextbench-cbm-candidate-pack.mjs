import { spawnSync } from 'node:child_process';
import { basename, join, relative } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = process.env.ROOT;
const outDir = join(root, 'pack');
mkdirSync(outDir, { recursive: true });

const payloads = JSON.parse(readFileSync(process.env.TASK_PAYLOADS, 'utf8'));
const task = payloads.tasks[2];
const repo = task.repo_checkout_path;

function run(cmd, args, opts = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || process.cwd(),
    env: opts.env || process.env,
    encoding: 'utf8',
    timeout: opts.timeoutMs || 600000,
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    command: [cmd, ...args].join(' '),
    cwd: opts.cwd || process.cwd(),
    status: r.status,
    signal: r.signal,
    error: r.error?.message || null,
    durationMs: Date.now() - started,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function queryOf(text) {
  const stop = new Set([
    'that', 'this', 'with', 'from', 'when', 'then', 'into', 'should',
    'would', 'could', 'there', 'where', 'which', 'about', 'after',
    'before', 'have', 'will', 'been', 'than', 'also', 'only', 'some',
    'using', 'must', 'method', 'methods', 'function', 'interface',
  ]);
  return String(text || '')
    .replace(/[`*_#>\[\](){},.;:!?/\\]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w.toLowerCase()))
    .slice(0, 18)
    .join(' ');
}

function jsonish(s) {
  const t = String(s || '').trim();
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
  let f = String(file || '').replace(/^file:\/\//, '').replaceAll('\\', '/');
  if (!f) return '';
  if (f.startsWith(repo)) f = relative(repo, f).replaceAll('\\', '/');
  f = f.replace(/^\/+/, '').replace(/^\.\//, '');
  if (
    !f ||
    f.includes('://') ||
    f.includes('..') ||
    f.startsWith('tmp-contextbench') ||
    f.includes('/tmp-contextbench')
  ) {
    return '';
  }
  if (!existsSync(join(repo, f))) return '';
  return f;
}

function add(locs, file, start = 1, end = start, source = 'codebase-memory-mcp') {
  const clean = norm(file);
  if (!clean) return;
  const s = Math.max(1, Number(start) || 1);
  locs.push({ file: clean, start: s, end: Math.max(s, Number(end) || s), source });
}

function walk(value, locs) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, locs);
    return;
  }
  add(
    locs,
    value.file || value.path || value.file_path || value.relative_path || value.filename || value.source_path || value.uri,
    value.start_line || value.startLine || value.line || value.line_number || value.start || 1,
    value.end_line || value.endLine || value.end || value.line || 1,
  );
  for (const item of Object.values(value)) walk(item, locs);
}

function collect(text, locs) {
  const parsed = jsonish(text);
  if (parsed) walk(parsed, locs);
  const re = /([A-Za-z0-9_.\/-]+\.(?:go|mod|sum|json|yml|yaml|md|ts|tsx|js|jsx|py|rs|java|c|cc|cpp|h|hpp))(?::|#L|\s+line\s+)?(\d+)?/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) add(locs, m[1], m[2] || 1, m[2] || 1);
}

function uniq(locs, max = 100) {
  const seen = new Set();
  const out = [];
  for (const loc of locs) {
    const key = `${loc.file}:${loc.start}:${loc.end}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(loc);
      if (out.length >= max) break;
    }
  }
  return out;
}

const query = queryOf(task.problem_statement);
const env = { ...process.env, CBM_CACHE_DIR: join(outDir, 'cbm-cache'), CBM_DIAGNOSTICS: '1' };
const setup = run(process.env.CBM_BIN, ['--version'], { env, timeoutMs: 60000 });
const index = run(process.env.CBM_BIN, ['cli', 'index_repository', JSON.stringify({ repo_path: repo })], {
  cwd: repo,
  env,
  timeoutMs: 2700000,
});
const project = (jsonish(index.stdout) || jsonish(index.stderr) || {}).project || basename(repo);
const graph = run(process.env.CBM_BIN, ['cli', 'search_graph', JSON.stringify({ project, query, limit: 60 })], {
  cwd: repo,
  env,
  timeoutMs: 120000,
});
const code = run(
  process.env.CBM_BIN,
  ['cli', 'search_code', JSON.stringify({ project, pattern: query.split(/\s+/)[0] || '.', mode: 'compact', limit: 60 })],
  { cwd: repo, env, timeoutMs: 120000 },
);

for (const [name, value] of Object.entries({ setup, index, graph, code })) {
  writeFileSync(
    join(outDir, `${name}.json`),
    JSON.stringify({ ...value, stdout: value.stdout.slice(0, 120000), stderr: value.stderr.slice(0, 120000) }, null, 2),
  );
}

const locs = [];
for (const r of [graph, code]) {
  collect(r.stdout, locs);
  collect(r.stderr, locs);
}
const candidates = uniq(locs);
const pack = {
  task: {
    instance_id: task.instance_id,
    repo: task.repo,
    base_commit: task.base_commit,
    problem_statement: task.problem_statement,
  },
  query,
  lane: {
    lane: 'codebase-memory-mcp',
    setupStatus: setup.status === 0 ? 'completed' : 'setup_failed',
    indexStatus: index.status === 0 ? 'completed' : 'index_failed',
    toolCallable: graph.status === 0 || code.status === 0,
    candidateCount: candidates.length,
    setupIndex: {
      setupDurationMs: setup.durationMs,
      indexDurationMs: index.durationMs,
      queryDurationMs: graph.durationMs + code.durationMs,
    },
    candidates,
  },
};

writeFileSync(join(outDir, 'cbm-candidate-pack.json'), JSON.stringify(pack, null, 2));
console.log('CBM_CANDIDATE_PACK_JSON_START');
console.log(JSON.stringify(pack, null, 2));
console.log('CBM_CANDIDATE_PACK_JSON_END');
