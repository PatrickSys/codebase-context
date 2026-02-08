/**
 * Git Date Utility
 * Extracts file commit dates from git history for pattern momentum analysis
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const commitDateCache = new Map<string, Map<string, Date>>();

function normalizeRootPath(rootPath: string): string {
  return rootPath.replace(/\\/g, '/').toLowerCase();
}

export function clearFileCommitDatesCache(rootPath?: string): void {
  if (rootPath) {
    commitDateCache.delete(normalizeRootPath(rootPath));
    return;
  }

  commitDateCache.clear();
}

/**
 * Get the last commit date for each file in the repository.
 * Uses a single git command to efficiently extract all file dates.
 *
 * @param rootPath - Root path of the git repository
 * @returns Map of relative file paths to their last commit date
 */
export async function getFileCommitDates(rootPath: string): Promise<Map<string, Date>> {
  const cacheKey = normalizeRootPath(rootPath);
  const cached = commitDateCache.get(cacheKey);
  if (cached) {
    if (process.env.CODEBASE_CONTEXT_DEBUG) {
      console.error(`[git-dates] Cache hit for ${cacheKey}`);
    }
    return new Map(cached);
  }

  const fileDates = new Map<string, Date>();

  try {
    // Single git command to get all file dates
    // Format: ":::ISO_DATE" followed by affected files on new lines
    const { stdout } = await execAsync('git log --format=":::%cd" --name-only --date=iso-strict', {
      cwd: rootPath,
      maxBuffer: 50 * 1024 * 1024 // 50MB buffer for large repos
    });

    let currentDate: Date | null = null;

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();

      if (!trimmed) continue;

      if (trimmed.startsWith(':::')) {
        // New commit date marker
        const dateStr = trimmed.slice(3);
        currentDate = new Date(dateStr);
      } else if (currentDate) {
        // File path - only store if we don't already have a date (first occurrence = most recent)
        const normalizedPath = trimmed.replace(/\\/g, '/');
        if (!fileDates.has(normalizedPath)) {
          fileDates.set(normalizedPath, currentDate);
        }
      }
    }

    console.error(`[git-dates] Loaded commit dates for ${fileDates.size} files`);
  } catch (error) {
    // Not a git repo or git not available - graceful fallback
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('not a git repository') || message.includes('ENOENT')) {
      console.error('[git-dates] Not a git repository, skipping temporal analysis');
    } else {
      console.error(`[git-dates] Failed to get git dates: ${message}`);
    }
  }

  commitDateCache.set(cacheKey, new Map(fileDates));
  return fileDates;
}

/**
 * Calculate pattern trend based on file date.
 *
 * @param newestDate - The most recent file date using this pattern
 * @returns Trend classification
 */
export function calculateTrend(
  newestDate: Date | undefined
): 'Rising' | 'Declining' | 'Stable' | undefined {
  if (!newestDate) return undefined;

  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - newestDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff <= 60) return 'Rising';
  if (daysDiff >= 180) return 'Declining';
  return 'Stable';
}
