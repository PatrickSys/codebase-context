import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWritePlans,
  detectInstalledClients,
  type DetectedClient,
  type InstallProbe
} from '../src/init-clients.js';

function probe(overrides: Partial<InstallProbe> & Pick<InstallProbe, 'platform'>): InstallProbe {
  return {
    homeDir: overrides.homeDir ?? '/Users/ada',
    platform: overrides.platform,
    env: overrides.env ?? {},
    projectRoot: overrides.projectRoot ?? '/projects/demo',
    commandExists: overrides.commandExists ?? (async () => false),
    pathExists: overrides.pathExists ?? (async () => false)
  };
}

describe('detectInstalledClients', () => {
  it('detects a macOS app and points Claude Desktop at its user config', async () => {
    const home = '/Users/ada';
    const found = await detectInstalledClients(
      probe({
        platform: 'darwin',
        homeDir: home,
        pathExists: async (target) => target === '/Applications/Claude.app'
      })
    );

    expect(found.map((client) => client.id)).toEqual(['claude-desktop']);
    expect(found[0]?.configPath).toBe(
      path.posix.join(
        home,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json'
      )
    );
  });

  it('uses APPDATA for Claude Desktop and LOCALAPPDATA for Codex Desktop on Windows', async () => {
    const home = 'C:\\Users\\ada';
    const appData = 'C:\\Users\\ada\\AppData\\Roaming';
    const localAppData = 'C:\\Users\\ada\\AppData\\Local';
    const found = await detectInstalledClients(
      probe({
        platform: 'win32',
        homeDir: home,
        projectRoot: 'D:\\work\\demo',
        env: { APPDATA: appData, LOCALAPPDATA: localAppData },
        pathExists: async (target) =>
          target === path.win32.join(appData, 'Claude') ||
          target === path.win32.join(localAppData, 'Programs', 'Codex')
      })
    );

    expect(found.map((client) => client.id)).toEqual(['claude-desktop', 'codex-desktop']);
    expect(found[0]?.configPath).toBe(
      path.win32.join(appData, 'Claude', 'claude_desktop_config.json')
    );
    expect(found[1]?.configPath).toBe(path.win32.join('D:\\work\\demo', '.codex', 'config.toml'));
  });

  it('detects clients from commands when no install folder is present', async () => {
    const projectRoot = '/projects/demo';
    const found = await detectInstalledClients(
      probe({
        platform: 'linux',
        projectRoot,
        commandExists: async (command) => command === 'claude' || command === 'code'
      })
    );

    expect(found.map((client) => client.id)).toEqual(['claude-code', 'vscode']);
    expect(found.map((client) => client.configPath)).toEqual([
      path.posix.join(projectRoot, '.mcp.json'),
      path.posix.join(projectRoot, '.vscode', 'mcp.json')
    ]);
  });

  it('detects Cursor, Windsurf, and Codex CLI from their home folders', async () => {
    const home = '/Users/ada';
    const found = await detectInstalledClients(
      probe({
        platform: 'darwin',
        homeDir: home,
        pathExists: async (target) =>
          target === path.posix.join(home, '.cursor') ||
          target === path.posix.join(home, '.codeium', 'windsurf') ||
          target === path.posix.join(home, '.codex')
      })
    );

    expect(found.map((client) => client.id)).toEqual(['cursor', 'windsurf', 'codex-cli']);
    expect(found.find((client) => client.id === 'windsurf')?.configPath).toBe(
      path.posix.join(home, '.codeium', 'windsurf', 'mcp_config.json')
    );
    expect(found.find((client) => client.id === 'cursor')?.configPath).toBe(
      path.posix.join('/projects/demo', '.cursor', 'mcp.json')
    );
  });

  it('does not treat a project config file as an installed client', async () => {
    const found = await detectInstalledClients(
      probe({
        platform: 'linux',
        pathExists: async (target) => target === '/projects/demo/.cursor/mcp.json'
      })
    );

    expect(found).toEqual([]);
  });

  it('returns no clients when nothing is installed', async () => {
    const found = await detectInstalledClients(probe({ platform: 'linux' }));
    expect(found).toEqual([]);
  });
});

describe('buildWritePlans', () => {
  const launch = {
    nodeExecutable: '/usr/local/bin/node',
    serverEntrypoint: '/opt/codebase-context/dist/index.js',
    projectRoot: '/projects/My App'
  };

  it('writes Codex CLI and Codex Desktop to one project file', () => {
    const clients: DetectedClient[] = [
      {
        id: 'codex-cli',
        label: 'Codex CLI',
        configPath: '/projects/My App/.codex/config.toml'
      },
      {
        id: 'codex-desktop',
        label: 'Codex Desktop',
        configPath: '/projects/My App/.codex/config.toml'
      }
    ];

    const plans = buildWritePlans(clients, launch);

    expect(plans).toHaveLength(1);
    expect(plans[0]?.clients.map((client) => client.label)).toEqual(['Codex CLI', 'Codex Desktop']);
    expect(plans[0]?.content).toBe(
      `[mcp_servers.codebase-context]\ncommand = "/usr/local/bin/node"\nargs = ["/opt/codebase-context/dist/index.js", "/projects/My App"]\nstartup_timeout_sec = 120\n`
    );
  });

  it('uses the VS Code servers key and includes the project path', () => {
    const plans = buildWritePlans(
      [
        {
          id: 'vscode',
          label: 'VS Code',
          configPath: '/projects/My App/.vscode/mcp.json'
        }
      ],
      launch
    );

    expect(JSON.parse(plans[0]?.content ?? '{}')).toEqual({
      servers: {
        'codebase-context': {
          type: 'stdio',
          command: launch.nodeExecutable,
          args: [launch.serverEntrypoint, launch.projectRoot]
        }
      }
    });
  });
});
