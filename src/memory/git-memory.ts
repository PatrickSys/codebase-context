import { createHash } from 'crypto';
import { GIT_COMMIT_PATTERNS } from '../constants/git-patterns.js';
import type { Memory } from '../types/index.js';

const MIN_COMMIT_MESSAGE_LENGTH = 10;

/**
 * Parse one git log line in format:
 *   <iso-date>\t<short-hash> <subject>
 * Returns a normalized Memory when the subject matches supported commit patterns.
 */
export function parseGitLogLineToMemory(line: string): Memory | null {
  const tabIdx = line.indexOf('\t');
  if (tabIdx === -1) return null;

  const commitDateRaw = line.substring(0, tabIdx).trim();
  const hashAndSubject = line.substring(tabIdx + 1).trim();
  if (!commitDateRaw || !hashAndSubject) return null;

  const commitMs = Date.parse(commitDateRaw);
  if (!Number.isFinite(commitMs)) return null;

  for (const pattern of GIT_COMMIT_PATTERNS) {
    if (!pattern.prefix.test(hashAndSubject)) continue;

    const message = hashAndSubject.replace(/^[a-f0-9]+ /i, '').trim();
    if (message.length < MIN_COMMIT_MESSAGE_LENGTH) return null;

    const hashContent = `git:${pattern.type}:${pattern.category}:${message}`;
    const id = createHash('sha256').update(hashContent).digest('hex').substring(0, 12);

    return {
      id,
      type: pattern.type,
      category: pattern.category,
      memory: message,
      reason: 'Auto-extracted from git commit history',
      date: new Date(commitMs).toISOString(),
      source: 'git'
    };
  }

  return null;
}

export function parseGitLogToMemories(log: string): Memory[] {
  if (!log.trim()) return [];

  const memories: Memory[] = [];
  for (const line of log.split('\n')) {
    const parsed = parseGitLogLineToMemory(line);
    if (parsed) memories.push(parsed);
  }
  return memories;
}
