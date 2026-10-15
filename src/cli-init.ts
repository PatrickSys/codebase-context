/** Setup wizard and project-scoped native client configuration. */

import path from 'node:path';
import { homedir } from 'node:os';
import * as fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import select from '@inquirer/select';
import confirm from '@inquirer/confirm';
import { EXCLUDED_GLOB_PATTERNS } from './constants/codebase-context.js';

export type Client = 'claude-code' | 'cursor' | 'codex' | 'opencode';

export type McpConfigResult =
  | { kind: 'file'; path: string; content: string }
  | { kind: 'command'; executable: string; args: string[] };

type JsonObject = Record<string, unknown>;
const CODEX_SERVER_HEADER =
  /^\s*\[mcp_servers\.(?:"codebase-context"|'codebase-context'|codebase-context)\]\s*$/m;

export type InitIndexResult =
  | { status: 'ready'; summary?: string }
  | { status: 'error'; error: string };
export type InitPreviewResult =
  | {
      status: 'ready';
      rootPath: string;
      eligibleFiles: string[];
      skippedFiles: Array<{ path: string; reason: string }>;
      skippedFileCount: number;
      excludedPatterns: string[];
    }
  | { status: 'error'; error: string };
export type InitOptions = {
  rootPath?: string;
  previewIndex?: (rootPath: string) => Promise<InitPreviewResult>;
  prepareIndex?: (rootPath: string) => Promise<InitIndexResult>;
};

function resolveRoot(rootPath?: string): string {
  return path.resolve(rootPath ?? process.env.CODEBASE_ROOT ?? process.cwd());
}

export function generateMcpConfig(client: Client, rootPath = resolveRoot()): McpConfigResult {
  switch (client) {
    case 'claude-code':
      return {
        kind: 'command',
        executable: 'claude',
        args: ['mcp', 'add', '--transport', 'http', 'codebase-context', 'http://127.0.0.1:3100/mcp']
      };
    case 'cursor':
      return {
        kind: 'file',
        path: '.cursor/mcp.json',
        content: JSON.stringify(
          {
            mcpServers: { 'codebase-context': { type: 'http', url: 'http://127.0.0.1:3100/mcp' } }
          },
          null,
          2
        )
      };
    case 'codex': {
      const root = resolveRoot(rootPath);
      const executable = path.resolve(process.argv[1] ?? '');
      const content =
        '[mcp_servers.codebase-context]\n' +
        `command = ${JSON.stringify(process.execPath)}\n` +
        `cwd = ${JSON.stringify(root)}\n` +
        `args = [${JSON.stringify(executable)}, ${JSON.stringify(root)}]\n`;
      return { kind: 'file', path: path.join(root, '.codex', 'config.toml'), content };
    }
    case 'opencode':
      return {
        kind: 'file',
        path: 'opencode.json',
        content: JSON.stringify(
          {
            $schema: 'https://opencode.ai/config.json',
            mcp: { 'codebase-context': { type: 'remote', url: 'http://127.0.0.1:3100/mcp' } }
          },
          null,
          2
        )
      };
  }
}

export function generateInstructionBlock(): string {
  return `<!-- codebase-context:start -->
## Codebase Context (MCP)

**Start of every task:** Call \`get_memory\` to load team conventions before writing any code.
**Before editing existing code:** Call \`search_codebase\` with \`intent: "edit"\`. If the preflight card says \`ready: false\`, read the listed files before touching anything.
**Before writing new code:** Call \`get_team_patterns\` to check how the team handles DI, state, testing, and library wrappers — don't introduce a new pattern if one already exists.
**When asked to "remember" or "record" something:** Call \`remember\` immediately, before doing anything else.
**When adding imports that cross module boundaries:** Call \`detect_circular_dependencies\` with the relevant scope after adding the import.
<!-- codebase-context:end -->
`;
}

export function resolveInstructionFilePath(client: Client, cwd: string): string | null {
  switch (client) {
    case 'claude-code':
      return path.join(cwd, 'CLAUDE.md');
    case 'cursor':
      return path.join(cwd, '.cursorrules');
    case 'codex':
      return path.join(cwd, 'AGENTS.md');
    case 'opencode':
      return null;
  }
}

