/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Code Chunking Utilities
 * Smart chunking that preserves semantic boundaries
 */

import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { InvalidSourceChunkError } from '../errors/index.js';
import type { CodeChunk, CodeComponent } from '../types/index.js';

export interface ChunkingOptions {
  maxChunkSize?: number; // Max lines per chunk
  overlapSize?: number; // Lines of overlap between chunks
  preserveBoundaries?: boolean; // Try to chunk at function/class boundaries
}

const DEFAULT_OPTIONS: ChunkingOptions = {
  maxChunkSize: 50,
  overlapSize: 0,
  preserveBoundaries: true
};

/**
 * Create chunks from code content
 */
export async function createChunksFromCode(
  content: string,
  filePath: string,
  relativePath: string,
  language: string,
  components: CodeComponent[],
  metadata?: Record<string, any>
): Promise<CodeChunk[]> {
  const chunks: CodeChunk[] = [];
  const _lines = content.split('\n');

  // If we have components, create component-aware chunks
  if (components.length > 0) {
    chunks.push(
      ...createComponentChunks(content, filePath, relativePath, language, components, metadata)
    );
  } else {
    // Fall back to line-based chunking
    chunks.push(...createLineChunks(content, filePath, relativePath, language, metadata));
  }

  return chunks;
}

/**
 * Create chunks based on component boundaries
 */
function createComponentChunks(
  content: string,
  filePath: string,
  relativePath: string,
  language: string,
  components: CodeComponent[],
  metadata?: Record<string, any>
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split('\n');
  const contextPaddingBefore = metadata?.symbolAware ? 0 : 5;
  const contextPaddingAfter = metadata?.symbolAware ? 0 : 5;

  // Get imports section (usually at the top)
  const importLines: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith('import ') || line.trim().startsWith('from ')) {
      importLines.push(line);
    } else if (line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('/*')) {
      break;
    } else {
      importLines.push(line);
    }
  }
  const importSection = importLines.join('\n');

  // Create a chunk for each component
  for (const component of components) {
    const startLine = component.startLine - 1; // Convert to 0-indexed
    const endLine = component.endLine;

    // Extract component code with some context
    const contextStart = Math.max(0, startLine - contextPaddingBefore);
    const contextEnd = Math.min(lines.length, endLine + contextPaddingAfter);

    const componentLines = lines.slice(contextStart, contextEnd);
    const componentContent = componentLines.join('\n');

    // Calculate complexity
    const complexity = calculateComplexity(componentContent);

    // Generate tags
    const tags = generateTags(component, metadata);

    chunks.push({
      id: uuidv4(),
      content: componentContent,
      filePath,
      relativePath,
      startLine: contextStart + 1,
      endLine: contextEnd,
      language,
      framework: metadata?.framework,
      componentType: component.componentType,
      layer: metadata?.layer,
      dependencies: component.dependencies || [],
      imports: [], // Will be populated during analysis
      exports: [],
      tags,
      metadata: {
        ...metadata,
        componentName: component.name,
        componentType: component.componentType,
        complexity,
        importSection, // Keep imports as context in metadata
        lifecycle: component.lifecycle
      }
    });
  }

  return chunks;
}

/**
 * Create chunks based on line count with overlap
 */
function createLineChunks(
  content: string,
  filePath: string,
  relativePath: string,
  language: string,
  metadata?: Record<string, any>,
  options: ChunkingOptions = DEFAULT_OPTIONS
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split('\n');
  const { maxChunkSize = 100, overlapSize = 10 } = options;

  let startLine = 0;

  while (startLine < lines.length) {
    const endLine = Math.min(startLine + maxChunkSize, lines.length);
    const chunkLines = lines.slice(startLine, endLine);
    const chunkContent = chunkLines.join('\n');

    const complexity = calculateComplexity(chunkContent);

    chunks.push({
      id: uuidv4(),
      content: chunkContent,
      filePath,
      relativePath,
      startLine: startLine + 1,
      endLine,
      language,
      framework: metadata?.framework,
      layer: metadata?.layer,
      dependencies: [],
      imports: [],
      exports: [],
      tags: [],
      metadata: {
        ...metadata,
        complexity
      }
    });

    // Move to next chunk with overlap
    startLine = endLine - overlapSize;
    if (startLine >= lines.length - overlapSize) {
      break;
    }
  }

  return chunks;
}

/**
 * Calculate cyclomatic complexity of code
 */
