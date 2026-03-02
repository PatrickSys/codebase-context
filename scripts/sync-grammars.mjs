#!/usr/bin/env node
// scripts/sync-grammars.mjs
// Copies the curated Tree-sitter wasm set from node_modules into grammars/

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);

// ── Curated set (must match src/grammars/manifest.ts) ────────────────────
const CURATED_WASMS = [
  'tree-sitter-javascript.wasm',
  'tree-sitter-typescript.wasm',
  'tree-sitter-tsx.wasm',
  'tree-sitter-python.wasm',
  'tree-sitter-go.wasm',
  'tree-sitter-rust.wasm',
  'tree-sitter-java.wasm',
  'tree-sitter-c.wasm',
  'tree-sitter-cpp.wasm',
  'tree-sitter-c_sharp.wasm',
  'tree-sitter-kotlin.wasm'
];

const sourceDir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');

const destDir = path.resolve('grammars');

// ── Ensure destination exists ────────────────────────────────────────────
fs.mkdirSync(destDir, { recursive: true });

let copied = 0;

for (const wasm of CURATED_WASMS) {
  const src = path.join(sourceDir, wasm);
  if (!fs.existsSync(src)) {
    console.error(`ERROR: Missing source wasm: ${src}`);
    process.exit(1);
  }

  const dest = path.join(destDir, wasm);

  // Atomic copy: write to temp name then rename to avoid partial files
  const tmp = dest + '.tmp-' + randomBytes(4).toString('hex');
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dest);
  copied++;
}

console.log(`sync-grammars: ${copied} wasm files → ${destDir}`);
