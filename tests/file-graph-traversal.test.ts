import { describe, expect, it } from 'vitest';
import { InternalFileGraph, traverseFileGraph } from '../src/utils/usage-tracker.js';

describe('verified file graph traversal', () => {
  it('round-trips typed source proofs and returns a three-hop path with edge evidence', () => {
    const graph = new InternalFileGraph('C:/repo');
    graph.trackImport('C:/repo/src/a.ts', 'C:/repo/src/b.ts', 2, ['B'], {
      kind: 'import', specifier: './b', sourceFingerprint: 'sha256:a', targetFingerprint: 'sha256:b'
    });
    graph.trackImport('C:/repo/src/b.ts', 'C:/repo/src/c/index.ts', 4, [], {
      kind: 'reexport', specifier: '../c', sourceFingerprint: 'sha256:b', targetFingerprint: 'sha256:c'
    });
    graph.trackImport('C:/repo/src/c/index.ts', 'C:/repo/src/d.tsx', 1, [], {
      kind: 'import', specifier: '../d', sourceFingerprint: 'sha256:c', targetFingerprint: 'sha256:d'
    });
    graph.trackUnresolved('C:/repo/src/a.ts', {
      kind: 'import', line: 5, specifier: './missing', sourceFingerprint: 'sha256:a', targetFingerprint: ''
    }, 'not-found');

    const json = graph.toJSON();
    const restored = InternalFileGraph.fromJSON(json, 'C:/repo').toJSON();
    expect(Object.keys(restored.importDetails ?? {})).toHaveLength(3);
    expect(restored.importDetails?.['src/b.ts']?.['src/c/index.ts']?.sources?.[0]).toMatchObject({ kind: 'reexport', line: 4, specifier: '../c' });
    expect(restored.unresolvedEdges?.[0]?.reason).toBe('not-found');

    const result = traverseFileGraph(restored, 'src/a.ts', { direction: 'outgoing', maxHops: 3 });
    expect(result.paths.map((entry) => entry.nodes)).toContainEqual([
      'src/a.ts', 'src/b.ts', 'src/c/index.ts', 'src/d.tsx'
    ]);
    expect(result.paths.find((entry) => entry.nodes.length === 4)?.edges[1]).toMatchObject({
      kind: 'reexport', source: { line: 4, specifier: '../c', sourceFingerprint: 'sha256:b', targetFingerprint: 'sha256:c' }
    });
    expect(result.unresolved).toHaveLength(1);
  });

  it('supports incoming direction, caps hops and terminates cycles', () => {
    const graph = new InternalFileGraph('C:/repo');
    graph.trackImport('C:/repo/a.ts', 'C:/repo/b.ts', 1, [], { kind: 'import', specifier: './b', sourceFingerprint: 'a', targetFingerprint: 'b' });
    graph.trackImport('C:/repo/b.ts', 'C:/repo/c.ts', 2, [], { kind: 'import', specifier: './c', sourceFingerprint: 'b', targetFingerprint: 'c' });
    graph.trackImport('C:/repo/c.ts', 'C:/repo/d.ts', 3, [], { kind: 'import', specifier: './d', sourceFingerprint: 'c', targetFingerprint: 'd' });
    graph.trackImport('C:/repo/d.ts', 'C:/repo/a.ts', 4, [], { kind: 'import', specifier: './a', sourceFingerprint: 'd', targetFingerprint: 'a' });
    const serialized = graph.toJSON();

    const outgoing = traverseFileGraph(serialized, 'a.ts', { direction: 'outgoing', maxHops: 2 });
    expect(outgoing.paths.every((entry) => entry.edges.length <= 2)).toBe(true);
    expect(outgoing.truncated).toBe(false);
    const incoming = traverseFileGraph(serialized, 'd.ts', { direction: 'incoming', maxHops: 1 });
    expect(incoming.paths).toContainEqual({ nodes: ['d.ts', 'c.ts'], edges: [expect.objectContaining({ from: 'c.ts', to: 'd.ts' })] });
    const capped = traverseFileGraph(serialized, 'a.ts', { direction: 'outgoing', maxHops: 3, maxNodes: 2 });
    expect(capped.truncated).toBe(true);
    const outputCapped = traverseFileGraph(serialized, 'a.ts', { direction: 'outgoing', maxHops: 3, maxPaths: 1 });
    expect(outputCapped.paths).toHaveLength(1);
    expect(outputCapped.truncated).toBe(true);
  });

  it.each(['incoming', 'outgoing'] as const)('terminates a cycle reachable inside three hops in %s direction', (direction) => {
    const graph = new InternalFileGraph('C:/repo');
    const pairs = [['a.ts', 'b.ts'], ['b.ts', 'a.ts'], ['b.ts', 'c.ts'], ['c.ts', 'b.ts']] as const;
    for (const [from, to] of pairs) {
      graph.trackImport(`C:/repo/${from}`, `C:/repo/${to}`, 1, [], {
        kind: 'import', specifier: `./${to.slice(0, -3)}`, sourceFingerprint: from, targetFingerprint: to
      });
    }
    const result = traverseFileGraph(graph.toJSON(), 'a.ts', { direction, maxHops: 3 });
    expect(result.paths.map(({ nodes }) => nodes)).toEqual([['a.ts', 'b.ts'], ['a.ts', 'b.ts', 'c.ts']]);
    expect(result.truncated).toBe(false);
  });
});
