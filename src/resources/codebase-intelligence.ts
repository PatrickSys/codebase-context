import type { ProjectState } from '../project-state.js';
import { buildCodebaseMap, renderMapMarkdown } from '../core/codebase-map.js';

/**
 * Generate the codebase intelligence resource payload for `codebase://context`.
 *
 * Signature is preserved for backward compatibility with the eval harness
 * (`src/eval/discovery-harness.ts` imports this at line 23 and calls it at
 * line 121). The function is now a thin wrapper over the shared map builder.
 */
export async function generateCodebaseIntelligence(project: ProjectState): Promise<string> {
  try {
    const map = await buildCodebaseMap(project);
    return renderMapMarkdown(map);
  } catch (error) {
    return (
      '# Codebase Intelligence\n\n' +
      'Intelligence data not yet generated. Run indexing first.\n' +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
