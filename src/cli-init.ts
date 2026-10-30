/**
 * Interactive setup wizard for codebase-context.
 * Detects MCP clients, lets the user choose tools, and merges project MCP config files.
 * Use `--dry-run` to print previews without writing anything.
 */

import path from 'path';
import { parse as parseToml } from 'smol-toml';
import { isDeepStrictEqual } from 'node:util';
import { promises as fs } from 'node:fs';
import { atomicWrite } from './utils/atomic-write.js';
import * as clack from '@clack/prompts';
import { homedir } from 'node:os';
import { constants } from 'node:fs';
import { formatConfigPreview } from './cli-init-preview.js';
import { PKG_VERSION, resolveMcpPackageSpec } from './cli-init-package.js';
import {
  CLIENTS,
  DETECT_CLIENTS,
  INIT_CLIENTS,
  type Client,
  type InitClient,
  isInitClient
} from './cli-init-types.js';

export type { Client, InitClient } from './cli-init-types.js';
export { CLIENTS, DETECT_CLIENTS, INIT_CLIENTS, PKG_VERSION, resolveMcpPackageSpec };

export const INIT_NPX_PACKAGE = resolveMcpPackageSpec(false);

export type McpConfigResult = { kind: 'file'; path: string; content: string };

export type McpConfigOptions = {
  rootPath?: string;
  /** Override home for user-scoped configs (tests). Defaults to os.homedir(). */
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  /** When true, write codebase-context@latest instead of pinning the running package version. */
  trackLatest?: boolean;
  /** Node binary written into the client config. Defaults to the current process. */
  nodeExecutable?: string;
  /**
   * Package entrypoint written into the client config.
   * When init runs through npx this is the file inside the npx cache.
   */
  serverEntrypoint?: string;
};

type JsonObject = Record<string, unknown>;

function resolveHome(
  env: NodeJS.ProcessEnv = process.env,
  _platform: NodeJS.Platform = process.platform
): string {
  return env.HOME || env.USERPROFILE || homedir();
}

function jsonMcpServerKey(
  client: Extract<
    Client,
    'claude-code' | 'claude-desktop' | 'cursor' | 'opencode' | 'vscode' | 'windsurf'
  >
): string {
  if (client === 'opencode') return 'mcp';
  if (client === 'vscode') return 'servers';
  return 'mcpServers';
}

export function resolveClientConfigPath(
  client: Client,
  rootPath: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const home = resolveHome(env, platform);
  if (client === 'codex') return path.join(rootPath, '.codex', 'config.toml');
  if (client === 'windsurf') return path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
  if (client === 'claude-desktop') {
    if (platform === 'darwin') {
      return paths.join(
        home,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json'
      );
    }
    if (platform === 'win32') {
      const appData = env.APPDATA || paths.join(home, 'AppData', 'Roaming');
      return paths.join(appData, 'Claude', 'claude_desktop_config.json');
    }
    const configHome = env.XDG_CONFIG_HOME || paths.join(home, '.config');
    return paths.join(configHome, 'Claude', 'claude_desktop_config.json');
  }
  if (client === 'claude-code') return path.join(rootPath, '.mcp.json');
  if (client === 'cursor') return path.join(rootPath, '.cursor', 'mcp.json');
  if (client === 'vscode') return path.join(rootPath, '.vscode', 'mcp.json');
  return path.join(rootPath, 'opencode.json');
}

