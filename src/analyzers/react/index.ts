import path from 'path';
import { promises as fs } from 'fs';
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

const BUILTIN_HOOKS = new Set([
  'useState',
  'useEffect',
  'useMemo',
  'useCallback',
  'useReducer',
  'useRef',
  'useContext',
  'useLayoutEffect',
  'useImperativeHandle',
  'useDebugValue',
  'useDeferredValue',
  'useTransition',
  'useId',
  'useSyncExternalStore',
  'useInsertionEffect'
]);

const REACT_LIBRARY_SIGNALS: ReadonlyArray<{
  source: string;
  category: string;
  name: string;
}> = [
  { source: 'react-hook-form', category: 'forms', name: 'react-hook-form' },
  { source: 'zod', category: 'validation', name: 'zod' },
  { source: '@tanstack/react-query', category: 'data', name: 'tanstack-query' },
  { source: '@reduxjs/toolkit', category: 'stateManagement', name: 'redux-toolkit' },
  { source: 'tailwindcss', category: 'styling', name: 'tailwind' }
];

interface ReactAstSummary {
  components: CodeComponent[];
  builtinHooksUsed: string[];
  customHooks: string[];
  usesContext: boolean;
  usesMemoization: boolean;
  usesSuspense: boolean;
}

export class ReactAnalyzer implements FrameworkAnalyzer {
  readonly name = 'react';
  readonly version = '1.0.0';
  readonly supportedExtensions = ['.tsx', '.jsx', '.ts', '.js', '.mjs', '.cjs', '.mts', '.cts'];
  readonly priority = 80;

  canAnalyze(filePath: string, content?: string): boolean {
    const extension = path.extname(filePath).toLowerCase();
    if (!this.supportedExtensions.includes(extension)) {
      return false;
    }

    if (extension === '.tsx' || extension === '.jsx') {
      return true;
    }

    if (!content) {
      return false;
    }

    return (
      /\bfrom\s+['"]react['"]/.test(content) ||
      /\brequire\(\s*['"]react['"]\s*\)/.test(content) ||
      /\bReact\.createElement\b/.test(content) ||
      /<[A-Za-z][^>]*>/.test(content)
    );
  }

  async analyze(filePath: string, content: string): Promise<AnalysisResult> {
    const extension = path.extname(filePath).toLowerCase();
    const language =
      extension === '.ts' || extension === '.tsx' || extension === '.mts' || extension === '.cts'
        ? 'typescript'
        : 'javascript';
    const relativePath = path.relative(process.cwd(), filePath);

    const imports: ImportStatement[] = [];
    const exports: ExportStatement[] = [];
    const dependencyNames = new Set<string>();
    const importSources = new Set<string>();
    const detectedPatterns: DetectedPattern[] = [];
    let components: CodeComponent[] = [];

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
          importSources.add(getPackageName(source));
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

      const summary = summarizeReactProgram(program);
      components = summary.components;

      if (summary.usesContext) {
        detectedPatterns.push({ category: 'stateManagement', name: 'React Context' });
      }
      if (summary.usesSuspense) {
        detectedPatterns.push({ category: 'reactivity', name: 'Suspense' });
      }
      if (summary.usesMemoization) {
        detectedPatterns.push({ category: 'reactivity', name: 'Memoization' });
      }
      if (summary.customHooks.length > 0) {
        detectedPatterns.push({ category: 'reactHooks', name: 'Custom hooks' });
      }
      if (summary.builtinHooksUsed.length > 0) {
        detectedPatterns.push({ category: 'reactHooks', name: 'Built-in hooks' });
      }

      for (const signal of REACT_LIBRARY_SIGNALS) {
        if (importSources.has(signal.source)) {
          detectedPatterns.push({ category: signal.category, name: signal.name });
        }
      }
    } catch (error) {
      console.warn(`Failed to parse React file ${filePath}:`, error);
    }

    const chunks = await createChunksFromCode(
      content,
      filePath,
      relativePath,
      language,
      components,
      {
        framework: 'react',
        detectedPatterns
      }
    );

    return {
      filePath,
      language,
      framework: 'react',
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
      metadata.name = packageInfo.projectName;
      metadata.dependencies = Object.entries(packageInfo.allDependencies).map(
        ([name, version]) => ({
          name,
          version,
          category: categorizeDependency(name)
        })
      );

      // Collect evidence indicators before claiming framework.
      const indicators: string[] = [];
      if (packageInfo.allDependencies.react) indicators.push('dep:react');
      if (packageInfo.allDependencies['react-dom']) indicators.push('dep:react-dom');
      if (packageInfo.allDependencies['@types/react']) indicators.push('dep:@types/react');
      if (packageInfo.allDependencies['react-native']) indicators.push('dep:react-native');

      // Add disk-based indicators for plain JS React projects (CRA, Vite)
      try {
        await fs.stat(path.join(rootPath, 'src'));
        indicators.push('disk:src-directory');
      } catch {
        /* absent */
      }
      try {
        await fs.stat(path.join(rootPath, 'public', 'index.html'));
        indicators.push('disk:public-index-html');
      } catch {
        /* absent */
      }

      // Only claim React when the react package is an actual dependency.
      if (indicators.includes('dep:react')) {
        metadata.framework = {
          name: 'React',
          version: normalizeAnalyzerVersion(packageInfo.allDependencies.react),
          type: 'react',
          variant: 'unknown',
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
          ]),
          indicators
        };
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        console.warn('Failed to read React project metadata:', error);
      }
    }

    metadata.statistics = await loadAnalyzerIndexStatistics(rootPath);
    return metadata;
  }

