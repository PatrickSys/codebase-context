import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CodebaseSearcher } from '../../src/core/search.js';
import {
  hashFileContent,
  readManifest,
  writeManifest,
  type FileManifest
} from '../../src/core/manifest.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  MANIFEST_FILENAME
} from '../../src/constants/codebase-context.js';
import type { CodeChunk } from '../../src/types/index.js';

export interface SourceSnapshot {
  rootPath: string;
  manifest: FileManifest;
  cleanup: () => Promise<void>;
}

export interface SearcherTestHarness {
  initialized: boolean;
  sourceManifest: FileManifest | null;
  embeddingProvider: unknown;
  storageProvider: unknown;
  fuseIndex: unknown;
  patternIntelligence: unknown;
  semanticSearch: unknown;
  keywordSearch: unknown;
  collectHybridMatches: unknown;
  search: CodebaseSearcher['search'];
}

export function asSearcherTestHarness(searcher: CodebaseSearcher): SearcherTestHarness {
  return searcher as unknown as SearcherTestHarness;
}

function toRelativeSourcePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const relativePath = normalized.replace(/^[A-Za-z]:\/repo\//i, '').replace(/^\/repo\//, '');
  if (path.isAbsolute(relativePath) || relativePath.split('/').includes('..')) {
    throw new Error(`Fixture source path must be relative to the synthetic repo: ${filePath}`);
  }
  return relativePath;
}

/** Materialize indexed chunks as a confined source tree plus the standard file manifest. */
export async function materializeSourceSnapshot(
  chunks: CodeChunk[],
  prefix = 'search-source-fixture-'
): Promise<SourceSnapshot> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    const byRelativePath = new Map<string, CodeChunk[]>();
    for (const chunk of chunks) {
      const relativePath = toRelativeSourcePath(chunk.filePath);
      const sameFile = byRelativePath.get(relativePath) ?? [];
      sameFile.push(chunk);
      byRelativePath.set(relativePath, sameFile);
    }

    const files: Record<string, string> = {};
    for (const [relativePath, fileChunks] of byRelativePath) {
      const finalLine = Math.max(...fileChunks.map((chunk) => chunk.endLine));
      const lines = Array(Math.max(finalLine, 1)).fill('') as string[];
      for (const chunk of fileChunks) {
        const contentLines = chunk.content.split('\n');
        contentLines.forEach((line, offset) => {
          const lineIndex = chunk.startLine - 1 + offset;
          if (lineIndex < lines.length) lines[lineIndex] = line;
        });
      }

      const content = `${lines.join('\n')}\n`;
      const sourcePath = path.join(rootPath, ...relativePath.split('/'));
      await fs.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.writeFile(sourcePath, content);
      files[relativePath] = hashFileContent(content);
      for (const chunk of fileChunks) {
        chunk.filePath = sourcePath;
        chunk.relativePath = relativePath;
      }
    }

    const manifestPath = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME, MANIFEST_FILENAME);
    await writeManifest(manifestPath, {
      version: 1,
      generatedAt: new Date().toISOString(),
      files
    });
    const manifest = await readManifest(manifestPath);
    if (!manifest) throw new Error('Could not read generated source fixture manifest');
    return {
      rootPath,
      manifest,
      cleanup: () => fs.rm(rootPath, { recursive: true, force: true })
    };
  } catch (error) {
    await fs.rm(rootPath, { recursive: true, force: true });
    throw error;
  }
}
