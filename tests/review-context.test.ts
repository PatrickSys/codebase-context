import { describe, expect, it } from 'vitest';
import {
  buildReviewContextPacket,
  buildReviewQueries,
  extractChangedIdentifiers,
  fingerprintDiff,
  inspectPatch,
  parseNameStatus,
  type ChangedFileContext
} from '../src/review-context.js';
import type { SearchResponse } from '../src/tools/types.js';

describe('review context', () => {
  it('parses modified, added, deleted and renamed files', () => {
    expect(
      parseNameStatus(['M\tsrc/a.ts', 'A\tsrc/b.ts', 'D\tsrc/c.ts', 'R100\tsrc/old.ts\tsrc/new.ts'].join('\n'))
    ).toEqual([
      { path: 'src/a.ts', status: 'M', rawStatus: 'M' },
      { path: 'src/b.ts', status: 'A', rawStatus: 'A' },
      { path: 'src/c.ts', status: 'D', rawStatus: 'D' },
      {
        path: 'src/new.ts',
        previousPath: 'src/old.ts',
        status: 'R',
        rawStatus: 'R100'
      }
    ]);
  });

  it('counts textual changes without treating diff headers as source', () => {
    const patch = [
      'diff --git a/src/auth.ts b/src/auth.ts',
      '--- a/src/auth.ts',
      '+++ b/src/auth.ts',
      '@@ -1,2 +1,3 @@',
      '-const oldToken = loadToken();',
      '+const refreshToken = loadRefreshToken();',
      '+return refreshToken;'
    ].join('\n');

    expect(inspectPatch(patch)).toEqual({ additions: 2, deletions: 1, binary: false });
  });

  it('detects binary patches', () => {
    expect(inspectPatch('diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ')).toEqual({
      additions: 0,
      deletions: 0,
      binary: true
    });
  });

  it('ranks semantic identifiers from changed lines and drops language noise', () => {
    const patch = [
      '-const token = auth.load();',
      '+const refreshToken = sessionService.loadRefreshToken();',
      '+return sessionService.rotateRefreshToken(refreshToken);',
      '+const SessionService = createSessionService();'
    ].join('\n');

    const identifiers = extractChangedIdentifiers(patch, 8);

    expect(identifiers).toContain('sessionService');
    expect(identifiers).toContain('refreshToken');
    expect(identifiers).toContain('rotateRefreshToken');
    expect(identifiers).not.toContain('const');
    expect(identifiers).not.toContain('return');
  });

  it('bounds review queries and falls back to file path signals', () => {
    const files: ChangedFileContext[] = [
      {
        path: 'src/auth/session-service.ts',
        status: 'M',
        rawStatus: 'M',
        additions: 10,
        deletions: 2,
        binary: false,
        identifiers: ['SessionService', 'refreshToken', 'rotateToken']
      },
      {
        path: 'src/http/request-guard.ts',
        status: 'M',
        rawStatus: 'M',
        additions: 2,
        deletions: 1,
        binary: false,
        identifiers: []
      }
    ];

    expect(buildReviewQueries(files, 1)).toEqual([
      {
        query: 'SessionService refreshToken rotateToken',
        sourceFiles: ['src/auth/session-service.ts'],
        identifiers: ['SessionService', 'refreshToken', 'rotateToken']
      }
    ]);

    expect(buildReviewQueries(files, 2)[1]).toEqual({
      query: 'request-guard http src',
      sourceFiles: ['src/http/request-guard.ts'],
      identifiers: ['request-guard', 'http', 'src']
    });
  });

  it('builds a deterministic bounded packet and keeps failed searches explicit', async () => {
    const rawDiff = [
      'diff --git a/src/auth.ts b/src/auth.ts',
      '--- a/src/auth.ts',
      '+++ b/src/auth.ts',
      '@@ -1 +1 @@',
      '-oldSession();',
      '+rotateSessionToken();'
    ].join('\n');

    const searchCalls: string[] = [];
    const search = async (query: string): Promise<SearchResponse> => {
      searchCalls.push(query);
      return {
        status: 'ok',
        searchQuality: { status: 'ok', confidence: 0.91 },
        results: [
          {
            file: 'src/session/store.ts:10-24',
            summary: 'Session token storage',
            score: 0.88,
            snippet: 'export function rotateSessionToken() { return true; }'
          }
        ]
      };
    };

    const packet = await buildReviewContextPacket({
      base: 'origin/main',
      head: 'HEAD',
      baseCommit: 'a'.repeat(40),
      headCommit: 'b'.repeat(40),
      rawDiff,
      changedFiles: [{ path: 'src/auth.ts', status: 'M', rawStatus: 'M' }],
      patchesByPath: new Map([['src/auth.ts', rawDiff]]),
      maxQueries: 2,
      maxResultsPerQuery: 1,
      search
    });

    expect(packet.schemaVersion).toBe('review-context-v1');
    expect(packet.diffSha256).toBe(fingerprintDiff(rawDiff));
    expect(packet.summary).toEqual({
      filesChanged: 1,
      additions: 1,
      deletions: 1,
      queryCount: 1,
      relatedResultCount: 1
    });
    expect(searchCalls).toEqual(['rotateSessionToken oldSession']);
    expect(packet.searches[0]?.results[0]?.file).toBe('src/session/store.ts:10-24');
  });
});
