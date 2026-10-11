/**
 * Generic code analyzer - handles any programming language as fallback
 * Provides basic AST parsing and chunking for languages without specialized analyzers
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import {
  FrameworkAnalyzer,
  AnalysisResult,
  CodebaseMetadata,
  CodeChunk,
  CodeComponent,
  ImportStatement,
  ExportStatement,
  Dependency
} from '../../types/index.js';
import { createChunksFromCode } from '../../utils/chunking.js';
import {
  createASTAlignedChunks,
  MAX_AST_CHUNK_FILE_SIZE,
  MAX_AST_CHUNK_FILE_LINES
} from '../../utils/ast-chunker.js';
import { detectLanguage } from '../../utils/language-detection.js';
import { extractTreeSitterSymbols, type TreeSitterSymbol } from '../../utils/tree-sitter.js';
import {
  detectWorkspaceType,
  scanWorkspacePackageJsons,
  aggregateWorkspaceDependencies,
  categorizeDependency
} from '../../utils/dependency-detection.js';
import type { WorkspacePackageJson } from '../../utils/workspace-detection.js';

export class GenericAnalyzer implements FrameworkAnalyzer {
  readonly name = 'generic';
  readonly version = '1.0.0';
  readonly supportedExtensions = [
    // JavaScript/TypeScript
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.mjs',
    '.cjs',
    // Python
    '.py',
    '.pyi',
    // Java/Kotlin
    '.java',
    '.kt',
    '.kts',
    // C/C++
    '.c',
    '.cpp',
    '.cc',
    '.cxx',
    '.h',
    '.hpp',
    // C#
    '.cs',
    // Go
    '.go',
    // Rust
    '.rs',
    // PHP
    '.php',
    // Ruby
    '.rb',
    // Swift
    '.swift',
    // Scala
    '.scala',
    // Shell
    '.sh',
    '.bash',
    '.zsh',
    // Config
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.xml',
    // Markup
    '.html',
    '.htm',
    '.md',
    '.mdx',
    // Styles
    '.css',
    '.scss',
    '.sass',
    '.less'
  ];
  readonly priority = 10; // Low priority - fallback analyzer

  canAnalyze(filePath: string, _content?: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  async analyze(filePath: string, content: string): Promise<AnalysisResult> {
    const language = detectLanguage(filePath);
    const relativePath = path.relative(process.cwd(), filePath);

    // Parse based on language
    let components: CodeComponent[] = [];
    let imports: ImportStatement[] = [];
    let exports: ExportStatement[] = [];
    let treeSitterGrammar: string | undefined;
    let usesTreeSitterSymbols = false;
    let treeSitterSymbols: TreeSitterSymbol[] = [];

    try {
      const treeSitterResult = await extractTreeSitterSymbols(content, language);
      if (treeSitterResult && treeSitterResult.symbols.length > 0) {
        treeSitterSymbols = treeSitterResult.symbols;
        // Legacy: replaced by createASTAlignedChunks for AST-aligned chunking
        components = this.convertTreeSitterSymbolsToComponents(treeSitterResult.symbols);
        treeSitterGrammar = treeSitterResult.grammarFile;
        usesTreeSitterSymbols = true;
      }

      if (language === 'typescript' || language === 'javascript') {
        const parsed = await this.parseJSTSFile(filePath, content, language);
        imports = parsed.imports;
        exports = parsed.exports;

        // Keep legacy parser as fallback if Tree-sitter produced nothing.
        if (components.length === 0) {
          components = parsed.components;
          usesTreeSitterSymbols = false;
          treeSitterGrammar = undefined;
        }
      } else {
        // For other languages, use regex fallback if Tree-sitter produced nothing.
        if (components.length === 0) {
          components = this.parseGenericFile(content);
        }
      }
    } catch (error) {
      console.warn(`Failed to parse ${filePath}:`, error);
    }

    const metadata: Record<string, unknown> = {
      analyzer: this.name,
      fileSize: content.length,
      lineCount: content.split('\n').length,
      chunkStrategy: usesTreeSitterSymbols ? 'ast-aligned' : 'line-or-component'
    };

    if (usesTreeSitterSymbols && treeSitterGrammar) {
      metadata.treeSitterGrammar = treeSitterGrammar;
      metadata.symbolAware = true;
    }

    // Create chunks — use AST-aligned chunker when Tree-sitter symbols are available
    // File ceiling pre-check: skip AST chunking for very large files
    const lineCount = content.split('\n').length;
    const byteSize = Buffer.byteLength(content, 'utf8');
    const useASTChunking =
      usesTreeSitterSymbols &&
      treeSitterSymbols.length > 0 &&
      byteSize <= MAX_AST_CHUNK_FILE_SIZE &&
      lineCount <= MAX_AST_CHUNK_FILE_LINES;

    let chunks: CodeChunk[];
    if (useASTChunking) {
      try {
        chunks = createASTAlignedChunks(content, treeSitterSymbols, {
          minChunkLines: 10,
          maxChunkLines: 150,
          filePath,
          language,
          framework: 'generic',
          componentType: 'module'
        });
        // Enrich AST chunks with the correct relativePath
        for (const chunk of chunks) {
          chunk.relativePath = relativePath;
        }
      } catch (err) {
        if (process.env.CODEBASE_CONTEXT_DEBUG) {
          console.error(
            `[ast-chunker] AST chunking failed for ${filePath}, falling back to line chunks:`,
            err
          );
        }
        // Fall through to line-based chunking
        chunks = await createChunksFromCode(
          content,
          filePath,
          relativePath,
          language,
          components,
          metadata
        );
      }
    } else {
      chunks = await createChunksFromCode(
        content,
        filePath,
        relativePath,
        language,
        components,
        metadata
      );
    }

    return {
      filePath,
      language,
      components,
      imports,
      exports,
      dependencies: [],
      metadata,
      chunks
    };
  }

  private convertTreeSitterSymbolsToComponents(symbols: TreeSitterSymbol[]): CodeComponent[] {
    return symbols.map((symbol) => ({
      name: symbol.name,
      type: symbol.kind,
      componentType: symbol.kind,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      metadata: {
        extraction: 'tree-sitter',
        nodeType: symbol.nodeType,
        startIndex: symbol.startIndex,
        endIndex: symbol.endIndex
      }
    }));
  }

  async detectCodebaseMetadata(rootPath: string): Promise<CodebaseMetadata> {
    let projectName = path.basename(rootPath);
    let dependencies: Dependency[] = [];

    let workspaceType: string = 'single';
    let workspacePackages: WorkspacePackageJson[] = [];

    try {
      workspaceType = await detectWorkspaceType(rootPath);
      workspacePackages =
        workspaceType !== 'single' ? await scanWorkspacePackageJsons(rootPath) : [];

      const pkgPath = path.join(rootPath, 'package.json');
      let packageJson: {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      } = {};
      try {
        packageJson = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        projectName = packageJson.name || projectName;
      } catch {
        // no root package.json
      }

      const rawDeps =
        workspaceType !== 'single'
          ? aggregateWorkspaceDependencies(workspacePackages)
          : { ...packageJson.dependencies, ...packageJson.devDependencies };

      dependencies = Object.entries(rawDeps).map(([name, version]) => ({
        name,
        version: version as string,
        category: categorizeDependency(name)
      }));
    } catch (_error) {
      // skip
    }

    const metadata: CodebaseMetadata = {
      name: projectName,
      rootPath,
      languages: [],
      dependencies,
      architecture: {
        type: 'mixed',
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
        type: workspaceType === 'single' ? 'single-app' : 'monorepo',
        packages: workspacePackages.map((p) => ({
          name: p.name || path.basename(path.dirname(p.filePath)),
          path: path.relative(rootPath, path.dirname(p.filePath)),
          type: 'app' // default to app
        })),
        workspaces: workspaceType !== 'single' ? [workspaceType] : undefined
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
      customMetadata: {
        monorepoType: workspaceType !== 'single' ? workspaceType : undefined
      }
    };

    return metadata;
  }

  private async parseJSTSFile(
    filePath: string,
    content: string,
    _language: 'typescript' | 'javascript'
  ): Promise<{
    components: CodeComponent[];
    imports: ImportStatement[];
    exports: ExportStatement[];
  }> {
    const components: CodeComponent[] = [];
    const imports: ImportStatement[] = [];
    const exports: ExportStatement[] = [];

    try {
      // Use typescript-estree for parsing
      const { parse } = await import('@typescript-eslint/typescript-estree');
      const ast = parse(content, {
        loc: true,
        range: true,
        comment: true,
        jsx: filePath.endsWith('x')
      });

      // Extract imports
      for (const node of ast.body) {
        if (node.type === 'ImportDeclaration' && node.source.value) {
          imports.push({
            source: node.source.value as string,
            imports: node.specifiers.map((s: TSESTree.ImportClause) => {
              if (s.type === 'ImportDefaultSpecifier') return 'default';
              if (s.type === 'ImportNamespaceSpecifier') return '*';
              const specifier = s as TSESTree.ImportSpecifier;
              return specifier.imported.type === 'Identifier'
                ? specifier.imported.name
                : specifier.imported.value;
            }),
            isDefault: node.specifiers.some(
              (s: TSESTree.ImportClause) => s.type === 'ImportDefaultSpecifier'
            ),
            isDynamic: false,
            line: node.loc?.start.line
          });
        }

        // Extract components (classes, functions, interfaces)
        if (node.type === 'ClassDeclaration' && node.id) {
          components.push({
            name: node.id.name,
            type: 'class',
            startLine: node.loc!.start.line,
            endLine: node.loc!.end.line,
            metadata: {}
          });
        }

        if (node.type === 'FunctionDeclaration' && node.id) {
          components.push({
            name: node.id.name,
            type: 'function',
            startLine: node.loc!.start.line,
            endLine: node.loc!.end.line,
            metadata: {}
          });
        }

        if (node.type === 'VariableDeclaration') {
          for (const decl of node.declarations) {
            if (decl.id.type === 'Identifier') {
              // Check if it's an arrow function or function expression
              const isFunction =
                decl.init &&
                (decl.init.type === 'ArrowFunctionExpression' ||
                  decl.init.type === 'FunctionExpression');

              components.push({
                name: decl.id.name,
                type: isFunction ? 'function' : 'variable',
                startLine: decl.loc!.start.line,
                endLine: decl.loc!.end.line,
                metadata: {}
              });
            }
          }
        }

        // Extract exports
        if (node.type === 'ExportNamedDeclaration') {
          if (node.declaration) {
            if (node.declaration.type === 'VariableDeclaration') {
              for (const decl of node.declaration.declarations) {
                if (decl.id.type === 'Identifier') {
                  exports.push({
                    name: decl.id.name,
                    isDefault: false,
                    type: 'named'
                  });
                }
              }
            } else if ('id' in node.declaration && node.declaration.id) {
              const declId = node.declaration.id as { name: string };
              exports.push({
                name: declId.name,
                isDefault: false,
                type: 'named'
              });
            }
          }

          if (node.specifiers) {
            for (const spec of node.specifiers) {
              if (spec.type === 'ExportSpecifier') {
                exports.push({
                  name:
                    spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value,
                  isDefault: false,
                  type: 'named'
                });
              }
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
      console.warn(`Failed to parse JS/TS file ${filePath}:`, error);
    }

    return { components, imports, exports };
  }

  private parseGenericFile(content: string): CodeComponent[] {
    const components: CodeComponent[] = [];
    const lines = content.split('\n');

    // Basic pattern matching for functions, classes, etc.
    const patterns = [
      // Functions: def, function, func, fn
      { regex: /(?:^|\s)(?:def|function|func|fn)\s+(\w+)/i, type: 'function' },
      // Classes: class, struct
      { regex: /(?:^|\s)(?:class|struct|interface|trait)\s+(\w+)/i, type: 'class' },
      // Methods: pub fn, pub fn, private func
      {
        regex: /(?:pub|public|private|protected)?\s*(?:fn|func|function|def|method)\s+(\w+)/i,
        type: 'method'
      }
    ];

    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        const match = line.match(pattern.regex);
        if (match && match[1]) {
          components.push({
            name: match[1],
            type: pattern.type,
            startLine: index + 1,
            endLine: index + 1, // Will be updated if we find end
            metadata: {}
          });
        }
      }
    });

    return components;
  }

  /**
   * Generate generic summary for any code chunk
   */
  summarize(chunk: CodeChunk): string {
    const fileName = path.basename(chunk.filePath);
    const { language, componentType, content } = chunk;

    if (!content) {
      return `${language} ${componentType || 'code'} in ${fileName}`;
    }

    // Try to extract meaningful information
    const firstComment = this.extractFirstComment(content);
    if (firstComment) {
      return `${language} ${componentType || 'code'} in ${fileName}: ${firstComment}`;
    }

    // Extract class/function names
    const classMatch = content.match(/(?:class|struct|interface|trait)\s+(\w+)/);
    const funcMatch = content.match(/(?:function|fn|func|def|method)\s+(\w+)/);

    if (classMatch) {
      return `${language} ${classMatch[0].split(/\s+/)[0]} '${classMatch[1]}' in ${fileName}.`;
    }

    if (funcMatch) {
      return `${language} ${funcMatch[0].split(/\s+/)[0]} '${funcMatch[1]}' in ${fileName}.`;
    }

    // Fallback to first meaningful line
    const firstLine = content
      .split('\n')
      .find(
        (line) => line.trim() && !line.trim().startsWith('import') && !line.trim().startsWith('//')
      );

    return `${language} code in ${fileName}: ${firstLine ? firstLine.trim().slice(0, 60) + '...' : 'code definition'}`;
  }

  private extractFirstComment(content: string | null | undefined): string {
    if (!content) return '';

    // Try JSDoc style
    const jsdocMatch = content.match(/\/\*\*\s*\n?\s*\*\s*(.+?)(?:\n|\*\/)/);
    if (jsdocMatch) return jsdocMatch[1].trim();

    // Try Python docstring
    const pythonMatch = content.match(/^[\s]*"""(.+?)"""/s);
    if (pythonMatch) return pythonMatch[1].trim().split('\n')[0];

    // Try single-line comment
    const singleMatch = content.match(/^[\s]*\/\/\s*(.+?)$/m);
    if (singleMatch) return singleMatch[1].trim();

    return '';
  }
}
