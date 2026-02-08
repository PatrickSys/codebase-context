import type { MemoryType, MemoryCategory } from '../types/index.js';

export interface GitCommitPattern {
  prefix: RegExp;
  type: MemoryType;
  category: MemoryCategory;
}

/**
 * Conventional commit patterns that produce auto-extracted memories.
 * Shared between production (extractGitMemories) and tests.
 */
export const GIT_COMMIT_PATTERNS: GitCommitPattern[] = [
  { prefix: /^[a-f0-9]+ refactor[(!:]/i, type: 'decision', category: 'architecture' },
  { prefix: /^[a-f0-9]+ migrate[(!:]/i, type: 'decision', category: 'dependencies' },
  { prefix: /^[a-f0-9]+ fix[(!:]/i, type: 'gotcha', category: 'conventions' },
  { prefix: /^[a-f0-9]+ revert[(!:]/i, type: 'gotcha', category: 'architecture' }
];
