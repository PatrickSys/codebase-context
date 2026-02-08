import { describe, it, expect } from 'vitest';
import { normalizeMemory, normalizeMemories, filterMemories } from '../src/memory/store.js';

describe('Failure memory type', () => {
  it('normalizes a failure memory', () => {
    const raw = {
      id: 'fail001',
      type: 'failure',
      category: 'architecture',
      memory: 'Tried direct PrimeNG usage, broke wrapper abstraction',
      reason: 'Team uses @company/ui-toolkit wrapper',
      date: '2026-02-01T00:00:00.000Z',
      source: 'user'
    };

    const result = normalizeMemory(raw);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('failure');
    expect(result!.memory).toContain('PrimeNG');
  });

  it('failure type is filterable', () => {
    const memories = normalizeMemories([
      {
        id: '1',
        type: 'convention',
        category: 'conventions',
        memory: 'Use inject()',
        reason: 'Team standard',
        date: '2026-01-01T00:00:00.000Z'
      },
      {
        id: '2',
        type: 'failure',
        category: 'architecture',
        memory: 'Direct HTTP calls failed',
        reason: 'Must use ApiService wrapper',
        date: '2026-01-15T00:00:00.000Z'
      },
      {
        id: '3',
        type: 'gotcha',
        category: 'testing',
        memory: 'Jest timer mocks break signals',
        reason: 'Use fakeAsync instead',
        date: '2026-01-20T00:00:00.000Z'
      }
    ]);

    const failures = filterMemories(memories, { type: 'failure' });
    expect(failures).toHaveLength(1);
    expect(failures[0].id).toBe('2');
  });

  it('normalizes git-sourced memory with source field', () => {
    const raw = {
      id: 'git001',
      type: 'decision',
      category: 'architecture',
      memory: 'refactor: migrate auth to standalone components',
      reason: 'Auto-extracted from git commit history',
      date: '2026-02-05T00:00:00.000Z',
      source: 'git'
    };

    const result = normalizeMemory(raw);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('git');
  });

  it('omits source field when not git', () => {
    const raw = {
      id: 'user001',
      type: 'convention',
      category: 'conventions',
      memory: 'Use CSS variables for theming',
      reason: 'Design system consistency',
      date: '2026-02-05T00:00:00.000Z'
    };

    const result = normalizeMemory(raw);
    expect(result).not.toBeNull();
    expect(result!.source).toBeUndefined();
  });
});
