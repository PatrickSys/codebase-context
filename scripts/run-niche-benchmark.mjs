#!/usr/bin/env node
/**
 * One-command niche prior-art benchmark runner.
 *
 * Usage:
 *   node scripts/run-niche-benchmark.mjs
 *   node scripts/run-niche-benchmark.mjs --lanes codebase-context,ripgrep --output results/niche-benchmark-evidence.json
 *   node scripts/run-niche-benchmark.mjs --validate-fixtures
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import {
  ensureRepoCheckout,
  runAiderTask,
  runCodebaseContextTask,
  runJCodeMunchTask,
  runRepomixTask,
  runRipgrepTask,
  warmAiderRepo,
  warmCodebaseContextIndex,
  warmJCodeMunchRepo,
  warmRepomixRepo
} from './lib/niche-benchmark/lanes.mjs';
import { aggregateEvidence, aggregateLaneResults } from './lib/niche-benchmark/scoring.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const defaultManifest = path.join(projectRoot, 'tests', 'fixtures', 'niche-benchmark-manifest.json');
const defaultProtocol = path.join(projectRoot, 'tests', 'fixtures', 'niche-benchmark-protocol.json');
const defaultOutput = path.join(projectRoot, 'results', 'niche-benchmark-evidence.json');

const ALL_LANES = ['codebase-context', 'jCodeMunch', 'aider-repo-map', 'repomix', 'ripgrep'];

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function ensureBuilt() {
  const distIndex = path.join(projectRoot, 'dist', 'index.js');
  if (existsSync(distIndex)) return;
  console.log('Building codebase-context (dist missing)...');
  const build = spawnSync('pnpm', ['run', 'build'], {
    cwd: projectRoot,
    stdio: 'inherit',
    encoding: 'utf8'
  });
  if (build.status !== 0) {
    throw new Error('pnpm run build failed; dist/index.js is required for the codebase-context lane');
  }
}

function validateFixtures(manifestPath, protocolPath) {
  const manifest = loadJson(manifestPath);
  const protocol = loadJson(protocolPath);
  const errors = [];
  if (manifest.tasks.length !== 18) errors.push(`expected 18 tasks, found ${manifest.tasks.length}`);
  if (manifest.repos.length !== 3) errors.push(`expected 3 repos, found ${manifest.repos.length}`);
  const nicheCounts = {};
  for (const task of manifest.tasks) {
    nicheCounts[task.niche] = (nicheCounts[task.niche] ?? 0) + 1;
  }
  for (const niche of protocol.niches) {
    if (nicheCounts[niche] !== 6) {
      errors.push(`expected 6 ${niche} tasks, found ${nicheCounts[niche] ?? 0}`);
    }
  }
  const repoIds = new Set(manifest.repos.map((repo) => repo.id));
  for (const task of manifest.tasks) {
    if (!repoIds.has(task.repoId)) errors.push(`task ${task.id} references unknown repo ${task.repoId}`);
  }
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('Fixture validation passed.');
  console.log(`  manifest: ${manifestPath}`);
  console.log(`  protocol: ${protocolPath}`);
  console.log(`  manifest sha256: ${sha256File(manifestPath)}`);
  console.log(`  protocol sha256: ${sha256File(protocolPath)}`);
}

async function runLane(laneId, manifest, repoCheckouts) {
  const tasksByRepo = manifest.repos.map((repo) => ({
    repo,
    checkout: repoCheckouts[repo.id],
    tasks: manifest.tasks.filter((task) => task.repoId === repo.id)
  }));

  const taskResults = [];

  if (laneId === 'ripgrep') {
    for (const group of tasksByRepo) {
      for (const task of group.tasks) {
        taskResults.push({
          taskId: task.id,
          ...runRipgrepTask(task, group.checkout, 0)
        });
      }
    }
    return aggregateLaneResults(taskResults.map((row) => ({ ...row, status: row.status ?? 'completed' })));
  }

  for (const group of tasksByRepo) {
    let indexElapsedMs = 0;
    let repomixPack = '';
    let jcodemunchRepo = null;

    if (laneId === 'codebase-context') {
      const index = await warmCodebaseContextIndex(group.checkout, projectRoot);
      indexElapsedMs = index.durationMs;
      if (index.status !== 0) {
        return {
          status: 'setup_failed',
          reason: `codebase-context reindex failed on ${group.repo.id}`,
          taskResults: []
        };
      }
    } else if (laneId === 'jCodeMunch') {
      try {
        const warmed = await warmJCodeMunchRepo(group.checkout);
        jcodemunchRepo = warmed.repoName;
        indexElapsedMs = warmed.indexElapsedMs;
      } catch (error) {
        return {
          status: 'setup_failed',
          reason: `jCodeMunch setup failed on ${group.repo.id}: ${error.message}`,
          taskResults: []
        };
      }
    } else if (laneId === 'aider-repo-map') {
      const warm = warmAiderRepo(group.checkout);
      indexElapsedMs = warm.durationMs;
      if (warm.status !== 0) {
        return {
          status: 'setup_failed',
          reason: `Aider repo map warm index failed on ${group.repo.id}`,
          taskResults: []
        };
      }
    } else if (laneId === 'repomix') {
      const warm = warmRepomixRepo(group.checkout);
      indexElapsedMs = warm.indexElapsedMs;
      if (warm.status !== 'completed') {
        return {
          status: 'setup_failed',
          reason: warm.error ?? `Repomix pack failed on ${group.repo.id}`,
          taskResults: []
        };
      }
      repomixPack = warm.packText;
    }

    for (const task of group.tasks) {
      let row;
      if (laneId === 'codebase-context') {
        row = await runCodebaseContextTask(task, group.checkout, projectRoot, indexElapsedMs / group.tasks.length);
      } else if (laneId === 'jCodeMunch') {
        row = await runJCodeMunchTask(task, group.checkout, jcodemunchRepo, indexElapsedMs / group.tasks.length);
      } else if (laneId === 'aider-repo-map') {
        row = runAiderTask(task, group.checkout, indexElapsedMs / group.tasks.length);
      } else if (laneId === 'repomix') {
        row = runRepomixTask(task, repomixPack, indexElapsedMs / group.tasks.length);
      }
      taskResults.push({ taskId: task.id, ...row });
    }
  }

  return aggregateLaneResults(
    taskResults.map((row) => ({
      ...row,
      status: row.status ?? 'completed'
    }))
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', default: false },
      'validate-fixtures': { type: 'boolean', default: false },
      manifest: { type: 'string' },
      protocol: { type: 'string' },
      lanes: { type: 'string' },
      output: { type: 'string' },
      'skip-build': { type: 'boolean', default: false }
    }
  });

  const manifestPath = path.resolve(values.manifest ?? defaultManifest);
  const protocolPath = path.resolve(values.protocol ?? defaultProtocol);
  const outputPath = path.resolve(values.output ?? defaultOutput);

  if (values.help) {
    console.log(`Usage: node scripts/run-niche-benchmark.mjs [options]

  --validate-fixtures   Validate frozen manifest/protocol and exit
  --lanes <csv>         Default: ${ALL_LANES.join(',')}
  --output <path>       Default: ${defaultOutput}
  --skip-build          Do not auto-build dist before running
`);
    process.exit(0);
  }

  if (values['validate-fixtures']) {
    validateFixtures(manifestPath, protocolPath);
    process.exit(0);
  }

  const manifest = loadJson(manifestPath);
  const protocol = loadJson(protocolPath);
  validateFixtures(manifestPath, protocolPath);

  const lanes = (values.lanes ?? ALL_LANES.join(','))
    .split(',')
    .map((lane) => lane.trim())
    .filter(Boolean);
  for (const lane of lanes) {
    if (!ALL_LANES.includes(lane)) {
      throw new Error(`Unknown lane ${lane}. Supported: ${ALL_LANES.join(', ')}`);
    }
  }

  if (!values['skip-build'] && lanes.includes('codebase-context')) {
    ensureBuilt();
  }

  console.log(`\nNiche prior-art benchmark (${manifest.tasks.length} tasks, ${lanes.length} lanes)`);
  const repoCheckouts = {};
  for (const repo of manifest.repos) {
    console.log(`Checking out ${repo.id} @ ${repo.repositoryRef.slice(0, 12)}...`);
    repoCheckouts[repo.id] = ensureRepoCheckout(repo, projectRoot);
  }

  const laneEvidence = {};
  for (const laneId of lanes) {
    console.log(`\n=== Lane: ${laneId} ===`);
    try {
      laneEvidence[laneId] = await runLane(laneId, manifest, repoCheckouts);
      console.log(
        `  top-3 hit rate: ${laneEvidence[laneId].top3HitRate === null ? 'n/a' : (laneEvidence[laneId].top3HitRate * 100).toFixed(1) + '%'}`
      );
      console.log(
        `  avg tokens: ${laneEvidence[laneId].averageEstimatedTokens === null ? 'n/a' : Math.round(laneEvidence[laneId].averageEstimatedTokens)}`
      );
      console.log(
        `  avg query ms: ${laneEvidence[laneId].averageQueryElapsedMs === null ? 'n/a' : Math.round(laneEvidence[laneId].averageQueryElapsedMs)}`
      );
    } catch (error) {
      laneEvidence[laneId] = { status: 'setup_failed', reason: error.message, taskResults: [] };
      console.error(`  SETUP FAILED: ${error.message}`);
    }
  }

  const evidence = aggregateEvidence(laneEvidence, manifest, protocol, {
    manifestPath,
    protocolPath,
    manifestSha256: sha256File(manifestPath),
    protocolSha256: sha256File(protocolPath),
    nodeVersion: process.version,
    lanes,
    repoCheckouts: Object.fromEntries(
      manifest.repos.map((repo) => [repo.id, { ref: repo.repositoryRef, path: repoCheckouts[repo.id] }])
    )
  });

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\nEvidence written to ${outputPath}`);
}

main().catch((error) => {
  console.error('Fatal:', error);
  process.exit(2);
});
