export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\\/g, '/');
}

export function normalizeRelativePath(candidate) {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.replace(/^[A-Za-z]:\//, '');
  }
  return normalized.split(':')[0];
}

export function matchesPatterns(candidate, patterns) {
  if (!patterns?.length) return false;
  const normalizedCandidate = normalizeText(candidate);
  return patterns.some((pattern) => normalizedCandidate.includes(normalizeText(pattern)));
}

export function firstRelevantHit(topFiles, patterns) {
  if (!patterns?.length) return null;
  for (let index = 0; index < topFiles.length; index++) {
    if (matchesPatterns(topFiles[index], patterns)) return index + 1;
  }
  return null;
}

export function scoreTaskResult(task, { payload = '', topFiles = [] }) {
  const hit = firstRelevantHit(topFiles, task.expectedFilePatterns);
  const top3Hit = hit !== null && hit <= 3;
  const normalizedPayload = normalizeText(payload);
  const matchedSignals = (task.expectedSignals ?? []).filter((signal) =>
    normalizedPayload.includes(normalizeText(signal))
  );
  const usefulnessScore =
    task.expectedSignals?.length > 0
      ? matchedSignals.length / Math.max(task.expectedSignals.length, 1)
      : top3Hit
        ? 1
        : 0;

  return {
    top3Hit,
    firstRelevantHit: hit,
    usefulnessScore,
    matchedSignals
  };
}

export function countUtf8Bytes(str) {
  return Buffer.byteLength(String(str ?? ''), 'utf8');
}

export function estimateTokens(bytes) {
  return Math.ceil(bytes / 4);
}

export function aggregateLaneResults(taskResults) {
  const completed = taskResults.filter((result) => result.status === 'completed');
  const n = taskResults.length;
  const top3Hits = completed.filter((result) => result.top3Hit).length;
  const avgUsefulness =
    completed.length > 0
      ? completed.reduce((sum, result) => sum + result.usefulnessScore, 0) / completed.length
      : null;
  const avgTokens =
    completed.length > 0
      ? completed.reduce((sum, result) => sum + result.estimatedTokens, 0) / completed.length
      : null;
  const avgQueryMs =
    completed.length > 0
      ? completed.reduce((sum, result) => sum + result.queryElapsedMs, 0) / completed.length
      : null;
  const avgIndexMs =
    completed.length > 0
      ? completed.reduce((sum, result) => sum + (result.indexElapsedMs ?? 0), 0) / completed.length
      : null;

  const byNiche = {};
  for (const niche of ['team-convention', 'edit-preflight', 'symbol-retrieval']) {
    const nicheRows = completed.filter((result) => result.niche === niche);
    byNiche[niche] = {
      tasks: nicheRows.length,
      top3HitRate: nicheRows.length > 0 ? nicheRows.filter((row) => row.top3Hit).length / nicheRows.length : null
    };
  }

  const failed = taskResults.filter((result) => result.status !== 'completed');
  return {
    status: completed.length === 0 ? 'setup_failed' : failed.length > 0 ? 'partial' : 'completed',
    tasksTotal: n,
    tasksCompleted: completed.length,
    tasksFailed: failed.length,
    top3HitRate: completed.length > 0 ? top3Hits / completed.length : null,
    averageUsefulness: avgUsefulness,
    averageEstimatedTokens: avgTokens,
    averageQueryElapsedMs: avgQueryMs,
    averageIndexElapsedMs: avgIndexMs,
    byNiche,
    taskResults
  };
}

export function aggregateEvidence(laneEvidence, manifest, protocol, runMeta) {
  return {
    artifactType: 'niche-prior-art-benchmark-evidence',
    generatedAt: new Date().toISOString(),
    protocol: {
      name: protocol.name,
      frozenDate: protocol.frozenDate,
      manifestFrozenDate: manifest.frozenDate
    },
    runMeta,
    comparators: protocol.comparators.map((comparator) => ({
      id: comparator.id,
      displayName: comparator.displayName,
      credit: comparator.credit,
      projectUrl: comparator.projectUrl,
      ...(laneEvidence[comparator.id] ?? { status: 'not_run' })
    })),
    summaryTable: Object.entries(laneEvidence).map(([laneId, lane]) => ({
      laneId,
      status: lane.status,
      top3HitRate: lane.top3HitRate,
      averageEstimatedTokens: lane.averageEstimatedTokens,
      averageQueryElapsedMs: lane.averageQueryElapsedMs,
      averageIndexElapsedMs: lane.averageIndexElapsedMs
    }))
  };
}
