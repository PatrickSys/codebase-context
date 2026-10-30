import { readFileSync } from 'node:fs';

export const PKG_VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version as string;

export function resolveMcpPackageSpec(trackLatest: boolean): string {
  return trackLatest ? 'codebase-context@latest' : `codebase-context@${PKG_VERSION}`;
}
