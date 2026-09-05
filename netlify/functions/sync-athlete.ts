import { createHash } from 'node:crypto';
import { authenticateRequest } from './lib/authorization.js';
import { jsonResponse } from './lib/http.js';
import { mapActivity, mapPlannedWorkout, mapPowerCurve, mapSportSettings } from '../../src/server/intervals/mappers.js';
import { IntervalsClient, type IntervalsTransport } from '../../src/server/intervals/client.js';
import {
  MAX_SYNC_BODY_BYTES,
  parseSyncRequest,
  type ResolvedSyncRequest,
} from './lib/analysis-period.js';

interface SyncEvent {
  httpMethod: string;
  headers?: Record<string, string>;
  body?: string | null;
}

interface LoadedAthleteData {
  athlete: unknown | null;
  activities: unknown[];
  powerCurves: unknown | null;
  plannedWorkouts: unknown[];
  warnings: string[];
  updated: string[];
}

interface SupabaseService {
  url: string;
  headers: Record<string, string>;
}

interface SyncDependencies {
  authenticate(event: SyncEvent): Promise<{ id: string } | null>;
  now(): Date;
  resolveAthlete(coachId: string, athleteId: string): Promise<{ id: string; intervalsAthleteId: string } | null>;
  beginSync(athleteId: string, syncKey: string): Promise<void>;
  isLatestSync(athleteId: string, syncKey: string): Promise<boolean>;
  load(intervalsAthleteId: string, request: ResolvedSyncRequest): Promise<LoadedAthleteData>;
  persist(coachId: string, athleteId: string, syncKey: string, data: LoadedAthleteData, request: ResolvedSyncRequest): Promise<void>;
}

export function withoutUnchangedSnapshots<T extends Record<string, unknown>>(
  incoming: T[],
  existing: Array<Record<string, unknown>>,
  keys: Array<keyof T>,
) {
  return incoming.filter((candidate) => !existing.some((saved) => keys.every((key) => saved[String(key)] === candidate[key])));
}

export function createPowerCurveSnapshotPayload(powerCurves: unknown, request: ResolvedSyncRequest) {
  const normalized = mapPowerCurve(powerCurves);
  const points = normalized.points.map(({ seconds, watts }) => ({ seconds, watts }));
  if (!points.length) throw new Error('Power curve does not contain positive normalized points');
  const sourceModels = normalized.models.map((model) => ({
    type: model.type,
    cpWatts: model.cpWatts,
    wPrimeKj: model.wPrimeKj,
    pmaxWatts: model.pmaxWatts,
    ftpWatts: model.ftpWatts,
    r2: model.r2,
  }));
  const canonical = JSON.stringify({ points, sourceModels });
  return {
    sport: 'Ride',
    environment: request.environment,
    oldest: request.oldest,
    newest: request.newest,
    points,
    source_models: sourceModels,
    source_version: 'intervals-openapi-v1',
    content_hash: createHash('sha256').update(canonical).digest('hex'),
  };
}

