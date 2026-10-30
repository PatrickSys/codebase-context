import { cliProjectOptions } from './cli-project-options.js';
import { CodebaseIndexer } from './core/indexer.js';
import { loadProjectConfig } from './server/config.js';
/**
 * Interactive setup wizard for codebase-context.
 * Handles `codebase-context init` — detects clients and merges project MCP configs
 * for the four first-wave AI clients: Claude Code, Cursor, Codex, OpenCode.
 *
 * Config writes run only after all selected registrations pass preflight.
 * File previews share the indexer's selection rules and project configuration.
 */

import path from 'path';
import { parse as parseToml } from 'smol-toml';
import { isDeepStrictEqual } from 'node:util';
import { promises as fs } from 'node:fs';
import { atomicWrite } from './utils/atomic-write.js';
import { checkbox } from '@inquirer/prompts';
import { homedir } from 'node:os';
import { constants } from 'node:fs';

export type Client = (typeof CLIENTS)[number]['id'];

export type McpConfigResult = { kind: 'file'; path: string; content: string };

export type McpConfigOptions = {
  rootPath?: string;
  /** Node binary written into the client config. Defaults to the current process. */
  nodeExecutable?: string;
  /**
   * Package entrypoint written into the client config.
   * When init runs through npx this is the file inside the npx cache.
   */
  serverEntrypoint?: string;
};

type JsonObject = Record<string, unknown>;

export const CLIENTS = [
  { id: 'claude-code', name: 'Claude Code', executable: 'claude', directory: '.claude' },
  { id: 'codex', name: 'Codex', executable: 'codex', directory: '.codex' },
  { id: 'cursor', name: 'Cursor', executable: 'cursor', directory: '.cursor' },
  { id: 'opencode', name: 'OpenCode', executable: 'opencode', directory: '.opencode' }
] as const;

export async function detectClients(
  rootPath: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<Client[]> {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const home = env.HOME || env.USERPROFILE || homedir();
  const configHome = env.XDG_CONFIG_HOME || paths.join(home, '.config');
  const searchPath = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':');
  const extensions = platform === 'win32' ? ['', '.exe', '.cmd', '.bat', '.ps1'] : [''];
  const detected: Client[] = [];
  for (const client of CLIENTS) {
    const userDirectory =
      client.id === 'codex'
        ? env.CODEX_HOME || paths.join(home, '.codex')
        : client.id === 'claude-code'
          ? env.CLAUDE_CONFIG_DIR || paths.join(home, '.claude')
          : client.id === 'opencode'
            ? paths.join(configHome, 'opencode')
            : paths.join(home, client.directory);
    const directories = [paths.join(rootPath, client.directory), userDirectory];
    const executables = searchPath
      .filter(Boolean)
      .flatMap((directory) =>
        extensions.map((extension) => paths.join(directory, client.executable + extension))
      );
    const candidates = [
      ...directories.map((candidate) => ({ path: candidate, directory: true })),
      ...executables.map((candidate) => ({ path: candidate, directory: false }))
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(
          candidate.path,
          candidate.directory || platform === 'win32' ? constants.F_OK : constants.X_OK
        );
        const info = await fs.stat(candidate.path);
        if (candidate.directory ? !info.isDirectory() : !info.isFile()) continue;
        detected.push(client.id);
        break;
      } catch (error) {
        if (
          !isFileNotFound(error) &&
          !(
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error.code === 'EACCES' || error.code === 'ENOTDIR')
          )
        )
          throw error;
      }
    }
  }
  return detected;
}

function resolveServerEntrypoint(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error('Cannot locate the codebase-context CLI entrypoint.');
  }
  return path.resolve(entrypoint);
}

/**
 * Launch command saved for every client: the Node binary that ran init, the
 * package entrypoint (the npx cache path when init itself was started with npx),
 * and the project folder. Clients then start that file directly.
 */
