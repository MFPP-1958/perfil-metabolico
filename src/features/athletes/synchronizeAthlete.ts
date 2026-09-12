import { resolvePeriod } from '../../analysis/period';
import { getAccessToken } from '../../auth/supabase';
import type { AthleteSyncRequest, AthleteSyncResult } from './athleteContracts';

interface SynchronizeAthleteDependencies {
  getToken(): Promise<string | null>;
  fetchImpl: typeof fetch;
  now(): Date;
  createSyncKey(): string;
}

export async function synchronizeAthlete(
  input: string | AthleteSyncRequest,
  dependencies: Partial<SynchronizeAthleteDependencies> = {},
): Promise<AthleteSyncResult> {
  const getToken = dependencies.getToken ?? getAccessToken;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const createSyncKey = dependencies.createSyncKey ?? (() => crypto.randomUUID());
  const token = await getToken();
  const request = typeof input === 'string'
    ? (() => {
        const period = resolvePeriod({ preset: 90 }, now().toISOString().slice(0, 10));
        return {
          athleteId: input,
          oldest: period.oldest,
          newest: period.newest,
          environment: 'all' as const,
          syncKey: createSyncKey(),
        };
      })()
    : input;
  const response = await fetchImpl('/.netlify/functions/sync-athlete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json() as {
    status?: 'complete' | 'partial';
    synchronizedAt?: string;
    warnings?: string[];
    counts?: Record<string, { received: number; accepted: number; rejected: number }>;
    error?: string;
  };
  if (![200, 207].includes(response.status)) throw new Error(body.error ?? 'No se pudo sincronizar el ciclista.');
  const warnings = body.warnings ?? [];
  return {
    status: body.status ?? (warnings.length ? 'partial' : 'complete'),
    synchronizedAt: body.synchronizedAt ?? now().toISOString(),
    warnings,
    counts: body.counts,
  };
}
