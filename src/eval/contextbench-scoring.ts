import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { classifyStructuredAnswer, evaluateSchemaBoundDiagnostics } from './contextbench-answer.js';
import type { ContextBenchStructuredAnswer } from './contextbench-types.js';

export interface ProcessRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type ContextBenchProcessRunner = (
  command: string,
  args: string[],
  cwd?: string
) => Promise<ProcessRunResult>;

export interface OfficialEvaluatorParams {
  goldPath: string;
  predictionPath: string;
  outputPath: string;
  cachePath?: string;
  cwd?: string;
  claimAllowed?: boolean;
  runner: ContextBenchProcessRunner;
}

export interface ContextBenchScoreResult {
  status: 'completed' | 'judge_failed';
  mode: 'official_evaluator' | 'diagnostic_fallback';
  claimBearing: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitStatus: number | null;
  exitCode: number | null;
  officialEvaluatorFirst: boolean;
  officialEvaluatorAttempted: boolean;
  officialEvaluatorInvoked: boolean;
  outputPath: string;
  fallbackReason?: string;
}

export interface FactRecallDiagnosticResult {
  missingRequiredFacts: string[];
  missingEvidenceFiles: string[];
  unsupportedClaim: boolean;
  falseReady: boolean;
  reasons: string[];
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function scoreWithOfficialEvaluatorFirst(
  params: OfficialEvaluatorParams
): Promise<ContextBenchScoreResult> {
  const args = [
    '-m',
    'contextbench.evaluate',
    '--gold',
    params.goldPath,
    '--pred',
    params.predictionPath
  ];
  if (params.cachePath) args.push('--cache', params.cachePath);
  args.push('--out', params.outputPath);
  const command = `python ${args.join(' ')}`;
  const result = await params.runner('python', args, params.cwd);
  if (result.status === 0) {
    const score = {
      status: 'completed' as const,
      mode: 'official_evaluator' as const,
      claimBearing: params.claimAllowed === true,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitStatus: result.status,
      exitCode: result.status,
      officialEvaluatorFirst: true,
      officialEvaluatorAttempted: true,
      officialEvaluatorInvoked: true,
      outputPath: params.outputPath
    };
    writeJson(params.outputPath, score);
    return score;
  }

  const score = {
    status: 'judge_failed' as const,
    mode: 'diagnostic_fallback' as const,
    claimBearing: false,
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitStatus: result.status,
    exitCode: result.status,
    officialEvaluatorFirst: true,
    officialEvaluatorAttempted: true,
    officialEvaluatorInvoked: true,
    outputPath: params.outputPath,
    fallbackReason: 'official_evaluator_failed'
  };
  writeJson(params.outputPath, score);
  return score;
}

export function runFactRecallDiagnostics(
  answer: ContextBenchStructuredAnswer,
  expected: { requiredFacts?: string[]; requiredEvidenceFiles?: string[] }
): FactRecallDiagnosticResult {
  const diagnostics = evaluateSchemaBoundDiagnostics(answer, expected);
  const classification = classifyStructuredAnswer(answer, diagnostics);
  return {
    missingRequiredFacts: diagnostics.missingRequiredFacts ?? [],
    missingEvidenceFiles: diagnostics.missingEvidenceFiles ?? [],
    unsupportedClaim: classification.unsupportedClaim,
    falseReady: classification.falseReady,
    reasons: classification.reasons
  };
}
