/* eslint-disable @typescript-eslint/no-explicit-any */
import { EmbeddingProvider, DEFAULT_MODEL } from './types.js';

interface ModelConfig {
  dimensions: number;
  maxContext: number; // token context window — used to auto-scale batch size
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
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

  private pipeline: any = null;
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
      console.error(`Loading embedding model: ${this.modelName}`);
      console.error('(First run will download the model — this may take a moment)');

      const { pipeline } = await import('@huggingface/transformers');

      this.pipeline = await pipeline('feature-extraction', this.modelName, {
        dtype: 'q8'
      });

      this.ready = true;
      console.error(`Model loaded successfully: ${this.modelName}`);
    } catch (error) {
      console.error('Failed to initialize embedding model:', error);
      throw error;
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.ready) {
      await this.initialize();
    }

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

    const embeddings: number[][] = [];
    const batchSize = computeSafeBatchSize(this.modelName);

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      const output = await this.pipeline(batch, {
        pooling: 'mean',
        normalize: true
      });
      embeddings.push(...(output.tolist() as number[][]));

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
