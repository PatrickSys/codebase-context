import path from 'node:path';
import type { CodeChunk } from '../src/types/index.js';

/** Supplies source bytes at the existing mocked validation seam in ranking-only tests.
 * Real filesystem validation remains covered by search-source-validity.test.ts.
 */
export function mockCandidateSources(rootPath: string) {
  return async (chunks: Iterable<CodeChunk>, checkedSources: Map<string, string>) => {
    for (const chunk of chunks) {
      const sourcePath = path.resolve(rootPath, chunk.filePath);
      const lines = checkedSources.get(sourcePath)?.split('\n') ?? [];
      while (lines.length < chunk.endLine) lines.push('');
      const contentLines = chunk.content.replace(/\r\n/g, '\n').split('\n');
      contentLines.forEach((line, index) => {
        lines[chunk.startLine - 1 + index] = line;
      });
      checkedSources.set(sourcePath, lines.join('\n'));
    }
  };
}
