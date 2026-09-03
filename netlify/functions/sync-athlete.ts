import { authenticateRequest, listAuthorizedAthleteIds } from './lib/authorization.js';
import { jsonResponse } from './lib/http.js';
import { mapActivity, mapPlannedWorkout, mapPowerCurve, mapSportSettings } from '../../src/server/intervals/mappers.js';

interface SyncEvent {
  httpMethod: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
}

interface LoadedAthleteData {
  athlete: unknown;
  activities: unknown[];
  powerCurves: unknown | null;
  plannedWorkouts: unknown[];
  warnings: string[];
}

interface SyncDependencies {
  authenticate(event: SyncEvent): Promise<{ id: string } | null>;
  authorize(coachId: string, athleteId: string): Promise<boolean>;
  beginSync(athleteId: string, syncKey: string): Promise<void>;
  isLatestSync(athleteId: string, syncKey: string): Promise<boolean>;
  load(athleteId: string): Promise<LoadedAthleteData>;
  persist(coachId: string, athleteId: string, syncKey: string, data: LoadedAthleteData): Promise<void>;
}

async function fetchIntervals(path: string) {
  const key = process.env.INTERVALS_API_KEY;
  if (!key) throw new Error('Missing Intervals configuration');
  const response = await fetch(`https://intervals.icu/api/v1${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(`API_KEY:${key}`).toString('base64')}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Intervals operation failed: ${response.status}`);
  return response.json() as Promise<unknown>;
}

function supabaseServiceConfiguration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing Supabase configuration');
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

