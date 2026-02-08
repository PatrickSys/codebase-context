import { describe, it, expect } from 'vitest';
import type { Memory } from '../src/types/index.js';
import { computeConfidence, withConfidence } from '../src/memory/store.js';

function makeMemory(overrides: Partial<Memory> & { type: Memory['type']; date: string }): Memory {
  return {
    id: 'test123',
    category: 'conventions',
    memory: 'test memory',
    reason: 'test reason',
    ...overrides
  };
}

describe('Memory confidence decay', () => {
  const now = new Date('2026-02-07T00:00:00.000Z');

  it('convention type never decays', () => {
    const old = makeMemory({ type: 'convention', date: '2020-01-01T00:00:00.000Z' });
    const result = computeConfidence(old, now);
    expect(result.effectiveConfidence).toBe(1.0);
    expect(result.stale).toBe(false);
  });

  it('decision type has 180-day half-life', () => {
    // Exactly 180 days old = 50% confidence
    const d = new Date(now);
    d.setDate(d.getDate() - 180);
    const memory = makeMemory({ type: 'decision', date: d.toISOString() });
    const result = computeConfidence(memory, now);
    expect(result.effectiveConfidence).toBe(0.5);
    expect(result.stale).toBe(false);
  });

  it('gotcha type has 90-day half-life', () => {
    // Exactly 90 days old = 50% confidence
    const d = new Date(now);
    d.setDate(d.getDate() - 90);
    const memory = makeMemory({ type: 'gotcha', date: d.toISOString() });
    const result = computeConfidence(memory, now);
    expect(result.effectiveConfidence).toBe(0.5);
    expect(result.stale).toBe(false);
  });

  it('failure type has 90-day half-life', () => {
    const d = new Date(now);
    d.setDate(d.getDate() - 90);
    const memory = makeMemory({ type: 'failure', date: d.toISOString() });
    const result = computeConfidence(memory, now);
    expect(result.effectiveConfidence).toBe(0.5);
    expect(result.stale).toBe(false);
  });

  it('flags memory as stale below 0.3 confidence', () => {
    // ~170 days for gotcha (90-day half-life): 2^(-170/90) ≈ 0.26
    const d = new Date(now);
    d.setDate(d.getDate() - 170);
    const memory = makeMemory({ type: 'gotcha', date: d.toISOString() });
    const result = computeConfidence(memory, now);
    expect(result.effectiveConfidence).toBeLessThan(0.3);
    expect(result.stale).toBe(true);
  });

  it('brand new memory has full confidence', () => {
    const memory = makeMemory({ type: 'decision', date: now.toISOString() });
    const result = computeConfidence(memory, now);
    expect(result.effectiveConfidence).toBe(1.0);
    expect(result.stale).toBe(false);
  });

  it('handles invalid date gracefully', () => {
    const memory = makeMemory({ type: 'decision', date: 'not-a-date' });
    const result = computeConfidence(memory, now);
    expect(result.effectiveConfidence).toBe(0.5);
    expect(result.stale).toBe(false);
  });

  it('withConfidence enriches array of memories', () => {
    const memories: Memory[] = [
      makeMemory({ id: '1', type: 'convention', date: '2020-01-01T00:00:00.000Z' }),
      makeMemory({ id: '2', type: 'gotcha', date: now.toISOString() })
    ];

    const enriched = withConfidence(memories, now);
    expect(enriched).toHaveLength(2);
    expect(enriched[0].effectiveConfidence).toBe(1.0); // convention never decays
    expect(enriched[0].stale).toBe(false);
    expect(enriched[1].effectiveConfidence).toBe(1.0); // brand new
    expect(enriched[1].stale).toBe(false);
    // Verify original fields preserved
    expect(enriched[0].id).toBe('1');
    expect(enriched[1].type).toBe('gotcha');
  });
});
