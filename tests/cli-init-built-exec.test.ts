import { execSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat, mkdir } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let distEntry = '';
let packedTarball = '';

beforeAll(() => {
  execSync('pnpm run build', { cwd: repoRoot, stdio: 'ignore' });
  distEntry = path.join(repoRoot, 'dist', 'index.js');
  const packOutput = execSync('npm pack --silent', { cwd: repoRoot, encoding: 'utf8' });
  const tarballName = packOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.tgz'))
    .at(-1);
  if (!tarballName) throw new Error(`npm pack did not produce a tarball: ${packOutput}`);
  packedTarball = path.join(repoRoot, tarballName);
}, 120_000);

describe('built CLI init', () => {
  it('init --dry-run via dist/index.js writes no config (Windows-style project path)', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'cbc-dist-init-'));
    const windowsStyleRoot = path.join(projectRoot, 'Example App');
    await mkdir(windowsStyleRoot, { recursive: true });
    try {
      const result = spawnSync(
        process.execPath,
        [
          distEntry,
          'init',
          '--yes',
          '--clients',
          'cursor',
          '--dry-run',
          '--root',
          windowsStyleRoot
        ],
        { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 }
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Dry run complete');
      expect(result.stdout).toContain('no files written');
      await expect(stat(path.join(windowsStyleRoot, '.cursor', 'mcp.json'))).rejects.toThrow();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('init --dry-run via npm pack install writes nothing', async () => {
    const installRoot = mkdtempSync(path.join(tmpdir(), 'cbc-packed-install-'));
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'cbc-packed-project-'));
    try {
      execSync(`npm install --no-save --ignore-scripts "${packedTarball}"`, {
        cwd: installRoot,
        stdio: 'pipe'
      });
      const entry = path.join(installRoot, 'node_modules', 'codebase-context', 'dist', 'index.js');
      const result = spawnSync(
        process.execPath,
        [
          entry,
          'init',
          '--yes',
          '--clients',
          'cursor',
          '--dry-run',
          '--root',
          projectRoot
        ],
        { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 }
      );
      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout);
      }
      expect(result.stdout).toContain('Dry run complete');
      await expect(stat(path.join(projectRoot, '.cursor', 'mcp.json'))).rejects.toThrow();
    } finally {
      rmSync(installRoot, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
