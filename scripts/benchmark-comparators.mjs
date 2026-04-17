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
import { fileURLToPath, pathToFileURL } from 'url';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync, execFile } from 'child_process';
import { parseArgs } from 'util';
import { promisify } from 'util';
import { withManagedStdioClientSession } from './lib/managed-mcp-session.mjs';

const execFileAsync = promisify(execFile);

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

function normalizeRelativePath(candidate) {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.replace(/^[A-Za-z]:\//, '');
  }
  return normalized;
}

function normalizeFilesystemPath(candidate) {
  if (typeof candidate !== 'string') return null;
  return candidate.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isLikelyCodePath(candidate) {
  if (typeof candidate !== 'string') return false;
  if (!candidate.includes('/')) return false;
  const lastSegment = candidate.split('/').pop() ?? '';
  return /\.[A-Za-z0-9]+$/.test(lastSegment);
}

function collectTopFiles(value, sink = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTopFiles(item, sink);
    }
    return sink;
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (
        (key === 'file' || key === 'filePath' || key === 'path' || key === 'source') &&
        typeof nested === 'string'
      ) {
        const normalized = normalizeRelativePath(nested);
        if (normalized && isLikelyCodePath(normalized) && !sink.includes(normalized)) {
          sink.push(normalized);
        }
      }
      collectTopFiles(nested, sink);
    }
    return sink;
  }

  if (typeof value === 'string') {
    const matches = value.match(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+/g) ?? [];
    for (const match of matches) {
      const normalized = normalizeRelativePath(match);
      if (normalized && !sink.includes(normalized)) {
        sink.push(normalized);
      }
    }
  }

  return sink;
}

function extractBestExample(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractBestExample(item);
      if (candidate) return candidate;
    }
    return null;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (
      (key === 'bestExample' || key === 'best_example' || key === 'goldenFile' || key === 'example') &&
      typeof nested === 'string'
    ) {
      const normalized = normalizeRelativePath(nested);
      if (normalized) return normalized;
    }
    const candidate = extractBestExample(nested);
    if (candidate) return candidate;
  }

  return null;
}

function extractPayloadText(result) {
  const parts = [];
  if (Array.isArray(result?.content)) {
    for (const item of result.content) {
      if (typeof item?.text === 'string' && item.text.trim()) {
        parts.push(item.text.trim());
      }
    }
  }
  if (result?.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  }
  if (parts.length === 0) {
    parts.push(JSON.stringify(result));
  }
  return parts.join('\n');
}

function extractMcpResponse(result) {
  const topFiles = collectTopFiles(result?.structuredContent ?? result);
  const bestExample = extractBestExample(result?.structuredContent ?? result) ?? topFiles[0] ?? null;
  return {
    payload: extractPayloadText(result),
    ...(topFiles.length > 0 && { topFiles }),
    ...(bestExample && { bestExample })
  };
}

function parseToolTextPayload(result) {
  const textParts = Array.isArray(result?.content)
    ? result.content
        .map((item) => (typeof item?.text === 'string' ? item.text.trim() : ''))
        .filter(Boolean)
    : [];
  return textParts.join('\n');
}

function extractIndexedProjectName(listProjectsResult, rootPath) {
  const payload = parseToolTextPayload(listProjectsResult);
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload);
    const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    const normalizedRootPath = normalizeFilesystemPath(rootPath);
    const match = projects.find(
      (project) => normalizeFilesystemPath(project.root_path) === normalizedRootPath
    );
    return typeof match?.name === 'string' ? match.name : null;
  } catch {
    return null;
  }
}

function matchPatterns(candidates, patterns) {
  if (!patterns || patterns.length === 0) return null;
  const normalizedPatterns = patterns.map(normalizeText);
  for (let index = 0; index < candidates.length; index++) {
    const normalizedCandidate = normalizeText(candidates[index]);
    if (normalizedPatterns.some((pattern) => normalizedCandidate.includes(pattern))) {
      return index + 1;
    }
  }
  return null;
}

export function buildRawClaudePrompt(task, rootPath) {
  const query = task.args?.query ?? task.prompt;
  const intent =
    task.surface === 'search_codebase'
      ? 'search'
      : task.surface === 'get_team_patterns'
        ? 'find local conventions'
        : 'map/orient to the repository';

  return [
    `You are exploring a codebase at ${path.resolve(rootPath)}.`,
    `Use only Read, Grep, and Glob tools to ${intent}.`,
    `Question: ${query}`,
    'Return strict JSON with this shape:',
    '{"answer":"short concrete answer with repo terms","files":["repo-relative path in relevance order"],"bestExample":"repo-relative path or null"}',
    'Rules:',
    '- files must be repo-relative and ordered most relevant first',
    '- answer must include concrete identifiers, files, or patterns from the repo, not generic advice',
    '- bestExample must be the strongest local example if one exists, otherwise null',
    '- Output JSON only'
  ].join('\n');
}

