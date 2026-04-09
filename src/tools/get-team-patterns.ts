import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import type { ToolContext, ToolResponse } from './types.js';
import { readMemoriesFile } from '../memory/store.js';
import {
  isComplementaryPatternConflict,
  shouldSkipLegacyTestingFrameworkCategory
} from '../patterns/semantics.js';
import type { IntelligenceData, IntelligenceGoldenFile, PatternsData } from '../types/index.js';

/**
 * Filter golden files by category prefix keys in their patterns map.
 * Returns files whose patterns include at least one key matching a given prefix.
 * Returns empty array when no golden files match — never fabricates.
 */
function filterGoldenFilesByCategory(
  goldenFiles: IntelligenceGoldenFile[] | undefined,
  categoryPrefixes: string[]
): IntelligenceGoldenFile[] {
  if (!goldenFiles?.length) return [];
  return goldenFiles.filter(
    (gf) =>
      gf.patterns &&
      categoryPrefixes.some((prefix) => Object.keys(gf.patterns!).some((k) => k.startsWith(prefix)))
  );
}

export const definition: Tool = {
  name: 'get_team_patterns',
  description:
    'Get actionable team pattern recommendations based on codebase analysis. ' +
    'Returns consensus patterns for DI, state management, testing, library wrappers, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Pattern category to retrieve',
        enum: ['all', 'di', 'state', 'testing', 'libraries']
      }
    }
  }
};

export async function handle(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const { category } = args as { category?: string };

  try {
    const intelligencePath = ctx.paths.intelligence;
    const content = await fs.readFile(intelligencePath, 'utf-8');
    const intelligence = JSON.parse(content) as unknown;
    if (typeof intelligence !== 'object' || intelligence === null) {
      throw new Error('Invalid intelligence.json: expected an object');
    }
    const intel = intelligence as IntelligenceData;

    const result: Record<string, unknown> = { status: 'success' };

    if (category === 'all' || !category) {
      const rawPatterns = intel.patterns || {};
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawPatterns)) {
        if (shouldSkipLegacyTestingFrameworkCategory(k, rawPatterns)) continue;
        filtered[k] = v;
      }
      result.patterns = filtered;
      result.goldenFiles = intel.goldenFiles || [];
      if (intel.tsconfigPaths) {
        result.tsconfigPaths = intel.tsconfigPaths;
      }
    } else if (category === 'di') {
      result.patterns = {};
      if (intel.patterns?.dependencyInjection)
        (result.patterns as Record<string, unknown>).dependencyInjection =
          intel.patterns.dependencyInjection;
      result.goldenFiles = filterGoldenFilesByCategory(intel.goldenFiles, ['dependencyInjection:']);
    } else if (category === 'state') {
      result.patterns = {};
      if (intel.patterns?.stateManagement)
        (result.patterns as Record<string, unknown>).stateManagement =
          intel.patterns.stateManagement;
      result.goldenFiles = filterGoldenFilesByCategory(intel.goldenFiles, ['stateManagement:']);
    } else if (category === 'testing') {
      result.patterns = {};
      for (const k of [
        'unitTestFramework',
        'e2eFramework',
        'testingFramework',
        'testMocking'
      ] as const) {
        if (intel.patterns?.[k])
          (result.patterns as Record<string, unknown>)[k] = intel.patterns[k];
      }
      result.goldenFiles = filterGoldenFilesByCategory(intel.goldenFiles, [
        'unitTestFramework:',
        'e2eFramework:',
        'testingFramework:'
      ]);
    } else if (category === 'libraries') {
      result.topUsed = intel.importGraph?.topUsed || [];
      if (intel.tsconfigPaths) {
        result.tsconfigPaths = intel.tsconfigPaths;
      }
    }

    // Load and append matching memories
    try {
      const allMemories = await readMemoriesFile(ctx.paths.memory);

      // Map pattern categories to decision categories
      const categoryMap: Record<string, string[]> = {
        all: ['tooling', 'architecture', 'testing', 'dependencies', 'conventions'],
        di: ['architecture', 'conventions'],
        state: ['architecture', 'conventions'],
        testing: ['testing'],
        libraries: ['dependencies']
      };

      const relevantCategories = categoryMap[category || 'all'] || [];
      const matchingMemories = allMemories.filter((m) => relevantCategories.includes(m.category));

      if (matchingMemories.length > 0) {
        result.memories = matchingMemories;
      }
    } catch (_error) {
      // No memory file yet, that's fine - don't fail the whole request
    }

    // Detect pattern conflicts: primary < 80% and any alternative > 20%
    const conflicts: Array<{
      category: string;
      primary: { name: string; adoption: string; trend: string | undefined };
      alternative: { name: string; adoption: string; trend: string | undefined };
      note: string;
    }> = [];
    const patternsData: PatternsData = intel.patterns || {};
    const hasUnitTestFramework = Boolean(patternsData.unitTestFramework?.primary);
    for (const [cat, data] of Object.entries(patternsData)) {
      if (shouldSkipLegacyTestingFrameworkCategory(cat, patternsData)) continue;
      if (category && category !== 'all' && cat !== category) continue;
      if (!data.primary || !data.alsoDetected?.length) continue;

      const primaryFreq = parseFloat(data.primary.frequency) || 100;
      if (primaryFreq >= 80) continue;

      for (const alt of data.alsoDetected) {
        const altFreq = parseFloat(alt.frequency) || 0;
        if (altFreq < 20) continue;
        if (isComplementaryPatternConflict(cat, data.primary.name, alt.name)) continue;
        if (hasUnitTestFramework && cat === 'testingFramework') continue;

        conflicts.push({
          category: cat,
          primary: {
            name: data.primary.name,
            adoption: data.primary.frequency,
            trend: data.primary.trend
          },
          alternative: {
            name: alt.name,
            adoption: alt.frequency,
            trend: alt.trend
          },
          note: `Split decision: ${data.primary.frequency} ${data.primary.name} (${data.primary.trend || 'unknown'}) vs ${alt.frequency} ${alt.name} (${alt.trend || 'unknown'})`
        });
      }
    }
    if (conflicts.length > 0) {
      result.conflicts = conflicts;
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'error',
              message: 'Failed to load team patterns',
              error: error instanceof Error ? error.message : String(error)
            },
            null,
            2
          )
        }
      ]
    };
  }
}
