import type { CodeChunk, CodebaseHealthArtifact, CodebaseHealthFile } from '../types/index.js';
import { InternalFileGraph } from '../utils/usage-tracker.js';

interface DeriveCodebaseHealthParams {
  buildId: string;
  formatVersion: number;
  generatedAt: string;
  chunks: CodeChunk[];
  graph: InternalFileGraph;
}

interface FileMetrics {
  importCount: number;
  importerCount: number;
  cycleCount: number;
  maxCyclomaticComplexity: number;
  hotspotRank?: number;
}

type FileMetricsMap = Map<string, FileMetrics>;

function normalizePathLike(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function collectFileMetrics(chunks: CodeChunk[], graph: InternalFileGraph): FileMetricsMap {
  const metrics = new Map<string, FileMetrics>();
  const graphJson = graph.toJSON();
  const reverseImports = new Map<string, Set<string>>();

  for (const [file, deps] of Object.entries(graphJson.imports)) {
    const normalizedFile = normalizePathLike(file);
    const fileMetrics = metrics.get(normalizedFile) ?? {
      importCount: 0,
      importerCount: 0,
      cycleCount: 0,
      maxCyclomaticComplexity: 0
    };
    fileMetrics.importCount = deps.length;
    metrics.set(normalizedFile, fileMetrics);

    for (const dependency of deps) {
      const normalizedDependency = normalizePathLike(dependency);
      const importers = reverseImports.get(normalizedDependency) ?? new Set<string>();
      importers.add(normalizedFile);
      reverseImports.set(normalizedDependency, importers);
    }
  }

  for (const [file, importers] of reverseImports.entries()) {
    const fileMetrics = metrics.get(file) ?? {
      importCount: 0,
      importerCount: 0,
      cycleCount: 0,
      maxCyclomaticComplexity: 0
    };
    fileMetrics.importerCount = importers.size;
    metrics.set(file, fileMetrics);
  }

  for (const chunk of chunks) {
    const file = normalizePathLike(chunk.relativePath || chunk.filePath);
    const fileMetrics = metrics.get(file) ?? {
      importCount: 0,
      importerCount: 0,
      cycleCount: 0,
      maxCyclomaticComplexity: 0
    };
    const chunkComplexity =
      typeof chunk.metadata?.cyclomaticComplexity === 'number'
        ? chunk.metadata.cyclomaticComplexity
        : typeof chunk.metadata?.complexity === 'number'
          ? chunk.metadata.complexity
          : 0;
    fileMetrics.maxCyclomaticComplexity = Math.max(
      fileMetrics.maxCyclomaticComplexity,
      chunkComplexity
    );
    metrics.set(file, fileMetrics);
  }

  const hotspotRanks = Array.from(metrics.entries())
    .map(([file, fileMetrics]) => ({
      file,
      combined: fileMetrics.importCount + fileMetrics.importerCount
    }))
    .filter((entry) => entry.combined > 0)
    .sort((a, b) => b.combined - a.combined || a.file.localeCompare(b.file));

  hotspotRanks.forEach((entry, index) => {
    const fileMetrics = metrics.get(entry.file);
    if (fileMetrics) {
      fileMetrics.hotspotRank = index + 1;
    }
  });

  for (const cycle of graph.findCycles()) {
    for (const file of cycle.files.slice(0, -1)) {
      const normalizedFile = normalizePathLike(file);
      const fileMetrics = metrics.get(normalizedFile) ?? {
        importCount: 0,
        importerCount: 0,
        cycleCount: 0,
        maxCyclomaticComplexity: 0
      };
      fileMetrics.cycleCount += 1;
      metrics.set(normalizedFile, fileMetrics);
    }
  }

  return metrics;
}

function getHealthLevel(fileMetrics: FileMetrics): CodebaseHealthFile {
  const reasons: string[] = [];
  let score = 0;

  if (fileMetrics.cycleCount > 0) {
    score += 3;
    reasons.push(
      `Participates in ${fileMetrics.cycleCount} circular dependenc${fileMetrics.cycleCount === 1 ? 'y' : 'ies'}`
    );
  }

  if (fileMetrics.importerCount >= 8) {
    score += 2;
    reasons.push(`High fan-in: ${fileMetrics.importerCount} files depend on it`);
  } else if (fileMetrics.importerCount >= 4) {
    score += 1;
    reasons.push(`Shared dependency for ${fileMetrics.importerCount} files`);
  }

  if (fileMetrics.hotspotRank && fileMetrics.hotspotRank <= 5) {
    score += 2;
    reasons.push(`Hotspot rank #${fileMetrics.hotspotRank} by graph centrality`);
  } else if (fileMetrics.hotspotRank && fileMetrics.hotspotRank <= 10) {
    score += 1;
    reasons.push(`Top-10 hotspot by graph centrality`);
  }

  if (fileMetrics.maxCyclomaticComplexity >= 18) {
    score += 2;
    reasons.push(`Complex implementation (cyclomatic ${fileMetrics.maxCyclomaticComplexity})`);
  } else if (fileMetrics.maxCyclomaticComplexity >= 10) {
    score += 1;
    reasons.push(`Moderate code complexity (cyclomatic ${fileMetrics.maxCyclomaticComplexity})`);
  }

  const level = score >= 4 ? 'high' : score >= 2 ? 'medium' : ('low' as const);

  return {
    file: '',
    level,
    score,
    reasons: reasons.slice(0, 3),
    signals: {
      ...(fileMetrics.hotspotRank ? { hotspotRank: fileMetrics.hotspotRank } : {}),
      ...(fileMetrics.importerCount > 0 ? { importerCount: fileMetrics.importerCount } : {}),
      ...(fileMetrics.importCount > 0 ? { importCount: fileMetrics.importCount } : {}),
      ...(fileMetrics.cycleCount > 0 ? { cycleCount: fileMetrics.cycleCount } : {}),
      ...(fileMetrics.maxCyclomaticComplexity > 0
        ? { maxCyclomaticComplexity: fileMetrics.maxCyclomaticComplexity }
        : {})
    }
  };
}

export function deriveCodebaseHealth({
  buildId,
  formatVersion,
  generatedAt,
  chunks,
  graph
}: DeriveCodebaseHealthParams): CodebaseHealthArtifact {
  const fileMetrics = collectFileMetrics(chunks, graph);
  const files = Array.from(fileMetrics.entries())
    .map(([file, metrics]) => {
      const health = getHealthLevel(metrics);
      return {
        ...health,
        file
      };
    })
    .sort((a, b) => {
      const priority = { high: 0, medium: 1, low: 2 };
      const levelDelta = priority[a.level] - priority[b.level];
      if (levelDelta !== 0) return levelDelta;
      if (b.score !== a.score) return b.score - a.score;
      return a.file.localeCompare(b.file);
    });

  const highRiskFiles = files.filter((file) => file.level === 'high').length;
  const mediumRiskFiles = files.filter((file) => file.level === 'medium').length;
  const lowRiskFiles = files.length - highRiskFiles - mediumRiskFiles;

  return {
    header: { buildId, formatVersion },
    generatedAt,
    summary: {
      files: files.length,
      highRiskFiles,
      mediumRiskFiles,
      lowRiskFiles
    },
    files
  };
}
