import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  version: string;
};

describe('version flag', () => {
  it('prints the package version and exits', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve(root, 'src/index.ts'), '--version'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  it('prints the package version when invoked through an npm-style symlink', () => {
    const entrypoint = resolve(root, 'src', 'index.ts');
    const tempDirectory = mkdtempSync(join(tmpdir(), 'cbc-cli-version-bin-'));
    const linkedEntrypoint = join(tempDirectory, 'codebase-context');

    symlinkSync(entrypoint, linkedEntrypoint, 'file');
    try {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', linkedEntrypoint, '--version'],
        { cwd: root, encoding: 'utf8', timeout: 30_000 }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(packageJson.version);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
