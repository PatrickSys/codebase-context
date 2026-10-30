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

  it('does not treat JWT or email Subject as RxJS', () => {
    const detector = new PatternDetector();
    detector.detectFromCode(
      'type Claims struct {\n\tSubject string `json:"sub"`\n}\n',
      'server/tokens/claims.go'
    );
    detector.detectFromCode(
      'body = b"""Subject: Undelivered Mail Returned to Sender\\n"""\n',
      'hc/api/tests/test_smtpd.py'
    );
    expect(detector.getAllPatterns().stateManagement).toBeUndefined();
  });

  it('tracks an rxjs import and BehaviorSubject as RxJS', () => {
    const imported = new PatternDetector();
    imported.detectFromCode(
      "import { Subject } from 'rxjs';\nconst events = new Subject<string>();\n",
      'src/events.ts'
    );
    expect(imported.getAllPatterns().stateManagement?.primary.name).toBe('RxJS');

    const typed = new PatternDetector();
    typed.detectFromCode(
      'export class AuthService { state = new BehaviorSubject(false); }\n',
      'src/auth.service.ts'
    );
    expect(typed.getAllPatterns().stateManagement?.primary.name).toBe('RxJS');
  });
});
