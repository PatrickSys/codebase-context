import { describe, expect, it } from 'vitest';
import {
  combineDiscoverySummaries,
  evaluateDiscoveryGate,
  evaluateDiscoveryFixture,
  formatDiscoveryReport
} from '../src/eval/discovery-harness.js';
import type {
  DiscoveryBenchmarkProtocol,
  DiscoveryFixture,
  DiscoverySummary,
  DiscoverySurfaceResult
} from '../src/eval/types.js';
import angularDiscoveryFixture from './fixtures/discovery-angular-spotify.json';
import excalidrawDiscoveryFixture from './fixtures/discovery-excalidraw.json';
import discoveryProtocol from './fixtures/discovery-benchmark-protocol.json';

describe('Discovery benchmark fixtures', () => {
  it('keeps angular-spotify discovery fixture frozen at 12 tasks with balanced job coverage', () => {
    expect(angularDiscoveryFixture.tasks).toHaveLength(12);
    const counts = angularDiscoveryFixture.tasks.reduce<Record<string, number>>((acc, task) => {
      acc[task.job] = (acc[task.job] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.map).toBe(4);
    expect(counts.find).toBe(4);
    expect(counts.search).toBe(4);
  });

  it('keeps excalidraw discovery fixture frozen at 12 tasks with balanced job coverage', () => {
    expect(excalidrawDiscoveryFixture.tasks).toHaveLength(12);
    const counts = excalidrawDiscoveryFixture.tasks.reduce<Record<string, number>>((acc, task) => {
      acc[task.job] = (acc[task.job] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.map).toBe(4);
    expect(counts.find).toBe(4);
    expect(counts.search).toBe(4);
  });

  it('freezes the discovery protocol around current shipped surfaces only', () => {
    expect(discoveryProtocol.allowedSurfaces).toEqual([
      'search_codebase',
      'get_codebase_metadata',
      'get_team_patterns',
      'codebase://context'
    ]);
    expect(discoveryProtocol.forbiddenSurfaces).toContain('get_codebase_map');
    expect(discoveryProtocol.comparators).toHaveLength(5);
  });

  it('pins both public discovery fixtures to concrete repository refs', () => {
    expect(angularDiscoveryFixture.repositoryRef).toMatch(/^[0-9a-f]{40}$/);
    expect(excalidrawDiscoveryFixture.repositoryRef).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('Discovery harness scoring', () => {
  it('scores expected signals, first relevant hit, and best-example usefulness deterministically', async () => {
    const fixture: DiscoveryFixture = {
      description: 'unit discovery fixture',
      tasks: [
        {
          id: 'map-1',
          title: 'Map task',
          job: 'map',
          surface: 'codebase://context',
          prompt: 'map',
          expectedSignals: ['libraries actually used', 'patterns']
        },
        {
          id: 'find-1',
          title: 'Find task',
          job: 'find',
          surface: 'get_team_patterns',
          prompt: 'find',
          expectedSignals: ['dependencyInjection'],
          expectedBestExamplePatterns: ['src/auth/auth.interceptor.ts']
        },
        {
          id: 'search-1',
          title: 'Search task',
          job: 'search',
          surface: 'search_codebase',
          prompt: 'search',
          expectedSignals: ['results', 'searchQuality'],
          expectedFilePatterns: ['auth.interceptor.ts']
        }
      ]
    };

    const summary = await evaluateDiscoveryFixture({
      fixture,
      rootPath: 'C:/repo',
      surfaceRunners: {
        'codebase://context': async () => ({
          payload: '# Codebase Intelligence\n\n## Libraries Actually Used\n\n## Patterns'
        }),
        get_team_patterns: async () => ({
          payload: '{"patterns":{"dependencyInjection":{"primary":{"name":"inject()","frequency":"90%"}}}}',
          bestExample: 'src/auth/auth.interceptor.ts'
        }),
        search_codebase: async () => ({
          payload: '{"status":"success","searchQuality":{"status":"ok"},"results":[{"file":"src/auth/auth.interceptor.ts:1-10"}]}',
          topFiles: ['src/auth/auth.interceptor.ts']
        })
      }
    });

    expect(summary.totalTasks).toBe(3);
    expect(summary.averageUsefulness).toBeCloseTo(1, 4);
    expect(summary.averageFirstRelevantHit).toBe(1);
    expect(summary.bestExampleUsefulnessRate).toBe(1);
    expect(summary.results[2]?.firstRelevantHit).toBe(1);
  });

  it('formats a compact discovery report', async () => {
    const fixture: DiscoveryFixture = {
      tasks: [
        {
          id: 'search-1',
          title: 'Search task',
          job: 'search',
          surface: 'search_codebase',
          prompt: 'search',
          expectedSignals: ['results'],
          expectedFilePatterns: ['player-api.ts']
        }
      ]
    };

    const summary = await evaluateDiscoveryFixture({
      fixture,
      rootPath: 'C:/repo',
      surfaceRunners: {
        search_codebase: async (): Promise<DiscoverySurfaceResult> => ({
          payload: '{"results":[{"file":"src/player-api.ts:1-4"}]}',
          topFiles: ['src/player-api.ts']
        })
      }
    });

    const report = formatDiscoveryReport({
      codebaseLabel: 'fixture-repo',
      fixturePath: 'tests/fixtures/discovery-angular-spotify.json',
      summary
    });

    expect(report).toContain('Discovery Eval Report');
    expect(report).toContain('Average usefulness');
    expect(report).toContain('search-1');
  });
});

describe('Discovery gate evaluation', () => {
  const protocol = discoveryProtocol as DiscoveryBenchmarkProtocol;

  function createSummary(
    overrides: Partial<DiscoverySummary> = {}
  ): DiscoverySummary {
    return {
      totalTasks: 24,
      averageUsefulness: 0.9,
      averagePayloadBytes: 1200,
      averageEstimatedTokens: 300,
      searchTasks: 8,
      findTasks: 8,
      mapTasks: 8,
      averageFirstRelevantHit: 1.2,
      bestExampleUsefulnessRate: 0.9,
      results: [],
      ...overrides
    };
  }

  it('combines multiple discovery summaries before gate evaluation', () => {
    const combined = combineDiscoverySummaries([
      createSummary({
        results: [
          {
            taskId: 'one',
            title: 'one',
            job: 'map',
            surface: 'codebase://context',
            usefulnessScore: 0.8,
            matchedSignals: [],
            missingSignals: [],
            forbiddenHits: [],
            payloadBytes: 100,
            estimatedTokens: 25
          }
        ]
      }),
      createSummary({
        results: [
          {
            taskId: 'two',
            title: 'two',
            job: 'search',
            surface: 'search_codebase',
            usefulnessScore: 1,
            matchedSignals: [],
            missingSignals: [],
            forbiddenHits: [],
            payloadBytes: 80,
            estimatedTokens: 20,
            firstRelevantHit: 1
          }
        ]
      })
    ]);

    expect(combined.totalTasks).toBe(2);
    expect(combined.averageEstimatedTokens).toBe(22.5);
    expect(combined.averageFirstRelevantHit).toBe(1);
  });

  it('marks the gate pending when required comparator evidence is missing', () => {
    const summary = createSummary();
    const gate = evaluateDiscoveryGate({
      summary,
      protocol,
      suiteComplete: false
    });

    expect(gate.status).toBe('pending_evidence');
    expect(gate.claimAllowed).toBe(false);
    expect(gate.missingEvidence).toContain('fixed public discovery suite is incomplete');
  });

  it('passes the gate when baseline and comparator metrics satisfy the frozen rules', () => {
    const summary = createSummary();
    const gate = evaluateDiscoveryGate({
      summary,
      protocol,
      suiteComplete: true,
      comparatorEvidence: {
        'raw Claude Code': {
          averageEstimatedTokens: 450,
          averageUsefulness: 0.75,
          averageFirstRelevantHit: 1.5,
          bestExampleUsefulnessRate: 0.8
        },
        GrepAI: {
          averageUsefulness: 0.92,
          averageFirstRelevantHit: 1.1,
          bestExampleUsefulnessRate: 0.95
        },
        jCodeMunch: {
          averageUsefulness: 0.98,
          averageFirstRelevantHit: 1.25,
          bestExampleUsefulnessRate: 0.98
        },
        'codebase-memory-mcp': {
          averageUsefulness: 0.93,
          averageFirstRelevantHit: 1.3,
          bestExampleUsefulnessRate: 0.96
        },
        CodeGraphContext: {
          averageUsefulness: 0.88,
          averageFirstRelevantHit: 1.4,
          bestExampleUsefulnessRate: 0.9
        }
      }
    });

    expect(gate.status).toBe('passed');
    expect(gate.baseline.payloadMetricPassed).toBe(true);
    expect(gate.baseline.beatenUsefulnessMetrics.length).toBeGreaterThan(0);
    expect(gate.comparators.every((comparator) => comparator.status === 'passed')).toBe(true);
  });

  it('fails the gate when usefulness falls outside the frozen 15% comparator tolerance', () => {
    const summary = createSummary({
      averageUsefulness: 0.6,
      bestExampleUsefulnessRate: 0.6
    });
    const gate = evaluateDiscoveryGate({
      summary,
      protocol,
      suiteComplete: true,
      comparatorEvidence: {
        'raw Claude Code': {
          averageEstimatedTokens: 450,
          averageUsefulness: 0.55,
          averageFirstRelevantHit: 1.6,
          bestExampleUsefulnessRate: 0.55
        },
        GrepAI: {
          averageUsefulness: 0.9,
          averageFirstRelevantHit: 1.0,
          bestExampleUsefulnessRate: 0.9
        },
        jCodeMunch: {
          averageUsefulness: 0.91,
          averageFirstRelevantHit: 1.0,
          bestExampleUsefulnessRate: 0.91
        },
        'codebase-memory-mcp': {
          averageUsefulness: 0.92,
          averageFirstRelevantHit: 1.0,
          bestExampleUsefulnessRate: 0.92
        },
        CodeGraphContext: {
          averageUsefulness: 0.9,
          averageFirstRelevantHit: 1.0,
          bestExampleUsefulnessRate: 0.9
        }
      }
    });

    expect(gate.status).toBe('failed');
    expect(gate.comparators.some((comparator) => comparator.status === 'failed')).toBe(true);
  });
});
