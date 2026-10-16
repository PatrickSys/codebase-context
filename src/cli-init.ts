/**
 * Interactive setup wizard for codebase-context.
 * Handles `codebase-context init` — generates MCP config and instruction block
 * for the four first-wave AI clients: Claude Code, Cursor, Codex, OpenCode.
 *
 * Depends only on Node built-ins and @inquirer/prompts.
 * No imports from the rest of the codebase — keeps this module side-effect-free
 * outside the wizard call and easy to unit test.
 */

import path from 'path';
import * as fs from 'node:fs/promises';
import { select, confirm } from '@inquirer/prompts';

export type Client = 'claude-code' | 'cursor' | 'codex' | 'opencode';

export type McpConfigResult = { kind: 'file'; path: string; content: string };

export type McpConfigOptions = {
  rootPath?: string;
  nodeExecutable?: string;
  serverEntrypoint?: string;
};

type JsonObject = Record<string, unknown>;

function quoteTomlString(value: string): string {
  return JSON.stringify(value);
}

export function generateMcpConfig(client: Client, options: McpConfigOptions = {}): McpConfigResult {
  const rootPath = path.resolve(options.rootPath ?? process.cwd());
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const serverEntrypoint = path.resolve(
    options.serverEntrypoint ?? process.argv[1] ?? path.join(rootPath, 'dist', 'index.js')
  );
  const stdioArgs = [serverEntrypoint, rootPath];

  switch (client) {
    case 'claude-code':
      return {
        kind: 'file',
        path: path.join(rootPath, '.mcp.json'),
        content: JSON.stringify(
          {
            mcpServers: {
              'codebase-context': {
                command: nodeExecutable,
                args: stdioArgs
              }
            }
          },
          null,
          2
        )
      };
    case 'cursor':
      return {
        kind: 'file',
        path: path.join(rootPath, '.cursor', 'mcp.json'),
        content: JSON.stringify(
          {
            mcpServers: {
              'codebase-context': {
                type: 'http',
                url: 'http://127.0.0.1:3100/mcp'
              }
            }
          },
          null,
          2
        )
      };
    case 'codex':
      return {
        kind: 'file',
        path: path.join(rootPath, '.codex', 'config.toml'),
        content:
          `[mcp_servers.codebase-context]\n` +
          `command = ${quoteTomlString(nodeExecutable)}\n` +
          `args = [${stdioArgs.map(quoteTomlString).join(', ')}]\n` +
          'startup_timeout_sec = 120\n'
      };
    case 'opencode':
      return {
        kind: 'file',
        path: path.join(rootPath, 'opencode.json'),
        content: JSON.stringify(
          {
            $schema: 'https://opencode.ai/config.json',
            mcp: {
              'codebase-context': {
                type: 'remote',
                url: 'http://127.0.0.1:3100/mcp'
              }
            }
          },
          null,
          2
        )
      };
  }
}

export function resolveInitRoot(
  args: string[],
  envRoot: string | undefined,
  cwd = process.cwd()
): string {
  let explicitRoot: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--root') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Expected a directory path after --root.');
      }
      explicitRoot = value;
      index++;
    } else if (arg?.startsWith('--root=')) {
      const value = arg.slice('--root='.length);
      if (!value) {
        throw new Error('Expected a directory path after --root.');
      }
      explicitRoot = value;
    }
  }

  return path.resolve(explicitRoot ?? (envRoot ? envRoot : cwd));
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

/**
 * Appends the instruction block to an existing file, or skips if already present.
 * Exported with leading underscore to signal internal/test-only use.
 */
export async function _appendInstructionBlock(filePath: string): Promise<'written' | 'skipped'> {
  let existing = '';
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch {
    // file does not exist — write fresh
    await fs.writeFile(filePath, generateInstructionBlock(), 'utf8');
    return 'written';
  }

  if (existing.includes('<!-- codebase-context:start -->')) {
    return 'skipped';
  }

  await fs.writeFile(filePath, existing + '\n' + generateInstructionBlock(), 'utf8');
  return 'written';
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJson(entry)])
    );
  }
  return value;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function readExistingConfig(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isFileNotFound(error)) return null;
    throw error;
  }
}

