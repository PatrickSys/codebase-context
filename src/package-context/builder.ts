import path from 'path';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import {
  detectLanguage,
  isBinaryFile,
  isCodeFile,
  isDocumentationFile,
  isTestFile
} from '../utils/language-detection.js';
import type {
  ContextArtifactRecord,
  ContextEdgeRecord,
  ContextPackageArtifactKind,
  ContextPackageBuildOptions,
  ContextPackageBuildResult,
  ContextPackageConfidence,
  ContextPackageManifest,
  ContextPackageSourceRef,
  ContextPublicSurfaceRecord,
  ContextSymbolRecord
} from './types.js';

const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_ARTIFACTS = 400;
const GENERATED_WARNING = 'BEWARE: AI-GENERATED MARKDOWN FILE, DO NOT BLINDLY TRUST IT';

const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.context',
  '.ai-context',
  '.codebase-context',
  '.codebase-index',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache'
]);

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  module?: string;
  types?: string;
  typings?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  files?: string[];
}

interface SourceFile {
  relativePath: string;
  absolutePath: string;
  content: string;
  sizeBytes: number;
  hash: string;
}

interface BuildState {
  rootPath: string;
  outDir: string;
  packageJson: PackageJson;
  files: SourceFile[];
  artifacts: ContextArtifactRecord[];
  symbols: ContextSymbolRecord[];
  edges: ContextEdgeRecord[];
  publicSurface: ContextPublicSurfaceRecord[];
  warnings: string[];
  maxFileBytes: number;
  maxArtifacts: number;
}

export async function buildContextPackage(
  options: ContextPackageBuildOptions
): Promise<ContextPackageBuildResult> {
  const rootPath = path.resolve(options.rootPath);
  const outDir = path.resolve(options.outDir);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxArtifacts = options.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS;
  const packageJson = await readPackageJson(rootPath);
  const files = await collectSourceFiles(rootPath, maxFileBytes, maxArtifacts);

  const state: BuildState = {
    rootPath,
    outDir,
    packageJson,
    files,
    artifacts: [],
    symbols: [],
    edges: [],
    publicSurface: [],
    warnings: [],
    maxFileBytes,
    maxArtifacts
  };

  buildArtifacts(state);
  buildSymbols(state);
  buildPackagePublicSurface(state);
  linkEvidence(state);

  await writePackage(state);

  const manifest = createManifest(state);
  await writeJson(path.join(outDir, 'manifest.json'), manifest);

  return {
    manifest,
    outDir,
    artifactCount: state.artifacts.length,
    symbolCount: state.symbols.length,
    publicSurfaceCount: state.publicSurface.length,
    warningCount: state.warnings.length,
    warnings: state.warnings
  };
}

