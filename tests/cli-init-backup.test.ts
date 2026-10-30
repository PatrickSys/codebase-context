import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleInitCli } from '../src/cli-init.js';

describe('init config backup', () => {
  let root = '';
  const previousSkipNotice = process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE;

  beforeEach(() => {
    process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE = '1';
  });

  afterEach(async () => {
    if (previousSkipNotice === undefined) delete process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE;
    else process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE = previousSkipNotice;
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
  });

  it('backs up a tiny existing config before updating', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cbc-init-backup-'));
    const configPath = path.join(root, '.mcp.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(configPath, '{ "note": "keep" }\n', 'utf8');

    await handleInitCli(['--client', 'claude-code', '--yes', '--skip-index', '--root', root]);

    expect(await readFile(`${configPath}.bak`, 'utf8')).toBe('{ "note": "keep" }\n');
    const updated = JSON.parse(await readFile(configPath, 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(updated.mcpServers['codebase-context']).toBeDefined();
  });
});
