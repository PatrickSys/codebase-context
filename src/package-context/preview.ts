import path from 'path';
import { promises as fs } from 'fs';
import type {
  ContextPackageManifest,
  ContextPackagePreview,
  ContextPublicSurfaceRecord
} from './types.js';

interface OverviewPacket {
  warnings?: string[];
}

export async function previewContextPackage(contextDir: string): Promise<ContextPackagePreview> {
  const root = path.resolve(contextDir);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf-8')) as ContextPackageManifest;
  const overview = await readOverview(path.join(root, manifest.outputs.packets.overview));
  const publicSurface = await readJsonl<ContextPublicSurfaceRecord>(
    path.join(root, manifest.outputs.graph.publicSurface)
  );

  return {
    packageName: manifest.package.name,
    ...(manifest.package.version ? { version: manifest.package.version } : {}),
    ...(manifest.package.description ? { description: manifest.package.description } : {}),
    artifactCount: await countJsonl(path.join(root, manifest.outputs.graph.artifacts)),
    publicSurfaceCount: publicSurface.length,
    warnings: overview.warnings ?? [],
    topPublicSurface: publicSurface.slice(0, 10).map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      confidence: entry.confidence,
      evidence: entry.evidence.slice(0, 2)
    }))
  };
}

export function renderContextPackagePreview(preview: ContextPackagePreview): string {
  const lines: string[] = [];
  const version = preview.version ? ` ${preview.version}` : '';
  lines.push(`# AI Context Package: ${preview.packageName}${version}`);
  if (preview.description) {
    lines.push(preview.description);
  }
  lines.push('');
  lines.push(`Artifacts: ${preview.artifactCount}`);
  lines.push(`Public surface entries: ${preview.publicSurfaceCount}`);
  if (preview.warnings.length > 0) {
    lines.push(`Warnings: ${preview.warnings.length}`);
  }
  lines.push('');
  lines.push('Top public surface:');
  if (preview.topPublicSurface.length === 0) {
    lines.push('- No public surface entries detected.');
  } else {
    for (const entry of preview.topPublicSurface) {
      const evidence = entry.evidence[0];
      const source = evidence ? `${evidence.file}:${evidence.startLine}` : 'no evidence';
      lines.push(`- ${entry.name} (${entry.kind}, ${entry.confidence}) — ${source}`);
    }
  }
  return lines.join('\n');
}

async function readOverview(targetPath: string): Promise<OverviewPacket> {
  const parsed = JSON.parse(await fs.readFile(targetPath, 'utf-8')) as unknown;
  if (!isRecord(parsed)) {
    return {};
  }

  return {
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === 'string')
      : undefined
  };
}

async function countJsonl(targetPath: string): Promise<number> {
  const content = await fs.readFile(targetPath, 'utf-8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

async function readJsonl<T>(targetPath: string): Promise<T[]> {
  const content = await fs.readFile(targetPath, 'utf-8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
