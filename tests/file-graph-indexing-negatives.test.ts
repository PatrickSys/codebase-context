import { afterAll, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { CODEBASE_CONTEXT_DIRNAME, RELATIONSHIPS_FILENAME } from '../src/constants/codebase-context.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-graph-negative-'));
afterAll(async () => fs.rm(root, { recursive: true, force: true }));

it('never serializes a guessed .ts target when only a differently named target or no target exists', async () => {
  const source = path.join(root, 'src');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'entry.ts'), "import './missing';\nimport './present';\n");
  await fs.writeFile(path.join(source, 'present.tsx'), 'export const present = true;\n');
  const indexer = new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } });
  await indexer.index();

  const sidecarPath = path.join(root, CODEBASE_CONTEXT_DIRNAME, RELATIONSHIPS_FILENAME);
  const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8')) as {
    graph: { imports: Record<string, string[]>; importDetails?: Record<string, Record<string, { sources?: Array<{ specifier: string }> }>>; unresolvedEdges?: Array<{ source: { specifier: string }; reason: string }> };
  };
  const importer = Object.keys(sidecar.graph.imports).find((file) => file.endsWith('src/entry.ts'));
  expect(importer).toBeDefined();
  const targets = sidecar.graph.imports[importer ?? ''] ?? [];
  expect(targets).toContain('src/present.tsx');
  expect(targets).not.toContain('src/missing.ts');
  expect(sidecar.graph.unresolvedEdges).toContainEqual(expect.objectContaining({
    source: expect.objectContaining({ specifier: './missing' }), reason: 'not-found'
  }));
});