export async function _appendInstructionBlock(filePath: string): Promise<'written' | 'skipped'> {
  let existing: string;
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.writeFile(filePath, generateInstructionBlock(), 'utf8');
    return 'written';
  }
  if (existing.includes('<!-- codebase-context:start -->')) return 'skipped';
  await fs.writeFile(filePath, `${existing}\n${generateInstructionBlock()}`, 'utf8');
  return 'written';
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function _buildMergedMcpContent(
  filePath: string,
  generatedContent: string,
  client: Extract<Client, 'cursor' | 'opencode'>
): Promise<{ content: string; mergedFromExisting: boolean }> {
  let existing: unknown;
  try {
    existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return { content: generatedContent, mergedFromExisting: false };
  }
  const generated = JSON.parse(generatedContent) as unknown;
  if (!isJsonObject(existing) || !isJsonObject(generated))
    return { content: generatedContent, mergedFromExisting: false };
  if (client === 'cursor') {
    const existingServers = isJsonObject(existing.mcpServers) ? existing.mcpServers : {};
    const generatedServers = isJsonObject(generated.mcpServers) ? generated.mcpServers : {};
    return {
      content: JSON.stringify(
        { ...existing, ...generated, mcpServers: { ...existingServers, ...generatedServers } },
        null,
        2
      ),
      mergedFromExisting: true
    };
  }
  const existingMcp = isJsonObject(existing.mcp) ? existing.mcp : {};
  const generatedMcp = isJsonObject(generated.mcp) ? generated.mcp : {};
  return {
    content: JSON.stringify(
      { ...existing, ...generated, mcp: { ...existingMcp, ...generatedMcp } },
      null,
      2
    ),
    mergedFromExisting: true
  };
}

