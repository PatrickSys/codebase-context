import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = resolve(scriptPath, '..');
const demoDir = resolve(scriptDir, '..');
const repoRoot = resolve(demoDir, '..', '..');
const outputDir = resolve(demoDir, 'test-results');
const configPath = resolve(outputDir, 'context-capture.config.mjs');
const reportPath = resolve(outputDir, 'context-evidence-report.json');
const receiptPath = resolve(outputDir, 'context-evidence-receipt.json');
const playwrightArtifactsDir = resolve(outputDir, 'context-evidence-artifacts');
const requirementsPath = resolve(demoDir, 'context', 'requirements.yaml');
const testAbsolutePath = resolve(demoDir, 'e2e', 'checkout.spec.ts');
const testRepoPath = 'examples/context-demo/e2e/checkout.spec.ts';
const testName = 'CART-01 removes a line and recalculates the checkout total';
const requirementRepoPath = 'examples/context-demo/context/requirements.yaml';
const capturePort = 4318;
const browserBaseUrl = `http://127.0.0.1:${capturePort}`;

function gitText(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function requireCleanTree(stage) {
  const status = gitText(['status', '--porcelain', '--untracked-files=all']);
  if (status) {
    throw new Error(`Refusing evidence capture: working tree is dirty ${stage}.\n${status}`);
  }
}

function repoRelative(filePath) {
  const path = relative(repoRoot, filePath).split(sep).join('/');
  if (!path || path === '..' || path.startsWith('../')) {
    throw new Error(`Evidence path is outside the repository: ${filePath}`);
  }
  return path;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function collectSpecs(suites, inheritedFile = '') {
  const found = [];
  for (const suite of suites ?? []) {
    const suiteFile = suite.file || inheritedFile;
    for (const spec of suite.specs ?? []) {
      const file = String(spec.file || suiteFile).replaceAll('\\', '/');
      const candidates = [resolve(demoDir, file), resolve(demoDir, 'e2e', file)];
      if (
        spec.title === testName &&
        candidates.some((candidate) => resolve(candidate) === testAbsolutePath)
      ) {
        found.push(spec);
      }
    }
    found.push(...collectSpecs(suite.suites, suiteFile));
  }
  return found;
}

function outcomeFor(spec, runnerExitCode) {
  const tests = spec.tests ?? [];
  if (tests.length === 0) return 'failed';

  const statuses = tests.flatMap((test) => (test.results ?? []).map((result) => result.status));
  if (
    tests.every(
      (test) =>
        test.expectedStatus === 'skipped' ||
        (test.results?.length > 0 && test.results.every((result) => result.status === 'skipped')),
    )
  ) {
    return 'skipped';
  }
  if (
    runnerExitCode === 0 &&
    statuses.length > 0 &&
    statuses.every((status) => status === 'passed')
  ) {
    return 'passed';
  }
  return 'failed';
}

function writeRuntimeConfig() {
  const cliModule = resolve(demoDir, 'node_modules', '@playwright', 'test', 'index.mjs');
  const config = `
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const demoDir = ${JSON.stringify(demoDir)};
const { defineConfig, devices } = await import(pathToFileURL(${JSON.stringify(cliModule)}).href);
export default defineConfig({
  testDir: resolve(demoDir, 'e2e'),
  globalTimeout: 180_000,
  outputDir: ${JSON.stringify(playwrightArtifactsDir)},
  reporter: [['json', { outputFile: ${JSON.stringify(reportPath)} }]],
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: ${JSON.stringify(browserBaseUrl)},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: ${JSON.stringify(`npm start -- --host 127.0.0.1 --port ${capturePort}`)},
    cwd: demoDir,
    url: ${JSON.stringify(browserBaseUrl)},
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
`;
  return writeFile(configPath, config, 'utf8');
}

async function main() {
  requireCleanTree('before the test run');
  const commit = gitText(['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`Unexpected Git commit: ${commit}`);

  await mkdir(outputDir, { recursive: true });
  await rm(reportPath, { force: true });
  await rm(receiptPath, { force: true });
  await writeRuntimeConfig();

  const playwrightCli = resolve(demoDir, 'node_modules', '@playwright', 'test', 'cli.js');
  const run = spawnSync(process.execPath, [playwrightCli, 'test', '--config', configPath], {
    cwd: demoDir,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 240_000,
    env: process.env,
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.error) throw run.error;

  const reportBytes = await readFile(reportPath);
  const report = JSON.parse(reportBytes.toString('utf8'));
  const matchingSpecs = collectSpecs(report.suites);
  if (matchingSpecs.length !== 1) {
    throw new Error(
      `Expected one reported ${testName} at ${testRepoPath}; found ${matchingSpecs.length}.`,
    );
  }

  const outcome = outcomeFor(matchingSpecs[0], run.status ?? 1);
  const requirementBytes = await readFile(requirementsPath);
  const { chromium } = await import(
    pathToFileURL(resolve(demoDir, 'node_modules', 'playwright', 'index.mjs')).href
  );
  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  await browser.close();

  requireCleanTree('after the test run');
  const finalCommit = gitText(['rev-parse', 'HEAD']);
  if (finalCommit !== commit) throw new Error('Git HEAD changed during evidence capture.');

  const receipt = {
    schemaVersion: 1,
    runner: 'playwright',
    runId: `playwright-${commit.slice(0, 12)}-${Date.now()}`,
    test: { path: testRepoPath, name: testName },
    outcome,
    code: { commit, clean: true },
    source: { path: requirementRepoPath, sha256: sha256(requirementBytes) },
    environment: {
      node: process.version,
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      browser: `Chromium ${browserVersion}`,
    },
    report: { path: repoRelative(reportPath), sha256: sha256(reportBytes) },
  };

  requireCleanTree('before writing the receipt');
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`Evidence receipt: ${repoRelative(receiptPath)} (${outcome})\n`);
  if (outcome !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
