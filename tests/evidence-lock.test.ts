import { describe, it, expect } from 'vitest';
import type { SearchResult } from '../src/types/index.js';
import type { MemoryWithConfidence } from '../src/memory/store.js';
import { buildEvidenceLock } from '../src/preflight/evidence-lock.js';

function makeResult(filePath: string): SearchResult {
  return {
    summary: 'test summary',
    snippet: 'test snippet',
    filePath,
    startLine: 10,
    endLine: 20,
    score: 0.9,
    language: 'ts',
    metadata: {}
  };
}

function makeMemory(id: string, overrides?: Partial<MemoryWithConfidence>): MemoryWithConfidence {
  return {
    id,
    type: 'decision',
    category: 'architecture',
    memory: `memory ${id}`,
    reason: 'why',
    date: '2026-02-01T00:00:00.000Z',
    effectiveConfidence: 0.9,
    stale: false,
    ...overrides
  };
}

describe('Evidence lock preflight scoring', () => {
  it('passes when evidence is triangulated across code, patterns, and memories', () => {
    const lock = buildEvidenceLock({
      results: [makeResult('src/a.ts'), makeResult('src/b.ts'), makeResult('src/c.ts')],
      preferredPatterns: [
        { pattern: 'Use service wrapper', example: 'src/services/api.ts' },
        { pattern: 'Inject via constructor' }
      ],
      relatedMemories: [makeMemory('1'), makeMemory('2')],
      failureWarnings: []
    });

    expect(lock.status).toBe('pass');
    expect(lock.readyToEdit).toBe(true);
    expect(lock.score).toBeGreaterThanOrEqual(80);
    expect(lock.epistemicStress).toBeUndefined();
  });

  it('warns when evidence is partial but not empty', () => {
    const lock = buildEvidenceLock({
      results: [makeResult('src/a.ts')],
      preferredPatterns: [{ pattern: 'Use service wrapper' }],
      relatedMemories: [makeMemory('1', { stale: true })],
      failureWarnings: []
    });

    expect(lock.status).toBe('warn');
    expect(lock.readyToEdit).toBe(false);
    expect(lock.nextAction).toContain('golden file');
  });

  it('blocks when there are no code hits for the requested intent', () => {
    const lock = buildEvidenceLock({
      results: [],
      preferredPatterns: [{ pattern: 'Use service wrapper' }],
      relatedMemories: [makeMemory('1')],
      failureWarnings: [{ memory: 'Previous direct DB migration broke rollback path' }]
    });

    expect(lock.status).toBe('block');
    expect(lock.readyToEdit).toBe(false);
    expect(lock.gaps).toContain('No matching code hits for this intent');
    expect(lock.nextAction).toContain('refresh_index');
  });
});

describe('Epistemic stress detection', () => {
  it('flags stress from pattern conflicts', () => {
    const lock = buildEvidenceLock({
      results: [makeResult('src/a.ts'), makeResult('src/b.ts'), makeResult('src/c.ts')],
      preferredPatterns: [
        { pattern: 'inject()' },
        { pattern: 'signals' }
      ],
      relatedMemories: [makeMemory('1'), makeMemory('2')],
      failureWarnings: [],
      patternConflicts: [
        {
          category: 'dependency-injection',
          primary: { name: 'inject()', adoption: '65%' },
          alternative: { name: 'constructor injection', adoption: '35%' }
        }
      ]
    });

    expect(lock.epistemicStress).toBeDefined();
    expect(lock.epistemicStress!.triggers).toHaveLength(1);
    expect(lock.epistemicStress!.triggers[0]).toContain('Conflicting patterns');
    expect(lock.epistemicStress!.triggers[0]).toContain('dependency-injection');
  });

  it('flags stress when majority of memories are stale', () => {
    const lock = buildEvidenceLock({
      results: [makeResult('src/a.ts'), makeResult('src/b.ts'), makeResult('src/c.ts')],
      preferredPatterns: [{ pattern: 'inject()' }, { pattern: 'signals' }],
      relatedMemories: [
        makeMemory('1', { stale: true }),
        makeMemory('2', { stale: true }),
        makeMemory('3', { stale: false })
      ],
      failureWarnings: []
    });

    expect(lock.epistemicStress).toBeDefined();
    expect(lock.epistemicStress!.triggers.some((t) => t.includes('stale'))).toBe(true);
  });

  it('flags stress when most evidence sources are empty', () => {
    const lock = buildEvidenceLock({
      results: [makeResult('src/a.ts')],
      preferredPatterns: [],
      relatedMemories: [],
      failureWarnings: []
    });

    expect(lock.epistemicStress).toBeDefined();
    expect(lock.epistemicStress!.triggers.some((t) => t.includes('Insufficient evidence'))).toBe(true);
  });

  it('abstains and downgrades readyToEdit when stress is high', () => {
    const lock = buildEvidenceLock({
      results: [makeResult('src/a.ts'), makeResult('src/b.ts'), makeResult('src/c.ts')],
      preferredPatterns: [{ pattern: 'inject()' }, { pattern: 'signals' }],
      relatedMemories: [
        makeMemory('1', { stale: true }),
        makeMemory('2', { stale: true }),
        makeMemory('3', { stale: true }),
        makeMemory('4', { stale: false })
      ],
      failureWarnings: [],
      patternConflicts: [
        {
          category: 'di',
          primary: { name: 'inject()', adoption: '55%' },
          alternative: { name: 'constructor', adoption: '45%' }
        },
        {
          category: 'state',
          primary: { name: 'signals', adoption: '60%' },
          alternative: { name: 'rxjs', adoption: '40%' }
        }
      ]
    });

    expect(lock.epistemicStress).toBeDefined();
    expect(lock.epistemicStress!.level).toBe('high');
    expect(lock.epistemicStress!.abstain).toBe(true);
    expect(lock.readyToEdit).toBe(false);
  });

  it('does not flag stress when evidence is clean and consistent', () => {
    const lock = buildEvidenceLock({
      results: [makeResult('src/a.ts'), makeResult('src/b.ts'), makeResult('src/c.ts')],
      preferredPatterns: [
        { pattern: 'inject()' },
        { pattern: 'signals' }
      ],
      relatedMemories: [makeMemory('1'), makeMemory('2')],
      failureWarnings: [],
      patternConflicts: []
    });

    expect(lock.epistemicStress).toBeUndefined();
    expect(lock.status).toBe('pass');
    expect(lock.readyToEdit).toBe(true);
  });

  it('moderate stress with single conflict does not abstain when status is pass', () => {
    const lock = buildEvidenceLock({
      results: [makeResult('src/a.ts'), makeResult('src/b.ts'), makeResult('src/c.ts')],
      preferredPatterns: [{ pattern: 'inject()' }, { pattern: 'signals' }],
      relatedMemories: [makeMemory('1'), makeMemory('2')],
      failureWarnings: [],
      patternConflicts: [
        {
          category: 'di',
          primary: { name: 'inject()', adoption: '70%' },
          alternative: { name: 'constructor', adoption: '30%' }
        }
      ]
    });

    expect(lock.epistemicStress).toBeDefined();
    expect(lock.epistemicStress!.level).toBe('low');
    expect(lock.epistemicStress!.abstain).toBe(false);
    expect(lock.readyToEdit).toBe(true);
  });
});