function parseInitArgs(argv: string[]): {
  client?: Client;
  rootPath?: string;
  yes: boolean;
  preview: boolean;
  help: boolean;
} {
  let client: Client | undefined;
  let rootPath: string | undefined;
  let yes = false;
  let preview = false;
  let help = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--yes' || arg === '--non-interactive') {
      yes = true;
      continue;
    }
    if (arg === '--preview') {
      preview = true;
      continue;
    }
    if (arg === '--client' || arg === '--root') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--root') rootPath = value;
      else if (
        value === 'claude-code' ||
        value === 'cursor' ||
        value === 'codex' ||
        value === 'opencode'
      )
        client = value;
      else
        throw new Error(
          `Unknown client "${value}". Choose claude-code, cursor, codex, or opencode.`
        );
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown init option: ${arg}`);
    throw new Error(`Unexpected positional init argument: ${arg}`);
  }
  if (yes && !client) throw new Error('--yes requires --client for non-interactive init');
  if (preview && !client) throw new Error('--preview requires --client codex');
  if (rootPath && client && client !== 'codex')
    throw new Error('--root is supported only for --client codex');
  if (preview && client !== 'codex')
    throw new Error('--preview is supported only for --client codex');
  return { client, rootPath, yes, preview, help };
}

export function printInitHelp(): void {
  console.log('codebase-context init [options]');
  console.log('  --help, -h                 Show init help without starting prompts');
  console.log('  --client <name>            claude-code | cursor | codex | opencode');
  console.log('  --root <directory>         Project root (Codex only)');
  console.log('  --preview                  Show Codex file selection without writing or indexing');
  console.log('  --yes, --non-interactive   Apply without prompts; requires --client');
}

function printIndexPreview(preview: Extract<InitPreviewResult, { status: 'ready' }>): void {
  const listedFiles = 12;
  console.log('\n--- Repository Index Preview ---');
  console.log(`Repository: ${preview.rootPath}`);
  console.log(`Eligible files: ${preview.eligibleFiles.length}`);
  for (const file of preview.eligibleFiles.slice(0, listedFiles)) console.log(`  + ${file}`);
  if (preview.eligibleFiles.length > listedFiles) {
    console.log(`  ... ${preview.eligibleFiles.length - listedFiles} more eligible files`);
  }
  console.log(`Skipped observed candidates: ${preview.skippedFileCount}`);
  for (const file of preview.skippedFiles.slice(0, listedFiles)) {
    console.log(`  - ${file.path} (${file.reason})`);
  }
  const unlistedSkipped =
    preview.skippedFileCount - Math.min(preview.skippedFiles.length, listedFiles);
  if (unlistedSkipped > 0) {
    console.log(`  ... ${unlistedSkipped} more observed skips`);
  }
  const defaultPatterns = new Set(EXCLUDED_GLOB_PATTERNS);
  const orderedPatterns = [
    ...preview.excludedPatterns.filter((pattern) => !defaultPatterns.has(pattern)),
    ...preview.excludedPatterns.filter((pattern) => defaultPatterns.has(pattern))
  ];
  const patternSample = orderedPatterns.slice(0, 6);
  console.log(`Excluded by rules before enumeration: ${preview.excludedPatterns.length} patterns`);
  for (const pattern of patternSample) console.log(`  x ${pattern}`);
  if (preview.excludedPatterns.length > patternSample.length) {
    console.log(`  ... ${preview.excludedPatterns.length - patternSample.length} more patterns`);
  }
  console.log('Files matching excluded patterns were not individually enumerated.');
  console.log(
    'This is a point-in-time preview; files or project settings may change before indexing.'
  );
}

function codexSectionMatches(existing: string, generated: string): boolean {
  const match = CODEX_SERVER_HEADER.exec(existing);
  if (!match || match.index === undefined) return false;
  const section = getCodexServerSection(existing, match);
  if (section === undefined) return false;
  const expected = generated
    .slice(generated.indexOf('\n') + 1)
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim());
  return expected.every((line) =>
    section.split(/\r?\n/).some((existingLine) => existingLine.trim() === line)
  );
}

function getCodexServerSection(
  existing: string,
  headerMatch = CODEX_SERVER_HEADER.exec(existing)
): string | undefined {
  if (!headerMatch || headerMatch.index === undefined) return undefined;
  const start = headerMatch.index + headerMatch[0].length;
  const rest = existing.slice(start);
  const endMatch = /^\s*\[[^\]]+\]\s*$/m.exec(rest);
  return rest.slice(0, endMatch?.index ?? rest.length);
}

export function _mergeCodexMcpContent(
  existing: string,
  generated: string
): { content: string; changed: boolean } {
  if (CODEX_SERVER_HEADER.test(existing)) {
    const section = getCodexServerSection(existing);
    if (/^\s*enabled\s*=\s*false\s*(?:#.*)?$/m.test(section ?? '')) {
      throw new Error(
        'Existing codebase-context server is disabled; set enabled = true explicitly, then rerun init.'
      );
    }
    if (codexSectionMatches(existing, generated)) return { content: existing, changed: false };
    throw new Error('Existing codebase-context settings conflict; refusing to overwrite them.');
  }
  return {
    content: `${existing}${existing && !existing.endsWith('\n') ? '\n' : existing ? '\n' : ''}${generated}`,
    changed: true
  };
}

async function writeCodexConfig(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  const globalConfigs = [path.join(homedir(), '.codex', 'config.toml')];
  if (process.env.CODEX_HOME) globalConfigs.push(path.join(process.env.CODEX_HOME, 'config.toml'));
  const canonicalPaths = await Promise.all(
    [filePath, ...globalConfigs].map(resolveCanonicalPathWithMissingLeaf)
  );
  const normalizedConfig = normalizeComparablePath(canonicalPaths[0] ?? path.resolve(filePath));
  if (
    canonicalPaths
      .slice(1)
      .some((globalConfig) => normalizeComparablePath(globalConfig) === normalizedConfig)
  ) {
    throw new Error(
      'Project root resolves to a Codex global config; refusing a project-only init write.'
    );
  }
  try {
    const directoryStat = await fs.lstat(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
      throw new Error(`Unsafe Codex config directory: ${directory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.mkdir(directory, { recursive: false });
  }
  let existing = '';
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1)
      throw new Error(`Unsafe Codex config file: ${filePath}`);
    existing = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let merged: { content: string; changed: boolean };
  try {
    merged = _mergeCodexMcpContent(existing, content);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)} (${filePath})`);
  }
  if (merged.changed) await fs.writeFile(filePath, merged.content, 'utf8');
}

function normalizeComparablePath(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function resolveCanonicalPathWithMissingLeaf(targetPath: string): Promise<string> {
  let candidate = path.resolve(targetPath);
  const missingSegments: string[] = [];
  while (true) {
    try {
      const resolvedAncestor = await fs.realpath(candidate);
      if (missingSegments.length > 0 && !(await fs.stat(resolvedAncestor)).isDirectory()) {
        throw new Error(
          `Cannot safely resolve Codex config path through non-directory ${candidate}`
        );
      }
      return path.resolve(resolvedAncestor, ...missingSegments.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        error instanceof Error &&
        error.message.startsWith('Cannot safely resolve Codex config path through')
      ) {
        throw error;
      }
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new Error(
          `Cannot safely resolve Codex config path ${candidate}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        throw new Error(`Cannot safely resolve Codex config path: ${targetPath}`);
      }
      missingSegments.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

