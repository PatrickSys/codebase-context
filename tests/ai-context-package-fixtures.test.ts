import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

interface TaskManifest {
  claimBearing: boolean;
  targets: Array<{ id: string; packageName: string; packageVersion: string }>;
  tasks: Array<{ id: string; targetId: string; expectedReadyToEdit: boolean }>;
}

interface GoldContextRecord {
  taskId: string;
  requiredFiles: string[];
  requiredSpans: Array<{ file: string; startLine: number; endLine: number }>;
}

describe('AI context package eval fixture freeze', () => {
  it('freezes 20+ tasks across multiple public packages before implementation claims', async () => {
    const manifest = await readJson<TaskManifest>('tests/fixtures/ai-context-package-task-manifest.json');
    const goldContext = await readJsonl<GoldContextRecord>(
      'tests/fixtures/ai-context-package-gold-context.jsonl'
    );

    expect(manifest.claimBearing).toBe(false);
    expect(manifest.targets.length).toBeGreaterThanOrEqual(2);
    expect(manifest.tasks.length).toBeGreaterThanOrEqual(20);

    const targetIds = new Set(manifest.targets.map((target) => target.id));
    expect(new Set(manifest.tasks.map((task) => task.targetId)).size).toBeGreaterThanOrEqual(2);
    for (const task of manifest.tasks) {
      expect(targetIds.has(task.targetId)).toBe(true);
      expect(typeof task.expectedReadyToEdit).toBe('boolean');
    }

    const goldByTask = new Set(goldContext.map((record) => record.taskId));
    for (const task of manifest.tasks) {
      expect(goldByTask.has(task.id)).toBe(true);
    }

    for (const record of goldContext) {
      expect(record.requiredFiles.length).toBeGreaterThan(0);
      expect(record.requiredSpans.length).toBeGreaterThan(0);
    }
  });
});

async function readJson<T>(relativePath: string): Promise<T> {
  const content = await fs.readFile(path.resolve(relativePath), 'utf-8');
  return JSON.parse(content) as T;
}

async function readJsonl<T>(relativePath: string): Promise<T[]> {
  const content = await fs.readFile(path.resolve(relativePath), 'utf-8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
