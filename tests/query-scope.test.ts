import { describe, it, expect } from 'vitest';
import {
  isTestingRelatedQuery,
  shouldIncludePatternConflictCategory
} from '../src/preflight/query-scope.js';

describe('Preflight query scope', () => {
  it('detects testing-related queries', () => {
    expect(isTestingRelatedQuery('Update unit tests for AuthInterceptor with jest mocks')).toBe(
      true
    );
    expect(isTestingRelatedQuery('Refactor TestBed setup and spyOn assertions')).toBe(true);
    expect(isTestingRelatedQuery('Migrate e2e Playwright flows')).toBe(true);
  });

  it('ignores non-testing queries', () => {
    expect(
      isTestingRelatedQuery('Refactor AuthInterceptor registration and HTTP provider wiring')
    ).toBe(false);
    expect(isTestingRelatedQuery('')).toBe(false);
  });

  it('filters testing conflicts for non-testing prompts', () => {
    expect(
      shouldIncludePatternConflictCategory(
        'testingFramework',
        'Refactor AuthInterceptor registration and HTTP provider wiring'
      )
    ).toBe(false);
    expect(
      shouldIncludePatternConflictCategory(
        'testMocking',
        'Refactor AuthInterceptor registration and HTTP provider wiring'
      )
    ).toBe(false);
    expect(
      shouldIncludePatternConflictCategory('stateManagement', 'Refactor state service to signals')
    ).toBe(true);
  });

  it('keeps testing conflicts for testing prompts', () => {
    expect(
      shouldIncludePatternConflictCategory(
        'testingFramework',
        'Fix failing unit tests in auth service'
      )
    ).toBe(true);
  });
});
