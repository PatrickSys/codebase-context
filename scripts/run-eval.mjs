#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { CodebaseIndexer } from '../dist/core/indexer.js';
import { CodebaseSearcher } from '../dist/core/search.js';
import { analyzerRegistry } from '../dist/core/analyzer-registry.js';
import { AngularAnalyzer } from '../dist/analyzers/angular/index.js';
import { GenericAnalyzer } from '../dist/analyzers/generic/index.js';
import { evaluateFixture, formatEvalReport } from '../dist/eval/harness.js';
import {
  combineDiscoverySummaries,
  evaluateDiscoveryGate,
  evaluateDiscoveryFixture,
  formatDiscoveryReport
} from '../dist/eval/discovery-harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const packageJsonPath = path.join(projectRoot, 'package.json');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

const defaultFixtureA = path.join(projectRoot, 'tests', 'fixtures', 'eval-angular-spotify.json');
const defaultFixtureB = path.join(projectRoot, 'tests', 'fixtures', 'eval-controlled.json');
const defaultDiscoveryFixtureA = path.join(
  projectRoot,
  'tests',
  'fixtures',
  'discovery-angular-spotify.json'
);
const defaultDiscoveryFixtureB = path.join(
  projectRoot,
  'tests',
  'fixtures',
  'discovery-excalidraw.json'
);
const defaultDiscoveryProtocol = path.join(
  projectRoot,
  'tests',
  'fixtures',
  'discovery-benchmark-protocol.json'
);

const usage = [
  `Usage: node scripts/run-eval.mjs <codebaseA> [codebaseB] [options]`,
  ``,
  `Options:`,
  `  --mode=<retrieval|discovery>  Select benchmark mode (default: retrieval)`,
  `  --fixture-a=<path>  Override fixture for codebaseA`,
  `  --fixture-b=<path>  Override fixture for codebaseB`,
  `  --protocol=<path>   Override discovery benchmark protocol`,
  `  --competitor-results=<path>  JSON file with comparator metrics for discovery gate evaluation`,
  `  --skip-reindex      Skip re-index phase`,
  `  --no-rerank         Disable ambiguity reranker`,
  `  --no-redact         Show full file paths in report`,
  `  --help              Show this help and exit`
].join('\n');

analyzerRegistry.register(new AngularAnalyzer());
analyzerRegistry.register(new GenericAnalyzer());

function loadFixture(fixturePath) {
  const raw = readFileSync(fixturePath, 'utf-8');
  return JSON.parse(raw);
}

function printHeader(version) {
  console.log(`\n=== codebase-context v${version} eval ===`);
  console.log(`Model: ${process.env.EMBEDDING_MODEL || 'Xenova/bge-small-en-v1.5 (default)'}`);
}

function hasIndexArtifacts(rootPath) {
  const contextDir = path.join(rootPath, '.codebase-context');
  const keywordIndexPath = path.join(contextDir, 'index.json');
  const vectorDirPath = path.join(contextDir, 'index');
  return existsSync(keywordIndexPath) && existsSync(vectorDirPath);
}

async function maybeReindex(rootPath, skipReindex) {
  if (skipReindex && hasIndexArtifacts(rootPath)) {
    console.log(`\n--- Phase 1: Skipping re-index (--skip-reindex) ---`);
    return;
  }

  if (skipReindex) {
    console.log(
      `\n--- Phase 1: --skip-reindex requested but no index artifacts found; running index build ---`
    );
  }

  console.log(`\n--- Phase 1: Re-indexing ---`);
  const indexer = new CodebaseIndexer({
    rootPath,
    onProgress: (progress) => {
      if (progress.phase === 'embedding' || progress.phase === 'complete') {
        process.stderr.write(
          `\r[${progress.phase}] ${progress.percentage}% (${progress.filesProcessed}/${progress.totalFiles} files)`
        );
      }
    }
  });

  const stats = await indexer.index();
  console.log(
    `\nIndexing complete: ${stats.indexedFiles} files, ${stats.totalChunks} chunks in ${stats.duration}ms`
  );
}

async function runSingleEvaluation({
  label,
  codebasePath,
  fixturePath,
  mode,
  skipReindex,
  noRerank,
  redactPaths
}) {
  const resolvedCodebase = path.resolve(codebasePath);
  const resolvedFixture = path.resolve(fixturePath);
  const fixture = loadFixture(resolvedFixture);

  console.log(`\n=== Codebase: ${label} ===`);
  console.log(`Target: ${resolvedCodebase}`);
  console.log(`Fixture: ${resolvedFixture}`);
  console.log(`Mode: ${mode}`);
  if (mode === 'retrieval') {
    console.log(
      `Reranker: ${noRerank ? 'DISABLED' : 'enabled (ambiguity-triggered, Xenova/ms-marco-MiniLM-L-6-v2)'}`
    );
  }
  console.log(`Path output: ${redactPaths ? 'REDACTED' : 'FULL'}`);

  await maybeReindex(resolvedCodebase, skipReindex);

  let summary;
  let report;

  if (mode === 'discovery') {
    console.log(`\n--- Phase 2: Running ${fixture.tasks.length}-task discovery harness ---`);
    summary = await evaluateDiscoveryFixture({
      fixture,
      rootPath: resolvedCodebase
    });
    report = formatDiscoveryReport({
      codebaseLabel: label,
      fixturePath: resolvedFixture,
      summary
    });
  } else {
    console.log(`\n--- Phase 2: Running ${fixture.queries.length}-query eval harness ---`);
    const searcher = new CodebaseSearcher(resolvedCodebase);
    summary = await evaluateFixture({
      fixture,
      searcher,
      limit: 5,
      searchOptions: {
        enableReranker: !noRerank
      }
    });

    report = formatEvalReport({
      codebaseLabel: label,
      fixturePath: resolvedFixture,
      summary,
      redactPaths
    });
  }

  console.log(report);
  return summary;
}