export async function detectClients(
  rootPath: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<Client[]> {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const home = resolveHome(env, platform);
  const configHome = env.XDG_CONFIG_HOME || paths.join(home, '.config');
  const searchPath = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':');
  const extensions = platform === 'win32' ? ['', '.exe', '.cmd', '.bat', '.ps1'] : [''];
  const detected: Client[] = [];
  for (const client of DETECT_CLIENTS) {
    if (client.id === 'claude-desktop') {
      const configPath = resolveClientConfigPath('claude-desktop', rootPath, env, platform);
      const desktopDir = path.dirname(configPath);
      for (const candidate of [
        { path: configPath, directory: false },
        { path: desktopDir, directory: true }
      ]) {
        try {
          await fs.access(candidate.path, candidate.directory ? constants.F_OK : constants.F_OK);
          const info = await fs.stat(candidate.path);
          if (candidate.directory ? !info.isDirectory() : !info.isFile()) continue;
          detected.push(client.id);
          break;
        } catch (error) {
          if (!isFileNotFound(error)) throw error;
        }
      }
      continue;
    }
    const userDirectory =
      client.id === 'codex'
        ? env.CODEX_HOME || paths.join(home, '.codex')
        : client.id === 'claude-code'
          ? env.CLAUDE_CONFIG_DIR || paths.join(home, '.claude')
          : client.id === 'opencode'
            ? paths.join(configHome, 'opencode')
            : client.id === 'windsurf'
              ? paths.join(home, '.codeium', 'windsurf')
              : paths.join(home, client.directory.split('/').at(-1) ?? client.directory);
    const projectDirectory =
      client.id === 'windsurf'
        ? paths.join(home, '.codeium', 'windsurf')
        : paths.join(rootPath, client.directory);
    const directories =
      client.scope === 'user' ? [userDirectory] : [projectDirectory, userDirectory];
    const executables = client.executable
      ? searchPath
          .filter(Boolean)
          .flatMap((directory) =>
            extensions.map((extension) => paths.join(directory, client.executable + extension))
          )
      : [];
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

function resolveNpxCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

function usesDirectLaunch(options: McpConfigOptions): boolean {
  return options.serverEntrypoint !== undefined || options.nodeExecutable !== undefined;
}

function buildLaunchArgs(
  rootPath: string,
  options: McpConfigOptions
): {
  command: string;
  args: string[];
  opencodeCommand?: string[];
} {
  const platform = options.platform ?? process.platform;
  if (usesDirectLaunch(options)) {
    const nodeExecutable = path.resolve(options.nodeExecutable ?? process.execPath);
    const serverEntrypoint = resolveServerEntrypoint(options.serverEntrypoint);
    const args = [serverEntrypoint, rootPath];
    return {
      command: nodeExecutable,
      args,
      opencodeCommand: [nodeExecutable, ...args]
    };
  }
  const npxCommand = resolveNpxCommand(platform);
  const packageSpec = resolveMcpPackageSpec(options.trackLatest ?? false);
  const args = ['-y', packageSpec, rootPath];
  return {
    command: npxCommand,
    args,
    opencodeCommand: [npxCommand, ...args]
  };
}

/**
 * Launch command for JSON-backed clients (Cursor, OpenCode). Pins codebase-context@<version>
 * unless trackLatest is set. Pass nodeExecutable/serverEntrypoint only in tests.
 */
export function generateMcpConfig(client: Client, options: McpConfigOptions = {}): McpConfigResult {
  const rootPath = path.resolve(options.rootPath ?? process.cwd());
  const homeDirectory = options.homeDirectory ?? resolveHome();
  const platform = options.platform ?? process.platform;
  const launch = buildLaunchArgs(rootPath, options);
  if (client === 'codex') {
    const npx = usesDirectLaunch(options)
      ? { command: launch.command, args: launch.args }
      : { command: 'npx', args: launch.args };
    return {
      kind: 'file',
      path: resolveClientConfigPath('codex', rootPath, { HOME: homeDirectory }, platform),
      content:
        `[mcp_servers.codebase-context]\ncommand = ${JSON.stringify(npx.command)}\n` +
        `args = [${npx.args.map((value) => JSON.stringify(value)).join(', ')}]\nstartup_timeout_sec = 120\n`
    };
  }
  const configPath = resolveClientConfigPath(client, rootPath, { HOME: homeDirectory }, platform);
  const serverPayload =
    client === 'opencode'
      ? { type: 'local', command: launch.opencodeCommand ?? [launch.command, ...launch.args] }
      : client === 'cursor'
        ? { type: 'stdio', command: launch.command, args: launch.args }
        : { command: launch.command, args: launch.args };
  const body =
    client === 'opencode'
      ? {
          $schema: 'https://opencode.ai/config.json',
          [jsonMcpServerKey('opencode')]: { 'codebase-context': serverPayload }
        }
      : client === 'vscode'
        ? { [jsonMcpServerKey('vscode')]: { 'codebase-context': serverPayload } }
        : client === 'windsurf'
          ? { [jsonMcpServerKey('windsurf')]: { 'codebase-context': serverPayload } }
          : {
              mcpServers: {
                'codebase-context': serverPayload
              }
            };
  return {
    kind: 'file',
    path: configPath,
    content: JSON.stringify(body, null, 2)
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

function isNpxPackageArg(value: string): boolean {
  return (
    value === 'codebase-context' ||
    /^codebase-context@(latest|\d+\.\d+\.\d+(?:-[\w.-]+)?)$/.test(value)
  );
}

function isNpxLaunchArgs(args: string[]): boolean {
  const flag = args[0];
  if (flag !== '-y' && flag !== '--yes') return false;
  if (!isNpxPackageArg(args[1] ?? '')) return false;
  return args.length === 3 && isAbsolutePath(args[2] ?? '');
}

function isNpxCommandName(command: string): boolean {
  const normalized = command.replace(/\\/g, '/');
  const base = path.basename(normalized).toLowerCase();
  return (base === 'npx' || base === 'npx.cmd') && !normalized.includes('/');
}

function isOpencodeNpxCommand(command: string[]): boolean {
  if (!isNpxCommandName(command[0] ?? '')) return false;
  if (command[1] !== '-y' && command[1] !== '--yes') return false;
  if (!isNpxPackageArg(command[2] ?? '')) return false;
  return command.length === 4 && isAbsolutePath(command[3] ?? '');
}

/**
 * Recognize only CBC-specific launch shapes written by init.
 * Accepts npx @latest launches and legacy node launches pointing at this package.
 */
function isGeneratedLaunch(command: unknown, args: unknown, entrypoint?: string): boolean {
  if (
    typeof command === 'string' &&
    Array.isArray(args) &&
    args.every((arg) => typeof arg === 'string')
  ) {
    if (isNpxCommandName(command)) {
      return isNpxLaunchArgs(args);
    }
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
    return false;
  }
  if (Array.isArray(command) && command.every((part) => typeof part === 'string')) {
    if (isOpencodeNpxCommand(command)) return true;
    const executable = path.basename(command[0]?.replace(/\\/g, '/') ?? '').toLowerCase();
    if (executable === 'node' || executable === 'node.exe') {
      const script = command[1] ?? '';
      return (
        command.length === 3 &&
        isAbsolutePath(script) &&
        isAbsolutePath(command[2] ?? '') &&
        (isNpxCacheEntrypoint(script) || (entrypoint !== undefined && samePath(script, entrypoint)))
      );
    }
  }
  return false;
}

function generatedEntrypoint(generated: unknown, client: Client): string | undefined {
  if (!isJsonObject(generated)) return undefined;
  if (client === 'opencode' && Array.isArray(generated.command)) {
    if (isOpencodeNpxCommand(generated.command)) return undefined;
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
  const stdio = client === 'cursor';
  const command = local && Array.isArray(existing.command) ? existing.command[0] : existing.command;
  const args = local && Array.isArray(existing.command) ? existing.command.slice(1) : existing.args;
  if (local && existing.type !== undefined && existing.type !== 'local') return null;
  if (stdio && existing.type !== undefined && existing.type !== 'stdio') return null;
  if (!isGeneratedLaunch(command, args, generatedEntrypoint(generated, client))) return null;
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
  client: Extract<
    Client,
    'claude-code' | 'claude-desktop' | 'cursor' | 'opencode' | 'vscode' | 'windsurf'
  >
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

  const serverKey = jsonMcpServerKey(client);
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
  clients: InitClient[];
  rootPath: string;
  yes: boolean;
  help: boolean;
  dryRun: boolean;
  trackLatest: boolean;
};

function parseInitClient(value: string): InitClient {
  if (!isInitClient(value as Client)) {
    throw new Error(
      `Unknown or unsupported client "${value}". Choose ${INIT_CLIENTS.map((client) => client.id).join(', ')}.`
    );
  }
  return value as InitClient;
}

function formatDisplayPath(configPath: string, rootPath: string): string {
  const relative = path.relative(rootPath, configPath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return configPath;
}

function classifyInitChange(
  existingText: string | null,
  mergedContent: string
): 'create' | 'update' | 'unchanged' {
  if (existingText === null) return 'create';
  if (existingText === mergedContent) return 'unchanged';
  return 'update';
}

function describeInitChange(
  dryRun: boolean,
  action: 'create' | 'update' | 'unchanged',
  displayPath: string
): string {
  if (action === 'unchanged') return `Unchanged: ${displayPath}`;
  const prefix = dryRun
    ? action === 'create'
      ? 'Would create'
      : 'Would update'
    : action === 'create'
      ? 'Created'
      : 'Updated';
  return `${prefix}: ${displayPath}`;
}

function appendInitClients(clients: InitClient[], raw: string): void {
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed) clients.push(parseInitClient(trimmed));
  }
}

async function mergeInitClient(
  client: InitClient,
  options: Pick<InitOptions, 'rootPath' | 'trackLatest'>
): Promise<{
  config: McpConfigResult;
  merged: { content: string };
  existingText: string | null;
  action: 'create' | 'update' | 'unchanged';
}> {
  const config = generateMcpConfig(client, {
    rootPath: options.rootPath,
    trackLatest: options.trackLatest
  });
  const merged =
    client === 'codex'
      ? await _buildMergedCodexContent(config.path, config.content)
      : await _buildMergedMcpContent(config.path, config.content, client);
  const existingText = await readExistingConfig(config.path);
  const action = classifyInitChange(existingText, merged.content);
  return { config, merged, existingText, action };
}

function parseInitOptions(args: string[]): InitOptions {
  if (args.includes('--help') || args.includes('-h'))
    return {
      clients: [],
      rootPath: process.cwd(),
      yes: false,
      help: true,
      dryRun: false,
      trackLatest: false
    };
  const clients: InitClient[] = [];
  let yes = false;
  let dryRun = false;
  let trackLatest = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--track-latest') trackLatest = true;
    else if (arg === '--client' || arg === '--clients') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Expected a client after ${arg}.`);
      appendInitClients(clients, value);
    } else if (arg?.startsWith('--client=') || arg?.startsWith('--clients=')) {
      appendInitClients(clients, arg.split('=').slice(1).join('='));
    } else if (arg === '--root') index++;
    else if (!arg?.startsWith('--root=')) throw new Error(`Unknown init option "${arg}".`);
  }
  return {
    clients: [...new Set(clients)],
    rootPath: resolveInitRoot(args, process.env.CODEBASE_ROOT),
    yes,
    help: false,
    dryRun,
    trackLatest
  };
}

function printInitUsage(): void {
  console.log('codebase-context init [options]');
  console.log('Detect tools, choose clients, merge MCP config files under the project root.');
  console.log(
    `Default launch in configs: npx -y codebase-context@${PKG_VERSION} <project> (--track-latest for @latest).`
  );
  console.log(
    '  --clients <name>  Repeatable client id (alias: --client): ' +
      INIT_CLIENTS.map((client) => client.id).join(', ')
  );
  console.log('  --yes, -y          Non-interactive (for CI scripts)');
  console.log('  --dry-run          Print previews without writing any files');
  console.log('  --track-latest     Write codebase-context@latest instead of pinning');
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

    clack.intro(`Codebase Context setup in ${options.rootPath}`);
    let clients: InitClient[] = options.clients;
    if (!clients.length) {
      const detected = (await detectClients(options.rootPath)).filter(isInitClient);
      if (!options.yes && process.stdin.isTTY && process.stdout.isTTY) {
        const selected = await clack.multiselect({
          message: 'Choose tools to configure',
          options: INIT_CLIENTS.map((client) => ({
            label: client.name + (detected.includes(client.id) ? ' (detected)' : ''),
            value: client.id
          })),
          initialValues: detected
        });
        if (clack.isCancel(selected)) {
          clack.cancel('Setup cancelled.');
          return;
        }
        clients = selected;
      } else {
        clients = detected;
      }
    }
    if (!clients.length) {
      throw new Error(
        `No tools selected or detected. Pass --clients (${INIT_CLIENTS.map((client) => client.id).join(', ')}).`
      );
    }

    const prepared = await Promise.all(clients.map((client) => mergeInitClient(client, options)));

    for (const item of prepared) {
      if (item.action === 'unchanged') continue;
      console.log(
        formatConfigPreview(
          formatDisplayPath(item.config.path, options.rootPath),
          item.existingText,
          item.merged.content
        )
      );
      console.log('');
    }

    if (
      prepared.some((item) => item.action !== 'unchanged') &&
      !options.yes &&
      !options.dryRun &&
      process.stdin.isTTY &&
      process.stdout.isTTY
    ) {
      const approved = await clack.confirm({ message: 'Apply these changes?', initialValue: true });
      if (clack.isCancel(approved) || !approved) {
        clack.cancel('Setup cancelled.');
        return;
      }
    }

    for (const item of prepared) {
      const displayPath = formatDisplayPath(item.config.path, options.rootPath);
      if (item.action !== 'unchanged' && !options.dryRun) {
        await fs.mkdir(path.dirname(item.config.path), { recursive: true });
        await atomicWrite(item.config.path, item.merged.content);
      }
      console.log(describeInitChange(options.dryRun, item.action, displayPath));
    }

    if (options.dryRun) {
      console.log('Dry run complete; no files written.');
      clack.outro('Dry run finished.');
      return;
    }

    clack.outro('Setup complete. Reopen your tools and approve trust if prompted.');
  } catch (error) {
    if (clack.isCancel(error)) {
      clack.cancel('Setup cancelled.');
      return;
    }
    console.error(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
