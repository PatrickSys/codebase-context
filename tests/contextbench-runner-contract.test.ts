import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTEXTBENCH_TERMINAL_STATUSES,
  type ContextBenchLane,
  type ContextBenchLaneToolCard,
  type ContextBenchProtocol,
  type ContextBenchRunManifestRow,
  type ContextBenchTaskManifest
} from '../src/eval/contextbench-types.js';
import {
  appendManifestRow,
  buildManifestRow,
  buildRunId,
  createArtifactPathSet,
  hashJson,
  readManifestRows,
  writeJsonArtifact
} from '../src/eval/contextbench-artifacts.js';
import {
  classifyStructuredAnswer,
  parseStructuredAnswer
} from '../src/eval/contextbench-answer.js';
import correctionsFixture from './fixtures/contextbench-corrections.json';
import laneToolCardsFixture from './fixtures/contextbench-lane-tool-cards.json';
import lanesFixture from './fixtures/contextbench-lanes.json';
import manifestFixture from './fixtures/contextbench-task-manifest.json';
import protocolFixture from './fixtures/contextbench-benchmark-protocol.json';

type LaneToolCardsFixture = {
  protocolVersion: string;
  cards: ContextBenchLaneToolCard[];
};

type LanesFixture = {
  broadClaimLaneSet: string[];
  lanes: ContextBenchLane[];
  laneToolCardRequiredFields: string[];
};

const protocol = protocolFixture as ContextBenchProtocol;
const manifest = manifestFixture as ContextBenchTaskManifest;
const lanes = lanesFixture as LanesFixture;
const laneToolCards = laneToolCardsFixture as LaneToolCardsFixture;
const corrections = correctionsFixture as {
  policy: { anyFixtureChangeRequiresCorrection: boolean };
};

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'contextbench-runner-'));
}

