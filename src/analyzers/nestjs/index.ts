import { promises as fs } from 'fs';
import path from 'path';
import { parse, type TSESTree } from '@typescript-eslint/typescript-estree';
import type {
  AnalysisResult,
  ArchitecturalLayer,
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
type NestComponentType =
  | 'module'
  | 'controller'
  | 'service'
  | 'repository'
  | 'provider'
  | 'guard'
  | 'interceptor'
  | 'pipe'
  | 'filter'
  | 'gateway'
  | 'resolver'
  | 'processor'
  | 'schema';

interface NestRouteInfo {
  method: string;
  path: string;
  handler: string;
  line?: number;
}

interface NestModuleMetadata {
  imports?: string[];
  providers?: string[];
  controllers?: string[];
  exports?: string[];
}

interface NestClassSummary {
  component: CodeComponent;
  routes: NestRouteInfo[];
}

const ROUTE_DECORATORS: Readonly<Record<string, string>> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Options: 'OPTIONS',
  Head: 'HEAD',
  All: 'ALL'
};

const NEST_LIBRARY_SIGNALS: ReadonlyArray<{
  source: string;
  category: string;
  name: string;
}> = [
  { source: '@nestjs/swagger', category: 'documentation', name: 'Swagger' },
  { source: '@nestjs/graphql', category: 'data', name: 'GraphQL' },
  { source: '@nestjs/mongoose', category: 'data', name: 'Mongoose' },
  { source: '@nestjs/bull', category: 'queues', name: 'Bull' },
  { source: '@nestjs/bullmq', category: 'queues', name: 'BullMQ' },
  { source: '@nestjs/schedule', category: 'scheduling', name: 'Schedule' },
  { source: '@nestjs/websockets', category: 'realtime', name: 'WebSockets' },
  { source: '@nestjs/passport', category: 'security', name: 'Passport' },
  { source: '@nestjs/terminus', category: 'health', name: 'Terminus' }
];

const TESTING_DEPENDENCIES: ReadonlyArray<readonly [string, string]> = [
  ['@nestjs/testing', 'Nest Testing'],
  ['vitest', 'Vitest'],
  ['jest', 'Jest']
];

export class NestJsAnalyzer implements FrameworkAnalyzer {
  readonly name = 'nestjs';
  readonly version = '1.0.0';
  readonly supportedExtensions = ['.ts', '.js', '.mjs', '.cjs', '.mts', '.cts'];
  readonly priority = 85;

  canAnalyze(filePath: string, content?: string): boolean {
    const extension = path.extname(filePath).toLowerCase();
    if (!this.supportedExtensions.includes(extension) || !content) {
      return false;
    }

    return /\bfrom\s+['"]@nestjs\//.test(content) || /\bNestFactory\b/.test(content);
  }

  async analyze(filePath: string, content: string): Promise<AnalysisResult> {
    const extension = path.extname(filePath).toLowerCase();
    const language =
      extension === '.ts' || extension === '.mts' || extension === '.cts'
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
        sourceType: 'module',
        experimentalDecorators: true
      });

      for (const statement of program.body) {
        if (statement.type === 'ImportDeclaration' && typeof statement.source.value === 'string') {
          const source = statement.source.value;
          const packageName = getPackageName(source);
          importSources.add(packageName);
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
            dependencyNames.add(packageName);
          }
        }

