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
import { homedir } from 'node:os';
import { execFileSync } from 'child_process';
import { select, confirm } from '@inquirer/prompts';
import { parse as parseToml } from '@iarna/toml';

export type Client = 'claude-code' | 'cursor' | 'codex' | 'opencode';

export type McpConfigResult =
  | { kind: 'file'; path: string; content: string }
  | { kind: 'command'; executable: string; args: string[] };

type McpCommandConfig = Extract<McpConfigResult, { kind: 'command' }>;
type McpCommandRunner = (
  executable: string,
  args: string[],
  options: { stdio: 'inherit' }
) => unknown;

type JsonObject = Record<string, unknown>;

export type InitIndexResult =
  | { status: 'ready'; summary?: string }
  | { status: 'error'; error: string };

export type InitOptions = {
  rootPath?: string;
  prepareIndex?: (rootPath: string) => Promise<InitIndexResult>;
};

function resolveInitRoot(rootPath?: string): string {
  return path.resolve(rootPath ?? process.env.CODEBASE_ROOT ?? process.cwd());
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value).replace(/[\\/]$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

async function resolveProjectRoot(rootPath: string): Promise<string> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(rootPath);
  } catch (error) {
    throw new Error(
      `Project root is missing or unreadable (${rootPath}): ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(`Project root is not a directory: ${rootPath}`);
  }
  try {
    return path.resolve(await fs.realpath(rootPath));
  } catch (error) {
    throw new Error(
      `Project root cannot be canonicalized (${rootPath}): ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function resolveGlobalCodexConfigPath(codexHome: string): Promise<string> {
  const configPath = path.join(codexHome, 'config.toml');
  try {
    return path.resolve(await fs.realpath(configPath));
  } catch {
    try {
      return path.join(path.resolve(await fs.realpath(codexHome)), 'config.toml');
    } catch {
      return path.resolve(configPath);
    }
  }
}

async function assertProjectScopedCodexTarget(rootPath: string): Promise<void> {
  const projectConfig = path.join(rootPath, '.codex', 'config.toml');
  const globalHomes = [path.join(homedir(), '.codex')];
  if (process.env.CODEX_HOME) globalHomes.push(process.env.CODEX_HOME);
  const globalConfigs = await Promise.all(globalHomes.map(resolveGlobalCodexConfigPath));
  const collision = globalConfigs.find((globalConfig) => samePath(projectConfig, globalConfig));
  if (collision) {
    throw new Error(
      `Project root resolves to the Codex global config (${collision}); refusing a project-only init write.`
    );
  }
}

function codexConfigContent(rootPath: string): string {
  return (
    '[mcp_servers.codebase-context]\n' +
    'command = "npx"\n' +
    `cwd = ${JSON.stringify(rootPath)}\n` +
    `args = ["-y", "codebase-context", ${JSON.stringify(rootPath)}]\n`
  );
}

export function generateMcpConfig(client: Client, rootPath = resolveInitRoot()): McpConfigResult {
  switch (client) {
    case 'claude-code':
      return {
        kind: 'command',
        executable: 'claude',
        args: [
          'mcp',
          'add',
          '--scope',
          'project',
          'codebase-context',
          '--',
          'npx',
          '-y',
          'codebase-context'
        ]
      };
    case 'cursor':
      return {
        kind: 'file',
        path: '.cursor/mcp.json',
        content: JSON.stringify(
          {
            mcpServers: {
              'codebase-context': {
                command: 'npx',
                args: ['-y', 'codebase-context']
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
        path: path.join(resolveInitRoot(rootPath), '.codex', 'config.toml'),
        content: codexConfigContent(resolveInitRoot(rootPath))
      };
    case 'opencode':
      return {
        kind: 'file',
        path: 'opencode.json',
        content: JSON.stringify(
          {
            $schema: 'https://opencode.ai/config.json',
            mcp: {
              'codebase-context': {
                type: 'local',
                command: ['npx', '-y', 'codebase-context'],
                enabled: true,
                timeout: 120000
              }
            }
          },
          null,
          2
        )
      };
  }
}

export function _executeMcpCommand(
  config: McpCommandConfig,
  runner: McpCommandRunner = (executable, args, options) => execFileSync(executable, args, options)
): void {
  runner(config.executable, config.args, { stdio: 'inherit' });
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
      return null;
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

/**
 * Merge generated MCP config into an existing JSON config file when possible.
 * Preserves unrelated keys and only updates the codebase-context server entry.
 */
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
  if (!isJsonObject(existing) || !isJsonObject(generated)) {
    return { content: generatedContent, mergedFromExisting: false };
  }

  if (client === 'cursor') {
    const existingServers = isJsonObject(existing.mcpServers) ? existing.mcpServers : {};
    const generatedServers = isJsonObject(generated.mcpServers) ? generated.mcpServers : {};
    return {
      content: JSON.stringify(
        {
          ...existing,
          ...generated,
          mcpServers: {
            ...existingServers,
            ...generatedServers
          }
        },
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
      {
        ...existing,
        ...generated,
        mcp: {
          ...existingMcp,
          ...generatedMcp
        }
      },
      null,
      2
    ),
    mergedFromExisting: true
  };
}

/**
 * Validate and merge the project-scoped Codex server entry while preserving the
 * original text for every unrelated TOML key, comment, and table.
 */
export async function _buildCodexMcpContent(
  filePath: string,
  generatedContent: string,
  rootPath: string
): Promise<{ content: string; changed: boolean }> {
  let existing: string;
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Codex config is a symbolic link: ${filePath}`);
    }
    if (!stat.isFile() || stat.nlink > 1) {
      throw new Error(`Codex config is not a regular, unlinked file: ${filePath}`);
    }
    existing = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { content: generatedContent, changed: true };
    }
    if (
      error instanceof Error &&
      (error.message.startsWith('Codex config is a symbolic link:') ||
        error.message.startsWith('Codex config is not a regular, unlinked file:'))
    ) {
      throw error;
    }
    throw new Error(
      `Cannot read Codex config ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = parseToml(existing);
  } catch (error) {
    throw new Error(
      `Cannot parse Codex config ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const root = isJsonObject(parsed) ? parsed.mcp_servers : undefined;
  if (root !== undefined && !isJsonObject(root)) {
    throw new Error(`Cannot add codebase-context: mcp_servers is not a TOML table in ${filePath}`);
  }

  const current = isJsonObject(root) ? root['codebase-context'] : undefined;
  if (current !== undefined) {
    const expected = { command: 'npx', cwd: rootPath, args: ['-y', 'codebase-context', rootPath] };
    if (!isJsonObject(current) || !deepEqualTomlValue(current, expected)) {
      throw new Error(
        `Existing codebase-context settings conflict in ${filePath}; refusing to overwrite them. ` +
          'Review that server entry and rerun init.'
      );
    }
    return { content: existing, changed: false };
  }

  const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  const content = `${existing}${separator}${generatedContent}`;
  try {
    parseToml(content);
  } catch (error) {
    throw new Error(
      `Cannot merge codebase-context into Codex config ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return { content, changed: true };
}

async function ensureSafeCodexDirectory(directoryPath: string): Promise<void> {
  try {
    const stat = await fs.lstat(directoryPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Codex config directory is a symbolic link: ${directoryPath}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Codex config path is not a directory: ${directoryPath}`);
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.mkdir(directoryPath, { recursive: false });
  }
}

function deepEqualTomlValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqualTomlValue(item, right[index]));
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqualTomlValue(left[key], right[key]))
    );
  }
  return false;
}

function parseInitArgs(argv: string[]): {
  client?: Client;
  rootPath?: string;
  yes: boolean;
} {
  let client: Client | undefined;
  let rootPath: string | undefined;
  let yes = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--yes' || arg === '--non-interactive') {
      yes = true;
      continue;
    }
    if (arg === '--client' || arg === '--root') {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === '--root') {
        rootPath = value;
      } else if (value === 'claude-code' || value === 'cursor' || value === 'codex' || value === 'opencode') {
        client = value;
      } else {
        throw new Error(`Unknown client "${value}". Choose claude-code, cursor, codex, or opencode.`);
      }
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown init option: ${arg}`);
    throw new Error(`Unexpected positional init argument: ${arg}`);
  }
  if (yes && !client) throw new Error('--yes requires --client for non-interactive init');
  return { client, rootPath, yes };
}

export async function handleInitCli(_argv: string[], options: InitOptions = {}): Promise<void> {
  let parsedArgs: ReturnType<typeof parseInitArgs>;
  try {
    parsedArgs = parseInitArgs(_argv);
  } catch (error) {
    console.error(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  let rootPath = resolveInitRoot(options.rootPath ?? parsedArgs.rootPath);
  if (parsedArgs.rootPath && parsedArgs.client && parsedArgs.client !== 'codex') {
    console.error('Init failed: --root is supported only for --client codex.');
    process.exitCode = 1;
    return;
  }
  try {
    rootPath = await resolveProjectRoot(rootPath);
  } catch (error) {
    console.error(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nSet up codebase-context for your AI client\n');

  const client =
    parsedArgs.client ??
    (await select<Client>({
      message: 'Which client?',
      choices: [
        { name: 'Claude Code', value: 'claude-code' },
        { name: 'Cursor', value: 'cursor' },
        { name: 'Codex', value: 'codex' },
        { name: 'OpenCode', value: 'opencode' }
      ]
    }));

  if (parsedArgs.rootPath && client !== 'codex') {
    console.error('Init failed: --root is supported only for --client codex.');
    process.exitCode = 1;
    return;
  }
  if (client === 'codex') {
    try {
      await assertProjectScopedCodexTarget(rootPath);
    } catch (error) {
      console.error(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }
  }

  const mcpResult = generateMcpConfig(client, rootPath);

  console.log('\n--- MCP Config Preview ---');
  if (mcpResult.kind === 'file') {
    try {
      await fs.access(mcpResult.path);
      console.log(`Warning: ${mcpResult.path} already exists; existing entries will be preserved.`);
    } catch {
      // file does not exist
    }
    console.log(`File: ${mcpResult.path}\n${mcpResult.content}`);
  } else {
    console.log(`Command to run: ${mcpResult.executable} ${mcpResult.args.join(' ')}`);
  }

  const applyMcp = parsedArgs.yes || (await confirm({ message: 'Apply MCP config? [y/N]', default: false }));

  const instructionPath = resolveInstructionFilePath(client, process.cwd());

  let applyInstruction = false;
  if (instructionPath !== null) {
    let fileExists = false;
    try {
      await fs.access(instructionPath);
      fileExists = true;
    } catch {
      // does not exist
    }

    if (fileExists) {
      console.log(`\n--- Instruction Block Preview (will append to ${instructionPath}) ---`);
    } else {
      console.log(`\n--- Instruction Block Preview (will create ${instructionPath}) ---`);
    }
    console.log(generateInstructionBlock());

    applyInstruction = parsedArgs.yes
      ? false
      : await confirm({ message: 'Write instruction block? [y/N]', default: false });
  }

  // Execute confirmed actions

  if (applyMcp) {
    try {
      if (mcpResult.kind === 'file') {
        const dir = path.dirname(mcpResult.path);
        if (client === 'codex') {
          await ensureSafeCodexDirectory(dir);
          const mergedConfig = await _buildCodexMcpContent(mcpResult.path, mcpResult.content, rootPath);
          if (mergedConfig.changed) {
            await fs.writeFile(mcpResult.path, mergedConfig.content, 'utf8');
            console.log(`Written: ${mcpResult.path}`);
          } else {
            console.log(`Already configured: ${mcpResult.path} (unchanged)`);
          }
        } else if (client === 'cursor' || client === 'opencode') {
          if (dir && dir !== '.') {
            await fs.mkdir(dir, { recursive: true });
          }
          const mergedConfig = await _buildMergedMcpContent(mcpResult.path, mcpResult.content, client);
          await fs.writeFile(mcpResult.path, mergedConfig.content, 'utf8');
          if (mergedConfig.mergedFromExisting) {
            console.log(`Merged: ${mcpResult.path} (existing entries preserved)`);
          }
          console.log(`Written: ${mcpResult.path}`);
        } else {
          throw new Error(`Unsupported file configuration for ${client}`);
        }
      } else {
        try {
          _executeMcpCommand(mcpResult);
        } catch {
          console.log(
            `Could not run '${mcpResult.executable}' automatically. Run it yourself:\n  ${mcpResult.executable} ${mcpResult.args.join(' ')}`
          );
        }
      }
    } catch (error) {
      console.error(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }
  }

  if (applyInstruction && instructionPath !== null) {
    const status = await _appendInstructionBlock(instructionPath);
    if (status === 'skipped') {
      console.log(`Instruction block already present in ${instructionPath}, skipping.`);
    } else {
      console.log(`Written: ${instructionPath}`);
    }
  }

  if (client === 'codex' && !applyMcp) {
    console.log('No Codex configuration or index changes were made. Rerun with --client codex --yes to apply setup.');
    return;
  }

  if (client === 'codex' && applyMcp) {
    console.log(`\nPreparing local index for ${rootPath}...`);
    let preparation: InitIndexResult;
    try {
      preparation = options.prepareIndex
        ? await options.prepareIndex(rootPath)
        : { status: 'error' as const, error: 'index preparation is unavailable in this CLI invocation' };
    } catch (error) {
      preparation = { status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
    if (preparation.status === 'error') {
      console.error(`Index preparation failed: ${preparation.error}`);
      console.error(`Next action: change directory to "${rootPath}" and run npx codebase-context reindex`);
      process.exitCode = 1;
      return;
    }
    console.log(`Index ready for ${rootPath}${preparation.summary ? ` — ${preparation.summary}` : ''}`);
  }

  console.log(
    client === 'codex'
      ? '\nNext steps:\n' +
          `  Trust this project in Codex if prompted: ${rootPath}\n` +
          '  Restart or reopen Codex Desktop so it reloads the project config\n' +
          '  Start a new Codex Desktop task in this trusted project and ask: “Find one distinctive symbol in this project and explain its file and line.”\n' +
          '  Configuration written and index ready do not prove Codex has loaded or queried the server\n' +
          '  Optional advanced HTTP server (client support varies): npx codebase-context --http\n'
      : '\nNext steps:\n' +
          '  Run `npx codebase-context map` to see your codebase conventions\n' +
          '  Your AI client will start codebase-context when it needs it\n' +
          '  Optional advanced HTTP server (client support varies): npx codebase-context --http\n'
  );
}
