import { promises as fs } from 'fs';
import path from 'path';
import { parse, type TSESTree } from '@typescript-eslint/typescript-estree';
import type {
  AnalysisResult,
  CodeChunk,
  CodeComponent,
  CodebaseMetadata,
  ExportStatement,
  FrameworkAnalyzer,
  ImportStatement
} from '../../types/index.js';
import { createChunksFromCode } from '../../utils/chunking.js';
import { categorizeDependency } from '../../utils/dependency-detection.js';
import {
  createEmptyStatistics,
  isFileNotFoundError,
  loadAnalyzerIndexStatistics,
  normalizeAnalyzerVersion,
  readAnalyzerPackageInfo
} from '../shared/metadata.js';

type DetectedPattern = { category: string; name: string };
type NextRouter = 'app' | 'pages' | 'unknown';
type NextRouteKind = 'page' | 'layout' | 'route' | 'api' | 'unknown';

interface NextRoutingInfo {
  router: NextRouter;
  kind: NextRouteKind;
  routePath: string | null;
  isClientComponent: boolean;
  hasMetadata: boolean;
}

export class NextJsAnalyzer implements FrameworkAnalyzer {
  readonly name = 'nextjs';
  readonly version = '1.0.0';
  readonly supportedExtensions = ['.tsx', '.jsx', '.ts', '.js', '.mjs', '.cjs', '.mts', '.cts'];
  readonly priority = 90;

  canAnalyze(filePath: string, content?: string): boolean {
    const extension = path.extname(filePath).toLowerCase();
    if (!this.supportedExtensions.includes(extension)) {
      return false;
    }

    if (isInAppRouter(filePath) || isInPagesRouter(filePath)) {
      return true;
    }

    return Boolean(
      content && (/\bfrom\s+['"]next\//.test(content) || /\bfrom\s+['"]next['"]/.test(content))
    );
  }

  async analyze(filePath: string, content: string): Promise<AnalysisResult> {
    const extension = path.extname(filePath).toLowerCase();
    const language =
      extension === '.ts' || extension === '.tsx' || extension === '.mts' || extension === '.cts'
        ? 'typescript'
        : 'javascript';
    const relativePath = path.relative(process.cwd(), filePath);
    const routing = analyzeRouting(filePath, content);

    const imports: ImportStatement[] = [];
    const exports: ExportStatement[] = [];
    const dependencyNames = new Set<string>();
    const components: CodeComponent[] = [];
    const detectedPatterns: DetectedPattern[] = [];

    if (routing.router === 'app') {
      detectedPatterns.push({ category: 'routing', name: 'Next.js App Router' });
    }
    if (routing.router === 'pages') {
      detectedPatterns.push({ category: 'routing', name: 'Next.js Pages Router' });
    }
    if (routing.isClientComponent) {
      detectedPatterns.push({ category: 'componentStyle', name: '"use client"' });
    }
    if (routing.kind === 'route') {
      detectedPatterns.push({ category: 'routing', name: 'Route Handler' });
    }
    if (routing.kind === 'api') {
      detectedPatterns.push({ category: 'routing', name: 'API Route' });
    }
    if (routing.hasMetadata) {
      detectedPatterns.push({ category: 'metadata', name: 'Next.js metadata' });
    }

    try {
      const program = parse(content, {
        loc: true,
        range: true,
        comment: true,
        jsx: extension.includes('x'),
        sourceType: 'module'
      });

      for (const statement of program.body) {
        if (statement.type === 'ImportDeclaration' && typeof statement.source.value === 'string') {
          const source = statement.source.value;
          imports.push({
            source,
            imports: statement.specifiers.map(getImportSpecifierName),
            isDefault: statement.specifiers.some(
              (specifier) => specifier.type === 'ImportDefaultSpecifier'
            ),
            isDynamic: false,
            line: statement.loc?.start.line
          });
          if (!source.startsWith('.') && !source.startsWith('/')) {
            dependencyNames.add(getPackageName(source));
          }
        }

        appendExports(exports, statement);
      }

      if (routing.kind !== 'unknown') {
        components.push({
          name: routing.routePath || path.basename(filePath),
          type: 'module',
          componentType: routing.kind,
          startLine: 1,
          endLine: content.split('\n').length,
          metadata: {
            nextjs: routing
          }
        });
      }
    } catch (error) {
      console.warn(`Failed to parse Next.js file ${filePath}:`, error);
    }

    const chunks = await createChunksFromCode(
      content,
      filePath,
      relativePath,
      language,
      components,
      {
        framework: 'nextjs',
        detectedPatterns,
        nextjs: routing
      }
    );

    return {
      filePath,
      language,
      framework: 'nextjs',
      components,
      imports,
      exports,
      dependencies: Array.from(dependencyNames)
        .sort()
        .map((name) => ({
          name,
          category: categorizeDependency(name)
        })),
      metadata: {
        analyzer: this.name,
        nextjs: routing,
        detectedPatterns
      },
      chunks
    };
  }