        appendExports(exports, statement);
      }

      const summaries = summarizeNestProgram(program);
      components = summaries.map((summary) => summary.component);
      addProgramPatterns(detectedPatterns, summaries, importSources);
    } catch (error) {
      console.warn(`Failed to parse NestJS file ${filePath}:`, error);
    }

    const chunks = await createChunksFromCode(
      content,
      filePath,
      relativePath,
      language,
      components,
      {
        framework: 'nestjs',
        detectedPatterns
      }
    );

    return {
      filePath,
      language,
      framework: 'nestjs',
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

      const indicators = await detectNestIndicators(rootPath, packageInfo.allDependencies);
      if (indicators.includes('dep:@nestjs/core') || indicators.includes('dep:@nestjs/common')) {
        metadata.framework = {
          name: 'NestJS',
          version: normalizeAnalyzerVersion(
            packageInfo.allDependencies['@nestjs/core'] ||
              packageInfo.allDependencies['@nestjs/common']
          ),
          type: 'nestjs',
          variant: getFrameworkVariant(packageInfo.allDependencies),
          testingFrameworks: detectDependencyList(
            packageInfo.allDependencies,
            TESTING_DEPENDENCIES
          ),
          indicators
        };
      }

      metadata.customMetadata = {
        nestjs: {
          packages: Object.keys(packageInfo.allDependencies)
            .filter((name) => name.startsWith('@nestjs/'))
            .sort()
        }
      };
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        console.warn('Failed to read NestJS project metadata:', error);
      }
    }

    metadata.statistics = await loadAnalyzerIndexStatistics(rootPath);
    return metadata;
  }

  summarize(chunk: CodeChunk): string {
    const nestMetadata =
      typeof chunk.metadata.nestjs === 'object' && chunk.metadata.nestjs
        ? (chunk.metadata.nestjs as { type?: unknown; routes?: unknown })
        : undefined;

    if (nestMetadata?.type === 'controller' && Array.isArray(nestMetadata.routes)) {
      return `NestJS controller in ${path.basename(chunk.filePath)} with ${nestMetadata.routes.length} route handlers.`;
    }
    if (typeof nestMetadata?.type === 'string') {
      return `NestJS ${nestMetadata.type} in ${path.basename(chunk.filePath)}: lines ${chunk.startLine}-${chunk.endLine}.`;
    }

    return `NestJS code in ${path.basename(chunk.filePath)}: lines ${chunk.startLine}-${chunk.endLine}.`;
  }
}

function summarizeNestProgram(program: TSESTree.Program): NestClassSummary[] {
  const summaries: NestClassSummary[] = [];

  walkAst(program, (node) => {
    if (node.type !== 'ClassDeclaration' || !node.id?.name) {
      return;
    }

    const decorators = getDecoratorNames(node);
    const type = getNestComponentType(node.id.name, decorators);
    if (!type) {
      return;
    }

    const dependencies = extractConstructorDependencies(node);
    const routes = type === 'controller' ? extractRoutes(node) : [];
    const moduleMetadata = type === 'module' ? extractModuleMetadata(node) : undefined;
    const component: CodeComponent = {
      name: node.id.name,
      type: 'class',
      componentType: type,
      startLine: node.loc?.start.line || 1,
      endLine: node.loc?.end.line || node.loc?.start.line || 1,
      layer: getComponentLayer(type),
      decorators: decorators.map((name) => ({ name })),
      dependencies,
      metadata: {
        nestjs: {
          type,
          decorators,
          routes,
          dependencies,
          ...(moduleMetadata ? { moduleMetadata } : {})
        }
      }
    };

    summaries.push({ component, routes });
  });

  return dedupeSummaries(summaries);
}

function addProgramPatterns(
  patterns: DetectedPattern[],
  summaries: NestClassSummary[],
  importSources: Set<string>
): void {
  const patternKeys = new Set<string>();
  const addPattern = (pattern: DetectedPattern): void => {
    const key = `${pattern.category}:${pattern.name}`;
    if (!patternKeys.has(key)) {
      patterns.push(pattern);
      patternKeys.add(key);
    }
  };

  for (const summary of summaries) {
    const type = summary.component.componentType;
    if (type === 'module') addPattern({ category: 'modules', name: 'Nest modules' });
    if (type === 'controller') addPattern({ category: 'routing', name: 'Controllers' });
    if (type === 'gateway') addPattern({ category: 'realtime', name: 'WebSockets' });
    if (type === 'resolver') addPattern({ category: 'data', name: 'GraphQL' });
    if (summary.routes.length > 0) addPattern({ category: 'routing', name: 'REST routes' });
    if ((summary.component.dependencies || []).length > 0) {
      addPattern({ category: 'dependencyInjection', name: 'Constructor injection' });
    }
    const decorators = getNestMetadataDecorators(summary.component);
    if (decorators.includes('UseGuards')) addPattern({ category: 'security', name: 'Guards' });
    if (decorators.some((decorator) => decorator.startsWith('Api'))) {
      addPattern({ category: 'documentation', name: 'Swagger' });
    }
  }

  for (const signal of NEST_LIBRARY_SIGNALS) {
    if (importSources.has(signal.source)) {
      addPattern({ category: signal.category, name: signal.name });
    }
  }
}

