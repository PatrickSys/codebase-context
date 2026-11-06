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

function findUnpublishedPins(path: string, page: string): string[] {
  // npm dist-tags verified 2026-11-06: https://registry.npmjs.org/-/package/codebase-context/dist-tags
  const publishedVersions = ['2.2.0', '2.3.1-beta.0'];
  // Stop at Markdown/JSON delimiters and shell operators, retaining any attached suffix.
  return [...page.matchAll(/codebase-context@(\d+\.\d+\.\d+[^\s`"'<>()[\]{},;|&]*)/g)]
    .filter((match) => {
      const version = match[1];
      if (publishedVersions.includes(version)) {
        return false;
      }
      if (
        version === '2.4.0' &&
        (path === 'docs/review-context.md' || path === 'docs/client-setup.md')
      ) {
        const index = match.index ?? 0;
        const surroundingText = page.slice(
          Math.max(0, index - 300),
          Math.min(page.length, index + 300)
        );
        if (/requires\s+(?:the\s+unpublished\s+)?2\.4\.0/i.test(surroundingText)) {
          return false;
        }
      }
      return true;
    })
    .map((match) => `${path}: ${match[0]}`);
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

  it('keeps pinned install commands on the published npm version', () => {
    const userFacingDocs = [
      'README.md',
      'docs/capabilities.md',
      'docs/cli.md',
      'docs/client-setup.md',
      'docs/demo.md',
      'docs/review-context.md',
      'docs/templates.md'
    ];
    const pinnedCommands = userFacingDocs.flatMap((path) => {
      const page = readOptionalText(path);
      if (!page) return [];
      return findUnpublishedPins(path, page);
    });

    expect(pinnedCommands).toEqual([]);
    expect(readText('README.md')).toContain('npx -y codebase-context');
    expect(readText('docs/client-setup.md')).toContain('npx -y codebase-context');
    expect(readText('docs/client-setup.md')).toContain(
      'node /path/to/codebase-context/dist/index.js init'
    );
    expect(readText('docs/client-setup.md')).not.toContain('codebase-context@2.4.0 init');
    expect(readText('docs/review-context.md')).toContain('--package=codebase-context@2.4.0');
  });

  it.each<[string, string, string[]]>([
    ['stable in backticks', '`codebase-context@2.2.0`', []],
    ['beta in backticks', '`codebase-context@2.3.1-beta.0`', []],
    ['stable in JSON', '{"args":["codebase-context@2.2.0","init"]}', []],
    ['beta in JSON', '{"args":["codebase-context@2.3.1-beta.0","init"]}', []],
    ['stable shell command', 'npx -y codebase-context@2.2.0 init; echo done', []],
    ['beta shell command', 'npx -y codebase-context@2.3.1-beta.0 init', []],
    ['bare unpublished stable', '`codebase-context@2.3.1`', ['2.3.1']],
    ['unknown beta', '`codebase-context@2.3.1-beta.1`', ['2.3.1-beta.1']],
    ['stable prerelease suffix', '"codebase-context@2.2.0-beta.1"', ['2.2.0-beta.1']],
    ['stable build suffix', 'codebase-context@2.2.0+local', ['2.2.0+local']],
    ['beta build suffix', '`codebase-context@2.3.1-beta.0+local`', ['2.3.1-beta.0+local']],
    ['beta appended suffix', 'codebase-context@2.3.1-beta.0extra init', ['2.3.1-beta.0extra']],
    ['beta extra prerelease', 'codebase-context@2.3.1-beta.0.1', ['2.3.1-beta.0.1']],
    ['beta hyphen suffix', 'codebase-context@2.3.1-beta.0-extra', ['2.3.1-beta.0-extra']],
    ['beta slash suffix', 'codebase-context@2.3.1-beta.0/extra', ['2.3.1-beta.0/extra']],
    [
      'unknown version in JSON',
      '{"args":["codebase-context@9.8.7-rc.1+build"]}',
      ['9.8.7-rc.1+build']
    ],
    ['comma boundary', '(codebase-context@2.2.0), "codebase-context@2.3.1-beta.0"', []],
    ['shell operators', 'codebase-context@2.2.0; codebase-context@2.3.1-beta.0&&echo ok', []],
    ['shell redirection', 'codebase-context@2.2.0>log | codebase-context@2.3.1-beta.0', []],
    [
      'multiple rejected pins',
      '`codebase-context@2.2.0-beta.1` "codebase-context@2.3.1-beta.1"',
      ['2.2.0-beta.1', '2.3.1-beta.1']
    ]
  ])('classifies the complete pinned version: %s', (_name, page, versions) => {
    expect(findUnpublishedPins('README.md', page)).toEqual(
      versions.map((version) => `README.md: codebase-context@${version}`)
    );
  });

  it.each<[string, string, string, string[]]>([
    [
      'review preview',
      'docs/review-context.md',
      'Requires the unpublished 2.4.0: `codebase-context@2.4.0`',
      []
    ],
    ['client preview', 'docs/client-setup.md', 'Requires 2.4.0: `codebase-context@2.4.0`', []],
    ['wrong preview page', 'README.md', 'Requires 2.4.0: `codebase-context@2.4.0`', ['2.4.0']],
    ['missing preview context', 'docs/review-context.md', '`codebase-context@2.4.0`', ['2.4.0']],
    [
      'distant preview context',
      'docs/review-context.md',
      'Requires 2.4.0' + ' '.repeat(301) + '`codebase-context@2.4.0`',
      ['2.4.0']
    ],
    [
      'preview prerelease suffix',
      'docs/review-context.md',
      'Requires 2.4.0: `codebase-context@2.4.0-beta.1`',
      ['2.4.0-beta.1']
    ],
    [
      'preview build suffix',
      'docs/client-setup.md',
      'Requires 2.4.0: `codebase-context@2.4.0+local`',
      ['2.4.0+local']
    ],
    [
      'preview appended suffix',
      'docs/review-context.md',
      'Requires 2.4.0: `codebase-context@2.4.0extra`',
      ['2.4.0extra']
    ]
  ])('preserves the contextual preview exception: %s', (_name, path, page, versions) => {
    expect(findUnpublishedPins(path, page)).toEqual(
      versions.map((version) => `${path}: codebase-context@${version}`)
    );
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
