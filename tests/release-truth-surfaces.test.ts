import { existsSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

type PackageJson = {
  version: string;
  description: string;
  files?: string[];
};

type ReleaseManifest = {
  '.': string;
};

function readText(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf8');
}

function readOptionalText(relPath: string): string | null {
  const absPath = resolve(root, relPath);
  if (!existsSync(absPath)) {
    return null;
  }

  return readFileSync(absPath, 'utf8');
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readText(relPath)) as T;
}

function normalizePath(target: string): string {
  return target.replace(/^\.\/+/, '').replace(/\\/g, '/');
}

function stripFragment(target: string): string {
  return target.split('#', 1)[0] ?? target;
}

function isStableExternalUrl(target: string): boolean {
  return /^https?:\/\//.test(target);
}

function resolvePackagedLink(sourcePath: string, href: string): string {
  const target = normalizePath(stripFragment(href));
  if (target.startsWith('#')) {
    return target;
  }

  const normalizedSource = normalizePath(sourcePath);
  const sourceDir = normalizedSource.includes('/')
    ? normalizedSource.slice(0, normalizedSource.lastIndexOf('/'))
    : '';

  return posix.normalize(posix.join(sourceDir, target));
}

function isPackagedPath(target: string, packagedPaths: string[]): boolean {
  const normalizedTarget = normalizePath(target);
  return packagedPaths.some((entry) => {
    const normalizedEntry = normalizePath(entry);
    return (
      normalizedTarget === normalizedEntry || normalizedTarget.startsWith(`${normalizedEntry}/`)
    );
  });
}

function extractMarkdownLinks(markdown: string): string[] {
  const matches = markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  const links: string[] = [];

  for (const match of matches) {
    if (match.index != null && match.index > 0 && markdown[match.index - 1] === '!') {
      continue;
    }

    const href = match[1]?.trim();
    if (href) {
      links.push(href);
    }
  }

  return links;
}

