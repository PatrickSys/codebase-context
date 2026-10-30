import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { mergeSmallChunks, validateSourceChunks } from '../src/utils/chunking.js';
import { CodebaseIndexer } from '../src/core/indexer.js';
import { analyzerRegistry } from '../src/core/analyzer-registry.js';
import { GenericAnalyzer } from '../src/analyzers/generic/index.js';
import { AngularAnalyzer } from '../src/analyzers/angular/index.js';
import { InvalidSourceChunkError } from '../src/errors/index.js';
import { ReactAnalyzer } from '../src/analyzers/react/index.js';
import { resolveIndexArtifact } from '../src/core/index-generation.js';
import type { CodeChunk } from '../src/types/index.js';
let root = '';
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = '';
});
function chunk(
  startLine: number,
  endLine: number,
  content: string,
  overrides: Partial<CodeChunk> = {}
): CodeChunk {
  return {
    id: `${startLine}-${endLine}`,
    filePath: '/project/source.ts',
    relativePath: 'source.ts',
    startLine,
    endLine,
    content,
    language: 'typescript',
    dependencies: [],
    imports: [],
    exports: [],
    tags: [],
    metadata: {},
    ...overrides
  };
}
it.each([
  { name: 'reverse', first: chunk(20, 20, 'late'), second: chunk(1, 1, 'early') },
  { name: 'gap', first: chunk(1, 1, 'early'), second: chunk(3, 3, 'late') },
  { name: 'overlap', first: chunk(1, 2, 'a\nb'), second: chunk(2, 3, 'b\nc') },
  {
    name: 'foreign file',
    first: chunk(1, 1, 'a'),
    second: chunk(2, 2, 'b', { filePath: '/project/other.ts' })
  },
  {
    name: 'independent owners',
    first: chunk(1, 1, 'a', { metadata: { componentName: 'First' } }),
    second: chunk(2, 2, 'b', { metadata: { componentName: 'Second' } })
  },
  {
    name: 'different metadata',
    first: chunk(1, 1, 'a', { metadata: { framework: 'one' } }),
    second: chunk(2, 2, 'b', { metadata: { framework: 'two' } })
  }
])('keeps $name chunks as independent source evidence', ({ first, second }) => {
  expect(mergeSmallChunks([first, second], 15)).toEqual([first, second]);
});
it('merges a legal contiguous interval while retaining imports, exports and dependency tags', () => {
  const first = chunk(1, 1, 'a', {
    dependencies: ['one'],
    imports: ['first'],
    exports: ['A'],
    tags: ['left']
  });
  const second = chunk(2, 2, 'b', {
    dependencies: ['two'],
    imports: ['second'],
    exports: ['B'],
    tags: ['right']
  });
  const result = mergeSmallChunks([first, second], 15);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    startLine: 1,
    endLine: 2,
    content: 'a\nb',
    dependencies: ['one', 'two'],
    imports: ['first', 'second'],
    exports: ['A', 'B'],
    tags: ['left', 'right']
  });
});
it('persists actual React TSX chunks whose bodies and intervals match the analyzed file', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-react-source-integrity-'));
  analyzerRegistry.register(new ReactAnalyzer());
  const source = [
    'export const First = () => <div>render escaped child nodes</div>',
    ...Array(20).fill(''),
    'export const Second = () => <span>render escaped child nodes</span>',
    ''
  ].join('\n');
  await fs.writeFile(path.join(root, 'components.tsx'), source);
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'span-fixture', dependencies: { react: '19.0.0' } })
  );
  await new CodebaseIndexer({ rootPath: root, config: { skipEmbedding: true } }).index();
  const index: { chunks: CodeChunk[] } = JSON.parse(
    await fs.readFile(await resolveIndexArtifact(root, 'index.json'), 'utf8')
  );
  const spans = index.chunks.filter((item) => item.relativePath === 'components.tsx');
  expect(spans.length).toBeGreaterThanOrEqual(2);
  for (const item of spans) {
    expect(item.startLine).toBeGreaterThanOrEqual(1);
    expect(item.endLine).toBeGreaterThanOrEqual(item.startLine);
    expect(
      source
        .split('\n')
        .slice(item.startLine - 1, item.endLine)
        .join('\n')
    ).toContain(item.content);
  }
});