export function parseRawClaudeStructuredResult(resultText) {
  const topFiles = [];
  let bestExample = null;
  let payload = resultText;
  const trimmed = typeof resultText === 'string' ? resultText.trim() : '';
  const fencedJsonMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidateJson = fencedJsonMatch ? fencedJsonMatch[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(candidateJson);
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.files)) {
        for (const file of parsed.files) {
          const normalized = normalizeRelativePath(file);
          if (normalized && isLikelyCodePath(normalized) && !topFiles.includes(normalized)) {
            topFiles.push(normalized);
          }
        }
      }
      const normalizedBestExample = normalizeRelativePath(parsed.bestExample);
      if (normalizedBestExample) {
        bestExample = normalizedBestExample;
      } else if (topFiles.length > 0) {
        bestExample = topFiles[0];
      }
      payload = JSON.stringify(parsed);
    }
  } catch {
    const fallbackFiles = collectTopFiles(resultText);
    for (const file of fallbackFiles) {
      if (!topFiles.includes(file)) {
        topFiles.push(file);
      }
    }
    bestExample = topFiles[0] ?? null;
  }

  return {
    payload,
    ...(topFiles.length > 0 && { topFiles }),
    ...(bestExample && { bestExample })
  };
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
const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

const COMPARATOR_ADAPTERS = [
  {
    name: 'codebase-memory-mcp',
    checkInstalled() {
      try {
        execSync('npx --yes codebase-memory-mcp --version', { stdio: 'pipe', timeout: 30000 });
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
    initTimeout: 10000,
    resolveProjectName: true,
    indexTool: null, // auto-indexes on first query
    buildTaskCall(task, { projectName }) {
      const query = task.args?.query ?? task.prompt;
      if (task.job === 'map') {
        return {
          name: 'get_architecture',
          arguments: { project: projectName }
        };
      }

      return {
        name: 'search_graph',
        arguments: {
          project: projectName,
          query,
          include_connected: true,
          limit: 10
        }
      };
    }
  },
  {
    name: 'jCodeMunch',
    checkInstalled() {
      try {
        execSync(`${pythonCmd} -c "import jcodemunch"`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    async install() {
      try {
        execSync(`${pythonCmd} -m pip install jcodemunch-mcp`, { stdio: 'pipe', timeout: 120000 });
      } catch (err) {
        throw new Error(`jCodeMunch install failed: ${err.message}`);
      }
    },
    serverCommand: pythonCmd,
    serverArgs: ['-m', 'jcodemunch.server'],
    serverEnv: {},
    initTimeout: 15000,
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
    extractPayload: null
  },
  {
    name: 'GrepAI',
    checkInstalled() {
      try {
        execSync('grepai --version', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    async install() {
      // GrepAI requires a Go binary + Ollama embedding provider. Likely setup_failed without Ollama.
      try {
        execSync('grepai --version', { stdio: 'pipe' });
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
    extractPayload: null
  },
  {
    name: 'CodeGraphContext',
    checkInstalled() {
      try {
        execSync(`${pythonCmd} -c "import codegraphcontext"`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    async install() {
      try {
        execSync(`${pythonCmd} -m pip install codegraphcontext`, { stdio: 'pipe', timeout: 120000 });
      } catch (err) {
        throw new Error(
          `CodeGraphContext install failed: ${err.message}. ` +
          'Requires Python 3.9+ and either Neo4j or FalkorDB Lite.'
        );
      }
    },
    serverCommand: pythonCmd,
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
    extractPayload: null
  },
  {
    name: 'raw Claude Code',
    checkInstalled() {
      try {
        execSync('claude --version', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    async install() {
      throw new Error(
        'raw Claude Code baseline requires the claude CLI. Install: npm install -g @anthropic-ai/claude-code'
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
    extractPayload: null
  }
];

// ---------------------------------------------------------------------------
// MCP Client runner
// ---------------------------------------------------------------------------

async function runComparatorViaMcp(adapter, rootPath, tasks) {
  return withManagedStdioClientSession(
    {
      serverCommand: adapter.serverCommand,
      serverArgs: adapter.serverArgs,
      serverEnv: adapter.serverEnv,
      cwd: path.resolve(rootPath),
      connectTimeoutMs: adapter.connectTimeout ?? 15_000
    },
    async ({ client }) => {
      if (adapter.initTimeout > 0) {
        await new Promise((resolve) => setTimeout(resolve, adapter.initTimeout));
      }

      let availableTools = [];
      try {
        const toolsResult = await client.listTools();
        availableTools = toolsResult.tools ?? [];
      } catch (err) {
        throw new Error(`Failed to list tools from ${adapter.name}: ${err.message}`);
      }

      let projectName = null;
      if (adapter.resolveProjectName && availableTools.some((tool) => tool.name === 'list_projects')) {
        try {
          const listProjectsResult = await client.callTool({
            name: 'list_projects',
            arguments: {}
          });
          projectName = extractIndexedProjectName(listProjectsResult, rootPath);
        } catch (err) {
          throw new Error(`Failed to resolve indexed project for ${adapter.name}: ${err.message}`);
        }

        if (!projectName) {
          throw new Error(
            `Could not resolve indexed project for ${adapter.name} at ${path.resolve(rootPath)}`
          );
        }
      }

      const toolNames = availableTools.map((t) => t.name);
      let searchToolName = adapter.searchTool;
      if (!searchToolName) {
        searchToolName =
          toolNames.find((n) => n.includes('search') || n.includes('query') || n.includes('find')) ??
          null;
      }

      if (!searchToolName || !toolNames.includes(searchToolName)) {
        throw new Error(
          `No suitable search tool found for ${adapter.name}. Available: ${toolNames.join(', ')}`
        );
      }

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
          throw new Error(`${adapter.name} indexing failed: ${err.message}`);
        }
      }

      const taskResults = [];
      for (const task of tasks) {
        const startMs = Date.now();
        let payload = '';
        let topFiles = [];
        let bestExample = null;
        let toolCallCount = totalToolCalls;

        try {
          const request =
            typeof adapter.buildTaskCall === 'function'
              ? adapter.buildTaskCall(task, { rootPath, projectName, toolNames })
              : {
                  name: searchToolName,
                  arguments: adapter.searchArgs(task)
                };
          const result = await client.callTool(request);
          toolCallCount++;
          const extracted =
            typeof adapter.extractPayload === 'function'
              ? adapter.extractPayload(result)
              : extractMcpResponse(result);
          payload = typeof extracted === 'string' ? extracted : extracted.payload;
          topFiles =
            extracted && typeof extracted === 'object' && Array.isArray(extracted.topFiles)
              ? extracted.topFiles
              : [];
          bestExample =
            extracted && typeof extracted === 'object' && typeof extracted.bestExample === 'string'
              ? extracted.bestExample
              : topFiles[0] ?? null;
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
        const firstRelevantHit = matchPatterns(topFiles, task.expectedFilePatterns);
        const bestExampleUseful =
          task.expectedBestExamplePatterns && task.expectedBestExamplePatterns.length > 0
            ? task.expectedBestExamplePatterns.some((pattern) =>
                normalizeText(bestExample ?? '').includes(normalizeText(pattern))
              )
            : undefined;

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
          elapsedMs,
          ...(firstRelevantHit !== null ? { firstRelevantHit } : {}),
          ...(typeof bestExampleUseful === 'boolean' ? { bestExampleUseful } : {})
        });
      }

      return taskResults;
    }
  ).catch((err) => {
    throw new Error(
      err.message.includes('timed out')
        ? `Failed to connect to ${adapter.name} MCP server: ${err.message}`
        : err.message
    );
  });
}

// ---------------------------------------------------------------------------
// raw Claude Code baseline via claude -p
// ---------------------------------------------------------------------------

async function runRawClaudeCode(rootPath, tasks) {
  const taskResults = [];

  for (const task of tasks) {
    const startMs = Date.now();
    let payload = '';
    let topFiles = [];
    let bestExample = null;

    try {
      const prompt = buildRawClaudePrompt(task, rootPath);
      const commandArgs =
        process.platform === 'win32'
          ? [
              'powershell.exe',
              [
                '-NoProfile',
                '-Command',
                'claude -p $env:CLAUDE_BENCHMARK_PROMPT --model haiku --effort low --output-format json --allowedTools Read,Grep,Glob'
              ],
              {
                timeout: 120000,
                cwd: path.resolve(rootPath),
                windowsHide: true,
                env: {
                  ...process.env,
                  CLAUDE_BENCHMARK_PROMPT: prompt
                }
              }
            ]
          : [
              'claude',
              ['-p', prompt, '--model', 'haiku', '--effort', 'low', '--output-format', 'json', '--allowedTools', 'Read,Grep,Glob'],
              {
                timeout: 120000,
                cwd: path.resolve(rootPath),
                windowsHide: true
              }
            ];
      const { stdout } = await execFileAsync(commandArgs[0], commandArgs[1], commandArgs[2]);
      try {
        const parsed = JSON.parse(stdout);
        const extracted = parseRawClaudeStructuredResult(parsed.result ?? stdout);
        payload = extracted.payload;
        topFiles = extracted.topFiles ?? [];
        bestExample = extracted.bestExample ?? null;
      } catch {
        const extracted = parseRawClaudeStructuredResult(stdout);
        payload = extracted.payload;
        topFiles = extracted.topFiles ?? [];
        bestExample = extracted.bestExample ?? null;
      }
    } catch (err) {
      if (err.code === 'ENOENT' || err.message?.includes('command not found')) {
        throw new Error('claude CLI not found');
      }
      const fallbackStdout = typeof err.stdout === 'string' ? err.stdout.trim() : '';
      if (fallbackStdout) {
        try {
          const parsed = JSON.parse(fallbackStdout);
          const extracted = parseRawClaudeStructuredResult(parsed.result ?? fallbackStdout);
          payload = extracted.payload;
          topFiles = extracted.topFiles ?? [];
          bestExample = extracted.bestExample ?? null;
        } catch {
          const extracted = parseRawClaudeStructuredResult(fallbackStdout);
          payload = extracted.payload;
          topFiles = extracted.topFiles ?? [];
          bestExample = extracted.bestExample ?? null;
        }
      }

      if (!payload) {
        const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
        console.warn(`  [raw Claude Code] Task ${task.id} error: ${stderr || err.message}`);
      }
    }

    const elapsedMs = Date.now() - startMs;
    const payloadBytes = countUtf8Bytes(payload);
    const estimatedTokens = estimateTokens(payloadBytes);
    const { usefulnessScore, matchedSignals, missingSignals } = matchSignals(
      payload,
      task.expectedSignals,
      task.forbiddenSignals
    );
    const firstRelevantHit = matchPatterns(topFiles, task.expectedFilePatterns);
    const bestExampleUseful =
      task.expectedBestExamplePatterns && task.expectedBestExamplePatterns.length > 0
        ? task.expectedBestExamplePatterns.some((pattern) =>
            normalizeText(bestExample ?? '').includes(normalizeText(pattern))
          )
        : undefined;

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
      elapsedMs,
      ...(firstRelevantHit !== null ? { firstRelevantHit } : {}),
      ...(typeof bestExampleUseful === 'boolean' ? { bestExampleUseful } : {})
    });
  }

  return taskResults;
}

// ---------------------------------------------------------------------------
// Aggregate task results into DiscoveryComparatorMetrics shape
// ---------------------------------------------------------------------------

export function aggregateResults(taskResults) {
  const n = taskResults.length;
  if (n === 0) {
    return {
      averageUsefulness: null,
      averagePayloadBytes: null,
      averageEstimatedTokens: null,
      averageFirstRelevantHit: null,
      bestExampleUsefulnessRate: null,
      status: 'pending_evidence',
      reason: 'No comparator task results were produced'
    };
  }

  const avgUsefulness = taskResults.reduce((s, r) => s + r.usefulnessScore, 0) / n;
  const avgBytes = taskResults.reduce((s, r) => s + r.payloadBytes, 0) / n;
  const avgTokens = taskResults.reduce((s, r) => s + r.estimatedTokens, 0) / n;
  const searchHits = taskResults
    .map((r) => r.firstRelevantHit)
    .filter((value) => typeof value === 'number');
  const bestExampleResults = taskResults
    .map((r) => r.bestExampleUseful)
    .filter((value) => typeof value === 'boolean');

  const toolCallCounts = taskResults.map((r) => r.toolCallCount).filter((v) => typeof v === 'number');
  const elapsedMsList = taskResults.map((r) => r.elapsedMs).filter((v) => typeof v === 'number');
  const hasMeaningfulEvidence = taskResults.some(
    (result) =>
      result.usefulnessScore > 0 ||
      typeof result.firstRelevantHit === 'number' ||
      result.bestExampleUseful === true
  );
  const status = hasMeaningfulEvidence ? 'ok' : 'pending_evidence';

  return {
    averageUsefulness: avgUsefulness,
    averagePayloadBytes: avgBytes,
    averageEstimatedTokens: avgTokens,
    averageFirstRelevantHit:
      searchHits.length > 0 ? searchHits.reduce((sum, value) => sum + value, 0) / searchHits.length : null,
    bestExampleUsefulnessRate:
      bestExampleResults.length > 0
        ? bestExampleResults.filter(Boolean).length / bestExampleResults.length
        : null,
    averageToolCallCount: toolCallCounts.length > 0 ? toolCallCounts.reduce((s, v) => s + v, 0) / toolCallCounts.length : null,
    averageElapsedMs: elapsedMsList.length > 0 ? elapsedMsList.reduce((s, v) => s + v, 0) / elapsedMsList.length : null,
    status,
    ...(status === 'pending_evidence'
      ? { reason: 'Comparator returned task payloads, but none contained usable benchmark evidence' }
      : {}),
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
            status: 'setup_failed',
            reason: 'claude CLI not found — required for baseline. Install: npm install -g @anthropic-ai/claude-code'
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

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(2);
  });
}
