import type { CodeChunk } from '../types/index.js';

type SourceInterval = Pick<CodeChunk, 'startLine' | 'endLine' | 'content'>;

/** Raw persisted bodies span exactly their claimed normalized source lines. */
export function hasValidSourceLineSpan(chunk: SourceInterval): boolean {
  return (
    Number.isInteger(chunk.startLine) &&
    Number.isInteger(chunk.endLine) &&
    chunk.startLine >= 1 &&
    chunk.endLine >= chunk.startLine &&
    typeof chunk.content === 'string' &&
    chunk.content.split('\n').length === chunk.endLine - chunk.startLine + 1
  );
}

/** Partial AST bodies may occupy part of a line, but never invent surrounding text. */
export function isSourceBodyWithinInterval(
  chunk: SourceInterval,
  lines: readonly string[]
): boolean {
  return (
    hasValidSourceLineSpan(chunk) &&
    chunk.endLine <= lines.length &&
    lines
      .slice(chunk.startLine - 1, chunk.endLine)
      .join('\n')
      .includes(chunk.content)
  );
}
