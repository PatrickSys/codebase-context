import { describe, expect, it } from 'vitest';
import {
  CONTEXTBENCH_LANE_READINESS_STATUSES,
  type ContextBenchLane,
  type ContextBenchLaneSetupEvidenceFixture,
  type ContextBenchLaneSetupEvidenceRecord,
  type ContextBenchLaneToolCard
} from '../src/eval/contextbench-types.js';
import { hashSetupEvidenceRecord } from '../src/eval/contextbench-artifacts.js';
import laneSetupEvidenceFixture from './fixtures/contextbench-lane-setup-evidence.json';
import laneToolCardsFixture from './fixtures/contextbench-lane-tool-cards.json';
import lanesFixture from './fixtures/contextbench-lanes.json';
import packageJson from '../package.json';
import protocolFixture from './fixtures/contextbench-benchmark-protocol.json';

type LanesFixture = {
  broadClaimLaneSet: string[];
  lanes: ContextBenchLane[];
  setupFailureSemantics: {
    winEligible: boolean;
    claimContribution: string;
    includedInPublicationRows: boolean;
    blocksBroadClaimsForRequiredLane: boolean;
  };
};

type LaneToolCardsFixture = {
  cards: ContextBenchLaneToolCard[];
};

type PackageFixture = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const lanes = lanesFixture as LanesFixture;
const laneToolCards = laneToolCardsFixture as LaneToolCardsFixture;
const setupEvidence = laneSetupEvidenceFixture as ContextBenchLaneSetupEvidenceFixture;
const packageFixture = packageJson as PackageFixture;
const blockedStatuses = new Set(['setup_failed', 'index_failed', 'tool_error', 'invasive_setup_blocked']);

function byLane<T extends { laneId: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.laneId, item]));
}

function hasPendingPlaceholder(card: ContextBenchLaneToolCard): boolean {
  return [card.setupCommand, card.indexCommand, card.queryCommand, card.versionCommand].some((command) =>
    command.toLowerCase().includes('pending phase 39')
  );
}

function expectTerminalBlockedRecord(record: ContextBenchLaneSetupEvidenceRecord): void {
  expect(blockedStatuses.has(record.readinessStatus)).toBe(true);
  expect(record.logReference).toMatch(/^outputs\/contextbench\/setup\//);
  expect(record.nextHumanAction.length).toBeGreaterThan(20);
  expect(record.commands.some((command) => command.status === 'blocked' || command.status === 'failed')).toBe(true);
  expect(record.commands.some((command) => command.stdoutLogPath || command.stderrLogPath || command.outputHash)).toBe(true);
}

describe('ContextBench Phase 39 lane setup evidence', () => {
  it('covers every required lane with a final non-pending readiness record', () => {
    const evidenceByLane = byLane(setupEvidence.records);
    const cardsByLane = byLane(laneToolCards.cards);

    for (const laneId of lanes.broadClaimLaneSet) {
      const record = evidenceByLane.get(laneId);
      const card = cardsByLane.get(laneId);
      expect(record, `missing setup evidence for ${laneId}`).toBeTruthy();
      expect(card, `missing lane card for ${laneId}`).toBeTruthy();
      if (!record || !card) continue;
      expect(record.readinessStatus).not.toBe('pending');
      expect(CONTEXTBENCH_LANE_READINESS_STATUSES).toContain(record.readinessStatus);
      expect(card.phase39Status).toBe(record.readinessStatus);
      expect(record.claimBearing).toBe(false);
      expect(record.commands.map((command) => command.kind).sort()).toEqual([
        'index',
        'query',
        'setup',
        'version'
      ]);
    }
  });

  it('rejects unresolved Phase 39 placeholders unless there is terminal blocker evidence', () => {
    const evidenceByLane = byLane(setupEvidence.records);
    for (const card of laneToolCards.cards) {
      const record = evidenceByLane.get(card.laneId);
      expect(record).toBeTruthy();
      if (!record) continue;
      if (hasPendingPlaceholder(card)) {
        expectTerminalBlockedRecord(record);
      }
      expect(hasPendingPlaceholder(card)).toBe(false);
    }
  });

  it('keeps setup/index cost and status separate from task execution metadata', () => {
    for (const record of setupEvidence.records) {
      expect(record.setupStatus).toBeTruthy();
      expect(record.indexStatus).toBeTruthy();
      expect(record).not.toHaveProperty('taskWallTimeMs');
      expect(record.commands.every((command) => command.durationMs === null || command.durationMs >= 0)).toBe(true);
      expect(record.setupDurationMs === null || record.setupDurationMs >= 0).toBe(true);
      expect(record.indexDurationMs === null || record.indexDurationMs >= 0).toBe(true);
    }
  });

  it('records blocked and failed lanes as terminal missing evidence, not wins', () => {
    expect(lanes.setupFailureSemantics.winEligible).toBe(false);
    expect(lanes.setupFailureSemantics.claimContribution).toBe('missing_evidence');
    expect(lanes.setupFailureSemantics.includedInPublicationRows).toBe(true);
    expect(lanes.setupFailureSemantics.blocksBroadClaimsForRequiredLane).toBe(true);

    const blockedRecords = setupEvidence.records.filter((record) => blockedStatuses.has(record.readinessStatus));
    expect(blockedRecords.map((record) => record.laneId).sort()).toEqual([
      'codebase-memory-mcp',
      'grepai'
    ]);
    for (const record of blockedRecords) expectTerminalBlockedRecord(record);
  });

  it('preserves one-context-tool isolation for non-raw lanes', () => {
    const cardsByLane = byLane(laneToolCards.cards);
    for (const lane of lanes.lanes) {
      const card = cardsByLane.get(lane.laneId);
      expect(card).toBeTruthy();
      if (!card || lane.laneId === 'raw-native') continue;
      expect(card.contextTools).toEqual([lane.contextTool]);
      expect(card.allowedTools).toEqual([lane.contextTool]);
      expect(card.disallowedTools).toEqual(expect.arrayContaining(['native-read', 'native-search', 'native-shell-readonly']));
    }
  });

  it('keeps competitor tools out of package runtime dependencies', () => {
    const runtimeDependencies = Object.keys(packageFixture.dependencies ?? {});
    const devDependencies = Object.keys(packageFixture.devDependencies ?? {});
    const forbiddenPackages = ['jcodemunch-mcp', 'grepai', 'codebase-memory-mcp', 'codegraphcontext', 'kuzu'];
    for (const dependencyName of [...runtimeDependencies, ...devDependencies]) {
      expect(forbiddenPackages).not.toContain(dependencyName.toLowerCase());
    }
  });

  it('keeps Phase 39 setup/probe evidence non-claim-bearing', () => {
    expect(protocolFixture.claimAllowed).toBe(false);
    expect(setupEvidence.claimBearing).toBe(false);
    expect(setupEvidence.generatedOutputsPolicy).toContain('not Phase 40 baseline artifacts');
    expect(setupEvidence.records.every((record) => record.claimBearing === false)).toBe(true);
  });

  it('can hash setup evidence records without using fixture mutation as proof', () => {
    for (const record of setupEvidence.records) {
      expect(record.evidenceHash).toBeTruthy();
      expect(hashSetupEvidenceRecord(record)).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });
});
