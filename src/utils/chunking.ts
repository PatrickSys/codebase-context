/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Code Chunking Utilities
 * Smart chunking that preserves semantic boundaries
 */

import { v4 as uuidv4 } from 'uuid';
import { CodeChunk, CodeComponent } from '../types/index.js';

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
    const contextStart = Math.max(0, startLine - 5);
    const contextEnd = Math.min(lines.length, endLine + 5);

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
export function mergeSmallChunks(chunks: CodeChunk[], minSize: number = 20): CodeChunk[] {
  if (chunks.length <= 1) return chunks;

  const merged: CodeChunk[] = [];
  let current = chunks[0];

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    const currentLines = current.content.split('\n').length;
    const nextLines = next.content.split('\n').length;

    if (currentLines < minSize && nextLines < minSize) {
      // Merge chunks
      current = {
        ...current,
        content: current.content + '\n' + next.content,
        endLine: next.endLine,
        metadata: {
          ...current.metadata,
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