export function generateMcpConfig(client: Client, options: McpConfigOptions = {}): McpConfigResult {
  const rootPath = path.resolve(options.rootPath ?? process.cwd());
  const nodeExecutable = path.resolve(options.nodeExecutable ?? process.execPath);
  const serverEntrypoint = resolveServerEntrypoint(options.serverEntrypoint);
  const args = [serverEntrypoint, rootPath];
  if (client === 'codex') {
    return {
      kind: 'file',
      path: path.join(rootPath, '.codex', 'config.toml'),
      content:
        `[mcp_servers.codebase-context]\ncommand = ${JSON.stringify(nodeExecutable)}\n` +
        `args = [${args.map((value) => JSON.stringify(value)).join(', ')}]\nstartup_timeout_sec = 120\n`
    };
  }
  const configPath =
    client === 'claude-code'
      ? '.mcp.json'
      : client === 'cursor'
        ? '.cursor/mcp.json'
        : 'opencode.json';
  return {
    kind: 'file',
    path: path.join(rootPath, configPath),
    content: JSON.stringify(
      client === 'opencode'
        ? {
            $schema: 'https://opencode.ai/config.json',
            mcp: {
              'codebase-context': { type: 'local', command: [nodeExecutable, ...args] }
            }
          }
        : {
            mcpServers: {
              'codebase-context': {
                ...(client === 'cursor' ? { type: 'stdio' } : {}),
                command: nodeExecutable,
                args
              }
            }
          },
      null,
      2
    )
  };
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

function isAbsolutePath(value: string): boolean {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return normalize(left) === normalize(right);
}

function isNpxCacheEntrypoint(value: string): boolean {
  return /[\\/]node_modules[\\/]codebase-context[\\/]dist[\\/]index\.js$/.test(value);
}

/**
 * Recognize only CBC-specific launch shapes written by init.
 * A node launch counts when it points at the npx cache copy of this package,
 * or at the entrypoint this run is about to save.
 */
function isGeneratedLaunch(command: unknown, args: unknown, entrypoint?: string): boolean {
  if (
    typeof command !== 'string' ||
    !Array.isArray(args) ||
    !args.every((arg) => typeof arg === 'string')
  )
    return false;
  const executable = path.basename(command.replace(/\\/g, '/')).toLowerCase();
  if (executable === 'node' || executable === 'node.exe') {
    const script = args[0] ?? '';
    return (
      args.length === 2 &&
      isAbsolutePath(script) &&
      isAbsolutePath(args[1] ?? '') &&
      (isNpxCacheEntrypoint(script) || (entrypoint !== undefined && samePath(script, entrypoint)))
    );
  }
  const launch = command === 'npx' || command === 'npx.cmd' ? args : [];
  return (
    launch.length === 3 &&
    (launch[0] === '--yes' || launch[0] === '-y') &&
    /^codebase-context@\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(launch[1] ?? '') &&
    isAbsolutePath(launch[2] ?? '')
  );
}

function generatedEntrypoint(generated: unknown, client: Client): string | undefined {
  if (!isJsonObject(generated)) return undefined;
  if (client === 'opencode' && Array.isArray(generated.command)) {
    return typeof generated.command[1] === 'string' ? generated.command[1] : undefined;
  }
  return Array.isArray(generated.args) && typeof generated.args[0] === 'string'
    ? generated.args[0]
    : undefined;
}

function mergeGeneratedServer(existing: unknown, generated: unknown, client: Client): unknown {
  if (jsonValuesEqual(existing, generated)) return existing;
  if (!isJsonObject(existing) || !isJsonObject(generated) || 'url' in existing) return null;
  const local = client === 'opencode';
  const command = local && Array.isArray(existing.command) ? existing.command[0] : existing.command;
  const args = local && Array.isArray(existing.command) ? existing.command.slice(1) : existing.args;
  if (
    (existing.type !== undefined && existing.type !== (local ? 'local' : 'stdio')) ||
    !isGeneratedLaunch(command, args, generatedEntrypoint(generated, client))
  )
    return null;
  return {
    ...existing,
    command: generated.command,
    ...(!local ? { args: generated.args } : {}),
    ...(generated.type ? { type: generated.type } : {})
  };
}

/**
 * Merge generated MCP config into an existing JSON config file when possible.
 * Preserves unrelated keys and updates only recognized generated launches.
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
  const mergedServer = hasExistingCodebaseContext
    ? mergeGeneratedServer(existingServers['codebase-context'], generatedCodebaseContext, client)
    : generatedCodebaseContext;
  if (mergedServer === null) {
    throw new Error(
      `Cannot merge ${client} config at ${filePath}: it already contains a different codebase-context configuration.`
    );
  }
  const merged = {
    ...generated,
    ...existing,
    [serverKey]: { ...existingServers, 'codebase-context': mergedServer }
  };
  return {
    content: jsonValuesEqual(existing, merged) ? existingText : JSON.stringify(merged, null, 2),
    mergedFromExisting: true
  };
}

function normalizeTomlNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

/** Merge only launch values after parsing; candidate byte edits must preserve every other value. */
export async function _buildMergedCodexContent(
  filePath: string,
  generatedContent: string
): Promise<{ content: string; mergedFromExisting: boolean }> {
  const existing = await readExistingConfig(filePath);
  if (existing === null) return { content: generatedContent, mergedFromExisting: false };
  const parse = (text: string) => parseToml(text, { integersAsBigInt: 'asNeeded' });
  const original = parse(existing);
  const generated = parse(generatedContent);
  const generatedServers = generated.mcp_servers;
  const servers = original.mcp_servers;
  if (!isJsonObject(generatedServers) || !isJsonObject(generatedServers['codebase-context']))
    throw new Error('Generated Codex configuration has no server entry.');
  const desired = generatedServers['codebase-context'];
  const current = isJsonObject(servers) ? servers['codebase-context'] : undefined;
  const conflict = () =>
    new Error(
      `Cannot merge Codex config at ${filePath}: it already contains a different codebase-context configuration.`
    );
  if (current === undefined) {
    const newline = existing.includes('\r\n') ? '\r\n' : '\n';
    const addition = normalizeTomlNewlines(generatedContent).trim().replace(/\n/g, newline);
    const content = `${existing}${existing.endsWith(newline) ? newline : newline + newline}${addition}${newline}`;
    if (servers === undefined) original.mcp_servers = generatedServers;
    else if (isJsonObject(servers)) servers['codebase-context'] = desired;
    else throw conflict();
    if (!isDeepStrictEqual(parse(content), original)) throw conflict();
    return { content, mergedFromExisting: true };
  }
  if (!isJsonObject(current) || !isJsonObject(servers) || 'url' in current) throw conflict();
  if (
    isDeepStrictEqual(current.command, desired.command) &&
    isDeepStrictEqual(current.args, desired.args)
  )
    return { content: existing, mergedFromExisting: true };
  const entrypoint =
    Array.isArray(desired.args) && typeof desired.args[0] === 'string'
      ? desired.args[0]
      : undefined;
  if (!isGeneratedLaunch(current.command, current.args, entrypoint)) throw conflict();
  const expected = parse(existing);
  const expectedServers = expected.mcp_servers;
  if (!isJsonObject(expectedServers) || !isJsonObject(expectedServers['codebase-context']))
    throw conflict();
  expectedServers['codebase-context'].command = desired.command;
  expectedServers['codebase-context'].args = desired.args;
  const key = (name: string) => `(?:${name}|"${name}"|'${name}')`;
  const headers = new RegExp(
    `^[ \t]*\\[[ \t]*${key('mcp_servers')}[ \t]*\\.[ \t]*${key('codebase-context')}[ \t]*\\][ \t]*(?:#.*)?$`,
    'gm'
  );
  const normalized = normalizeTomlNewlines(existing);
  for (const header of normalized.matchAll(headers)) {
    const start = header.index;
    const bodyStart = start + header[0].length;
    const next = /^[ \t]*\[{1,2}[^\r\n]+\]{1,2}[ \t]*(?:#.*)?$/gm;
    next.lastIndex = bodyStart;
    const end = next.exec(normalized)?.index ?? normalized.length;
    const section = normalized.slice(start, end);
    const updated = section
      .replace(
        /^([ \t]*command[ \t]*=[ \t]*)("(?:[^"\\]|\\.)*"|'[^'\r\n]*')([ \t]*(?:#.*)?)$/m,
        (_line, prefix: string, _value: string, comment: string) =>
          prefix + JSON.stringify(desired.command) + comment
      )
      .replace(
        /^([ \t]*args[ \t]*=[ \t]*)(\[[^\r\n]*\])([ \t]*(?:#.*)?)$/m,
        (_line, prefix: string, _value: string, comment: string) =>
          prefix +
          '[' +
          (Array.isArray(desired.args)
            ? desired.args.map((arg) => JSON.stringify(arg)).join(', ')
            : '') +
          ']' +
          comment
      );
    const candidate = normalized.slice(0, start) + updated + normalized.slice(end);
    try {
      if (isDeepStrictEqual(parse(candidate), expected))
        return {
          content: existing.includes('\r\n') ? candidate.replace(/\n/g, '\r\n') : candidate,
          mergedFromExisting: true
        };
    } catch {
      // A textual match inside a string or an unsupported launch shape is never published.
    }
  }
  throw conflict();
}

type InitOptions = {
  clients: Client[];
  rootPath: string;
  yes: boolean;
  help: boolean;
  preview: boolean;
};

function parseClient(value: string): Client {
  const client = CLIENTS.find((client) => client.id === value);
  if (client) return client.id;
  throw new Error(
    `Unknown client "${value}". Choose ${CLIENTS.map((client) => client.id).join(', ')}.`
  );
}

function parseInitOptions(args: string[]): InitOptions {
  if (args.includes('--help') || args.includes('-h'))
    return { clients: [], rootPath: process.cwd(), yes: false, help: true, preview: false };
  const clients: Client[] = [];
  let yes = false;
  let preview = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--preview') preview = true;
    else if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--client') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Expected a client after --client.');
      clients.push(parseClient(value));
    } else if (arg?.startsWith('--client='))
      clients.push(parseClient(arg.slice('--client='.length)));
    else if (arg === '--root') index++;
    else if (!arg?.startsWith('--root=')) throw new Error(`Unknown init option "${arg}".`);
  }
  return {
    clients: [...new Set(clients)],
    rootPath: resolveInitRoot(args, process.env.CODEBASE_ROOT),
    yes,
    help: false,
    preview
  };
}

