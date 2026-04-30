import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import manifestFixture from './fixtures/contextbench-task-manifest.json';

type ManifestRow = {
  run_id: string;
  lane_id: string;
  task_id: string;
  repeat_index: number;
  status: string;
  raw_trace_path: string;
  setupIndex: {
    setupStatus: string;
    indexStatus: string;
    setupDurationMs?: number;
    indexDurationMs?: number;
    setupLogPath?: string;
    indexLogPath?: string;
    taskWallTimeMs?: number;
  };
  taskExecution: { executor: string; taskWallTimeMs: number };
  hashes: { runnerSourceHash?: string };
  scoring: {
    claimBearing: boolean;
    fallbackReason?: string;
    officialEvaluatorFirst?: boolean;
    officialEvaluatorAttempted?: boolean;
    officialEvaluatorInvoked?: boolean;
    stdoutPath?: string;
    stderrPath?: string;
  };
};

type TaskManifest = { tasks: Array<{ instance_id: string }> };

const manifest = manifestFixture as TaskManifest;
vi.setConfig({ testTimeout: 30000 });

for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key];
}

function childEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  return { ...env, ...overrides };
}

function ignoreWindowsTempCleanupRace(error: unknown): void {
  const code = (error as NodeJS.ErrnoException).code;
  if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code ?? '')) throw error;
}

function cleanupSessionRoot(sessionRoot: string): void {
  try {
    rmSync(path.dirname(path.dirname(path.dirname(path.dirname(sessionRoot)))), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200
    });
  } catch (error) {
    ignoreWindowsTempCleanupRace(error);
  }
}

function tempSessionRoot(phase: 'phase40' | 'phase41' = 'phase40'): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), `contextbench-${phase}-runner-`)),
    'benchmark-runs',
    'contextbench',
    phase,
    'runner-smoke'
  );
}

