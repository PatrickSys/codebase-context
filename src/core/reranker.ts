/**
 * Stage-2 cross-encoder reranker for search results.
 *
 * Triggered by score ambiguity (clustered top scores), not by intent.
 * Uses a lightweight cross-encoder to re-score (query, passage) pairs,
 * converting high top-3 recall into better top-1 accuracy.
 *
 * Default model: Xenova/ms-marco-MiniLM-L-6-v2 (~22M params, ~80MB, CPU-safe).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SearchResult } from '../types/index.js';

const DEFAULT_RERANKER_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

/** How many top results to rerank (keeps latency bounded) */
const RERANK_TOP_K = 10;

/** Trigger reranking when the score gap between #1 and #3 is below this threshold */
const AMBIGUITY_THRESHOLD = 0.08;

let cachedTokenizer: any = null;
let cachedModel: any = null;
let initPromise: Promise<void> | null = null;

async function ensureModelLoaded(): Promise<void> {
  if (cachedModel && cachedTokenizer) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { AutoTokenizer, AutoModelForSequenceClassification } =
      await import('@huggingface/transformers');

    console.error(`[reranker] Loading cross-encoder: ${DEFAULT_RERANKER_MODEL}`);
    console.error('[reranker] (First run will download the model — this may take a moment)');

    cachedTokenizer = await AutoTokenizer.from_pretrained(DEFAULT_RERANKER_MODEL);
    cachedModel = await AutoModelForSequenceClassification.from_pretrained(DEFAULT_RERANKER_MODEL, {
      dtype: 'q8'
    });

    console.error('[reranker] Cross-encoder loaded successfully');
  })();

  return initPromise;
}

/**
 * Build a compact passage from a search result for cross-encoder scoring.
 * Keeps it short — cross-encoders are slow on long inputs.
 */
function buildPassage(result: SearchResult): string {
  const parts: string[] = [];

  // File path is critical signal
  parts.push(`path: ${result.filePath.replace(/\\/g, '/')}`);

  // Component type / layer if available
  if (result.componentType && result.componentType !== 'unknown') {
    parts.push(`type: ${result.componentType}`);
  }
  if (result.layer && result.layer !== 'unknown') {
    parts.push(`layer: ${result.layer}`);
  }

  // Summary is the most information-dense field
  if (result.summary) {
    parts.push(result.summary);
  }

  // Snippet: first ~500 chars (cross-encoder has 512-token context)
  if (result.snippet) {
    const trimmed = result.snippet.slice(0, 500);
    parts.push(trimmed);
  }

  return parts.join('\n');
}

/**
 * Score a single (query, passage) pair using the cross-encoder.
 * Returns a relevance score (higher = more relevant).
 */
async function scorePair(query: string, passage: string): Promise<number> {
  const inputs = cachedTokenizer(query, passage, {
    padding: true,
    truncation: true,
    max_length: 512
  });

  const output = await cachedModel(inputs);

  // Cross-encoder outputs a single logit for relevance
  const score = output.logits.data[0];
  return score;
}

/**
 * Detect whether the result set has ambiguous ordering.
 * Returns true when the top scores are clustered, meaning
 * the embedding model isn't confident about the ranking.
 */
export function isAmbiguous(results: SearchResult[]): boolean {
  if (results.length < 3) return false;

  const topScore = results[0].score;
  const thirdScore = results[Math.min(2, results.length - 1)].score;
  const gap = topScore - thirdScore;

  return gap < AMBIGUITY_THRESHOLD;
}

/**
 * Rerank the top-K results using a cross-encoder.
 * Only reranks when scores are ambiguous (clustered).
 * Returns the full result array with the top-K portion re-ordered.
 */
export async function rerank(query: string, results: SearchResult[]): Promise<SearchResult[]> {
  if (results.length <= 1) return results;
  if (!isAmbiguous(results)) return results;

  await ensureModelLoaded();

  const toRerank = results.slice(0, Math.min(RERANK_TOP_K, results.length));
  const rest = results.slice(toRerank.length);

  // Score each result against the query using the cross-encoder
  const scored: Array<{ result: SearchResult; crossScore: number }> = [];

  for (const result of toRerank) {
    const passage = buildPassage(result);
    const crossScore = await scorePair(query, passage);
    scored.push({ result, crossScore });
  }

  // Sort by cross-encoder score (descending)
  scored.sort((a, b) => b.crossScore - a.crossScore);

  // Rebuild the result array: reranked top-K + unchanged rest
  // Sigmoid normalizes raw logits to [0,1] so downstream quality gating works
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  const reranked = scored.map(({ result, crossScore }) => ({
    ...result,
    score: sigmoid(crossScore)
  }));

  return [...reranked, ...rest];
}