describe('ContextBench Phase 38 runner contract', () => {
  it('keeps frozen task/protocol inputs read-only and correction-governed', () => {
    expect(protocol.claimAllowed).toBe(false);
    expect(protocol.benchmarkTarget.officialEvaluatorFirst).toBe(true);
    expect(manifest.tasks).toHaveLength(20);
    expect(manifest.manifest_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(manifest.no_lane_outputs_observed_attestation).toContain('No raw/native');
    expect(corrections.policy.anyFixtureChangeRequiresCorrection).toBe(true);
    expect(laneToolCards.protocolVersion).toBe(protocol.protocolVersion);
  });

  it('defines explicit lane cards for every required lane while only raw/native and codebase-context are Phase 38 executable', () => {
    const cardsByLane = new Map(laneToolCards.cards.map((card) => [card.laneId, card]));
    for (const laneId of lanes.broadClaimLaneSet) {
      expect(cardsByLane.has(laneId)).toBe(true);
    }
    expect(cardsByLane.get('raw-native')?.executableInPhase38).toBe(true);
    expect(cardsByLane.get('codebase-context')?.executableInPhase38).toBe(true);
    expect(cardsByLane.get('jcodemunch-repomapper')?.phase38Status).toBe('pending_phase39_setup');
    expect(cardsByLane.get('grepai')?.executableInPhase38).toBe(false);
  });

  it('enforces one-context-tool semantics and setup/index cost separation through lane cards', () => {
    for (const lane of lanes.lanes) {
      const card = laneToolCards.cards.find((candidate) => candidate.laneId === lane.laneId);
      expect(card).toBeTruthy();
      if (!card) continue;
      for (const field of lanes.laneToolCardRequiredFields) {
        expect(card[field as keyof ContextBenchLaneToolCard]).toBeTruthy();
      }
      expect(card.setupCostReportedSeparately).toBe(true);
      expect(card.indexCostReportedSeparately).toBe(true);
      expect(card.disallowedTools).not.toContain(lane.contextTool);
      if (lane.laneId === 'raw-native') {
        expect(card.contextTools).toEqual(['native-agent-tools']);
      } else {
        expect(card.contextTools).toEqual([lane.contextTool]);
        expect(card.allowedTools).toEqual([lane.contextTool]);
      }
    }
  });

  it('keeps every protocol terminal status represented in the typed contract', () => {
    expect(CONTEXTBENCH_TERMINAL_STATUSES).toEqual(protocol.runManifestSchema.terminalStatuses);
    expect(CONTEXTBENCH_TERMINAL_STATUSES).toEqual(
      expect.arrayContaining([
        'setup_failed',
        'index_failed',
        'invalid_schema',
        'false_ready',
        'judge_failed'
      ])
    );
  });

  it('validates structured answers and maps malformed answers to invalid_schema', () => {
    expect(parseStructuredAnswer('not json')).toMatchObject({ status: 'invalid_schema' });
    expect(parseStructuredAnswer(JSON.stringify({ answer: 'missing fields' }))).toMatchObject({
      status: 'invalid_schema'
    });
    const parsed = parseStructuredAnswer(
      JSON.stringify({
        answer: 'ready',
        confidence: 'medium',
        evidence: [
          { file: 'src/a.ts', lineRange: { start: 1, end: 2 }, reason: 'direct evidence' }
        ],
        filesReferenced: ['src/a.ts'],
        symbolsReferenced: [],
        unsupportedClaims: [],
        readyToEdit: false
      })
    );
    expect(parsed.status).toBe('valid');
  });

  it('rejects structured answer fields outside the frozen schema', () => {
    const validAnswer = {
      answer: 'ready',
      confidence: 'medium',
      evidence: [
        { file: 'src/a.ts', lineRange: { start: 1, end: 2 }, reason: 'direct evidence' }
      ],
      filesReferenced: ['src/a.ts'],
      symbolsReferenced: [],
      unsupportedClaims: [],
      readyToEdit: false
    };

    expect(parseStructuredAnswer(JSON.stringify({ ...validAnswer, extra: true }))).toMatchObject({
      status: 'invalid_schema',
      errors: expect.arrayContaining(['additional_root_field_extra'])
    });
    expect(
      parseStructuredAnswer(
        JSON.stringify({
          ...validAnswer,
          evidence: [{ ...validAnswer.evidence[0], extraEvidence: true }]
        })
      )
    ).toMatchObject({
      status: 'invalid_schema',
      errors: expect.arrayContaining(['additional_evidence_field_extraEvidence'])
    });
    expect(
      parseStructuredAnswer(
        JSON.stringify({
          ...validAnswer,
          evidence: [
            {
              ...validAnswer.evidence[0],
              lineRange: { ...validAnswer.evidence[0].lineRange, extraLine: true }
            }
          ]
        })
      )
    ).toMatchObject({
      status: 'invalid_schema',
      errors: expect.arrayContaining(['additional_line_range_field_extraLine'])
    });
  });

  it('classifies false-ready from deterministic diagnostics, not just model self-report', () => {
    const parsed = parseStructuredAnswer(
      JSON.stringify({
        answer: 'safe to edit',
        confidence: 'high',
        evidence: [
          { file: 'src/a.ts', lineRange: { start: 1, end: 2 }, reason: 'partial evidence' }
        ],
        filesReferenced: ['src/a.ts'],
        symbolsReferenced: [],
        unsupportedClaims: [],
        readyToEdit: true
      })
    );
    expect(parsed.answer).not.toBeNull();
    if (!parsed.answer) return;
    const classification = classifyStructuredAnswer(parsed.answer, {
      missingRequiredFacts: ['required fact absent'],
      missingEvidenceFiles: ['src/required.ts']
    });
    expect(classification.unsupportedClaim).toBe(true);
    expect(classification.falseReady).toBe(true);
    expect(classification.reasons).toEqual(
      expect.arrayContaining(['missing_required_facts', 'missing_evidence_files'])
    );
  });

  it('writes append-only manifest rows with artifact paths for attempted runs', () => {
    const outDir = tempDir();
    try {
      const runId = buildRunId({
        laneId: 'raw-native',
        taskId: manifest.tasks[0].instance_id,
        repeatIndex: 1,
        executor: 'fake'
      });
      const paths = createArtifactPathSet(outDir, runId);
      const laneCard = laneToolCards.cards[0];
      const task = manifest.tasks[0];
      writeJsonArtifact(paths.rawTracePath, { stdout: '{}', stderr: '' });
      writeJsonArtifact(paths.structuredAnswerPath, { answer: 'x' });
      writeJsonArtifact(paths.trajectoryPath, { pred_files: [] });
      writeJsonArtifact(paths.scorePath, { claimBearing: false });
      const setupIndex = {
        setupCommand: laneCard.setupCommand,
        indexCommand: laneCard.indexCommand,
        setupDurationMs: 12,
        indexDurationMs: 34,
        setupLogPath: paths.setupIndexPath,
        indexLogPath: paths.setupIndexPath,
        setupStatus: 'not_required' as const,
        indexStatus: 'not_required' as const
      };
      const row = buildManifestRow({
        runId,
        protocolVersion: protocol.protocolVersion,
        protocolHash: hashJson(protocol),
        taskManifestHash: manifest.manifest_hash,
        laneCard,
        task,
        repeatIndex: 1,
        status: 'completed',
        startedAt: '2026-04-27T00:00:00.000Z',
        completedAt: '2026-04-27T00:00:01.000Z',
        paths,
        setupIndex,
        hashes: { protocol: hashJson(protocol) },
        executor: 'fake',
        model: 'fake-executor',
        timeoutSeconds: protocol.budgets.defaults.timeoutSeconds,
        maxContextTokens: protocol.budgets.defaults.maxContextTokens,
        maxAnswerTokens: protocol.budgets.defaults.maxAnswerTokens
      });
      appendManifestRow(paths.manifestPath, row);
      appendManifestRow(paths.manifestPath, {
        ...row,
        run_id: `${runId}-2`,
        status: 'invalid_schema'
      });
      const rows = readManifestRows(paths.manifestPath);
      expect(rows).toHaveLength(2);
      expect(rows[1].status).toBe('invalid_schema');
      expect(rows[0].setupIndex.setupCommand).toBe(laneCard.setupCommand);
      expect(rows[0].setupIndex.setupDurationMs).toBe(12);
      expect(rows[0].setupIndex.indexDurationMs).toBe(34);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('validates fixtures and produces fake-executor smoke artifacts without live Claude', () => {
    const outDir = tempDir();
    try {
      const validateOutput = execFileSync(
        'node',
        ['scripts/contextbench-runner.mjs', '--validate-fixtures'],
        {
          encoding: 'utf8'
        }
      );
      expect(validateOutput).toContain('fixture validation passed');
      execFileSync(
        'node',
        [
          'scripts/contextbench-runner.mjs',
          '--dry-run',
          '--executor',
          'fake',
          '--lane',
          'raw-native',
          '--task-id',
          manifest.tasks[0].instance_id,
          '--repeat',
          '1',
          '--out',
          outDir
        ],
        { encoding: 'utf8' }
      );
      const manifestRows = readFileSync(path.join(outDir, 'run-manifest.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as ContextBenchRunManifestRow);
      expect(manifestRows).toHaveLength(1);
      expect(manifestRows[0]).toMatchObject({
        lane_id: 'raw-native',
        status: 'completed',
        task_id: manifest.tasks[0].instance_id
      });
      expect(readFileSync(manifestRows[0].raw_trace_path, 'utf8')).toContain('fake');
      expect(readFileSync(manifestRows[0].score_path, 'utf8')).toContain('claimBearing');
      expect(manifestRows[0].scoring.claimBearing).toBe(false);
      expect(manifestRows[0].scoring.officialEvaluatorFirst).toBe(false);
      expect(manifestRows[0].scoring.officialEvaluatorAttempted).toBe(false);
      expect(manifestRows[0].scoring.officialEvaluatorInvoked).toBe(false);
      expect(manifestRows).toHaveLength(1);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('exposes Phase 39 lane setup validation as readiness evidence only', () => {
    const validateOutput = execFileSync(
      'node',
      ['scripts/contextbench-runner.mjs', '--validate-lane-setup'],
      { encoding: 'utf8' }
    );
    expect(validateOutput).toContain('lane setup validation passed');

    const helpOutput = execFileSync('node', ['scripts/contextbench-runner.mjs', '--help'], {
      encoding: 'utf8'
    });
    expect(helpOutput).toContain('Phase 39 boundary');
    expect(helpOutput).toContain('Phase 40 owns dirty-worktree baseline capture');
    expect(helpOutput).toContain('claimBearing=false');
  });
});
