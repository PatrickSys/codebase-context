import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const entrypoint = resolve(root, 'src', 'review-bin.ts');

describe('review CLI entrypoint runtime', () => {
  it('executes the package wrapper and prints help without loading a review target', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', entrypoint, '--help'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('codebase-context-review --base <git-ref>');
    expect(result.stdout).toContain('It does not call an LLM');
  }, 30_000);
});
