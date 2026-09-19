import { type Observation } from '../../src/domain/observation.js';
import { fromObservationRow } from './lib/observation-rows.js';
import { authenticateRequest } from './lib/authorization.js';
import { bearerToken, jsonResponse } from './lib/http.js';

type AthleteRow = { id: string; intervalsId: string; name: string; role: 'coach' | 'viewer' };
type AthleteEvent = { httpMethod: string; headers?: Record<string, string>; queryStringParameters?: Record<string, string> };
type SyncContext = { oldest: string; newest: string; environment: 'all' | 'outdoor' | 'indoor' };
type PersistedSyncState = {
  status: 'complete' | 'partial' | 'failed';
  synchronizedAt: string;
  warnings: string[];
  counts: Record<string, unknown>;
};
type Dependencies = {
  authenticate(event: AthleteEvent): Promise<{ id: string } | null>;
  list(coachId: string): Promise<AthleteRow[]>;
  observations(athleteId: string): Promise<Observation[]>;
  syncState(athleteId: string, context: SyncContext): Promise<PersistedSyncState | null>;
  now(): Date;
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
  const query = new URLSearchParams({ select: 'id,athlete_id,metric_code,value,unit,observed_at,origin,quality,source_reference,protocol_name,protocol_version,notes,retracted_at,retraction_reason', athlete_id: `eq.${athleteId}`, order: 'observed_at.desc', limit: '500' });
  const response = await fetch(`${url}/rest/v1/observations?${query}`, { headers, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Unable to list athlete observations');
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows.flatMap((row) => {
    const observation = fromObservationRow(row);
    return observation ? [observation] : [];
  });
}

async function syncStateDefault(athleteId: string, context: SyncContext): Promise<PersistedSyncState | null> {
  const { url, headers } = configuration();
  const query = new URLSearchParams({
    select: 'status,warnings,counts,synchronized_at',
    athlete_id: `eq.${athleteId}`,
    sport: 'eq.Ride',
    environment: `eq.${context.environment}`,
    oldest: `eq.${context.oldest}`,
    newest: `eq.${context.newest}`,
    limit: '1',
  });
  const response = await fetch(`${url}/rest/v1/athlete_sync_states?${query}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to load athlete synchronization state');
  const rows = await response.json() as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return null;
  if (!['complete', 'partial', 'failed'].includes(String(row.status))
    || typeof row.synchronized_at !== 'string'
    || !Array.isArray(row.warnings)
    || row.warnings.some((warning) => typeof warning !== 'string')
    || typeof row.counts !== 'object'
    || row.counts === null
    || Array.isArray(row.counts)) {
    throw new Error('Invalid athlete synchronization state');
  }
  return {
    status: row.status as PersistedSyncState['status'],
    synchronizedAt: row.synchronized_at,
    warnings: row.warnings as string[],
    counts: row.counts as Record<string, unknown>,
  };
}

function parseSyncContext(query: Record<string, string>, now: Date): SyncContext | null {
  if (query.syncState !== 'true'
    || !/^\d{4}-\d{2}-\d{2}$/.test(query.oldest ?? '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(query.newest ?? '')
    || !['all', 'outdoor', 'indoor'].includes(query.environment ?? '')) return null;
  const oldest = Date.parse(`${query.oldest}T00:00:00Z`);
  const newest = Date.parse(`${query.newest}T00:00:00Z`);
  const days = Math.floor((newest - oldest) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 730 || query.newest > now.toISOString().slice(0, 10)) return null;
  return { oldest: query.oldest, newest: query.newest, environment: query.environment as SyncContext['environment'] };
}

const defaults: Dependencies = {
  authenticate: authenticateRequest,
  list: listDefault,
  observations: observationsDefault,
  syncState: syncStateDefault,
  now: () => new Date(),
};

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
      if (event.queryStringParameters?.syncState === 'true') {
        const context = parseSyncContext(event.queryStringParameters, deps.now());
        if (!context) return jsonResponse(400, { error: 'Contexto de sincronización no válido.' });
        return jsonResponse(200, await deps.syncState(athlete.id, context));
      }
      return jsonResponse(200, { ...athlete, observations: await deps.observations(athlete.id) });
    } catch {
      return jsonResponse(500, { error: 'No se pudieron cargar los ciclistas.' });
    }
  };
}

export const handler = createAthletesHandler();
