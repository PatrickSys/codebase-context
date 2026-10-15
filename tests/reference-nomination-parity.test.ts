import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hasIdentifierCandidate,
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

  it('preserves the frozen result with the production ASCII-conservative nominator', async () => {
    const omittedCandidates: string[] = [];
    for (const example of fixture.cases) {
      const nominated = hasIdentifierCandidate(example.source, example.symbol);
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
