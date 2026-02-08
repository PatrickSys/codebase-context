import { describe, it, expect, vi } from 'vitest';
import { analyzerRegistry, AnalyzerRegistry } from '../src/core/analyzer-registry';
import { AngularAnalyzer } from '../src/analyzers/angular/index';
import { GenericAnalyzer } from '../src/analyzers/generic/index';

// Register default analyzers
analyzerRegistry.register(new AngularAnalyzer());
analyzerRegistry.register(new GenericAnalyzer());

describe('AnalyzerRegistry', () => {
  describe('missing analyzer logging', () => {
    it('should stay quiet by default when no analyzer matches', async () => {
      const registry = new AnalyzerRegistry();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const priorDebug = process.env.CODEBASE_CONTEXT_DEBUG;
      delete process.env.CODEBASE_CONTEXT_DEBUG;

      try {
        const result = await registry.analyzeFile('file.unknown', 'content');
        expect(result).toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        if (priorDebug === undefined) {
          delete process.env.CODEBASE_CONTEXT_DEBUG;
        } else {
          process.env.CODEBASE_CONTEXT_DEBUG = priorDebug;
        }
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });

  describe('getAll', () => {
    it('should return analyzers sorted by priority (highest first)', () => {
      const analyzers = analyzerRegistry.getAll();

      for (let i = 1; i < analyzers.length; i++) {
        expect(analyzers[i - 1].priority).toBeGreaterThanOrEqual(analyzers[i].priority);
      }
    });

    it('should include default analyzers (Angular, Generic)', () => {
      const analyzers = analyzerRegistry.getAll();
      const names = analyzers.map((a) => a.name);

      expect(names).toContain('angular');
      expect(names).toContain('generic');
    });
  });

  describe('get', () => {
    it('should return analyzer by name', () => {
      const angular = analyzerRegistry.get('angular');
      expect(angular).toBeDefined();
      expect(angular?.name).toBe('angular');
    });

    it('should return undefined for unknown analyzer', () => {
      const unknown = analyzerRegistry.get('unknown-analyzer');
      expect(unknown).toBeUndefined();
    });
  });

  describe('priority ordering', () => {
    it('should have Angular higher priority than Generic', () => {
      const angular = analyzerRegistry.get('angular');
      const generic = analyzerRegistry.get('generic');

      expect(angular).toBeDefined();
      expect(generic).toBeDefined();
      expect(angular!.priority).toBeGreaterThan(generic!.priority);
    });
  });
});