async function resolveProjectRoot(root: string): Promise<string> {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`Project root is not a directory: ${root}`);
  return path.resolve(await fs.realpath(root));
}

export async function handleInitCli(argv: string[], options: InitOptions = {}): Promise<void> {
  let args: ReturnType<typeof parseInitArgs>;
  try {
    args = parseInitArgs(argv);
  } catch (error) {
    console.error(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    printInitHelp();
    return;
  }

  let root: string;
  try {
    root = await resolveProjectRoot(resolveRoot(options.rootPath ?? args.rootPath));
  } catch (error) {
    console.error(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nSet up codebase-context for your AI client\n');
  const client =
    args.client ??
    (await select<Client>({
      message: 'Which client?',
      choices: [
        { name: 'Claude Code', value: 'claude-code' },
        { name: 'Cursor', value: 'cursor' },
        { name: 'Codex', value: 'codex' },
        { name: 'OpenCode', value: 'opencode' }
      ]
    }));
  if (args.rootPath && client !== 'codex') {
    console.error('Init failed: --root is supported only for --client codex.');
    process.exitCode = 1;
    return;
  }
  if (client === 'codex') {
    let preview: InitPreviewResult;
    try {
      preview = options.previewIndex
        ? await options.previewIndex(root)
        : { status: 'error', error: 'index preview is unavailable in this CLI invocation' };
    } catch (error) {
      preview = { status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
    if (preview.status === 'error') {
      console.error(`Index preview failed: ${preview.error}`);
      process.exitCode = 1;
      return;
    }
    printIndexPreview(preview);
    if (args.preview) return;
  }
  const config = generateMcpConfig(client, root);
  console.log('\n--- MCP Config Preview ---');
  if (config.kind === 'file') console.log(`File: ${config.path}\n${config.content}`);
  else console.log(`Command to run: ${config.executable} ${config.args.join(' ')}`);
  const apply = args.yes || (await confirm({ message: 'Apply MCP config? [y/N]', default: false }));
  const instructionPath = client === 'codex' ? null : resolveInstructionFilePath(client, root);
  let applyInstruction = false;
  if (instructionPath) {
    console.log(
      `\n--- Instruction Block Preview (${instructionPath}) ---\n${generateInstructionBlock()}`
    );
    applyInstruction =
      args.yes || (await confirm({ message: 'Write instruction block? [y/N]', default: false }));
  }
  if (!apply) return;
  try {
    if (config.kind === 'file' && client === 'codex')
      await writeCodexConfig(config.path, config.content);
    else if (config.kind === 'file') {
      const merged = await _buildMergedMcpContent(
        config.path,
        config.content,
        client as Extract<Client, 'cursor' | 'opencode'>
      );
      await fs.mkdir(path.dirname(config.path), { recursive: true });
      await fs.writeFile(config.path, merged.content, 'utf8');
    } else execFileSync(config.executable, config.args, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  if (applyInstruction && instructionPath) await _appendInstructionBlock(instructionPath);
  if (client === 'codex') {
    let indexed: InitIndexResult;
    try {
      indexed = options.prepareIndex
        ? await options.prepareIndex(root)
        : { status: 'error', error: 'index preparation is unavailable in this CLI invocation' };
    } catch (error) {
      indexed = { status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
    if (indexed.status === 'error') {
      console.error(`Index preparation failed: ${indexed.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Index ready for ${root}${indexed.summary ? ` — ${indexed.summary}` : ''}`);
    console.log(`Trust this project in Codex if prompted, then restart/reopen Codex: ${root}`);
    console.log(
      'A written configuration and ready index do not prove Codex loaded or queried the server.'
    );
  }
}