  summarize(chunk: CodeChunk): string {
    const componentName =
      typeof chunk.metadata.componentName === 'string' ? chunk.metadata.componentName : undefined;
    if (componentName && chunk.componentType) {
      return `${componentName} (${chunk.componentType}) in ${path.basename(chunk.filePath)}.`;
    }
    if (componentName) {
      return `${componentName} in ${path.basename(chunk.filePath)}.`;
    }
    return `React code in ${path.basename(chunk.filePath)}: lines ${chunk.startLine}-${chunk.endLine}.`;
  }
}

function summarizeReactProgram(program: TSESTree.Program): ReactAstSummary {
  const components: CodeComponent[] = [];
  const builtinHooksUsed = new Set<string>();
  const customHooks = new Set<string>();
  let usesContext = false;
  let usesMemoization = false;
  let usesSuspense = false;

  walkAst(program, (node, parent) => {
    if (node.type === 'CallExpression') {
      const calleeName = getCalleeName(node.callee);
      if (calleeName && BUILTIN_HOOKS.has(calleeName)) {
        builtinHooksUsed.add(calleeName);
      }
      if (calleeName === 'createContext' || calleeName === 'useContext') {
        usesContext = true;
      }
      if (calleeName === 'memo' || calleeName === 'useMemo' || calleeName === 'useCallback') {
        usesMemoization = true;
      }
      if (calleeName === 'lazy') {
        usesSuspense = true;
      }
      if (
        calleeName === 'createContext' &&
        parent?.type === 'VariableDeclarator' &&
        parent.id.type === 'Identifier'
      ) {
        usesContext = true;
      }
    }

    if (node.type === 'JSXElement') {
      const tagName = getJsxTagName(node.openingElement.name);
      if (tagName === 'Suspense' || tagName === 'React.Suspense') {
        usesSuspense = true;
      }
      if (tagName?.endsWith('.Provider') || tagName?.endsWith('.Consumer')) {
        usesContext = true;
      }
    }

    if (node.type === 'FunctionDeclaration' && node.id?.name) {
      const name = node.id.name;
      if (isCustomHookName(name)) {
        customHooks.add(name);
        components.push(toComponent(name, node, 'function', 'hook', { reactType: 'custom-hook' }));
      } else if (isComponentName(name) && containsJsx(node.body)) {
        components.push(
          toComponent(name, node, 'function', 'component', { reactType: 'function-component' })
        );
      }
    }

    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      const variableName = node.id.name;
      if (
        node.init &&
        (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')
      ) {
        if (isCustomHookName(variableName)) {
          customHooks.add(variableName);
          components.push(
            toComponent(variableName, node, 'function', 'hook', { reactType: 'custom-hook' })
          );
        } else if (isComponentName(variableName) && containsJsx(node.init.body)) {
          components.push(
            toComponent(variableName, node, 'function', 'component', {
              reactType: 'function-component'
            })
          );
        }
      }
    }

    if (node.type === 'ClassDeclaration' && node.id?.name && isReactComponentSuperclass(node)) {
      components.push(
        toComponent(node.id.name, node, 'class', 'component', { reactType: 'class-component' })
      );
    }
  });

  return {
    components: dedupeComponents(components),
    builtinHooksUsed: Array.from(builtinHooksUsed).sort(),
    customHooks: Array.from(customHooks).sort(),
    usesContext,
    usesMemoization,
    usesSuspense
  };
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
  return getModuleExportedName(specifier.imported);
}

