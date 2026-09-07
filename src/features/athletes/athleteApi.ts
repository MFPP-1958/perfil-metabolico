import { getAccessToken } from '../../auth/supabase';
import type { Observation } from '../../domain/observation';
import type { AthleteSummary } from './AthleteSelector';
import { synchronizeAthlete } from './synchronizeAthlete';

export interface AthleteDetail extends AthleteSummary {
  observations: Observation[];
}

export interface AthleteSyncRequest {
  athleteId: string;
  oldest: string;
  newest: string;
  environment: 'all' | 'outdoor' | 'indoor';
  syncKey: string;
}

export interface AthleteSyncResult {
  status: 'complete' | 'partial';
  synchronizedAt: string;
  warnings: string[];
}

export interface AthleteApi {
  list(): Promise<AthleteSummary[]>;
  load(id: string, signal?: AbortSignal): Promise<AthleteDetail>;
  createObservation?(observation: Observation): Promise<Observation>;
  sync?(request: AthleteSyncRequest): Promise<AthleteSyncResult>;
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
  sync: synchronizeAthlete,
};
