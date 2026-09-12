import { createHash } from 'node:crypto';
import { authenticateRequest } from './lib/authorization.js';
import { bearerToken, jsonResponse } from './lib/http.js';
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

type SyncComponent = 'athlete' | 'activities' | 'power_curves' | 'planned_workouts';

interface LoadedAthleteData {
  athlete: unknown | null;
  activities: unknown[];
  powerCurves: unknown | null;
  plannedWorkouts: unknown[];
  warnings: string[];
  updated: string[];
  received?: Partial<Record<SyncComponent, number>>;
}

interface SyncCount {
  received: number;
  accepted: number;
  rejected: number;
}

interface NormalizedAthleteData {
  synchronizedAt: string;
  profileName: string | null;
  activities: Array<Record<string, unknown>>;
  plannedWorkouts: Array<Record<string, unknown>>;
  observations: Array<Record<string, unknown>>;
  derivedResults: Array<Record<string, unknown>>;
  snapshot: ReturnType<typeof createPowerCurveSnapshotPayload> | null;
  warnings: string[];
  updated: string[];
  counts: Record<SyncComponent, SyncCount>;
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
  load(intervalsAthleteId: string, request: ResolvedSyncRequest): Promise<LoadedAthleteData>;
  commit(coachId: string, athleteId: string, syncKey: string, data: NormalizedAthleteData, request: ResolvedSyncRequest): Promise<boolean>;
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
    received: {
      athlete: requests[0].status === 'fulfilled' ? 1 : 0,
      activities: requests[1].status === 'fulfilled'
        ? Array.isArray(rawActivities) ? rawActivities.length : 1
        : 0,
      power_curves: requests[2].status === 'fulfilled' ? 1 : 0,
      planned_workouts: requests[3].status === 'fulfilled'
        ? Array.isArray(rawPlannedWorkouts) ? rawPlannedWorkouts.length : 1
        : 0,
    },
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

function safeTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}

function count(received: number, accepted: number): SyncCount {
  return { received, accepted, rejected: received - accepted };
}

function recordRejectedCount(warnings: Set<string>, component: SyncComponent, rejected: number) {
  if (rejected < 1) return;
  warnings.delete(component);
  warnings.add(`${component}:${rejected}_rejected`);
}