function printCombinedSummary(summaries, mode) {
  if (mode === 'discovery') {
    const totalTasks = summaries.reduce((sum, summary) => sum + summary.totalTasks, 0);
    const avgUsefulness =
      totalTasks > 0
        ? summaries.reduce((sum, summary) => sum + summary.averageUsefulness * summary.totalTasks, 0) /
          totalTasks
        : 0;
    const avgPayload =
      totalTasks > 0
        ? summaries.reduce((sum, summary) => sum + summary.averagePayloadBytes * summary.totalTasks, 0) /
          totalTasks
        : 0;
    const avgTokens =
      totalTasks > 0
        ? summaries.reduce((sum, summary) => sum + summary.averageEstimatedTokens * summary.totalTasks, 0) /
          totalTasks
        : 0;

    console.log(`\n=== Combined Discovery Summary ===`);
    console.log(`Average usefulness: ${(avgUsefulness * 100).toFixed(0)}%`);
    console.log(`Average payload: ${Math.round(avgPayload)} bytes`);
    console.log(`Average estimated tokens: ${Math.round(avgTokens)}`);
    console.log(`=================================\n`);
    return;
  }

  const total = summaries.reduce((sum, summary) => sum + summary.total, 0);
  const top1Correct = summaries.reduce((sum, summary) => sum + summary.top1Correct, 0);
  const top3RecallCount = summaries.reduce((sum, summary) => sum + summary.top3RecallCount, 0);
  const specContaminatedCount = summaries.reduce(
    (sum, summary) => sum + summary.specContaminatedCount,
    0
  );

  console.log(`\n=== Combined Summary ===`);
  console.log(
    `Top-1 Accuracy: ${top1Correct}/${total} (${((top1Correct / Math.max(total, 1)) * 100).toFixed(0)}%)`
  );
  console.log(
    `Top-3 Recall:   ${top3RecallCount}/${total} (${((top3RecallCount / Math.max(total, 1)) * 100).toFixed(0)}%)`
  );
  console.log(
    `Spec Contamination: ${specContaminatedCount}/${total} (${((specContaminatedCount / Math.max(total, 1)) * 100).toFixed(0)}%)`
  );
  console.log(`========================\n`);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', default: false },
      'skip-reindex': { type: 'boolean', default: false },
      'no-rerank': { type: 'boolean', default: false },
      'no-redact': { type: 'boolean', default: false },
      mode: { type: 'string', default: 'retrieval' },
      'fixture-a': { type: 'string' },
      'fixture-b': { type: 'string' },
      protocol: { type: 'string' },
      'competitor-results': { type: 'string' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(usage);
    process.exit(0);
  }

  if (positionals.length < 1 || positionals.length > 2) {
    console.error(usage);
    process.exit(1);
  }

  printHeader(packageJson.version);

  const codebaseA = positionals[0];
  const codebaseB = positionals[1];
  const mode = values.mode === 'discovery' ? 'discovery' : 'retrieval';
  const fixtureA = values['fixture-a']
    ? path.resolve(values['fixture-a'])
    : mode === 'discovery'
      ? defaultDiscoveryFixtureA
      : defaultFixtureA;
  const fixtureB = values['fixture-b']
    ? path.resolve(values['fixture-b'])
    : mode === 'discovery'
      ? defaultDiscoveryFixtureB
      : defaultFixtureB;
  const protocolPath = values.protocol
    ? path.resolve(values.protocol)
    : defaultDiscoveryProtocol;
  const comparatorResultsPath = values['competitor-results']
    ? path.resolve(values['competitor-results'])
    : null;

  const sharedOptions = {
    mode,
    skipReindex: values['skip-reindex'],
    noRerank: values['no-rerank'],
    redactPaths: !values['no-redact']
  };

  const summaryA = await runSingleEvaluation({
    label: 'A',
    codebasePath: codebaseA,
    fixturePath: fixtureA,
    ...sharedOptions
  });

  const summaries = [summaryA];
  let passesAllGates = summaryA.passesGate;

  if (codebaseB) {
    const summaryB = await runSingleEvaluation({
      label: 'B',
      codebasePath: codebaseB,
      fixturePath: fixtureB,
      ...sharedOptions
    });

    summaries.push(summaryB);
    passesAllGates =
      mode === 'discovery' ? passesAllGates : passesAllGates && summaryB.passesGate;
  }

  if (mode === 'discovery') {
    const combinedSummary = combineDiscoverySummaries(summaries);
    const protocol = loadFixture(protocolPath);
    const comparatorEvidence = comparatorResultsPath ? loadFixture(comparatorResultsPath) : undefined;
    const gate = evaluateDiscoveryGate({
      summary: combinedSummary,
      protocol,
      comparatorEvidence,
      suiteComplete: summaries.length > 1
    });
    combinedSummary.gate = gate;
    printCombinedSummary([combinedSummary], mode);
    console.log(formatDiscoveryReport({
      codebaseLabel: 'combined-suite',
      fixturePath: protocolPath,
      summary: combinedSummary
    }));
    process.exit(gate.status === 'failed' ? 1 : 0);
  }

  printCombinedSummary(summaries, mode);
  process.exit(passesAllGates ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(2);
});
