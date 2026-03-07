import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'path';
import {
  makePaths,
  normalizeRootKey,
  getProject,
  getOrCreateProject,
  removeProject,
  clearProjects
} from '../src/project-state.js';
import { CODEBASE_CONTEXT_DIRNAME } from '../src/constants/codebase-context.js';

describe('project-state', () => {
  afterEach(() => {
    clearProjects();
    vi.restoreAllMocks();
  });

  describe('makePaths', () => {
    it('produces correct paths from rootPath', () => {
      const rootPath = '/projects/my-app';
      const paths = makePaths(rootPath);

      expect(paths.baseDir).toBe(path.join(rootPath, CODEBASE_CONTEXT_DIRNAME));
      expect(paths.memory).toContain('memory.json');
      expect(paths.intelligence).toContain('intelligence.json');
      expect(paths.keywordIndex).toContain('index.json');
      expect(paths.vectorDb).toContain('index');
    });
  });

  describe('normalizeRootKey', () => {
    it('strips trailing separators', () => {
      const key1 = normalizeRootKey('/projects/my-app/');
      const key2 = normalizeRootKey('/projects/my-app');
      expect(key1).toBe(key2);
    });

    it('resolves relative paths', () => {
      const key = normalizeRootKey('./foo');
      expect(path.isAbsolute(key)).toBe(true);
    });

    it('lowercases on Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        const key = normalizeRootKey('/Projects/MyApp');
        expect(key).toBe(key.toLowerCase());
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });
  });

  describe('getOrCreateProject', () => {
    it('returns same instance for same path', () => {
      const p1 = getOrCreateProject('/projects/my-app');
      const p2 = getOrCreateProject('/projects/my-app');
      expect(p1).toBe(p2);
    });

    it('returns same instance for path with trailing separator', () => {
      const p1 = getOrCreateProject('/projects/my-app');
      const p2 = getOrCreateProject('/projects/my-app/');
      expect(p1).toBe(p2);
    });

    it('returns different instances for different paths', () => {
      const p1 = getOrCreateProject('/projects/app-a');
      const p2 = getOrCreateProject('/projects/app-b');
      expect(p1).not.toBe(p2);
    });

    it('creates project with idle status', () => {
      const p = getOrCreateProject('/projects/my-app');
      expect(p.indexState.status).toBe('idle');
    });

    it('getProject returns undefined before creation and instance after creation', () => {
      expect(getProject('/projects/my-app')).toBeUndefined();
      const created = getOrCreateProject('/projects/my-app');
      expect(getProject('/projects/my-app')).toBe(created);
    });
  });

  describe('clearProjects', () => {
    it('empties the map', () => {
      getOrCreateProject('/projects/app-a');
      getOrCreateProject('/projects/app-b');
      clearProjects();

      // After clearing, getOrCreateProject should return a fresh instance
      const p = getOrCreateProject('/projects/app-a');
      expect(p.indexState.status).toBe('idle');
    });

    it('calls stopWatcher on projects with watchers', () => {
      const p = getOrCreateProject('/projects/my-app');
      const stopSpy = vi.fn();
      p.stopWatcher = stopSpy;

      clearProjects();
      expect(stopSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeProject', () => {
    it('removes a project and stops its watcher', () => {
      const project = getOrCreateProject('/projects/my-app');
      const stopSpy = vi.fn();
      project.stopWatcher = stopSpy;

      removeProject('/projects/my-app');

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(getProject('/projects/my-app')).toBeUndefined();
    });
  });
});
