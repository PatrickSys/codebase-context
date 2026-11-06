import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve('eslint/package.json'));
const parentPath = eslintRequire.resolve('@eslint/eslintrc');
const parentRequire = createRequire(parentPath);
const yamlPath = parentRequire.resolve('js-yaml');
const yaml = z.object({
  load: z.custom<(text: string) => unknown>(value => typeof value === 'function'),
  loadAll: z.custom<(text: string) => unknown[]>(value => typeof value === 'function'),
  YAMLException: z.custom<typeof Error>(value => typeof value === 'function')
}).parse(parentRequire('js-yaml'));
const { Legacy } = z.object({
  Legacy: z.object({
    ConfigArrayFactory: z.custom<new () => {
      loadFile(file: string): Iterable<{ rules?: Record<string, unknown> }>;
    }>(value => typeof value === 'function')
  })
}).parse(eslintRequire('@eslint/eslintrc'));
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

function emptyMerges(targets: number, sources = 100): string {
  return `arr: &arr [${Array.from({ length: sources }, () => '{}').join(', ')}]\n` +
    `targets:\n${'  - { <<: *arr }\n'.repeat(targets)}`;
}

function mergeChain(count: number): string {
  const lines = ['a0: &a0 { k0: 0 }'];
  for (let i = 1; i < count; i++) {
    lines.push(`a${i}: &a${i} { <<: *a${i - 1}, k${i}: ${i} }`);
  }
  return `${lines.join('\n')}\nb: *a${count - 1}\n`;
}

function repeatedAliases(count: number): string {
  const keys = Array.from({ length: 100 }, (_, i) => `k${i}: ${i}`).join(', ');
  return `source: &source { ${keys} }\nresult: { <<: [${Array(count).fill('*source').join(', ')}], k0: 999 }\n`;
}

function expectYamlError(load: () => unknown, message: RegExp): void {
  expect(load).toThrow(yaml.YAMLException);
  expect(load).toThrow(message);
}

