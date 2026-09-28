import { describe, expect, it } from 'vitest';
import { GenericAnalyzer } from '../src/analyzers/generic/index';
import { extractTreeSitterSymbols, supportsTreeSitter } from '../src/utils/tree-sitter';

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

  it('exposes declaration identity ranges separately from export wrapper ranges', async () => {
    const source = [
      "@Component({ selector: 'app-checkout' })",
      'export class CheckoutComponent {}',
      'export class CheckoutComponent {}'
    ].join('\n');

    const extracted = await extractTreeSitterSymbols(source, 'typescript');
    const declarations = extracted!.symbols.filter((symbol) => symbol.name === 'CheckoutComponent');
    const occurrences = extracted!.occurrences.filter(
      (symbol) => symbol.name === 'CheckoutComponent'
    );

    expect(declarations).toHaveLength(2);
    expect(occurrences).toHaveLength(2);
    expect(declarations.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([
      [1, 2],
      [3, 3]
    ]);
    expect(
      declarations.map(({ declarationStartLine, declarationEndLine }) => [
        declarationStartLine,
        declarationEndLine
      ])
    ).toEqual([
      [2, 2],
      [3, 3]
    ]);
  });

  it('preserves same-line declaration occurrences and identifies unresolved local bindings', async () => {
    const duplicates = await extractTreeSitterSymbols(
      'export class CartComponent {} export class CartComponent {}',
      'typescript'
    );
    const repeated = duplicates!.occurrences.filter((symbol) => symbol.name === 'CartComponent');

    expect(repeated).toHaveLength(2);
    expect(repeated[0]?.declarationStartLine).toBe(repeated[1]?.declarationStartLine);
    expect(repeated[0]?.declarationStartIndex).not.toBe(repeated[1]?.declarationStartIndex);
    expect(duplicates!.symbols.filter((symbol) => symbol.name === 'CartComponent')).toHaveLength(1);

    const bindings = await extractTreeSitterSymbols(
      [
        "import DefaultThing, { Component as Cmp, Injectable } from '@angular/core';",
        "import * as helpers from './helpers';",
        'const localValue = 1;',
        'export class CheckoutComponent {}'
      ].join('\n'),
      'typescript'
    );
    expect(bindings!.coverageComplete).toBe(true);
    expect(bindings!.unresolvedBindings).toEqual(
      expect.arrayContaining(['DefaultThing', 'Cmp', 'Injectable', 'helpers', 'localValue'])
    );

    const unclassified = await extractTreeSitterSymbols(
      'const { BoundComponent } = values; export class BoundComponent {}',
      'typescript'
    );
    expect(unclassified!.coverageComplete).toBe(false);
  });

  it('collects parameter, catch, and destructured parameter bindings', async () => {
    const extracted = await extractTreeSitterSymbols(
      [
        'function handle(Foo: unknown, { NestedComponent }: Options, [ArrayComponent]: Items) {}',
        'const callback = (ArrowComponent: unknown) => ArrowComponent;',
        'const bareCallback = BareArrowComponent => BareArrowComponent;',
        'try { run(); } catch ({ CaughtComponent }) { recover(CaughtComponent); }',
        'export class Foo {}',
        'export class NestedComponent {}',
        'export class ArrayComponent {}',
        'export class ArrowComponent {}',
        'export class BareArrowComponent {}',
        'export class CaughtComponent {}'
      ].join('\n'),
      'typescript'
    );

    expect(extracted?.coverageComplete).toBe(true);
    expect(extracted?.unresolvedBindings).toEqual(
      expect.arrayContaining([
        'Foo',
        'NestedComponent',
        'ArrayComponent',
        'ArrowComponent',
        'BareArrowComponent',
        'CaughtComponent'
      ])
    );
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
});
