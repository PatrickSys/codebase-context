import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA,
  CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS,
  parseStructuredAnswer
} from '../src/eval/contextbench-answer.js';
import manifestFixture from './fixtures/contextbench-task-manifest.json';

type ManifestRow = {
  run_id: string;
  status: string;
  raw_trace_path: string;
  structured_answer_path: string;
  trajectory_path: string;
  scoring: { claimBearing: boolean };
  taskExecution: { model: string; executor: string };
};

type TaskManifest = { tasks: Array<{ instance_id: string; base_commit: string }> };

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

function normalizeFilesystemPath(filePath: string): string {
  return realpathSync(filePath);
}

function tempSessionRoot(phase: 'phase40' | 'phase41' = 'phase40'): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), `contextbench-${phase}-schema-gate-`)),
    'benchmark-runs',
    'contextbench',
    phase,
    'schema-gate-smoke'
  );
}

function readRows(sessionRoot: string): ManifestRow[] {
  return readFileSync(path.join(sessionRoot, 'run-manifest.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ManifestRow);
}

function createClaudeStub(
  stdout: string,
  capture?: { cwdPath?: string; stdinPath?: string }
): { stubDir: string; env: NodeJS.ProcessEnv } {
  const stubDir = mkdtempSync(path.join(tmpdir(), 'contextbench-claude-stub-'));
  const stubScript = path.join(stubDir, 'claude-stub.cjs');
  writeFileSync(
    stubScript,
    [
      "const fs = require('node:fs');",
      "if (process.env.CLAUDE_STUB_CWD_PATH) fs.writeFileSync(process.env.CLAUDE_STUB_CWD_PATH, process.cwd(), 'utf8');",
      "let stdin = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { stdin += chunk; });",
      "process.stdin.on('end', () => {",
      "  if (process.env.CLAUDE_STUB_STDIN_PATH) fs.writeFileSync(process.env.CLAUDE_STUB_STDIN_PATH, stdin, 'utf8');",
      "  process.stdout.write(process.env.CLAUDE_STUB_STDOUT || '');",
      '});',
      'process.stdin.resume();'
    ].join('\n'),
    'utf8'
  );
  writeFileSync(
    path.join(stubDir, 'claude.cmd'),
    '@echo off\r\nnode "%~dp0claude-stub.cjs"\r\n',
    'utf8'
  );
  const shellStub = path.join(stubDir, 'claude');
  writeFileSync(shellStub, '#!/bin/sh\nnode "$(dirname "$0")/claude-stub.cjs"\n', 'utf8');
  chmodSync(shellStub, 0o755);
  return {
    stubDir,
    env: childEnv({
      PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ''}`,
      Path: `${stubDir}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ''}`,
      CONTEXTBENCH_CLAUDE_COMMAND: JSON.stringify([process.execPath, stubScript]),
      CLAUDE_STUB_STDOUT: stdout,
      CLAUDE_STUB_CWD_PATH: capture?.cwdPath,
      CLAUDE_STUB_STDIN_PATH: capture?.stdinPath
    })
  };
}

function writeTaskPayloads(
  filePath: string,
  taskId: string,
  payload: Record<string, unknown>
): void {
  writeFileSync(
    filePath,
    `${JSON.stringify({ tasks: [{ instance_id: taskId, ...payload }] }, null, 2)}\n`,
    'utf8'
  );
}

function createGitCheckout(): string {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'contextbench-task-repo-'));
  execFileSync('git', ['init'], { cwd: repoPath, encoding: 'utf8', env: childEnv() });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=ContextBench Test',
      '-c',
      'user.email=contextbench@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'init'
    ],
    { cwd: repoPath, encoding: 'utf8', env: childEnv() }
  );
  return repoPath;
}

function structuredStubAnswer(): Record<string, unknown> {
  return {
    answer: { adapterSmoke: true },
    confidence: 'medium',
    evidence: [
      { file: 'README.md', lineRange: { start: 1, end: 1 }, reason: 'stubbed adapter evidence' }
    ],
    filesReferenced: ['README.md'],
    symbolsReferenced: [],
    unsupportedClaims: [],
    readyToEdit: false
  };
}

function createAdapterStub(
  executor: 'codex' | 'gemini' | 'opencode',
  capture?: { cwdPath?: string; argsPath?: string }
): { stubDir: string; env: NodeJS.ProcessEnv } {
  const stubDir = mkdtempSync(path.join(tmpdir(), `contextbench-${executor}-stub-`));
  const stubScript = path.join(stubDir, `${executor}-stub.cjs`);
  writeFileSync(
    stubScript,
    [
      "const fs = require('node:fs');",
      'const executor = process.env.ADAPTER_STUB_EXECUTOR;',
      'const args = process.argv.slice(2);',
      "if (process.env.ADAPTER_STUB_CWD_PATH) fs.writeFileSync(process.env.ADAPTER_STUB_CWD_PATH, process.cwd(), 'utf8');",
      "if (process.env.ADAPTER_STUB_ARGS_PATH) fs.writeFileSync(process.env.ADAPTER_STUB_ARGS_PATH, JSON.stringify(args), 'utf8');",
      `const answer = ${JSON.stringify(JSON.stringify(structuredStubAnswer()))};`,
      "if (executor === 'codex') {",
      "  const outputIndex = args.indexOf('--output-last-message');",
      "  if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], answer, 'utf8');",
      "  process.stdout.write(JSON.stringify({ type: 'done' }) + '\\n');",
      "} else if (executor === 'gemini') {",
      '  process.stdout.write(JSON.stringify({ response: answer }));',
      "} else if (executor === 'opencode') {",
      "  process.stdout.write(JSON.stringify({ type: 'text', part: { type: 'text', text: answer } }) + '\\n');",
      '} else {',
      "  process.stderr.write('unknown adapter stub executor');",
      '  process.exitCode = 2;',
      '}'
    ].join('\n'),
    'utf8'
  );
  return {
    stubDir,
    env: childEnv({
      [`CONTEXTBENCH_${executor.toUpperCase()}_COMMAND`]: JSON.stringify([
        process.execPath,
        stubScript
      ]),
      ADAPTER_STUB_EXECUTOR: executor,
      ADAPTER_STUB_CWD_PATH: capture?.cwdPath,
      ADAPTER_STUB_ARGS_PATH: capture?.argsPath
    })
  };
}

describe('ContextBench Phase 40 schema gate', () => {
  it('exports the structured answer schema used to constrain live Claude output', () => {
    expect(CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: [...CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS]
    });
    expect(CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA.properties?.confidence).toMatchObject({
      type: 'string',
      enum: ['low', 'medium', 'high']
    });
    expect(CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA.properties?.evidence).toMatchObject({
      type: 'array'
    });
    const evidenceSchema = CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA.properties?.evidence;
    const evidenceItems = Array.isArray(evidenceSchema?.items)
      ? evidenceSchema.items[0]
      : evidenceSchema?.items;
    expect(evidenceItems).toMatchObject({ additionalProperties: false });
    expect(evidenceItems?.properties?.lineRange).toMatchObject({ additionalProperties: false });
  });

  it('passes the shared schema through Claude CLI arguments without running a live call', () => {
    const output = execFileSync(
      'node',
      ['scripts/contextbench-runner.mjs', '--print-claude-args', '--model', 'haiku'],
      { encoding: 'utf8' }
    );
    const args = JSON.parse(output) as string[];
    const schemaIndex = args.indexOf('--json-schema');
    expect(args).toEqual(
      expect.arrayContaining([
        '--print',
        '--output-format',
        'json',
        '--model',
        'haiku',
        '--json-schema'
      ])
    );
    expect(schemaIndex).toBeGreaterThan(-1);
    const schema = JSON.parse(args[schemaIndex + 1] ?? '{}') as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toEqual([...CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS]);
    expect(schema.properties).toHaveProperty('readyToEdit');
  });

  it('keeps invalid structured output terminal instead of repairing prose into success', () => {
    const sessionRoot = tempSessionRoot();
    const taskId = manifest.tasks[0].instance_id;
    try {
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot],
        {
          encoding: 'utf8'
        }
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
          '--fake-answer-mode',
          'invalid_schema',
          '--lane',
          'raw-native',
          '--task-id',
          taskId,
          '--repeat',
          '1',
          '--max-attempts',
          '1'
        ],
        { encoding: 'utf8' }
      );
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-validate', '--session', sessionRoot],
        {
          encoding: 'utf8'
        }
      );

      const row = readRows(sessionRoot).find(
        (candidate) =>
          candidate.status === 'invalid_schema' && candidate.scoring.claimBearing === false
      );
      expect(row).toBeTruthy();
      const rawTrace = JSON.parse(readFileSync(row?.raw_trace_path ?? '', 'utf8')) as {
        structuredAnswerParseErrors: string[];
      };
      expect(rawTrace.structuredAnswerParseErrors).toContain('invalid_json');
      const fallbackAnswer = JSON.parse(
        readFileSync(row?.structured_answer_path ?? '', 'utf8')
      ) as {
        unsupportedClaims: string[];
      };
      expect(fallbackAnswer.unsupportedClaims).toContain('missing_or_invalid_structured_answer');
    } finally {
      cleanupSessionRoot(sessionRoot);
    }
  });

  it('accepts Claude JSON envelope structured_output without a paid live call', () => {
    const sessionRoot = tempSessionRoot();
    const taskId = manifest.tasks[0].instance_id;
    const repoPath = createGitCheckout();
    const payloadDir = mkdtempSync(path.join(tmpdir(), 'contextbench-task-payloads-'));
    const payloadPath = path.join(payloadDir, 'task-payloads.json');
    const cwdCapturePath = path.join(payloadDir, 'claude-cwd.txt');
    const stdinCapturePath = path.join(payloadDir, 'claude-stdin.txt');
    const answer = {
      answer: 'ok',
      confidence: 'medium',
      evidence: [{ file: 'src/a.ts', lineRange: { start: 1, end: 1 }, reason: 'stubbed evidence' }],
      filesReferenced: ['src/a.ts'],
      symbolsReferenced: [],
      unsupportedClaims: [],
      readyToEdit: false
    };
    writeTaskPayloads(payloadPath, taskId, {
      problem_statement: 'Fix the failing ContextBench task without using hidden gold context.',
      repo_checkout_path: repoPath
    });
    const { stubDir, env } = createClaudeStub(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        structured_output: answer
      }),
      { cwdPath: cwdCapturePath, stdinPath: stdinCapturePath }
    );
    try {
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot],
        {
          encoding: 'utf8'
        }
      );
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'claude',
          '--model',
          'haiku',
          '--lane',
          'raw-native',
          '--task-id',
          taskId,
          '--repeat',
          '1',
          '--task-payloads',
          payloadPath,
          '--max-attempts',
          '1'
        ],
        { encoding: 'utf8', env }
      );
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-validate', '--session', sessionRoot],
        {
          encoding: 'utf8'
        }
      );
      const row = readRows(sessionRoot).find((candidate) => candidate.run_id.endsWith('-claude'));
      expect(row).toMatchObject({ status: 'completed' });
      const rawTrace = JSON.parse(readFileSync(row?.raw_trace_path ?? '', 'utf8')) as {
        structuredAnswerParseErrors: string[];
        claudeArgs: string[];
      };
      expect(rawTrace.structuredAnswerParseErrors).toEqual([]);
      expect(rawTrace.claudeArgs).toEqual(expect.arrayContaining(['--output-format', 'json']));
      expect(rawTrace.workingDirectory).toBe(repoPath);
      expect(rawTrace.taskContext).toMatchObject({
        materialized: true,
        repoCheckoutPath: repoPath,
        verificationStrict: false
      });
      expect(normalizeFilesystemPath(readFileSync(cwdCapturePath, 'utf8'))).toBe(
        normalizeFilesystemPath(repoPath)
      );
      const stdin = readFileSync(stdinCapturePath, 'utf8');
      expect(stdin).toContain('Problem statement:');
      expect(stdin).toContain('Fix the failing ContextBench task');
      expect(stdin).not.toContain('dataset_field:problem_statement');
      const structuredAnswer = JSON.parse(
        readFileSync(row?.structured_answer_path ?? '', 'utf8')
      ) as {
        answer: string;
      };
      expect(structuredAnswer.answer).toBe('ok');
      const trajectory = JSON.parse(readFileSync(row?.trajectory_path ?? '', 'utf8')) as {
        traj_data: { pred_files: string[] };
      };
      expect(trajectory.traj_data.pred_files).toContain('src/a.ts');
    } finally {
      cleanupSessionRoot(sessionRoot);
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(payloadDir, { recursive: true, force: true });
      rmSync(stubDir, { recursive: true, force: true });
    }
  });

  it('rejects Claude structured_output with fields outside the frozen schema', () => {
    const sessionRoot = tempSessionRoot();
    const taskId = manifest.tasks[0].instance_id;
    const repoPath = createGitCheckout();
    const payloadDir = mkdtempSync(path.join(tmpdir(), 'contextbench-task-payloads-'));
    const payloadPath = path.join(payloadDir, 'task-payloads.json');
    const answer = { ...structuredStubAnswer(), unexpectedRoot: true };
    writeTaskPayloads(payloadPath, taskId, {
      problem_statement: 'Reject schema drift from the executor output.',
      repo_checkout_path: repoPath
    });
    const { stubDir, env } = createClaudeStub(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        structured_output: answer
      })
    );
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
          'claude',
          '--model',
          'haiku',
          '--lane',
          'raw-native',
          '--task-id',
          taskId,
          '--repeat',
          '1',
          '--task-payloads',
          payloadPath,
          '--max-attempts',
          '1'
        ],
        { encoding: 'utf8', env }
      );
      const row = readRows(sessionRoot).find((candidate) => candidate.run_id.endsWith('-claude'));
      expect(row).toMatchObject({ status: 'invalid_schema' });
      const rawTrace = JSON.parse(readFileSync(row?.raw_trace_path ?? '', 'utf8')) as {
        structuredAnswerParseErrors: string[];
      };
      expect(rawTrace.structuredAnswerParseErrors).toEqual(
        expect.arrayContaining(['additional_root_field_unexpectedRoot'])
      );
    } finally {
      cleanupSessionRoot(sessionRoot);
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(payloadDir, { recursive: true, force: true });
      rmSync(stubDir, { recursive: true, force: true });
    }
  });

  it('blocks a real executor slot before spawn when task payloads are missing', () => {
    const sessionRoot = tempSessionRoot('phase41');
    const taskId = manifest.tasks[0].instance_id;
    try {
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot],
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
          'claude',
          '--model',
          'haiku',
          '--lane',
          'raw-native',
          '--task-id',
          taskId,
          '--repeat',
          '1',
          '--max-attempts',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const row = readRows(sessionRoot).find((candidate) => candidate.run_id.endsWith('-claude'));
      expect(row).toMatchObject({ status: 'task_setup_failed' });
      const rawTrace = JSON.parse(readFileSync(row?.raw_trace_path ?? '', 'utf8')) as {
        exitStatus: number | null;
        taskContext: { errors: string[]; materialized: boolean };
      };
      expect(rawTrace.exitStatus).toBeNull();
      expect(rawTrace.taskContext.materialized).toBe(false);
      expect(rawTrace.taskContext.errors).toEqual(
        expect.arrayContaining([
          'missing_task_payload',
          'missing_problem_statement',
          'missing_repo_checkout_path'
        ])
      );
    } finally {
      cleanupSessionRoot(sessionRoot);
    }
  });

  it('runs Codex, Gemini, and OpenCode adapters through the materialized task gate without paid calls', () => {
    const sessionRoot = tempSessionRoot();
    const taskId = manifest.tasks[0].instance_id;
    const repoPath = createGitCheckout();
    const payloadDir = mkdtempSync(path.join(tmpdir(), 'contextbench-task-payloads-'));
    const payloadPath = path.join(payloadDir, 'adapter-task-payloads.json');
    const stubs: string[] = [];
    try {
      writeTaskPayloads(payloadPath, taskId, {
        problem_statement: 'Fix the adapter smoke task with materialized input.',
        repo_checkout_path: repoPath
      });
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot],
        { encoding: 'utf8' }
      );
      const executors = ['codex', 'gemini', 'opencode'] as const;
      for (const [index, executor] of executors.entries()) {
        const cwdPath = path.join(payloadDir, `${executor}-cwd.txt`);
        const argsPath = path.join(payloadDir, `${executor}-args.json`);
        const { stubDir, env } = createAdapterStub(executor, { cwdPath, argsPath });
        stubs.push(stubDir);
        execFileSync(
          'node',
          [
            'scripts/contextbench-runner.mjs',
            '--baseline-run',
            '--session',
            sessionRoot,
            '--executor',
            executor,
            '--model',
            'stub',
            '--lane',
            'raw-native',
            '--task-id',
            taskId,
            '--repeat',
            String(index + 1),
            '--task-payloads',
            payloadPath,
            '--max-attempts',
            '1',
            '--timeout-ms',
            '60000'
          ],
          { encoding: 'utf8', env }
        );
        expect(normalizeFilesystemPath(readFileSync(cwdPath, 'utf8'))).toBe(
          normalizeFilesystemPath(repoPath)
        );
      }
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-validate', '--session', sessionRoot],
        { encoding: 'utf8' }
      );
      const rows = readRows(sessionRoot).filter((row) =>
        executors.some((executor) => row.run_id.endsWith(`-${executor}`))
      );
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.status).toBe('completed');
        const rawTrace = JSON.parse(readFileSync(row.raw_trace_path, 'utf8')) as {
          executor: string;
          model: string;
          executorSchemaMode: string;
          executorArgs: string[];
          taskContext: { materialized: boolean; verificationStrict: boolean };
          structuredAnswerParseErrors: string[];
        };
        expect(rawTrace.model).toBe('stub');
        expect(rawTrace.model).toBe(row.taskExecution.model);
        expect(rawTrace.executor).toBe(row.taskExecution.executor);
        expect(rawTrace.taskContext).toMatchObject({
          materialized: true,
          verificationStrict: false
        });
        expect(rawTrace.structuredAnswerParseErrors).toEqual([]);
        if (rawTrace.executor === 'codex') {
          expect(rawTrace.executorSchemaMode).toBe('native_schema');
          expect(rawTrace.executorArgs).toEqual(expect.arrayContaining(['--output-schema']));
        } else {
          expect(rawTrace.executorSchemaMode).toBe('prompt_only');
        }
      }
    } finally {
      cleanupSessionRoot(sessionRoot);
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(payloadDir, { recursive: true, force: true });
      for (const stubDir of stubs) rmSync(stubDir, { recursive: true, force: true });
    }
  });

  it('runs diagnostic codebase-context arms through the materialized task gate', () => {
    const sessionRoot = tempSessionRoot('phase41');
    const taskId = manifest.tasks[0].instance_id;
    const repoPath = createGitCheckout();
    const payloadDir = mkdtempSync(path.join(tmpdir(), 'contextbench-task-payloads-'));
    const payloadPath = path.join(payloadDir, 'arm-task-payloads.json');
    const cwdCapturePath = path.join(payloadDir, 'arm-claude-cwd.txt');
    const stdinCapturePath = path.join(payloadDir, 'arm-claude-stdin.txt');
    const { stubDir, env } = createClaudeStub(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        structured_output: structuredStubAnswer()
      }),
      { cwdPath: cwdCapturePath, stdinPath: stdinCapturePath }
    );
    try {
      writeTaskPayloads(payloadPath, taskId, {
        problem_statement: 'Run the diagnostic arm with materialized task text.',
        repo_checkout_path: repoPath
      });
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot],
        { encoding: 'utf8' }
      );
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run-codebase-context-arms',
          '--session',
          sessionRoot,
          '--executor',
          'claude',
          '--model',
          'haiku',
          '--task-id',
          taskId,
          '--repeats',
          '1',
          '--max-attempts',
          '1',
          '--task-payloads',
          payloadPath
        ],
        { encoding: 'utf8', env }
      );
      const row = readRows(sessionRoot).find(
        (candidate) => candidate.scoring && 'baselineArmId' in candidate.scoring
      );
      expect(row).toMatchObject({ status: 'completed' });
      expect(normalizeFilesystemPath(readFileSync(cwdCapturePath, 'utf8'))).toBe(
        normalizeFilesystemPath(repoPath)
      );
      const stdin = readFileSync(stdinCapturePath, 'utf8');
      expect(stdin).toContain('Problem statement:');
      expect(stdin).toContain('Run the diagnostic arm with materialized task text.');
      const rawTrace = JSON.parse(readFileSync(row?.raw_trace_path ?? '', 'utf8')) as {
        taskContext: { materialized: boolean; repoCheckoutPath: string };
      };
      expect(rawTrace.taskContext).toMatchObject({
        materialized: true,
        repoCheckoutPath: repoPath
      });
    } finally {
      cleanupSessionRoot(sessionRoot);
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(payloadDir, { recursive: true, force: true });
      rmSync(stubDir, { recursive: true, force: true });
    }
  });

  it('blocks a real executor slot before spawn when repo checkout is missing or at the wrong commit', () => {
    const missingSessionRoot = tempSessionRoot();
    const wrongCommitSessionRoot = tempSessionRoot();
    const task = manifest.tasks[0];
    const payloadDir = mkdtempSync(path.join(tmpdir(), 'contextbench-task-payloads-'));
    const missingPayloadPath = path.join(payloadDir, 'missing-repo.json');
    const wrongCommitPayloadPath = path.join(payloadDir, 'wrong-commit.json');
    const wrongCommitRepo = createGitCheckout();
    try {
      writeTaskPayloads(missingPayloadPath, task.instance_id, {
        problem_statement: 'Problem text exists but the checkout does not.',
        repo_checkout_path: path.join(payloadDir, 'does-not-exist')
      });
      writeTaskPayloads(wrongCommitPayloadPath, task.instance_id, {
        problem_statement: 'Problem text exists but the checkout commit is wrong.',
        repo_checkout_path: wrongCommitRepo
      });
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', missingSessionRoot],
        { encoding: 'utf8' }
      );
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          missingSessionRoot,
          '--executor',
          'claude',
          '--model',
          'haiku',
          '--lane',
          'raw-native',
          '--task-id',
          task.instance_id,
          '--repeat',
          '1',
          '--task-payloads',
          missingPayloadPath,
          '--max-attempts',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const missingRow = readRows(missingSessionRoot).find((candidate) =>
        candidate.run_id.endsWith('-claude')
      );
      const missingTrace = JSON.parse(readFileSync(missingRow?.raw_trace_path ?? '', 'utf8')) as {
        taskContext: { errors: string[] };
      };
      expect(missingRow).toMatchObject({ status: 'task_setup_failed' });
      expect(missingTrace.taskContext.errors).toContain('repo_checkout_missing');

      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', wrongCommitSessionRoot],
        { encoding: 'utf8' }
      );
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          wrongCommitSessionRoot,
          '--executor',
          'claude',
          '--model',
          'haiku',
          '--lane',
          'raw-native',
          '--task-id',
          task.instance_id,
          '--repeat',
          '1',
          '--task-payloads',
          wrongCommitPayloadPath,
          '--max-attempts',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const wrongCommitRow = readRows(wrongCommitSessionRoot).find((candidate) =>
        candidate.run_id.endsWith('-claude')
      );
      const wrongCommitTrace = JSON.parse(
        readFileSync(wrongCommitRow?.raw_trace_path ?? '', 'utf8')
      ) as {
        taskContext: { errors: string[]; verificationStrict: boolean };
      };
      expect(wrongCommitRow).toMatchObject({ status: 'task_setup_failed' });
      expect(wrongCommitTrace.taskContext.verificationStrict).toBe(true);
      expect(wrongCommitTrace.taskContext.errors).toEqual(
        expect.arrayContaining(['base_commit_mismatch', 'problem_statement_hash_mismatch'])
      );
    } finally {
      rmSync(path.dirname(path.dirname(path.dirname(path.dirname(missingSessionRoot)))), {
        recursive: true,
        force: true
      });
      rmSync(path.dirname(path.dirname(path.dirname(path.dirname(wrongCommitSessionRoot)))), {
        recursive: true,
        force: true
      });
      rmSync(payloadDir, { recursive: true, force: true });
      rmSync(wrongCommitRepo, { recursive: true, force: true });
    }
  });

  it('blocks a real executor slot before spawn when the repo checkout is dirty', () => {
    const sessionRoot = tempSessionRoot('phase41');
    const task = manifest.tasks[0];
    const payloadDir = mkdtempSync(path.join(tmpdir(), 'contextbench-task-payloads-'));
    const payloadPath = path.join(payloadDir, 'dirty-repo.json');
    const dirtyRepo = createGitCheckout();
    try {
      writeFileSync(path.join(dirtyRepo, 'dirty.txt'), 'dirty checkout', 'utf8');
      writeTaskPayloads(payloadPath, task.instance_id, {
        problem_statement: 'Problem text exists but the checkout has local changes.',
        repo_checkout_path: dirtyRepo
      });
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot],
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
          'claude',
          '--model',
          'haiku',
          '--lane',
          'raw-native',
          '--task-id',
          task.instance_id,
          '--repeat',
          '1',
          '--task-payloads',
          payloadPath,
          '--max-attempts',
          '1'
        ],
        { encoding: 'utf8' }
      );
      const row = readRows(sessionRoot).find((candidate) => candidate.run_id.endsWith('-claude'));
      const rawTrace = JSON.parse(readFileSync(row?.raw_trace_path ?? '', 'utf8')) as {
        taskContext: { errors: string[]; statusShort: string };
      };
      expect(row).toMatchObject({ status: 'task_setup_failed' });
      expect(rawTrace.taskContext.errors).toContain('repo_checkout_dirty');
      expect(rawTrace.taskContext.statusShort).toContain('dirty.txt');
    } finally {
      cleanupSessionRoot(sessionRoot);
      rmSync(payloadDir, { recursive: true, force: true });
      rmSync(dirtyRepo, { recursive: true, force: true });
    }
  });

  it('records Claude CLI rate limits as tool errors, not answer schema failures', () => {
    const sessionRoot = tempSessionRoot();
    const taskId = manifest.tasks[0].instance_id;
    const repoPath = createGitCheckout();
    const payloadDir = mkdtempSync(path.join(tmpdir(), 'contextbench-task-payloads-'));
    const payloadPath = path.join(payloadDir, 'task-payloads-rate-limit.json');
    writeTaskPayloads(payloadPath, taskId, {
      problem_statement: 'Fix the task; this test exercises rate-limit classification.',
      repo_checkout_path: repoPath
    });
    const { stubDir, env } = createClaudeStub(
      "You've hit your limit · resets 8pm (Europe/Madrid)\n"
    );
    try {
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-snapshot', '--out', sessionRoot],
        {
          encoding: 'utf8'
        }
      );
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--baseline-run',
          '--session',
          sessionRoot,
          '--executor',
          'claude',
          '--model',
          'haiku',
          '--lane',
          'raw-native',
          '--task-id',
          taskId,
          '--repeat',
          '1',
          '--task-payloads',
          payloadPath,
          '--max-attempts',
          '1'
        ],
        { encoding: 'utf8', env }
      );
      execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--baseline-validate', '--session', sessionRoot],
        {
          encoding: 'utf8'
        }
      );
      const row = readRows(sessionRoot).find((candidate) => candidate.run_id.endsWith('-claude'));
      expect(row).toMatchObject({ status: 'tool_error' });
      const rawTrace = JSON.parse(readFileSync(row?.raw_trace_path ?? '', 'utf8')) as {
        claudeDiagnostic: string;
        structuredAnswerParseErrors: string[];
      };
      expect(rawTrace.claudeDiagnostic).toBe('claude_rate_limit');
      expect(rawTrace.structuredAnswerParseErrors).toEqual(['invalid_json', 'claude_rate_limit']);
      const fallbackAnswer = JSON.parse(
        readFileSync(row?.structured_answer_path ?? '', 'utf8')
      ) as {
        unsupportedClaims: string[];
      };
      expect(fallbackAnswer.unsupportedClaims).toContain('missing_or_invalid_structured_answer');
    } finally {
      cleanupSessionRoot(sessionRoot);
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(payloadDir, { recursive: true, force: true });
      rmSync(stubDir, { recursive: true, force: true });
    }
  });

  it('uses the same required fields for parser validation', () => {
    const invalid = Object.fromEntries(
      CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS.filter((field) => field !== 'readyToEdit').map(
        (field) => [field, field === 'evidence' ? [] : field === 'confidence' ? 'medium' : []]
      )
    );
    const parsed = parseStructuredAnswer(JSON.stringify(invalid));
    expect(parsed).toMatchObject({ status: 'invalid_schema' });
    expect(parsed.errors).toContain('missing_readyToEdit');
  });
});