function getNestComponentType(
  className: string,
  decorators: readonly string[]
): NestComponentType | null {
  if (decorators.includes('Module')) return 'module';
  if (decorators.includes('Controller')) return 'controller';
  if (decorators.includes('WebSocketGateway')) return 'gateway';
  if (decorators.includes('Resolver')) return 'resolver';
  if (decorators.includes('Processor')) return 'processor';
  if (decorators.includes('Schema')) return 'schema';
  if (decorators.includes('Catch')) return 'filter';
  if (!decorators.includes('Injectable')) return null;

  if (/Repository$/.test(className)) return 'repository';
  if (/Guard$/.test(className)) return 'guard';
  if (/Interceptor$/.test(className)) return 'interceptor';
  if (/Pipe$/.test(className)) return 'pipe';
  if (/Filter$/.test(className)) return 'filter';
  if (/Service$/.test(className)) return 'service';
  return 'provider';
}

function getComponentLayer(type: NestComponentType): ArchitecturalLayer {
  if (type === 'controller' || type === 'resolver') return 'presentation';
  if (type === 'service') return 'business';
  if (type === 'repository' || type === 'schema') return 'data';
  if (type === 'module') return 'feature';
  if (type === 'gateway' || type === 'processor') return 'infrastructure';
  return 'core';
}

function extractRoutes(node: TSESTree.ClassDeclaration): NestRouteInfo[] {
  const controllerPath = normalizeRouteSegment(
    getDecoratorStringArgument(getDecorator(node, 'Controller')) || ''
  );
  const routes: NestRouteInfo[] = [];

  for (const member of node.body.body) {
    if (member.type !== 'MethodDefinition') continue;
    const methodName = getPropertyName(member.key);
    if (!methodName) continue;

    for (const decorator of getDecorators(member)) {
      const decoratorName = getDecoratorName(decorator);
      if (!decoratorName || !ROUTE_DECORATORS[decoratorName]) continue;
      const routePath = normalizeRouteSegment(getDecoratorStringArgument(decorator) || '');
      routes.push({
        method: ROUTE_DECORATORS[decoratorName],
        path: joinRoutePaths(controllerPath, routePath),
        handler: methodName,
        line: member.loc?.start.line
      });
    }
  }

  return routes;
}

function extractConstructorDependencies(node: TSESTree.ClassDeclaration): string[] {
  const dependencies = new Set<string>();

  for (const member of node.body.body) {
    if (member.type !== 'MethodDefinition' || member.kind !== 'constructor') continue;
    for (const parameter of member.value.params) {
      const injectToken = getInjectToken(parameter);
      if (injectToken) {
        dependencies.add(injectToken);
        continue;
      }

      const typeName = getParameterTypeName(parameter);
      if (typeName) dependencies.add(typeName);
    }
  }

  return Array.from(dependencies).sort();
}

