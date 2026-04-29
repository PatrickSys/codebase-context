import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStructuredAnswer } from '../src/eval/contextbench-answer.js';
import {
  runFactRecallDiagnostics,
  scoreWithOfficialEvaluatorFirst,
  type ContextBenchProcessRunner
} from '../src/eval/contextbench-scoring.js';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'contextbench-scoring-'));
}

describe('ContextBench official-evaluator-first scoring', () => {
  it('invokes the official evaluator command through an injected runner', async () => {
    const outDir = tempDir();
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: ContextBenchProcessRunner = async (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: 'ok', stderr: '' };
    };
    try {
      const result = await scoreWithOfficialEvaluatorFirst({
        goldPath: path.join(outDir, 'gold.parquet'),
        predictionPath: path.join(outDir, 'trajectory.json'),
        outputPath: path.join(outDir, 'score.json'),
        cachePath: path.join(outDir, 'cache'),
        runner
      });
      expect(result).toMatchObject({
        status: 'completed',
        mode: 'official_evaluator',
        claimBearing: true
      });
      expect(calls[0].command).toBe('python');
      expect(calls[0].args).toEqual(
        expect.arrayContaining(['-m', 'contextbench.evaluate', '--gold', '--pred', '--out'])
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('writes diagnostic non-claim-bearing fallback metadata when the evaluator fails', async () => {
    const outDir = tempDir();
    const runner: ContextBenchProcessRunner = async () => ({
      status: 1,
      stdout: '',
      stderr: 'No module named contextbench'
    });
    try {
      const result = await scoreWithOfficialEvaluatorFirst({
        goldPath: path.join(outDir, 'gold.parquet'),
        predictionPath: path.join(outDir, 'trajectory.json'),
        outputPath: path.join(outDir, 'score.json'),
        runner
      });
      expect(result).toMatchObject({
        status: 'judge_failed',
        mode: 'diagnostic_fallback',
        claimBearing: false,
        fallbackReason: 'official_evaluator_failed'
      });
      expect(result.stderr).toContain('No module named');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('feeds schema-bound fact and evidence diagnostics into false-ready classification', () => {
    const parsed = parseStructuredAnswer(
      JSON.stringify({
        answer: 'only mentions alpha',
        confidence: 'high',
        evidence: [
          { file: 'src/alpha.ts', lineRange: { start: 1, end: 3 }, reason: 'alpha evidence' }
        ],
        filesReferenced: ['src/alpha.ts'],
        symbolsReferenced: [],
        unsupportedClaims: [],
        readyToEdit: true
      })
    );
    expect(parsed.answer).not.toBeNull();
    if (!parsed.answer) return;
    const diagnostics = runFactRecallDiagnostics(parsed.answer, {
      requiredFacts: ['beta'],
      requiredEvidenceFiles: ['src/beta.ts']
    });
    expect(diagnostics.missingRequiredFacts).toEqual(['beta']);
    expect(diagnostics.missingEvidenceFiles).toEqual(['src/beta.ts']);
    expect(diagnostics.unsupportedClaim).toBe(true);
    expect(diagnostics.falseReady).toBe(true);
  });
});
