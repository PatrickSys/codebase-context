/**
 * Detect installed MCP clients and build the stdio config for the current project.
 * Project files stay inside the repo. Claude Desktop and Windsurf only have a user file.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const STDIO_CLIENT_LABELS = [
  'Claude Code',
  'Claude Desktop',
  'Cursor',
  'VS Code',
  'Windsurf',
  'Codex CLI',
  'Codex Desktop'
] as const;

export type StdioClientId =
  | 'claude-code'
  | 'claude-desktop'
  | 'cursor'
  | 'vscode'
  | 'windsurf'
  | 'codex-cli'
  | 'codex-desktop';

const STDIO_TARGETS = [
  'claude-code',
  'claude-desktop',
  'cursor',
  'vscode',
  'windsurf',
  'codex',
  'codex-cli',
  'codex-desktop'
] as const;

export type StdioTarget = (typeof STDIO_TARGETS)[number];

export type InstallProbe = {
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  projectRoot: string;
  commandExists: (command: string) => Promise<boolean>;
  pathExists: (target: string) => Promise<boolean>;
};

export type DetectedClient = {
  id: StdioClientId;
  label: string;
  configPath: string;
};

export type StdioLaunch = {
  nodeExecutable: string;
  serverEntrypoint: string;
  projectRoot: string;
};

export type StdioWritePlan = {
  clients: DetectedClient[];
  configPath: string;
  content: string;
  format: 'json' | 'toml';
  serverKey: 'mcpServers' | 'servers' | null;
};

type ClientSpec = {
  id: StdioClientId;
  label: string;
  commands: readonly string[];
  installPaths: (probe: InstallProbe) => string[];
  configPath: (probe: InstallProbe) => string;
  format: 'json' | 'toml';
  serverKey: 'mcpServers' | 'servers' | null;
};

function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key];
  if (!value || !value.trim()) return null;
  return value.trim();
}

function joinHome(probe: InstallProbe, ...parts: string[]): string {
  return pathFor(probe.platform).join(probe.homeDir, ...parts);
}

function appDataDir(probe: InstallProbe): string {
  return (
    envValue(probe.env, 'APPDATA') ??
    pathFor(probe.platform).join(probe.homeDir, 'AppData', 'Roaming')
  );
}

function localAppDataDir(probe: InstallProbe): string {
  return (
    envValue(probe.env, 'LOCALAPPDATA') ??
    pathFor(probe.platform).join(probe.homeDir, 'AppData', 'Local')
  );
}

function xdgConfigDir(probe: InstallProbe): string {
  return envValue(probe.env, 'XDG_CONFIG_HOME') ?? joinHome(probe, '.config');
}

function programFilesDir(probe: InstallProbe): string {
  return envValue(probe.env, 'ProgramFiles') ?? 'C:\\Program Files';
}

function claudeDesktopConfigPath(probe: InstallProbe): string {
  if (probe.platform === 'darwin') {
    return joinHome(
      probe,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    );
  }
  if (probe.platform === 'win32') {
    return pathFor(probe.platform).join(appDataDir(probe), 'Claude', 'claude_desktop_config.json');
  }
  return pathFor(probe.platform).join(xdgConfigDir(probe), 'Claude', 'claude_desktop_config.json');
}

function claudeDesktopInstallPaths(probe: InstallProbe): string[] {
  if (probe.platform === 'darwin') {
    return [
      '/Applications/Claude.app',
      joinHome(probe, 'Applications', 'Claude.app'),
      joinHome(probe, 'Library', 'Application Support', 'Claude')
    ];
  }
  if (probe.platform === 'win32') {
    const programs = programFilesDir(probe);
    return [
      pathFor(probe.platform).join(localAppDataDir(probe), 'AnthropicClaude'),
      pathFor(probe.platform).join(localAppDataDir(probe), 'Claude'),
      pathFor(probe.platform).join(appDataDir(probe), 'Claude'),
      pathFor(probe.platform).join(programs, 'Claude')
    ];
  }
  return [
    pathFor(probe.platform).join(xdgConfigDir(probe), 'Claude'),
    joinHome(probe, '.local', 'share', 'Claude')
  ];
}

function cursorInstallPaths(probe: InstallProbe): string[] {
  const homeConfig = joinHome(probe, '.cursor');
  if (probe.platform === 'darwin') {
    return ['/Applications/Cursor.app', joinHome(probe, 'Applications', 'Cursor.app'), homeConfig];
  }
  if (probe.platform === 'win32') {
    const local = localAppDataDir(probe);
    return [
      pathFor(probe.platform).join(local, 'Programs', 'cursor'),
      pathFor(probe.platform).join(local, 'Programs', 'Cursor'),
      pathFor(probe.platform).join(local, 'cursor'),
      homeConfig
    ];
  }
  return [homeConfig];
}

function vscodeInstallPaths(probe: InstallProbe): string[] {
  if (probe.platform === 'darwin') {
    return [
      '/Applications/Visual Studio Code.app',
      joinHome(probe, 'Library', 'Application Support', 'Code')
    ];
  }
  if (probe.platform === 'win32') {
    return [
      pathFor(probe.platform).join(localAppDataDir(probe), 'Programs', 'Microsoft VS Code'),
      pathFor(probe.platform).join(appDataDir(probe), 'Code')
    ];
  }
  return [pathFor(probe.platform).join(xdgConfigDir(probe), 'Code')];
}

function windsurfInstallPaths(probe: InstallProbe): string[] {
  const configDir = joinHome(probe, '.codeium', 'windsurf');
  if (probe.platform === 'darwin') {
    return [
      '/Applications/Windsurf.app',
      joinHome(probe, 'Applications', 'Windsurf.app'),
      configDir
    ];
  }
  if (probe.platform === 'win32') {
    return [
      pathFor(probe.platform).join(localAppDataDir(probe), 'Programs', 'Windsurf'),
      configDir
    ];
  }
  return [configDir];
}

function codexConfigHome(probe: InstallProbe): string {
  return envValue(probe.env, 'CODEX_HOME') ?? joinHome(probe, '.codex');
}

function codexDesktopInstallPaths(probe: InstallProbe): string[] {
  if (probe.platform === 'darwin') {
    return ['/Applications/Codex.app', joinHome(probe, 'Applications', 'Codex.app')];
  }
  if (probe.platform === 'win32') {
    const programs = programFilesDir(probe);
    const local = localAppDataDir(probe);
    return [
      pathFor(probe.platform).join(local, 'OpenAI', 'Codex'),
      pathFor(probe.platform).join(local, 'Programs', 'Codex'),
      pathFor(probe.platform).join(programs, 'Codex'),
      pathFor(probe.platform).join(programs, 'OpenAI', 'Codex')
    ];
  }
  return [];
}

function projectFile(probe: InstallProbe, ...parts: string[]): string {
  return pathFor(probe.platform).join(probe.projectRoot, ...parts);
}

const CLIENT_SPECS: readonly ClientSpec[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    commands: ['claude'],
    installPaths: (probe) => [joinHome(probe, '.claude'), joinHome(probe, '.claude.json')],
    configPath: (probe) => projectFile(probe, '.mcp.json'),
    format: 'json',
    serverKey: 'mcpServers'
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    commands: [],
    installPaths: claudeDesktopInstallPaths,
    configPath: claudeDesktopConfigPath,
    format: 'json',
    serverKey: 'mcpServers'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    commands: ['cursor', 'cursor-agent'],
    installPaths: cursorInstallPaths,
    configPath: (probe) => projectFile(probe, '.cursor', 'mcp.json'),
    format: 'json',
    serverKey: 'mcpServers'
  },
  {
    id: 'vscode',
    label: 'VS Code',
    commands: ['code'],
    installPaths: vscodeInstallPaths,
    configPath: (probe) => projectFile(probe, '.vscode', 'mcp.json'),
    format: 'json',
    serverKey: 'servers'
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    commands: ['windsurf'],
    installPaths: windsurfInstallPaths,
    configPath: (probe) => joinHome(probe, '.codeium', 'windsurf', 'mcp_config.json'),
    format: 'json',
    serverKey: 'mcpServers'
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    commands: ['codex'],
    installPaths: (probe) => [codexConfigHome(probe)],
    configPath: (probe) => projectFile(probe, '.codex', 'config.toml'),
    format: 'toml',
    serverKey: null
  },
  {
    id: 'codex-desktop',
    label: 'Codex Desktop',
    commands: [],
    installPaths: codexDesktopInstallPaths,
    configPath: (probe) => projectFile(probe, '.codex', 'config.toml'),
    format: 'toml',
    serverKey: null
  }
];

function specById(id: StdioClientId): ClientSpec {
  const spec = CLIENT_SPECS.find((candidate) => candidate.id === id);
  if (!spec) {
    throw new Error(`Unknown stdio client "${id}".`);
  }
  return spec;
}

export function parseStdioTarget(value: string): StdioTarget {
  if ((STDIO_TARGETS as readonly string[]).includes(value)) {
    return value as StdioTarget;
  }
  throw new Error(
    `Unknown client "${value}". Choose claude-code, claude-desktop, cursor, vscode, windsurf, codex, codex-cli, or codex-desktop. OpenCode is available with --http.`
  );
}

export function commandOnPath(command: string): Promise<boolean> {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  return new Promise((resolve) => {
    execFile(finder, [command], { timeout: 5000, windowsHide: true }, (error) => {
      resolve(error === null);
    });
  });
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export function defaultInstallProbe(projectRoot: string): InstallProbe {
  return {
    homeDir: os.homedir(),
    platform: process.platform,
    env: process.env,
    projectRoot,
    commandExists: commandOnPath,
    pathExists
  };
}

export async function detectInstalledClients(probe: InstallProbe): Promise<DetectedClient[]> {
  const detected: DetectedClient[] = [];
  for (const spec of CLIENT_SPECS) {
    const checks = [
      ...spec.commands.map((command) => probe.commandExists(command)),
      ...spec.installPaths(probe).map((target) => probe.pathExists(target))
    ];
    const present = await Promise.all(checks);
    if (!present.some(Boolean)) continue;
    detected.push({
      id: spec.id,
      label: spec.label,
      configPath: spec.configPath(probe)
    });
  }
  return detected;
}

export function clientForTarget(target: StdioTarget, probe: InstallProbe): DetectedClient {
  const id: StdioClientId = target === 'codex' ? 'codex-cli' : target;
  const spec = specById(id);
  return {
    id,
    label: target === 'codex' ? 'Codex' : spec.label,
    configPath: spec.configPath(probe)
  };
}

function renderMcpServersConfig(launch: StdioLaunch): string {
  return JSON.stringify(
    {
      mcpServers: {
        'codebase-context': {
          command: launch.nodeExecutable,
          args: [launch.serverEntrypoint, launch.projectRoot]
        }
      }
    },
    null,
    2
  );
}

function renderVsCodeConfig(launch: StdioLaunch): string {
  return JSON.stringify(
    {
      servers: {
        'codebase-context': {
          type: 'stdio',
          command: launch.nodeExecutable,
          args: [launch.serverEntrypoint, launch.projectRoot]
        }
      }
    },
    null,
    2
  );
}

export function renderCodexServerToml(nodeExecutable: string, args: readonly string[]): string {
  const quotedArgs = args.map((value) => JSON.stringify(value)).join(', ');
  return (
    `[mcp_servers.codebase-context]\n` +
    `command = ${JSON.stringify(nodeExecutable)}\n` +
    `args = [${quotedArgs}]\n` +
    'startup_timeout_sec = 120\n'
  );
}

function renderSpecContent(spec: ClientSpec, launch: StdioLaunch): string {
  if (spec.format === 'toml') {
    return renderCodexServerToml(launch.nodeExecutable, [
      launch.serverEntrypoint,
      launch.projectRoot
    ]);
  }
  if (spec.serverKey === 'servers') return renderVsCodeConfig(launch);
  return renderMcpServersConfig(launch);
}

export function buildWritePlans(clients: DetectedClient[], launch: StdioLaunch): StdioWritePlan[] {
  const plans = new Map<string, StdioWritePlan>();
  for (const client of clients) {
    const spec = specById(client.id);
    const existing = plans.get(client.configPath);
    if (existing) {
      existing.clients.push(client);
      continue;
    }
    plans.set(client.configPath, {
      clients: [client],
      configPath: client.configPath,
      content: renderSpecContent(spec, launch),
      format: spec.format,
      serverKey: spec.serverKey
    });
  }
  return [...plans.values()];
}

export function configBackupPath(filePath: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${filePath}.${stamp}.bak`;
}
