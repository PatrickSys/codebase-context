import { describe, it, expect } from 'vitest';
import { PatternDetector } from '../src/utils/usage-tracker.js';

describe('PatternDetector testing categories', () => {
  it('tracks e2e without polluting testingFramework', () => {
    const detector = new PatternDetector();

    detector.detectFromCode(
      "import { test } from '@playwright/test'; test('smoke', async ({ page }) => { await page.goto('/'); });",
      'apps/app/e2e/session/session.spec.ts'
    );

    const patterns = detector.getAllPatterns();
    expect(patterns.e2eFramework?.primary.name).toBe('Playwright');
    expect(patterns.testingFramework).toBeUndefined();
  });

  it('keeps unit testingFramework classification for unit tests', () => {
    const detector = new PatternDetector();

    detector.detectFromCode(
      "describe('AuthService', () => { TestBed.configureTestingModule({}); jest.spyOn(service, 'load'); });",
      'libs/library/src/lib/auth/auth.service.spec.ts'
    );

    const patterns = detector.getAllPatterns();
    expect(patterns.unitTestFramework?.primary.name).toBe('Jest');
    expect(patterns.testingFramework?.primary.name).toBe('Jest');
  });
});