export function calculateComplexity(code: string): number {
  let complexity = 1; // Base complexity

  // Count decision points
  const patterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\b\?\s*[^:]/g, // Ternary operator
    /&&/g,
    /\|\|/g
  ];

  for (const pattern of patterns) {
    const matches = code.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

/**
 * Generate tags for a component
 */
function generateTags(component: CodeComponent, metadata?: Record<string, any>): string[] {
  const tags: string[] = [];

  // Add component type as tag
  if (component.componentType) {
    tags.push(component.componentType);
  }

  // Add decorator names
  if (component.decorators) {
    for (const decorator of component.decorators) {
      tags.push(decorator.name.toLowerCase());
    }
  }

  // Add lifecycle hooks
  if (component.lifecycle) {
    for (const hook of component.lifecycle) {
      tags.push(hook.toLowerCase());
    }
  }

  // Add state management pattern
  if (metadata?.statePattern) {
    tags.push(metadata.statePattern);
  }

  // Add layer
  if (metadata?.layer) {
    tags.push(metadata.layer);
  }

  // Add framework
  if (metadata?.framework) {
    tags.push(metadata.framework);
  }

  // Add special tags based on metadata
  if (metadata?.isStandalone) {
    tags.push('standalone');
  }

  if (metadata?.hasRoutes) {
    tags.push('routing');
  }

  return [...new Set(tags)]; // Remove duplicates
}

/**
 * Merge adjacent chunks if they're small
 */
/** Validate producer evidence against the normalized source snapshot already analyzed. */
export function validateSourceChunks(
  chunks: CodeChunk[],
  source: { filePath: string; relativePath: string; content: string }
): void {
  const lines = source.content.split('\n');
  for (const chunk of chunks) {
    if (
      typeof chunk.filePath !== 'string' ||
      path.relative(path.resolve(source.filePath), path.resolve(chunk.filePath)) !== '' ||
      chunk.relativePath !== source.relativePath
    )
      throw new InvalidSourceChunkError(
        `Analyzer chunk belongs to another source: ${source.relativePath}`
      );
    if (
      !validLineSpan(chunk) ||
      chunk.endLine > lines.length ||
      !lines
        .slice(chunk.startLine - 1, chunk.endLine)
        .join('\n')
        .includes(chunk.content)
    )
      throw new InvalidSourceChunkError(
        `Analyzer chunk does not match its source interval: ${source.relativePath}:${chunk.startLine}-${chunk.endLine}`
      );
  }
}

function validLineSpan(chunk: CodeChunk): boolean {
  return (
    Number.isInteger(chunk.startLine) &&
    Number.isInteger(chunk.endLine) &&
    chunk.startLine >= 1 &&
    chunk.endLine >= chunk.startLine &&
    typeof chunk.content === 'string' &&
    chunk.content.split('\n').length === chunk.endLine - chunk.startLine + 1
  );
}

function mergeMetadata(chunk: CodeChunk): Record<string, unknown> {
  const { complexity: _complexity, merged: _merged, ...metadata } = chunk.metadata;
  return metadata;
}

export function mergeSmallChunks(chunks: CodeChunk[], minSize: number = 20): CodeChunk[] {
  if (chunks.length <= 1) return chunks;
  const merged: CodeChunk[] = [];
  let current = chunks[0];
  const unowned = (chunk: CodeChunk) =>
    ![
      'componentName',
      'className',
      'functionName',
      'symbolName',
      'symbolPath',
      'parentSymbol'
    ].some((key) => chunk.metadata[key] !== undefined);
  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    if (
      validLineSpan(current) &&
      validLineSpan(next) &&
      current.filePath === next.filePath &&
      current.relativePath === next.relativePath &&
      next.startLine === current.endLine + 1 &&
      current.language === next.language &&
      current.framework === next.framework &&
      current.componentType === next.componentType &&
      current.layer === next.layer &&
      current.embedding === undefined &&
      next.embedding === undefined &&
      !current.metadata.symbolAware &&
      !next.metadata.symbolAware &&
      unowned(current) &&
      unowned(next) &&
      isDeepStrictEqual(mergeMetadata(current), mergeMetadata(next)) &&
      current.content.split('\n').length < minSize &&
      next.content.split('\n').length < minSize
    ) {
      const content = current.content + '\n' + next.content;
      current = {
        ...current,
        content,
        endLine: next.endLine,
        dependencies: [...new Set([...current.dependencies, ...next.dependencies])],
        imports: [...new Set([...current.imports, ...next.imports])],
        exports: [...new Set([...current.exports, ...next.exports])],
        tags: [...new Set([...current.tags, ...next.tags])],
        metadata: {
          ...current.metadata,
          ...(typeof current.metadata.complexity === 'number' ||
          typeof next.metadata.complexity === 'number'
            ? { complexity: calculateComplexity(content) }
            : {}),
          merged: true
        }
      };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}
