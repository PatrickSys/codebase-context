const COMPLEMENTARY_REACTIVITY_PATTERNS = new Set(['computed', 'effect']);

function normalizePatternName(name: string): string {
  return name.trim().toLowerCase();
}

export function isComplementaryPatternConflict(
  category: string,
  primaryName: string,
  alternativeName: string
): boolean {
  if (category !== 'reactivity') return false;

  const primary = normalizePatternName(primaryName);
  const alternative = normalizePatternName(alternativeName);

  if (!COMPLEMENTARY_REACTIVITY_PATTERNS.has(primary)) return false;
  if (!COMPLEMENTARY_REACTIVITY_PATTERNS.has(alternative)) return false;

  return primary !== alternative;
}

export function isComplementaryPatternCategory(category: string, patternNames: string[]): boolean {
  if (category !== 'reactivity' || patternNames.length < 2) return false;
  return patternNames.every((name) =>
    COMPLEMENTARY_REACTIVITY_PATTERNS.has(normalizePatternName(name))
  );
}

export function shouldSkipLegacyTestingFrameworkCategory(
  category: string,
  patterns: Record<string, any>
): boolean {
  return category === 'testingFramework' && Boolean(patterns.unitTestFramework?.primary);
}