export function normalizeAthleteData(
  data: LoadedAthleteData,
  request: ResolvedSyncRequest,
  now: Date,
): NormalizedAthleteData {
  const warnings = new Set<string>(data.warnings.filter((warning): warning is SyncComponent =>
    ['athlete', 'activities', 'power_curves', 'planned_workouts'].includes(warning)));
  const updated = new Set(data.updated.filter((component): component is SyncComponent =>
    ['athlete', 'activities', 'power_curves', 'planned_workouts'].includes(component)));
  let profileName: string | null = null;
  let observations: Array<Record<string, unknown>> = [];
  let athleteAccepted = 0;
  if (data.athlete !== null) {
    try {
      const profile = data.athlete as { name?: unknown };
      if (typeof profile.name !== 'string' || profile.name.length < 1 || profile.name.length > 120) throw new Error('Invalid profile');
      const settings = mapSportSettings(data.athlete);
      profileName = profile.name;
      observations = settings.metrics.map((metric) => ({
        metric_code: metric.metricCode,
        value: metric.value,
        unit: metric.unit,
        observed_at: now.toISOString(),
        protocol_name: metric.sourceField,
        protocol_version: 'intervals-openapi-v1',
      }));
      athleteAccepted = 1;
    } catch {
      warnings.add('athlete:1_rejected');
      updated.delete('athlete');
    }
  }

  const activities = data.activities.flatMap((raw) => {
    try {
      const activity = mapActivity(raw);
      if (!safeTimestamp(activity.startedAt)) throw new Error('Invalid activity date');
      return [{
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
  if (activities.length < data.activities.length) {
    if (!activities.length && data.activities.length) updated.delete('activities');
  }

  const plannedWorkouts = data.plannedWorkouts.flatMap((raw) => {
    try {
      const workout = mapPlannedWorkout(raw);
      if (!safeTimestamp(workout.scheduledAt)) throw new Error('Invalid workout date');
      return [{
        intervals_event_id: workout.sourceId,
        scheduled_at: workout.scheduledAt,
        structured_blocks: workout.blocks,
      }];
    } catch { return []; }
  });
  if (plannedWorkouts.length < data.plannedWorkouts.length) {
    if (!plannedWorkouts.length && data.plannedWorkouts.length) updated.delete('planned_workouts');
  }

  let snapshot: ReturnType<typeof createPowerCurveSnapshotPayload> | null = null;
  let derivedResults: Array<Record<string, unknown>> = [];
  if (data.powerCurves !== null) {
    try {
      snapshot = createPowerCurveSnapshotPayload(data.powerCurves, request);
      derivedResults = mapPowerCurve(data.powerCurves).models.flatMap((model) => [
        ['cp', model.cpWatts, 'W'],
        ['w_prime', model.wPrimeKj, 'kJ'],
        ['pmax', model.pmaxWatts, 'W'],
        ['ftp', model.ftpWatts, 'W'],
      ].flatMap(([metricCode, value, unit]) => typeof value === 'number' ? [{
        metric_code: metricCode,
        value,
        unit,
        algorithm_name: `Intervals.icu ${model.type}`,
        algorithm_version: 'intervals-openapi-v1',
      }] : []));
    } catch {
      warnings.add('power_curves:1_rejected');
      updated.delete('power_curves');
    }
  }

  const counts = {
    athlete: count(data.received?.athlete ?? (data.athlete === null ? 0 : 1), athleteAccepted),
    activities: count(data.received?.activities ?? data.activities.length, activities.length),
    power_curves: count(data.received?.power_curves ?? (data.powerCurves === null ? 0 : 1), snapshot ? 1 : 0),
    planned_workouts: count(data.received?.planned_workouts ?? data.plannedWorkouts.length, plannedWorkouts.length),
  };
  (Object.entries(counts) as Array<[SyncComponent, SyncCount]>).forEach(([component, componentCount]) => {
    recordRejectedCount(warnings, component, componentCount.rejected);
  });

  return {
    synchronizedAt: now.toISOString(),
    profileName,
    activities,
    plannedWorkouts,
    observations,
    derivedResults,
    snapshot,
    warnings: [...warnings],
    updated: [...updated],
    counts,
  };
}

export async function persistNormalizedAthleteData(
  fetchImpl: typeof fetch,
  service: SupabaseService,
  coachId: string,
  athleteId: string,
  syncKey: string,
  data: NormalizedAthleteData,
  request: ResolvedSyncRequest,
) {
  const response = await fetchImpl(`${service.url}/rest/v1/rpc/persist_athlete_sync`, {
    method: 'POST',
    headers: service.headers,
    body: JSON.stringify({
      target_athlete_id: athleteId,
      expected_sync_key: syncKey,
      target_coach_id: coachId,
      sync_payload: {
        sport: 'Ride',
        environment: request.environment,
        oldest: request.oldest,
        newest: request.newest,
        synchronized_at: data.synchronizedAt,
        status: data.warnings.length ? 'partial' : 'complete',
        warnings: data.warnings,
        updated: data.updated,
        counts: data.counts,
        profile_name: data.profileName,
        activities: data.activities,
        planned_workouts: data.plannedWorkouts,
        observations: data.observations,
        derived_results: data.derivedResults,
        snapshot: data.snapshot,
      },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to atomically persist synchronized athlete data');
  return (await response.json()) === true;
}

async function commitDefault(
  coachId: string,
  athleteId: string,
  syncKey: string,
  data: NormalizedAthleteData,
  request: ResolvedSyncRequest,
) {
  return persistNormalizedAthleteData(fetch, supabaseServiceConfiguration(), coachId, athleteId, syncKey, data, request);
}

const defaults: SyncDependencies = {
  authenticate: authenticateRequest,
  now: () => new Date(),
  resolveAthlete: resolveAthleteDefault,
  beginSync: beginSyncDefault,
  load: loadDefault,
  commit: commitDefault,
};

export function createSyncHandler(dependencies: Partial<SyncDependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async (event: SyncEvent) => {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método no permitido.' });
    if (!bearerToken(event.headers)) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
    try {
      const user = await deps.authenticate(event);
      if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
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
      const athlete = await deps.resolveAthlete(user.id, request.athleteId);
      if (!athlete) return jsonResponse(403, { error: 'Ciclista no autorizado.' });
      await deps.beginSync(athlete.id, request.syncKey);
      const loaded = await deps.load(athlete.intervalsAthleteId, request);
      const data = normalizeAthleteData(loaded, request, deps.now());
      if (!(await deps.commit(user.id, athlete.id, request.syncKey, data, request))) {
        return jsonResponse(409, { error: 'Sincronización sustituida por una solicitud más reciente.' });
      }
      return jsonResponse(data.warnings.length ? 207 : 200, {
        synchronizedAt: data.synchronizedAt,
        status: data.warnings.length ? 'partial' : 'complete',
        updated: data.updated,
        warnings: data.warnings,
        counts: data.counts,
      });
    } catch {
      return jsonResponse(500, { error: 'No se pudo sincronizar el ciclista.' });
    }
  };
}

export const handler = createSyncHandler();