function printInitUsage(): void {
  console.log('codebase-context init [options]');
  console.log(
    'Detect and configure coding tools together. With a terminal, Space toggles and Enter applies.'
  );
  console.log(
    'Each config saves this Node binary and the package file from the npx cache, plus the project folder.'
  );
  console.log('Codex setup line: codex mcp add codebase-context -- npx -y codebase-context');
  console.log(
    '  --client <name>  Choose a tool (repeatable): ' +
      CLIENTS.map((client) => client.id).join(', ')
  );
  console.log('  --root <path>    Project root (default: CODEBASE_ROOT or cwd)');
  console.log('  --preview        Show selected files and exclusions without writing config');
  console.log('  --yes, -y        Configure every detected tool without prompts');
  console.log('  --help, -h       Show this help');
}

export async function handleInitCli(args: string[]): Promise<void> {
  try {
    const options = parseInitOptions(args);
    if (options.help) {
      printInitUsage();
      return;
    }
    if (!(await fs.stat(options.rootPath)).isDirectory())
      throw new Error(`Project root is not a directory: ${options.rootPath}`);
    if (options.preview) {
      const config = await loadProjectConfig(options.rootPath);
      const preview = await new CodebaseIndexer({
        rootPath: options.rootPath,
        ...cliProjectOptions(config, true)
      }).previewFiles();
      console.log(JSON.stringify(preview, null, 2));
      return;
    }
    console.log(`Set up Codebase Context in ${options.rootPath}`);
    let clients = options.clients;
    if (!clients.length) {
      const detected = await detectClients(options.rootPath);
      clients =
        !options.yes && process.stdin.isTTY && process.stdout.isTTY
          ? await checkbox<Client>({
              message: 'Choose tools (Space toggles, Enter sets up):',
              choices: CLIENTS.map((client) => ({
                name: client.name + (detected.includes(client.id) ? ' (detected)' : ''),
                value: client.id,
                checked: detected.includes(client.id)
              }))
            })
          : detected;
    }
    if (!clients.length)
      throw new Error(
        'No coding tools selected or detected. Choose with --client claude-code, --client codex, --client cursor, or --client opencode.'
      );

    const prepared = [];
    for (const client of clients) {
      const config = generateMcpConfig(client, { rootPath: options.rootPath });
      const merged =
        client === 'codex'
          ? await _buildMergedCodexContent(config.path, config.content)
          : await _buildMergedMcpContent(config.path, config.content, client);
      prepared.push({
        ...config,
        content: merged.content,
        unchanged: (await readExistingConfig(config.path)) === merged.content
      });
    }
    for (const config of prepared) {
      if (!config.unchanged) {
        await fs.mkdir(path.dirname(config.path), { recursive: true });
        await atomicWrite(config.path, config.content);
      }
      console.log(
        `${config.unchanged ? 'Unchanged' : 'Configured'}: ${path.relative(options.rootPath, config.path)}`
      );
    }
    console.log('Reopen your tools; approve the server or project trust if asked.');
    console.log("The first search builds this repository's index.");
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'ExitPromptError' ||
        error.name === 'AbortPromptError' ||
        error.name === 'CancelPromptError')
    ) {
      console.log('Setup cancelled; no files written.');
      return;
    }
    console.error(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
