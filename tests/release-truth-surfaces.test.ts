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
  const expectedVersion = packageJson.version;
  const changelog = readText('CHANGELOG.md');
  const readme = readText('README.md');
  const workflow = readText('.github/workflows/publish-npm-on-release.yml');
  const todoDoc = readOptionalText('docs/TODO.md');
  const visualsDoc = readOptionalText('docs/visuals.md');
  const packagedPaths = ['README.md', 'LICENSE', ...(packageJson.files ?? [])];

  it('keeps package metadata, release manifest, and changelog aligned', () => {
    expect(releaseManifest['.']).toBe(expectedVersion);
    expect(changelog).toContain(`## [${expectedVersion}]`);
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

  it('requires an explicit release tag for the manual publish fallback', () => {
    const manualTagInput = workflow.match(/^ {6}tag:\r?\n((?: {8}[^\r\n]*\r?\n)+)/m)?.[1] ?? '';

    expect(manualTagInput).toMatch(/^\s*required:\s*true\s*$/m);
    expect(manualTagInput).toMatch(/^\s*type:\s*string\s*$/m);
    expect(manualTagInput).not.toMatch(/^\s*default:/m);
    expect(workflow).toMatch(/^  release:\r?\n {4}types: \[published\]/m);
    expect(workflow).toContain(
      'ref: ${{ github.event.inputs.tag || github.event.release.tag_name }}'
    );
  });

  it('keeps 2.4.0 setup guidance accurate before and after publication', () => {
    const versionNotice = 'These commands use 2.4.0.';
    const fallbackNotice = 'If that version is not available on npm yet, use the published 2.2.0';
    const currentVersionGuide =
      'https://github.com/PatrickSys/codebase-context/blob/10ba0a635ff73cd5c5b011ffd5b31e7ed4656c65/docs/client-setup.md';
    const setupPages = [
      [
        'README.md',
        'npx -y codebase-context@2.4.0 init'
      ],
      [
        'docs/client-setup.md',
        'claude mcp add --scope user --transport stdio codebase-context -- npx -y codebase-context@2.4.0'
      ],
      ['docs/capabilities.md', '| **stdio** (default) |'],
      ['docs/cli.md', 'CODEBASE_ROOT=/path/to/repo npx -y codebase-context@2.4.0 status'],
      ['docs/demo.md', 'npx -y codebase-context@2.4.0 reindex'],
      ['docs/review-context.md', 'pnpm build']
    ] as const;

    for (const [path, firstCommand] of setupPages) {
      const page = readText(path);
      const noticeIndex = page.indexOf(versionNotice);
      const guideIndex = page.indexOf(currentVersionGuide);
      const commandIndex = page.indexOf(firstCommand);

      expect(
        noticeIndex,
        `${path} should explain the current-version fallback`
      ).toBeGreaterThanOrEqual(0);
      expect(guideIndex, `${path} should link the published 2.2.0 setup`).toBeGreaterThan(
        noticeIndex
      );
      expect(page.slice(noticeIndex, guideIndex)).toContain(fallbackNotice);
      expect(page.slice(noticeIndex, guideIndex)).toContain('[setup guide](');
      expect(page).not.toContain('**2.4.0 setup preview:**');
      expect(commandIndex, `${path} should retain its first runnable command`).toBeGreaterThan(0);
      expect(noticeIndex, `${path} should qualify commands before they appear`).toBeLessThan(
        commandIndex
      );
    }
  });

  it('does not describe the unpublished 2.4.0 preview as current or published', () => {
    const capabilities = readText('docs/capabilities.md');

    expect(capabilities).not.toContain('what `codebase-context` ships today');
    expect(capabilities).not.toContain('Published 2.4.0 has');
  });

  it('keeps release wording, analyzer claims and setup checks accurate', () => {
    const capabilities = readText('docs/capabilities.md');
    const setup = readText('docs/client-setup.md');
    const beforeFirstClient = setup.slice(0, setup.indexOf('## Claude Code'));

    expect(capabilities).not.toMatch(/\b2\.4\.0 (?:setup )?preview\b/i);
    expect(`${readme}\n${capabilities}`).not.toMatch(/opt-in NestJS|NestJS \(opt-in\)/i);
    expect(capabilities).not.toContain('analyzers: { nestjs: { enabled: true } }');
    expect(capabilities).not.toContain('generates HTTP setup');
    expect(setup).not.toContain('package still declares Node 18+');
    expect(beforeFirstClient).toContain('`2.2.0`');
  });
});
