#!/usr/bin/env node
/**
 * Search quality evaluation runner (single canonical script).
 *
 * Re-indexes a target codebase with the current model+chunking settings
 * and runs the eval harness from tests/fixtures/eval-angular-spotify.json.
 * Paths in output are redacted by default for publishable logs; use
 * --no-redact for full paths (e.g. internal runs).
 *
 * Usage: node scripts/run-eval.mjs <path-to-codebase> [--skip-reindex] [--no-rerank] [--no-redact]
 */

import path from 'path';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { CodebaseIndexer } from '../dist/core/indexer.js';
import { CodebaseSearcher } from '../dist/core/search.js';
import { analyzerRegistry } from '../dist/core/analyzer-registry.js';
import { AngularAnalyzer } from '../dist/analyzers/angular/index.js';
import { GenericAnalyzer } from '../dist/analyzers/generic/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureArg = process.argv.find(arg => arg.startsWith('--fixture='));
const fixturePath = fixtureArg
  ? path.resolve(fixtureArg.split('=')[1])
  : path.join(__dirname, '..', 'tests', 'fixtures', 'eval-angular-spotify.json');
const evalFixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

// Register analyzers
analyzerRegistry.register(new AngularAnalyzer());
analyzerRegistry.register(new GenericAnalyzer());

function isTestFile(filePath) {
  const n = filePath.toLowerCase().replace(/\\/g, '/');
  return n.includes('.spec.') || n.includes('.test.') || n.includes('/e2e/') ||
    n.includes('/__tests__/');
}

function matchesPattern(filePath, patterns) {
  const n = filePath.toLowerCase().replace(/\\/g, '/');
  return patterns.some(p => n.includes(p.toLowerCase()));
}

function hashPath(filePath) {
  return crypto.createHash('sha1').update(filePath.toLowerCase()).digest('hex').slice(0, 8);
}

function formatPath(filePath, redactPaths) {
  if (!filePath) return 'none';
  const normalized = filePath.replace(/\\/g, '/');
  if (!redactPaths) return normalized;
  const base = normalized.split('/').pop() || normalized;
  return `path#${hashPath(normalized)}/${base}`;
}

async function main() {
  const rootPath = process.argv[2];
  if (!rootPath) {
    console.error('Usage: node scripts/run-eval.mjs <path-to-codebase> [--skip-reindex] [--no-rerank] [--no-redact]');
    process.exit(1);
  }

  const resolvedPath = path.resolve(rootPath);
  const redactPaths = !process.argv.includes('--no-redact');
  console.log(`\n=== v1.6.0 Search Quality Evaluation ===`);
  console.log(`Target: ${redactPaths ? `<repo#${hashPath(resolvedPath)}>` : resolvedPath}`);
  console.log(`Model: ${process.env.EMBEDDING_MODEL || 'Xenova/bge-small-en-v1.5 (default)'}`);

  // Phase 1: Re-index
  const skipReindex = process.argv.includes('--skip-reindex');
  if (!skipReindex) {
    console.log(`\n--- Phase 1: Re-indexing ---`);
    const indexer = new CodebaseIndexer({
      rootPath: resolvedPath,
      onProgress: (p) => {
        if (p.phase === 'embedding' || p.phase === 'complete') {
          process.stderr.write(`\r[${p.phase}] ${p.percentage}% (${p.filesProcessed}/${p.totalFiles} files)`);
        }
      }
    });
    const stats = await indexer.index();
    console.log(`\nIndexing complete: ${stats.indexedFiles} files, ${stats.totalChunks} chunks in ${stats.duration}ms`);
  } else {
    console.log(`\n--- Phase 1: Skipping re-index (--skip-reindex) ---`);
  }

  // Phase 2: Run eval harness
  const noRerank = process.argv.includes('--no-rerank');
  console.log(`\n--- Phase 2: Running ${evalFixture.queries.length}-query eval harness ---`);
  console.log(`Reranker: ${noRerank ? 'DISABLED' : 'enabled (ambiguity-triggered, Xenova/ms-marco-MiniLM-L-6-v2)'}`);
  console.log(`File-level dedupe: enabled`);
  console.log(`Path output: ${redactPaths ? 'REDACTED' : 'FULL'}`);
  const searcher = new CodebaseSearcher(resolvedPath);

  const queries = evalFixture.queries;
  let top1Correct = 0;
  let top3RecallCount = 0;
  let specContaminatedCount = 0;

  for (const q of queries) {
    // Search results are already file-level deduped by the engine
    const results = await searcher.search(q.query, 5, undefined, {
      enableReranker: !noRerank
    });

    const topFile = results.length > 0 ? results[0].filePath : null;
    const top3Files = results.slice(0, 3).map(r => r.filePath);
    const topScore = results.length > 0 ? results[0].score : 0;

    // Evaluate (support both old and new fixture formats)
    const expectedPatterns = q.expectedPatterns || q.expectedTopFiles || [];
    const expectedNotPatterns = q.expectedNotPatterns || q.expectedNotTopFiles || [];

    const top1Ok = topFile !== null &&
      matchesPattern(topFile, expectedPatterns) &&
      !matchesPattern(topFile, expectedNotPatterns);

    const top3Ok = top3Files.some(
      f => matchesPattern(f, expectedPatterns) && !matchesPattern(f, expectedNotPatterns)
    );

    const specCount = top3Files.filter(f => isTestFile(f)).length;
    const contaminated = specCount >= 2;

    if (top1Ok) top1Correct++;
    if (top3Ok) top3RecallCount++;
    if (contaminated) specContaminatedCount++;

    const statusIcon = top1Ok ? 'PASS' : 'FAIL';
    const topFileShort = formatPath(topFile, redactPaths);
    const contNote = contaminated ? ' [SPEC CONTAMINATED]' : '';

    console.log(`  ${statusIcon} [${q.category}] #${q.id} "${q.query}"`);
    console.log(`       -> ${topFileShort} (score: ${topScore.toFixed(3)})${contNote}`);
    if (!top1Ok && topFile) {
      console.log(`       expected pattern: ${expectedPatterns.join(' | ')}`);
    }

    // Show top 3 for failures
    if (!top1Ok) {
      console.log(`       top 3:`);
      top3Files.forEach((f, i) => {
        const short = formatPath(f, redactPaths);
        const score = results[i]?.score?.toFixed(3) || '?';
        console.log(`         ${i + 1}. ${short} (${score})`);
      });
    }
  }

  // Summary
  const total = queries.length;
  console.log(`\n=== RESULTS ===`);
  console.log(`Top-1 Accuracy:     ${top1Correct}/${total} (${((top1Correct / total) * 100).toFixed(0)}%)`);
  console.log(`Top-3 Recall:       ${top3RecallCount}/${total} (${((top3RecallCount / total) * 100).toFixed(0)}%)`);
  console.log(`Spec Contamination: ${specContaminatedCount}/${total} (${((specContaminatedCount / total) * 100).toFixed(0)}%)`);
  const gateThreshold = Math.ceil(total * 0.7);
  const passesGate = top1Correct >= gateThreshold;
  console.log(`Gate (${gateThreshold}/${total}):${' '.repeat(Math.max(1, 8 - String(gateThreshold).length - String(total).length))}${passesGate ? 'PASS' : 'FAIL'}`);
  console.log(`\n================================\n`);

  process.exit(passesGate ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
