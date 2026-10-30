import { EXCLUDED_GLOB_PATTERNS } from './constants/codebase-context.js';
import type { IndexerOptions } from './core/indexer.js';
import type { loadProjectConfig } from './server/config.js';

/** Adapt persisted project settings without deciding an unspecified embedding mode. */
export function cliProjectOptions(
  project: Awaited<ReturnType<typeof loadProjectConfig>>,
  skipEmbedding = project?.skipEmbedding
): Pick<IndexerOptions, 'config' | 'projectOptions'> {
  return {
    config: {
      exclude: [...EXCLUDED_GLOB_PATTERNS, ...(project?.excludePatterns ?? [])],
      ...(project?.parsing ? { parsing: project.parsing } : {}),
      ...(skipEmbedding !== undefined ? { skipEmbedding } : {})
    },
    projectOptions: {
      preferredAnalyzer: project?.analyzerHints?.analyzer,
      extraFileExtensions: project?.analyzerHints?.extensions
    }
  };
}