async function readPackageJson(rootPath: string): Promise<PackageJson> {
  const packageJsonPath = path.join(rootPath, 'package.json');
  const parsed = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Invalid package.json at ${packageJsonPath}`);
  }

  return {
    name: readOptionalString(parsed, 'name'),
    version: readOptionalString(parsed, 'version'),
    description: readOptionalString(parsed, 'description'),
    main: readOptionalString(parsed, 'main'),
    module: readOptionalString(parsed, 'module'),
    types: readOptionalString(parsed, 'types'),
    typings: readOptionalString(parsed, 'typings'),
    bin: readBin(parsed.bin),
    exports: parsed.exports,
    files: readStringArray(parsed.files)
  };
}

async function collectSourceFiles(
  rootPath: string,
  maxFileBytes: number,
  maxArtifacts: number
): Promise<SourceFile[]> {
  const files: SourceFile[] = [];

  async function visit(directory: string): Promise<void> {
    if (files.length >= maxArtifacts) {
      return;
    }

    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxArtifacts) {
        return;
      }

      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosix(path.relative(rootPath, absolutePath));

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }

      if (!entry.isFile() || isBinaryFile(relativePath)) {
        continue;
      }

      if (!shouldIncludePath(relativePath)) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      if (stat.size > maxFileBytes) {
        continue;
      }

      const content = await fs.readFile(absolutePath, 'utf-8');
      files.push({
        relativePath,
        absolutePath,
        content,
        sizeBytes: stat.size,
        hash: sha256(content)
      });
    }
  }

  await visit(rootPath);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function shouldIncludePath(relativePath: string): boolean {
  if (relativePath === 'package.json') return true;
  if (isDocumentationFile(relativePath) || isCodeFile(relativePath)) return true;

  const lower = relativePath.toLowerCase();
  return (
    lower.includes('changelog') ||
    lower.includes('license') ||
    lower.includes('migration') ||
    lower.includes('example') ||
    lower.includes('story')
  );
}

function buildArtifacts(state: BuildState): void {
  for (const file of state.files) {
    const kind = classifyArtifact(file.relativePath);
    const record: ContextArtifactRecord = {
      id: artifactId(file.relativePath),
      kind,
      path: file.relativePath,
      title: path.basename(file.relativePath),
      language: detectLanguage(file.relativePath),
      sizeBytes: file.sizeBytes,
      hash: file.hash,
      confidence: kind === 'package_manifest' ? 'high' : 'medium',
      evidence: [wholeFileEvidence(file.relativePath, file.content, `Source ${kind} file`)],
      metadata: {}
    };
    state.artifacts.push(record);
  }
}

function buildSymbols(state: BuildState): void {
  for (const file of state.files) {
    if (!isCodeFile(file.relativePath)) {
      continue;
    }

    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? '';
      const lineNumber = index + 1;
      const matches = extractSymbolsFromLine(line);
      for (const match of matches) {
        const symbol: ContextSymbolRecord = {
          id: symbolId(file.relativePath, match.name, lineNumber),
          name: match.name,
          kind: match.kind,
          path: file.relativePath,
          startLine: lineNumber,
          endLine: lineNumber,
          exported: match.exported,
          confidence: match.exported ? 'high' : 'medium',
          evidence: [
            {
              file: file.relativePath,
              startLine: lineNumber,
              endLine: lineNumber,
              reason: 'Syntactic symbol declaration'
            }
          ],
          metadata: {}
        };
        state.symbols.push(symbol);
      }
    }
  }
}

function buildPackagePublicSurface(state: BuildState): void {
  const manifestArtifact = state.artifacts.find((artifact) => artifact.path === 'package.json');
  const packageEvidence = manifestArtifact?.evidence ?? [];
  const addSurface = (
    name: string,
    kind: string,
    entrypoint: string | undefined,
    pathValue: string | undefined,
    confidence: ContextPackageConfidence,
    evidence: ContextPackageSourceRef[],
    metadata: Record<string, unknown> = {}
  ): void => {
    const id = `surface:${slug([kind, name, entrypoint ?? pathValue ?? 'root'].join(':'))}`;
    if (state.publicSurface.some((entry) => entry.id === id)) {
      return;
    }
    state.publicSurface.push({
      id,
      name,
      kind,
      ...(entrypoint ? { entrypoint } : {}),
      ...(pathValue ? { path: pathValue } : {}),
      confidence,
      evidence,
      metadata
    });
  };

  for (const symbol of state.symbols.filter((item) => item.exported)) {
    addSurface(symbol.name, symbol.kind, undefined, symbol.path, symbol.confidence, symbol.evidence);
  }

  for (const entry of packageEntrypoints(state.packageJson)) {
    addSurface(
      entry.name,
      entry.kind,
      entry.entrypoint,
      entry.path,
      'high',
      packageEvidence,
      entry.metadata
    );
  }

  if (state.publicSurface.length === 0) {
    state.warnings.push('No public surface entries were detected from exports or package metadata.');
  }
}

function linkEvidence(state: BuildState): void {
  for (const surface of state.publicSurface) {
    if (surface.path) {
      const artifact = state.artifacts.find((item) => item.path === surface.path);
      if (artifact) {
        state.edges.push(edgeRecord('exports', 'artifact:package-json', artifact.id, surface.evidence));
      }
    }

    const mentions = findMentioningArtifacts(state, surface.name);
    for (const artifact of mentions) {
      state.edges.push(edgeRecord('mentions', artifact.id, surface.id, artifact.evidence));
    }
  }

  for (const testArtifact of state.artifacts.filter((artifact) => artifact.kind === 'test')) {
    for (const sourceArtifact of state.artifacts.filter((artifact) => artifact.kind === 'source')) {
      if (sameStem(testArtifact.path, sourceArtifact.path)) {
        state.edges.push(edgeRecord('tests', testArtifact.id, sourceArtifact.id, testArtifact.evidence));
      }
    }
  }

  for (const exampleArtifact of state.artifacts.filter((artifact) =>
    ['example', 'story', 'documentation'].includes(artifact.kind)
  )) {
    for (const surface of state.publicSurface) {
      if (fileContainsWord(state, exampleArtifact.path, surface.name)) {
        state.edges.push(edgeRecord('demonstrates', exampleArtifact.id, surface.id, exampleArtifact.evidence));
      }
    }
  }
}

async function writePackage(state: BuildState): Promise<void> {
  await fs.mkdir(path.join(state.outDir, 'graph'), { recursive: true });
  await fs.mkdir(path.join(state.outDir, 'packets'), { recursive: true });
  await fs.mkdir(path.join(state.outDir, 'provenance'), { recursive: true });
  await fs.mkdir(path.join(state.outDir, 'indexes'), { recursive: true });

  await writeJsonl(path.join(state.outDir, 'graph', 'artifacts.jsonl'), state.artifacts);
  await writeJsonl(path.join(state.outDir, 'graph', 'symbols.jsonl'), state.symbols);
  await writeJsonl(path.join(state.outDir, 'graph', 'edges.jsonl'), state.edges);
  await writeJsonl(path.join(state.outDir, 'graph', 'public-surface.jsonl'), state.publicSurface);

  await writeJson(path.join(state.outDir, 'packets', 'overview.json'), buildOverviewPacket(state));
  await writeJson(path.join(state.outDir, 'packets', 'api-surface.json'), {
    entries: state.publicSurface
  });
  await writeJson(path.join(state.outDir, 'packets', 'examples.json'), {
    artifacts: artifactsByKind(state, ['example'])
  });
  await writeJson(path.join(state.outDir, 'packets', 'testing.json'), {
    artifacts: artifactsByKind(state, ['test'])
  });
  await writeJson(path.join(state.outDir, 'packets', 'decisions.json'), {
    artifacts: artifactsByKind(state, ['decision'])
  });
  await writeJson(path.join(state.outDir, 'packets', 'migrations.json'), {
    artifacts: artifactsByKind(state, ['migration', 'changelog'])
  });
  await writeJson(path.join(state.outDir, 'packets', 'storybook.json'), {
    artifacts: artifactsByKind(state, ['story'])
  });
  await writeJson(path.join(state.outDir, 'indexes', 'lexical.json'), buildLexicalIndex(state));
  await writeJson(path.join(state.outDir, 'provenance', 'source-manifest.json'), {
    rootPath: state.rootPath,
    files: state.files.map((file) => ({
      path: file.relativePath,
      sizeBytes: file.sizeBytes,
      hash: file.hash
    }))
  });
  await writeJson(path.join(state.outDir, 'provenance', 'hashes.json'), {
    algorithm: 'sha256',
    files: Object.fromEntries(state.files.map((file) => [file.relativePath, file.hash]))
  });
  await writeJson(path.join(state.outDir, 'provenance', 'extractor-report.json'), {
    extractor: 'deterministic-package-context-v0',
    warnings: state.warnings,
    counts: {
      artifacts: state.artifacts.length,
      symbols: state.symbols.length,
      edges: state.edges.length,
      publicSurface: state.publicSurface.length
    },
    limitations: [
      'Syntactic extraction only; no build or type checker proof.',
      'LLM summaries are not generated.',
      'Framework-specific extractors are not enabled in this Track A surface.'
    ]
  });
  await fs.writeFile(path.join(state.outDir, 'README.md'), renderPackageReadme(state), 'utf-8');
}

function createManifest(state: BuildState): ContextPackageManifest {
  return {
    schemaVersion: 'ai-context-package.v0',
    generatedAt: new Date().toISOString(),
    generator: {
      name: 'codebase-context',
      feature: 'package-context'
    },
    package: {
      name: state.packageJson.name ?? path.basename(state.rootPath),
      ...(state.packageJson.version ? { version: state.packageJson.version } : {}),
      ...(state.packageJson.description ? { description: state.packageJson.description } : {}),
      rootPath: state.rootPath
    },
    outputs: {
      readme: 'README.md',
      graph: {
        artifacts: 'graph/artifacts.jsonl',
        symbols: 'graph/symbols.jsonl',
        edges: 'graph/edges.jsonl',
        publicSurface: 'graph/public-surface.jsonl'
      },
      packets: {
        overview: 'packets/overview.json',
        apiSurface: 'packets/api-surface.json',
        examples: 'packets/examples.json',
        testing: 'packets/testing.json',
        decisions: 'packets/decisions.json',
        migrations: 'packets/migrations.json',
        storybook: 'packets/storybook.json'
      },
      provenance: {
        sourceManifest: 'provenance/source-manifest.json',
        hashes: 'provenance/hashes.json',
        extractorReport: 'provenance/extractor-report.json'
      }
    },
    limits: {
      maxFileBytes: state.maxFileBytes,
      maxArtifacts: state.maxArtifacts
    }
  };
}

function buildOverviewPacket(state: BuildState): Record<string, unknown> {
  return {
    package: {
      name: state.packageJson.name ?? path.basename(state.rootPath),
      version: state.packageJson.version,
      description: state.packageJson.description
    },
    guidance: [
      'Use public-surface entries before guessing APIs from internal files.',
      'Prefer examples, tests, and docs with high or medium confidence evidence.',
      'Treat low-confidence entries as starting points, not authoritative guidance.'
    ],
    counts: {
      artifacts: state.artifacts.length,
      symbols: state.symbols.length,
      publicSurface: state.publicSurface.length,
      edges: state.edges.length
    },
    warnings: state.warnings
  };
}

function buildLexicalIndex(state: BuildState): Record<string, unknown> {
  const records = state.artifacts.map((artifact) => ({
    id: artifact.id,
    path: artifact.path,
    kind: artifact.kind,
    title: artifact.title,
    tokens: tokenize([artifact.path, artifact.title, artifact.kind].join(' '))
  }));
  return {
    schemaVersion: 'ai-context-package-lexical.v0',
    records
  };
}

function renderPackageReadme(state: BuildState): string {
  const packageName = state.packageJson.name ?? path.basename(state.rootPath);
  const version = state.packageJson.version ? ` ${state.packageJson.version}` : '';
  const surfaceLines = state.publicSurface.slice(0, 20).map((entry) => {
    const evidence = entry.evidence[0];
    const source = evidence ? `${evidence.file}:${evidence.startLine}` : 'no evidence';
    return `- ${entry.name} (${entry.kind}, ${entry.confidence}) — ${source}`;
  });

  return `${GENERATED_WARNING}

# AI Context Package: ${packageName}${version}

This package was generated locally by \`codebase-context package build\`.

## What To Trust

Use entries with source evidence first. Low-confidence entries are leads for inspection, not instructions.

## Public Surface

${surfaceLines.length > 0 ? surfaceLines.join('\n') : '- No public surface entries detected.'}

## Files

- Manifest: \`manifest.json\`
- Public API packet: \`packets/api-surface.json\`
- Artifacts graph: \`graph/artifacts.jsonl\`
- Provenance: \`provenance/source-manifest.json\`

## Limitations

- Syntactic extraction only.
- No cloud calls or LLM-generated summaries were used.
- Maintainer review is required before publishing this artifact as package guidance.
`;
}

