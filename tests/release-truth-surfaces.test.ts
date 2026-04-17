import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

type PackageJson = {
  version: string;
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

function isPackagedPath(target: string, packagedPaths: string[]): boolean {
  const normalizedTarget = normalizePath(stripFragment(target));
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
  const todoDoc = readOptionalText('docs/TODO.md');
  const visualsDoc = readOptionalText('docs/visuals.md');
  const packagedPaths = ['README.md', 'LICENSE', ...(packageJson.files ?? [])];

  it('keeps package metadata, release manifest, and changelog on 2.2.0', () => {
    expect(packageJson.version).toBe('2.2.0');
    expect(releaseManifest['.']).toBe('2.2.0');
    expect(changelog).toContain('## [2.2.0]');
    expect(changelog).not.toContain('## Unreleased');
  });

  it('limits packaged README links to shipped files or stable external URLs', () => {
    const invalidLinks = extractMarkdownLinks(readme).filter((href) => {
      if (href.startsWith('#')) {
        return false;
      }

      if (isStableExternalUrl(href)) {
        return false;
      }

      return !isPackagedPath(href, packagedPaths);
    });

    expect(invalidLinks).toEqual([]);
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

  it('keeps the manual publish fallback aligned to v2.2.0', () => {
    expect(workflow).toContain("description: 'Tag to publish (e.g. v2.2.0)'");
    expect(workflow).toContain("default: 'v2.2.0'");
  });
});
