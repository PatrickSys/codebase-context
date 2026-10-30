import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MIN_ONNXRUNTIME_NODE_VERSION,
  assertMinimumOnnxRuntimeNodeVersion,
  isSemverAtLeast,
  parseSemverTriple
} from '../src/utils/onnxruntime-version.js';

const root = resolve(import.meta.dirname, '..');

type PackageJson = {
  peerDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  pnpm?: { overrides?: Record<string, string> };
};

describe('onnxruntime-node macOS mutex regression (#68)', () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as PackageJson;
  const lockfile = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');

  it('requires Transformers.js v4 peers (ships onnxruntime-node 1.24.x)', () => {
    expect(packageJson.peerDependencies?.['@huggingface/transformers']).toBe('^4.2.0');
  });

  it('pins onnxruntime-node 1.24.3 for npm and pnpm installs', () => {
    expect(packageJson.overrides?.['@huggingface/transformers>onnxruntime-node']).toBe('1.24.3');
    expect(packageJson.pnpm?.overrides?.['@huggingface/transformers>onnxruntime-node']).toBe('1.24.3');
  });

  it('locks onnxruntime-node 1.24.3 in pnpm-lock.yaml', () => {
    expect(lockfile).toContain("'@huggingface/transformers>onnxruntime-node': 1.24.3");
    expect(lockfile).toMatch(/onnxruntime-node@1\.24\.3/);
  });

  it('compares semver triples for the minimum safe runtime', () => {
    expect(parseSemverTriple('1.21.0')).toEqual([1, 21, 0]);
    expect(isSemverAtLeast('1.24.3', MIN_ONNXRUNTIME_NODE_VERSION)).toBe(true);
    expect(isSemverAtLeast('1.21.0', MIN_ONNXRUNTIME_NODE_VERSION)).toBe(false);
  });

  it('accepts onnxruntime-node 1.24.x when installed with Transformers.js', () => {
    expect(() => assertMinimumOnnxRuntimeNodeVersion()).not.toThrow();
  });
});
