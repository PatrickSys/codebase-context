import type { MemoryWithConfidence } from '../memory/store.js';
import type { SearchResult } from '../types/index.js';

type EvidenceStrength = 'strong' | 'weak' | 'missing';

interface EvidenceSource {
  source: 'code' | 'patterns' | 'memories';
  strength: EvidenceStrength;
  count: number;
  examples: string[];
}

export interface EpistemicStress {
  level: 'low' | 'moderate' | 'high';
  triggers: string[];
  abstain: boolean;
}

export interface EvidenceLock {
  mode: 'triangulated';
  status: 'pass' | 'warn' | 'block';
  readyToEdit: boolean;
  score: number;
  sources: EvidenceSource[];
  gaps?: string[];
  nextAction?: string;
  epistemicStress?: EpistemicStress;
  whatWouldHelp?: string[];
}

interface PatternConflict {
  category: string;
  primary: { name: string; adoption: string };
  alternative: { name: string; adoption: string };
}

interface BuildEvidenceLockInput {
  results: SearchResult[];
  preferredPatterns: Array<{ pattern: string; example?: string }>;
  relatedMemories: MemoryWithConfidence[];
  failureWarnings: Array<{ memory: string }>;
  patternConflicts?: PatternConflict[];
  /** When search quality is low_confidence, evidence lock MUST block edits. */
  searchQualityStatus?: 'ok' | 'low_confidence';
  /** Impact coverage: number of known callers covered by results */
  impactCoverage?: { covered: number; total: number };
  /** Index age signal: fresh (<24h), aging (24h–7d), stale (>7d) */
  indexFreshness?: 'fresh' | 'aging' | 'stale';
}

function strengthFactor(strength: EvidenceStrength): number {
  if (strength === 'strong') return 1;
  if (strength === 'weak') return 0.5;
  return 0;
}

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

