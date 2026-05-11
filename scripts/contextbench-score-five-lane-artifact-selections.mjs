import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.env.ROOT || '/tmp/contextbench-five-lane-score';
const sourceSelectionsPath = process.env.SOURCE_SELECTIONS_PATH || 'scripts/contextbench-five-lane-selections.json';
const externalRoot = process.env.EXTERNAL_READINESS_ROOT || join(root, 'external-readiness');
const resolvedSelectionsPath = join(root, 'resolved-five-lane-selections.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizePath(path) {
  return String(path || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function estimateTokensFromBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  return Math.ceil(bytes / 4);
}

function candidateText(candidate) {
  return String(candidate.text || candidate.content || candidate.snippet || candidate.preview || candidate.summary || candidate.excerpt || '');
}

function candidateStart(candidate) {
  return candidate.start ?? candidate.startLine ?? candidate.lineStart ?? candidate.range?.start ?? null;
}

function candidateEnd(candidate) {
  return candidate.end ?? candidate.endLine ?? candidate.lineEnd ?? candidate.range?.end ?? null;
}

function candidateMetricsFromReadiness(readiness) {
  const candidates = Array.isArray(readiness.candidates) ? readiness.candidates : [];
  const candidateCount = Number(readiness.candidateCount ?? candidates.length ?? 0);
  if (candidates.length === 0) {
    return {
      candidateCount,
      fileCount: null,
      spanCount: null,
      bytes: null,
      estimatedTokens: null,
      source: 'readiness artifact',
      unavailableReason: 'readiness artifact did not include candidate payloads, only candidateCount',
    };
  }
  const normalized = candidates.map((candidate) => ({
    file: normalizePath(candidate.file || candidate.path),
    start: candidateStart(candidate),
    end: candidateEnd(candidate),
    score: candidate.score ?? candidate.rank ?? candidate.weight ?? null,
    text: candidateText(candidate),
  }));
  const files = new Set(normalized.map((candidate) => candidate.file).filter(Boolean));
  const bytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  return {
    candidateCount,
    fileCount: files.size,
    spanCount: normalized.length,
    bytes,
    estimatedTokens: estimateTokensFromBytes(bytes),
    source: 'normalized readiness.candidates JSON',
  };
}

function loadReadiness(lane, artifactName) {
  const candidates = [
    join(externalRoot, artifactName, 'pack', `${artifactName}-readiness.json`),
    join(externalRoot, artifactName, 'pack', `${lane}-readiness.json`),
    join(externalRoot, artifactName, `${artifactName}-readiness.json`),
    join(externalRoot, artifactName, `${lane}-readiness.json`),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error(`readiness artifact for ${lane} not found under ${join(externalRoot, artifactName)}`);
  }
  const readiness = readJson(path);
  if (readiness.ready !== true) throw new Error(`${lane} readiness artifact is not ready`);
  if (readiness.toolCallable !== true) throw new Error(`${lane} readiness artifact does not prove callable tool`);
  if (!Number.isFinite(Number(readiness.candidateCount)) || Number(readiness.candidateCount) <= 0) {
    throw new Error(`${lane} readiness artifact has no candidates`);
  }
  return readiness;
}

function assertSelectedFilesCameFromCandidates(selection, readiness) {
  if (selection.validateCandidateFiles === false) return;
  const candidateFiles = new Set((readiness.candidates || []).map((candidate) => normalizePath(candidate.file || candidate.path)));
  if (candidateFiles.size === 0) return;
  const selectedFiles = new Set([
    ...(selection.files || []),
    ...(selection.spans || []).map((span) => span.file),
  ].filter(Boolean).map((file) => normalizePath(file)));
  const missing = [...selectedFiles].filter((file) => !candidateFiles.has(file));
  if (missing.length > 0) {
    throw new Error(`${selection.lane_id || selection.lane} selected files missing from readiness candidates: ${missing.join(', ')}`);
  }
}

const selections = readJson(sourceSelectionsPath);
const resolved = {
  ...selections,
  laneSelections: selections.laneSelections.map((selection) => {
    const lane = selection.lane_id || selection.lane;
    if (!selection.readinessArtifact) return selection;
    const readiness = loadReadiness(lane, selection.readinessArtifact);
    assertSelectedFilesCameFromCandidates(selection, readiness);
    const candidateMetrics = candidateMetricsFromReadiness(readiness);
    return {
      ...selection,
      candidateMetrics,
      readiness: {
        setupStatus: readiness.setupStatus,
        indexStatus: readiness.indexStatus,
        toolCallable: readiness.toolCallable,
        candidateCount: readiness.candidateCount,
        setupIndex: readiness.setupIndex,
        candidateMetrics,
        sourceRun: selection.sourceRun,
        sourceJob: selection.sourceJob,
        sourceArtifact: selection.sourceArtifact,
        sourceDigest: selection.sourceDigest,
      },
    };
  }),
};

mkdirSync(root, { recursive: true });
writeFileSync(resolvedSelectionsPath, `${JSON.stringify(resolved, null, 2)}\n`);

const result = spawnSync('node', ['scripts/contextbench-score-five-lane-selections.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, SELECTIONS_PATH: resolvedSelectionsPath },
  stdio: 'inherit',
  timeout: 60 * 60 * 1000,
});
if (result.error) throw result.error;
process.exitCode = typeof result.status === 'number' ? result.status : 1;
