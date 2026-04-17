import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';

import {
  CODEBASE_CONTEXT_DIRNAME,
  HEALTH_FILENAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_FILENAME,
  INDEX_META_VERSION,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  RELATIONSHIPS_FILENAME,
  VECTOR_DB_DIRNAME
} from '../constants/codebase-context.js';
import { IndexCorruptedError } from '../errors/index.js';

const ArtifactHeaderSchema = z.object({
  buildId: z.string().min(1),
  formatVersion: z.number().int().nonnegative()
});

const KeywordIndexFileSchema = z.object({
  header: ArtifactHeaderSchema,
  chunks: z.array(z.unknown())
});

const VectorDbBuildSchema = z.object({
  buildId: z.string().min(1),
  formatVersion: z.number().int().nonnegative()
});

const IntelligenceFileSchema = z
  .object({
    header: ArtifactHeaderSchema
  })
  .passthrough();

const RelationshipsFileSchema = z
  .object({
    header: ArtifactHeaderSchema
  })
  .passthrough();

const HealthFileSchema = z.object({
  header: ArtifactHeaderSchema,
  generatedAt: z.string().datetime(),
  summary: z
    .object({
      files: z.number().int().nonnegative(),
      highRiskFiles: z.number().int().nonnegative(),
      mediumRiskFiles: z.number().int().nonnegative(),
      lowRiskFiles: z.number().int().nonnegative()
    })
    .passthrough(),
  files: z.array(
    z
      .object({
        file: z.string().min(1),
        level: z.enum(['low', 'medium', 'high']),
        score: z.number().nonnegative(),
        reasons: z.array(z.string()),
        signals: z.record(z.string(), z.number()).optional()
      })
      .passthrough()
  )
});

export const IndexMetaSchema = z.object({
  metaVersion: z.number().int().positive(),
  formatVersion: z.number().int().nonnegative(),
  buildId: z.string().min(1),
  generatedAt: z.string().datetime(),
  toolVersion: z.string().min(1),
  artifacts: z
    .object({
      keywordIndex: z.object({
        path: z.string().min(1)
      }),
      vectorDb: z.object({
        path: z.string().min(1),
        provider: z.string().min(1),
        embeddingProvider: z.string().optional(),
        embeddingModel: z.string().optional()
      }),
      intelligence: z
        .object({
          path: z.string().min(1)
        })
        .optional(),
      health: z
        .object({
          path: z.string().min(1)
        })
        .optional()
    })
    .passthrough()
});

export type IndexMeta = z.infer<typeof IndexMetaSchema>;

export function checkEmbeddingMismatch(
  meta: IndexMeta,
  currentProvider: string,
  currentModel: string
): boolean {
  const stored = meta.artifacts.vectorDb;
  if (!stored.embeddingProvider || !stored.embeddingModel) return false; // legacy index, no info
  return stored.embeddingProvider !== currentProvider || stored.embeddingModel !== currentModel;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function requireFile(targetPath: string, label: string): Promise<void> {
  if (!(await pathExists(targetPath))) {
    throw new IndexCorruptedError(`${label} missing: ${targetPath}`);
  }
}

async function requireDirectory(targetPath: string, label: string): Promise<void> {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      throw new IndexCorruptedError(`${label} is not a directory: ${targetPath}`);
    }
  } catch (error) {
    if (error instanceof IndexCorruptedError) throw error;
    throw new IndexCorruptedError(`${label} missing: ${targetPath}`);
  }
}

function asIndexCorrupted(message: string, error: unknown): IndexCorruptedError {
  const suffix = error instanceof Error ? error.message : String(error);
  return new IndexCorruptedError(`${message}: ${suffix}`);
}

export async function readIndexMeta(rootDir: string): Promise<IndexMeta> {
  const metaPath = path.join(rootDir, CODEBASE_CONTEXT_DIRNAME, INDEX_META_FILENAME);

  let parsed: unknown;
  try {
    const raw = await fs.readFile(metaPath, 'utf-8');
    parsed = JSON.parse(raw);
  } catch (error) {
    throw asIndexCorrupted('Index meta missing or unreadable (rebuild required)', error);
  }

  const result = IndexMetaSchema.safeParse(parsed);
  if (!result.success) {
    throw new IndexCorruptedError(
      `Index meta schema mismatch (rebuild required): ${result.error.message}`
    );
  }

  const meta = result.data;

  if (meta.metaVersion !== INDEX_META_VERSION) {
    throw new IndexCorruptedError(
      `Index meta version mismatch (rebuild required): expected metaVersion=${INDEX_META_VERSION}, found metaVersion=${meta.metaVersion}`
    );
  }

  if (meta.formatVersion !== INDEX_FORMAT_VERSION) {
    throw new IndexCorruptedError(
      `Index format version mismatch (rebuild required): expected formatVersion=${INDEX_FORMAT_VERSION}, found formatVersion=${meta.formatVersion}`
    );
  }

  return meta;
}