export function buildEvidenceLock(input: BuildEvidenceLockInput): EvidenceLock {
  const codeExamples = input.results
    .slice(0, 3)
    .map((r) => `${r.filePath}:${r.startLine}-${r.endLine}`);
  const codeStrength: EvidenceStrength =
    input.results.length >= 3 ? 'strong' : input.results.length > 0 ? 'weak' : 'missing';

  const patternExamples = input.preferredPatterns
    .slice(0, 3)
    .map((p) => (p.example ? `${p.pattern} (${p.example})` : p.pattern));
  const patternsStrength: EvidenceStrength =
    input.preferredPatterns.length >= 2
      ? 'strong'
      : input.preferredPatterns.length === 1
        ? 'weak'
        : 'missing';

  const activeMemories = input.relatedMemories.filter((m) => !m.stale);
  const memoryExamplesFromFailures = input.failureWarnings
    .slice(0, 2)
    .map((w) => truncate(w.memory));
  const memoryExamplesFromMemories = activeMemories.slice(0, 2).map((m) => truncate(m.memory));
  const memoryExamples = [...memoryExamplesFromFailures, ...memoryExamplesFromMemories].slice(0, 3);
  const memoryCount = activeMemories.length;
  const memoriesStrength: EvidenceStrength =
    memoryCount >= 2 || input.failureWarnings.length > 0
      ? 'strong'
      : memoryCount === 1
        ? 'weak'
        : 'missing';

  const sources: EvidenceSource[] = [
    {
      source: 'code',
      strength: codeStrength,
      count: input.results.length,
      examples: codeExamples
    },
    {
      source: 'patterns',
      strength: patternsStrength,
      count: input.preferredPatterns.length,
      examples: patternExamples
    },
    {
      source: 'memories',
      strength: memoriesStrength,
      count: memoryCount,
      examples: memoryExamples
    }
  ];

  const strongSources = sources.filter((s) => s.strength === 'strong').length;
  const weakSources = sources.filter((s) => s.strength === 'weak').length;

  const baseScore =
    45 * strengthFactor(codeStrength) +
    30 * strengthFactor(patternsStrength) +
    25 * strengthFactor(memoriesStrength);
  const score = Math.min(100, Math.round(baseScore));

  let status: 'pass' | 'warn' | 'block' = 'block';
  if (codeStrength === 'strong' && strongSources >= 2) {
    status = 'pass';
  } else if (codeStrength !== 'missing' && (strongSources >= 1 || weakSources >= 2)) {
    status = 'warn';
  }

  const gaps: string[] = [];
  if (codeStrength === 'missing') gaps.push('No matching code hits for this intent');
  if (patternsStrength === 'missing') gaps.push('No preferred team pattern evidence found');
  if (memoriesStrength === 'missing') gaps.push('No active team memory evidence found');

  let nextAction: string | undefined;
  if (status === 'block') {
    nextAction =
      'Broaden the query or run refresh_index, then retry to collect stronger evidence before editing.';
  } else if (status === 'warn') {
    nextAction = 'Proceed cautiously and confirm at least one golden file before editing.';
  }

  // --- Epistemic stress: detect when evidence is contradictory, stale, or too thin ---
  const stressTriggers: string[] = [];

  // Trigger: pattern conflicts (team hasn't converged)
  if (input.patternConflicts && input.patternConflicts.length > 0) {
    for (const c of input.patternConflicts.slice(0, 3)) {
      stressTriggers.push(
        `Conflicting patterns in ${c.category}: ${c.primary.name} (${c.primary.adoption}) vs ${c.alternative.name} (${c.alternative.adoption})`
      );
    }
  }

  // Trigger: high stale memory ratio (most knowledge is outdated)
  const totalMemories = input.relatedMemories.length;
  const staleMemories = input.relatedMemories.filter((m) => m.stale).length;
  if (totalMemories > 0 && staleMemories / totalMemories > 0.5) {
    stressTriggers.push(
      `${staleMemories}/${totalMemories} related memories are stale - team knowledge may be outdated`
    );
  }

  // Trigger: thin evidence (majority of sources missing or weak)
  const missingSources = sources.filter((s) => s.strength === 'missing').length;
  if (missingSources >= 2) {
    stressTriggers.push('Insufficient evidence: most evidence sources are empty');
  }

  // Trigger: low caller coverage
  if (
    input.impactCoverage &&
    input.impactCoverage.total > 3 &&
    input.impactCoverage.covered / input.impactCoverage.total < 0.4
  ) {
    stressTriggers.push(
      `Low caller coverage: only ${input.impactCoverage.covered} of ${input.impactCoverage.total} callers appear in results`
    );
  }

  let epistemicStress: EpistemicStress | undefined;
  if (stressTriggers.length > 0) {
    const level: EpistemicStress['level'] =
      stressTriggers.length >= 3 ? 'high' : stressTriggers.length >= 2 ? 'moderate' : 'low';
    const abstain = level === 'high' || (level === 'moderate' && status !== 'pass');
    epistemicStress = { level, triggers: stressTriggers, abstain };

    // High stress overrides status: don't claim readiness when evidence is contradictory
    if (abstain && status === 'pass') {
      status = 'warn';
    }
    if (abstain && !nextAction) {
      nextAction =
        'Evidence is contradictory or insufficient. Resolve pattern conflicts or gather more context before editing.';
    }
  }

  // Hard gate: low search quality overrides everything.
  // If retrieval is bad, we CANNOT claim readiness regardless of evidence counts.
  // Surface low-confidence guidance so callers see the actual reason edits are blocked.
  if (input.searchQualityStatus === 'low_confidence') {
    if (status === 'pass') status = 'warn';
    nextAction = 'Search quality is low. Refine query or add concrete symbols before editing.';
    if (!gaps.includes('Search quality is low')) {
      gaps.push('Search quality is low — evidence may be unreliable');
    }
  }

  // Freshness gate: stale index forces block; aging index warns without changing status.
  if (input.indexFreshness === 'stale') {
    status = 'block';
    nextAction = 'Index is stale (>7 days). Run refresh_index before editing.';
    if (!gaps.includes('Index is stale')) {
      gaps.push('Index is stale (>7 days) — results may be significantly out of date');
    }
  } else if (input.indexFreshness === 'aging') {
    if (!gaps.includes('Index is aging')) {
      gaps.push('Index is aging (>24h) — results may not reflect recent changes');
    }
  }

  const readyToEdit =
    status === 'pass' &&
    input.indexFreshness !== 'stale' &&
    (!epistemicStress || !epistemicStress.abstain) &&
    input.searchQualityStatus !== 'low_confidence';

  //  Generate whatWouldHelp recommendations
  const whatWouldHelp: string[] = [];
  if (!readyToEdit) {
    // Code evidence weak/missing
    if (codeStrength === 'weak' || codeStrength === 'missing') {
      whatWouldHelp.push('Search with a more specific query targeting the implementation files');
    }

    // Pattern evidence missing
    if (patternsStrength === 'missing') {
      whatWouldHelp.push('Call get_team_patterns to see what patterns apply to this area');
    }

    // Low caller coverage with many callers
    if (
      input.impactCoverage &&
      input.impactCoverage.total > 3 &&
      input.impactCoverage.covered / input.impactCoverage.total < 0.4
    ) {
      const uncoveredCallers = input.impactCoverage.total - input.impactCoverage.covered;
      if (uncoveredCallers > 0) {
        whatWouldHelp.push(
          `Search specifically for uncovered callers to check ${Math.min(2, uncoveredCallers)} more files`
        );
      }
    }

    // Memory evidence missing + failure warnings
    if (memoriesStrength === 'missing' && input.failureWarnings.length > 0) {
      whatWouldHelp.push('Review related memories with get_memory to understand past issues');
    }
  }

  return {
    mode: 'triangulated',
    status,
    readyToEdit,
    score,
    sources,
    ...(gaps.length > 0 && { gaps }),
    ...(nextAction && { nextAction }),
    ...(epistemicStress && { epistemicStress }),
    ...(whatWouldHelp.length > 0 && { whatWouldHelp: whatWouldHelp.slice(0, 4) })
  };
}
