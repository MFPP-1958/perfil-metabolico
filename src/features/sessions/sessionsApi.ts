import { z } from 'zod';
import { getAccessToken } from '../../auth/supabase';

const nullableFinite = z.number().finite().nullable();

const activitySchema = z.strictObject({
  id: z.uuid(),
  startedAt: z.string().min(1),
  name: z.string().nullable(),
  durationSeconds: z.number().finite().nonnegative(),
  averagePowerWatts: nullableFinite,
  indoor: z.boolean().nullable(),
});

const activityListSchema = z.strictObject({ activities: z.array(activitySchema) });

const intervalSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  type: z.string(),
  startSeconds: nullableFinite,
  movingSeconds: z.number().finite().nonnegative(),
  averageWatts: nullableFinite,
  averageHeartRate: nullableFinite,
  averageCadence: nullableFinite,
});

const streamSchema = z.strictObject({
  time: z.array(z.number().finite()),
  watts: z.array(nullableFinite),
  heartRate: z.array(nullableFinite).nullable(),
  cadence: z.array(nullableFinite).nullable(),
}).refine((stream) => stream.watts.length === stream.time.length
  && (stream.heartRate?.length ?? stream.time.length) === stream.time.length
  && (stream.cadence?.length ?? stream.time.length) === stream.time.length, 'Señal desalineada.');

const sessionDetailSchema = z.strictObject({
  activityId: z.uuid(),
  intervals: z.array(intervalSchema),
  powerZones: z.array(z.number().finite()).nullable(),
  stream: streamSchema.nullable(),
});

export type SessionActivity = z.infer<typeof activitySchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;

export interface SessionsApi {
  list(query: { athleteId: string; oldest: string; newest: string }, signal: AbortSignal): Promise<SessionActivity[]>;
  detail(query: { athleteId: string; activityId: string }, signal: AbortSignal): Promise<SessionDetail>;
}

const statusMessages: Readonly<Record<number, string>> = {
  401: 'La sesión ha caducado. Inicia sesión de nuevo.',
  403: 'No tienes permiso para ver las sesiones de este ciclista.',
  404: 'Esa actividad no está guardada para este ciclista. Sincroniza y vuelve a intentarlo.',
  502: 'Intervals.icu no devolvió los intervalos de esta actividad. Prueba de nuevo en un momento.',
};

async function request<T>(url: string, schema: z.ZodType<T>, signal: AbortSignal, getToken: () => Promise<string>, fetchImpl: typeof fetch) {
  const token = await getToken();
  const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal });
  if (!response.ok) throw new Error(statusMessages[response.status] ?? 'No se pudieron leer las sesiones.');
  try {
    return schema.parse(await response.json());
  } catch {
    throw new Error('La respuesta de sesiones no es válida.');
  }
}

export function createSessionsApi(dependencies: { getToken?: () => Promise<string>; fetchImpl?: typeof fetch } = {}): SessionsApi {
  const getToken = dependencies.getToken ?? getAccessToken;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  return {
    async list(query, signal) {
      const search = new URLSearchParams(query);
      const body = await request(`/.netlify/functions/sessions?${search}`, activityListSchema, signal, getToken, fetchImpl);
      return body.activities;
    },
    detail(query, signal) {
      const search = new URLSearchParams(query);
      return request(`/.netlify/functions/sessions?${search}`, sessionDetailSchema, signal, getToken, fetchImpl);
    },
  };
}

export const sessionsApi = createSessionsApi();