function extractModuleMetadata(node: TSESTree.ClassDeclaration): NestModuleMetadata | undefined {
  const moduleDecorator = getDecorator(node, 'Module');
  if (!moduleDecorator || moduleDecorator.expression.type !== 'CallExpression') {
    return undefined;
  }

  const firstArgument = moduleDecorator.expression.arguments[0];
  if (!firstArgument || firstArgument.type !== 'ObjectExpression') {
    return undefined;
  }

  const metadata: NestModuleMetadata = {};
  for (const property of firstArgument.properties) {
    if (property.type !== 'Property') continue;
    const key = getPropertyName(property.key);
    if (!isModuleMetadataKey(key)) continue;
    const values = extractExpressionNames(property.value);
    if (values.length > 0) metadata[key] = values;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function extractExpressionNames(expression: TSESTree.Node): string[] {
  if (expression.type === 'ArrayExpression') {
    return expression.elements.flatMap((element) =>
      element && element.type !== 'SpreadElement' ? extractExpressionNames(element) : []
    );
  }
  if (expression.type === 'Identifier') return [expression.name];
  if (expression.type === 'Literal') return [String(expression.value)];
  if (expression.type === 'CallExpression') return [getCalleeName(expression.callee) || 'factory'];
  if (expression.type === 'MemberExpression') {
    const memberName = getMemberExpressionName(expression);
    return memberName ? [memberName] : [];
  }
  return [];
}

function getInjectToken(parameter: TSESTree.Parameter): string | null {
  const decorators = getDecorators(parameter);
  const injectDecorator = decorators.find((decorator) => getDecoratorName(decorator) === 'Inject');
  if (!injectDecorator || injectDecorator.expression.type !== 'CallExpression') {
    return null;
  }

  const token = injectDecorator.expression.arguments[0];
  if (!token || token.type === 'SpreadElement') return null;
  const names = extractExpressionNames(token);
  return names[0] || null;
}

function getParameterTypeName(parameter: TSESTree.Parameter): string | null {
  const target = parameter.type === 'TSParameterProperty' ? parameter.parameter : parameter;
  if (target.type !== 'Identifier') {
    return null;
  }

  const annotation = target.typeAnnotation?.typeAnnotation;
  if (!annotation) return null;
  if (annotation.type === 'TSTypeReference') return getTypeName(annotation.typeName);
  return null;
}

function getTypeName(typeName: TSESTree.EntityName): string | null {
  if (typeName.type === 'Identifier') return typeName.name;
  if (typeName.type === 'TSQualifiedName') {
    const left = getTypeName(typeName.left);
    return left ? `${left}.${typeName.right.name}` : typeName.right.name;
  }
  return null;
}

function getDecorator(node: TSESTree.Node, name: string): TSESTree.Decorator | undefined {
  return getDecorators(node).find((decorator) => getDecoratorName(decorator) === name);
}

function getDecoratorNames(node: TSESTree.Node): string[] {
  return getDecorators(node)
    .map(getDecoratorName)
    .filter((name): name is string => Boolean(name));
}

function getDecorators(node: TSESTree.Node): TSESTree.Decorator[] {
  const candidate = node as { decorators?: unknown };
  return Array.isArray(candidate.decorators)
    ? candidate.decorators.filter((decorator): decorator is TSESTree.Decorator =>
        isDecoratorNode(decorator)
      )
    : [];
}

function isDecoratorNode(value: unknown): value is TSESTree.Decorator {
  return Boolean(
    value && typeof value === 'object' && (value as { type?: unknown }).type === 'Decorator'
  );
}

function getDecoratorName(decorator: TSESTree.Decorator): string | null {
  const expression = decorator.expression;
  return expression.type === 'CallExpression'
    ? getCalleeName(expression.callee)
    : getCalleeName(expression);
}

function getDecoratorStringArgument(decorator: TSESTree.Decorator | undefined): string | null {
  if (!decorator || decorator.expression.type !== 'CallExpression') return null;
  const firstArgument = decorator.expression.arguments[0];
  if (!firstArgument || firstArgument.type === 'SpreadElement') return null;
  if (firstArgument.type === 'Literal' && typeof firstArgument.value === 'string') {
    return firstArgument.value;
  }
  if (firstArgument.type === 'TemplateLiteral' && firstArgument.expressions.length === 0) {
    return firstArgument.quasis[0]?.value.cooked || null;
  }
  return null;
}

function getCalleeName(node: TSESTree.Node): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return getMemberExpressionName(node);
  return null;
}

function getMemberExpressionName(node: TSESTree.MemberExpression): string | null {
  const objectName =
    node.object.type === 'Identifier'
      ? node.object.name
      : node.object.type === 'MemberExpression'
        ? getMemberExpressionName(node.object)
        : null;
  const propertyName = getPropertyName(node.property);
  return objectName && propertyName ? `${objectName}.${propertyName}` : propertyName;
}

function getPropertyName(node: TSESTree.Expression | TSESTree.PrivateIdentifier): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal') return String(node.value);
  return null;
}

