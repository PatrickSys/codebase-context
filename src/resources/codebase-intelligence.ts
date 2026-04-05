import { promises as fs } from 'fs';
import path from 'path';
import type { ProjectState } from '../project-state.js';
import type { IntelligenceData, PatternsData, PatternCandidate } from '../types/index.js';
import {
  isComplementaryPatternCategory,
  shouldSkipLegacyTestingFrameworkCategory
} from '../patterns/semantics.js';
import { RELATIONSHIPS_FILENAME } from '../constants/codebase-context.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readIndexSignal(project: ProjectState): Promise<{
  status: 'ready' | 'stale';
  confidence: 'high' | 'low';
  action: 'served';
  reason?: string;
}> {
  const hasIntelligence = await fileExists(project.paths.intelligence);
  const hasRelationships = await fileExists(
    path.join(path.dirname(project.paths.intelligence), RELATIONSHIPS_FILENAME)
  );

  if (!hasIntelligence) {
    return {
      status: 'stale',
      confidence: 'low',
      action: 'served',
      reason: 'Intelligence artifact missing'
    };
  }

  return {
    status: 'ready',
    confidence: hasRelationships ? 'high' : 'low',
    action: 'served',
    ...(hasRelationships ? {} : { reason: 'Relationships artifact missing' })
  };
}

export async function generateCodebaseIntelligence(project: ProjectState): Promise<string> {
  const intelligencePath = project.paths.intelligence;
  const index = await readIndexSignal(project);

  try {
    const content = await fs.readFile(intelligencePath, 'utf-8');
    const intelligence = JSON.parse(content) as IntelligenceData;

    const lines: string[] = [];
    lines.push('# Codebase Intelligence');
    lines.push('');
    lines.push(
      `Index: ${index.status} (${index.confidence}, ${index.action})${
        index.reason ? ` - ${index.reason}` : ''
      }`
    );
    lines.push('');
    lines.push('WARNING: This is what YOUR codebase actually uses, not generic recommendations.');
    lines.push('These are FACTS from analyzing your code, not best practices from the internet.');
    lines.push('');

    const libraryEntries = Object.entries(intelligence.libraryUsage || {})
      .map(([lib, data]) => ({
        lib,
        count: data.count
      }))
      .sort((a, b) => b.count - a.count);

    if (libraryEntries.length > 0) {
      lines.push('## Libraries Actually Used (Top 15)');
      lines.push('');

      for (const { lib, count } of libraryEntries.slice(0, 15)) {
        lines.push(`- **${lib}** (${count} uses)`);
      }
      lines.push('');
    }

    if (intelligence.tsconfigPaths && Object.keys(intelligence.tsconfigPaths).length > 0) {
      lines.push('## Import Aliases (from tsconfig.json)');
      lines.push('');
      lines.push('These path aliases map to internal project code:');
      for (const [alias, paths] of Object.entries(intelligence.tsconfigPaths)) {
        lines.push(`- \`${alias}\` -> ${(paths as string[]).join(', ')}`);
      }
      lines.push('');
    }

    if (intelligence.patterns && Object.keys(intelligence.patterns).length > 0) {
      const patterns: PatternsData = intelligence.patterns;
      lines.push("## YOUR Codebase's Actual Patterns (Not Generic Best Practices)");
      lines.push('');
      lines.push('These patterns were detected by analyzing your actual code.');
      lines.push('This is what YOUR team does in practice, not what tutorials recommend.');
      lines.push('');

      for (const [category, data] of Object.entries(patterns)) {
        if (shouldSkipLegacyTestingFrameworkCategory(category, patterns)) {
          continue;
        }

        const primary: PatternCandidate | undefined = data.primary;
        const alternatives: PatternCandidate[] = data.alsoDetected ?? [];

        if (!primary) continue;

        if (
          isComplementaryPatternCategory(
            category,
            [primary.name, ...alternatives.map((alt) => alt.name)].filter(Boolean)
          )
        ) {
          const secondary = alternatives[0];
          if (secondary) {
            const categoryName = category
              .replace(/([A-Z])/g, ' $1')
              .trim()
              .replace(/^./, (str: string) => str.toUpperCase());
            lines.push(
              `### ${categoryName}: **${primary.name}** (${primary.frequency}) + **${secondary.name}** (${secondary.frequency})`
            );
            lines.push(
              '   -> Computed and effect are complementary Signals primitives and are commonly used together.'
            );
            lines.push('   -> Treat this as balanced usage, not a hard split decision.');
            lines.push('');
            continue;
          }
        }

        const percentage = Number.parseInt(primary.frequency, 10);
        const categoryName = category
          .replace(/([A-Z])/g, ' $1')
          .trim()
          .replace(/^./, (str: string) => str.toUpperCase());

        if (percentage === 100) {
          lines.push(`### ${categoryName}: **${primary.name}** (${primary.frequency} - unanimous)`);
          lines.push(`   -> Your codebase is 100% consistent - ALWAYS use ${primary.name}`);
        } else if (percentage >= 80) {
          lines.push(
            `### ${categoryName}: **${primary.name}** (${primary.frequency} - strong consensus)`
          );
          lines.push(`   -> Your team strongly prefers ${primary.name}`);
          if (alternatives.length) {
            const alt = alternatives[0];
            lines.push(
              `   -> Minority pattern: ${alt.name} (${alt.frequency}) - avoid for new code`
            );
          }
        } else if (percentage >= 60) {
          lines.push(`### ${categoryName}: **${primary.name}** (${primary.frequency} - majority)`);
          lines.push(`   -> Most code uses ${primary.name}, but not unanimous`);
          if (alternatives.length) {
            lines.push(
              `   -> Also detected: ${alternatives[0].name} (${alternatives[0].frequency})`
            );
          }
        } else {
          lines.push(`### ${categoryName}: WARNING: NO TEAM CONSENSUS`);
          lines.push('   Your codebase is split between multiple approaches:');
          lines.push(`   - ${primary.name} (${primary.frequency})`);
          if (alternatives.length) {
            for (const alt of alternatives.slice(0, 2)) {
              lines.push(`   - ${alt.name} (${alt.frequency})`);
            }
          }
          lines.push('   -> ASK the team which approach to use for new features');
        }
        lines.push('');
      }
    }

    lines.push('---');
    lines.push(`Generated: ${intelligence.generatedAt || new Date().toISOString()}`);

    return lines.join('\n');
  } catch (error) {
    return (
      '# Codebase Intelligence\n\n' +
      'Intelligence data not yet generated. Run indexing first.\n' +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
