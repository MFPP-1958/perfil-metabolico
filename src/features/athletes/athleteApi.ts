import { getAccessToken } from '../../auth/supabase';
import type { Observation } from '../../domain/observation';
import type {
  AthletePersistedSyncState,
  AthleteSyncContext,
  AthleteSyncRequest,
  AthleteSyncResult,
} from './athleteContracts';
import type { AthleteSummary } from './AthleteSelector';
import { synchronizeAthlete } from './synchronizeAthlete';

export type { AthleteSyncRequest, AthleteSyncResult } from './athleteContracts';

export interface AthleteDetail extends AthleteSummary {
  observations: Observation[];
}

export interface AthleteApi {
  list(): Promise<AthleteSummary[]>;
  load(id: string, signal?: AbortSignal): Promise<AthleteDetail>;
  createObservation?(observation: Observation): Promise<Observation>;
  createObservations?(observations: Observation[]): Promise<Observation[]>;
  retractObservation?(request: { athleteId: string; observationId: string; reason: string }): Promise<Observation>;
  sync?(request: AthleteSyncRequest): Promise<AthleteSyncResult>;
  loadSyncState?(request: AthleteSyncContext, signal?: AbortSignal): Promise<AthletePersistedSyncState | null>;
}

/** Envía al servidor y devuelve su respuesta; si falla, lanza su mensaje, que ya viene redactado. */
async function postObservations(payload: unknown): Promise<unknown> {
  const token = await getAccessToken();
  const response = await fetch('/.netlify/functions/observations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let message = 'No se pudo guardar el cambio.';
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // Se mantiene el mensaje genérico.
    }
    throw new Error(message);
  }
  return response.json();
}

export const athleteApi: AthleteApi = {
  async list() {
    const token = await getAccessToken();
    const response = await fetch('/.netlify/functions/athletes', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('No se pudo cargar la lista de ciclistas.');
    return response.json() as Promise<AthleteSummary[]>;
  },
  async load(id, signal) {
    const token = await getAccessToken();
    const query = new URLSearchParams({ athleteId: id });
    const response = await fetch(`/.netlify/functions/athletes?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw new Error('No se pudo cargar el ciclista.');
    return response.json() as Promise<AthleteDetail>;
  },
  async createObservation(observation) {
    const token = await getAccessToken();
    const response = await fetch('/.netlify/functions/observations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(observation),
    });
    if (!response.ok) throw new Error('No se pudo guardar la observación.');
    return response.json() as Promise<Observation>;
  },
  async createObservations(observations) {
    const body = await postObservations({ observations });
    return (body as { observations: Observation[] }).observations;
  },
  async retractObservation(request) {
    return await postObservations({ retract: request }) as Observation;
  },
  sync: synchronizeAthlete,
  async loadSyncState(request, signal) {
    const token = await getAccessToken();
    const query = new URLSearchParams({
      athleteId: request.athleteId,
      syncState: 'true',
      oldest: request.oldest,
      newest: request.newest,
      environment: request.environment,
    });
    const response = await fetch(`/.netlify/functions/athletes?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw new Error('No se pudo cargar el estado de sincronización.');
    return response.json() as Promise<AthletePersistedSyncState | null>;
  },
};
