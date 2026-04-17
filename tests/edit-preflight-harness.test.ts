import { describe, expect, it } from 'vitest';
import {
  combineEditPreflightSummaries,
  evaluateEditPreflightFixture,
  formatEditPreflightReport
} from '../src/eval/edit-preflight-harness.js';
import type {
  EditPreflightFixture,
  EditPreflightResponse,
  EditPreflightSummary
} from '../src/eval/types.js';
import angularEditPreflightFixture from './fixtures/edit-preflight-angular-spotify.json';
import excalidrawEditPreflightFixture from './fixtures/edit-preflight-excalidraw.json';

describe('Edit preflight fixtures', () => {
  it('keeps both public edit-preflight fixtures frozen at 10 tasks each with safe/unsafe balance', () => {
    for (const fixture of [angularEditPreflightFixture, excalidrawEditPreflightFixture]) {
      expect(fixture.tasks).toHaveLength(10);
      const counts = fixture.tasks.reduce<Record<string, number>>((acc, task) => {
        acc[task.risk] = (acc[task.risk] ?? 0) + 1;
        return acc;
      }, {});
      expect(counts.safe).toBe(6);
      expect(counts.unsafe).toBe(4);
    }
  });

  it('pins both edit-preflight fixtures to concrete repository refs', () => {
    expect(angularEditPreflightFixture.repositoryRef).toMatch(/^[0-9a-f]{40}$/);
    expect(excalidrawEditPreflightFixture.repositoryRef).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('Edit preflight harness scoring', () => {
  it('scores target hits, best-example hits, safe ready rate, and unsafe abstention deterministically', async () => {
    const fixture: EditPreflightFixture = {
      tasks: [
        {
          id: 'safe-1',
          title: 'Safe auth edit',
          query: 'edit auth headers',
          risk: 'safe',
          expectedTargetPatterns: ['auth.interceptor.ts'],
          expectedBestExamplePatterns: ['auth.interceptor.ts']
        },
        {
          id: 'safe-2',
          title: 'Safe player edit',
          query: 'edit player flow',
          risk: 'safe',
          expectedTargetPatterns: ['player-api.ts'],
          expectedBestExamplePatterns: ['player-api.ts']
        },
        {
          id: 'unsafe-1',
          title: 'Unsafe migration',
          query: 'rewrite everything',
          risk: 'unsafe'
        }
      ]
    };

    const responses: Record<string, EditPreflightResponse> = {
      'edit auth headers': {
        preflight: {
          ready: true,
          bestExample: 'src/http/auth.interceptor.ts'
        },
        searchQuality: { status: 'ok' },
        results: [
          { file: 'src/http/auth.interceptor.ts:1-20' },
          { file: 'src/http/error.interceptor.ts:1-20' }
        ]
      },
      'edit player flow': {
        preflight: {
          ready: false,
          bestExample: 'src/player/player-api.ts',
          nextAction: 'Search for callers before editing.'
        },
        searchQuality: { status: 'ok' },
        results: [
          { file: 'src/player/player-helper.ts:1-20' },
          { file: 'src/player/player-api.ts:1-20' }
        ]
      },
      'rewrite everything': {
        preflight: {
          ready: false,
          abstain: true,
          nextAction: 'Break the request into smaller edits.'
        },
        searchQuality: { status: 'low_confidence' },
        results: [{ file: 'src/app/app.ts:1-20' }]
      }
    };

    const summary = await evaluateEditPreflightFixture({
      fixture,
      rootPath: 'C:/repo',
      runner: async (task) => responses[task.query] ?? {}
    });

    expect(summary.totalTasks).toBe(3);
    expect(summary.topTargetInTop3Count).toBe(2);
    expect(summary.topTargetInTop3Rate).toBe(1);
    expect(summary.averageFirstRelevantHit).toBe(1.5);
    expect(summary.bestExampleHitRate).toBe(1);
    expect(summary.safeTaskReadyRate).toBe(0.5);
    expect(summary.unsafeTaskAbstainRate).toBe(1);
    expect(summary.unsafeReadyFalsePositiveRate).toBe(0);
  });

  it('combines summaries by recomputing aggregate rates from task results', () => {
    const combined = combineEditPreflightSummaries([
      createSummary({
        results: [
          {
            taskId: 'safe-1',
            title: 'safe-1',
            query: 'safe-1',
            risk: 'safe',
            ready: true,
            abstain: false,
            searchQualityStatus: 'ok',
            topFiles: ['src/auth.ts'],
            firstRelevantHit: 1,
            topTargetInTop3: true,
            bestExample: 'src/auth.ts',
            bestExampleHit: true
          }
        ]
      }),
      createSummary({
        results: [
          {
            taskId: 'unsafe-1',
            title: 'unsafe-1',
            query: 'unsafe-1',
            risk: 'unsafe',
            ready: false,
            abstain: true,
            searchQualityStatus: 'low_confidence',
            topFiles: ['src/app.ts'],
            firstRelevantHit: null,
            topTargetInTop3: null,
            bestExample: null,
            bestExampleHit: null
          }
        ]
      })
    ]);

    expect(combined.totalTasks).toBe(2);
    expect(combined.safeTaskReadyRate).toBe(1);
    expect(combined.unsafeTaskAbstainRate).toBe(1);
    expect(combined.unsafeReadyFalsePositiveRate).toBe(0);
  });

  it('formats a bounded edit-preflight report with false-positive and safe-miss sections', () => {
    const report = formatEditPreflightReport({
      codebaseLabel: 'fixture-repo',
      fixturePath: 'tests/fixtures/edit-preflight-angular-spotify.json',
      summary: createSummary({
        results: [
          {
            taskId: 'safe-1',
            title: 'safe-1',
            query: 'safe query',
            risk: 'safe',
            ready: false,
            abstain: false,
            searchQualityStatus: 'ok',
            topFiles: ['src/auth.ts'],
            firstRelevantHit: 2,
            topTargetInTop3: true,
            bestExample: 'src/auth.ts',
            bestExampleHit: true,
            nextAction: 'Search for callers first.'
          },
          {
            taskId: 'unsafe-1',
            title: 'unsafe-1',
            query: 'unsafe query',
            risk: 'unsafe',
            ready: true,
            abstain: false,
            searchQualityStatus: 'ok',
            topFiles: ['src/app.ts'],
            firstRelevantHit: null,
            topTargetInTop3: null,
            bestExample: null,
            bestExampleHit: null
          }
        ],
        totalTasks: 2,
        safeTasks: 1,
        unsafeTasks: 1,
        targetableTasks: 1,
        bestExampleTasks: 1,
        topTargetInTop3Count: 1,
        topTargetInTop3Rate: 1,
        averageFirstRelevantHit: 2,
        bestExampleHitCount: 1,
        bestExampleHitRate: 1,
        safeTaskReadyCount: 0,
        safeTaskReadyRate: 0,
        unsafeTaskAbstainCount: 0,
        unsafeTaskAbstainRate: 0,
        unsafeReadyFalsePositiveCount: 1,
        unsafeReadyFalsePositiveRate: 1
      })
    });

    expect(report).toContain('Edit Preflight Eval Report');
    expect(report).toContain('Unsafe false positives:');
    expect(report).toContain('Safe misses:');
    expect(report).toContain('next: Search for callers first.');
  });
});

function createSummary(overrides: Partial<EditPreflightSummary> = {}): EditPreflightSummary {
  return {
    totalTasks: 0,
    safeTasks: 0,
    unsafeTasks: 0,
    targetableTasks: 0,
    bestExampleTasks: 0,
    topTargetInTop3Count: 0,
    topTargetInTop3Rate: null,
    averageFirstRelevantHit: null,
    bestExampleHitCount: 0,
    bestExampleHitRate: null,
    safeTaskReadyCount: 0,
    safeTaskReadyRate: null,
    unsafeTaskAbstainCount: 0,
    unsafeTaskAbstainRate: null,
    unsafeReadyFalsePositiveCount: 0,
    unsafeReadyFalsePositiveRate: null,
    results: [],
    ...overrides
  };
}
