import path from 'node:path';
import type { Client } from './cli-init-types.js';
import { buildNpxLaunchArgs, resolveMcpPackageSpec } from './cli-init-package.js';
import { formatCommandPreview } from './cli-init-runner.js';

export type InitScope = 'user' | 'project';

export type CliRegistrationPlan = {
  kind: 'cli';
  client: Client;
  label: string;
  file: string;
  args: string[];
  cwd?: string;
};

export type JsonRegistrationPlan = {
  kind: 'json';
  client: 'cursor' | 'opencode';
  label: string;
  path: string;
};

export type SkippedRegistrationPlan = {
  kind: 'skip';
  client: Client;
  reason: string;
};

export type RegistrationPlan = CliRegistrationPlan | JsonRegistrationPlan | SkippedRegistrationPlan;

export function isJsonConfigClient(client: Client): client is 'cursor' | 'opencode' {
  return client === 'cursor' || client === 'opencode';
}

export function isCliConfigClient(client: Client): client is 'claude-code' | 'codex' | 'vscode' {
  return client === 'claude-code' || client === 'codex' || client === 'vscode';
}

export function planClientRegistration(
  client: Client,
  options: {
    rootPath: string;
    scope: InitScope;
    trackLatest: boolean;
    platform?: NodeJS.Platform;
  }
): RegistrationPlan {
  const rootPath = path.resolve(options.rootPath);
  const platform = options.platform ?? process.platform;
  const launch = buildNpxLaunchArgs(rootPath, options.trackLatest, platform);

  if (client === 'cursor' || client === 'opencode') {
    if (options.scope === 'user' && client === 'cursor') {
      return {
        kind: 'skip',
        client,
        reason: 'Cursor project MCP config lives in .cursor/mcp.json; rerun with --scope project.'
      };
    }
    return {
      kind: 'json',
      client,
      label: client === 'cursor' ? '.cursor/mcp.json' : 'opencode.json',
      path:
        client === 'cursor'
          ? path.join(rootPath, '.cursor', 'mcp.json')
          : path.join(rootPath, 'opencode.json')
    };
  }

  if (client === 'vscode' && options.scope === 'project') {
    return {
      kind: 'skip',
      client,
      reason:
        'VS Code workspace MCP uses .vscode/mcp.json; use --scope user for code --add-mcp or configure Cursor/OpenCode JSON manually.'
    };
  }

  if (client === 'claude-code') {
    return {
      kind: 'cli',
      client,
      label: 'claude mcp add',
      file: platform === 'win32' ? 'claude.exe' : 'claude',
      args: [
        'mcp',
        'add',
        '--scope',
        options.scope,
        '--transport',
        'stdio',
        'codebase-context',
        '--',
        ...launch.shellCommand
      ]
    };
  }

  if (client === 'codex') {
    return {
      kind: 'cli',
      client,
      label: 'codex mcp add',
      file: platform === 'win32' ? 'codex.exe' : 'codex',
      args: ['mcp', 'add', 'codebase-context', '--', ...launch.shellCommand],
      cwd: options.scope === 'project' ? rootPath : undefined
    };
  }

  if (client === 'vscode') {
    const payload = {
      name: 'codebase-context',
      command: 'npx',
      args: ['-y', resolveMcpPackageSpec(options.trackLatest), rootPath]
    };
    const code = platform === 'win32' ? 'code.cmd' : 'code';
    return {
      kind: 'cli',
      client,
      label: 'code --add-mcp',
      file: code,
      args: ['--add-mcp', JSON.stringify(payload)]
    };
  }

  return { kind: 'skip', client, reason: `Unsupported client "${client}".` };
}

export function describeRegistrationPlan(plan: RegistrationPlan): string {
  if (plan.kind === 'skip') return `Skip ${plan.client}: ${plan.reason}`;
  if (plan.kind === 'json') return `Edit ${plan.label} at ${plan.path}`;
  return formatCommandPreview(plan.file, plan.args);
}
