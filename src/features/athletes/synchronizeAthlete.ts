import { resolvePeriod } from '../../analysis/period';
import { getAccessToken } from '../../auth/supabase';

interface SynchronizeAthleteDependencies {
  getToken(): Promise<string | null>;
  fetchImpl: typeof fetch;
  now(): Date;
  createSyncKey(): string;
}

export async function synchronizeAthlete(
  athleteId: string,
  dependencies: Partial<SynchronizeAthleteDependencies> = {},
) {
  const getToken = dependencies.getToken ?? getAccessToken;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const createSyncKey = dependencies.createSyncKey ?? (() => crypto.randomUUID());
  const token = await getToken();
  const period = resolvePeriod({ preset: 90 }, now().toISOString().slice(0, 10));
  const response = await fetchImpl('/.netlify/functions/sync-athlete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athleteId,
      oldest: period.oldest,
      newest: period.newest,
      environment: 'all',
      syncKey: createSyncKey(),
    }),
  });
  const body = await response.json() as { warnings?: string[]; error?: string };
  if (![200, 207].includes(response.status)) throw new Error(body.error ?? 'No se pudo sincronizar el ciclista.');
  return { warnings: body.warnings ?? [] };
}
