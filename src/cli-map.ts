import { resolveIndexArtifact } from './core/index-generation.js';
/**
 * CLI handler for `codebase-context map`.
 *
 * Self-contained module — does not import from cli.ts.
 * Resolves root path, builds the CodebaseMapSummary, and renders per flag:
 *   (no flags)  → markdown (pipeable)
 *   --json      → JSON.stringify(map)
 *   --pretty    → terminal box layout
 *   --help      → usage string
 */

import path from 'path';
import { promises as fs } from 'fs';
import { KEYWORD_INDEX_FILENAME } from './constants/codebase-context.js';
import { createProjectState } from './project-state.js';
import { buildCodebaseMap, renderMapMarkdown, renderMapPretty } from './core/codebase-map.js';
import type { IndexState } from './tools/types.js';
import { CodebaseIndexer } from './core/indexer.js';
import { loadProjectConfig } from './server/config.js';
import { cliProjectOptions } from './cli-project-options.js';
import { inspectIndexDiskState, permitsFirstBuild } from './core/index-generation.js';
import { IndexCorruptedError } from './errors/index.js';

function resolveMapRootPath(): string {
  return path.resolve(process.env.CODEBASE_ROOT ?? process.cwd());
}

function printMapUsage(): void {
  console.log('codebase-context map [options]');
  console.log('');
  console.log('Output the conventions map for the current codebase.');
  console.log('');
  console.log('Options:');
  console.log('  --export  Write CODEBASE_MAP.md to project root (still honors --full)');
  console.log('  --full    Output the exhaustive map instead of the bounded default');
  console.log('  --json    Output raw JSON (CodebaseMapSummary)');
  console.log('  --pretty  Terminal-friendly box layout');
  console.log('  --help    Show this help');
  console.log('');
  console.log('Default output is markdown (pipeable).');
}

export async function handleMapCli(args: string[]): Promise<void> {
  const useJson = args.includes('--json');
  const usePretty = args.includes('--pretty');
  const useExport = args.includes('--export');
  const useFull = args.includes('--full');
  const showHelp = args.includes('--help') || args.includes('-h');

  if (showHelp) {
    printMapUsage();
    return;
  }

  const rootPath = resolveMapRootPath();

  // Build a minimal project state — same pattern as the MCP resource path.
  let indexExists = false;
  try {
    await fs.access(await resolveIndexArtifact(rootPath, KEYWORD_INDEX_FILENAME));
    indexExists = true;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    if (!permitsFirstBuild(await inspectIndexDiskState(rootPath)))
      throw new IndexCorruptedError(
        'The keyword index is missing from an existing index. Run reindex explicitly before building the map.'
      );
    console.error(`Indexing ${rootPath} before building the map.`);
    const config = await loadProjectConfig(rootPath);
    await new CodebaseIndexer({
      rootPath,
      firstBuildOnly: true,
      ...cliProjectOptions(config)
    }).index();
    console.error('Index ready for the map.');
    indexExists = true;
  }

  const indexState: IndexState = { status: indexExists ? 'ready' : 'idle' };

  const project = createProjectState(rootPath);
  project.indexState = indexState;

  try {
    const map = await buildCodebaseMap(project, { mode: useFull ? 'full' : 'bounded' });

    if (useExport) {
      const outPath = path.join(rootPath, 'CODEBASE_MAP.md');
      await fs.writeFile(outPath, renderMapMarkdown(map), 'utf-8');
      console.log(`Wrote ${outPath}`);
      return;
    }

    if (useJson) {
      console.log(JSON.stringify(map, null, 2));
    } else if (usePretty) {
      console.log(renderMapPretty(map));
    } else {
      console.log(renderMapMarkdown(map));
    }
  } catch (error) {
    console.error(
      'Error building codebase map:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}
