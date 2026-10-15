import { promises as fs } from 'fs';
import path from 'path';
import ts from 'typescript';
import { parse } from '@typescript-eslint/typescript-estree';

export interface TsconfigResolverOptions {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  compilerOptions?: ts.CompilerOptions;
}

export interface SourceResolution {
  status: 'resolved' | 'unresolved';
  path?: string;
  reason?: 'external' | 'not-found' | 'outside-root' | 'unsupported-alias';
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export function loadTsconfigCompilerOptions(rootPath: string): ts.CompilerOptions {
  // Keep discovery within this root and config paths normalized for TypeScript diagnostics.
  const configPath = ['tsconfig.json', 'tsconfig.base.json']
    .map((name) => path.join(rootPath, name).split(path.sep).join('/'))
    .find((candidate) => ts.sys.fileExists(candidate));
  if (!configPath) {
    return {
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    };
  }
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readResult.error) {
    return {
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    };
  }
  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, path.dirname(configPath));
  return {
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...parsed.options
  };
}

function matchesPathAlias(
  specifier: string,
  paths: Record<string, string[]>
): Array<{ target: string; suffix: string }> {
  const matches: Array<{ target: string; suffix: string; specificity: number }> = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    const star = pattern.indexOf('*');
    if (star < 0) {
      if (specifier === pattern)
        for (const target of targets)
          matches.push({ target, suffix: '', specificity: pattern.length });
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      specifier.length >= prefix.length + suffix.length
    ) {
      const capture = specifier.slice(prefix.length, specifier.length - suffix.length);
      for (const target of targets)
        matches.push({
          target: target.replace('*', capture),
          suffix: '',
          specificity: prefix.length + suffix.length
        });
    }
  }
  return matches
    .sort((a, b) => b.specificity - a.specificity)
    .map(({ target, suffix }) => ({ target, suffix }));
}

export class InternalSourceResolver {
  private readonly rootPath: string;
  private readonly rootRealPath: string;
  private readonly indexedFiles = new Map<string, string>();
  private readonly options: TsconfigResolverOptions;
  private readonly compilerOptions: ts.CompilerOptions;

  private constructor(
    rootPath: string,
    rootRealPath: string,
    indexedFiles: Map<string, string>,
    options: TsconfigResolverOptions
  ) {
    this.rootPath = rootPath;
    this.rootRealPath = rootRealPath;
    this.indexedFiles = indexedFiles;
    this.options = options;
    this.compilerOptions = options.compilerOptions ?? {
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      ...(options.baseUrl ? { baseUrl: path.resolve(rootPath, options.baseUrl) } : {}),
      ...(options.paths ? { paths: options.paths } : {})
    };
  }

  static async create(
    rootPath: string,
    files: string[],
    options: TsconfigResolverOptions = {}
  ): Promise<InternalSourceResolver> {
    const rootRealPath = await fs.realpath(rootPath);
    const indexedFiles = new Map<string, string>();
    for (const file of files) {
      const absolute = path.resolve(file);
      const relative = path.relative(rootPath, absolute);
      if (!isWithin(rootPath, absolute)) continue;
      const rel = relative.split(path.sep).join('/');
      indexedFiles.set(process.platform === 'win32' ? rel.toLowerCase() : rel, absolute);
      const real = await fs.realpath(absolute).catch(() => null);
      if (real && isWithin(rootRealPath, real)) {
        const realRelative = path.relative(rootRealPath, real).split(path.sep).join('/');
        indexedFiles.set(
          process.platform === 'win32' ? realRelative.toLowerCase() : realRelative,
          absolute
        );
      }
    }
    return new InternalSourceResolver(path.resolve(rootPath), rootRealPath, indexedFiles, options);
  }

  async resolve(
    importer: string,
    specifier: string,
    allowUnindexed = false
  ): Promise<SourceResolution> {
    const importerPath = path.resolve(importer);
    const importerRealPath = await fs.realpath(importerPath).catch(() => null);
    if (!importerRealPath || !isWithin(this.rootRealPath, importerRealPath))
      return { status: 'unresolved', reason: 'outside-root' };
    const matchingAlias = matchesPathAlias(specifier, this.compilerOptions.paths ?? {});
    const bareSpecifier = !specifier.startsWith('.') && !path.isAbsolute(specifier);
    if (bareSpecifier && matchingAlias.length === 0 && !this.compilerOptions.baseUrl) {
      return { status: 'unresolved', reason: 'external' };
    }
    const resolved = ts.resolveModuleName(specifier, importerPath, this.compilerOptions, ts.sys)
      .resolvedModule?.resolvedFileName;
    if (!resolved)
      return {
        status: 'unresolved',
        reason: matchingAlias.length > 0 ? 'not-found' : bareSpecifier ? 'external' : 'not-found'
      };
    const real = await fs.realpath(resolved).catch(() => null);
    if (!real) return { status: 'unresolved', reason: 'not-found' };
    if (!isWithin(this.rootRealPath, real)) {
      return {
        status: 'unresolved',
        reason: bareSpecifier && matchingAlias.length === 0 ? 'external' : 'outside-root'
      };
    }
    const relative = path.relative(this.rootRealPath, real).split(path.sep).join('/');
    const indexedPath = this.indexedFiles.get(
      process.platform === 'win32' ? relative.toLowerCase() : relative
    );
    if (indexedPath) return { status: 'resolved', path: indexedPath };
    if (allowUnindexed) return { status: 'resolved', path: real };
    return { status: 'unresolved', reason: 'not-found' };
  }
}

export function extractSourceReexports(
  source: string,
  filePath: string
): Array<{ specifier: string; line: number }> {
  if (!/\.[cm]?[jt]sx?$/i.test(filePath)) return [];
  if (!/\bexport\s+(?:type\s+)?(?:\*|\{)/.test(source)) return [];
  try {
    const ast = parse(source, { loc: true, jsx: /\.[jt]sx$/i.test(filePath) });
    const reexports: Array<{ specifier: string; line: number }> = [];
    for (const node of ast.body) {
      if (
        (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') &&
        node.source
      ) {
        reexports.push({ specifier: node.source.value, line: node.loc.start.line });
      }
    }
    return reexports;
  } catch {
    return [];
  }
}
