import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { handle } from '../src/tools/get-codebase-health.js';
import type { ToolContext } from '../src/tools/types.js';

async function createContextRoot(): Promise<{ root: string; ctx: ToolContext }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-health-tool-'));
  const healthPath = path.join(root, '.codebase-context', 'health.json');
  await fs.mkdir(path.dirname(healthPath), { recursive: true });

  const ctx: ToolContext = {
    indexState: { status: 'ready' },
    paths: {
      baseDir: path.join(root, '.codebase-context'),
      memory: path.join(root, '.codebase-context', 'memory.json'),
      intelligence: path.join(root, '.codebase-context', 'intelligence.json'),
      health: healthPath,
      keywordIndex: path.join(root, '.codebase-context', 'index.json'),
      vectorDb: path.join(root, '.codebase-context', 'index')
    },
    rootPath: root,
    performIndexing: () => undefined
  };

  return { root, ctx };
}

describe('get_codebase_health', () => {
  it('returns filtered top-risk files from health.json', async () => {
    const { root, ctx } = await createContextRoot();
    try {
      await fs.writeFile(
        ctx.paths.health,
        JSON.stringify(
          {
            header: { buildId: 'build-1', formatVersion: 1 },
            generatedAt: '2026-04-17T00:00:00.000Z',
            summary: {
              files: 2,
              highRiskFiles: 1,
              mediumRiskFiles: 1,
              lowRiskFiles: 0
            },
            files: [
              {
                file: 'src/auth/auth.service.ts',
                level: 'high',
                score: 5,
                reasons: ['High fan-in: 9 files depend on it']
              },
              {
                file: 'src/auth/token.store.ts',
                level: 'medium',
                score: 2,
                reasons: ['Moderate code complexity (cyclomatic 11)']
              }
            ]
          },
          null,
          2
        )
      );

      const response = await handle({ level: 'high' }, ctx);
      const payload = JSON.parse(response.content?.[0]?.text ?? '{}') as {
        status: string;
        files: Array<{ file: string; level: string }>;
      };

      expect(payload.status).toBe('success');
      expect(payload.files).toHaveLength(1);
      expect(payload.files[0]).toMatchObject({
        file: 'src/auth/auth.service.ts',
        level: 'high'
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns a single file record lookup', async () => {
    const { root, ctx } = await createContextRoot();
    try {
      await fs.writeFile(
        ctx.paths.health,
        JSON.stringify(
          {
            header: { buildId: 'build-2', formatVersion: 1 },
            generatedAt: '2026-04-17T00:00:00.000Z',
            summary: {
              files: 1,
              highRiskFiles: 1,
              mediumRiskFiles: 0,
              lowRiskFiles: 0
            },
            files: [
              {
                file: 'src/auth/auth.service.ts',
                level: 'high',
                score: 4,
                reasons: ['Hotspot rank #2 by graph centrality']
              }
            ]
          },
          null,
          2
        )
      );

      const response = await handle({ file: 'src/auth/auth.service.ts' }, ctx);
      const payload = JSON.parse(response.content?.[0]?.text ?? '{}') as {
        status: string;
        file?: { file: string; level: string; reasons: string[] };
      };

      expect(payload.status).toBe('success');
      expect(payload.file?.level).toBe('high');
      expect(payload.file?.reasons[0]).toContain('Hotspot rank');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
