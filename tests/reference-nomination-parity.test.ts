import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findIdentifierOccurrences,
  findLexicalIdentifierOccurrences
} from '../src/utils/tree-sitter';

interface ParityCase {
  id: string;
  language: string;
  symbol: string;
  source: string;
  expected: { mode: 'ast' | 'lexical'; count: number };
}

interface ParityFixture {
  contract: string;
  cases: ParityCase[];
}

const fixturePath = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'reference-nomination-parity.json'
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as ParityFixture;

const ASCII_IDENTIFIER_CONTINUE = /[A-Za-z0-9_$]/;

/**
 * Test-only conservative candidate. It suppresses only ASCII identifier interiors
 * for simple ASCII identifier queries. Unicode and arbitrary spellings stay nominated.
 */
function hasConservativeAsciiCandidate(source: string, symbol: string): boolean {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbol)) return source.includes(symbol);
  let offset = 0;
  while (offset <= source.length - symbol.length) {
    const start = source.indexOf(symbol, offset);
    if (start === -1) return false;
    const end = start + symbol.length;
    const left = start > 0 ? source[start - 1] : undefined;
    const right = end < source.length ? source[end] : undefined;
    const leftBoundary = left === undefined || !ASCII_IDENTIFIER_CONTINUE.test(left);
    const rightBoundary = right === undefined || !ASCII_IDENTIFIER_CONTINUE.test(right);
    if (leftBoundary && rightBoundary) return true;
    offset = start + Math.max(1, symbol.length);
  }
  return false;
}

describe('reference nomination parity fixture', () => {
  it('freezes current parser and lexical behavior across grammar and uncertainty cases', async () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(20);

    for (const example of fixture.cases) {
      const ast = await findIdentifierOccurrences(example.source, example.language, example.symbol);
      const mode = ast === null ? 'lexical' : 'ast';
      const occurrences =
        ast === null ? findLexicalIdentifierOccurrences(example.source, example.symbol) : ast;

      expect({ mode, count: occurrences.length }, example.id).toEqual(example.expected);
    }
  });

  it('checks the frozen result against a test-only ASCII-conservative nominator', async () => {
    const omittedCandidates: string[] = [];
    for (const example of fixture.cases) {
      const nominated = hasConservativeAsciiCandidate(example.source, example.symbol);
      if (example.source.includes(example.symbol) && !nominated) {
        omittedCandidates.push(example.id);
      }
      const ast = nominated
        ? await findIdentifierOccurrences(example.source, example.language, example.symbol)
        : [];
      const occurrences = !nominated
        ? []
        : ast === null
          ? findLexicalIdentifierOccurrences(example.source, example.symbol)
          : ast;

      expect(occurrences.length, example.id).toBe(example.expected.count);
    }

    expect(omittedCandidates).toEqual([
      'ts-long-identifier',
      'ts-dollar-identifier',
      'ts-underscore-identifier',
      'ts-underscore-suffix',
      'ts-number-error-split',
      'javascript-number-suffix',
      'python-number-suffix',
      'go-number-suffix',
      'rust-number-suffix',
      'java-number-suffix',
      'c-number-suffix',
      'cpp-number-suffix',
      'c-hex-prefix-split',
      'cpp-hex-prefix-split',
      'csharp-number-suffix',
      'kotlin-number-suffix',
      'python-long-identifier',
      'unknown-long-identifier',
      'unknown-dollar-boundary',
      'unknown-number-error-split',
      'excalidraw-source-token-inside-long-identifier'
    ]);
  });
});