function normalizeRouteSegment(segment: string): string {
  return segment.replace(/^\/+|\/+$/g, '').replace(/:$/, '');
}

function joinRoutePaths(base: string, child: string): string {
  const joined = [base, child]
    .filter((segment) => segment.length > 0)
    .join('/')
    .replace(/\/+/g, '/');
  return `/${joined}`.replace(/\/$/, '') || '/';
}

function isModuleMetadataKey(key: string | null): key is keyof NestModuleMetadata {
  return key === 'imports' || key === 'providers' || key === 'controllers' || key === 'exports';
}

function getNestMetadataDecorators(component: CodeComponent): string[] {
  const metadata = component.metadata.nestjs as { decorators?: unknown } | undefined;
  return Array.isArray(metadata?.decorators)
    ? metadata.decorators.filter((decorator): decorator is string => typeof decorator === 'string')
    : [];
}

async function detectNestIndicators(
  rootPath: string,
  allDependencies: Record<string, string>
): Promise<string[]> {
  const indicators: string[] = [];
  for (const name of Object.keys(allDependencies).sort()) {
    if (name.startsWith('@nestjs/')) indicators.push(`dep:${name}`);
  }

  try {
    await fs.stat(path.join(rootPath, 'nest-cli.json'));
    indicators.push('disk:nest-cli-json');
  } catch {
    // absent
  }
  if (await anyExists([path.join(rootPath, 'src', 'main.ts'), path.join(rootPath, 'main.ts')])) {
    indicators.push('disk:main-ts');
  }

  return indicators;
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

function getFrameworkVariant(allDependencies: Record<string, string>): string {
  const hasPlatform = Boolean(
    allDependencies['@nestjs/platform-express'] || allDependencies['@nestjs/platform-fastify']
  );
  const hasGraphql = Boolean(allDependencies['@nestjs/graphql']);
  const hasMicroservices = Boolean(allDependencies['@nestjs/microservices']);
  const hasRealtime = Boolean(allDependencies['@nestjs/websockets']);

  if (hasPlatform && (hasGraphql || hasMicroservices || hasRealtime)) return 'mixed';
  if (hasPlatform) return 'http-api';
  if (hasMicroservices) return 'microservice';
  return 'library';
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
  if (specifier.type === 'ImportDefaultSpecifier') return 'default';
  if (specifier.type === 'ImportNamespaceSpecifier') return '*';
  return 'value' in specifier.imported ? String(specifier.imported.value) : specifier.imported.name;
}

function getPackageName(importSource: string): string {
  if (importSource.startsWith('@')) {
    const [scope, name] = importSource.split('/');
    return name ? `${scope}/${name}` : importSource;
  }
  return importSource.split('/')[0] || importSource;
}

function dedupeSummaries(summaries: NestClassSummary[]): NestClassSummary[] {
  const seen = new Set<string>();
  return summaries.filter((summary) => {
    const key = `${summary.component.name}:${summary.component.startLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function walkAst(
  node: TSESTree.Node,
  visit: (node: TSESTree.Node, parent: TSESTree.Node | null) => void,
  parent: TSESTree.Node | null = null
): void {
  visit(node, parent);
  for (const key of Object.keys(node) as Array<keyof typeof node>) {
    if (key === 'parent') continue;
    const value = node[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isAstNode(child)) walkAst(child, visit, node);
      }
    } else if (isAstNode(value)) {
      walkAst(value, visit, node);
    }
  }
}

function isAstNode(value: unknown): value is TSESTree.Node {
  return Boolean(
    value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
  );
}
