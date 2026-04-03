/**
 * Angular Analyzer - Comprehensive Angular-specific code analysis
 * Understands components, services, directives, pipes, modules, guards, interceptors, etc.
 * Detects state management patterns, architectural layers, and Angular-specific patterns
 */

import { promises as fs } from 'fs';
import path from 'path';
import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import {
  FrameworkAnalyzer,
  AnalysisResult,
  CodebaseMetadata,
  CodeChunk,
  CodeComponent,
  ImportStatement,
  ExportStatement,
  ArchitecturalLayer,
  DependencyCategory
} from '../../types/index.js';
import { createChunksFromCode } from '../../utils/chunking.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  KEYWORD_INDEX_FILENAME
} from '../../constants/codebase-context.js';
import { registerComplementaryPatterns } from '../../patterns/semantics.js';
import { isFileNotFoundError } from '../shared/metadata.js';

interface AngularInput {
  name: string;
  type: string;
  style: 'decorator' | 'signal';
  required?: boolean;
}

interface AngularOutput {
  name: string;
  type: string;
  style: 'decorator' | 'signal';
}

interface IndexChunk {
  filePath?: string;
  startLine?: number;
  endLine?: number;
  componentType?: string;
  layer?: string;
}

export class AngularAnalyzer implements FrameworkAnalyzer {
  readonly name = 'angular';
  readonly version = '1.0.0';
  readonly supportedExtensions = ['.ts', '.js', '.html', '.scss', '.css', '.sass', '.less'];
  readonly priority = 100; // Highest priority for Angular files

  constructor() {
    // Self-register Angular-specific complementary patterns.
    // computed + effect are complementary, not conflicting.
    registerComplementaryPatterns('reactivity', ['Computed', 'Effect']);
  }