it.each([
  {
    source: 'const alpha = "😀"; function x() { return alpha }',
    start: 1,
    end: 1,
    body: 'function x() { return alpha }'
  },
  { source: 'repeat\nrepeat\n', start: 2, end: 2, body: 'repeat' },
  { source: 'first\nsecond\n', start: 1, end: 3, body: 'first\nsecond\n' },
  { source: '  <span>α</span>\n  child', start: 1, end: 2, body: '<span>α</span>\n  child' }
])('accepts exact source evidence $start–$end', ({ source, start, end, body }) => {
  expect(() =>
    validateSourceChunks([chunk(start, end, body)], {
      filePath: '/project/source.ts',
      relativePath: 'source.ts',
      content: source
    })
  ).not.toThrow();
});
it.each([
  chunk(1, 1, '// Scope: invented\nactual'),
  chunk(1, 2, 'only one line'),
  chunk(0, 1, 'x'),
  chunk(2, 1, 'x'),
  chunk(1, 1, 'absent'),
  chunk(1, 1, 'actual', { filePath: '/project/foreign.ts' })
])('rejects fabricated producer evidence $id', (candidate) => {
  expect(() =>
    validateSourceChunks([candidate], {
      filePath: '/project/source.ts',
      relativePath: 'source.ts',
      content: 'actual\n'
    })
  ).toThrow(InvalidSourceChunkError);
});
it.each([
  [
    'generic',
    'file.ts',
    '// α😀\r\nexport const repeat = "x"; export function one() { return repeat }\r\nexport function two() { return repeat }\r\n'
  ],
  [
    'angular',
    'component.ts',
    'import { Component } from "@angular/core";\r\n@Component({ selector: "app-test", template: "<p>α</p>" })\r\nexport class ExampleComponent { value = "😀"; }\r\n'
  ]
])('indexes real %s source with raw padded/partial bodies', async (analyzer, file, source) => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-source-boundary-'));
  analyzerRegistry.register(new GenericAnalyzer());
  analyzerRegistry.register(new AngularAnalyzer());
  await fs.writeFile(path.join(root, file), source);
  await new CodebaseIndexer({
    rootPath: root,
    config: { skipEmbedding: true },
    projectOptions: { preferredAnalyzer: analyzer }
  }).index();
  const index: { chunks: CodeChunk[] } = JSON.parse(
    await fs.readFile(await resolveIndexArtifact(root, 'index.json'), 'utf8')
  );
  const selected = index.chunks.filter((item) => item.relativePath === file);
  expect(selected.length).toBeGreaterThan(0);
  expect(() =>
    validateSourceChunks(selected, {
      filePath: path.join(root, file),
      relativePath: file,
      content: source.replace(/\r\n/g, '\n')
    })
  ).not.toThrow();
});
it('aborts malformed producer output instead of publishing a silently skipped file', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-source-fatal-'));
  analyzerRegistry.register(new GenericAnalyzer());
  const file = path.join(root, 'file.ts');
  await fs.writeFile(file, 'export const value = 1;');
  await new CodebaseIndexer({
    rootPath: root,
    config: { skipEmbedding: true },
    projectOptions: { preferredAnalyzer: 'generic' }
  }).index();
  const pointer = path.join(root, '.codebase-context', 'index-meta.json');
  const before = await fs.readFile(pointer);
  const analyze = analyzerRegistry.analyzeFile.bind(analyzerRegistry);
  vi.spyOn(analyzerRegistry, 'analyzeFile').mockImplementation(async (...args) => {
    const result = await analyze(...args);
    if (result?.chunks[0]) result.chunks[0].endLine = 0;
    return result;
  });
  await expect(
    new CodebaseIndexer({
      rootPath: root,
      config: { skipEmbedding: true },
      projectOptions: { preferredAnalyzer: 'generic' }
    }).index()
  ).rejects.toBeInstanceOf(InvalidSourceChunkError);
  expect(await fs.readFile(pointer)).toEqual(before);
});

it('keeps ordinary per-file parse failures visible without making them producer-integrity failures', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbc-source-parse-'));
  analyzerRegistry.register(new GenericAnalyzer());
  await fs.writeFile(path.join(root, 'good.ts'), 'export const good = 1;');
  await fs.writeFile(path.join(root, 'bad.ts'), 'invalid source');
  const analyze = analyzerRegistry.analyzeFile.bind(analyzerRegistry);
  vi.spyOn(analyzerRegistry, 'analyzeFile').mockImplementation(async (...args) => {
    if (path.basename(args[0]) === 'bad.ts')
      throw new SyntaxError('ordinary analyzer parse failure');
    return analyze(...args);
  });
  const stats = await new CodebaseIndexer({
    rootPath: root,
    config: { skipEmbedding: true },
    projectOptions: { preferredAnalyzer: 'generic' }
  }).index();
  expect(stats.errors).toHaveLength(1);
  expect(stats.errors[0].error).toBe('ordinary analyzer parse failure');
  const index: { chunks: CodeChunk[] } = JSON.parse(
    await fs.readFile(await resolveIndexArtifact(root, 'index.json'), 'utf8')
  );
  expect(index.chunks.some((item) => item.relativePath === 'good.ts')).toBe(true);
  expect(index.chunks.some((item) => item.relativePath === 'bad.ts')).toBe(false);
});
