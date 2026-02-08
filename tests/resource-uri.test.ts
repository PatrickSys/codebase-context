import { describe, it, expect } from 'vitest';
import {
  CONTEXT_RESOURCE_URI,
  isContextResourceUri,
  normalizeResourceUri
} from '../src/resources/uri.js';

describe('resource URI normalization', () => {
  it('accepts canonical resource URI', () => {
    expect(normalizeResourceUri(CONTEXT_RESOURCE_URI)).toBe(CONTEXT_RESOURCE_URI);
    expect(isContextResourceUri(CONTEXT_RESOURCE_URI)).toBe(true);
  });

  it('accepts namespaced resource URI from some MCP hosts', () => {
    const namespaced = `codebase-context/${CONTEXT_RESOURCE_URI}`;
    expect(normalizeResourceUri(namespaced)).toBe(CONTEXT_RESOURCE_URI);
    expect(isContextResourceUri(namespaced)).toBe(true);
  });

  it('rejects unknown URIs', () => {
    expect(isContextResourceUri('codebase://other')).toBe(false);
    expect(isContextResourceUri('other/codebase://other')).toBe(false);
  });
});
