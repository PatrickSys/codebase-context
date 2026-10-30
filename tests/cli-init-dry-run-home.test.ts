import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleInitCli } from '../src/cli-init.js';

describe('init dry-run and scoped registration', () => {
  const previousSkipNotice = process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE;
  let projectRoot = '';
  let logs: string[] = [];

  afterEach(async () => {
    if (previousSkipNotice === undefined) delete process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE;
    else process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE = previousSkipNotice;
    if (projectRoot) await fs.rm(projectRoot, { recursive: true, force: true });
    projectRoot = '';
    logs = [];
  });

  async function runInit(args: string[]) {
    process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE = '1';
    logs = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      logs.push(parts.map(String).join(' '));
    });
    try {
      await handleInitCli(args);
    } finally {
      logSpy.mockRestore();
    }
    return logs.join('\n');
  }

  it('dry-run previews Cursor JSON without writing files', async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-init-project-'));

    const output = await runInit([
      '--client',
      'cursor',
      '--yes',
      '--dry-run',
      '--skip-index',
      '--skip-server-check',
      '--root',
      projectRoot
    ]);

    expect(output).toContain('Would create: .cursor/mcp.json');
    expect(output).toContain('Dry run complete; no changes applied.');
    await expect(fs.access(path.join(projectRoot, '.cursor', 'mcp.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('dry-run previews VS Code user CLI without running code', async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-init-project-'));

    const output = await runInit([
      '--client',
      'vscode',
      '--scope',
      'user',
      '--yes',
      '--dry-run',
      '--skip-index',
      '--skip-server-check',
      '--root',
      projectRoot
    ]);

    expect(output).toContain('Would run:');
    expect(output).toContain('--add-mcp');
    expect(output).toContain('Dry run complete; no changes applied.');
  });

  it('merges Cursor JSON and reports unchanged on repeat dry-run', async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-init-project-'));
    const cursorDir = path.join(projectRoot, '.cursor');
    await fs.mkdir(cursorDir, { recursive: true });
    await fs.writeFile(
      path.join(cursorDir, 'mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'echo', args: ['hi'] } } }, null, 2)
    );

    const first = await runInit([
      '--client',
      'cursor',
      '--yes',
      '--skip-index',
      '--skip-server-check',
      '--root',
      projectRoot
    ]);
    expect(first).toContain('Updated: .cursor/mcp.json');

    const second = await runInit([
      '--client',
      'cursor',
      '--yes',
      '--dry-run',
      '--skip-index',
      '--skip-server-check',
      '--root',
      projectRoot
    ]);
    expect(second).toContain('Unchanged: .cursor/mcp.json');

    const saved = JSON.parse(await fs.readFile(path.join(cursorDir, 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(saved.mcpServers.other).toEqual({ command: 'echo', args: ['hi'] });
    expect(saved.mcpServers['codebase-context']).toBeDefined();
  });
});