export async function persistPowerCurveSnapshot(
  fetchImpl: typeof fetch,
  service: SupabaseService,
  coachId: string,
  athleteId: string,
  request: ResolvedSyncRequest,
  powerCurves: unknown,
) {
  const payload = createPowerCurveSnapshotPayload(powerCurves, request);
  const response = await fetchImpl(
    `${service.url}/rest/v1/power_curve_snapshots?on_conflict=athlete_id,sport,environment,oldest,newest,content_hash`,
    {
      method: 'POST',
      headers: { ...service.headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ athlete_id: athleteId, created_by: coachId, ...payload }),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error('Unable to persist normalized power curve snapshot');
}

async function fetchIntervals(path: string, query?: Readonly<Record<string, string>>) {
  const key = process.env.INTERVALS_API_KEY;
  if (!key) throw new Error('Missing Intervals configuration');
  const search = query ? `?${new URLSearchParams(query)}` : '';
  const response = await fetch(`https://intervals.icu/api/v1${path}${search}`, {
    headers: { Authorization: `Basic ${Buffer.from(`API_KEY:${key}`).toString('base64')}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Intervals operation failed: ${response.status}`);
  return response.json() as Promise<unknown>;
}

function defaultIntervalsClient() {
  const transport: IntervalsTransport = { get: fetchIntervals };
  return new IntervalsClient(transport);
}

function supabaseServiceConfiguration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing Supabase configuration');
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

async function beginSyncDefault(athleteId: string, syncKey: string) {
  const { url, headers } = supabaseServiceConfiguration();
  const response = await fetch(`${url}/rest/v1/athletes?id=eq.${athleteId}`, {
    method: 'PATCH', headers, body: JSON.stringify({ latest_sync_key: syncKey, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to start synchronized athlete request');
}

async function isLatestSyncDefault(athleteId: string, syncKey: string) {
  const { url, headers } = supabaseServiceConfiguration();
  const response = await fetch(`${url}/rest/v1/athletes?select=latest_sync_key&id=eq.${athleteId}&limit=1`, {
    headers, signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to check synchronized athlete request');
  const rows = await response.json() as { latest_sync_key?: string }[];
  return rows[0]?.latest_sync_key === syncKey;
}

export async function loadIntervalsAthleteData(
  client: IntervalsClient,
  intervalsAthleteId: string,
  request: ResolvedSyncRequest,
): Promise<LoadedAthleteData> {
  const indoor = request.environment === 'all' ? undefined : request.environment === 'indoor';
  const requests = await Promise.allSettled([
    client.getAthlete(intervalsAthleteId),
    client.getActivities(intervalsAthleteId, request.oldest, request.newest),
    client.getPowerCurves(intervalsAthleteId, `${request.days}d`, request.newest, indoor),
    client.getPlannedWorkouts(intervalsAthleteId, request.oldest, request.newest),
  ]);
  const value = (index: number) => requests[index].status === 'fulfilled' ? requests[index].value : null;
  const components = ['athlete', 'activities', 'power_curves', 'planned_workouts'];
  const athlete = value(0);
  const rawActivities = value(1);
  const rawPowerCurves = value(2);
  const rawPlannedWorkouts = value(3);
  let powerCurves: unknown | null = rawPowerCurves;
  try {
    if (powerCurves !== null) createPowerCurveSnapshotPayload(powerCurves, request);
  } catch {
    powerCurves = null;
  }
  const usable = [
    athlete !== null,
    Array.isArray(rawActivities),
    powerCurves !== null,
    Array.isArray(rawPlannedWorkouts),
  ];
  const warnings = components.filter((_, index) => !usable[index]);
  return {
    athlete,
    activities: Array.isArray(rawActivities) ? rawActivities : [],
    powerCurves,
    plannedWorkouts: Array.isArray(rawPlannedWorkouts) ? rawPlannedWorkouts : [],
    warnings,
    updated: components.filter((_, index) => usable[index]),
  };
}

async function loadDefault(intervalsAthleteId: string, request: ResolvedSyncRequest) {
  return loadIntervalsAthleteData(defaultIntervalsClient(), intervalsAthleteId, request);
}

async function resolveAthleteDefault(coachId: string, athleteId: string) {
  const { url, headers } = supabaseServiceConfiguration();
  const query = new URLSearchParams({
    select: 'athlete_id,athletes!inner(id,intervals_athlete_id)',
    coach_id: `eq.${coachId}`,
    athlete_id: `eq.${athleteId}`,
    role: 'eq.coach',
    limit: '1',
  });
  const response = await fetch(`${url}/rest/v1/coach_athletes?${query}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to resolve athlete authorization');
  const rows = await response.json() as Array<{
    athlete_id?: unknown;
    athletes?: { id?: unknown; intervals_athlete_id?: unknown };
  }>;
  const row = rows[0];
  return row?.athlete_id === athleteId
    && row.athletes?.id === athleteId
    && typeof row.athletes.intervals_athlete_id === 'string'
    ? { id: athleteId, intervalsAthleteId: row.athletes.intervals_athlete_id }
    : null;
}

export async function persistNormalizedAthleteData(
  fetchImpl: typeof fetch,
  service: SupabaseService,
  now: Date,
  coachId: string,
  athleteId: string,
  syncKey: string,
  data: LoadedAthleteData,
  request: ResolvedSyncRequest,
) {
  const databaseAthleteId = athleteId;
  const headers = { ...service.headers, Prefer: 'resolution=merge-duplicates,return=minimal' };
  const profile = data.athlete as { name?: unknown } | null;
  if (typeof profile?.name === 'string' && profile.name.length > 0 && profile.name.length <= 120) {
    const profileResponse = await fetchImpl(`${service.url}/rest/v1/athletes?id=eq.${databaseAthleteId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ display_name: profile.name, latest_sync_key: syncKey, updated_at: now.toISOString() }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!profileResponse.ok) throw new Error('Unable to persist synchronized athlete profile');
  }
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
  const imported = (() => {
    if (!data.athlete) return [];
    try {
      return mapSportSettings(data.athlete).metrics.map((metric) => ({
        athlete_id: databaseAthleteId,
        created_by: coachId,
        metric_code: metric.metricCode,
        value: metric.value,
        unit: metric.unit,
        observed_at: now.toISOString(),
        origin: 'intervals_icu',
        quality: metric.quality,
        protocol_name: metric.sourceField,
        protocol_version: 'intervals-openapi-v1',
      }));
    } catch { return []; }
  })();
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
  async function loadExistingSnapshots(table: 'observations' | 'derived_results', select: string, extra: Record<string, string>) {
    const query = new URLSearchParams({ select, athlete_id: `eq.${databaseAthleteId}`, ...extra });
    const existingResponse = await fetchImpl(`${service.url}/rest/v1/${table}?${query}`, {
      headers, signal: AbortSignal.timeout(8_000),
    });
    if (!existingResponse.ok) throw new Error(`Unable to compare normalized ${table}`);
    return existingResponse.json() as Promise<Array<Record<string, unknown>>>;
  }
  const importedToWrite = imported.length
    ? withoutUnchangedSnapshots(imported, await loadExistingSnapshots(
      'observations',
      'metric_code,value,unit,protocol_name,protocol_version',
      { origin: 'eq.intervals_icu' },
    ), ['metric_code', 'value', 'unit', 'protocol_name', 'protocol_version'])
    : [];
  const derivedToWrite = derived.length
    ? withoutUnchangedSnapshots(derived, await loadExistingSnapshots(
      'derived_results',
      'metric_code,value,unit,algorithm_name,algorithm_version',
      {},
    ), ['metric_code', 'value', 'unit', 'algorithm_name', 'algorithm_version'])
    : [];
  const writes = [
    ['activities', activities, 'athlete_id,intervals_activity_id'],
    ['planned_workouts', plannedWorkouts, 'athlete_id,intervals_event_id'],
    ['observations', importedToWrite, ''],
    ['derived_results', derivedToWrite, ''],
  ] as const;
  for (const [table, payload, conflict] of writes) {
    if (!payload.length) continue;
    const query = conflict ? `?on_conflict=${conflict}` : '';
    const write = await fetchImpl(`${service.url}/rest/v1/${table}${query}`, {
      method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(8_000),
    });
    if (!write.ok) throw new Error(`Unable to persist normalized ${table}`);
  }
  if (data.powerCurves) {
    await persistPowerCurveSnapshot(fetchImpl, service, coachId, databaseAthleteId, request, data.powerCurves);
  }
}

async function persistDefault(
  coachId: string,
  athleteId: string,
  syncKey: string,
  data: LoadedAthleteData,
  request: ResolvedSyncRequest,
) {
  const service = supabaseServiceConfiguration();
  await persistNormalizedAthleteData(fetch, service, new Date(), coachId, athleteId, syncKey, data, request);
}

const defaults: SyncDependencies = {
  authenticate: authenticateRequest,
  now: () => new Date(),
  resolveAthlete: resolveAthleteDefault,
  beginSync: beginSyncDefault,
  isLatestSync: isLatestSyncDefault,
  load: loadDefault,
  persist: persistDefault,
};

export function createSyncHandler(dependencies: Partial<SyncDependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async (event: SyncEvent) => {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método no permitido.' });
    const rawBody = event.body ?? '';
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_SYNC_BODY_BYTES) {
      return jsonResponse(413, { error: 'La solicitud de sincronización es demasiado grande.' });
    }
    let request: ResolvedSyncRequest;
    try {
      request = parseSyncRequest(JSON.parse(rawBody), deps.now());
    } catch {
      return jsonResponse(400, { error: 'Solicitud de sincronización no válida.' });
    }
    try {
      const user = await deps.authenticate(event);
      if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
      const athlete = await deps.resolveAthlete(user.id, request.athleteId);
      if (!athlete) return jsonResponse(403, { error: 'Ciclista no autorizado.' });
      await deps.beginSync(athlete.id, request.syncKey);
      const data = await deps.load(athlete.intervalsAthleteId, request);
      if (!(await deps.isLatestSync(athlete.id, request.syncKey))) {
        return jsonResponse(409, { error: 'Sincronización sustituida por una solicitud más reciente.' });
      }
      await deps.persist(user.id, athlete.id, request.syncKey, data, request);
      const synchronizedAt = deps.now().toISOString();
      return jsonResponse(data.warnings.length ? 207 : 200, {
        synchronizedAt,
        status: data.warnings.length ? 'partial' : 'complete',
        updated: data.updated ?? [],
        warnings: data.warnings,
      });
    } catch {
      return jsonResponse(500, { error: 'No se pudo sincronizar el ciclista.' });
    }
  };
}

export const handler = createSyncHandler();
