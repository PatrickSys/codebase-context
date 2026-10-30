import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleInitCli } from '../src/cli-init.js';

describe('init dry-run and user-scoped configs', () => {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousSkipNotice = process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE;
  let tempHome = '';
  let projectRoot = '';
  let logs: string[] = [];

  afterEach(async () => {
    process.env.HOME = previousHome;
    process.env.USERPROFILE = previousUserProfile;
    if (previousSkipNotice === undefined) delete process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE;
    else process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE = previousSkipNotice;
    if (tempHome) await fs.rm(tempHome, { recursive: true, force: true });
    tempHome = '';
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

  it('dry-run writes Windsurf user config under a temp HOME without touching disk', async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-init-home-'));
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-init-project-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    await fs.mkdir(path.join(tempHome, '.codeium', 'windsurf'), { recursive: true });

    const output = await runInit([
      '--client',
      'windsurf',
      '--yes',
      '--dry-run',
      '--root',
      projectRoot
    ]);

    expect(output).toContain(`Would create: ${path.join(tempHome, '.codeium', 'windsurf', 'mcp_config.json')}`);
    expect(output).toContain('Dry run complete; no files written.');
    await expect(
      fs.access(path.join(tempHome, '.codeium', 'windsurf', 'mcp_config.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('merges VS Code servers and reports an update on repeat dry-run', async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-init-home-'));
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-init-project-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    const vscodeDir = path.join(projectRoot, '.vscode');
    await fs.mkdir(vscodeDir, { recursive: true });
    await fs.writeFile(
      path.join(vscodeDir, 'mcp.json'),
      JSON.stringify(
        {
          servers: {
            other: { command: 'echo', args: ['hi'] }
          }
        },
        null,
        2
      )
    );

    const first = await runInit(['--client', 'vscode', '--yes', '--root', projectRoot]);
    expect(first).toContain('Updated: .vscode/mcp.json');

    const second = await runInit(['--client', 'vscode', '--yes', '--dry-run', '--root', projectRoot]);
    expect(second).toContain('Unchanged: .vscode/mcp.json');

    const saved = JSON.parse(await fs.readFile(path.join(vscodeDir, 'mcp.json'), 'utf8')) as {
      servers: Record<string, unknown>;
    };
    expect(saved.servers.other).toEqual({ command: 'echo', args: ['hi'] });
    expect(saved.servers['codebase-context']).toBeDefined();
  });
});
