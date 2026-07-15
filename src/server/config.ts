import os from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ProjectConfig {
  root: string;
  excludePatterns?: string[];
  parsing?: {
    maxChunks?: number;
  };
  analyzerHints?: {
    extensions?: string[];
    analyzer?: string;
  };
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

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return parsed.length > 0 ? parsed : undefined;
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

  if (Array.isArray(config.projects)) {
    result.projects = (config.projects as unknown[])
      .filter(
        (project): project is Record<string, unknown> =>
          typeof project === 'object' && project !== null
      )
      .map((project) => {
        const rawRoot = typeof project.root === 'string' ? project.root.trim() : '';
        if (!rawRoot) {
          console.error('[config] Skipping project entry with missing or empty root');
          return null;
        }

        const resolvedRoot = path.resolve(expandTilde(rawRoot));
        const parsedProject: ProjectConfig = { root: resolvedRoot };
        const excludePatterns = parseStringArray(project.excludePatterns);
        if (excludePatterns) {
          parsedProject.excludePatterns = excludePatterns;
        }

        if (
          typeof project.parsing === 'object' &&
          project.parsing !== null &&
          !Array.isArray(project.parsing)
        ) {
          const parsing = project.parsing as Record<string, unknown>;
          const maxChunks = parsing.maxChunks;
          if (typeof maxChunks === 'number' && Number.isInteger(maxChunks) && maxChunks > 0) {
            parsedProject.parsing = { maxChunks };
          } else if (maxChunks !== undefined) {
            console.error(`[config] Ignoring invalid project parsing.maxChunks: ${maxChunks}`);
          }
        }

        if (
          typeof project.analyzerHints === 'object' &&
          project.analyzerHints !== null &&
          !Array.isArray(project.analyzerHints)
        ) {
          const analyzerHints = project.analyzerHints as Record<string, unknown>;
          const parsedHints: NonNullable<ProjectConfig['analyzerHints']> = {};
          const extensions = parseStringArray(analyzerHints.extensions);
          if (extensions) {
            parsedHints.extensions = extensions;
          }

          if (typeof analyzerHints.analyzer === 'string') {
            const analyzer = analyzerHints.analyzer.trim();
            if (analyzer) {
              parsedHints.analyzer = analyzer;
            }
          }

          if (parsedHints.analyzer || parsedHints.extensions) {
            parsedProject.analyzerHints = parsedHints;
          }
        }

        return parsedProject;
      })
      .filter((project): project is ProjectConfig => project !== null);
  }

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

export async function loadProjectConfig(rootPath: string): Promise<ProjectConfig | undefined> {
  const serverConfig = await loadServerConfig();
  const resolvedRoot = path.resolve(rootPath);
  return serverConfig?.projects?.find((project) => project.root === resolvedRoot);
}