describe('js-yaml through the installed ESLint legacy config dependency', () => {
  it('resolves the actual ESLint -> eslintrc -> patched js-yaml chain', () => {
    const manifest = z.object({ version: z.string() });
    expect(manifest.parse(eslintRequire('./package.json')).version).toBe('9.39.3');
    expect(manifest.parse(eslintRequire('@eslint/eslintrc/package.json')).version).toBe('3.3.3');
    expect(manifest.parse(parentRequire('js-yaml/package.json')).version).toBe('4.3.2');
    expect(createRequire(parentPath).resolve('js-yaml')).toBe(yamlPath);
  });

  it('accepts exactly 10,000 empty-source merges under the default budget', () => {
    expect(yaml.load(emptyMerges(100))).toEqual({
      arr: Array.from({ length: 100 }, () => ({})),
      targets: Array.from({ length: 100 }, () => ({}))
    });
  });

  it('charges empty mappings across legal 100-source merge sequences', () => {
    expectYamlError(() => yaml.load(emptyMerges(101)), /merge keys exceeded maxTotalMergeKeys \(10000\)/);
  });

  it('bounds a growing merge chain with the default aggregate budget', () => {
    const control = z.object({ a9: z.record(z.string(), z.number()), b: z.record(z.string(), z.number()) })
      .parse(yaml.load(mergeChain(10)));
    expect(control.b).toEqual(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i])));
    expect(control.b).toEqual(control.a9);
    expectYamlError(() => yaml.load(mergeChain(150)), /merge keys exceeded maxTotalMergeKeys \(10000\)/);
  });

  it('bounds repeated aliases while preserving below-budget override precedence', () => {
    expect(yaml.load(repeatedAliases(99))).toMatchObject({ result: { k0: 999, k99: 99 } });
    expectYamlError(() => yaml.load(repeatedAliases(100)), /merge keys exceeded maxTotalMergeKeys \(10000\)/);
  });

  it('enforces the separate merge-sequence limit', () => {
    expect(yaml.load(emptyMerges(1, 100))).toMatchObject({ targets: [{}] });
    expectYamlError(() => yaml.load(emptyMerges(1, 101)), /abnormal merge sequence size/);
  });

  it('enforces the default nesting limit', () => {
    expect(yaml.load('['.repeat(10) + '0' + ']'.repeat(10))).toEqual([[[[[[[[[[0]]]]]]]]]]);
    expectYamlError(() => yaml.load('['.repeat(110) + '0' + ']'.repeat(110)), /nesting exceeded maxDepth/);
  });

  it('keeps ordinary scalars, multiple documents and duplicate-key rejection', () => {
    expect(yaml.load('integer: 1000\nfloat: 1.25\nboolean: true\ntext: hello\n'))
      .toEqual({ integer: 1000, float: 1.25, boolean: true, text: 'hello' });
    expect(yaml.loadAll('a: 1\n---\na: 2\n')).toEqual([{ a: 1 }, { a: 2 }]);
    expectYamlError(() => yaml.load('a: 1\na: 2\n'), /duplicated mapping key/);
  });

  it('treats numeric separators as strings', () => {
    expect(yaml.load('value: 1_000')).toEqual({ value: '1_000' });
  });

  it('preserves normal merge ordering, explicit keys and shared aliases', () => {
    const parsed = z.object({ first: z.record(z.string(), z.unknown()), alias: z.record(z.string(), z.unknown()), result: z.record(z.string(), z.unknown()) })
      .parse(yaml.load('first: &first { shared: first, a: 1 }\nsecond: &second { shared: second, b: 2 }\nalias: *first\nresult: { <<: [*first, *second], a: 9 }\n'));
    expect(parsed.result).toEqual({ shared: 'first', a: 9, b: 2 });
    const shared = yaml.load('a: &a { x: 1 }\nb: *a');
    if (!shared || typeof shared !== 'object' || !('a' in shared) || !('b' in shared)) {
      throw new Error('Expected the alias fixture to parse as a mapping');
    }
    expect(shared.a).toBe(shared.b);
  });

  it('preserves ordered-map semantics including special property names', () => {
    expect(yaml.load('!!omap []')).toEqual([]);
    expect(yaml.load('!!omap [a: 1, b: 2]')).toEqual([{ a: 1 }, { b: 2 }]);
    const special = yaml.load('!!omap [__proto__: 1, constructor: 2, toString: 3]');
    expect(special).toEqual([JSON.parse('{"__proto__":1}'), { constructor: 2 }, { toString: 3 }]);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it.each([
    '!!omap [a: 1, a: 2]',
    '!!omap [__proto__: 1, __proto__: 2]',
    '!!omap [constructor: 1, constructor: 2]',
    '!!omap [toString: 1, toString: 2]',
    '!!omap [{}]',
    '!!omap [{a: 1, b: 2}]'
  ])('rejects invalid or duplicate ordered-map entries: %s', text => {
    expectYamlError(() => yaml.load(text), /cannot resolve a node/);
  });

  it.each(['.eslintrc.yaml', '.eslintrc'])('loads ordinary YAML anchors and merges through ConfigArrayFactory: %s', async name => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-yaml-'));
    roots.push(root);
    const file = path.join(root, name);
    await fs.writeFile(file, 'rules: &rules { no-alert: off, no-console: warn }\noverrides:\n  - files: ["*.js"]\n    rules: { <<: *rules, no-alert: error }\n');
    const configs = [...new Legacy.ConfigArrayFactory().loadFile(file)];
    expect(configs.map(config => config.rules).filter(Boolean)).toEqual([
      { 'no-alert': 'off', 'no-console': 'warn' },
      { 'no-alert': 'error', 'no-console': 'warn' }
    ]);
  });

  it.each(['.eslintrc.yaml', '.eslintrc'])('reports the parser budget error through ConfigArrayFactory: %s', async name => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-yaml-'));
    roots.push(root);
    const file = path.join(root, name);
    await fs.writeFile(file, emptyMerges(101));
    expect(() => new Legacy.ConfigArrayFactory().loadFile(file))
      .toThrow(/merge keys exceeded maxTotalMergeKeys \(10000\)/);
  });
});
