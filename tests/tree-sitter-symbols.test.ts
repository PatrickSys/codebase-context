import { describe, expect, it } from 'vitest';
import { GenericAnalyzer } from '../src/analyzers/generic/index';
import {
  extractTreeSitterSymbols,
  findIdentifierOccurrences,
  supportsTreeSitter
} from '../src/utils/tree-sitter';

describe('Tree-sitter symbol extraction', () => {
  it('extracts TypeScript symbols including function variables', async () => {
    const source = [
      'export class UserService {',
      '  getUser(id: string) {',
      '    return id;',
      '  }',
      '}',
      '',
      'export const computeScore = (value: number) => value * 2;',
      'export type User = { id: string };'
    ].join('\n');

    const extracted = await extractTreeSitterSymbols(source, 'typescript');

    expect(extracted).not.toBeNull();
    const names = extracted!.symbols.map((s) => s.name);

    expect(names).toContain('UserService');
    expect(names).toContain('getUser');
    expect(names).toContain('computeScore');
    expect(names).toContain('User');
  });

  it('uses symbol boundaries for python chunks in generic analyzer', async () => {
    const analyzer = new GenericAnalyzer();
    const source = [
      'class Greeter:',
      '    def hello(self):',
      '        return "hi"',
      '',
      'def top_level(value):',
      '    return value + 1'
    ].join('\n');

    const result = await analyzer.analyze('/virtual/sample.py', source);

    expect(result.metadata.chunkStrategy).toBe('ast-aligned');

    // AST-aligned chunking splits containers into children: Greeter's child
    // 'hello' appears as its own chunk with parentSymbol='Greeter'
    const helloChunk = result.chunks.find((chunk) => chunk.metadata.componentName === 'hello');
    expect(helloChunk).toBeDefined();
    expect(helloChunk!.content).toContain('def hello');
    expect(helloChunk!.content).not.toContain('def top_level');
    expect((helloChunk!.metadata as Record<string, unknown>).parentSymbol).toBe('Greeter');

    const topLevelChunk = result.chunks.find(
      (chunk) => chunk.metadata.componentName === 'top_level'
    );
    expect(topLevelChunk).toBeDefined();
    expect(topLevelChunk!.content).toContain('def top_level');
  });

  it('falls back when python parse tree has errors', async () => {
    const analyzer = new GenericAnalyzer();
    const source = [
      'class Greeter:',
      '    def hello(self):',
      '        return \\"hi\\"',
      '',
      'def top_level(value):',
      '    return value + 1'
    ].join('\n');

    const extracted = await extractTreeSitterSymbols(source, 'python');
    expect(extracted).toBeNull();

    const result = await analyzer.analyze('/virtual/sample.py', source);
    expect(result.metadata.chunkStrategy).toBe('line-or-component');

    const componentNames = result.chunks.map((chunk) => chunk.metadata.componentName);
    expect(componentNames).toEqual(expect.arrayContaining(['Greeter', 'hello', 'top_level']));
  });

  it('reports unsupported language grammars', () => {
    expect(supportsTreeSitter('markdown')).toBe(false);
  });

  it('matches complete dollar, underscore, and Unicode identifiers in parsed code', async () => {
    const source = [
      'const alpha = $alpha;',
      'const alphaSuffix = 1;',
      'const _alpha = 2;',
      'const προβολή = alpha;',
      '// alpha and $alpha are comments',
      'const message = "alpha $alpha";'
    ].join('\n');

    const alpha = await findIdentifierOccurrences(source, 'typescript', 'alpha');
    const dollar = await findIdentifierOccurrences(source, 'typescript', '$alpha');
    const unicode = await findIdentifierOccurrences(source, 'typescript', 'προβολή');

    expect(alpha?.map((occurrence) => occurrence.line)).toEqual([1, 4]);
    expect(dollar?.map((occurrence) => occurrence.line)).toEqual([1]);
    expect(unicode?.map((occurrence) => occurrence.line)).toEqual([4]);
  });
});
