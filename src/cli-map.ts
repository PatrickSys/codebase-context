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
import {
  CODEBASE_CONTEXT_DIRNAME,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME,
  MEMORY_FILENAME
} from './constants/codebase-context.js';
import { createProjectState } from './project-state.js';
import { buildCodebaseMap, renderMapMarkdown, renderMapPretty } from './core/codebase-map.js';
import type { IndexState } from './tools/types.js';

function resolveMapRootPath(): string {
  return path.resolve(process.env.CODEBASE_ROOT ?? process.cwd());
}

function printMapUsage(): void {
  console.log('codebase-context map [options]');
  console.log('');
  console.log('Output the conventions map for the current codebase.');
  console.log('');
  console.log('Options:');
  console.log('  --json    Output raw JSON (CodebaseMapSummary)');
  console.log('  --pretty  Terminal-friendly box layout');
  console.log('  --help    Show this help');
  console.log('');
  console.log('Default output is markdown (pipeable).');
}

export async function handleMapCli(args: string[]): Promise<void> {
  const useJson = args.includes('--json');
  const usePretty = args.includes('--pretty');
  const showHelp = args.includes('--help') || args.includes('-h');

  if (showHelp) {
    printMapUsage();
    return;
  }

  const rootPath = resolveMapRootPath();

  // Build a minimal project state — same pattern as the MCP resource path.
  const baseDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);
  const paths = {
    baseDir,
    memory: path.join(baseDir, MEMORY_FILENAME),
    intelligence: path.join(baseDir, INTELLIGENCE_FILENAME),
    keywordIndex: path.join(baseDir, KEYWORD_INDEX_FILENAME),
    vectorDb: path.join(baseDir, VECTOR_DB_DIRNAME)
  };

  let indexExists = false;
  try {
    await fs.access(paths.keywordIndex);
    indexExists = true;
  } catch {
    // no index yet
  }

  const indexState: IndexState = { status: indexExists ? 'ready' : 'idle' };

  const project = createProjectState(rootPath);
  project.indexState = indexState;

  try {
    const map = await buildCodebaseMap(project);

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
