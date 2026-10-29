import { expect, it } from 'vitest';
import { finalizeJsonTextPayload } from '../src/index.js';

it('keeps the final relationship text within budget after routing metadata is added', () => {
  const graphPayload = {
    status: 'success',
    file: 'packages/example/src/main.ts',
    direction: 'outgoing',
    maxHops: 3,
    paths: Array.from({ length: 16 }, (_, index) => ({
      nodes: [
        'packages/example/src/main.ts',
        `packages/example/src/branch-${index}-with-a-long-source-path.ts`
      ],
      edges: [
        {
          from: 'packages/example/src/main.ts',
          to: `packages/example/src/branch-${index}-with-a-long-source-path.ts`,
          kind: 'import',
          source: { line: index + 1, specifier: `./branch-${index}-with-a-long-source-path` }
        }
      ]
    })),
    unresolved: [],
    truncated: false,
    message:
      'Relationships are limited to verified imports and re-exports; dynamic calls are not inferred.'
  };
  const routedPayload = {
    ...graphPayload,
    index: { status: 'ready', lastIndexed: '2026-10-11T04:30:00.000Z', buildId: 'b'.repeat(64) },
    project: {
      id: 'p'.repeat(64),
      rootPath: 'C:/projects/consumer',
      source: 'root',
      label: 'consumer project'
    }
  };

  const finalText = finalizeJsonTextPayload(routedPayload, true);
  expect(Buffer.byteLength(finalText, 'utf8')).toBeLessThanOrEqual(4000);
  const finalized = JSON.parse(finalText) as {
    paths: unknown[];
    truncated: boolean;
    index: unknown;
    project: unknown;
  };
  expect(finalized.truncated).toBe(true);
  expect(finalized.paths.length).toBeGreaterThan(0);
  expect(finalized.index).toEqual(routedPayload.index);
  expect(finalized.project).toEqual(routedPayload.project);
});
