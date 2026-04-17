import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function importHelper() {
  return import(pathToFileURL(path.resolve(__dirname, '..', 'scripts', 'lib', 'managed-mcp-session.mjs')).href);
}

async function importRunner() {
  return import(pathToFileURL(path.resolve(__dirname, '..', 'scripts', 'benchmark-comparators.mjs')).href);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Process ${pid} still alive after ${timeoutMs}ms`);
}

describe('managed MCP benchmark sessions', () => {
  it('kills the child when connect times out', async () => {
    const { withManagedStdioClientSession } = await importHelper();
    const hangingServer = path.resolve(__dirname, 'fixtures', 'mcp', 'hanging-server.mjs');

    let pid: number | null = null;

    await expect(
      withManagedStdioClientSession(
        {
          serverCommand: process.execPath,
          serverArgs: [hangingServer],
          connectTimeoutMs: 200,
          onSpawn: (childPid: number) => {
            pid = childPid;
          }
        },
        async () => undefined
      )
    ).rejects.toThrow('MCP client connect timed out');

    expect(pid).toBeTypeOf('number');
    await waitForProcessExit(pid as number);
  });

  it('kills the child when work fails after a successful connection', async () => {
    const { withManagedStdioClientSession } = await importHelper();
    const echoServer = path.resolve(__dirname, 'fixtures', 'mcp', 'echo-server.mjs');

    let pid: number | null = null;

    await expect(
      withManagedStdioClientSession(
        {
          serverCommand: process.execPath,
          serverArgs: [echoServer],
          connectTimeoutMs: 5000,
          onSpawn: (childPid: number) => {
            pid = childPid;
          }
        },
        async ({
          client,
          transport
        }: {
          client: {
            listTools: () => Promise<{ tools: Array<{ name: string }> }>;
          };
          transport: { pid: number | null };
        }) => {
          pid = transport.pid ?? pid;
          const tools = await client.listTools();
          expect(tools.tools.map((tool) => tool.name)).toContain('echo_search');
          throw new Error('forced failure');
        }
      )
    ).rejects.toThrow('forced failure');

    expect(pid).toBeTypeOf('number');
    await waitForProcessExit(pid as number);
  });
});

describe('benchmark comparator aggregation', () => {
  it('marks empty task payloads as pending evidence instead of ok', async () => {
    const { aggregateResults } = await importRunner();
    const aggregated = aggregateResults([
      {
        taskId: 't1',
        job: 'search',
        surface: 'search_codebase',
        usefulnessScore: 0,
        matchedSignals: [],
        missingSignals: ['results'],
        payloadBytes: 19,
        estimatedTokens: 5,
        toolCallCount: 1,
        elapsedMs: 1
      }
    ]);

    expect(aggregated.status).toBe('pending_evidence');
    expect(aggregated.reason).toMatch(/usable benchmark evidence/i);
    expect(aggregated.averageFirstRelevantHit).toBeNull();
    expect(aggregated.bestExampleUsefulnessRate).toBeNull();
  });

  it('computes ranked-hit and best-example metrics when task evidence exists', async () => {
    const { aggregateResults } = await importRunner();
    const aggregated = aggregateResults([
      {
        taskId: 'search-1',
        job: 'search',
        surface: 'search_codebase',
        usefulnessScore: 0.5,
        matchedSignals: ['results'],
        missingSignals: ['searchQuality'],
        payloadBytes: 200,
        estimatedTokens: 50,
        toolCallCount: 1,
        elapsedMs: 10,
        firstRelevantHit: 2
      },
      {
        taskId: 'find-1',
        job: 'find',
        surface: 'search_codebase',
        usefulnessScore: 1,
        matchedSignals: ['bestExample'],
        missingSignals: [],
        payloadBytes: 220,
        estimatedTokens: 55,
        toolCallCount: 1,
        elapsedMs: 12,
        bestExampleUseful: true
      }
    ]);

    expect(aggregated.status).toBe('ok');
    expect(aggregated.averageFirstRelevantHit).toBe(2);
    expect(aggregated.bestExampleUsefulnessRate).toBe(1);
  });
});

describe('raw Claude result parsing', () => {
  it('extracts files and bestExample from structured Claude output', async () => {
    const { parseRawClaudeStructuredResult } = await importRunner();
    const parsed = parseRawClaudeStructuredResult(
      JSON.stringify({
        answer: 'Use AuthInterceptor and auth.effects patterns.',
        files: ['src/auth/auth.interceptor.ts', 'src/auth/auth.effects.ts'],
        bestExample: 'src/auth/auth.interceptor.ts'
      })
    );

    expect(parsed.payload).toContain('AuthInterceptor');
    expect(parsed.topFiles).toEqual([
      'src/auth/auth.interceptor.ts',
      'src/auth/auth.effects.ts'
    ]);
    expect(parsed.bestExample).toBe('src/auth/auth.interceptor.ts');
  });

  it('extracts files and bestExample from fenced JSON Claude output', async () => {
    const { parseRawClaudeStructuredResult } = await importRunner();
    const parsed = parseRawClaudeStructuredResult(`\`\`\`json
{"answer":"Use AuthInterceptor and auth.effects patterns.","files":["src/auth/auth.interceptor.ts","src/auth/auth.effects.ts"],"bestExample":"src/auth/auth.interceptor.ts"}
\`\`\``);

    expect(parsed.payload).toContain('AuthInterceptor');
    expect(parsed.topFiles).toEqual([
      'src/auth/auth.interceptor.ts',
      'src/auth/auth.effects.ts'
    ]);
    expect(parsed.bestExample).toBe('src/auth/auth.interceptor.ts');
  });
});
