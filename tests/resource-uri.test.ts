import { describe, it, expect } from 'vitest';
import {
  buildProjectContextResourceUri,
  buildProjectFullContextResourceUri,
  CONTEXT_RESOURCE_URI,
  FULL_CONTEXT_RESOURCE_URI,
  getProjectPathFromFullContextResourceUri,
  getProjectPathFromContextResourceUri,
  isFullContextResourceUri,
  isContextResourceUri,
  normalizeResourceUri
} from '../src/resources/uri.js';

describe('resource URI normalization', () => {
  it('accepts canonical resource URI', () => {
    expect(normalizeResourceUri(CONTEXT_RESOURCE_URI)).toBe(CONTEXT_RESOURCE_URI);
    expect(isContextResourceUri(CONTEXT_RESOURCE_URI)).toBe(true);
  });

  it('accepts canonical full resource URI', () => {
    expect(normalizeResourceUri(FULL_CONTEXT_RESOURCE_URI)).toBe(FULL_CONTEXT_RESOURCE_URI);
    expect(isFullContextResourceUri(FULL_CONTEXT_RESOURCE_URI)).toBe(true);
  });

  it('accepts namespaced resource URI from some MCP hosts', () => {
    const namespaced = `codebase-context/${CONTEXT_RESOURCE_URI}`;
    expect(normalizeResourceUri(namespaced)).toBe(CONTEXT_RESOURCE_URI);
    expect(isContextResourceUri(namespaced)).toBe(true);
  });

  it('accepts namespaced full resource URI from some MCP hosts', () => {
    const namespaced = `codebase-context/${FULL_CONTEXT_RESOURCE_URI}`;
    expect(normalizeResourceUri(namespaced)).toBe(FULL_CONTEXT_RESOURCE_URI);
    expect(isFullContextResourceUri(namespaced)).toBe(true);
  });

  it('round-trips project-scoped context URIs', () => {
    const projectPath = '/repo/apps/dashboard';
    const uri = buildProjectContextResourceUri(projectPath);
    expect(uri).toBe('codebase://context/project/%2Frepo%2Fapps%2Fdashboard');
    expect(getProjectPathFromContextResourceUri(uri)).toBe(projectPath);
    expect(getProjectPathFromContextResourceUri(`host/${uri}`)).toBe(projectPath);
  });

  it('round-trips project-scoped full context URIs', () => {
    const projectPath = '/repo/apps/dashboard';
    const uri = buildProjectFullContextResourceUri(projectPath);
    expect(uri).toBe('codebase://context/full/project/%2Frepo%2Fapps%2Fdashboard');
    expect(getProjectPathFromFullContextResourceUri(uri)).toBe(projectPath);
    expect(getProjectPathFromFullContextResourceUri(`host/${uri}`)).toBe(projectPath);
  });

  it('rejects unknown URIs', () => {
    expect(isContextResourceUri('codebase://other')).toBe(false);
    expect(isFullContextResourceUri('codebase://other')).toBe(false);
    expect(isContextResourceUri('other/codebase://other')).toBe(false);
    expect(getProjectPathFromContextResourceUri('codebase://other')).toBeUndefined();
    expect(getProjectPathFromFullContextResourceUri('codebase://other')).toBeUndefined();
  });
});
