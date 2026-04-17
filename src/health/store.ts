import { promises as fs } from 'fs';
import type { CodebaseHealthArtifact, CodebaseHealthFile } from '../types/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizePathLike(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeHealthFile(raw: unknown): CodebaseHealthFile | null {
  if (!isRecord(raw)) return null;
  const file = typeof raw.file === 'string' ? normalizePathLike(raw.file) : undefined;
  const level =
    raw.level === 'low' || raw.level === 'medium' || raw.level === 'high' ? raw.level : undefined;
  const score = typeof raw.score === 'number' ? raw.score : undefined;
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.filter((value): value is string => typeof value === 'string')
    : [];

  if (!file || !level || score === undefined) return null;

  const rawSignals = isRecord(raw.signals) ? raw.signals : undefined;
  const signals = rawSignals
    ? {
        ...(typeof rawSignals.hotspotRank === 'number' ? { hotspotRank: rawSignals.hotspotRank } : {}),
        ...(typeof rawSignals.importerCount === 'number'
          ? { importerCount: rawSignals.importerCount }
          : {}),
        ...(typeof rawSignals.importCount === 'number' ? { importCount: rawSignals.importCount } : {}),
        ...(typeof rawSignals.cycleCount === 'number' ? { cycleCount: rawSignals.cycleCount } : {}),
        ...(typeof rawSignals.maxCyclomaticComplexity === 'number'
          ? { maxCyclomaticComplexity: rawSignals.maxCyclomaticComplexity }
          : {})
      }
    : undefined;
  return {
    file,
    level,
    score,
    reasons,
    ...(signals && Object.keys(signals).length > 0 && { signals })
  };
}

export function normalizeHealthArtifact(raw: unknown): CodebaseHealthArtifact | null {
  if (!isRecord(raw) || !isRecord(raw.header) || !isRecord(raw.summary) || !Array.isArray(raw.files)) {
    return null;
  }

  const buildId =
    typeof raw.header.buildId === 'string' && raw.header.buildId ? raw.header.buildId : undefined;
  const formatVersion =
    typeof raw.header.formatVersion === 'number' ? raw.header.formatVersion : undefined;
  const generatedAt =
    typeof raw.generatedAt === 'string' && raw.generatedAt ? raw.generatedAt : undefined;

  if (!buildId || formatVersion === undefined || !generatedAt) {
    return null;
  }

  const files = raw.files
    .map((entry) => normalizeHealthFile(entry))
    .filter((entry): entry is CodebaseHealthFile => entry !== null);

  const summary = raw.summary;
  const filesCount = typeof summary.files === 'number' ? summary.files : files.length;
  const highRiskFiles = typeof summary.highRiskFiles === 'number' ? summary.highRiskFiles : 0;
  const mediumRiskFiles = typeof summary.mediumRiskFiles === 'number' ? summary.mediumRiskFiles : 0;
  const lowRiskFiles = typeof summary.lowRiskFiles === 'number' ? summary.lowRiskFiles : 0;

  return {
    header: { buildId, formatVersion },
    generatedAt,
    summary: {
      files: filesCount,
      highRiskFiles,
      mediumRiskFiles,
      lowRiskFiles
    },
    files
  };
}

export async function readHealthFile(healthPath: string): Promise<CodebaseHealthArtifact | null> {
  try {
    const content = await fs.readFile(healthPath, 'utf-8');
    return normalizeHealthArtifact(JSON.parse(content));
  } catch {
    return null;
  }
}

export function normalizeHealthLookupKey(filePath: string, rootPath?: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rootPath) {
    return normalized;
  }
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalized.startsWith(normalizedRoot)) {
    return normalized.slice(normalizedRoot.length).replace(/^\//, '');
  }
  return normalized;
}

export function indexHealthByFile(
  artifact: CodebaseHealthArtifact | null,
  rootPath?: string
): Map<string, CodebaseHealthFile> {
  const map = new Map<string, CodebaseHealthFile>();
  if (!artifact) return map;
  for (const fileHealth of artifact.files) {
    map.set(normalizeHealthLookupKey(fileHealth.file, rootPath), fileHealth);
  }
  return map;
}
