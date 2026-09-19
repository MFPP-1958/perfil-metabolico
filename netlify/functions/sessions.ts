import { z } from 'zod';
import { authenticateRequest } from './lib/authorization.js';
import { bearerToken, jsonResponse } from './lib/http.js';

// Sesiones: lista las actividades guardadas del ciclista y, para una de ellas,
// trae de Intervals.icu los intervalos detectados y las zonas de potencia. No
// escribe nada: la pauta se lee del título y el veredicto se calcula en pantalla.

type SessionsEvent = {
  httpMethod: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string> | null;
};

type Role = 'coach' | 'viewer';

interface StoredActivity {
  id: string;
  started_at: string;
  duration_seconds: number;
  indoor: boolean | null;
  normalized_data: Record<string, unknown>;
}

interface SessionsDependencies {
  authenticate(event: SessionsEvent): Promise<{ id: string } | null>;
  authorize(coachId: string, athleteId: string): Promise<Role | null>;
  listActivities(athleteId: string, oldest: string, newest: string): Promise<StoredActivity[]>;
  loadActivity(athleteId: string, activityId: string): Promise<{ intervalsActivityId: string; intervalsAthleteId: string } | null>;
  fetchIntervals(intervalsActivityId: string): Promise<unknown>;
  fetchSportSettings(intervalsAthleteId: string): Promise<unknown>;
}

const isoDate = z.iso.date();
const listQuerySchema = z.strictObject({ athleteId: z.uuid(), oldest: isoDate, newest: isoDate })
  .refine((query) => query.oldest <= query.newest, 'El periodo no es válido.')
  .refine((query) => (Date.parse(query.newest) - Date.parse(query.oldest)) / 86_400_000 <= 550, 'El periodo es demasiado largo.');
const detailQuerySchema = z.strictObject({ athleteId: z.uuid(), activityId: z.uuid() });

const INTERVALS_ACTIVITY_ID = /^i?\d+$/;
const INTERVALS_ATHLETE_ID = /^i\d+$/;

const finiteOrNull = z.number().finite().nullable().optional().transform((value) => value ?? null);
const rawIntervalSchema = z.object({
  type: z.string().optional(),
  moving_time: z.number().finite().nonnegative().optional(),
  start_time: finiteOrNull,
  average_watts: finiteOrNull,
  average_heartrate: finiteOrNull,
  average_cadence: finiteOrNull,
}).loose();

export function mapIntervals(raw: unknown) {
  const list = (raw as { icu_intervals?: unknown } | null)?.icu_intervals;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item, index) => {
    const parsed = rawIntervalSchema.safeParse(item);
    if (!parsed.success) return [];
    const interval = parsed.data;
    return [{
      index,
      type: interval.type ?? 'UNKNOWN',
      startSeconds: interval.start_time,
      movingSeconds: interval.moving_time ?? 0,
      averageWatts: interval.average_watts,
      averageHeartRate: interval.average_heartrate,
      averageCadence: interval.average_cadence,
    }];
  });
}

export function rideZones(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const ride = raw.find((setting) => Array.isArray(setting?.types) && setting.types.includes('Ride'));
  const zones = ride?.power_zones;
  if (!Array.isArray(zones) || !zones.length || !zones.every((zone) => typeof zone === 'number' && Number.isFinite(zone))) return null;
  return zones;
}

function supabaseConfiguration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing Supabase configuration');
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