async function beginSyncDefault(athleteId: string, syncKey: string) {
  const { url, headers } = supabaseServiceConfiguration();
  const response = await fetch(`${url}/rest/v1/athletes?intervals_athlete_id=eq.${athleteId}`, {
    method: 'PATCH', headers, body: JSON.stringify({ latest_sync_key: syncKey, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to start synchronized athlete request');
}

async function isLatestSyncDefault(athleteId: string, syncKey: string) {
  const { url, headers } = supabaseServiceConfiguration();
  const response = await fetch(`${url}/rest/v1/athletes?select=latest_sync_key&intervals_athlete_id=eq.${athleteId}&limit=1`, {
    headers, signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to check synchronized athlete request');
  const rows = await response.json() as { latest_sync_key?: string }[];
  return rows[0]?.latest_sync_key === syncKey;
}

async function loadDefault(athleteId: string): Promise<LoadedAthleteData> {
  const now = new Date();
  const newest = now.toISOString().slice(0, 10);
  const oldest = new Date(now.getTime() - 180 * 86_400_000).toISOString().slice(0, 10);
  const requests = await Promise.allSettled([
    fetchIntervals(`/athlete/${athleteId}`),
    fetchIntervals(`/athlete/${athleteId}/activities?oldest=${oldest}&newest=${newest}&limit=200`),
    fetchIntervals(`/athlete/${athleteId}/power-curves?curves=180d&type=Ride`),
    fetchIntervals(`/athlete/${athleteId}/events?oldest=${oldest}&newest=${newest}&category=WORKOUT`),
  ]);
  if (requests[0].status === 'rejected') throw new Error('Athlete profile unavailable');
  const value = (index: number) => requests[index].status === 'fulfilled' ? requests[index].value : null;
  const warnings = ['athlete', 'activities', 'power_curves', 'planned_workouts']
    .filter((_, index) => requests[index].status === 'rejected');
  return {
    athlete: value(0),
    activities: Array.isArray(value(1)) ? value(1) as unknown[] : [],
    powerCurves: value(2),
    plannedWorkouts: Array.isArray(value(3)) ? value(3) as unknown[] : [],
    warnings,
  };
}

async function persistDefault(coachId: string, athleteId: string, syncKey: string, data: LoadedAthleteData) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing Supabase configuration');
  const profile = data.athlete as { name?: unknown; icu_weight?: unknown };
  const response = await fetch(`${url}/rest/v1/athletes?on_conflict=intervals_athlete_id&select=id`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify({
      created_by: coachId,
      intervals_athlete_id: athleteId,
      display_name: typeof profile.name === 'string' ? profile.name : athleteId,
      latest_sync_key: syncKey,
      updated_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to persist synchronized athlete');
  let rows = await response.json() as { id: string }[];
  if (!rows[0]?.id) {
    const lookup = await fetch(`${url}/rest/v1/athletes?select=id&intervals_athlete_id=eq.${athleteId}&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8_000),
    });
    if (!lookup.ok) throw new Error('Unable to resolve synchronized athlete');
    rows = await lookup.json() as { id: string }[];
  }
  if (!rows[0]?.id) throw new Error('Synchronized athlete did not return an id');
  const databaseAthleteId = rows[0].id;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  const linkResponse = await fetch(`${url}/rest/v1/coach_athletes?on_conflict=coach_id,athlete_id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ coach_id: coachId, athlete_id: databaseAthleteId, role: 'coach' }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!linkResponse.ok) throw new Error('Unable to persist athlete authorization');

  const activities = data.activities.flatMap((raw) => {
    try {
      const activity = mapActivity(raw);
      return [{
        athlete_id: databaseAthleteId,
        intervals_activity_id: activity.sourceId,
        sport: activity.sport,
        started_at: activity.startedAt,
        indoor: activity.indoor,
        duration_seconds: activity.durationSeconds,
        normalized_data: {
          name: activity.name,
          distanceMetres: activity.distanceMetres,
          averagePowerWatts: activity.averagePowerWatts,
          averageHeartRateBpm: activity.averageHeartRateBpm,
          averageCadenceRpm: activity.averageCadenceRpm,
        },
      }];
    } catch { return []; }
  });
  const plannedWorkouts = data.plannedWorkouts.flatMap((raw) => {
    try {
      const workout = mapPlannedWorkout(raw);
      return [{
        athlete_id: databaseAthleteId,
        intervals_event_id: workout.sourceId,
        scheduled_at: workout.scheduledAt,
        structured_blocks: workout.blocks,
      }];
    } catch { return []; }
  });
  const imported = mapSportSettings(data.athlete).metrics.map((metric) => ({
    athlete_id: databaseAthleteId,
    created_by: coachId,
    metric_code: metric.metricCode,
    value: metric.value,
    unit: metric.unit,
    observed_at: new Date().toISOString(),
    origin: 'intervals_icu',
    quality: metric.quality,
    protocol_name: metric.sourceField,
    protocol_version: 'intervals-openapi-v1',
  }));
  const derived = (() => {
    if (!data.powerCurves) return [];
    try {
      return mapPowerCurve(data.powerCurves).models.flatMap((model) => [
        ['cp', model.cpWatts, 'W'],
        ['w_prime', model.wPrimeKj, 'kJ'],
        ['pmax', model.pmaxWatts, 'W'],
        ['ftp', model.ftpWatts, 'W'],
      ].flatMap(([metricCode, value, unit]) => typeof value === 'number' ? [{
        athlete_id: databaseAthleteId,
        created_by: coachId,
        metric_code: metricCode,
        value,
        unit,
        quality: 'calculated',
        algorithm_name: `Intervals.icu ${model.type}`,
        algorithm_version: 'intervals-openapi-v1',
        warnings: [],
      }] : []));
    } catch { return []; }
  })();
  const writes = [
    ['activities', activities, 'athlete_id,intervals_activity_id'],
    ['planned_workouts', plannedWorkouts, 'athlete_id,intervals_event_id'],
    ['observations', imported, ''],
    ['derived_results', derived, ''],
  ] as const;
  for (const [table, payload, conflict] of writes) {
    if (!payload.length) continue;
    const query = conflict ? `?on_conflict=${conflict}` : '';
    const write = await fetch(`${url}/rest/v1/${table}${query}`, {
      method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(8_000),
    });
    if (!write.ok) throw new Error(`Unable to persist normalized ${table}`);
  }
}

const defaults: SyncDependencies = {
  authenticate: authenticateRequest,
  authorize: async (coachId, athleteId) => (await listAuthorizedAthleteIds(coachId, fetch, 'coach')).has(athleteId),
  beginSync: beginSyncDefault,
  isLatestSync: isLatestSyncDefault,
  load: loadDefault,
  persist: persistDefault,
};

export function createSyncHandler(dependencies: Partial<SyncDependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async (event: SyncEvent) => {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método no permitido.' });
    const query = event.queryStringParameters ?? {};
    if (!/^i\d+$/.test(query.athleteId ?? '') || !/^[a-zA-Z0-9_-]{6,80}$/.test(query.syncKey ?? '')) {
      return jsonResponse(400, { error: 'Solicitud de sincronización no válida.' });
    }
    const user = await deps.authenticate(event);
    if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
    if (!(await deps.authorize(user.id, query.athleteId))) return jsonResponse(403, { error: 'Ciclista no autorizado.' });
    await deps.beginSync(query.athleteId, query.syncKey);
    const data = await deps.load(query.athleteId);
    if (!(await deps.isLatestSync(query.athleteId, query.syncKey))) {
      return jsonResponse(409, { error: 'Sincronización sustituida por una solicitud más reciente.' });
    }
    await deps.persist(user.id, query.athleteId, query.syncKey, data);
    return jsonResponse(data.warnings.length ? 207 : 200, {
      athleteId: query.athleteId,
      synchronized: true,
      warnings: data.warnings,
    });
  };
}

export const handler = createSyncHandler();
