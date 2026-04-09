#!/usr/bin/env node
/**
 * Automated comparator benchmark runner for codebase-context discovery benchmark.
 *
 * Uses MCP SDK Client (StdioClientTransport) to spawn each comparator as an MCP server,
 * discover its tools, call them with frozen task queries, and measure responses.
 *
 * Usage:
 *   node scripts/benchmark-comparators.mjs --repos repos/angular-spotify,repos/excalidraw --output results/comparator-evidence.json
 *   node scripts/benchmark-comparators.mjs --dry-run
 *   node scripts/benchmark-comparators.mjs --comparator jCodeMunch --repos repos/angular-spotify --output results/comparator-evidence.json
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync, exec } from 'child_process';
import { parseArgs } from 'util';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const defaultProtocolPath = path.join(
  projectRoot,
  'tests',
  'fixtures',
  'discovery-benchmark-protocol.json'
);
const defaultFixtureA = path.join(
  projectRoot,
  'tests',
  'fixtures',
  'discovery-angular-spotify.json'
);
const defaultFixtureB = path.join(
  projectRoot,
  'tests',
  'fixtures',
  'discovery-excalidraw.json'
);

// ---------------------------------------------------------------------------
// Shared signal-matching utility (mirrors discovery-harness.ts matchSignals)
// ---------------------------------------------------------------------------

function normalizeText(value) {
  return value.toLowerCase().replace(/\\/g, '/');
}

function matchSignals(payload, expectedSignals, forbiddenSignals) {
  const normalizedPayload = normalizeText(payload);
  const matchedSignals = expectedSignals.filter((s) =>
    normalizedPayload.includes(normalizeText(s))
  );
  const missingSignals = expectedSignals.filter((s) => !matchedSignals.includes(s));
  const forbiddenHits = (forbiddenSignals ?? []).filter((s) =>
    normalizedPayload.includes(normalizeText(s))
  );
  const denominator = Math.max(expectedSignals.length, 1);
  const usefulnessScore = Math.max(
    0,
    (matchedSignals.length - forbiddenHits.length) / denominator
  );
  return { matchedSignals, missingSignals, forbiddenHits, usefulnessScore };
}

function countUtf8Bytes(str) {
  return Buffer.byteLength(str, 'utf8');
}

function estimateTokens(bytes) {
  return Math.ceil(bytes / 4);
}

// ---------------------------------------------------------------------------
// Per-comparator adapter configurations
// ---------------------------------------------------------------------------

/**
 * Each adapter defines how to install, start, index, and query a comparator.
 *
 * Fields:
 * - name: matches protocol comparator name
 * - checkInstalled(): returns true if already installed
 * - install(): installs the tool; throws on failure
 * - serverCommand / serverArgs: spawn MCP server
 * - serverEnv: optional env vars (e.g. for GrepAI's embedding provider)
 * - initTimeout: ms to wait after connect before tools are ready (for slow servers)
 * - indexTool / indexArgs(rootPath): optional tool to call for indexing
 * - indexTimeout: ms to wait for index completion
 * - searchTool: tool name for search
 * - searchArgs(task): map frozen task to tool arguments
 * - extractPayload(result): extract string payload from MCP tool response
 */
