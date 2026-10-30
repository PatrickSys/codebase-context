import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** microsoft/onnxruntime#24579 — mutex crash on macOS in 1.21.x and earlier. */
export const MIN_ONNXRUNTIME_NODE_VERSION = '1.24.0';

const resolve = createRequire(import.meta.url).resolve;

export function parseSemverTriple(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) {
    return [0, 0, 0];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isSemverAtLeast(actual: string, minimum: string): boolean {
  const [aMajor, aMinor, aPatch] = parseSemverTriple(actual);
  const [mMajor, mMinor, mPatch] = parseSemverTriple(minimum);
  if (aMajor !== mMajor) {
    return aMajor > mMajor;
  }
  if (aMinor !== mMinor) {
    return aMinor > mMinor;
  }
  return aPatch >= mPatch;
}

function readInstalledOnnxRuntimeVersion(): string | null {
  try {
    const transformersPkg = resolve('@huggingface/transformers/package.json');
    const onnxPkg = resolve('onnxruntime-node/package.json', {
      paths: [path.dirname(transformersPkg)]
    });
    const pkg = JSON.parse(readFileSync(onnxPkg, 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    try {
      const onnxPkg = resolve('onnxruntime-node/package.json');
      const pkg = JSON.parse(readFileSync(onnxPkg, 'utf8')) as { version?: string };
      return typeof pkg.version === 'string' ? pkg.version : null;
    } catch {
      return null;
    }
  }
}

/** Fail fast before ONNX embedding/rerank work when the native runtime is too old. */
export function assertMinimumOnnxRuntimeNodeVersion(minimum = MIN_ONNXRUNTIME_NODE_VERSION): void {
  const installed = readInstalledOnnxRuntimeVersion();
  if (!installed) {
    return;
  }

  if (isSemverAtLeast(installed, minimum)) {
    return;
  }

  throw new Error(
    `onnxruntime-node@${installed} can crash on macOS during embedding (mutex lock failed; see microsoft/onnxruntime#24579). ` +
      `Install @huggingface/transformers@^4.2.0 so onnxruntime-node resolves to >=${minimum}, ` +
      `or set EMBEDDING_PROVIDER=openai to bypass local Transformers.js.`
  );
}