function classifyArtifact(relativePath: string): ContextPackageArtifactKind {
  const lower = relativePath.toLowerCase();
  if (lower === 'package.json') return 'package_manifest';
  if (lower.includes('changelog')) return 'changelog';
  if (lower.includes('migration')) return 'migration';
  if (lower.includes('.stories.') || lower.includes('.story.') || lower.includes('/stories/')) {
    return 'story';
  }
  if (isTestFile(relativePath)) return 'test';
  if (lower.includes('/example') || lower.includes('examples/') || lower.includes('.example.')) {
    return 'example';
  }
  if (isDocumentationFile(relativePath) || lower.includes('license')) return 'documentation';
  if (isCodeFile(relativePath)) return 'source';
  return 'generated_context';
}

function extractSymbolsFromLine(
  line: string
): Array<{ name: string; kind: string; exported: boolean }> {
  const trimmed = line.trim();
  const results: Array<{ name: string; kind: string; exported: boolean }> = [];
  const patterns: Array<{ regex: RegExp; kind: string; exported: boolean }> = [
    { regex: /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function', exported: true },
    { regex: /^export\s+class\s+([A-Za-z_$][\w$]*)/, kind: 'class', exported: true },
    { regex: /^export\s+interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface', exported: true },
    { regex: /^export\s+type\s+([A-Za-z_$][\w$]*)/, kind: 'type', exported: true },
    { regex: /^export\s+const\s+([A-Za-z_$][\w$]*)/, kind: 'const', exported: true },
    { regex: /^export\s+\{\s*([^}]+)\s*\}/, kind: 'export', exported: true },
    { regex: /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function', exported: false },
    { regex: /^class\s+([A-Za-z_$][\w$]*)/, kind: 'class', exported: false },
    { regex: /^const\s+([A-Za-z_$][\w$]*)/, kind: 'const', exported: false },
    { regex: /^module\.exports\s*=\s*([A-Za-z_$][\w$]*)/, kind: 'commonjs-export', exported: true },
    { regex: /^exports\.([A-Za-z_$][\w$]*)\s*=/, kind: 'commonjs-export', exported: true }
  ];

  for (const pattern of patterns) {
    const match = pattern.regex.exec(trimmed);
    if (!match) continue;

    const rawName = match[1] ?? '';
    if (pattern.kind === 'export' && rawName.includes(',')) {
      for (const part of rawName.split(',')) {
        const name = part.trim().split(/\s+as\s+/i).pop()?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
          results.push({ name, kind: 'export', exported: true });
        }
      }
      continue;
    }

    if (rawName) {
      results.push({ name: rawName, kind: pattern.kind, exported: pattern.exported });
    }
  }

  return results;
}

function packageEntrypoints(
  packageJson: PackageJson
): Array<{
  name: string;
  kind: string;
  entrypoint?: string;
  path?: string;
  metadata: Record<string, unknown>;
}> {
  const entries: Array<{
    name: string;
    kind: string;
    entrypoint?: string;
    path?: string;
    metadata: Record<string, unknown>;
  }> = [];

  const addPath = (name: string, kind: string, value: string): void => {
    entries.push({ name, kind, path: trimRelativeMarker(value), metadata: {} });
  };

  if (packageJson.main) addPath('main', 'entrypoint', packageJson.main);
  if (packageJson.module) addPath('module', 'entrypoint', packageJson.module);
  if (packageJson.types) addPath('types', 'types', packageJson.types);
  if (packageJson.typings) addPath('typings', 'types', packageJson.typings);

  if (typeof packageJson.bin === 'string') {
    entries.push({ name: 'bin', kind: 'binary', path: trimRelativeMarker(packageJson.bin), metadata: {} });
  } else if (isRecord(packageJson.bin)) {
    for (const [name, value] of Object.entries(packageJson.bin)) {
      if (typeof value === 'string') {
        entries.push({ name, kind: 'binary', path: trimRelativeMarker(value), metadata: {} });
      }
    }
  }

  for (const entry of flattenExports(packageJson.exports)) {
    entries.push(entry);
  }

  return entries;
}

function flattenExports(exportsValue: unknown): Array<{
  name: string;
  kind: string;
  entrypoint?: string;
  path?: string;
  metadata: Record<string, unknown>;
}> {
  if (typeof exportsValue === 'string') {
    return [{ name: '.', kind: 'export-path', entrypoint: '.', path: trimRelativeMarker(exportsValue), metadata: {} }];
  }

  if (!isRecord(exportsValue)) {
    return [];
  }

  const results: Array<{
    name: string;
    kind: string;
    entrypoint?: string;
    path?: string;
    metadata: Record<string, unknown>;
  }> = [];

  for (const [key, value] of Object.entries(exportsValue)) {
    if (typeof value === 'string') {
      results.push({
        name: key,
        kind: 'export-path',
        entrypoint: key,
        path: trimRelativeMarker(value),
        metadata: {}
      });
    } else if (isRecord(value)) {
      for (const [condition, conditionValue] of Object.entries(value)) {
        if (typeof conditionValue === 'string') {
          results.push({
            name: key,
            kind: 'export-path',
            entrypoint: key,
            path: trimRelativeMarker(conditionValue),
            metadata: { condition }
          });
        }
      }
    }
  }

  return results;
}

function findMentioningArtifacts(state: BuildState, name: string): ContextArtifactRecord[] {
  return state.artifacts.filter((artifact) => {
    if (artifact.kind === 'source' || artifact.kind === 'package_manifest') return false;
    return fileContainsWord(state, artifact.path, name);
  });
}

function fileContainsWord(state: BuildState, relativePath: string, word: string): boolean {
  const file = state.files.find((item) => item.relativePath === relativePath);
  if (!file) return false;
  const escaped = escapeRegex(word);
  return new RegExp(`\\b${escaped}\\b`, 'i').test(file.content);
}

function edgeRecord(
  kind: ContextEdgeRecord['kind'],
  from: string,
  to: string,
  evidence: ContextPackageSourceRef[]
): ContextEdgeRecord {
  return {
    id: `edge:${slug(`${kind}:${from}:${to}`)}`,
    kind,
    from,
    to,
    confidence: evidence.length > 0 ? 'medium' : 'low',
    evidence,
    metadata: {}
  };
}

function artifactsByKind(
  state: BuildState,
  kinds: ContextPackageArtifactKind[]
): ContextArtifactRecord[] {
  const allowed = new Set(kinds);
  return state.artifacts.filter((artifact) => allowed.has(artifact.kind));
}

function wholeFileEvidence(pathValue: string, content: string, reason: string): ContextPackageSourceRef {
  return {
    file: pathValue,
    startLine: 1,
    endLine: Math.max(1, content.split(/\r?\n/).length),
    reason
  };
}

function sameStem(left: string, right: string): boolean {
  const leftStem = path.basename(left).split('.')[0]?.toLowerCase();
  const rightStem = path.basename(right).split('.')[0]?.toLowerCase();
  return Boolean(leftStem && rightStem && leftStem === rightStem);
}

function artifactId(relativePath: string): string {
  if (relativePath === 'package.json') return 'artifact:package-json';
  return `artifact:${slug(relativePath)}`;
}

function symbolId(relativePath: string, name: string, line: number): string {
  return `symbol:${slug(relativePath)}:${slug(name)}:${line}`;
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function tokenize(input: string): string[] {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((token) => token.length > 1)
    )
  ).slice(0, 40);
}

function trimRelativeMarker(value: string): string {
  return value.replace(/^\.\//, '');
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function writeJsonl(targetPath: string, records: readonly unknown[]): Promise<void> {
  await fs.writeFile(targetPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf-8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length === value.length ? strings : undefined;
}

function readBin(value: unknown): string | Record<string, string> | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return Object.fromEntries(entries);
}
