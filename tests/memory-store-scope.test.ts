import { describe, expect, it } from 'vitest';
import {
  buildMemoryIdentityParts,
  normalizeMemory,
  normalizeMemoryScope
} from '../src/memory/store.js';

describe('memory scope normalization', () => {
  it('normalizes file and symbol scopes to forward-slash paths', () => {
    expect(normalizeMemoryScope({ kind: 'file', file: '.\\src\\auth\\auth.service.ts' })).toEqual({
      kind: 'file',
      file: 'src/auth/auth.service.ts'
    });

    expect(
      normalizeMemoryScope({
        kind: 'symbol',
        file: '.\\src\\auth\\auth.service.ts',
        symbol: 'AuthService'
      })
    ).toEqual({
      kind: 'symbol',
      file: 'src/auth/auth.service.ts',
      symbol: 'AuthService'
    });
  });

  it('keeps scoped and global memories distinct in identity hashing inputs', () => {
    const base = {
      type: 'decision' as const,
      category: 'architecture' as const,
      memory: 'Use AuthService for token reads',
      reason: 'Direct token reads bypass refresh behavior.'
    };

    expect(buildMemoryIdentityParts(base)).not.toBe(
      buildMemoryIdentityParts({
        ...base,
        scope: { kind: 'file', file: 'src/auth/auth.service.ts' }
      })
    );
  });

  it('parses scoped memories from raw JSON payloads', () => {
    const normalized = normalizeMemory({
      id: 'abc123def456',
      type: 'gotcha',
      category: 'architecture',
      memory: 'Avoid direct token reads',
      reason: 'They skip refresh logic.',
      date: '2026-04-17T00:00:00.000Z',
      scope: {
        kind: 'symbol',
        file: 'src/auth/auth.service.ts',
        symbol: 'AuthService'
      }
    });

    expect(normalized?.scope).toEqual({
      kind: 'symbol',
      file: 'src/auth/auth.service.ts',
      symbol: 'AuthService'
    });
  });
});
