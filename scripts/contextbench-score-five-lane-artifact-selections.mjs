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
  const candidateFiles = new Set((readiness.candidates || []).map((candidate) => String(candidate.file || '').replaceAll('\\', '/')));
  if (candidateFiles.size === 0) return;
  const selectedFiles = new Set([
    ...(selection.files || []),
    ...(selection.spans || []).map((span) => span.file),
  ].filter(Boolean).map((file) => String(file).replaceAll('\\', '/')));
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
    return {
      ...selection,
      readiness: {
        setupStatus: readiness.setupStatus,
        indexStatus: readiness.indexStatus,
        toolCallable: readiness.toolCallable,
        candidateCount: readiness.candidateCount,
        setupIndex: readiness.setupIndex,
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