  async detectCodebaseMetadata(rootPath: string): Promise<CodebaseMetadata> {
    const metadata: CodebaseMetadata = {
      name: path.basename(rootPath),
      rootPath,
      languages: [],
      dependencies: [],
      architecture: {
        type: 'feature-based',
        layers: createEmptyStatistics().componentsByLayer,
        patterns: []
      },
      styleGuides: [],
      documentation: [],
      projectStructure: {
        type: 'single-app'
      },
      statistics: createEmptyStatistics(),
      customMetadata: {}
    };

    try {
      const packageInfo = await readAnalyzerPackageInfo(rootPath);
      const routerPresence = await detectRouterPresence(rootPath);
      metadata.name = packageInfo.projectName;
      metadata.dependencies = Object.entries(packageInfo.allDependencies).map(
        ([name, version]) => ({
          name,
          version,
          category: categorizeDependency(name)
        })
      );
      metadata.framework = {
        name: 'Next.js',
        version: normalizeAnalyzerVersion(packageInfo.allDependencies.next),
        type: 'nextjs',
        variant: getFrameworkVariant(routerPresence),
        stateManagement: detectDependencyList(packageInfo.allDependencies, [
          ['@reduxjs/toolkit', 'redux'],
          ['redux', 'redux'],
          ['zustand', 'zustand'],
          ['jotai', 'jotai'],
          ['recoil', 'recoil'],
          ['mobx', 'mobx']
        ]),
        uiLibraries: detectDependencyList(packageInfo.allDependencies, [
          ['tailwindcss', 'Tailwind'],
          ['@mui/material', 'MUI'],
          ['styled-components', 'styled-components'],
          ['@radix-ui/react-slot', 'Radix UI']
        ]),
        testingFrameworks: detectDependencyList(packageInfo.allDependencies, [
          ['vitest', 'Vitest'],
          ['jest', 'Jest'],
          ['@testing-library/react', 'Testing Library'],
          ['playwright', 'Playwright'],
          ['cypress', 'Cypress']
        ])
      };
      metadata.customMetadata = {
        nextjs: routerPresence
      };
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        console.warn('Failed to read Next.js project metadata:', error);
      }
    }

    metadata.statistics = await loadAnalyzerIndexStatistics(rootPath);
    return metadata;
  }

  summarize(chunk: CodeChunk): string {
    const nextMetadata =
      typeof chunk.metadata.nextjs === 'object' && chunk.metadata.nextjs
        ? (chunk.metadata.nextjs as Partial<NextRoutingInfo>)
        : undefined;

    if (nextMetadata?.kind && nextMetadata.routePath) {
      const componentMode = nextMetadata.isClientComponent ? 'client' : 'server';
      return `Next.js ${nextMetadata.kind} for "${nextMetadata.routePath}" (${nextMetadata.router || 'unknown'}, ${componentMode}).`;
    }

    return `Next.js code in ${path.basename(chunk.filePath)}: lines ${chunk.startLine}-${chunk.endLine}.`;
  }
}

function analyzeRouting(filePath: string, content: string): NextRoutingInfo {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const baseName = path.basename(normalizedPath, path.extname(normalizedPath));
  const router: NextRouter = isInAppRouter(filePath)
    ? 'app'
    : isInPagesRouter(filePath)
      ? 'pages'
      : 'unknown';

  let kind: NextRouteKind = 'unknown';
  if (router === 'app') {
    const fileName = path.basename(normalizedPath);
    if (fileName.startsWith('page.')) {
      kind = 'page';
    } else if (fileName.startsWith('layout.')) {
      kind = 'layout';
    } else if (fileName.startsWith('route.')) {
      kind = 'route';
    }
  } else if (router === 'pages') {
    if (normalizedPath.includes('/pages/api/') || normalizedPath.includes('/src/pages/api/')) {
      kind = 'api';
    } else if (!isPagesSystemFile(baseName)) {
      kind = 'page';
    }
  }

  return {
    router,
    kind,
    routePath: router === 'unknown' ? null : computeRoutePath(router, normalizedPath),
    isClientComponent: hasUseClientDirective(content),
    hasMetadata: /\bexport\s+(?:const|function)\s+(metadata|generateMetadata)\b/.test(content)
  };
}