const COMPARATOR_ADAPTERS = [
  {
    name: 'codebase-memory-mcp',
    checkInstalled() {
      try {
        // Installed via curl installer to ~/.local/bin or similar; also available via npx
        execSync('which codebase-memory-mcp 2>/dev/null || npx --yes codebase-memory-mcp --version 2>/dev/null', {
          stdio: 'pipe'
        });
        return true;
      } catch {
        return false;
      }
    },
    async install() {
      // Use npx to install on-demand; the binary auto-installer requires curl
      // Try npx first (cross-platform), fall back to curl installer
      try {
        execSync('npx --yes codebase-memory-mcp --version', { stdio: 'pipe', timeout: 30000 });
      } catch {
        throw new Error(
          'codebase-memory-mcp install failed. Run: curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | sh'
        );
      }
    },
    serverCommand: 'npx',
    serverArgs: ['--yes', 'codebase-memory-mcp'],
    serverEnv: {},
    initTimeout: 5000,
    indexTool: null, // auto-indexes on first query
    searchTool: 'search_code',
    searchArgs(task) {
      return { query: task.prompt, mode: 'compact' };
    },
    extractPayload(result) {
      if (Array.isArray(result?.content)) {
        return result.content.map((c) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c))).join('\n');
      }
      return JSON.stringify(result);
    }
  },
  {
    name: 'jCodeMunch',
    checkInstalled() {
      try {
        execSync('python3 -c "import jcodemunch" 2>/dev/null', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    async install() {
      try {
        execSync('pip install jcodemunch-mcp', { stdio: 'pipe', timeout: 120000 });
      } catch (err) {
        throw new Error(`jCodeMunch install failed: ${err.message}`);
      }
    },
    serverCommand: 'python3',
    serverArgs: ['-m', 'jcodemunch.server'],
    serverEnv: {},
    initTimeout: 8000,
    indexTool: 'index_folder',
    indexArgs(rootPath) {
      return { path: path.resolve(rootPath) };
    },
    indexTimeout: 120000,
    searchTool: 'search_symbols',
    searchArgs(task) {
      return {
        query: task.prompt,
        token_budget: 4000,
        detail_level: 'compact'
      };
    },
    extractPayload(result) {
      if (Array.isArray(result?.content)) {
        return result.content.map((c) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c))).join('\n');
      }
      return JSON.stringify(result);
    }
  },
  {
    name: 'GrepAI',
    checkInstalled() {
      try {
        execSync('which grepai 2>/dev/null', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    async install() {
      // GrepAI requires a Go binary + Ollama embedding provider. Likely setup_failed without Ollama.
      try {
        execSync('which grepai', { stdio: 'pipe' });
      } catch {
        throw new Error(
          'GrepAI requires Go binary installation (Homebrew: brew install yoanbernabeu/tap/grepai) ' +
          'and Ollama running locally with nomic-embed-text model. ' +
          'See: https://github.com/yoanbernabeu/grepai'
        );
      }
    },
    serverCommand: 'grepai',
    serverArgs: ['mcp'],
    serverEnv: {},
    initTimeout: 10000,
    indexTool: null, // uses fsnotify watcher
    searchTool: 'grepai_search',
    searchArgs(task) {
      return { query: task.prompt };
    },
    extractPayload(result) {
      if (Array.isArray(result?.content)) {
        return result.content.map((c) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c))).join('\n');
      }
      return JSON.stringify(result);
    }
  },
  {
    name: 'CodeGraphContext',
    checkInstalled() {
      try {
        execSync('python3 -c "import codegraphcontext" 2>/dev/null', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    async install() {
      try {
        execSync('pip install codegraphcontext', { stdio: 'pipe', timeout: 120000 });
      } catch (err) {
        throw new Error(
          `CodeGraphContext install failed: ${err.message}. ` +
          'Requires Python 3.9+ and either Neo4j or FalkorDB Lite.'
        );
      }
    },
    serverCommand: 'python3',
    serverArgs: ['-m', 'codegraphcontext.server'],
    serverEnv: {},
    initTimeout: 15000,
    indexTool: 'watch_directory',
    indexArgs(rootPath) {
      return { path: path.resolve(rootPath) };
    },
    indexTimeout: 180000,
    searchTool: null, // discovered dynamically — uses graph query tools
    searchArgs(task) {
      // CodeGraphContext uses cypher-based queries; approximate with a search tool
      return { query: task.prompt };
    },
    extractPayload(result) {
      if (Array.isArray(result?.content)) {
        return result.content.map((c) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c))).join('\n');
      }
      return JSON.stringify(result);
    }
  },
  {
    name: 'raw Claude Code',
    checkInstalled() {
      try {
        execSync('claude --version 2>/dev/null', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    async install() {
      throw new Error(
        'raw Claude Code baseline requires the Claude Code CLI (claude) to be installed and authenticated. ' +
        'This is the manual-log-capture baseline — record as pending_evidence if claude CLI is unavailable.'
      );
    },
    // raw Claude Code is not an MCP server; handled separately via claude -p
    serverCommand: null,
    serverArgs: [],
    serverEnv: {},
    initTimeout: 0,
    indexTool: null,
    searchTool: null,
    searchArgs(task) {
      return { prompt: task.prompt };
    },
    extractPayload(result) {
      return typeof result === 'string' ? result : JSON.stringify(result);
    }
  }
];

// ---------------------------------------------------------------------------
// MCP Client runner
// ---------------------------------------------------------------------------

async function runComparatorViaMcp(adapter, rootPath, tasks) {
  let Client, StdioClientTransport;
  try {
    ({ Client } = await import('@modelcontextprotocol/sdk/client/index.js'));
    ({ StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js'));
  } catch (err) {
    throw new Error(`MCP SDK not available: ${err.message}`);
  }

  const transport = new StdioClientTransport({
    command: adapter.serverCommand,
    args: adapter.serverArgs,
    env: { ...process.env, ...adapter.serverEnv }
  });

  const client = new Client({ name: 'benchmark-runner', version: '1.0.0' });

  try {
    await client.connect(transport);
  } catch (err) {
    throw new Error(`Failed to connect to ${adapter.name} MCP server: ${err.message}`);
  }

  // Wait for server to be ready
  if (adapter.initTimeout > 0) {
    await new Promise((resolve) => setTimeout(resolve, adapter.initTimeout));
  }

  // Discover tools
  let availableTools = [];
  try {
    const toolsResult = await client.listTools();
    availableTools = toolsResult.tools ?? [];
  } catch (err) {
    await client.close();
    throw new Error(`Failed to list tools from ${adapter.name}: ${err.message}`);
  }

  const toolNames = availableTools.map((t) => t.name);

  // Determine search tool (may be dynamic for CodeGraphContext)
  let searchToolName = adapter.searchTool;
  if (!searchToolName) {
    // Try to find a search-like tool
    searchToolName =
      toolNames.find((n) => n.includes('search') || n.includes('query') || n.includes('find')) ??
      null;
  }

  if (!searchToolName || !toolNames.includes(searchToolName)) {
    await client.close();
    throw new Error(
      `No suitable search tool found for ${adapter.name}. Available: ${toolNames.join(', ')}`
    );
  }

  // Index the repo if needed
  let totalToolCalls = 0;
  if (adapter.indexTool && toolNames.includes(adapter.indexTool)) {
    console.log(`  [${adapter.name}] Indexing ${path.basename(rootPath)}...`);
    const indexStartMs = Date.now();
    try {
      await Promise.race([
        client.callTool({ name: adapter.indexTool, arguments: adapter.indexArgs(rootPath) }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Index timeout')), adapter.indexTimeout ?? 120000)
        )
      ]);
      totalToolCalls++;
      console.log(`  [${adapter.name}] Index complete in ${Date.now() - indexStartMs}ms`);
    } catch (err) {
      await client.close();
      throw new Error(`${adapter.name} indexing failed: ${err.message}`);
    }
  }

  // Run each task
  const taskResults = [];
  for (const task of tasks) {
    const startMs = Date.now();
    let payload = '';
    let toolCallCount = totalToolCalls;

    try {
      const result = await client.callTool({
        name: searchToolName,
        arguments: adapter.searchArgs(task)
      });
      toolCallCount++;
      payload = adapter.extractPayload(result);
    } catch (err) {
      console.warn(`  [${adapter.name}] Task ${task.id} failed: ${err.message}`);
      payload = '';
    }

    const elapsedMs = Date.now() - startMs;
    const payloadBytes = countUtf8Bytes(payload);
    const estimatedTokens = estimateTokens(payloadBytes);
    const { usefulnessScore, matchedSignals, missingSignals } = matchSignals(
      payload,
      task.expectedSignals,
      task.forbiddenSignals
    );

    taskResults.push({
      taskId: task.id,
      job: task.job,
      surface: task.surface,
      usefulnessScore,
      matchedSignals,
      missingSignals,
      payloadBytes,
      estimatedTokens,
      toolCallCount,
      elapsedMs
    });
  }

  await client.close();
  return taskResults;
}

// ---------------------------------------------------------------------------
// raw Claude Code baseline via claude -p
// ---------------------------------------------------------------------------

async function runRawClaudeCode(rootPath, tasks) {
  const taskResults = [];

  for (const task of tasks) {
    const startMs = Date.now();
    let payload = '';

    try {
      const prompt = `You are exploring a codebase at ${path.resolve(rootPath)}. Answer this question using only grep, glob, and read file operations: ${task.prompt}`;
      const { stdout } = await execAsync(
        `claude -p "${prompt.replace(/"/g, '\\"')}" --allowedTools "Read,Grep,Glob"`,
        { timeout: 60000, cwd: path.resolve(rootPath) }
      );
      payload = stdout;
    } catch (err) {
      if (err.code === 'ENOENT' || err.message?.includes('command not found')) {
        throw new Error('claude CLI not found');
      }
      console.warn(`  [raw Claude Code] Task ${task.id} error: ${err.message}`);
    }

    const elapsedMs = Date.now() - startMs;
    const payloadBytes = countUtf8Bytes(payload);
    const estimatedTokens = estimateTokens(payloadBytes);
    const { usefulnessScore, matchedSignals, missingSignals } = matchSignals(
      payload,
      task.expectedSignals,
      task.forbiddenSignals
    );

    taskResults.push({
      taskId: task.id,
      job: task.job,
      surface: task.surface,
      usefulnessScore,
      matchedSignals,
      missingSignals,
      payloadBytes,
      estimatedTokens,
      toolCallCount: null,
      elapsedMs
    });
  }

  return taskResults;
}

// ---------------------------------------------------------------------------
// Aggregate task results into DiscoveryComparatorMetrics shape
// ---------------------------------------------------------------------------

function aggregateResults(taskResults) {
  const n = taskResults.length;
  if (n === 0) return { averageUsefulness: null, averagePayloadBytes: null, averageEstimatedTokens: null, averageFirstRelevantHit: null, bestExampleUsefulnessRate: null };

  const avgUsefulness = taskResults.reduce((s, r) => s + r.usefulnessScore, 0) / n;
  const avgBytes = taskResults.reduce((s, r) => s + r.payloadBytes, 0) / n;
  const avgTokens = taskResults.reduce((s, r) => s + r.estimatedTokens, 0) / n;

  const toolCallCounts = taskResults.map((r) => r.toolCallCount).filter((v) => typeof v === 'number');
  const elapsedMsList = taskResults.map((r) => r.elapsedMs).filter((v) => typeof v === 'number');

  return {
    averageUsefulness: avgUsefulness,
    averagePayloadBytes: avgBytes,
    averageEstimatedTokens: avgTokens,
    averageFirstRelevantHit: null, // comparators don't expose ranked file lists in standard MCP responses
    bestExampleUsefulnessRate: null,
    averageToolCallCount: toolCallCounts.length > 0 ? toolCallCounts.reduce((s, v) => s + v, 0) / toolCallCounts.length : null,
    averageElapsedMs: elapsedMsList.length > 0 ? elapsedMsList.reduce((s, v) => s + v, 0) / elapsedMsList.length : null,
    status: 'ok',
    taskResults
  };
}

// ---------------------------------------------------------------------------
// Run one comparator against all repos
// ---------------------------------------------------------------------------

async function runComparator(adapter, repoPaths, allFixtures) {
  console.log(`\n=== Benchmarking: ${adapter.name} ===`);

  // Install if needed
  try {
    if (!adapter.checkInstalled()) {
      console.log(`  Installing ${adapter.name}...`);
      await adapter.install();
    } else {
      console.log(`  ${adapter.name} already installed.`);
    }
  } catch (err) {
    console.error(`  [${adapter.name}] Install failed: ${err.message}`);
    return { status: 'setup_failed', reason: err.message };
  }

  // Handle raw Claude Code separately (not an MCP server)
  if (adapter.name === 'raw Claude Code') {
    const allTaskResults = [];
    for (let i = 0; i < repoPaths.length; i++) {
      const repoPath = repoPaths[i];
      const fixture = allFixtures[i];
      console.log(`  Running raw Claude Code on ${path.basename(repoPath)}...`);
      try {
        const results = await runRawClaudeCode(repoPath, fixture.tasks);
        allTaskResults.push(...results);
      } catch (err) {
        if (err.message.includes('claude CLI not found')) {
          return {
            status: 'pending_evidence',
            reason: 'claude CLI not available. Run manually with: claude -p "<task>" --allowedTools "Read,Grep,Glob"'
          };
        }
        return { status: 'setup_failed', reason: err.message };
      }
    }
    return aggregateResults(allTaskResults);
  }

  // MCP server comparators
  if (!adapter.serverCommand) {
    return { status: 'setup_failed', reason: `No MCP server command configured for ${adapter.name}` };
  }

  const allTaskResults = [];
  for (let i = 0; i < repoPaths.length; i++) {
    const repoPath = repoPaths[i];
    const fixture = allFixtures[i];
    console.log(`  Running ${adapter.name} on ${path.basename(repoPath)} (${fixture.tasks.length} tasks)...`);
    try {
      const results = await runComparatorViaMcp(adapter, repoPath, fixture.tasks);
      allTaskResults.push(...results);
    } catch (err) {
      console.error(`  [${adapter.name}] Failed on ${path.basename(repoPath)}: ${err.message}`);
      return { status: 'setup_failed', reason: err.message };
    }
  }

  const aggregated = aggregateResults(allTaskResults);
  console.log(
    `  ${adapter.name} done: avg usefulness ${(aggregated.averageUsefulness * 100).toFixed(0)}%, ` +
    `avg tokens ${Math.round(aggregated.averageEstimatedTokens)}, ` +
    `avg tool calls ${aggregated.averageToolCallCount?.toFixed(1) ?? 'n/a'}`
  );
  return aggregated;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      repos: { type: 'string' },
      output: { type: 'string' },
      comparator: { type: 'string' },
      protocol: { type: 'string' },
      help: { type: 'boolean', default: false }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log([
      'Usage: node scripts/benchmark-comparators.mjs [options]',
      '',
      '  --repos <path1>,<path2>   Comma-separated repo paths to benchmark',
      '  --output <path>           Write comparator evidence JSON to this file',
      '  --comparator <name>       Run only this comparator (for debugging)',
      '  --protocol <path>         Override benchmark protocol path',
      '  --dry-run                 Print comparator list and exit',
      '  --help                    Show this help'
    ].join('\n'));
    process.exit(0);
  }

  const protocolPath = values.protocol ? path.resolve(values.protocol) : defaultProtocolPath;
  const protocol = JSON.parse(readFileSync(protocolPath, 'utf-8'));

  // Determine which adapters to run
  let adaptersToRun = COMPARATOR_ADAPTERS;
  if (values.comparator) {
    adaptersToRun = COMPARATOR_ADAPTERS.filter((a) => a.name === values.comparator);
    if (adaptersToRun.length === 0) {
      console.error(`Unknown comparator: ${values.comparator}`);
      console.error(`Known: ${COMPARATOR_ADAPTERS.map((a) => a.name).join(', ')}`);
      process.exit(1);
    }
  }

  if (values['dry-run']) {
    console.log('Comparator benchmark (dry-run)');
    console.log(`Protocol: ${protocolPath}`);
    console.log('');
    console.log('Comparators:');
    for (const adapter of adaptersToRun) {
      const protocolEntry = protocol.comparators.find((c) => c.name === adapter.name);
      console.log(`  ${adapter.name}`);
      console.log(`    Protocol entry: ${protocolEntry ? 'found' : 'NOT in protocol'}`);
      console.log(`    Server: ${adapter.serverCommand ? `${adapter.serverCommand} ${adapter.serverArgs.join(' ')}` : 'N/A (special handling)'}`);
      console.log(`    Search tool: ${adapter.searchTool ?? 'discovered dynamically'}`);
    }
    process.exit(0);
  }

  if (!values.repos) {
    console.error('--repos is required. Example: --repos repos/angular-spotify,repos/excalidraw');
    process.exit(1);
  }

  const repoPaths = values.repos.split(',').map((p) => path.resolve(p.trim()));

  // Validate repos exist
  for (const repoPath of repoPaths) {
    if (!existsSync(repoPath)) {
      console.error(`Repo not found: ${repoPath}`);
      process.exit(1);
    }
  }

  // Load fixtures (one per repo, matching order)
  const allFixtures = repoPaths.map((repoPath, i) => {
    const fixturePath =
      i === 0
        ? defaultFixtureA
        : defaultFixtureB;
    if (!existsSync(fixturePath)) {
      console.error(`Fixture not found: ${fixturePath}`);
      process.exit(1);
    }
    return JSON.parse(readFileSync(fixturePath, 'utf-8'));
  });

  const totalTasks = allFixtures.reduce((s, f) => s + f.tasks.length, 0);
  console.log(`\nBenchmarking ${adaptersToRun.length} comparators against ${repoPaths.length} repo(s), ${totalTasks} tasks total`);
  console.log(`Repos: ${repoPaths.map((p) => path.basename(p)).join(', ')}`);

  // Run all comparators
  const evidence = {};
  for (const adapter of adaptersToRun) {
    try {
      evidence[adapter.name] = await runComparator(adapter, repoPaths, allFixtures);
    } catch (err) {
      console.error(`Unexpected error for ${adapter.name}: ${err.message}`);
      evidence[adapter.name] = { status: 'setup_failed', reason: err.message };
    }
  }

  // Write output
  if (values.output) {
    const outputPath = path.resolve(values.output);
    const outputDir = path.dirname(outputPath);
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2));
    console.log(`\nComparator evidence written to: ${outputPath}`);
  }

  // Summary
  console.log('\n=== Summary ===');
  for (const [name, result] of Object.entries(evidence)) {
    if (result.status === 'setup_failed') {
      console.log(`  ${name}: SETUP FAILED — ${result.reason}`);
    } else if (result.status === 'pending_evidence') {
      console.log(`  ${name}: PENDING — ${result.reason}`);
    } else {
      console.log(
        `  ${name}: ok — usefulness ${(result.averageUsefulness * 100).toFixed(0)}%, ` +
        `tokens ${Math.round(result.averageEstimatedTokens)}`
      );
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