async function authorizeDefault(coachId: string, athleteId: string): Promise<Role | null> {
  const { url, headers } = supabaseConfiguration();
  const query = new URLSearchParams({ select: 'role', coach_id: `eq.${coachId}`, athlete_id: `eq.${athleteId}`, limit: '1' });
  const response = await fetch(`${url}/rest/v1/coach_athletes?${query}`, { headers, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Unable to authorize sessions');
  const rows = await response.json() as Array<{ role?: unknown }>;
  return rows[0]?.role === 'coach' || rows[0]?.role === 'viewer' ? rows[0].role : null;
}

function nextDay(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

async function listActivitiesDefault(athleteId: string, oldest: string, newest: string) {
  const { url, headers } = supabaseConfiguration();
  const query = new URLSearchParams({
    select: 'id,started_at,duration_seconds,indoor,normalized_data',
    athlete_id: `eq.${athleteId}`,
    order: 'started_at.desc',
    limit: '500',
  });
  query.append('started_at', `gte.${oldest}T00:00:00Z`);
  query.append('started_at', `lt.${nextDay(newest)}T00:00:00Z`);
  const response = await fetch(`${url}/rest/v1/activities?${query}`, { headers, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Unable to list activities');
  return await response.json() as StoredActivity[];
}

async function loadActivityDefault(athleteId: string, activityId: string) {
  const { url, headers } = supabaseConfiguration();
  const query = new URLSearchParams({
    select: 'intervals_activity_id,athletes!inner(intervals_athlete_id)',
    id: `eq.${activityId}`,
    athlete_id: `eq.${athleteId}`,
    limit: '1',
  });
  const response = await fetch(`${url}/rest/v1/activities?${query}`, { headers, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Unable to load activity');
  const rows = await response.json() as Array<{ intervals_activity_id?: unknown; athletes?: { intervals_athlete_id?: unknown } }>;
  const row = rows[0];
  if (typeof row?.intervals_activity_id !== 'string' || typeof row.athletes?.intervals_athlete_id !== 'string') return null;
  return { intervalsActivityId: row.intervals_activity_id, intervalsAthleteId: row.athletes.intervals_athlete_id };
}

async function fetchIntervalsApi(path: string) {
  const key = process.env.INTERVALS_API_KEY;
  if (!key) throw new Error('Missing Intervals configuration');
  const response = await fetch(`https://intervals.icu/api/v1${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(`API_KEY:${key}`).toString('base64')}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Intervals operation failed: ${response.status}`);
  return response.json() as Promise<unknown>;
}

const defaults: SessionsDependencies = {
  authenticate: authenticateRequest,
  authorize: authorizeDefault,
  listActivities: listActivitiesDefault,
  loadActivity: loadActivityDefault,
  fetchIntervals: (id) => fetchIntervalsApi(`/activity/${id}/intervals`),
  fetchSportSettings: (id) => fetchIntervalsApi(`/athlete/${id}/sport-settings`),
};

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createSessionsHandler(dependencies: Partial<SessionsDependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async (event: SessionsEvent) => {
    if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Método no permitido.' }, { Allow: 'GET' });
    if (!bearerToken(event.headers)) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
    const rawQuery = event.queryStringParameters ?? {};
    const isDetail = 'activityId' in rawQuery;
    const listQuery = isDetail ? null : listQuerySchema.safeParse(rawQuery);
    const detailQuery = isDetail ? detailQuerySchema.safeParse(rawQuery) : null;
    const parsed = listQuery ?? detailQuery;
    if (!parsed?.success) return jsonResponse(400, { error: 'La consulta de sesiones no es válida.' });

    try {
      const user = await deps.authenticate(event);
      if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
      const athleteId = parsed.data.athleteId;
      if (!(await deps.authorize(user.id, athleteId))) return jsonResponse(403, { error: 'Ciclista no autorizado.' });

      if (listQuery?.success) {
        const rows = await deps.listActivities(athleteId, listQuery.data.oldest, listQuery.data.newest);
        return jsonResponse(200, {
          activities: rows.map((row) => ({
            id: row.id,
            startedAt: row.started_at,
            name: typeof row.normalized_data?.name === 'string' ? row.normalized_data.name : null,
            durationSeconds: row.duration_seconds,
            averagePowerWatts: optionalNumber(row.normalized_data?.averagePowerWatts),
            indoor: row.indoor,
          })),
        });
      }

      const activityId = (detailQuery as { data: { activityId: string } }).data.activityId;
      const activity = await deps.loadActivity(athleteId, activityId);
      if (!activity || !INTERVALS_ACTIVITY_ID.test(activity.intervalsActivityId) || !INTERVALS_ATHLETE_ID.test(activity.intervalsAthleteId)) {
        return jsonResponse(404, { error: 'La actividad no existe para este ciclista.' });
      }
      let rawIntervals: unknown;
      try {
        rawIntervals = await deps.fetchIntervals(activity.intervalsActivityId);
      } catch {
        return jsonResponse(502, { error: 'Intervals.icu no devolvió los intervalos de esta actividad.' });
      }
      // Sin zonas se puede seguir: solo faltarán los objetivos escritos por zona.
      const powerZones = await deps.fetchSportSettings(activity.intervalsAthleteId).then(rideZones, () => null);
      return jsonResponse(200, { activityId, intervals: mapIntervals(rawIntervals), powerZones });
    } catch {
      return jsonResponse(500, { error: 'No se pudieron leer las sesiones.' });
    }
  };
}

export const handler = createSessionsHandler();
