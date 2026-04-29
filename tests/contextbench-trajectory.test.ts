import { describe, expect, it } from 'vitest';
import { parseStructuredAnswer } from '../src/eval/contextbench-answer.js';
import {
  fullFileSpan,
  normalizeContextBenchPath,
  normalizeTrajectory
} from '../src/eval/contextbench-trajectory.js';
import type { ContextBenchTaskIdentity } from '../src/eval/contextbench-types.js';

const task: Pick<ContextBenchTaskIdentity, 'instance_id' | 'repo_url' | 'base_commit'> = {
  instance_id: 'phase38-task',
  repo_url: 'https://github.com/example/repo.git',
  base_commit: '0123456789abcdef0123456789abcdef01234567'
};

describe('ContextBench trajectory normalization', () => {
  it('normalizes absolute and Windows paths relative to repo root', () => {
    expect(normalizeContextBenchPath('C:\\work\\repo\\src\\index.ts', 'C:/work/repo')).toBe(
      'src/index.ts'
    );
    expect(normalizeContextBenchPath('./src/file.ts')).toBe('src/file.ts');
  });

  it('marks file-only references as explicit full-file spans', () => {
    expect(fullFileSpan()).toEqual({ start: 1, end: null, full_file: true });
  });

  it('deduplicates predicted files while preserving explicit line spans', () => {
    const parsed = parseStructuredAnswer(
      JSON.stringify({
        answer: 'uses target file',
        confidence: 'medium',
        evidence: [
          {
            file: 'C:/work/repo/src/a.ts',
            lineRange: { start: 10, end: 12 },
            reason: 'line evidence'
          },
          { file: 'src/a.ts', lineRange: { start: 20, end: 21 }, reason: 'second span' }
        ],
        filesReferenced: ['src/a.ts', 'src/b.ts'],
        symbolsReferenced: [],
        unsupportedClaims: [],
        readyToEdit: false
      })
    );
    expect(parsed.answer).not.toBeNull();
    if (!parsed.answer) return;
    const trajectory = normalizeTrajectory({
      task,
      answer: parsed.answer,
      repoRoot: 'C:/work/repo'
    });
    expect(trajectory).toMatchObject({
      instance_id: task.instance_id,
      repo_url: task.repo_url,
      commit: task.base_commit
    });
    expect(trajectory.traj_data.pred_files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(trajectory.traj_data.pred_spans['src/a.ts']).toEqual([
      { start: 10, end: 12, full_file: false },
      { start: 20, end: 21, full_file: false }
    ]);
    expect(trajectory.traj_data.pred_spans['src/b.ts']).toEqual([
      { start: 1, end: null, full_file: true }
    ]);
  });
});
