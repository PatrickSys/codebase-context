import { promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const CACHE_DIR = '.codebase-context';
const CACHE_FILE = 'init-update-notice.json';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type NoticeCache = {
  checkedAtMs: number;
  latestVersion?: string;
};

function skipUpdateNotice(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE ?? env.CODEBASE_CONTEXT_NO_UPDATE_NOTICE;
  if (!flag) return false;
  const normalized = flag.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function resolveCachePath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  return path.join(home, CACHE_DIR, CACHE_FILE);
}

async function readCache(cachePath: string): Promise<NoticeCache | null> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as NoticeCache;
    if (typeof parsed.checkedAtMs !== 'number') return null;
    return parsed;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

async function writeCache(cachePath: string, cache: NoticeCache): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cache), 'utf8');
}

async function fetchLatestPublishedVersion(
  packageName: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | undefined> {
  const response = await fetchImpl(`https://registry.npmjs.org/${packageName}/latest`, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { version?: string };
  return typeof body.version === 'string' ? body.version : undefined;
}

/**
 * Print at most one npm update notice per day. Uses a cache under ~/.codebase-context/.
 * Disable with CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE=1 or init --no-update-notice.
 */
export async function maybePrintInitUpdateNotice(
  installedVersion: string,
  options: {
    disabled?: boolean;
    env?: NodeJS.ProcessEnv;
    nowMs?: number;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<void> {
  if (options.disabled || skipUpdateNotice(options.env)) return;

  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const cachePath = resolveCachePath(env);
  const cached = await readCache(cachePath);
  if (cached && nowMs - cached.checkedAtMs < ONE_DAY_MS) {
    return;
  }

  let latestVersion: string | undefined;
  try {
    latestVersion = await fetchLatestPublishedVersion('codebase-context', options.fetchImpl);
  } catch {
    return;
  }
  if (!latestVersion) return;

  await writeCache(cachePath, { checkedAtMs: nowMs, latestVersion });
  if (latestVersion !== installedVersion) {
    console.log(
      `Update available: codebase-context@${latestVersion} is on npm (you have ${installedVersion}). Run \`codebase-context update\` to refresh pinned configs, or init with --track-latest.`
    );
  }
}
