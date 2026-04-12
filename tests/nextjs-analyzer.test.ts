import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { NextJsAnalyzer } from '../src/analyzers/nextjs/index';

describe('NextJsAnalyzer', () => {
  it('canAnalyze detects Next imports even outside app/pages paths', () => {
    const analyzer = new NextJsAnalyzer();

    expect(analyzer.canAnalyze('/tmp/file.tsx', 'import Link from "next/link";')).toBe(true);
    expect(analyzer.canAnalyze('/tmp/file.tsx', 'import { headers } from "next/headers";')).toBe(
      true
    );
    expect(analyzer.canAnalyze('/tmp/file.tsx', 'import React from "react";')).toBe(false);
  });

  it('detects app router pages, client components, and metadata exports', async () => {
    const analyzer = new NextJsAnalyzer();
    const filePath = path.join(process.cwd(), 'app', 'settings', 'page.tsx');

    const code = `
"use client";
export const metadata = { title: "Settings" };
export default function Page() { return <div />; }
`;

    const result = await analyzer.analyze(filePath, code);
    expect(result.framework).toBe('nextjs');
    expect(result.metadata.nextjs).toMatchObject({
      router: 'app',
      kind: 'page',
      routePath: '/settings',
      isClientComponent: true,
      hasMetadata: true
    });
  });

  it('handles route groups, dynamic segments, and pages router API routes', async () => {
    const analyzer = new NextJsAnalyzer();

    const groupedPage = await analyzer.analyze(
      path.join(process.cwd(), 'app', '(marketing)', '@modal', 'blog', '[id]', 'page.tsx'),
      'export default function Page() { return <div />; }'
    );
    expect(groupedPage.metadata.nextjs).toMatchObject({
      router: 'app',
      routePath: '/blog/[id]'
    });

    const apiRoute = await analyzer.analyze(
      path.join(process.cwd(), 'pages', 'api', 'health.ts'),
      'export default function handler() { return null; }'
    );
    expect(apiRoute.metadata.nextjs).toMatchObject({
      router: 'pages',
      kind: 'api',
      routePath: '/api/health'
    });
  });

  it('does not treat _app as a pages route and infers metadata variants from disk', async () => {
    const analyzer = new NextJsAnalyzer();
    const appShell = await analyzer.analyze(
      path.join(process.cwd(), 'pages', '_app.tsx'),
      'export default function App() { return null; }'
    );
    expect(appShell.metadata.nextjs).toMatchObject({
      router: 'pages',
      kind: 'unknown',
      routePath: null
    });

    const tempRoot = path.join(process.cwd(), 'tests', '.tmp', `nextjs-${randomUUID()}`);
    await mkdir(path.join(tempRoot, 'app'), { recursive: true });
    await mkdir(path.join(tempRoot, 'pages'), { recursive: true });

    try {
      await writeFile(
        path.join(tempRoot, 'package.json'),
        JSON.stringify(
          {
            name: 'tmp-next',
            dependencies: {
              next: '^14.1.0',
              react: '^18.2.0',
              'react-dom': '^18.2.0',
              tailwindcss: '^3.4.0',
              zustand: '^4.5.0',
              vitest: '^1.3.0'
            }
          },
          null,
          2
        ),
        'utf-8'
      );
      await mkdir(path.join(tempRoot, '.codebase-context'), { recursive: true });
      await writeFile(
        path.join(tempRoot, '.codebase-context', 'index.json'),
        JSON.stringify(
          {
            header: { format: 'codebase-context-keyword-index', version: '1.0.0' },
            chunks: [
              {
                filePath: 'app/page.tsx',
                startLine: 1,
                endLine: 10,
                componentType: 'page',
                layer: 'presentation'
              },
              {
                filePath: 'pages/api/health.ts',
                startLine: 1,
                endLine: 5,
                componentType: 'api',
                layer: 'infrastructure'
              }
            ]
          },
          null,
          2
        ),
        'utf-8'
      );

      const metadata = await analyzer.detectCodebaseMetadata(tempRoot);
      expect(metadata.framework).toMatchObject({
        type: 'nextjs',
        variant: 'hybrid',
        version: '14.1.0'
      });
      expect(metadata.statistics.totalFiles).toBe(2);
      expect(metadata.statistics.totalComponents).toBe(2);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not claim Next.js framework when next dependency is absent', async () => {
    const analyzer = new NextJsAnalyzer();
    const tempRoot = path.join(process.cwd(), 'tests', '.tmp', `nextjs-${randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });
    try {
      await writeFile(
        path.join(tempRoot, 'package.json'),
        JSON.stringify({ name: 'react-only', dependencies: { react: '^18', 'react-dom': '^18' } })
      );
      const metadata = await analyzer.detectCodebaseMetadata(tempRoot);
      expect(metadata.framework).toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('populates framework.indicators when Next.js is detected', async () => {
    const analyzer = new NextJsAnalyzer();
    const tempRoot = path.join(process.cwd(), 'tests', '.tmp', `nextjs-${randomUUID()}`);
    await mkdir(path.join(tempRoot, 'app'), { recursive: true });
    await mkdir(path.join(tempRoot, 'pages'), { recursive: true });
    try {
      await writeFile(
        path.join(tempRoot, 'package.json'),
        JSON.stringify({
          name: 'next-app',
          dependencies: { next: '^14', react: '^18', 'react-dom': '^18' }
        })
      );
      const metadata = await analyzer.detectCodebaseMetadata(tempRoot);
      expect(metadata.framework?.type).toBe('nextjs');
      expect(metadata.framework?.indicators).toContain('dep:next');
      expect(metadata.framework?.indicators).toContain('dep:react');
      expect(metadata.framework?.indicators).toContain('disk:app-router');
      expect(metadata.framework?.indicators).toContain('disk:pages-router');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
