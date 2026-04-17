/**
 * CLI handler for memory subcommands: list, add, remove.
 */

import path from 'path';
import type { Memory, MemoryScope } from './types/index.js';
import { CODEBASE_CONTEXT_DIRNAME, MEMORY_FILENAME } from './constants/codebase-context.js';
import {
  appendMemoryFile,
  buildMemoryIdentityParts,
  readMemoriesFile,
  removeMemory,
  filterMemories,
  normalizeMemoryScope,
  withConfidence
} from './memory/store.js';

const MEMORY_CATEGORIES = [
  'tooling',
  'architecture',
  'testing',
  'dependencies',
  'conventions'
] as const;
type CliMemoryCategory = (typeof MEMORY_CATEGORIES)[number];

const MEMORY_TYPES = ['convention', 'decision', 'gotcha', 'failure'] as const;
type CliMemoryType = (typeof MEMORY_TYPES)[number];

const MEMORY_CATEGORY_SET: ReadonlySet<string> = new Set(MEMORY_CATEGORIES);
function isCliMemoryCategory(value: string): value is CliMemoryCategory {
  return MEMORY_CATEGORY_SET.has(value);
}

const MEMORY_TYPE_SET: ReadonlySet<string> = new Set(MEMORY_TYPES);
function isCliMemoryType(value: string): value is CliMemoryType {
  return MEMORY_TYPE_SET.has(value);
}

