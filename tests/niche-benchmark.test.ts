import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { aggregateLaneResults, scoreTaskResult } from '../scripts/lib/niche-benchmark/scoring.mjs';
import { extractSearchFilesFromJson } from '../scripts/lib/niche-benchmark/lanes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'niche-benchmark-manifest.json'), 'utf8')
);
const protocol = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'niche-benchmark-protocol.json'), 'utf8')
);

describe('niche benchmark fixtures', () => {
  it('freezes 18 tasks across three repos and three niches', () => {
    expect(manifest.tasks).toHaveLength(18);
    expect(manifest.repos).toHaveLength(3);
    const languages = new Set(manifest.repos.map((repo) => repo.language));
    expect(languages.size).toBeGreaterThanOrEqual(2);
    for (const niche of protocol.niches) {
      expect(manifest.tasks.filter((task) => task.niche === niche)).toHaveLength(6);
    }
  });

  it('lists credited prior-art comparators including ripgrep baseline', () => {
    const ids = protocol.comparators.map((comparator) => comparator.id);
    expect(ids).toEqual([
      'codebase-context',
      'jCodeMunch',
      'aider-repo-map',
      'repomix',
      'ripgrep'
    ]);
    for (const comparator of protocol.comparators) {
      expect(comparator.projectUrl).toMatch(/^https:\/\//);
      expect(comparator.credit.length).toBeGreaterThan(10);
    }
    expect(protocol.claimAllowed).toBe(false);
  });
});

describe('niche benchmark scoring', () => {
  it('marks top-3 pattern hits without tuning scores upward', () => {
    const task = manifest.tasks.find((entry) => entry.id === 'as-sym-01');
    expect(task).toBeDefined();
    const hit = scoreTaskResult(task, {
      payload: 'player-api next track',
      topFiles: ['libs/shared/player-api.ts', 'other.ts']
    });
    expect(hit.top3Hit).toBe(true);
    const miss = scoreTaskResult(task, {
      payload: 'nothing useful',
      topFiles: ['README.md']
    });
    expect(miss.top3Hit).toBe(false);
  });

  it('aggregates lane metrics with failures visible', () => {
    const aggregated = aggregateLaneResults([
      {
        taskId: 't1',
        niche: 'symbol-retrieval',
        status: 'completed',
        top3Hit: true,
        usefulnessScore: 1,
        estimatedTokens: 100,
        queryElapsedMs: 10,
        indexElapsedMs: 50
      },
      {
        taskId: 't2',
        niche: 'edit-preflight',
        status: 'tool_error',
        top3Hit: false,
        usefulnessScore: 0,
        estimatedTokens: 0,
        queryElapsedMs: 0,
        indexElapsedMs: 0
      }
    ]);
    expect(aggregated.tasksCompleted).toBe(1);
    expect(aggregated.tasksFailed).toBe(1);
    expect(aggregated.top3HitRate).toBe(1);
  });
});

describe('extractSearchFilesFromJson (team-convention paths)', () => {
  it('collects ranked exemplars, golden files, and pattern canonical examples', () => {
    const payload = {
      status: 'success',
      patterns: {
        dependencyInjection: {
          primary: {
            name: 'inject()',
            canonicalExample: { file: 'apps/web/src/app/core/auth.service.ts', snippet: 'inject(' },
            examples: ['apps/web/src/app/core/auth.service.ts']
          }
        }
      },
      goldenFiles: [{ file: 'libs/shared/util-store.ts', score: 4 }],
      rankedExemplars: [{ file: 'libs/shared/util-store.ts', score: 4, category: 'stateManagement' }]
    };
    expect(extractSearchFilesFromJson(payload)).toEqual([
      'libs/shared/util-store.ts',
      'apps/web/src/app/core/auth.service.ts'
    ]);
  });

  it('still reads search results[] first', () => {
    const payload = {
      results: [{ file: 'src/search-hit.ts' }],
      goldenFiles: [{ file: 'other.ts', score: 1 }]
    };
    expect(extractSearchFilesFromJson(payload)[0]).toBe('src/search-hit.ts');
  });
});
