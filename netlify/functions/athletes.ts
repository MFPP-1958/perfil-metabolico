import { observationSchema, type Observation } from '../../src/domain/observation.js';
import { authenticateRequest } from './lib/authorization.js';
import { bearerToken, jsonResponse } from './lib/http.js';

type AthleteRow = { id: string; intervalsId: string; name: string; role: 'coach' | 'viewer' };
type AthleteEvent = { httpMethod: string; headers?: Record<string, string>; queryStringParameters?: Record<string, string> };
type Dependencies = {
  authenticate(event: AthleteEvent): Promise<{ id: string } | null>;
  list(coachId: string): Promise<AthleteRow[]>;
  observations(athleteId: string): Promise<Observation[]>;
};

function configuration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing Supabase configuration');
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}

async function listDefault(coachId: string): Promise<AthleteRow[]> {
  const { url, headers } = configuration();
  const query = new URLSearchParams({ select: 'role,athletes!inner(id,intervals_athlete_id,display_name)', coach_id: `eq.${coachId}`, order: 'created_at.asc' });
  const response = await fetch(`${url}/rest/v1/coach_athletes?${query}`, { headers, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Unable to list athletes');
  const rows = await response.json() as Array<{ role?: unknown; athletes?: { id?: unknown; intervals_athlete_id?: unknown; display_name?: unknown } }>;
  return rows.flatMap((row) => typeof row.athletes?.id === 'string' && typeof row.athletes.intervals_athlete_id === 'string' && typeof row.athletes.display_name === 'string' && (row.role === 'coach' || row.role === 'viewer')
    ? [{ id: row.athletes.id, intervalsId: row.athletes.intervals_athlete_id, name: row.athletes.display_name, role: row.role }]
    : []);
}

async function observationsDefault(athleteId: string): Promise<Observation[]> {
  const { url, headers } = configuration();
  const query = new URLSearchParams({ select: 'id,athlete_id,metric_code,value,unit,observed_at,origin,quality,protocol_name,protocol_version,notes', athlete_id: `eq.${athleteId}`, order: 'observed_at.desc', limit: '500' });
  const response = await fetch(`${url}/rest/v1/observations?${query}`, { headers, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Unable to list athlete observations');
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows.flatMap((row) => {
    const parsed = observationSchema.safeParse({
      id: row.id, athleteId: row.athlete_id, metricCode: row.metric_code, value: Number(row.value), unit: row.unit,
      observedAt: row.observed_at, origin: row.origin, quality: row.quality,
      protocol: { name: row.protocol_name, version: row.protocol_version }, notes: row.notes ?? undefined,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

const defaults: Dependencies = { authenticate: authenticateRequest, list: listDefault, observations: observationsDefault };

export function createAthletesHandler(dependencies: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async (event: AthleteEvent) => {
    if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Método no permitido.' });
    if (!bearerToken(event.headers)) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
    try {
      const user = await deps.authenticate(event);
      if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
      const roster = await deps.list(user.id);
      const athleteId = event.queryStringParameters?.athleteId;
      if (!athleteId) return jsonResponse(200, roster);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(athleteId)) return jsonResponse(400, { error: 'Identificador de ciclista no válido.' });
      const athlete = roster.find((candidate) => candidate.id === athleteId);
      if (!athlete) return jsonResponse(403, { error: 'Ciclista no autorizado.' });
      return jsonResponse(200, { ...athlete, observations: await deps.observations(athlete.id) });
    } catch {
      return jsonResponse(500, { error: 'No se pudieron cargar los ciclistas.' });
    }
  };
}

export const handler = createAthletesHandler();
