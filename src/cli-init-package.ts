import { readFileSync } from 'node:fs';

export const PKG_VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version as string;

export function resolveMcpPackageSpec(trackLatest: boolean): string {
  return trackLatest ? 'codebase-context@latest' : `codebase-context@${PKG_VERSION}`;
}

export function buildNpxLaunchArgs(
  rootPath: string,
  trackLatest: boolean,
  platform: NodeJS.Platform = process.platform
): { command: string; args: string[]; shellCommand: string[] } {
  const npx = platform === 'win32' ? 'npx.cmd' : 'npx';
  const packageSpec = resolveMcpPackageSpec(trackLatest);
  const args = ['-y', packageSpec, rootPath];
  return {
    command: npx,
    args,
    shellCommand: [npx, ...args]
  };
}
