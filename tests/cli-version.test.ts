import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
});