export async function handleMemoryCli(args: string[]): Promise<void> {
  // Resolve project root: use CODEBASE_ROOT env or cwd (argv[2] is "memory", not a path)
  const cliRoot = process.env.CODEBASE_ROOT || process.cwd();
  const memoryPath = path.join(cliRoot, CODEBASE_CONTEXT_DIRNAME, MEMORY_FILENAME);
  const subcommand = args[0]; // list | add | remove
  const useJson = args.includes('--json');

  const listUsage =
    'Usage: codebase-context memory list [--category <cat>] [--type <type>] [--query <text>] [--json]';
  const addUsage =
    'Usage: codebase-context memory add --type <type> --category <category> --memory <text> --reason <text> [--scope-kind global|file|symbol] [--scope-file <path>] [--scope-symbol <name>] [--json]';
  const removeUsage = 'Usage: codebase-context memory remove <id> [--json]';

  const exitWithUsageError = (message: string, usage?: string): never => {
    if (useJson) {
      console.log(
        JSON.stringify(
          {
            status: 'error',
            message,
            ...(usage ? { usage } : {})
          },
          null,
          2
        )
      );
    } else {
      console.error(message);
      if (usage) console.error(usage);
    }
    process.exit(1);
  };

  if (subcommand === 'list') {
    const memories = await readMemoriesFile(memoryPath);
    const opts: { category?: CliMemoryCategory; type?: CliMemoryType; query?: string } = {};

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--category') {
        const value = args[i + 1];
        if (!value || value.startsWith('--')) {
          exitWithUsageError(
            `Error: --category requires a value. Allowed: ${MEMORY_CATEGORIES.join(', ')}`,
            listUsage
          );
        }

        if (isCliMemoryCategory(value)) {
          opts.category = value;
        } else {
          exitWithUsageError(
            `Error: invalid --category "${value}". Allowed: ${MEMORY_CATEGORIES.join(', ')}`,
            listUsage
          );
        }
        i++;
      } else if (args[i] === '--type') {
        const value = args[i + 1];
        if (!value || value.startsWith('--')) {
          exitWithUsageError(
            `Error: --type requires a value. Allowed: ${MEMORY_TYPES.join(', ')}`,
            listUsage
          );
        }

        if (isCliMemoryType(value)) {
          opts.type = value;
        } else {
          exitWithUsageError(
            `Error: invalid --type "${value}". Allowed: ${MEMORY_TYPES.join(', ')}`,
            listUsage
          );
        }
        i++;
      } else if (args[i] === '--query') {
        const value = args[i + 1];
        if (!value || value.startsWith('--')) {
          exitWithUsageError('Error: --query requires a value.', listUsage);
        }
        opts.query = value;
        i++;
      } else if (args[i] === '--json') {
        // handled below
      }
    }

    const filtered = filterMemories(memories, opts);
    const enriched = withConfidence(filtered);

    if (useJson) {
      console.log(JSON.stringify(enriched, null, 2));
    } else {
      if (enriched.length === 0) {
        console.log('No memories found.');
      } else {
        for (const m of enriched) {
          const staleTag = m.stale ? ' [STALE]' : '';
          console.log(`[${m.id}] ${m.type}/${m.category}: ${m.memory}${staleTag}`);
          console.log(`  Reason: ${m.reason}`);
          if (m.scope && m.scope.kind !== 'global') {
            if (m.scope.kind === 'file') {
              console.log(`  Scope: file ${m.scope.file}`);
            } else {
              console.log(`  Scope: symbol ${m.scope.file}#${m.scope.symbol}`);
            }
          }
          console.log(`  Date: ${m.date} | Confidence: ${m.effectiveConfidence}`);
          console.log('');
        }
        console.log(`${enriched.length} memor${enriched.length === 1 ? 'y' : 'ies'} total.`);
      }
    }
  } else if (subcommand === 'add') {
    let type: CliMemoryType = 'decision';
    let category: CliMemoryCategory | undefined;
    let memory: string | undefined;
    let reason: string | undefined;
    let scopeKind: MemoryScope['kind'] | undefined;
    let scopeFile: string | undefined;
    let scopeSymbol: string | undefined;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--type') {
        const value = args[i + 1];
        if (!value || value.startsWith('--')) {
          exitWithUsageError(
            `Error: --type requires a value. Allowed: ${MEMORY_TYPES.join(', ')}`,
            addUsage
          );
        }

        if (isCliMemoryType(value)) {
          type = value;
        } else {
          exitWithUsageError(
            `Error: invalid --type "${value}". Allowed: ${MEMORY_TYPES.join(', ')}`,
            addUsage
          );
        }
        i++;
      } else if (args[i] === '--category') {
        const value = args[i + 1];
        if (!value || value.startsWith('--')) {
          exitWithUsageError(
            `Error: --category requires a value. Allowed: ${MEMORY_CATEGORIES.join(', ')}`,
            addUsage
          );
        }

        if (isCliMemoryCategory(value)) {
          category = value;
        } else {
          exitWithUsageError(
            `Error: invalid --category "${value}". Allowed: ${MEMORY_CATEGORIES.join(', ')}`,
            addUsage
          );
        }
        i++;
      } else if (args[i] === '--memory') {
        const value = args[i + 1];
        if (!value || value.startsWith('--')) {
          exitWithUsageError('Error: --memory requires a value.', addUsage);
        }
        memory = value;
        i++;
      } else if (args[i] === '--reason') {
        const value = args[i + 1];
        if (!value || value.startsWith('--')) {
          exitWithUsageError('Error: --reason requires a value.', addUsage);
        }
        reason = value;
        i++;
      } else if (args[i] === '--scope-kind') {
        const value = args[i + 1];
        if (!value || value.startsWith('--')) {
          exitWithUsageError('Error: --scope-kind requires a value.', addUsage);
        }
        if (value === 'global' || value === 'file' || value === 'symbol') {
          scopeKind = value;
        } else {
          exitWithUsageError(
            'Error: invalid --scope-kind. Allowed: global, file, symbol.',
            addUsage
          );
        }
        i++;
      } else if (args[i] === '--scope-file') {
        const value = args[i + 1];
        if (!value || value.startsWith('--')) {
          exitWithUsageError('Error: --scope-file requires a value.', addUsage);
        }
        scopeFile = value;
        i++;
      } else if (args[i] === '--scope-symbol') {
        const value = args[i + 1];
        if (!value || value.startsWith('--')) {
          exitWithUsageError('Error: --scope-symbol requires a value.', addUsage);
        }
        scopeSymbol = value;
        i++;
      } else if (args[i] === '--json') {
        // handled above
      }
    }

    if (!category || !memory || !reason) {
      exitWithUsageError('Error: required flags missing: --category, --memory, --reason', addUsage);
      return;
    }

    const requiredCategory = category;
    const requiredMemory = memory;
    const requiredReason = reason;
    const scope = normalizeMemoryScope({
      kind: scopeKind,
      file: scopeFile,
      symbol: scopeSymbol
    });

    if (scopeKind === 'file' && !scope) {
      exitWithUsageError('Error: --scope-kind file requires --scope-file.', addUsage);
    }
    if (scopeKind === 'symbol' && !scope) {
      exitWithUsageError(
        'Error: --scope-kind symbol requires --scope-file and --scope-symbol.',
        addUsage
      );
    }

    const crypto = await import('crypto');
    const hashContent = buildMemoryIdentityParts({
      type,
      category: requiredCategory,
      memory: requiredMemory,
      reason: requiredReason,
      scope
    });
    const hash = crypto.createHash('sha256').update(hashContent).digest('hex');
    const id = hash.substring(0, 12);

    const newMemory: Memory = {
      id,
      type,
      category: requiredCategory,
      memory: requiredMemory,
      reason: requiredReason,
      date: new Date().toISOString(),
      ...(scope && { scope })
    };
    const result = await appendMemoryFile(memoryPath, newMemory);

    if (useJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.status === 'duplicate') {
      console.log(`Already exists: [${id}] ${memory}`);
      return;
    }

    console.log(`Added: [${id}] ${memory}`);
  } else if (subcommand === 'remove') {
    const id = args.slice(1).find((value) => value !== '--json' && !value.startsWith('--'));
    if (id === undefined) {
      exitWithUsageError('Error: missing memory id.', removeUsage);
      return;
    }

    const result = await removeMemory(memoryPath, id);
    if (result.status === 'not_found') {
      if (useJson) {
        console.log(JSON.stringify({ status: 'not_found', id }, null, 2));
      } else {
        console.error(`Memory not found: ${id}`);
      }
      process.exit(1);
    }

    if (useJson) {
      console.log(JSON.stringify({ status: 'removed', id }, null, 2));
      return;
    }

    console.log(`Removed: ${id}`);
  } else {
    exitWithUsageError(
      'Error: unknown subcommand. Expected: list | add | remove',
      'Usage: codebase-context memory <list|add|remove>'
    );
  }
}
