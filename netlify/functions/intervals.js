import { authenticateRequest, listAuthorizedAthleteIds } from './lib/authorization.js';
import { bearerToken, jsonResponse } from './lib/http.js';

const INTERVALS_API = 'https://intervals.icu/api/v1';
const MAX_RESPONSE_BYTES = 5_000_000;
const ATHLETE_ID = /^i\d+$/;
const ACTIVITY_ID = /^i?\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const OPERATIONS = {
  athletes: { path: () => '/athletes', query: [] },
  athlete: { path: ({ athleteId }) => `/athlete/${athleteId}`, query: [], athlete: true },
  sport_settings: { path: ({ athleteId }) => `/athlete/${athleteId}/sport-settings`, query: [], athlete: true },
  power_curves: {
    path: ({ athleteId }) => `/athlete/${athleteId}/power-curves`,
    query: ['curves', 'type', 'subMaxEfforts', 'fatigue'],
    athlete: true,
  },
  activities: {
    path: ({ athleteId }) => `/athlete/${athleteId}/activities`,
    query: ['oldest', 'newest', 'limit'],
    athlete: true,
  },
  activity_streams: {
    path: ({ activityId }) => `/activity/${activityId}/streams`,
    query: ['types'],
    athlete: true,
    activity: true,
  },
  activity_intervals: {
    path: ({ activityId }) => `/activity/${activityId}/intervals`,
    query: [],
    athlete: true,
    activity: true,
  },
  planned_events: {
    path: ({ athleteId }) => `/athlete/${athleteId}/events`,
    query: ['oldest', 'newest', 'category'],
    athlete: true,
  },
};

const SENSITIVE_FIELDS = new Set([
  'icu_api_key', 'email', 'icu_friend_invite_token', 'has_password',
  'strava_id', 'strava_authorized', 'concept2_user_id', 'coros_user_id',
  'huawei_user_id', 'suunto_user_id', 'wahoo_user_id', 'zepp_user_id',
  'zwift_user_id', 'google_scope', 'dropbox_scope', 'oura_scope',
  'polar_scope', 'whoop_scope', 'push_notifications', 'has_push_subscriptions',
  'sponsored_by_chat_id', 'menstrual_phase', 'menstrual_cycle_length',
]);

export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_FIELDS.has(key))
      .map(([key, nested]) => [key, sanitize(nested)]),
  );
}

function validateRequest(query) {
  const operation = OPERATIONS[query.operation];
  if (!operation) return { error: 'Operación no permitida.' };
  const allowed = new Set(['operation', 'athleteId', 'activityId', ...operation.query]);
  if (Object.keys(query).some((key) => !allowed.has(key))) {
    return { error: 'La solicitud contiene parámetros no permitidos.' };
  }
  if (operation.athlete && !ATHLETE_ID.test(query.athleteId ?? '')) {
    return { error: 'El identificador del ciclista no es válido.' };
  }
  if (operation.activity && !ACTIVITY_ID.test(query.activityId ?? '')) {
    return { error: 'El identificador de la actividad no es válido.' };
  }
  for (const dateKey of ['oldest', 'newest']) {
    if (query[dateKey] && !ISO_DATE.test(query[dateKey])) {
      return { error: `El parámetro ${dateKey} no es una fecha ISO válida.` };
    }
  }
  if (query.limit && (!/^\d+$/.test(query.limit) || Number(query.limit) > 200)) {
    return { error: 'El límite solicitado no es válido.' };
  }
  if (query.oldest && query.newest) {
    const days = (Date.parse(query.newest) - Date.parse(query.oldest)) / 86_400_000;
    if (days < 0 || days > 550) return { error: 'El intervalo temporal no es válido.' };
  }
  return { operation };
}

function upstreamUrl(operation, query) {
  const params = new URLSearchParams();
  for (const key of operation.query) {
    if (query[key] !== undefined) params.set(key, query[key]);
  }
  const suffix = params.size ? `?${params}` : '';
  return `${INTERVALS_API}${operation.path(query)}${suffix}`;
}

async function defaultFetchIntervals(url) {
  const key = process.env.INTERVALS_API_KEY;
  if (!key) throw new Error('Missing server configuration: INTERVALS_API_KEY');
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${key}`).toString('base64')}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  });
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_RESPONSE_BYTES) return { status: 413, body: '' };
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) return { status: 413, body: '' };
  return { status: response.status, body };
}

export function createHandler(dependencies = {}) {
  const authenticate = dependencies.authenticate ?? authenticateRequest;
  const authorizedIds = dependencies.listAuthorizedAthleteIds ?? listAuthorizedAthleteIds;
  const fetchIntervals = dependencies.fetchIntervals ?? defaultFetchIntervals;

  return async function intervalsHandler(event) {
    if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Método no permitido.' });
    try {
      if (!bearerToken(event.headers)) {
        return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
      }
      const user = await authenticate(event);
      if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
      const query = event.queryStringParameters ?? {};
      const validation = validateRequest(query);
      if (validation.error) return jsonResponse(400, { error: validation.error });
      const roster = await authorizedIds(user.id);
      if (validation.operation.athlete && !roster.has(query.athleteId)) {
        return jsonResponse(403, { error: 'Ciclista no autorizado.' });
      }
      const upstream = await fetchIntervals(upstreamUrl(validation.operation, query));
      if (upstream.status < 200 || upstream.status >= 300) {
        const status = upstream.status === 413 ? 413 : 502;
        return jsonResponse(status, { error: 'No se pudo obtener el dato solicitado.' });
      }
      let data;
      try {
        data = JSON.parse(upstream.body);
      } catch {
        return jsonResponse(502, { error: 'La fuente devolvió una respuesta no válida.' });
      }
      const safe = sanitize(data);
      const result = query.operation === 'athletes'
        ? safe.filter((athlete) => roster.has(athlete.id))
        : safe;
      return jsonResponse(200, result);
    } catch {
      return jsonResponse(500, { error: 'No se pudo procesar la solicitud.' });
    }
  };
}

export const handler = createHandler();