/**
 * Merge generated MCP config into an existing JSON config file when possible.
 * Preserves unrelated keys and refuses to replace a different codebase-context entry.
 */
export async function _buildMergedMcpContent(
  filePath: string,
  generatedContent: string,
  client: Extract<Client, 'claude-code' | 'cursor' | 'opencode'>
): Promise<{ content: string; mergedFromExisting: boolean }> {
  const existingText = await readExistingConfig(filePath);
  if (existingText === null) {
    return { content: generatedContent, mergedFromExisting: false };
  }

  let existing: unknown;
  try {
    existing = JSON.parse(existingText) as unknown;
  } catch (error) {
    throw new Error(`Cannot merge ${client} config at ${filePath}: existing JSON is invalid.`, {
      cause: error
    });
  }

  const generated = JSON.parse(generatedContent) as unknown;
  if (!isJsonObject(existing) || !isJsonObject(generated)) {
    throw new Error(`Cannot merge ${client} config at ${filePath}: expected a JSON object.`);
  }

  const serverKey = client === 'opencode' ? 'mcp' : 'mcpServers';
  const existingServersValue = existing[serverKey];
  if (existingServersValue !== undefined && !isJsonObject(existingServersValue)) {
    throw new Error(
      `Cannot merge ${client} config at ${filePath}: ${serverKey} must be a JSON object.`
    );
  }
  const generatedServersValue = generated[serverKey];
  if (!isJsonObject(generatedServersValue)) {
    throw new Error(`Invalid generated ${client} MCP config.`);
  }
  const existingServers = isJsonObject(existingServersValue) ? existingServersValue : {};
  const hasExistingCodebaseContext = Object.prototype.hasOwnProperty.call(
    existingServers,
    'codebase-context'
  );
  const generatedCodebaseContext = generatedServersValue['codebase-context'];
  if (
    hasExistingCodebaseContext &&
    !jsonValuesEqual(existingServers['codebase-context'], generatedCodebaseContext)
  ) {
    throw new Error(
      `Cannot merge ${client} config at ${filePath}: it already contains a different codebase-context configuration.`
    );
  }

  return {
    content: JSON.stringify(
      {
        ...existing,
        ...generated,
        [serverKey]: {
          ...existingServers,
          ...generatedServersValue
        }
      },
      null,
      2
    ),
    mergedFromExisting: true
  };
}

function normalizeTomlNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function tomlKeyPattern(key: string): string {
  return `(?:${key}|"${key}"|'${key}')`;
}

/**
 * Appends the project MCP table to Codex TOML, preserving other settings and
 * refusing to replace an existing codebase-context table.
 */
