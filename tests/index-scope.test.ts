import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME } from '../src/constants/codebase-context.js';
import { rmWithRetries } from './test-helpers.js';

const junk = [
  'out/generated.ts', 'packages/ui/out/generated.ts',
  '.work/plan.json', '.agents/skill.ts', '.codex/tool.ts', '.cursor/rule.ts',
  '.github/agents/reviewer.ts', 'packages/ui/.agents/skill.ts',
  'coverage/report.js', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml',
  'yarn.lock', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock',
  'bun.lockb', 'src/bundle.min.js', 'src/style.min.css', 'src/app.js.map'
];

describe('index source scope', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rmWithRetries(root);
  });

  async function write(relative: string, content = 'export const sample = 1;\n') {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }

  async function fixture() {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-index-scope-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init');
    await write('src/app.ts');
    await write('nested/keep.ts');
    await write('tracked-ignored.ts');
    await write('.github/workflows/ci.yml', 'name: ci\n');
    for (const file of junk) {
      await write(file, file.endsWith('.json') || file.endsWith('.map') ? '{"value":1}\n' : undefined);
    }
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'fixture');
    await write('.gitignore', 'root-ignored.ts\ntracked-ignored.ts\n');
    await write('nested/.gitignore', 'generated.ts\n');
    await write('.git/info/exclude', 'info-ignored.ts\n');
    await write('root-ignored.ts');
    await write('info-ignored.ts');
    await write('nested/generated.ts');
    await write('fresh.ts'); // Deliberately untracked and not ignored.
  }

  async function indexed(config: { includeExcluded?: string[]; respectGitignore?: boolean; exclude?: string[] } = {}) {
    const options = { skipEmbedding: true, include: ['**/*'], ...config };
    const indexer = new CodebaseIndexer({
      rootPath: root,
      config: options,
      projectOptions: { extraFileExtensions: ['.lock', '.lockb', '.map'] }
    });
    expect((await indexer.detectMetadata()).rootPath).toBe(root);
    const stats = await indexer.index();
    const raw: unknown = JSON.parse(await fs.readFile(path.join(root, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME), 'utf8'));
    const chunks = (Array.isArray(raw) ? raw : (raw as { chunks: unknown[] }).chunks) as Array<{ filePath: string }>;
    const paths = [...new Set(chunks.map(({ filePath }) => {
      const relative = path.relative(root, filePath).replace(/\\/g, '/');
      expect(path.isAbsolute(relative) || relative.startsWith('..')).toBe(false);
      return relative;
    }))].sort();
    return { stats, paths };
  }

  it('uses nested and Git-standard ignores, retains tracked files and fresh untracked source, and skips junk', async () => {
    await fixture();
    const { stats, paths } = await indexed();
    expect(paths).toEqual(['.github/workflows/ci.yml', 'fresh.ts', 'nested/keep.ts', 'src/app.ts', 'tracked-ignored.ts']);
    expect(stats.totalFiles).toBe(5);
    expect(stats.indexedFiles).toBe(5);
  });

  it('opts specific excluded or Git-ignored source back in without admitting other junk', async () => {
    await fixture();
    const restored = ['.agents/skill.ts', 'coverage/report.js', 'nested/generated.ts', 'out/generated.ts', 'src/bundle.min.js'];
    const { paths } = await indexed({ includeExcluded: restored });
    for (const file of restored) expect(paths).toContain(file);
    expect(paths).not.toContain('.cursor/rule.ts');
    expect(paths).not.toContain('pnpm-lock.yaml');
  });

  it('keeps include/exclude selection and lets respectGitignore=false disable Git filtering', async () => {
    await fixture();
    const { paths } = await indexed({ respectGitignore: false, exclude: ['**/fresh.ts'] });
    expect(paths).toContain('root-ignored.ts');
    expect(paths).toContain('nested/generated.ts');
    expect(paths).not.toContain('fresh.ts');
    expect(paths).not.toContain('src/bundle.min.js');
  });

  it('keeps root-only gitignore behavior outside Git', async () => {
    await fixture();
    await fs.rm(path.join(root, '.git'), { recursive: true, force: true });
    const { paths } = await indexed();
    expect(paths).not.toContain('root-ignored.ts');
    expect(paths).not.toContain('tracked-ignored.ts');
    expect(paths).toContain('nested/generated.ts');
    expect(paths).toContain('fresh.ts');
  });

  it('indexes the requested subdirectory rather than its parent Git repository', async () => {
    await fixture();
    const repository = root;
    root = path.join(repository, 'nested');
    try {
      const { paths } = await indexed();
      expect(paths).toEqual(['keep.ts']);
    } finally {
      root = repository;
    }
  });
});
