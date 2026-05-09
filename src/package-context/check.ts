import path from 'path';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import type { ContextPackageCheckResult, ContextPackageManifest } from './types.js';

interface SourceManifest {
  rootPath?: string;
  files?: Array<{ path?: string; hash?: string; sizeBytes?: number }>;
}

export async function checkContextPackage(contextDir: string): Promise<ContextPackageCheckResult> {
  const root = path.resolve(contextDir);
  const errors: string[] = [];
  const warnings: string[] = [];
  const manifest = await readManifest(root, errors);
  if (!manifest) {
    return { ok: false, errors, warnings, checkedFiles: 0 };
  }

  const requiredArtifactPaths = [
    manifest.outputs.readme,
    manifest.outputs.graph.artifacts,
    manifest.outputs.graph.symbols,
    manifest.outputs.graph.edges,
    manifest.outputs.graph.publicSurface,
    ...Object.values(manifest.outputs.packets),
    manifest.outputs.provenance.sourceManifest,
    manifest.outputs.provenance.hashes,
    manifest.outputs.provenance.extractorReport
  ];

  for (const relativePath of requiredArtifactPaths) {
    await requireFile(path.join(root, relativePath), errors);
  }

  const sourceManifestPath = path.join(root, manifest.outputs.provenance.sourceManifest);
  const sourceManifest = await readSourceManifest(sourceManifestPath, warnings);
  let checkedFiles = 0;

  if (sourceManifest?.rootPath && sourceManifest.files) {
    for (const file of sourceManifest.files) {
      if (!file.path || !file.hash) {
        warnings.push('Source manifest contains an incomplete file record.');
        continue;
      }
      const sourcePath = path.join(sourceManifest.rootPath, file.path);
      try {
        const content = await fs.readFile(sourcePath, 'utf-8');
        checkedFiles++;
        const hash = createHash('sha256').update(content).digest('hex');
        if (hash !== file.hash) {
          errors.push(`Source hash changed: ${file.path}`);
        }
      } catch {
        errors.push(`Source file missing: ${file.path}`);
      }
    }
  } else {
    warnings.push('Source manifest could not be checked; package artifact shape only was validated.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checkedFiles
  };
}

async function readManifest(
  root: string,
  errors: string[]
): Promise<ContextPackageManifest | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf-8')) as unknown;
    if (!isContextPackageManifest(parsed)) {
      errors.push('manifest.json is not an ai-context-package.v0 manifest.');
      return undefined;
    }
    return parsed;
  } catch (error) {
    errors.push(`Could not read manifest.json: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function readSourceManifest(
  sourceManifestPath: string,
  warnings: string[]
): Promise<SourceManifest | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(sourceManifestPath, 'utf-8')) as unknown;
    if (!isRecord(parsed)) {
      warnings.push('source-manifest.json is not an object.');
      return undefined;
    }
    return {
      rootPath: typeof parsed.rootPath === 'string' ? parsed.rootPath : undefined,
      files: Array.isArray(parsed.files)
        ? parsed.files.filter(isRecord).map((file) => ({
            path: typeof file.path === 'string' ? file.path : undefined,
            hash: typeof file.hash === 'string' ? file.hash : undefined,
            sizeBytes: typeof file.sizeBytes === 'number' ? file.sizeBytes : undefined
          }))
        : undefined
    };
  } catch (error) {
    warnings.push(
      `Could not read source-manifest.json: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

async function requireFile(targetPath: string, errors: string[]): Promise<void> {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isFile()) {
      errors.push(`Expected file but found non-file: ${targetPath}`);
    }
  } catch {
    errors.push(`Missing generated file: ${targetPath}`);
  }
}

function isContextPackageManifest(value: unknown): value is ContextPackageManifest {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 'ai-context-package.v0' && isRecord(value.outputs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
