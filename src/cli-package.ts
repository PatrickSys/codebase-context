import path from 'path';
import { buildContextPackage } from './package-context/builder.js';
import { checkContextPackage } from './package-context/check.js';
import {
  previewContextPackage,
  renderContextPackagePreview
} from './package-context/preview.js';

type FlagValue = string | true;
type Flags = Record<string, FlagValue>;

function printPackageUsage(): void {
  writeOut([
    'codebase-context package <build|preview|check> [options]',
    '',
    'Commands:',
    '  package build [root] [--out <dir>] [--json]    Build an AI context package',
    '  package preview [dir] [--json]                 Preview an AI context package',
    '  package check [dir] [--json]                   Validate an AI context package',
    '',
    'Defaults:',
    '  root: current working directory',
    '  out:  <root>/.context'
  ]);
}

export async function handlePackageCli(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printPackageUsage();
    return;
  }

  const useJson = args.includes('--json');
  const flags = parseFlags(args);

  switch (subcommand) {
    case 'build': {
      const rootPath = path.resolve(firstPositional(args.slice(1)) ?? process.cwd());
      const outDir = path.resolve(optionalStringFlag(flags, 'out') ?? path.join(rootPath, '.context'));
      const result = await buildContextPackage({ rootPath, outDir });
      if (useJson) {
        writeOut(JSON.stringify(result, null, 2));
      } else {
        writeOut([
          `Built AI context package: ${outDir}`,
          `Artifacts: ${result.artifactCount}`,
          `Public surface entries: ${result.publicSurfaceCount}`,
          ...(result.warningCount > 0 ? [`Warnings: ${result.warningCount}`] : [])
        ]);
      }
      return;
    }
    case 'preview': {
      const contextDir = path.resolve(firstPositional(args.slice(1)) ?? path.join(process.cwd(), '.context'));
      const preview = await previewContextPackage(contextDir);
      writeOut(useJson ? JSON.stringify(preview, null, 2) : renderContextPackagePreview(preview));
      return;
    }
    case 'check': {
      const contextDir = path.resolve(firstPositional(args.slice(1)) ?? path.join(process.cwd(), '.context'));
      const result = await checkContextPackage(contextDir);
      if (useJson) {
        writeOut(JSON.stringify(result, null, 2));
      } else {
        writeOut([
          result.ok ? 'AI context package check passed.' : 'AI context package check failed.',
          `Checked source files: ${result.checkedFiles}`,
          ...result.warnings.map((warning) => `Warning: ${warning}`),
          ...result.errors.map((error) => `Error: ${error}`)
        ]);
      }
      if (!result.ok) {
        process.exit(1);
      }
      return;
    }
    default: {
      console.error(`Unknown package command: ${subcommand}`);
      console.error('');
      printPackageUsage();
      process.exit(1);
    }
  }
}

function writeOut(value: string | string[]): void {
  const text = Array.isArray(value) ? value.join('\n') : value;
  process.stdout.write(`${text}\n`);
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function optionalStringFlag(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  if (value === true) {
    throw new Error(`--${key} requires a value`);
  }
  return typeof value === 'string' ? value : undefined;
}

function firstPositional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        i++;
      }
      continue;
    }
    return arg;
  }
  return undefined;
}
