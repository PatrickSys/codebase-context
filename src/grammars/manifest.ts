import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Curated language-to-wasm mapping. Only these grammars are shipped as package assets.
 * Adding a language here requires the corresponding wasm to be available in tree-sitter-wasms.
 */
export const CURATED_LANGUAGE_TO_WASM: Record<string, string> = {
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  typescriptreact: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  java: 'tree-sitter-java.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  csharp: 'tree-sitter-c_sharp.wasm',
  kotlin: 'tree-sitter-kotlin.wasm'
};

/**
 * Returns true if the given language has a curated Tree-sitter grammar.
 */
export function supportsCuratedTreeSitter(language: string): boolean {
  return language in CURATED_LANGUAGE_TO_WASM;
}

/**
 * Resolves the directory containing packaged grammar wasm files.
 *
 * - Honors `CODEBASE_CONTEXT_TS_GRAMMAR_DIR` env override.
 * - Otherwise resolves to `{packageRoot}/grammars` using the caller's `import.meta.url`.
 */
export function resolveGrammarDir(moduleUrl: string): string {
  const override = process.env.CODEBASE_CONTEXT_TS_GRAMMAR_DIR;
  if (override) {
    return path.resolve(override);
  }

  // moduleUrl is expected to be somewhere inside {packageRoot}/dist/ or {packageRoot}/src/
  const thisFile = fileURLToPath(moduleUrl);
  // Walk up from the file to find the package root (parent of src/ or dist/)
  let dir = path.dirname(thisFile);
  while (dir !== path.dirname(dir)) {
    const base = path.basename(dir);
    if (base === 'src' || base === 'dist') {
      return path.join(path.dirname(dir), 'grammars');
    }
    dir = path.dirname(dir);
  }

  // Fallback: sibling grammars/ relative to file
  return path.join(path.dirname(thisFile), '..', '..', 'grammars');
}

/**
 * Resolves the full path to a grammar wasm file for a given language.
 *
 * @returns `{ wasmFile, wasmPath }` or throws if the language is not curated.
 */
export function resolveGrammarPath(
  language: string,
  moduleUrl: string
): { wasmFile: string; wasmPath: string } {
  const wasmFile = CURATED_LANGUAGE_TO_WASM[language];
  if (!wasmFile) {
    throw new Error(`No curated grammar for language '${language}'.`);
  }

  const grammarDir = resolveGrammarDir(moduleUrl);
  return { wasmFile, wasmPath: path.join(grammarDir, wasmFile) };
}