function isInAppRouter(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.includes('/app/') || normalizedPath.includes('/src/app/');
}

function isInPagesRouter(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.includes('/pages/') || normalizedPath.includes('/src/pages/');
}

function computeRoutePath(
  router: Exclude<NextRouter, 'unknown'>,
  normalizedFilePath: string
): string | null {
  const pathSegments = normalizedFilePath.split('/').filter(Boolean);
  const routerDirectory = router === 'app' ? 'app' : 'pages';
  const routerIndex = pathSegments.lastIndexOf(routerDirectory);
  if (routerIndex < 0) {
    return null;
  }

  const routeSegments = pathSegments.slice(routerIndex + 1);
  const fileName = routeSegments.pop();
  if (!fileName) {
    return '/';
  }

  const baseName = path.basename(fileName, path.extname(fileName));
  if (router === 'pages' && isPagesSystemFile(baseName)) {
    return null;
  }
  if (router === 'pages' && baseName !== 'index') {
    routeSegments.push(baseName);
  }

  const cleanedSegments = routeSegments
    .filter((segment) => !segment.startsWith('(') && !segment.startsWith('@'))
    .map((segment) => (segment === 'index' ? '' : segment))
    .filter((segment) => segment.length > 0);

  const route = `/${cleanedSegments.join('/')}`;
  return route === '/' ? '/' : route.replace(/\/+/g, '/');
}

function hasUseClientDirective(content: string): boolean {
  return /^\s*(['"])use client\1\s*;?/.test(content);
}

function isPagesSystemFile(baseName: string): boolean {
  return ['_app', '_document', '_error', '_middleware'].includes(baseName);
}

async function detectRouterPresence(
  rootPath: string
): Promise<{ hasAppRouter: boolean; hasPagesRouter: boolean }> {
  const appCandidates = [path.join(rootPath, 'app'), path.join(rootPath, 'src', 'app')];
  const pagesCandidates = [path.join(rootPath, 'pages'), path.join(rootPath, 'src', 'pages')];

  return {
    hasAppRouter: await anyExists(appCandidates),
    hasPagesRouter: await anyExists(pagesCandidates)
  };
}

async function anyExists(paths: string[]): Promise<boolean> {
  for (const candidatePath of paths) {
    try {
      await fs.stat(candidatePath);
      return true;
    } catch {
      // Continue checking remaining candidates.
    }
  }

  return false;
}

function getFrameworkVariant(routerPresence: {
  hasAppRouter: boolean;
  hasPagesRouter: boolean;
}): string {
  if (routerPresence.hasAppRouter && routerPresence.hasPagesRouter) {
    return 'hybrid';
  }
  if (routerPresence.hasAppRouter) {
    return 'app-router';
  }
  if (routerPresence.hasPagesRouter) {
    return 'pages-router';
  }
  return 'unknown';
}

function detectDependencyList(
  allDependencies: Record<string, string>,
  candidates: ReadonlyArray<readonly [string, string]>
): string[] {
  return candidates
    .filter(([dependencyName]) => Boolean(allDependencies[dependencyName]))
    .map(([, label]) => label);
}

function appendExports(exports: ExportStatement[], statement: TSESTree.Statement): void {
  if (statement.type === 'ExportNamedDeclaration') {
    const declaration = statement.declaration;
    if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
      exports.push({ name: declaration.id.name, isDefault: false, type: 'function' });
      return;
    }
    if (declaration?.type === 'ClassDeclaration' && declaration.id) {
      exports.push({ name: declaration.id.name, isDefault: false, type: 'class' });
      return;
    }
    if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === 'Identifier') {
          exports.push({ name: declarator.id.name, isDefault: false, type: 'variable' });
        }
      }
      return;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.exported.type === 'Identifier') {
        exports.push({ name: specifier.exported.name, isDefault: false, type: 're-export' });
      }
    }
    return;
  }

  if (statement.type === 'ExportDefaultDeclaration') {
    exports.push({ name: 'default', isDefault: true, type: 'default' });
  }
}

function getImportSpecifierName(specifier: TSESTree.ImportClause): string {
  if (specifier.type === 'ImportDefaultSpecifier') {
    return 'default';
  }
  if (specifier.type === 'ImportNamespaceSpecifier') {
    return '*';
  }
  return 'value' in specifier.imported ? String(specifier.imported.value) : specifier.imported.name;
}

function getPackageName(importSource: string): string {
  if (importSource.startsWith('@')) {
    const [scope, name] = importSource.split('/');
    return name ? `${scope}/${name}` : importSource;
  }
  return importSource.split('/')[0] || importSource;
}