export async function _buildMergedCodexContent(
  filePath: string,
  generatedContent: string
): Promise<{ content: string; mergedFromExisting: boolean }> {
  const existing = await readExistingConfig(filePath);
  if (existing === null) {
    return { content: generatedContent, mergedFromExisting: false };
  }

  const normalizedExisting = normalizeTomlNewlines(existing);
  const normalizedGenerated = normalizeTomlNewlines(generatedContent).trim();
  const mcpServersKey = tomlKeyPattern('mcp_servers');
  const codebaseContextKey = tomlKeyPattern('codebase-context');
  const entryHeader = new RegExp(
    `^\\s*\\[{1,2}\\s*${mcpServersKey}\\s*\\.\\s*${codebaseContextKey}(?:\\s*\\.\\s*[^\\]]+)?\\s*\\]{1,2}\\s*(?:#.*)?$`,
    'gm'
  );
  const existingEntry = entryHeader.exec(normalizedExisting);

  if (existingEntry) {
    const nextTable = /^\s*\[{1,2}[^\r\n]+\]{1,2}\s*(?:#.*)?$/gm;
    nextTable.lastIndex = entryHeader.lastIndex;
    const nextTableMatch = nextTable.exec(normalizedExisting);
    const sectionEnd = nextTableMatch?.index ?? normalizedExisting.length;
    const section = normalizedExisting.slice(existingEntry.index, sectionEnd).trim();
    const exactEntryHeader = new RegExp(
      `^\\[\\s*${mcpServersKey}\\s*\\.\\s*${codebaseContextKey}\\s*\\]\\s*(?:#.*)?$`,
      'm'
    );
    const comparableSection = section.replace(exactEntryHeader, '[mcp_servers.codebase-context]');
    if (comparableSection === normalizedGenerated) {
      return { content: existing, mergedFromExisting: true };
    }
    throw new Error(
      `Cannot merge Codex config at ${filePath}: it already contains a different codebase-context configuration.`
    );
  }

  const dottedEntry = new RegExp(
    `^\\s*${mcpServersKey}\\s*\\.\\s*${codebaseContextKey}\\s*\\.`,
    'm'
  );
  if (dottedEntry.test(normalizedExisting)) {
    throw new Error(
      `Cannot merge Codex config at ${filePath}: it already contains a different codebase-context configuration.`
    );
  }

  const parentTableHeader = new RegExp(`^\\s*\\[\\s*${mcpServersKey}\\s*\\]\\s*(?:#.*)?$`, 'gm');
  let parentTable = parentTableHeader.exec(normalizedExisting);
  while (parentTable) {
    const nextTable = /^\s*\[{1,2}[^\r\n]+\]{1,2}\s*(?:#.*)?$/gm;
    nextTable.lastIndex = parentTableHeader.lastIndex;
    const nextTableMatch = nextTable.exec(normalizedExisting);
    const sectionEnd = nextTableMatch?.index ?? normalizedExisting.length;
    const parentSettings = normalizedExisting.slice(parentTableHeader.lastIndex, sectionEnd);
    const childEntry = new RegExp(`^\\s*${codebaseContextKey}\\s*(?:=|\\.)`, 'm');
    if (childEntry.test(parentSettings)) {
      throw new Error(
        `Cannot merge Codex config at ${filePath}: it already contains a different codebase-context configuration.`
      );
    }
    parentTable = parentTableHeader.exec(normalizedExisting);
  }

  const firstTable = /^\s*\[/m.exec(normalizedExisting);
  const rootSettings = firstTable
    ? normalizedExisting.slice(0, firstTable.index)
    : normalizedExisting;
  const inlineServers = new RegExp(`^\\s*${mcpServersKey}\\s*=`, 'm');
  if (inlineServers.test(rootSettings)) {
    throw new Error(
      `Cannot merge Codex config at ${filePath}: mcp_servers is already configured inline.`
    );
  }

  const prefix = normalizedExisting.trimEnd();
  return {
    content: `${prefix ? `${prefix}\n\n` : ''}${normalizedGenerated}\n`,
    mergedFromExisting: true
  };
}

type InitOptions = {
  client?: Client;
  rootPath: string;
  yes: boolean;
  help: boolean;
};

function parseClient(value: string): Client {
  if (value === 'claude-code' || value === 'cursor' || value === 'codex' || value === 'opencode') {
    return value;
  }
  throw new Error(`Unknown client "${value}". Choose claude-code, cursor, codex, or opencode.`);
}

function parseInitOptions(args: string[]): InitOptions {
  if (args.includes('--help') || args.includes('-h')) {
    return { rootPath: process.cwd(), yes: false, help: true };
  }

  let client: Client | undefined;
  let yes = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg === '--client') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Expected a client after --client.');
      }
      client = parseClient(value);
      index++;
    } else if (arg?.startsWith('--client=')) {
      client = parseClient(arg.slice('--client='.length));
    } else if (arg === '--root') {
      index++;
    } else if (arg?.startsWith('--root=')) {
      // Root values are validated once by resolveInitRoot below.
    } else {
      throw new Error(`Unknown init option "${arg}".`);
    }
  }

  return {
    ...(client ? { client } : {}),
    rootPath: resolveInitRoot(args, process.env.CODEBASE_ROOT, process.cwd()),
    yes,
    help: false
  };
}