function readRows(sessionRoot: string): ManifestRow[] {
  return readFileSync(path.join(sessionRoot, 'run-manifest.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ManifestRow);
}

function createCleanGitRepo(root: string): string {
  const repoPath = path.join(root, 'repo');
  mkdirSync(repoPath, { recursive: true });
  writeFileSync(path.join(repoPath, 'README.md'), '# ContextBench fixture\n', 'utf8');
  execFileSync('git', ['init'], { cwd: repoPath, encoding: 'utf8', env: childEnv() });
  execFileSync('git', ['add', 'README.md'], { cwd: repoPath, encoding: 'utf8', env: childEnv() });
  execFileSync(
    'git',
    ['-c', 'user.name=ContextBench Test', '-c', 'user.email=contextbench@example.invalid', 'commit', '-m', 'fixture'],
    { cwd: repoPath, encoding: 'utf8', env: childEnv() }
  );
  return repoPath;
}

function writePayloadFile(root: string, taskId: string, repoCheckoutPath: string): string {
  const payloadPath = path.join(root, 'TASK-PAYLOADS.json');
  writeFileSync(
    payloadPath,
    JSON.stringify(
      {
        tasksById: {
          [taskId]: {
            problem_statement: 'Use the fixture repository to answer with cited evidence.',
            repo_checkout_path: repoCheckoutPath
          }
        }
      },
      null,
      2
    ),
    'utf8'
  );
  return payloadPath;
}

function writeStubClaude(root: string): string {
  const stubPath = path.join(root, 'stub-claude.cjs');
  writeFileSync(
    stubPath,
    `const answer = { type: 'result', structured_output: { answer: 'fixture answer', confidence: 'medium', evidence: [{ file: 'README.md', lineRange: { start: 1, end: 1 }, reason: 'fixture evidence' }], filesReferenced: ['README.md'], symbolsReferenced: [], unsupportedClaims: [], readyToEdit: false } }; process.stdout.write(JSON.stringify(answer));`,
    'utf8'
  );
  return stubPath;
}

function writeStubEvaluator(root: string, exitCode: 0 | 1, output = JSON.stringify({ score: 1 })): string {
  const stubPath = path.join(root, `stub-evaluator-${exitCode}.cjs`);
  const serializedOutput = JSON.stringify(output);
  writeFileSync(
    stubPath,
    `const fs = require('node:fs'); const predIndex = process.argv.indexOf('--pred'); if (predIndex < 0 || !fs.existsSync(process.argv[predIndex + 1])) { process.stderr.write('missing prediction artifact'); process.exit(2); } const outIndex = process.argv.indexOf('--out'); if (outIndex >= 0 && process.argv[outIndex + 1] && ${exitCode} === 0) fs.writeFileSync(process.argv[outIndex + 1], ${serializedOutput} + '\\n'); process.stdout.write('official evaluator stub'); process.exit(${exitCode});`,
    'utf8'
  );
  return stubPath;
}

describe('ContextBench Phase 40 baseline runner', () => {
  it('reserves every required slot and writes terminal missing-evidence rows for blocked lanes', () => {
    const sessionRoot = tempSessionRoot();
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      const reservations = JSON.parse(
        readFileSync(path.join(sessionRoot, 'slot-reservations.json'), 'utf8')
      ) as { reservations: Array<{ laneId: string; status: string; terminalStatus: string | null }> };
      expect(reservations.reservations).toHaveLength(20 * 6 * 3);
      const blocked = reservations.reservations.filter((slot) => slot.status === 'terminal_missing_evidence');
      expect(blocked).toHaveLength(20 * 2 * 3);
      expect([...new Set(blocked.map((slot) => slot.laneId))].sort()).toEqual([
        'codebase-memory-mcp',
        'grepai'
      ]);
      expect(blocked.every((slot) => slot.terminalStatus === 'setup_failed')).toBe(true);

      const rows = readRows(sessionRoot);
      expect(rows.filter((row) => row.status === 'setup_failed')).toHaveLength(blocked.length);
      expect(rows.every((row) => row.scoring.claimBearing === false)).toBe(true);
      expect(rows.every((row) => row.scoring.officialEvaluatorFirst === false)).toBe(true);
      expect(rows.every((row) => row.scoring.officialEvaluatorAttempted === false)).toBe(true);
      expect(rows.every((row) => row.scoring.officialEvaluatorInvoked === false)).toBe(true);
      expect(rows.every((row) => !('taskWallTimeMs' in row.setupIndex))).toBe(true);
    } finally {
      cleanupSessionRoot(sessionRoot);
    }
  });

  it('rejects duplicate primary baseline rows during validation', () => {
    const sessionRoot = tempSessionRoot('phase41');
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      const firstRow = readFileSync(path.join(sessionRoot, 'run-manifest.jsonl'), 'utf8').trim().split('\n')[0];
      appendFileSync(path.join(sessionRoot, 'run-manifest.jsonl'), `${firstRow}\n`, 'utf8');

      const result = spawnSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-validate', '--session', sessionRoot],
        { encoding: 'utf8' }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('duplicate primary baseline row for reservation');
    } finally {
      rmSync(path.dirname(path.dirname(path.dirname(path.dirname(sessionRoot)))), {
        recursive: true,
        force: true
      });
    }
  });

  it('creates fake-executor baseline attempt artifacts without scripting agent decisions', () => {
    const sessionRoot = tempSessionRoot();
    const taskId = manifest.tasks[0].instance_id;
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'fake',
          '--lane',
          'raw-native',
          '--task-id',
          taskId,
          '--repeat',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const validateOutput = execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-validate', '--session', sessionRoot],
        { encoding: 'utf8' }
      );
      expect(validateOutput).toContain('baseline session validation passed');
      const rows = readRows(sessionRoot);
      const attempt = rows.find(
        (row) => row.lane_id === 'raw-native' && row.task_id === taskId && row.repeat_index === 1
      );
      expect(attempt).toBeTruthy();
      expect(attempt).toMatchObject({ status: 'completed', lane_id: 'raw-native' });
      expect(attempt?.taskExecution.executor).toBe('fake');
      expect(attempt?.setupIndex.setupStatus).toBe('not_required');
      expect(attempt?.scoring).toMatchObject({
        claimBearing: false,
        officialEvaluatorFirst: false,
        officialEvaluatorAttempted: false,
        officialEvaluatorInvoked: false
      });
      const rawTrace = JSON.parse(readFileSync(attempt?.raw_trace_path ?? '', 'utf8')) as {
        runnerHash?: string;
        laneIsolation?: { proven: boolean; proofSource: string; observedTools: string[] };
        scriptedAgentDecisions: boolean;
        antiScriptingBoundary: string[];
      };
      expect(rawTrace.runnerHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(attempt?.hashes.runnerSourceHash).toBe(rawTrace.runnerHash);
      expect(rawTrace.laneIsolation).toMatchObject({
        proven: false,
        proofSource: 'not_captured',
        observedTools: []
      });
      expect(rawTrace.scriptedAgentDecisions).toBe(false);
      expect(rawTrace.antiScriptingBoundary).toEqual(expect.arrayContaining(['file_selection']));
    } finally {
      cleanupSessionRoot(sessionRoot);
    }
  });

  it('records official evaluator invocation metadata for overridden live executor attempts', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'contextbench-official-evaluator-'));
    const sessionRoot = path.join(tempRoot, 'benchmark-runs', 'contextbench', 'phase41', 'runner-smoke');
    const taskId = manifest.tasks[0].instance_id;
    const repoPath = createCleanGitRepo(tempRoot);
    const payloadPath = writePayloadFile(tempRoot, taskId, repoPath);
    const stubClaude = writeStubClaude(tempRoot);
    const stubEvaluator = writeStubEvaluator(tempRoot, 0);
    const env = childEnv({
      CONTEXTBENCH_CLAUDE_COMMAND: JSON.stringify([process.execPath, stubClaude]),
      CONTEXTBENCH_OFFICIAL_EVALUATOR_COMMAND: JSON.stringify([process.execPath, stubEvaluator]),
      CONTEXTBENCH_LANE_TELEMETRY_JSON: JSON.stringify({
        'raw-native': { sourceKind: 'proxy', proofSource: 'stubbed_test_proxy', observedTools: ['native-read'] }
      })
    });
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8',
        env
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'claude',
          '--task-payloads',
          payloadPath,
          '--lane',
          'raw-native',
          '--task-id',
          taskId,
          '--repeat',
          '1'
        ],
        { encoding: 'utf8', env }
      );
      const rows = readRows(sessionRoot);
      const attempt = rows.find(
        (row) => row.lane_id === 'raw-native' && row.task_id === taskId && row.repeat_index === 1
      );
      expect(attempt?.status).toBe('completed');
      expect(attempt?.taskExecution.executor).toBe('claude');
      expect(attempt?.scoring).toMatchObject({
        claimBearing: false,
        officialEvaluatorFirst: true,
        officialEvaluatorAttempted: true,
        officialEvaluatorInvoked: true
      });
      expect(attempt?.scoring.command).toContain('--out');
      const score = JSON.parse(readFileSync(attempt?.score_path ?? '', 'utf8')) as {
        mode: string;
        exitCode?: number;
        outputHash?: string;
        stdoutPath?: string;
        stderrPath?: string;
      };
      expect(score.mode).toBe('official_evaluator');
      expect(score.exitCode).toBe(0);
      expect(score.outputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(score.stdoutPath).toBeTruthy();
      expect(score.stderrPath).toBeTruthy();
      const rawTrace = JSON.parse(readFileSync(attempt?.raw_trace_path ?? '', 'utf8')) as {
        laneIsolation?: { proven: boolean; sourceKind: string; proofSource: string; observedTools: string[] };
      };
      expect(rawTrace.laneIsolation).toMatchObject({
        proven: true,
        sourceKind: 'proxy',
        proofSource: 'stubbed_test_proxy',
        observedTools: ['native-read']
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects malformed official evaluator output as judge_failed diagnostic evidence', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'contextbench-official-evaluator-malformed-'));
    const sessionRoot = path.join(tempRoot, 'benchmark-runs', 'contextbench', 'phase41', 'runner-smoke');
    const taskId = manifest.tasks[0].instance_id;
    const repoPath = createCleanGitRepo(tempRoot);
    const payloadPath = writePayloadFile(tempRoot, taskId, repoPath);
    const stubClaude = writeStubClaude(tempRoot);
    const stubEvaluator = writeStubEvaluator(tempRoot, 0, 'not json');
    const env = childEnv({
      CONTEXTBENCH_CLAUDE_COMMAND: JSON.stringify([process.execPath, stubClaude]),
      CONTEXTBENCH_OFFICIAL_EVALUATOR_COMMAND: JSON.stringify([process.execPath, stubEvaluator]),
      CONTEXTBENCH_LANE_TELEMETRY_JSON: JSON.stringify({
        'raw-native': { sourceKind: 'proxy', proofSource: 'stubbed_test_proxy', observedTools: ['native-read'] }
      })
    });
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8',
        env
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'claude',
          '--task-payloads',
          payloadPath,
          '--lane',
          'raw-native',
          '--task-id',
          taskId,
          '--repeat',
          '1'
        ],
        { encoding: 'utf8', env }
      );
      const attempt = readRows(sessionRoot).find(
        (row) => row.lane_id === 'raw-native' && row.task_id === taskId && row.repeat_index === 1
      );
      expect(attempt?.status).toBe('judge_failed');
      expect(attempt?.scoring).toMatchObject({
        claimBearing: false,
        fallbackReason: 'official_evaluator_malformed_jsonl',
        officialEvaluatorAttempted: true,
        officialEvaluatorInvoked: true
      });
      const score = JSON.parse(readFileSync(attempt?.score_path ?? '', 'utf8')) as {
        mode: string;
        fallbackReason: string;
        outputHash?: string;
      };
      expect(score.mode).toBe('diagnostic_fallback');
      expect(score.fallbackReason).toBe('official_evaluator_malformed_jsonl');
      expect(score.outputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects non-object or wrong-task official evaluator JSONL as diagnostic evidence', () => {
    const cases = [
      { output: '1', reason: 'official_evaluator_non_object_jsonl' },
      {
        output: JSON.stringify({ instance_id: 'wrong-task-id', score: 1 }),
        reason: 'official_evaluator_task_mismatch'
      }
    ];

    for (const testCase of cases) {
      const tempRoot = mkdtempSync(path.join(tmpdir(), 'contextbench-official-evaluator-envelope-'));
      const sessionRoot = path.join(tempRoot, 'benchmark-runs', 'contextbench', 'phase41', 'runner-smoke');
      const taskId = manifest.tasks[0].instance_id;
      const repoPath = createCleanGitRepo(tempRoot);
      const payloadPath = writePayloadFile(tempRoot, taskId, repoPath);
      const stubClaude = writeStubClaude(tempRoot);
      const stubEvaluator = writeStubEvaluator(tempRoot, 0, testCase.output);
      const env = childEnv({
        CONTEXTBENCH_CLAUDE_COMMAND: JSON.stringify([process.execPath, stubClaude]),
        CONTEXTBENCH_OFFICIAL_EVALUATOR_COMMAND: JSON.stringify([process.execPath, stubEvaluator]),
        CONTEXTBENCH_LANE_TELEMETRY_JSON: JSON.stringify({
          'raw-native': { sourceKind: 'proxy', proofSource: 'stubbed_test_proxy', observedTools: ['native-read'] }
        })
      });
      try {
        execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
          encoding: 'utf8',
          env
        });
        execFileSync(
          'node',
          [
            'scripts/contextbench-runner.mjs',
            '--baseline-run',
            '--session',
            sessionRoot,
            '--executor',
            'claude',
            '--task-payloads',
            payloadPath,
            '--lane',
            'raw-native',
            '--task-id',
            taskId,
            '--repeat',
            '1'
          ],
          { encoding: 'utf8', env }
        );
        const attempt = readRows(sessionRoot).find(
          (row) => row.lane_id === 'raw-native' && row.task_id === taskId && row.repeat_index === 1
        );
        expect(attempt?.status).toBe('judge_failed');
        expect(attempt?.scoring.fallbackReason).toBe(testCase.reason);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('records official evaluator failure as judge_failed without making claims', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'contextbench-official-evaluator-fail-'));
    const sessionRoot = path.join(tempRoot, 'benchmark-runs', 'contextbench', 'phase41', 'runner-smoke');
    const taskId = manifest.tasks[0].instance_id;
    const repoPath = createCleanGitRepo(tempRoot);
    const payloadPath = writePayloadFile(tempRoot, taskId, repoPath);
    const stubClaude = writeStubClaude(tempRoot);
    const stubEvaluator = writeStubEvaluator(tempRoot, 1);
    const env = childEnv({
      CONTEXTBENCH_CLAUDE_COMMAND: JSON.stringify([process.execPath, stubClaude]),
      CONTEXTBENCH_OFFICIAL_EVALUATOR_COMMAND: JSON.stringify([process.execPath, stubEvaluator])
    });
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8',
        env
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'claude',
          '--task-payloads',
          payloadPath,
          '--lane',
          'raw-native',
          '--task-id',
          taskId,
          '--repeat',
          '1'
        ],
        { encoding: 'utf8', env }
      );
      const rows = readRows(sessionRoot);
      const attempt = rows.find(
        (row) => row.lane_id === 'raw-native' && row.task_id === taskId && row.repeat_index === 1
      );
      expect(attempt?.status).toBe('judge_failed');
      expect(attempt?.scoring).toMatchObject({
        claimBearing: false,
        fallbackReason: 'official_evaluator_missing_output',
        officialEvaluatorFirst: true,
        officialEvaluatorAttempted: true,
        officialEvaluatorInvoked: true
      });
      const score = JSON.parse(readFileSync(attempt?.score_path ?? '', 'utf8')) as {
        mode: string;
        claimBearing: boolean;
        exitCode: number;
        exitStatus: number;
      };
      expect(score.mode).toBe('diagnostic_fallback');
      expect(score.claimBearing).toBe(false);
      expect(score.exitCode).toBe(1);
      expect(score.exitStatus).toBe(1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('chunks all-ready-lane execution with max-attempts so live runs are resumable', () => {
    const sessionRoot = tempSessionRoot('phase41');
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'fake',
          '--all-ready-lanes',
          '--repeats',
          '3',
          '--max-attempts',
          '2'
        ],
        { encoding: 'utf8' }
      );
      const rows = readRows(sessionRoot);
      const attemptedRows = rows.filter(
        (row) => row.status === 'completed' && row.taskExecution.executor === 'fake'
      );
      expect(attemptedRows).toHaveLength(2);
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'fake',
          '--all-ready-lanes',
          '--repeats',
          '3',
          '--max-attempts',
          '2'
        ],
        { encoding: 'utf8' }
      );
      const resumedRows = readRows(sessionRoot).filter(
        (row) => row.status === 'completed' && row.taskExecution.executor === 'fake'
      );
      expect(resumedRows).toHaveLength(4);
      const session = JSON.parse(
        readFileSync(path.join(sessionRoot, 'BASELINE-SESSION.json'), 'utf8')
      ) as { phase: number };
      expect(session.phase).toBe(41);
    } finally {
      cleanupSessionRoot(sessionRoot);
    }
  });

  it('measures raw-native setup/index as a session artifact and reuses it in attempt rows', () => {
    const sessionRoot = tempSessionRoot('phase41');
    const taskId = manifest.tasks[0].instance_id;
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--setup-index-measure',
          '--session',
          sessionRoot,
          '--lane',
          'raw-native'
        ],
        { encoding: 'utf8' }
      );
      const measurement = JSON.parse(
        readFileSync(path.join(sessionRoot, 'setup-index', 'raw-native', 'setup-index.json'), 'utf8')
      ) as { claimBearing: boolean; setupStatus: string; indexStatus: string; setupLogPath: string };
      expect(measurement).toMatchObject({
        claimBearing: false,
        setupStatus: 'not_required',
        indexStatus: 'not_required'
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'fake',
          '--lane',
          'raw-native',
          '--task-id',
          taskId,
          '--repeat',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const attempt = readRows(sessionRoot).find(
        (row) => row.lane_id === 'raw-native' && row.task_id === taskId && row.repeat_index === 1
      );
      expect(attempt?.status).toBe('completed');
      expect(attempt?.setupIndex).toMatchObject({
        setupStatus: 'not_required',
        indexStatus: 'not_required',
        setupDurationMs: 0,
        indexDurationMs: 0,
        setupLogPath: measurement.setupLogPath
      });
    } finally {
      cleanupSessionRoot(sessionRoot);
    }
  });

  it('fails a ready non-raw lane closed when setup/index measurement is missing', () => {
    const sessionRoot = tempSessionRoot('phase41');
    const taskId = manifest.tasks[0].instance_id;
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'fake',
          '--lane',
          'codebase-context',
          '--task-id',
          taskId,
          '--repeat',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const attempt = readRows(sessionRoot).find(
        (row) => row.lane_id === 'codebase-context' && row.task_id === taskId && row.repeat_index === 1
      );
      expect(attempt?.status).toBe('setup_failed');
      expect(attempt?.scoring.fallbackReason).toContain('missing_setup_index_measurement');
      expect(attempt?.setupIndex.setupStatus).toBe('setup_failed');
    } finally {
      cleanupSessionRoot(sessionRoot);
    }
  });

  it('imports setup/index evidence for ready non-raw lanes before task execution', () => {
    const sessionRoot = tempSessionRoot('phase41');
    const taskId = manifest.tasks[0].instance_id;
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      const logsDir = path.join(sessionRoot, 'manual-setup-index-logs', 'codebase-context');
      mkdirSync(logsDir, { recursive: true });
      const setupLogPath = path.join(logsDir, 'setup.stdout.log');
      const indexLogPath = path.join(logsDir, 'index.stdout.log');
      writeFileSync(setupLogPath, 'setup completed\n', 'utf8');
      writeFileSync(indexLogPath, 'index completed\n', 'utf8');
      const importPath = path.join(path.dirname(sessionRoot), 'codebase-context-setup-index-import.json');
      writeFileSync(
        importPath,
        JSON.stringify(
          {
            laneId: 'codebase-context',
            claimBearing: false,
            setupStatus: 'completed',
            indexStatus: 'completed',
            setupDurationMs: 12,
            indexDurationMs: 34,
            setupLogPath,
            indexLogPath
          },
          null,
          2
        ),
        'utf8'
      );
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--setup-index-import',
          '--session',
          sessionRoot,
          '--lane',
          'codebase-context',
          '--input',
          importPath
        ],
        { encoding: 'utf8' }
      );
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'fake',
          '--lane',
          'codebase-context',
          '--task-id',
          taskId,
          '--repeat',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const attempt = readRows(sessionRoot).find(
        (row) => row.lane_id === 'codebase-context' && row.task_id === taskId && row.repeat_index === 1
      );
      expect(attempt?.status).toBe('completed');
      expect(attempt?.setupIndex).toMatchObject({
        setupStatus: 'completed',
        indexStatus: 'completed',
        setupDurationMs: 12,
        indexDurationMs: 34,
        setupLogPath,
        indexLogPath
      });
    } finally {
      cleanupSessionRoot(sessionRoot);
    }
  });

  it('rejects forged or failed setup/index imports before non-raw task execution', () => {
    const sessionRoot = tempSessionRoot('phase41');
    const taskId = manifest.tasks[0].instance_id;
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      const logsDir = path.join(sessionRoot, 'manual-setup-index-logs', 'codebase-context');
      mkdirSync(logsDir, { recursive: true });
      const setupLogPath = path.join(logsDir, 'setup.stdout.log');
      const indexLogPath = path.join(logsDir, 'index.stdout.log');
      writeFileSync(setupLogPath, 'setup failed\n', 'utf8');
      writeFileSync(indexLogPath, 'index skipped\n', 'utf8');
      const wrongLaneImport = path.join(path.dirname(sessionRoot), 'wrong-lane-import.json');
      writeFileSync(
        wrongLaneImport,
        JSON.stringify({
          laneId: 'raw-native',
          claimBearing: false,
          setupStatus: 'completed',
          indexStatus: 'completed',
          setupDurationMs: 1,
          indexDurationMs: 1,
          setupLogPath,
          indexLogPath
        }),
        'utf8'
      );
      const wrongLane = spawnSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--setup-index-import',
          '--session',
          sessionRoot,
          '--lane',
          'codebase-context',
          '--input',
          wrongLaneImport
        ],
        { encoding: 'utf8' }
      );
      expect(wrongLane.status).toBe(1);
      expect(wrongLane.stderr).toContain('laneId mismatch');

      const siblingDir = `${sessionRoot}-evil`;
      mkdirSync(siblingDir, { recursive: true });
      const siblingSetupLog = path.join(siblingDir, 'setup.stdout.log');
      const siblingIndexLog = path.join(siblingDir, 'index.stdout.log');
      writeFileSync(siblingSetupLog, 'setup forged\n', 'utf8');
      writeFileSync(siblingIndexLog, 'index forged\n', 'utf8');
      const outsideImport = path.join(path.dirname(sessionRoot), 'outside-import.json');
      writeFileSync(
        outsideImport,
        JSON.stringify({
          laneId: 'codebase-context',
          claimBearing: false,
          setupStatus: 'completed',
          indexStatus: 'completed',
          setupDurationMs: 1,
          indexDurationMs: 1,
          setupLogPath: siblingSetupLog,
          indexLogPath: siblingIndexLog
        }),
        'utf8'
      );
      const outside = spawnSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--setup-index-import',
          '--session',
          sessionRoot,
          '--lane',
          'codebase-context',
          '--input',
          outsideImport
        ],
        { encoding: 'utf8' }
      );
      expect(outside.status).toBe(1);
      expect(outside.stderr).toContain('inside session root');

      const failedImport = path.join(path.dirname(sessionRoot), 'failed-import.json');
      writeFileSync(
        failedImport,
        JSON.stringify({
          laneId: 'codebase-context',
          claimBearing: false,
          setupStatus: 'setup_failed',
          indexStatus: 'not_required',
          setupDurationMs: 0,
          indexDurationMs: 0,
          setupLogPath,
          indexLogPath
        }),
        'utf8'
      );
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--setup-index-import',
          '--session',
          sessionRoot,
          '--lane',
          'codebase-context',
          '--input',
          failedImport
        ],
        { encoding: 'utf8' }
      );
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'fake',
          '--lane',
          'codebase-context',
          '--task-id',
          taskId,
          '--repeat',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const attempt = readRows(sessionRoot).find(
        (row) => row.lane_id === 'codebase-context' && row.task_id === taskId && row.repeat_index === 1
      );
      expect(attempt?.status).toBe('setup_failed');
      expect(attempt?.scoring.fallbackReason).toContain('missing_setup_index_measurement');
    } finally {
      cleanupSessionRoot(sessionRoot);
    }
  });

  it('validates diagnostic codebase-context baseline arms as non-claim-bearing side evidence', () => {
    const output = execFileSync(
      'node',
      [
        'scripts/contextbench-runner.mjs',
        '--baseline-validate-arms',
        'tests/fixtures/contextbench-codebase-context-baseline-arms.json'
      ],
      { encoding: 'utf8' }
    );
    expect(output).toContain('baseline arm validation passed');
  });

  it('can record diagnostic codebase-context arm smoke rows separate from required reservations', () => {
    const sessionRoot = tempSessionRoot();
    const taskId = manifest.tasks[0].instance_id;
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run-codebase-context-arms',
          '--session',
          sessionRoot,
          '--executor',
          'fake',
          '--task-id',
          taskId,
          '--repeats',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const rows = readRows(sessionRoot);
      const diagnosticRows = rows.filter((row) => row.run_id.startsWith('codebase-context-current'));
      expect(diagnosticRows.length).toBeGreaterThanOrEqual(3);
      expect(diagnosticRows.every((row) => row.lane_id === 'codebase-context')).toBe(true);
      expect(diagnosticRows.every((row) => row.scoring.claimBearing === false)).toBe(true);
      const reservations = JSON.parse(
        readFileSync(path.join(sessionRoot, 'slot-reservations.json'), 'utf8')
      ) as { reservations: unknown[] };
      expect(reservations.reservations).toHaveLength(20 * 6 * 3);
    } finally {
      cleanupSessionRoot(sessionRoot);
    }
  });

  it('runs Phase 42 verification as read-only artifact-derived evidence and fails diagnostic sessions closed', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'contextbench-phase42-verify-'));
    const sessionRoot = path.join(tempRoot, 'benchmark-runs', 'contextbench', 'phase41', 'runner-smoke');
    const reportPath = path.join(tempRoot, 'phase42-report.json');
    const taskId = manifest.tasks[0].instance_id;
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'fake',
          '--lane',
          'raw-native',
          '--task-id',
          taskId,
          '--repeat',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const sessionBefore = readFileSync(path.join(sessionRoot, 'BASELINE-SESSION.json'), 'utf8');
      const result = spawnSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--phase42-verify',
          '--session',
          sessionRoot,
          '--out',
          reportPath,
          '--quiet'
        ],
        { encoding: 'utf8' }
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('phase42 verification failed');
      expect(result.stderr).toContain('phase42 verification failed');
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        claimPass: boolean;
        diagnosticOnly: boolean;
        protocolClaimAllowed: boolean;
        expectedTotalRows: number;
        requiredRows: number;
        supplementalRows: number;
        failureCounts: Record<string, number>;
        blockedClaims: string[];
      };
      expect(report).toMatchObject({
        claimPass: false,
        diagnosticOnly: true,
        protocolClaimAllowed: false,
        expectedTotalRows: 20 * 6 * 3,
        requiredRows: 20 * 2 * 3 + 1,
        supplementalRows: 0
      });
      expect(report.failureCounts.protocol_claims_disabled).toBe(1);
      expect(report.failureCounts.denominator_count_mismatch).toBe(1);
      expect(report.failureCounts.official_evaluator_missing).toBeGreaterThan(0);
      expect(report.failureCounts.missing_required_run).toBeGreaterThan(0);
      expect(report.blockedClaims).toContain('Phase 42 passed');
      expect(readFileSync(path.join(sessionRoot, 'BASELINE-SESSION.json'), 'utf8')).toBe(sessionBefore);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('classifies diagnostic baseline arms as supplemental during Phase 42 verification', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'contextbench-phase42-arms-'));
    const sessionRoot = path.join(tempRoot, 'benchmark-runs', 'contextbench', 'phase41', 'runner-smoke');
    const reportPath = path.join(tempRoot, 'phase42-report.json');
    const taskId = manifest.tasks[0].instance_id;
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run-codebase-context-arms',
          '--session',
          sessionRoot,
          '--executor',
          'fake',
          '--task-id',
          taskId,
          '--repeats',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const result = spawnSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--phase42-verify',
          '--session',
          sessionRoot,
          '--out',
          reportPath
        ],
        { encoding: 'utf8' }
      );
      expect(result.status).toBe(1);
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        requiredRows: number;
        supplementalRows: number;
        failureCounts: Record<string, number>;
      };
      expect(report.requiredRows).toBe(20 * 2 * 3);
      expect(report.supplementalRows).toBeGreaterThanOrEqual(3);
      expect(report.failureCounts.unexpected_run_row ?? 0).toBe(0);
      expect(report.failureCounts.denominator_count_mismatch).toBe(1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('blocks baseline seal when terminal row completeness lacks Phase 42 claim evidence', () => {
    const sessionRoot = tempSessionRoot('phase41');
    try {
      execFileSync('node', ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot], {
        encoding: 'utf8'
      });
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'fake',
          '--all-ready-lanes',
          '--repeats',
          '3'
        ],
        { encoding: 'utf8' }
      );
      expect(readRows(sessionRoot)).toHaveLength(20 * 6 * 3);

      const result = spawnSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-seal', '--session', sessionRoot],
        { encoding: 'utf8' }
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('baseline session validation passed');
      expect(result.stdout).toContain('phase42 verification failed');
      expect(result.stderr).toContain('baseline seal blocked by Phase 42 evidence gate');
    } finally {
      cleanupSessionRoot(sessionRoot);
    }
  });
});
