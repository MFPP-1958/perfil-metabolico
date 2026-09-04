import { getAccessToken } from '../../auth/supabase';

export type RosterCandidate = { id: string; name: string };
export type ImportSummary = {
  added: number;
  existing: number;
  failed: Array<{ id: string; reason: string }>;
};
export interface IntervalsConnectionApi {
  discover(): Promise<RosterCandidate[]>;
  importSelected(athleteIds: string[]): Promise<ImportSummary>;
}

async function authenticatedFetch(init?: RequestInit) {
  const token = await getAccessToken();
  return fetch('/.netlify/functions/intervals-connection', {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
  });
}

async function errorMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export const intervalsConnectionApi: IntervalsConnectionApi = {
  async discover() {
    const response = await authenticatedFetch();
    if (!response.ok) {
      const fallback = response.status === 503
        ? 'La conexión todavía no está configurada.'
        : 'No se pudo consultar Intervals.icu.';
      throw new Error(await errorMessage(response, fallback));
    }
    return (await response.json() as { athletes: RosterCandidate[] }).athletes;
  },
  async importSelected(athleteIds) {
    const response = await authenticatedFetch({ method: 'POST', body: JSON.stringify({ athleteIds }) });
    if (![200, 207].includes(response.status)) {
      throw new Error(await errorMessage(response, 'No se pudieron incorporar los ciclistas seleccionados.'));
    }
    return response.json() as Promise<ImportSummary>;
  },
};
