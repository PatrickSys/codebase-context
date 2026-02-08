import { describe, it, expect } from 'vitest';
import { parseGitLogLineToMemory, parseGitLogToMemories } from '../src/memory/git-memory.js';

describe('Git memory extraction pipeline', () => {
  it('extracts memory from a valid refactor commit with commit timestamp', () => {
    const line = '2026-02-01T10:20:30+00:00\tabc1234 refactor(auth): extract login state machine';

    const parsed = parseGitLogLineToMemory(line);

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      type: 'decision',
      category: 'architecture',
      memory: 'refactor(auth): extract login state machine',
      reason: 'Auto-extracted from git commit history',
      date: '2026-02-01T10:20:30.000Z',
      source: 'git'
    });
    expect(parsed!.id).toHaveLength(12);
  });

  it('extracts memory from fix and migrate commit types', () => {
    const fix = parseGitLogLineToMemory(
      '2026-02-02T10:20:30+00:00\tdef5678 fix(api): add null guard for profile cache'
    );
    const migrate = parseGitLogLineToMemory(
      '2026-02-03T10:20:30+00:00\t0123abc migrate: move websocket client to shared transport'
    );

    expect(fix).toMatchObject({ type: 'gotcha', category: 'conventions' });
    expect(migrate).toMatchObject({ type: 'decision', category: 'dependencies' });
  });

  it('rejects unsupported commit prefixes', () => {
    const parsed = parseGitLogLineToMemory(
      '2026-02-04T10:20:30+00:00\tabc1234 feat: add new dashboard widget'
    );
    expect(parsed).toBeNull();
  });

  it('rejects invalid commit dates instead of using current time', () => {
    const parsed = parseGitLogLineToMemory(
      'not-a-date\tabc1234 refactor: simplify settings loader'
    );
    expect(parsed).toBeNull();
  });

  it('rejects trivially short commit messages', () => {
    const parsed = parseGitLogLineToMemory('2026-02-05T10:20:30+00:00\tabc1234 fix: x');
    expect(parsed).toBeNull();
  });

  it('extracts multiple memories from git log text', () => {
    const log = [
      '2026-02-05T10:20:30+00:00\tabc1234 refactor: split auth adapter',
      '2026-02-05T10:21:30+00:00\tdef5678 docs: update readme',
      '2026-02-05T10:22:30+00:00\t9876abc fix(cache): guard stale token path'
    ].join('\n');

    const parsed = parseGitLogToMemories(log);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('decision');
    expect(parsed[1].type).toBe('gotcha');
  });
});
