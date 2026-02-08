import { promises as fs } from 'fs';
import path from 'path';
import type { Memory, MemoryCategory, MemoryType } from '../types/index.js';

type RawMemory = Partial<{
  id: unknown;
  type: unknown;
  category: unknown;
  memory: unknown;
  decision: unknown;
  reason: unknown;
  date: unknown;
  source: unknown;
}>;

export type MemoryFilters = {
  category?: MemoryCategory;
  type?: MemoryType;
  query?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeMemory(raw: unknown): Memory | null {
  if (!isRecord(raw)) return null;
  const m = raw as RawMemory;

  const id = typeof m.id === 'string' ? m.id : undefined;
  const type = typeof m.type === 'string' ? (m.type as MemoryType) : 'decision';
  const category = typeof m.category === 'string' ? (m.category as MemoryCategory) : undefined;
  const memory =
    typeof m.memory === 'string'
      ? m.memory
      : typeof m.decision === 'string'
        ? m.decision
        : undefined;
  const reason = typeof m.reason === 'string' ? m.reason : undefined;
  const date = typeof m.date === 'string' ? m.date : undefined;

  if (!id || !category || !memory || !reason || !date) return null;

  const source = m.source === 'git' ? 'git' as const : undefined;
  return { id, type, category, memory, reason, date, ...(source && { source }) };
}

export function normalizeMemories(raw: unknown): Memory[] {
  if (!Array.isArray(raw)) return [];
  const out: Memory[] = [];
  for (const item of raw) {
    const normalized = normalizeMemory(item);
    if (normalized) out.push(normalized);
  }
  return out;
}

export async function readMemoriesFile(memoryPath: string): Promise<Memory[]> {
  try {
    const content = await fs.readFile(memoryPath, 'utf-8');
    return normalizeMemories(JSON.parse(content));
  } catch {
    return [];
  }
}

export async function writeMemoriesFile(memoryPath: string, memories: Memory[]): Promise<void> {
  await fs.mkdir(path.dirname(memoryPath), { recursive: true });
  await fs.writeFile(memoryPath, JSON.stringify(memories, null, 2));
}

export async function appendMemoryFile(
  memoryPath: string,
  memory: Memory
): Promise<{ status: 'added' | 'duplicate'; memory: Memory }> {
  const existing = await readMemoriesFile(memoryPath);
  const found = existing.find((m) => m.id === memory.id);
  if (found) return { status: 'duplicate', memory: found };
  existing.push(memory);
  await writeMemoriesFile(memoryPath, existing);
  return { status: 'added', memory };
}

export function filterMemories(memories: Memory[], filters: MemoryFilters): Memory[] {
  const { category, type, query } = filters;
  let filtered = memories;

  if (type) filtered = filtered.filter((m) => m.type === type);
  if (category) filtered = filtered.filter((m) => m.category === category);

  if (query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length > 0) {
      filtered = filtered.filter((m) => {
        const haystack = `${m.memory} ${m.reason}`.toLowerCase();
        return terms.some((t) => haystack.includes(t));
      });
    }
  }

  return filtered;
}

export function sortMemoriesByRecency(memories: Memory[]): Memory[] {
  const withIndex = memories.map((m, i) => ({ m, i }));
  withIndex.sort((a, b) => {
    const ad = Date.parse(a.m.date);
    const bd = Date.parse(b.m.date);
    const aTime = Number.isFinite(ad) ? ad : 0;
    const bTime = Number.isFinite(bd) ? bd : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.i - b.i;
  });
  return withIndex.map((x) => x.m);
}

/**
 * Half-life in days per memory type.
 * Convention memories never decay (Infinity).
 * Decisions may be revisited. Gotchas and failures get fixed.
 */
const HALF_LIFE_DAYS: Record<string, number> = {
  convention: Infinity,
  decision: 180,
  gotcha: 90,
  failure: 90
};

export interface MemoryWithConfidence extends Memory {
  effectiveConfidence: number;
  stale: boolean;
}

/**
 * Compute confidence decay: confidence = 2^(-age_days / half_life)
 * Conventions never decay. Memories below 0.3 are flagged stale.
 */
export function computeConfidence(memory: Memory, now?: Date): { effectiveConfidence: number; stale: boolean } {
  const halfLife = HALF_LIFE_DAYS[memory.type] ?? 180;
  if (!Number.isFinite(halfLife)) {
    return { effectiveConfidence: 1.0, stale: false };
  }
  const memDate = Date.parse(memory.date);
  if (!Number.isFinite(memDate)) {
    return { effectiveConfidence: 0.5, stale: false };
  }
  const ageDays = ((now ?? new Date()).getTime() - memDate) / (1000 * 60 * 60 * 24);
  const confidence = Math.pow(2, -ageDays / halfLife);
  const rounded = Math.round(confidence * 100) / 100;
  return { effectiveConfidence: rounded, stale: rounded < 0.3 };
}

/**
 * Enrich an array of memories with confidence decay metadata.
 */
export function withConfidence(memories: Memory[], now?: Date): MemoryWithConfidence[] {
  return memories.map((m) => ({
    ...m,
    ...computeConfidence(m, now)
  }));
}

export function applyUnfilteredLimit(
  memories: Memory[],
  filters: MemoryFilters,
  limit: number
): { memories: Memory[]; truncated: boolean; totalCount: number } {
  const totalCount = memories.length;
  const hasFilters = Boolean(
    filters.category || filters.type || (filters.query && filters.query.trim())
  );
  if (hasFilters || totalCount <= limit) {
    return { memories, truncated: false, totalCount };
  }
  const sorted = sortMemoriesByRecency(memories);
  return { memories: sorted.slice(0, limit), truncated: true, totalCount };
}
