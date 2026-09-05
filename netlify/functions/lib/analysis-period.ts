import { z } from 'zod';
import type { AnalysisEnvironment } from '../../../src/analysis/types.js';

export const MAX_SYNC_BODY_BYTES = 12 * 1024;

export const syncRequestSchema = z.strictObject({
  athleteId: z.uuid(),
  oldest: z.iso.date(),
  newest: z.iso.date(),
  environment: z.enum(['all', 'outdoor', 'indoor']),
  syncKey: z.string().regex(/^[a-zA-Z0-9_-]{6,80}$/),
});

export interface ResolvedSyncRequest {
  athleteId: string;
  oldest: string;
  newest: string;
  environment: AnalysisEnvironment;
  syncKey: string;
  days: number;
}

const INVALID_SYNC_REQUEST = 'Solicitud de sincronización no válida.';

function utcDay(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function parseSyncRequest(input: unknown, now = new Date()): ResolvedSyncRequest {
  const parsed = syncRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error(INVALID_SYNC_REQUEST);

  const today = now.toISOString().slice(0, 10);
  const days = Math.floor((utcDay(parsed.data.newest) - utcDay(parsed.data.oldest)) / 86_400_000) + 1;
  if (parsed.data.newest > today || days < 1 || days > 730) throw new Error(INVALID_SYNC_REQUEST);

  return { ...parsed.data, days };
}
