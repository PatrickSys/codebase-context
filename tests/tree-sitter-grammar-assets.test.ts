import { describe, expect, it, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

import { CURATED_LANGUAGE_TO_WASM, resolveGrammarDir } from '../src/grammars/manifest';
import { extractTreeSitterSymbols } from '../src/utils/tree-sitter';
import { GenericAnalyzer } from '../src/analyzers/generic/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve the actual grammar directory using the source module's perspective.
 * The test file's import.meta.url won't resolve correctly (tests/ is not src/ or dist/),
 * so we construct a URL that looks like it lives inside src/.
 */
const GRAMMAR_DIR = resolveGrammarDir(new URL('../src/grammars/manifest.ts', import.meta.url).href);

/**
 * Map from manifest language key to fixture file in tests/fixtures/grammars/.
 */
const LANGUAGE_FIXTURE_FILE: Record<string, string> = {
  javascript: 'javascript.js',
  typescript: 'typescript.ts',
  typescriptreact: 'tsx.tsx',
  python: 'python.py',
  go: 'go.go',
  rust: 'rust.rs',
  java: 'java.java',
  c: 'c.c',
  cpp: 'cpp.cpp',
  csharp: 'csharp.cs',
  kotlin: 'kotlin.kt'
};

const fixturesDir = path.join(__dirname, 'fixtures', 'grammars');

/**
 * Negative / fail-closed tests MUST run before the positive load tests.
 * The tree-sitter module caches loaded grammars in-process; once a grammar
 * loads successfully it stays cached. Running these first ensures the corrupted
 * wasm is the first thing the loader sees for "typescript".
 */
describe('Grammar assets: fail-closed fallback (runs first)', () => {
  let tmpDir: string;
  const savedEnv = process.env.CODEBASE_CONTEXT_TS_GRAMMAR_DIR;

  afterAll(async () => {
    // Restore env so subsequent tests use real grammars
    if (savedEnv !== undefined) {
      process.env.CODEBASE_CONTEXT_TS_GRAMMAR_DIR = savedEnv;
    } else {
      delete process.env.CODEBASE_CONTEXT_TS_GRAMMAR_DIR;
    }

    // Cleanup tmp dir
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('returns null (no throw) for corrupted wasm', async () => {
    // Create temp dir with a corrupted wasm
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grammar-fallback-'));
    const corruptedWasm = path.join(tmpDir, CURATED_LANGUAGE_TO_WASM.typescript);
    await fs.writeFile(corruptedWasm, randomBytes(64));

    // Point grammar dir to our corrupted copy
    process.env.CODEBASE_CONTEXT_TS_GRAMMAR_DIR = tmpDir;

    const fixtureText = await fs.readFile(path.join(fixturesDir, 'typescript.ts'), 'utf8');

    // Must not throw — should return null
    const result = await extractTreeSitterSymbols(fixtureText, 'typescript');
    expect(result).toBeNull();
  });

  it('GenericAnalyzer falls back to line-or-component chunking on corrupted wasm', async () => {
    // tmpDir already set up from previous test, but ensure it exists
    if (!tmpDir) {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grammar-fallback-'));
      const corruptedWasm = path.join(tmpDir, CURATED_LANGUAGE_TO_WASM.typescript);
      await fs.writeFile(corruptedWasm, randomBytes(64));
    }

    process.env.CODEBASE_CONTEXT_TS_GRAMMAR_DIR = tmpDir;

    const fixtureText = await fs.readFile(path.join(fixturesDir, 'typescript.ts'), 'utf8');

    const analyzer = new GenericAnalyzer();
    const result = await analyzer.analyze(path.join(tmpDir, 'fixture.ts'), fixtureText);

    // Verify fallback path was taken
    expect(result.metadata.chunkStrategy).toBe('line-or-component');
    expect(result.metadata.treeSitterGrammar).toBeUndefined();
    expect(result.chunks.length).toBeGreaterThan(0);
  });
});

describe('Grammar assets: manifest-driven load and parse', () => {
  const languages = Object.keys(CURATED_LANGUAGE_TO_WASM);

  it('manifest covers all fixture languages', () => {
    for (const lang of languages) {
      expect(
        LANGUAGE_FIXTURE_FILE[lang],
        `Missing fixture mapping for manifest language '${lang}'`
      ).toBeDefined();
    }
  });

  for (const language of languages) {
    const fixtureFile = LANGUAGE_FIXTURE_FILE[language];

    it(`loads and parses fixture for ${language}`, async () => {
      // 1. Grammar wasm exists on disk
      const wasmFile = CURATED_LANGUAGE_TO_WASM[language];
      const wasmPath = path.join(GRAMMAR_DIR, wasmFile);
      const wasmStat = await fs.stat(wasmPath).catch(() => null);
      expect(wasmStat, `wasm not found at ${wasmPath}`).not.toBeNull();

      // 2. Read fixture
      const fixturePath = path.join(fixturesDir, fixtureFile);
      const fixtureText = await fs.readFile(fixturePath, 'utf8');

      // 3. Extract symbols — this exercises the full load+parse pipeline
      const result = await extractTreeSitterSymbols(fixtureText, language);
      expect(result, `extractTreeSitterSymbols returned null for '${language}'`).not.toBeNull();
      expect(
        result!.symbols.length,
        `Expected at least one symbol for '${language}', got 0`
      ).toBeGreaterThan(0);
    });
  }
});
