const TESTING_QUERY_TERMS = [
  'test',
  'tests',
  'testing',
  'unit',
  'integration',
  'spec',
  'jest',
  'testbed',
  'mock',
  'mocks',
  'mocking',
  'spy',
  'spyon',
  'coverage',
  'e2e',
  'playwright',
  'cypress',
  'vitest',
  'jasmine'
] as const;

const TESTING_PATTERN_CATEGORIES = new Set([
  'unitTestFramework',
  'testingFramework',
  'testMocking',
  'testUtility',
  'e2eFramework'
]);

const TESTING_QUERY_REGEX = new RegExp(`\\b(${TESTING_QUERY_TERMS.join('|')})\\b`, 'i');

export function isTestingRelatedQuery(query: string): boolean {
  if (!query || !query.trim()) return false;
  return TESTING_QUERY_REGEX.test(query);
}

export function shouldIncludePatternConflictCategory(category: string, query: string): boolean {
  if (!TESTING_PATTERN_CATEGORIES.has(category)) return true;
  return isTestingRelatedQuery(query);
}