function printInitUsage(): void {
  console.log('codebase-context init [options]');
  console.log('');
  console.log('Set up MCP config for an AI client.');
  console.log('');
  console.log('Options:');
  console.log('  --client <name>  claude-code, cursor, codex, or opencode');
  console.log('  --root <path>    Project root (default: CODEBASE_ROOT or cwd)');
  console.log('  --yes, -y        Write the MCP config without prompts');
  console.log('  --help, -h       Show this help');
}

function getCurrentCliEntrypoint(): string {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error('Cannot locate the codebase-context CLI entrypoint.');
  }
  return path.resolve(entrypoint);
}

export async function handleInitCli(args: string[]): Promise<void> {
  let options: InitOptions;
  try {
    options = parseInitOptions(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printInitUsage();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printInitUsage();
    return;
  }
  if (options.yes && !options.client) {
    console.error('Error: --yes requires --client.');
    printInitUsage();
    process.exitCode = 1;
    return;
  }

  console.log('\nSet up codebase-context for your AI client\n');

  const client =
    options.client ??
    (await select<Client>({
      message: 'Which client?',
      choices: [
        { name: 'Claude Code', value: 'claude-code' },
        { name: 'Cursor', value: 'cursor' },
        { name: 'Codex', value: 'codex' },
        { name: 'OpenCode', value: 'opencode' }
      ]
    }));

  const mcpResult = generateMcpConfig(client, {
    rootPath: options.rootPath,
    nodeExecutable: process.execPath,
    serverEntrypoint: getCurrentCliEntrypoint()
  });

  console.log('\n--- MCP Config Preview ---');
  console.log(
    'Existing unrelated settings will be preserved; a different codebase-context entry will stop setup.'
  );
  console.log(`File: ${mcpResult.path}\n${mcpResult.content}`);

  const applyMcp = options.yes
    ? true
    : await confirm({
        message: 'Apply MCP config? [y/N]',
        default: false
      });

  const instructionPath = options.yes ? null : resolveInstructionFilePath(client, options.rootPath);

  let applyInstruction = false;
  if (instructionPath !== null) {
    console.log(`\n--- Instruction Block Preview (will append to ${instructionPath}) ---`);
    console.log(generateInstructionBlock());

    applyInstruction = await confirm({
      message: 'Write instruction block? [y/N]',
      default: false
    });
  }

  try {
    if (applyMcp) {
      try {
        await fs.access(options.rootPath);
      } catch {
        throw new Error(`Project root does not exist or is not accessible: ${options.rootPath}`);
      }
      const dir = path.dirname(mcpResult.path);
      await fs.mkdir(dir, { recursive: true });
      const mergedConfig =
        client === 'codex'
          ? await _buildMergedCodexContent(mcpResult.path, mcpResult.content)
          : await _buildMergedMcpContent(mcpResult.path, mcpResult.content, client);
      await fs.writeFile(mcpResult.path, mergedConfig.content, 'utf8');
      if (mergedConfig.mergedFromExisting) {
        console.log(`Merged: ${mcpResult.path} (existing entries preserved)`);
      }
      console.log(`Written: ${mcpResult.path}`);
    }

    if (applyInstruction && instructionPath !== null) {
      const status = await _appendInstructionBlock(instructionPath);
      if (status === 'skipped') {
        console.log(`Instruction block already present in ${instructionPath}, skipping.`);
      } else {
        console.log(`Written: ${instructionPath}`);
      }
    }
  } catch (error) {
    console.error(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const nextSteps =
    client === 'claude-code' || client === 'codex'
      ? '  Restart or reopen the client in this project to load the MCP server.\n' +
        '  Run `npx codebase-context map` to see your codebase conventions\n'
      : '  Run `npx codebase-context map` to see your codebase conventions\n' +
        '  Start the HTTP server: npx codebase-context --http\n';
  console.log(`\nNext steps:\n${nextSteps}`);
}
