import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import {
  _buildMergedCodexContent,
  _buildMergedMcpContent,
  generateMcpConfig,
  resolveClientConfigPath
} from './cli-init.js';
import type { Client } from './cli-init-types.js';
import { PKG_VERSION, resolveMcpPackageSpec } from './cli-init-package.js';
import { atomicWrite } from './utils/atomic-write.js';

export type UpdateOptions = {
  rootPath: string;
  clients: Client[];
  trackLatest: boolean;
  dryRun: boolean;
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function applyPinnedUpdate(
  client: Client,
  options: UpdateOptions
): Promise<'updated' | 'unchanged' | 'missing' | 'skipped'> {
  if (client === 'vscode') {
    return 'skipped';
  }
  const generated = generateMcpConfig(client, {
    rootPath: options.rootPath,
    trackLatest: options.trackLatest
  });
  if (generated.kind !== 'file') return 'skipped';

  if (client === 'codex') {
    const merged = await _buildMergedCodexContent(generated.path, generated.content);
    const existing = await fs.readFile(generated.path, 'utf8').catch(() => null);
    if (existing === null) return 'missing';
    if (merged.content === existing) return 'unchanged';
    if (options.dryRun) return 'updated';
    await atomicWrite(generated.path, merged.content);
    return 'updated';
  }

  if (client === 'cursor' || client === 'opencode' || client === 'claude-code') {
    const merged = await _buildMergedMcpContent(generated.path, generated.content, client);
    const existing = await fs.readFile(generated.path, 'utf8').catch(() => null);
    if (existing === null) return 'missing';
    if (merged.content === existing) return 'unchanged';
    if (options.dryRun) return 'updated';
    await atomicWrite(generated.path, merged.content);
    return 'updated';
  }

  return 'skipped';
}

export async function handleUpdateCli(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const trackLatest = args.includes('--track-latest');
  const help = args.includes('--help') || args.includes('-h');
  if (help) {
    console.log('codebase-context update [options]');
    console.log('  Refresh pinned codebase-context@version entries written by init.');
    console.log('  --dry-run         Preview updates without writing');
    console.log('  --track-latest    Move configs to codebase-context@latest');
    console.log('  --client <name>   Repeatable (default: cursor, opencode, codex, claude-code)');
    console.log(`  Default target version when pinned: ${PKG_VERSION}`);
    return;
  }

  const clients: Client[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--client' || arg === '--clients') {
      const value = args[++index];
      if (!value) throw new Error(`Expected a client after ${arg}.`);
      clients.push(value as Client);
    } else if (arg?.startsWith('--client=') || arg?.startsWith('--clients=')) {
      clients.push(arg.split('=')[1] as Client);
    }
  }
  const selected = clients.length
    ? [...new Set(clients)]
    : (['cursor', 'opencode', 'codex', 'claude-code'] as Client[]);
  const rootPath = path.resolve(process.env.CODEBASE_ROOT ?? process.cwd());

  for (const client of selected) {
    const result = await applyPinnedUpdate(client, {
      rootPath,
      clients: selected,
      trackLatest,
      dryRun
    });
    const label = resolveClientConfigPath(client, rootPath);
    console.log(`${dryRun ? 'Would update' : 'Updated'} ${client}: ${result} (${label})`);
  }
}