  private angularPatterns = {
    component: /@Component\s*\(/,
    service: /@Injectable\s*\(/,
    directive: /@Directive\s*\(/,
    pipe: /@Pipe\s*\(/,
    module: /@NgModule\s*\(/,
    // Guards: Check for interface implementation OR method signature OR functional guard
    guard:
      /(?:implements\s+(?:CanActivate|CanDeactivate|CanLoad|CanMatch)|canActivate\s*\(|canDeactivate\s*\(|canLoad\s*\(|canMatch\s*\(|CanActivateFn|CanDeactivateFn|CanMatchFn)/,
    interceptor: /(?:implements\s+HttpInterceptor|intercept\s*\(|HttpInterceptorFn)/,
    resolver: /(?:implements\s+Resolve|resolve\s*\(|ResolveFn)/,
    validator: /(?:implements\s+(?:Validator|AsyncValidator)|validate\s*\()/
  };

  private stateManagementPatterns = {
    ngrx: /@ngrx\/store|createAction|createReducer|createSelector/,
    akita: /@datorama\/akita|Query|Store\.update/,
    elf: /@ngneat\/elf|createStore|withEntities/,
    signals: /\bsignal\s*[<(]|\bcomputed\s*[<(]|\beffect\s*\(|\blinkedSignal\s*[<(]/,
    rxjsState: /BehaviorSubject|ReplaySubject|shareReplay/
  };

  private modernAngularPatterns = {
    signalInput: /\binput\s*[<(]|\binput\.required\s*[<(]/,
    signalOutput: /\boutput\s*[<(]/,
    signalModel: /\bmodel\s*[<(]|\bmodel\.required\s*[<(]/,
    signalViewChild: /\bviewChild\s*[<(]|\bviewChild\.required\s*[<(]/,
    signalViewChildren: /\bviewChildren\s*[<(]/,
    signalContentChild: /\bcontentChild\s*[<(]|\bcontentChild\.required\s*[<(]/,
    signalContentChildren: /\bcontentChildren\s*[<(]/,
    controlFlowIf: /@if\s*\(/,
    controlFlowFor: /@for\s*\(/,
    controlFlowSwitch: /@switch\s*\(/,
    controlFlowDefer: /@defer\s*[({]/,
    injectFunction: /\binject\s*[<(]/
  };

  canAnalyze(filePath: string, content?: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (!this.supportedExtensions.includes(ext)) {
      return false;
    }

    // For TypeScript files, check if it contains Angular decorators
    if (ext === '.ts' && content) {
      return Object.values(this.angularPatterns).some((pattern) => pattern.test(content));
    }

    // Angular component templates and styles
    if (['.html', '.scss', '.css', '.sass', '.less'].includes(ext)) {
      // Check if there's a corresponding .ts file
      // const baseName = filePath.replace(/\.(html|scss|css|sass|less)$/, '');
      return true; // We'll verify during analysis
    }

    return false;
  }

  async analyze(filePath: string, content: string): Promise<AnalysisResult> {
    const ext = path.extname(filePath).toLowerCase();
    const relativePath = path.relative(process.cwd(), filePath);

    if (ext === '.ts') {
      return this.analyzeTypeScriptFile(filePath, content, relativePath);
    } else if (ext === '.html') {
      return this.analyzeTemplateFile(filePath, content, relativePath);
    } else if (['.scss', '.css', '.sass', '.less'].includes(ext)) {
      return this.analyzeStyleFile(filePath, content, relativePath);
    }

    // Fallback
    return {
      filePath,
      language: 'unknown',
      framework: 'angular',
      components: [],
      imports: [],
      exports: [],
      dependencies: [],
      metadata: {},
      chunks: []
    };
  }

  private async analyzeTypeScriptFile(
    filePath: string,
    content: string,
    relativePath: string
  ): Promise<AnalysisResult> {
    const components: CodeComponent[] = [];
    const imports: ImportStatement[] = [];
    const exports: ExportStatement[] = [];
    const dependencies: string[] = [];

    try {
      const ast = parse(content, {
        loc: true,
        range: true,
        comment: true
      });

      // Extract imports
      for (const node of ast.body) {
        if (node.type === 'ImportDeclaration' && node.source.value) {
          const source = node.source.value as string;
          imports.push({
            source,
            imports: node.specifiers.map((s: TSESTree.ImportClause) => {
              if (s.type === 'ImportDefaultSpecifier') return 'default';
              if (s.type === 'ImportNamespaceSpecifier') return '*';
              const specifier = s as TSESTree.ImportSpecifier;
              return specifier.imported.name || specifier.local.name;
            }),
            isDefault: node.specifiers.some(
              (s: TSESTree.ImportClause) => s.type === 'ImportDefaultSpecifier'
            ),
            isDynamic: false,
            line: node.loc?.start.line
          });

          // Track dependencies
          if (!source.startsWith('.') && !source.startsWith('/')) {
            dependencies.push(source.split('/')[0]);
          }
        }

        // Extract class declarations with decorators
        if (
          node.type === 'ExportNamedDeclaration' &&
          node.declaration?.type === 'ClassDeclaration'
        ) {
          const classNode = node.declaration;
          if (classNode.id && classNode.decorators) {
            const component = await this.extractAngularComponent(classNode, content);
            if (component) {
              components.push(component);
            }
          }
        }

        // Handle direct class exports
        if (node.type === 'ClassDeclaration' && node.id && node.decorators) {
          const component = await this.extractAngularComponent(node, content);
          if (component) {
            components.push(component);
          }
        }

        // Extract exports
        if (node.type === 'ExportNamedDeclaration') {
          if (node.declaration) {
            if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
              exports.push({
                name: node.declaration.id.name,
                isDefault: false,
                type: 'class'
              });
            }
          }
        }

        if (node.type === 'ExportDefaultDeclaration') {
          const name = node.declaration.type === 'Identifier' ? node.declaration.name : 'default';
          exports.push({
            name,
            isDefault: true,
            type: 'default'
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to parse Angular TypeScript file ${filePath}:`, error);
    }

    // Detect state management
    const statePattern = this.detectStateManagement(content);

    // Detect Angular v17+ modern patterns
    const modernPatterns = this.detectModernAngularPatterns(content);

    // Determine architectural layer
    const layer = this.determineLayer(filePath, components);

    // Create chunks with Angular-specific metadata
    const chunks = await createChunksFromCode(
      content,
      filePath,
      relativePath,
      'typescript',
      components,
      {
        framework: 'angular',
        layer,
        statePattern,
        dependencies,
        modernPatterns
      }
    );

    // Build detected patterns for the indexer to forward
    const detectedPatterns: Array<{ category: string; name: string }> = [];

    // Dependency Injection pattern
    if (modernPatterns.includes('injectFunction')) {
      detectedPatterns.push({ category: 'dependencyInjection', name: 'inject() function' });
    } else if (
      content.includes('constructor(') &&
      content.includes('private') &&
      (relativePath.endsWith('.service.ts') || relativePath.endsWith('.component.ts'))
    ) {
      detectedPatterns.push({ category: 'dependencyInjection', name: 'Constructor injection' });
    }

    // State Management pattern
    if (/BehaviorSubject|ReplaySubject|Subject|Observable/.test(content)) {
      detectedPatterns.push({ category: 'stateManagement', name: 'RxJS' });
    }
    if (modernPatterns.some((p) => p.startsWith('signal'))) {
      detectedPatterns.push({ category: 'stateManagement', name: 'Signals' });
    }

    // Reactivity patterns
    if (/\beffect\s*\(/.test(content)) {
      detectedPatterns.push({ category: 'reactivity', name: 'Effect' });
    }
    if (/\bcomputed\s*[<(]/.test(content)) {
      detectedPatterns.push({ category: 'reactivity', name: 'Computed' });
    }

    // Component Style pattern detection
    // Logic: explicit standalone: true → Standalone
    //        explicit standalone: false → NgModule-based
    //        no explicit flag + uses modern patterns (inject, signals) → likely Standalone (Angular v19+ default)
    //        no explicit flag + no modern patterns → ambiguous, don't classify
    const hasExplicitStandalone = content.includes('standalone: true');
    const hasExplicitNgModule = content.includes('standalone: false');
    const usesModernPatterns =
      modernPatterns.includes('injectFunction') ||
      modernPatterns.some((p) => p.startsWith('signal'));

    if (
      relativePath.endsWith('component.ts') ||
      relativePath.endsWith('directive.ts') ||
      relativePath.endsWith('pipe.ts')
    ) {
      if (hasExplicitStandalone) {
        detectedPatterns.push({ category: 'componentStyle', name: 'Standalone' });
      } else if (hasExplicitNgModule) {
        detectedPatterns.push({ category: 'componentStyle', name: 'NgModule-based' });
      } else if (usesModernPatterns) {
        // No explicit flag but uses modern patterns → likely v19+ standalone default
        detectedPatterns.push({ category: 'componentStyle', name: 'Standalone' });
      }
      // If no explicit flag and no modern patterns, don't classify (ambiguous)
    }

    // Input style pattern
    if (modernPatterns.includes('signalInput')) {
      detectedPatterns.push({ category: 'componentInputs', name: 'Signal-based inputs' });
    } else if (content.includes('@Input()')) {
      detectedPatterns.push({ category: 'componentInputs', name: 'Decorator-based @Input' });
    }

    return {
      filePath,
      language: 'typescript',
      framework: 'angular',
      components,
      imports,
      exports,
      dependencies: dependencies.map((name) => ({
        name,
        category: this.categorizeDependency(name),
        layer
      })),
      metadata: {
        analyzer: this.name,
        layer,
        statePattern,
        modernPatterns,
        // isStandalone: true if explicit standalone: true, or if uses modern patterns (implying v19+ default)
        isStandalone:
          content.includes('standalone: true') ||
          (!content.includes('standalone: false') &&
            (modernPatterns.includes('injectFunction') ||
              modernPatterns.some((p) => p.startsWith('signal')))),
        hasRoutes: content.includes('RouterModule') || content.includes('routes'),
        usesSignals:
          modernPatterns.length > 0 && modernPatterns.some((p) => p.startsWith('signal')),
        usesControlFlow: modernPatterns.some((p) => p.startsWith('controlFlow')),
        usesInject: modernPatterns.includes('injectFunction'),
        usesRxJS: /BehaviorSubject|ReplaySubject|Subject|Observable/.test(content),
        usesEffect: /\beffect\s*\(/.test(content),
        usesComputed: /\bcomputed\s*[<(]/.test(content),
        componentType: components.length > 0 ? components[0].metadata.angularType : undefined,
        // NEW: Patterns for the indexer to forward generically
        detectedPatterns
      },
      chunks
    };
  }

  /**
   * Detect Angular v17+ modern patterns in the code
   */
  private detectModernAngularPatterns(content: string): string[] {
    const detected: string[] = [];

    for (const [patternName, regex] of Object.entries(this.modernAngularPatterns)) {
      if (regex.test(content)) {
        detected.push(patternName);
      }
    }

    return detected;
  }

  private async extractAngularComponent(
    classNode: TSESTree.ClassDeclaration,
    content: string
  ): Promise<CodeComponent | null> {
    if (!classNode.id || !classNode.decorators || classNode.decorators.length === 0) {
      return null;
    }

    const decorator = classNode.decorators[0];
    const expr = decorator.expression;
    const decoratorName: string =
      expr.type === 'CallExpression' && expr.callee.type === 'Identifier'
        ? expr.callee.name
        : expr.type === 'Identifier'
          ? expr.name
          : '';

    let componentType: string | undefined;
    let angularType: string | undefined;

    // Determine Angular component type
    if (decoratorName === 'Component') {
      componentType = 'component';
      angularType = 'component';
    } else if (decoratorName === 'Directive') {
      componentType = 'directive';
      angularType = 'directive';
    } else if (decoratorName === 'Pipe') {
      componentType = 'pipe';
      angularType = 'pipe';
    } else if (decoratorName === 'NgModule') {
      componentType = 'module';
      angularType = 'module';
    } else if (decoratorName === 'Injectable') {
      // For @Injectable, check if it's actually a guard/interceptor/resolver/validator
      // before defaulting to 'service'
      const classContent = content.substring(classNode.range[0], classNode.range[1]);

      if (this.angularPatterns.guard.test(classContent)) {
        componentType = 'guard';
        angularType = 'guard';
      } else if (this.angularPatterns.interceptor.test(classContent)) {
        componentType = 'interceptor';
        angularType = 'interceptor';
      } else if (this.angularPatterns.resolver.test(classContent)) {
        componentType = 'resolver';
        angularType = 'resolver';
      } else if (this.angularPatterns.validator.test(classContent)) {
        componentType = 'validator';
        angularType = 'validator';
      } else {
        // Default to service if no specific pattern matches
        componentType = 'service';
        angularType = 'service';
      }
    }

    // If still no type, check patterns one more time (for classes without decorators)
    if (!componentType) {
      const classContent = content.substring(classNode.range[0], classNode.range[1]);

      if (this.angularPatterns.guard.test(classContent)) {
        componentType = 'guard';
        angularType = 'guard';
      } else if (this.angularPatterns.interceptor.test(classContent)) {
        componentType = 'interceptor';
        angularType = 'interceptor';
      } else if (this.angularPatterns.resolver.test(classContent)) {
        componentType = 'resolver';
        angularType = 'resolver';
      } else if (this.angularPatterns.validator.test(classContent)) {
        componentType = 'validator';
        angularType = 'validator';
      }
    }

    // Extract decorator metadata
    const decoratorMetadata = this.extractDecoratorMetadata(decorator);

    // Extract lifecycle hooks
    const lifecycle = this.extractLifecycleHooks(classNode);

    // Extract injected dependencies
    const injectedServices = this.extractInjectedServices(classNode);

    // Extract inputs and outputs
    const inputs = this.extractInputs(classNode);
    const outputs = this.extractOutputs(classNode);

    return {
      name: classNode.id.name,
      type: 'class',
      componentType,
      startLine: classNode.loc.start.line,
      endLine: classNode.loc.end.line,
      decorators: [
        {
          name: decoratorName,
          properties: decoratorMetadata
        }
      ],
      lifecycle,
      dependencies: injectedServices,
      properties: [...inputs, ...outputs],
      metadata: {
        angularType,
        selector: decoratorMetadata.selector,
        providedIn: decoratorMetadata.providedIn,
        isStandalone: decoratorMetadata.standalone === true,
        template: decoratorMetadata.template,
        templateUrl: decoratorMetadata.templateUrl,
        styleUrls: decoratorMetadata.styleUrls,
        imports: decoratorMetadata.imports,
        declarations: decoratorMetadata.declarations,
        pipeName: decoratorMetadata.name,
        inputs: inputs.map((i) => i.name),
        outputs: outputs.map((o) => o.name)
      }
    };
  }

  private extractDecoratorMetadata(decorator: TSESTree.Decorator): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    try {
      if (decorator.expression.type === 'CallExpression' && decorator.expression.arguments[0]) {
        const arg = decorator.expression.arguments[0];

        if (arg.type === 'ObjectExpression') {
          for (const prop of arg.properties) {
            if (prop.type !== 'Property') continue;
            const keyNode = prop.key as { name?: string; value?: unknown };
            const key = keyNode.name ?? String(keyNode.value ?? '');
            if (!key) continue;

            if (prop.value.type === 'Literal') {
              metadata[key] = prop.value.value;
            } else if (prop.value.type === 'ArrayExpression') {
              metadata[key] = prop.value.elements
                .map((el) => (el && el.type === 'Literal' ? el.value : null))
                .filter(Boolean);
            } else if (prop.value.type === 'Identifier') {
              metadata[key] = prop.value.name;
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to extract decorator metadata:', error);
    }

    return metadata;
  }

  private extractLifecycleHooks(classNode: TSESTree.ClassDeclaration): string[] {
    const hooks: string[] = [];
    const lifecycleHooks = [
      'ngOnChanges',
      'ngOnInit',
      'ngDoCheck',
      'ngAfterContentInit',
      'ngAfterContentChecked',
      'ngAfterViewInit',
      'ngAfterViewChecked',
      'ngOnDestroy'
    ];

    if (classNode.body && classNode.body.body) {
      for (const member of classNode.body.body) {
        if (member.type === 'MethodDefinition' && member.key && member.key.type === 'Identifier') {
          const methodName = member.key.name;
          if (lifecycleHooks.includes(methodName)) {
            hooks.push(methodName);
          }
        }
      }
    }

    return hooks;
  }

  private extractInjectedServices(classNode: TSESTree.ClassDeclaration): string[] {
    const services: string[] = [];

    // Look for constructor parameters
    if (classNode.body && classNode.body.body) {
      for (const member of classNode.body.body) {
        if (member.type === 'MethodDefinition' && member.kind === 'constructor') {
          if (member.value.params) {
            for (const param of member.value.params) {
              const typedParam = param as TSESTree.Identifier;
              if (typedParam.typeAnnotation?.typeAnnotation?.type === 'TSTypeReference') {
                const typeRef = typedParam.typeAnnotation
                  .typeAnnotation as TSESTree.TSTypeReference;
                if (typeRef.typeName.type === 'Identifier') {
                  services.push(typeRef.typeName.name);
                }
              }
            }
          }
        }
      }
    }

    return services;
  }

  private extractInputs(classNode: TSESTree.ClassDeclaration): AngularInput[] {
    const inputs: AngularInput[] = [];

    if (classNode.body && classNode.body.body) {
      for (const member of classNode.body.body) {
        if (member.type === 'PropertyDefinition') {
          // Check for decorator-based @Input()
          if (member.decorators) {
            const hasInput = member.decorators.some((d: TSESTree.Decorator) => {
              const expr = d.expression;
              return (
                (expr.type === 'CallExpression' &&
                  expr.callee.type === 'Identifier' &&
                  expr.callee.name === 'Input') ||
                (expr.type === 'Identifier' && expr.name === 'Input')
              );
            });

            if (hasInput && member.key && 'name' in member.key) {
              inputs.push({
                name: member.key.name,
                type:
                  (member.typeAnnotation?.typeAnnotation?.type as string | undefined) || 'unknown',
                style: 'decorator'
              });
            }
          }

          // Check for signal-based input() (Angular v17.1+)
          if (
            member.value &&
            member.key &&
            'name' in member.key &&
            member.value.type === 'CallExpression'
          ) {
            const callee = member.value.callee;
            let valueStr: string | null = null;
            let isRequired = false;

            if (callee.type === 'Identifier') {
              valueStr = callee.name;
            } else if (callee.type === 'MemberExpression') {
              if (callee.object.type === 'Identifier') {
                valueStr = callee.object.name;
              }
              if (callee.property.type === 'Identifier') {
                isRequired = callee.property.name === 'required';
              }
            }

            if (valueStr === 'input') {
              inputs.push({
                name: member.key.name,
                type: 'InputSignal',
                style: 'signal',
                required: isRequired
              });
            }
          }
        }
      }
    }

    return inputs;
  }

  private extractOutputs(classNode: TSESTree.ClassDeclaration): AngularOutput[] {
    const outputs: AngularOutput[] = [];

    if (classNode.body && classNode.body.body) {
      for (const member of classNode.body.body) {
        if (member.type === 'PropertyDefinition') {
          // Check for decorator-based @Output()
          if (member.decorators) {
            const hasOutput = member.decorators.some((d: TSESTree.Decorator) => {
              const expr = d.expression;
              return (
                (expr.type === 'CallExpression' &&
                  expr.callee.type === 'Identifier' &&
                  expr.callee.name === 'Output') ||
                (expr.type === 'Identifier' && expr.name === 'Output')
              );
            });

            if (hasOutput && member.key && 'name' in member.key) {
              outputs.push({
                name: member.key.name,
                type: 'EventEmitter',
                style: 'decorator'
              });
            }
          }

          // Check for signal-based output() (Angular v17.1+)
          if (
            member.value &&
            member.key &&
            'name' in member.key &&
            member.value.type === 'CallExpression'
          ) {
            const callee = member.value.callee;
            const valueStr = callee.type === 'Identifier' ? callee.name : null;

            if (valueStr === 'output') {
              outputs.push({
                name: member.key.name,
                type: 'OutputEmitterRef',
                style: 'signal'
              });
            }
          }
        }
      }
    }

    return outputs;
  }

  private async analyzeTemplateFile(
    filePath: string,
    content: string,
    relativePath: string
  ): Promise<AnalysisResult> {
    // Find corresponding component file
    const componentPath = filePath.replace(/\.html$/, '.ts');

    // Detect legacy vs modern control flow
    const hasLegacyDirectives = /\*ng(?:If|For|Switch)/.test(content);
    const hasModernControlFlow = /@(?:if|for|switch|defer)\s*[({]/.test(content);

    return {
      filePath,
      language: 'html',
      framework: 'angular',
      components: [],
      imports: [],
      exports: [],
      dependencies: [],
      metadata: {
        analyzer: this.name,
        type: 'template',
        componentPath,
        hasLegacyDirectives,
        hasModernControlFlow,
        hasBindings: /\[|\(|{{/.test(content),
        hasDefer: /@defer\s*[({]/.test(content)
      },
      chunks: await createChunksFromCode(content, filePath, relativePath, 'html', [])
    };
  }

  private async analyzeStyleFile(
    filePath: string,
    content: string,
    relativePath: string
  ): Promise<AnalysisResult> {
    const ext = path.extname(filePath).toLowerCase();
    const language = ext.substring(1); // Remove the dot

    return {
      filePath,
      language,
      framework: 'angular',
      components: [],
      imports: [],
      exports: [],
      dependencies: [],
      metadata: {
        analyzer: this.name,
        type: 'style'
      },
      chunks: await createChunksFromCode(content, filePath, relativePath, language, [])
    };
  }

  private detectStateManagement(content: string): string | undefined {
    for (const [pattern, regex] of Object.entries(this.stateManagementPatterns)) {
      if (regex.test(content)) {
        return pattern;
      }
    }
    return undefined;
  }

  private determineLayer(filePath: string, components: CodeComponent[]): ArchitecturalLayer {
    const lowerPath = filePath.toLowerCase();

    // Check path-based patterns
    if (
      lowerPath.includes('/component') ||
      lowerPath.includes('/view') ||
      lowerPath.includes('/page')
    ) {
      return 'presentation';
    }
    if (lowerPath.includes('/service')) {
      return 'business';
    }
    if (
      lowerPath.includes('/data') ||
      lowerPath.includes('/repository') ||
      lowerPath.includes('/api')
    ) {
      return 'data';
    }
    if (
      lowerPath.includes('/store') ||
      lowerPath.includes('/state') ||
      lowerPath.includes('/ngrx')
    ) {
      return 'state';
    }
    if (lowerPath.includes('/core')) {
      return 'core';
    }
    if (lowerPath.includes('/shared')) {
      return 'shared';
    }
    if (lowerPath.includes('/feature')) {
      return 'feature';
    }

    // Check component types
    for (const component of components) {
      if (
        component.componentType === 'component' ||
        component.componentType === 'directive' ||
        component.componentType === 'pipe'
      ) {
        return 'presentation';
      }
      if (component.componentType === 'service') {
        return lowerPath.includes('http') || lowerPath.includes('api') ? 'data' : 'business';
      }
      if (component.componentType === 'guard' || component.componentType === 'interceptor') {
        return 'core';
      }
    }

    return 'unknown';
  }

  private categorizeDependency(name: string): DependencyCategory {
    if (name.startsWith('@angular/')) {
      return 'framework';
    }
    if (name.includes('ngrx') || name.includes('akita') || name.includes('elf')) {
      return 'state';
    }
    if (name.includes('material') || name.includes('primeng') || name.includes('ng-bootstrap')) {
      return 'ui';
    }
    if (name.includes('router')) {
      return 'routing';
    }
    if (name.includes('http') || name.includes('common/http')) {
      return 'http';
    }
    if (
      name.includes('test') ||
      name.includes('jest') ||
      name.includes('jasmine') ||
      name.includes('karma')
    ) {
      return 'testing';
    }
    return 'other';
  }

  async detectCodebaseMetadata(rootPath: string): Promise<CodebaseMetadata> {
    const metadata: CodebaseMetadata = {
      name: path.basename(rootPath),
      rootPath,
      languages: [],
      dependencies: [],
      architecture: {
        type: 'feature-based',
        layers: {
          presentation: 0,
          business: 0,
          data: 0,
          state: 0,
          core: 0,
          shared: 0,
          feature: 0,
          infrastructure: 0,
          unknown: 0
        },
        patterns: []
      },
      styleGuides: [],
      documentation: [],
      projectStructure: {
        type: 'single-app'
      },
      statistics: {
        totalFiles: 0,
        totalLines: 0,
        totalComponents: 0,
        componentsByType: {},
        componentsByLayer: {
          presentation: 0,
          business: 0,
          data: 0,
          state: 0,
          core: 0,
          shared: 0,
          feature: 0,
          infrastructure: 0,
          unknown: 0
        }
      },
      customMetadata: {}
    };

    try {
      // Read package.json
      const packageJsonPath = path.join(rootPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      metadata.name = packageJson.name || metadata.name;

      // Extract Angular version and dependencies
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };

      const angularCoreVersion = allDeps['@angular/core'];

      // Detect state management
      const stateManagement: string[] = [];
      if (allDeps['@ngrx/store']) stateManagement.push('ngrx');
      if (allDeps['@datorama/akita']) stateManagement.push('akita');
      if (allDeps['@ngneat/elf']) stateManagement.push('elf');

      // Detect UI libraries
      const uiLibraries: string[] = [];
      if (allDeps['@angular/material']) uiLibraries.push('Angular Material');
      if (allDeps['primeng']) uiLibraries.push('PrimeNG');
      if (allDeps['@ng-bootstrap/ng-bootstrap']) uiLibraries.push('ng-bootstrap');

      // Detect testing frameworks
      const testingFrameworks: string[] = [];
      if (allDeps['jasmine-core']) testingFrameworks.push('Jasmine');
      if (allDeps['karma']) testingFrameworks.push('Karma');
      if (allDeps['jest']) testingFrameworks.push('Jest');

      if (angularCoreVersion) {
        metadata.framework = {
          name: 'Angular',
          version: angularCoreVersion.replace(/[\^~]/, ''),
          type: 'angular',
          variant: 'unknown', // Will be determined during analysis
          stateManagement,
          uiLibraries,
          testingFrameworks
        };
      }

      // Convert dependencies
      metadata.dependencies = Object.entries(allDeps).map(([name, version]) => ({
        name,
        version: version as string,
        category: this.categorizeDependency(name)
      }));
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        console.warn('Failed to read Angular project metadata:', error);
      }
    }

    // Calculate statistics from existing index if available
    try {
      const indexPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME);
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const parsed = JSON.parse(indexContent) as unknown;

      // Legacy index.json is an array — do not consume it (missing version/meta headers).
      if (Array.isArray(parsed)) {
        return metadata;
      }

      const parsedObj = parsed as { chunks?: unknown };
      const chunks =
        parsedObj && Array.isArray(parsedObj.chunks) ? (parsedObj.chunks as IndexChunk[]) : null;
      if (Array.isArray(chunks) && chunks.length > 0) {
        metadata.statistics.totalFiles = new Set(chunks.map((c) => c.filePath)).size;
        metadata.statistics.totalLines = chunks.reduce(
          (sum, c) => sum + ((c.endLine ?? 0) - (c.startLine ?? 0) + 1),
          0
        );

        // Count components by type
        const componentCounts: Record<string, number> = {};
        const layerCounts: Record<string, number> = {
          presentation: 0,
          business: 0,
          data: 0,
          state: 0,
          core: 0,
          shared: 0,
          feature: 0,
          infrastructure: 0,
          unknown: 0
        };

        for (const chunk of chunks) {
          if (chunk.componentType) {
            componentCounts[chunk.componentType] = (componentCounts[chunk.componentType] || 0) + 1;
            metadata.statistics.totalComponents++;
          }

          if (chunk.layer) {
            layerCounts[chunk.layer as keyof typeof layerCounts] =
              (layerCounts[chunk.layer as keyof typeof layerCounts] || 0) + 1;
          }
        }

        metadata.statistics.componentsByType = componentCounts;
        metadata.statistics.componentsByLayer = layerCounts;
        metadata.architecture.layers = layerCounts;
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        console.warn('Failed to calculate statistics from index:', error);
      }
    }

    return metadata;
  }

  /**
   * Generate Angular-specific summary for a code chunk
   */
  summarize(chunk: CodeChunk): string {
    const { componentType, metadata, content } = chunk;
    const fileName = path.basename(chunk.filePath);

    // Extract class/component name
    const classMatch = content.match(/(?:export\s+)?class\s+(\w+)/);
    const className = classMatch ? classMatch[1] : fileName;

    switch (componentType) {
      case 'component': {
        const selector = metadata?.selector || 'unknown';
        const inputs = Array.isArray(metadata?.inputs) ? metadata.inputs.length : 0;
        const outputs = Array.isArray(metadata?.outputs) ? metadata.outputs.length : 0;
        const lifecycle = this.extractLifecycleMethods(content);
        return `Angular component '${className}' (selector: ${selector})${
          lifecycle ? ` with ${lifecycle}` : ''
        }${inputs ? `, ${inputs} inputs` : ''}${outputs ? `, ${outputs} outputs` : ''}.`;
      }

      case 'service': {
        const providedIn = metadata?.providedIn || 'unknown';
        const methods = this.extractPublicMethods(content);
        return `Angular service '${className}' (providedIn: ${providedIn})${
          methods ? ` providing ${methods}` : ''
        }.`;
      }

      case 'guard': {
        const guardType = this.detectGuardType(content);
        return `Angular ${guardType} guard '${className}' protecting routes.`;
      }

      case 'directive': {
        const directiveSelector = metadata?.selector || 'unknown';
        return `Angular directive '${className}' (selector: ${directiveSelector}).`;
      }

      case 'pipe': {
        const pipeName = metadata?.pipeName || 'unknown';
        return `Angular pipe '${className}' (name: ${pipeName}) for data transformation.`;
      }

      case 'module': {
        const imports = Array.isArray(metadata?.imports) ? metadata.imports.length : 0;
        const declarations = Array.isArray(metadata?.declarations)
          ? metadata.declarations.length
          : 0;
        return `Angular module '${className}' with ${declarations} declarations and ${imports} imports.`;
      }

      case 'interceptor':
        return `Angular HTTP interceptor '${className}' modifying HTTP requests/responses.`;

      case 'resolver':
        return `Angular resolver '${className}' pre-fetching route data.`;

      case 'validator':
        return `Angular validator '${className}' for form validation.`;

      default:
        // Try to provide a meaningful fallback
        if (className && className !== fileName) {
          // Check for common patterns
          if (
            content.includes('signal(') ||
            content.includes('computed(') ||
            content.includes('effect(')
          ) {
            return `Angular code '${className}' using signals.`;
          }
          if (content.includes('inject(')) {
            return `Angular code '${className}' using dependency injection.`;
          }
          if (content.includes('Observable') || content.includes('Subject')) {
            return `Angular code '${className}' with reactive streams.`;
          }
          return `Angular code '${className}' in ${fileName}.`;
        }

        {
          // Extract first meaningful export or declaration
          const exportMatch = content.match(
            /export\s+(?:const|function|class|interface|type|enum)\s+(\w+)/
          );
          if (exportMatch) {
            return `Exports '${exportMatch[1]}' from ${fileName}.`;
          }

          return `Angular code in ${fileName}.`;
        }
    }
  }

  private extractLifecycleMethods(content: string): string {
    const lifecycles = [
      'ngOnInit',
      'ngOnChanges',
      'ngOnDestroy',
      'ngAfterViewInit',
      'ngAfterContentInit'
    ];
    const found = lifecycles.filter((method) => content.includes(method));
    return found.length > 0 ? found.join(', ') : '';
  }

  private extractPublicMethods(content: string): string {
    const methodMatches = content.match(/public\s+(\w+)\s*\(/g);
    if (!methodMatches || methodMatches.length === 0) return '';
    const methods = methodMatches
      .slice(0, 3)
      .map((m) => m.match(/public\s+(\w+)/)?.[1])
      .filter(Boolean);
    return methods.length > 0 ? `methods: ${methods.join(', ')}` : '';
  }

  private detectGuardType(content: string): string {
    if (content.includes('CanActivate')) return 'CanActivate';
    if (content.includes('CanDeactivate')) return 'CanDeactivate';
    if (content.includes('CanLoad')) return 'CanLoad';
    if (content.includes('CanMatch')) return 'CanMatch';
    return 'route';
  }

  private extractFirstComment(content: string): string {
    const commentMatch = content.match(/\/\*\*\s*\n?\s*\*\s*(.+?)(?:\n|\*\/)/);
    return commentMatch ? commentMatch[1].trim() : '';
  }

  private extractFirstLine(content: string): string {
    const firstLine = content
      .split('\n')
      .find((line) => line.trim() && !line.trim().startsWith('import'));
    return firstLine ? firstLine.trim().slice(0, 60) + '...' : '';
  }

  /** Angular-specific regex patterns for extracting code snippets per detected pattern */
  private static readonly SNIPPET_PATTERNS: Record<string, Record<string, RegExp>> = {
    dependencyInjection: {
      'inject() function': /\binject\s*[<(]/,
      'Constructor injection': /constructor\s*\(/
    },
    stateManagement: {
      RxJS: /BehaviorSubject|ReplaySubject|Subject|Observable/,
      Signals: /\bsignal\s*[<(]/
    },
    reactivity: {
      Effect: /\beffect\s*\(/,
      Computed: /\bcomputed\s*[<(]/
    },
    componentStyle: {
      Standalone: /standalone\s*:\s*true/,
      'NgModule-based': /@(?:Component|Directive|Pipe)\s*\(/
    },
    componentInputs: {
      'Signal-based inputs': /\binput\s*[<(]/,
      'Decorator-based @Input': /@Input\(\)/
    }
  };

  getSnippetPattern(category: string, name: string): RegExp | null {
    return AngularAnalyzer.SNIPPET_PATTERNS[category]?.[name] || null;
  }
}