export async function validateIndexArtifacts(rootDir: string, meta: IndexMeta): Promise<void> {
  const contextDir = path.join(rootDir, CODEBASE_CONTEXT_DIRNAME);

  const keywordPath = path.join(contextDir, KEYWORD_INDEX_FILENAME);
  const vectorDir = path.join(contextDir, VECTOR_DB_DIRNAME);
  const vectorBuildPath = path.join(vectorDir, 'index-build.json');

  await requireFile(keywordPath, 'Keyword index');
  await requireDirectory(vectorDir, 'Vector DB directory');
  await requireFile(vectorBuildPath, 'Vector DB build marker');

  // Keyword index header (required)
  try {
    const raw = await fs.readFile(keywordPath, 'utf-8');
    const json = JSON.parse(raw);
    const parsed = KeywordIndexFileSchema.safeParse(json);
    if (!parsed.success) {
      throw new IndexCorruptedError(
        `Keyword index schema mismatch (rebuild required): ${parsed.error.message}`
      );
    }

    const { buildId, formatVersion } = parsed.data.header;
    if (formatVersion !== meta.formatVersion) {
      throw new IndexCorruptedError(
        `Keyword index formatVersion mismatch (rebuild required): meta=${meta.formatVersion}, index.json=${formatVersion}`
      );
    }
    if (buildId !== meta.buildId) {
      throw new IndexCorruptedError(
        `Keyword index buildId mismatch (rebuild required): meta=${meta.buildId}, index.json=${buildId}`
      );
    }
  } catch (error) {
    if (error instanceof IndexCorruptedError) throw error;
    throw asIndexCorrupted('Keyword index corrupted (rebuild required)', error);
  }

  // Vector DB build marker (required)
  try {
    const raw = await fs.readFile(vectorBuildPath, 'utf-8');
    const json = JSON.parse(raw);
    const parsed = VectorDbBuildSchema.safeParse(json);
    if (!parsed.success) {
      throw new IndexCorruptedError(
        `Vector DB build marker schema mismatch (rebuild required): ${parsed.error.message}`
      );
    }

    const { buildId, formatVersion } = parsed.data;
    if (formatVersion !== meta.formatVersion) {
      throw new IndexCorruptedError(
        `Vector DB formatVersion mismatch (rebuild required): meta=${meta.formatVersion}, index-build.json=${formatVersion}`
      );
    }
    if (buildId !== meta.buildId) {
      throw new IndexCorruptedError(
        `Vector DB buildId mismatch (rebuild required): meta=${meta.buildId}, index-build.json=${buildId}`
      );
    }
  } catch (error) {
    if (error instanceof IndexCorruptedError) throw error;
    throw asIndexCorrupted('Vector DB build marker corrupted (rebuild required)', error);
  }

  // Optional intelligence artifact: validate if present, but do not require.
  const intelligencePath = path.join(contextDir, INTELLIGENCE_FILENAME);
  if (await pathExists(intelligencePath)) {
    try {
      const raw = await fs.readFile(intelligencePath, 'utf-8');
      const json = JSON.parse(raw);
      const parsed = IntelligenceFileSchema.safeParse(json);
      if (!parsed.success) {
        throw new IndexCorruptedError(
          `Intelligence schema mismatch (rebuild required): ${parsed.error.message}`
        );
      }

      const { buildId, formatVersion } = parsed.data.header;
      if (formatVersion !== meta.formatVersion) {
        throw new IndexCorruptedError(
          `Intelligence formatVersion mismatch (rebuild required): meta=${meta.formatVersion}, intelligence.json=${formatVersion}`
        );
      }
      if (buildId !== meta.buildId) {
        throw new IndexCorruptedError(
          `Intelligence buildId mismatch (rebuild required): meta=${meta.buildId}, intelligence.json=${buildId}`
        );
      }
    } catch (error) {
      if (error instanceof IndexCorruptedError) throw error;
      throw asIndexCorrupted('Intelligence corrupted (rebuild required)', error);
    }
  }

  // Optional relationships sidecar: validate if present, but do not require.
  const relationshipsPath = path.join(contextDir, RELATIONSHIPS_FILENAME);
  if (await pathExists(relationshipsPath)) {
    try {
      const raw = await fs.readFile(relationshipsPath, 'utf-8');
      const json = JSON.parse(raw);
      const parsed = RelationshipsFileSchema.safeParse(json);
      if (!parsed.success) {
        throw new IndexCorruptedError(
          `Relationships schema mismatch (rebuild required): ${parsed.error.message}`
        );
      }

      const { buildId, formatVersion } = parsed.data.header;
      if (formatVersion !== meta.formatVersion) {
        throw new IndexCorruptedError(
          `Relationships formatVersion mismatch (rebuild required): meta=${meta.formatVersion}, relationships.json=${formatVersion}`
        );
      }
      if (buildId !== meta.buildId) {
        throw new IndexCorruptedError(
          `Relationships buildId mismatch (rebuild required): meta=${meta.buildId}, relationships.json=${buildId}`
        );
      }
    } catch (error) {
      if (error instanceof IndexCorruptedError) throw error;
      throw asIndexCorrupted('Relationships sidecar corrupted (rebuild required)', error);
    }
  }

  // Optional health sidecar: validate if present, but do not require.
  const healthPath = path.join(contextDir, HEALTH_FILENAME);
  if (await pathExists(healthPath)) {
    try {
      const raw = await fs.readFile(healthPath, 'utf-8');
      const json = JSON.parse(raw);
      const parsed = HealthFileSchema.safeParse(json);
      if (!parsed.success) {
        throw new IndexCorruptedError(
          `Health schema mismatch (rebuild required): ${parsed.error.message}`
        );
      }

      const { buildId, formatVersion } = parsed.data.header;
      if (formatVersion !== meta.formatVersion) {
        throw new IndexCorruptedError(
          `Health formatVersion mismatch (rebuild required): meta=${meta.formatVersion}, health.json=${formatVersion}`
        );
      }
      if (buildId !== meta.buildId) {
        throw new IndexCorruptedError(
          `Health buildId mismatch (rebuild required): meta=${meta.buildId}, health.json=${buildId}`
        );
      }
    } catch (error) {
      if (error instanceof IndexCorruptedError) throw error;
      throw asIndexCorrupted('Health sidecar corrupted (rebuild required)', error);
    }
  }
}
