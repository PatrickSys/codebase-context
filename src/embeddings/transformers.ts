import { EmbeddingProvider, DEFAULT_MODEL } from './types.js';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import os from 'os';

/**
 * Returns the number of ONNX intra-op threads to use.
 * Defaults to half of available CPU cores to prevent system freeze during indexing.
 * Override via CODEBASE_CONTEXT_ONNX_THREADS env var.
 */
function getOnnxThreadCount(): number {
  const envVal = process.env.CODEBASE_CONTEXT_ONNX_THREADS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return Math.max(1, Math.floor(os.cpus().length / 2));
}

interface ModelConfig {
  dimensions: number;
  maxContext: number; // token context window — used to auto-scale batch size
}

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'Xenova/bge-small-en-v1.5': { dimensions: 384, maxContext: 512 },
  'Xenova/all-MiniLM-L6-v2': { dimensions: 384, maxContext: 512 },
  'Xenova/bge-base-en-v1.5': { dimensions: 768, maxContext: 512 },
  'onnx-community/granite-embedding-small-english-r2-ONNX': { dimensions: 384, maxContext: 8192 }
};

/**
 * Compute a safe batch size for embedding that won't freeze consumer hardware.
 * Calibrated so 512-ctx models get batch=32, 8192-ctx models get batch=8.
 * Formula: floor(16384 / maxContext), clamped to [4, 32].
 */
function computeSafeBatchSize(modelName: string): number {
  const ctx = MODEL_CONFIGS[modelName]?.maxContext || 512;
  return Math.max(4, Math.min(32, Math.floor(16384 / ctx)));
}

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'transformers';
  readonly modelName: string;
  readonly dimensions: number;

  private pipeline: FeatureExtractionPipeline | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  constructor(modelName: string = DEFAULT_MODEL) {
    this.modelName = modelName;
    this.dimensions = MODEL_CONFIGS[modelName]?.dimensions || 384;
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      if (process.env.CODEBASE_CONTEXT_DEBUG) {
        console.error(`Loading embedding model: ${this.modelName}`);
        console.error('(First run will download the model - this may take a moment)');
      }

      const { pipeline } = await import('@huggingface/transformers');

      // TS2590: pipeline() resolves AllTasks[T] — a union too complex for TSC to represent.
      // Cast to a simpler feature-extraction signature for both v3 and v4-compatible types.
      type PipelineFn = (
        task: 'feature-extraction',
        model: string,
        opts: Record<string, unknown>
      ) => Promise<FeatureExtractionPipeline>;
      this.pipeline = await (pipeline as PipelineFn)('feature-extraction', this.modelName, {
        dtype: 'q8',
        // Limit ONNX Runtime to half cores by default — prevents system freeze during indexing.
        // interOpNumThreads: 1 — no benefit for single-model pipelines.
        // Override via CODEBASE_CONTEXT_ONNX_THREADS env var.
        session_options: {
          intraOpNumThreads: getOnnxThreadCount(),
          interOpNumThreads: 1
        }
      });

      this.ready = true;
      if (process.env.CODEBASE_CONTEXT_DEBUG) {
        console.error(`Model loaded successfully: ${this.modelName}`);
      }
    } catch (error) {
      console.error('Failed to initialize embedding model:', error);
      throw error;
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.ready) {
      await this.initialize();
    }

    if (!this.pipeline) throw new Error('Pipeline not initialized');

    try {
      const output = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true
      });

      return Array.from(output.data);
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw error;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.ready) {
      await this.initialize();
    }

    if (!this.pipeline) throw new Error('Pipeline not initialized');

    const embeddings: number[][] = [];
    const batchSize = computeSafeBatchSize(this.modelName);

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      const output = await this.pipeline(batch, {
        pooling: 'mean',
        normalize: true
      });
      embeddings.push(...(output.tolist() as number[][]));

      // Yield to event loop — allows signal handlers (SIGINT/SIGTERM) to fire during
      // tight embedding loops, keeping the system responsive during indexing.
      await new Promise<void>((resolve) => setImmediate(resolve));

      if (texts.length > 100 && (i + batchSize) % 100 === 0) {
        console.error(`Embedded ${Math.min(i + batchSize, texts.length)}/${texts.length} chunks`);
      }
    }

    return embeddings;
  }

  isReady(): boolean {
    return this.ready;
  }
}

export async function createEmbeddingProvider(
  modelName: string = DEFAULT_MODEL
): Promise<EmbeddingProvider> {
  const provider = new TransformersEmbeddingProvider(modelName);
  await provider.initialize();
  return provider;
}
