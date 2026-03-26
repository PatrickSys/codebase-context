import os from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ProjectConfig {
  root: string;
  excludePatterns?: string[];
}

export interface ServerConfig {
  projects?: ProjectConfig[];
  server?: { port?: number; host?: string };
}

function expandTilde(filePath: string): string {
  if (filePath === '~' || filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

export async function loadServerConfig(): Promise<ServerConfig | null> {
  const configPath =
    process.env.CODEBASE_CONTEXT_CONFIG_PATH ??
    path.join(os.homedir(), '.codebase-context', 'config.json');

  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error(`[config] Failed to load config: ${(err as Error).message}`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[config] Failed to load config: ${(err as Error).message}`);
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const config = parsed as Record<string, unknown>;
  const result: ServerConfig = {};

  // Resolve projects
  if (Array.isArray(config.projects)) {
    result.projects = (config.projects as unknown[])
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map((p) => {
        const rawRoot = typeof p.root === 'string' ? p.root.trim() : '';
        if (!rawRoot) {
          console.error('[config] Skipping project entry with missing or empty root');
          return null;
        }
        const resolvedRoot = path.resolve(expandTilde(rawRoot));
        const proj: ProjectConfig = { root: resolvedRoot };
        if (Array.isArray(p.excludePatterns)) {
          proj.excludePatterns = p.excludePatterns.filter(
            (pattern): pattern is string => typeof pattern === 'string'
          );
        }
        return proj;
      })
      .filter((project): project is ProjectConfig => project !== null);
  }

  // Resolve server options
  if (typeof config.server === 'object' && config.server !== null) {
    const srv = config.server as Record<string, unknown>;
    result.server = {};

    if (typeof srv.host === 'string') {
      result.server.host = srv.host;
    }

    if (srv.port !== undefined) {
      const portValue = srv.port;
      const portNum = typeof portValue === 'number' ? portValue : Number(portValue);
      if (Number.isInteger(portNum) && portNum > 0 && portNum <= 65535) {
        result.server.port = portNum;
      } else {
        console.error(`[config] Ignoring invalid server.port: ${portValue}`);
      }
    }
  }

  return result;
}
