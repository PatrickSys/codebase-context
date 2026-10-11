import { describe, it, expect, vi } from 'vitest';
import { analyzerRegistry, AnalyzerRegistry } from '../src/core/analyzer-registry';
import { AngularAnalyzer } from '../src/analyzers/angular/index';
import { NextJsAnalyzer } from '../src/analyzers/nextjs/index';
import { NestJsAnalyzer } from '../src/analyzers/nestjs/index';
import { ReactAnalyzer } from '../src/analyzers/react/index';
import { GenericAnalyzer } from '../src/analyzers/generic/index';

// Register default analyzers
analyzerRegistry.register(new AngularAnalyzer());
analyzerRegistry.register(new NextJsAnalyzer());
analyzerRegistry.register(new NestJsAnalyzer());
analyzerRegistry.register(new ReactAnalyzer());
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

    it('should include default analyzers (Angular, Next.js, NestJS, React, Generic)', () => {
      const analyzers = analyzerRegistry.getAll();
      const names = analyzers.map((a) => a.name);

      expect(names).toContain('angular');
      expect(names).toContain('nextjs');
      expect(names).toContain('nestjs');
      expect(names).toContain('react');
      expect(names).toContain('generic');
    });
  });

  describe('get', () => {
    it('should return analyzer by name', () => {
      const angular = analyzerRegistry.get('angular');
      expect(angular).toBeDefined();
      expect(angular?.name).toBe('angular');
    });

    it('should return nextjs, nestjs, and react analyzers by name', () => {
      expect(analyzerRegistry.get('nextjs')?.name).toBe('nextjs');
      expect(analyzerRegistry.get('nestjs')?.name).toBe('nestjs');
      expect(analyzerRegistry.get('react')?.name).toBe('react');
    });

    it('should return undefined for unknown analyzer', () => {
      const unknown = analyzerRegistry.get('unknown-analyzer');
      expect(unknown).toBeUndefined();
    });
  });

  describe('priority ordering', () => {
    it('should have Angular higher priority than Generic', () => {
      const angular = analyzerRegistry.get('angular');
      const nextjs = analyzerRegistry.get('nextjs');
      const nestjs = analyzerRegistry.get('nestjs');
      const react = analyzerRegistry.get('react');
      const generic = analyzerRegistry.get('generic');

      expect(angular).toBeDefined();
      expect(nextjs).toBeDefined();
      expect(nestjs).toBeDefined();
      expect(react).toBeDefined();
      expect(generic).toBeDefined();
      expect(angular!.priority).toBeGreaterThan(generic!.priority);
      expect(nestjs!.priority).toBeGreaterThan(angular!.priority);
      expect(nestjs!.priority).toBeGreaterThan(react!.priority);
      expect(nextjs!.priority).toBeGreaterThan(react!.priority);
      expect(react!.priority).toBeGreaterThan(generic!.priority);
    });

    it('should prefer NestJS when framework decorators overlap with Angular', () => {
      const content = `
import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentsService {}
`;

      expect(
        analyzerRegistry.findAllAnalyzers('/tmp/payments.service.ts', content).map((a) => a.name)
      ).toEqual(['nestjs', 'angular', 'generic']);
      expect(analyzerRegistry.findAnalyzer('/tmp/payments.service.ts', content)?.name).toBe(
        'nestjs'
      );
    });

    it('selects Generic for plain TypeScript generics and retains symbol-aware definitions', async () => {
      const source = `
interface ProjectConfiguration { targets?: Record<string, unknown> }
const map = new Map<string, ProjectConfiguration>();

export function readTargetDefaultsForTarget(
  project: ProjectConfiguration,
  targetName: string
) {
  return map.get(targetName) ?? project.targets?.[targetName];
}
`;

      expect(analyzerRegistry.findAnalyzer('/tmp/target-defaults.ts', source)?.name).toBe(
        'generic'
      );
      const result = await analyzerRegistry.analyzeFile('/tmp/target-defaults.ts', source);

      expect(result?.metadata.analyzer).toBe('generic');
      expect(
        result?.chunks.some(
          (chunk) =>
            chunk.metadata.symbolName === 'readTargetDefaultsForTarget' &&
            chunk.metadata.symbolAware === true
        )
      ).toBe(true);
    });

    it('preserves quoted names in TypeScript imports and exports', async () => {
      const source = `import { "remote-name" as localName } from 'some-package';
export { localName as "public-name" };`;
      const result = await new GenericAnalyzer().analyze('/tmp/quoted-names.ts', source);

      expect(result.imports).toMatchObject([{ source: 'some-package', imports: ['remote-name'] }]);
      expect(result.exports).toContainEqual({
        name: 'public-name',
        isDefault: false,
        type: 'named'
      });

      const angularResult = await new AngularAnalyzer().analyze('/tmp/quoted-names.ts', source);
      expect(angularResult.imports).toMatchObject([
        { source: 'some-package', imports: ['remote-name'] }
      ]);
    });
  });
});