describe('release truth surfaces', () => {
  const packageJson = readJson<PackageJson>('package.json');
  const releaseManifest = readJson<ReleaseManifest>('.release-please-manifest.json');
  const changelog = readText('CHANGELOG.md');
  const readme = readText('README.md');
  const workflow = readText('.github/workflows/publish-npm-on-release.yml');
  const releasePleaseWorkflow = readText('.github/workflows/release-please.yml');
  const registryChecklist = readText('docs/registry-sync-checklist.md');
  const todoDoc = readOptionalText('docs/TODO.md');
  const visualsDoc = readOptionalText('docs/visuals.md');
  const packagedPaths = ['README.md', 'LICENSE', ...(packageJson.files ?? [])];

  it('keeps package metadata, release manifest, and changelog aligned to 2.3.0', () => {
    expect(packageJson.version).toBe('2.3.0');
    expect(packageJson.description).toContain('Local code context for AI coding agents');
    expect(packageJson.description).toContain('semantic search');
    expect(readme).toContain("Your coding agent doesn't understand your codebase.");
    expect(releaseManifest['.']).toBe('2.3.0');
    expect(changelog).toContain('## [2.3.0]');
    expect(changelog).toContain('## Unreleased');
  });

  it('limits packaged markdown links to shipped files or stable external URLs', () => {
    const packagedMarkdownPaths = Array.from(
      new Set(['README.md', ...(packageJson.files ?? []).filter((path) => path.endsWith('.md'))])
    );
    const invalidLinks = packagedMarkdownPaths.flatMap((sourcePath) => {
      const markdown = readText(sourcePath);
      return extractMarkdownLinks(markdown).flatMap((href) => {
        if (href.startsWith('#')) {
          return [];
        }

        if (isStableExternalUrl(href)) {
          return [];
        }

        const resolvedTarget = resolvePackagedLink(sourcePath, href);
        if (isPackagedPath(resolvedTarget, packagedPaths)) {
          return [];
        }

        return [`${sourcePath} -> ${href} (resolved: ${resolvedTarget})`];
      });
    });

    expect(invalidLinks).toEqual([]);
  });

  it('keeps the npm package boundary narrow and leaves benchmark artifacts in the repo', () => {
    const packageFiles = packageJson.files ?? [];

    expect(packageFiles).toEqual(
      expect.arrayContaining([
        'dist',
        'grammars',
        'README.md',
        'LICENSE',
        'docs/cli.md',
        'docs/capabilities.md',
        'docs/client-setup.md',
        'templates'
      ])
    );
    expect(packageFiles).not.toContain('docs/benchmark.md');
    expect(packageFiles).not.toContain('docs/comparison-table.md');
    expect(packageFiles).not.toContain('results');
    expect(packageFiles).not.toContain('results/contextbench-engineering-note-summary.json');
    expect(packageFiles).not.toContain('benchmark-runs');
    expect(packageFiles).not.toContain('outputs');
    expect(packageFiles).not.toContain('.planning');
    expect(packageFiles).not.toContain('tmp');
    expect(packageFiles).not.toContain('screenshots');
    expect(packageFiles).not.toContain('logs');
    expect(registryChecklist).toContain(
      'The checked-in ContextBench summary is a repo artifact'
    );
    expect(registryChecklist).toContain('not an npm package');
  });

  it('keeps packaged proof links stable when target docs are not shipped', () => {
    const capabilitiesDoc = readText('docs/capabilities.md');
    const invalidLinks = extractMarkdownLinks(capabilitiesDoc).filter((href) => {
      if (href.startsWith('#')) {
        return false;
      }

      if (isStableExternalUrl(href)) {
        return false;
      }

      const resolvedTarget = resolvePackagedLink('docs/capabilities.md', href);
      return !isPackagedPath(resolvedTarget, packagedPaths);
    });

    expect(invalidLinks).not.toContain('../docs/benchmark.md');
    expect(invalidLinks).not.toContain('../docs/comparison-table.md');
    expect(capabilitiesDoc).toContain(
      'https://github.com/PatrickSys/codebase-context/blob/master/docs/benchmark.md'
    );
    expect(capabilitiesDoc).toContain(
      'https://github.com/PatrickSys/codebase-context/blob/master/docs/comparison-table.md'
    );
  });

  it('marks the stale launch-planning docs as historical reference only', () => {
    if (!todoDoc || !visualsDoc) {
      return;
    }

    expect(todoDoc).toContain('historical reference');
    expect(todoDoc).toContain('.planning/ROADMAP.md');
    expect(visualsDoc).toContain('Historical reference only');
    expect(visualsDoc).toContain('Historical snapshot');
  });

  it('keeps the manual publish fallback aligned to v2.3.0', () => {
    expect(workflow).toContain("description: 'Tag to publish (e.g. v2.3.0)'");
    expect(workflow).toContain("default: 'v2.3.0'");
    expect(releasePleaseWorkflow).toContain(
      "description: 'Existing release tag to publish (e.g. v2.3.0)'"
    );
  });

  it('keeps the publish workflow protected by a package preview', () => {
    expect(workflow).toContain('npm pack --dry-run --json');
    expect(releasePleaseWorkflow).toContain('npm pack --dry-run --json');
    expect(registryChecklist).toContain('npm pack --dry-run --json');
    expect(registryChecklist).toContain('README.md');
    expect(registryChecklist).toContain('docs/client-setup.md');
    expect(registryChecklist).toContain('stable GitHub URLs');
  });

  it('keeps npm publish workflows protected by tag/package-version checks', () => {
    expect(workflow).toContain('Verify tag matches package version');
    expect(workflow).toContain('EXPECTED_TAG="v${VERSION}"');
    expect(workflow).toContain('does not match package.json version');
    expect(releasePleaseWorkflow).toContain('Verify tag matches package version');
    expect(releasePleaseWorkflow).toContain('EXPECTED_TAG="v${VERSION}"');
    expect(releasePleaseWorkflow).toContain('steps.release.outputs.tag_name');
    expect(registryChecklist).toContain('tag is exactly');
    expect(registryChecklist).toContain('fail closed if the');
  });

  it('requires a live npm registry metadata check before release claims', () => {
    expect(registryChecklist).toContain(
      'npm view codebase-context version description keywords repository.url homepage --json'
    );
    expect(registryChecklist).toContain('same version, description, and keywords as `package.json`');
    expect(registryChecklist).toContain(packageJson.description);
    expect(registryChecklist).toContain('live npm registry still reports an older version');
  });

  it('requires a live GitHub repository metadata check before release claims', () => {
    expect(registryChecklist).toContain(
      'gh repo view PatrickSys/codebase-context --json description,homepageUrl,repositoryTopics'
    );
    expect(registryChecklist).toContain('GitHub repository description should use the same');
    expect(registryChecklist).toContain(packageJson.description);
    expect(registryChecklist).toContain('Do not announce the GitHub repo surface as aligned');
    expect(registryChecklist).toContain('token-savings, speed, better-output');
    expect(registryChecklist).toContain('must not claim fewer tokens');
  });

  it('keeps the owner-approved launch sequence explicit and non-publishing by default', () => {
    expect(registryChecklist).toContain('Owner-Approved Launch Sequence');
    expect(registryChecklist).toContain(
      'Do not start this sequence until the owner explicitly approves release/publish'
    );
    expect(registryChecklist).toContain(
      'pnpm exec vitest run tests/proof-truth-surfaces.test.ts tests/contextbench-publishable-methodology.test.ts tests/release-truth-surfaces.test.ts tests/mcp-client-templates.test.ts'
    );
    expect(registryChecklist).toContain('npm pack --dry-run --json');
    expect(registryChecklist).toContain(
      'It is expected to remain stale before publish; do not announce alignment yet.'
    );
    expect(registryChecklist).toContain(packageJson.description);
    expect(registryChecklist).toContain('Publish only from a release tag');
    expect(registryChecklist).toContain('After publish, rerun the live npm and GitHub metadata checks');
  });

  it('keeps the owner review bundle explicit and excludes local artifacts', () => {
    expect(registryChecklist).toContain('Reviewer Quick Read');
    expect(registryChecklist).toContain('prepares the public story for `codebase-context@2.3.0`');
    expect(registryChecklist).toContain('Product surface');
    expect(registryChecklist).toContain('Evidence surface');
    expect(registryChecklist).toContain('Release safety');
    expect(registryChecklist).toContain('Do not review this as a leaderboard or product-win claim');
    expect(registryChecklist).toContain('Owner Review Bundle');
    expect(registryChecklist).toContain('results/contextbench-engineering-note-summary.json');
    expect(registryChecklist).toContain('tests/mcp-client-templates.test.ts');
    expect(registryChecklist).toContain('Keep local-only material out of the review bundle');
    expect(registryChecklist).toContain('.planning/**');
    expect(registryChecklist).toContain('screenshots');
    expect(registryChecklist).toContain('logs');
  });
});