function getPackageName(importSource: string): string {
  if (importSource.startsWith('@')) {
    const [scope, name] = importSource.split('/');
    return name ? `${scope}/${name}` : importSource;
  }
  return importSource.split('/')[0] || importSource;
}

function detectDependencyList(
  allDependencies: Record<string, string>,
  candidates: ReadonlyArray<readonly [string, string]>
): string[] {
  return candidates
    .filter(([dependencyName]) => Boolean(allDependencies[dependencyName]))
    .map(([, label]) => label);
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function isCustomHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
}

function isReactComponentSuperclass(node: TSESTree.ClassDeclaration): boolean {
  const superClass = node.superClass;
  if (!superClass) {
    return false;
  }
  if (superClass.type === 'Identifier') {
    return superClass.name === 'Component' || superClass.name === 'PureComponent';
  }
  if (
    superClass.type === 'MemberExpression' &&
    superClass.object.type === 'Identifier' &&
    superClass.property.type === 'Identifier'
  ) {
    return (
      superClass.object.name === 'React' &&
      (superClass.property.name === 'Component' || superClass.property.name === 'PureComponent')
    );
  }
  return false;
}

function containsJsx(node: TSESTree.Node | TSESTree.Node[] | null): boolean {
  if (!node) {
    return false;
  }

  let found = false;
  walkAst(node, (candidate) => {
    if (candidate.type === 'JSXElement' || candidate.type === 'JSXFragment') {
      found = true;
    }
  });
  return found;
}

function getCalleeName(node: TSESTree.Expression | TSESTree.Super): string | null {
  if (node.type === 'Identifier') {
    return node.name;
  }
  if (node.type === 'Super') {
    return null;
  }
  if (
    node.type === 'MemberExpression' &&
    node.object.type === 'Identifier' &&
    node.property.type === 'Identifier'
  ) {
    return node.property.name;
  }
  return null;
}

function getJsxTagName(
  node: TSESTree.JSXTagNameExpression | TSESTree.JSXIdentifier
): string | null {
  if (node.type === 'JSXIdentifier') {
    return node.name;
  }
  if (node.type === 'JSXMemberExpression') {
    const objectName = getJsxTagName(node.object);
    const propertyName = getJsxTagName(node.property);
    return objectName && propertyName ? `${objectName}.${propertyName}` : null;
  }
  return null;
}

function getModuleExportedName(node: TSESTree.Identifier | TSESTree.StringLiteral): string {
  return node.type === 'Identifier' ? node.name : String(node.value);
}

function toComponent(
  name: string,
  node: TSESTree.FunctionDeclaration | TSESTree.VariableDeclarator | TSESTree.ClassDeclaration,
  type: string,
  componentType: string,
  metadata: Record<string, unknown>
): CodeComponent {
  return {
    name,
    type,
    componentType,
    startLine: node.loc?.start.line ?? 1,
    endLine: node.loc?.end.line ?? node.loc?.start.line ?? 1,
    metadata
  };
}

function dedupeComponents(components: CodeComponent[]): CodeComponent[] {
  const seen = new Set<string>();
  return components.filter((component) => {
    const key = `${component.name}:${component.startLine}:${component.endLine}:${component.componentType}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function walkAst(
  root: TSESTree.Node | TSESTree.Node[],
  visit: (node: TSESTree.Node, parent: TSESTree.Node | null) => void
): void {
  const pending: Array<{ node: TSESTree.Node; parent: TSESTree.Node | null }> = [];
  if (Array.isArray(root)) {
    for (const node of root) {
      pending.push({ node, parent: null });
    }
  } else {
    pending.push({ node: root, parent: null });
  }

  const visited = new Set<TSESTree.Node>();
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next || visited.has(next.node)) {
      continue;
    }
    visited.add(next.node);
    visit(next.node, next.parent);

    for (const child of getChildNodes(next.node)) {
      pending.push({ node: child, parent: next.node });
    }
  }
}

function getChildNodes(node: TSESTree.Node): TSESTree.Node[] {
  const children: TSESTree.Node[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          children.push(item);
        }
      }
    } else if (isNode(value)) {
      children.push(value);
    }
  }
  return children;
}

function isNode(value: unknown): value is TSESTree.Node {
  return value !== null && typeof value === 'object' && 'type' in value;
}
