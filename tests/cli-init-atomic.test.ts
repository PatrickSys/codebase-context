import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fault = vi.hoisted(() => ({ enabled: false, rename: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      rename: vi.fn(async (...args: Parameters<typeof actual.promises.rename>) => {
        if (fault.rename)
          throw Object.assign(new Error('simulated rename failure'), { code: 'EACCES' });
        return actual.promises.rename(...args);
      }),
      writeFile: vi.fn(async (...args: Parameters<typeof actual.promises.writeFile>) => {
        if (fault.enabled) {
          await actual.promises.writeFile(args[0], 'PARTIAL WRITE');
          throw Object.assign(new Error('simulated disk full'), { code: 'ENOSPC' });
        }
        return actual.promises.writeFile(...args);
      })
    }
  };
});
import { handleInitCli } from '../src/cli-init.js';

describe('init interrupted writes', () => {
  let root: string;
  const previousExitCode = process.exitCode;
  const previousSkipNotice = process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE;
  beforeEach(() => {
    process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE = '1';
  });
  afterEach(async () => {
    if (previousSkipNotice === undefined) delete process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE;
    else process.env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE = previousSkipNotice;
    fault.enabled = false;
    fault.rename = false;
    process.exitCode = previousExitCode;
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it('preserves the original config when publication fails after the temporary file is complete', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-init-rename-'));
    const file = path.join(root, '.mcp.json');
    const original = '{ "customSetting": "keep" }\n';
    await fs.writeFile(file, original);
    fault.rename = true;
    await handleInitCli(['--client', 'claude-code', '--yes', '--skip-index', '--root', root]);
    expect(process.exitCode).toBe(1);
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(await fs.readdir(root).then((names) => names.sort())).toEqual(
      ['.mcp.json', '.mcp.json.bak'].sort()
    );
  });
  it.each(['claude-code', 'codex'])(
    'preserves the entire existing %s config on a partial write failure',
    async (client) => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-init-write-'));
      const file =
        client === 'codex'
          ? path.join(root, '.codex', 'config.toml')
          : path.join(root, '.mcp.json');
      const original =
        client === 'codex'
          ? '# original instructions\nmodel = "keep"\n'
          : '{ "customSetting": "keep" }\n';
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, original);
      fault.enabled = true;
      await handleInitCli(['--client', client, '--yes', '--skip-index', '--root', root]);
      expect(process.exitCode).toBe(1);
      expect(await fs.readFile(file, 'utf8')).toBe(original);
      expect((await fs.readdir(path.dirname(file))).sort()).toEqual(
        [path.basename(file), `${path.basename(file)}.bak`].sort()
      );
    }
  );
});
