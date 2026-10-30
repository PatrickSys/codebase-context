import { z } from 'zod';

/** Metadata supplied by an index-consuming tool after its work may supersede preflight. */
export const IndexSignalSchema = z.object({
  status: z.enum(['ready', 'rebuild-required', 'indexing', 'unknown', 'error']),
  confidence: z.enum(['high', 'low']),
  action: z.enum([
    'served',
    'rebuild-started',
    'rebuilt-and-served',
    'rebuild-completed',
    'rebuild-failed',
    'rebuild-requested'
  ]),
  reason: z.string().optional()
});
export type IndexSignal = z.infer<typeof IndexSignalSchema>;
