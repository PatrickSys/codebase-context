import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const targetTaskId = process.env.TARGET_TASK_ID || 'SWE-Bench-Pro__go__maintenance__bugfix__4df06349';
const root = process.env.ROOT || '/tmp/contextbench-ripgrep-readiness';
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
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || process.cwd(),
    env: opts.env || process.env,
    encoding: 'utf8',
    timeout: opts.timeoutMs || 300000,
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    command: [cmd, ...args].join(' '),
    cwd: opts.cwd || process.cwd(),
    status: typeof result.status === 'number' ? result.status : null,
    signal: result.signal,
    error: result.error?.message || null,
    durationMs: Date.now() - started,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function addCandidate(candidates, file, line, source, matchText = '') {
  const clean = String(file || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!clean || clean.startsWith('../') || clean.includes('://')) return;
  const n = Math.max(1, Number(line) || 1);
  const start = Math.max(1, n - 12);
  const end = n + 12;
  candidates.push({ file: clean, start, end, line: n, source, matchText: stripAnsi(matchText).trim().slice(0, 220) });
}

function parseRgJson(output, candidates, source) {
  for (const line of String(output || '').split(/\n+/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== 'match') continue;
    addCandidate(
      candidates,
      event.data?.path?.text,
      event.data?.line_number,
      source,
      event.data?.lines?.text || '',
    );
  }
}

function uniq(candidates, max = 500) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates) {
    const key = `${candidate.file}:${candidate.start}:${candidate.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= max) break;
  }
  return out;
}

const queries = [
  { id: 'metrics-startup', pattern: '(?i)prometheus|metrics|metric|insights|startup|start' },
  { id: 'auth-header-token', pattern: '(?i)authorization|bearer|token|header|subsonic|auth' },
  { id: 'write-collect-init', pattern: '(?i)collector|collect|write|init|server' },
];

const commands = [];
const candidates = [];
const install = run(
  'bash',
  ['-lc', 'command -v rg >/dev/null 2>&1 || (sudo apt-get update && sudo apt-get install -y ripgrep)'],
  { timeoutMs: 300000 },
);
commands.push(install);
const version = run('rg', ['--version'], { timeoutMs: 60000 });
commands.push(version);

for (const query of queries) {
  const result = run(
    'rg',
    [
      '--json',
      '-n',
      '--hidden',
      '--glob',
      '!.git/**',
      '--glob',
      '!vendor/**',
      '--glob',
      '!ui/**',
      '--glob',
      '*.go',
      query.pattern,
      '.',
    ],
    { cwd: repo, timeoutMs: 180000 },
  );
  commands.push(result);
  parseRgJson(result.stdout, candidates, `ripgrep-lexical:${query.id}`);
}

const uniqueCandidates = uniq(candidates);
const setupStatus = install.status === 0 && version.status === 0 ? 'completed' : 'setup_failed';
const queryCommands = commands.slice(2);
const toolCallable = queryCommands.some((command) => command.status === 0 || command.status === 1);
const queryOk = queryCommands.every((command) => command.status === 0 || command.status === 1);
const readiness = {
  lane: 'ripgrep-lexical',
  ready: setupStatus === 'completed' && toolCallable && queryOk && uniqueCandidates.length > 0,
  setupStatus,
  indexStatus: 'not_required',
  toolCallable,
  candidateCount: uniqueCandidates.length,
  setupIndex: {
    setupDurationMs: install.durationMs + version.durationMs,
    indexDurationMs: 0,
    queryDurationMs: queryCommands.reduce((sum, command) => sum + command.durationMs, 0),
  },
  notes: [
    'ripgrep-lexical is a no-index local lexical competitor; readiness requires rg callable plus non-empty real repo file/span candidates.',
    'rg exit code 1 means no matches for a query and is accepted only when at least one required query returns candidates.',
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
  candidates: uniqueCandidates,
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
  queries,
  readiness,
};

writeFileSync(join(outDir, 'ripgrep-candidate-pack.json'), JSON.stringify(pack, null, 2));
writeFileSync(join(outDir, 'ripgrep-readiness.json'), JSON.stringify(readiness, null, 2));
console.log('CONTEXTBENCH_RIPGREP_READY_JSON_START');
console.log(JSON.stringify(pack, null, 2));
console.log('CONTEXTBENCH_RIPGREP_READY_JSON_END');
if (!readiness.ready) process.exitCode = 1;
