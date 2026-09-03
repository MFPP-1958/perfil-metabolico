import { observationSchema, type Observation } from '../../src/domain/observation.js';
import { authenticateRequest } from './lib/authorization.js';
import { bearerToken, jsonResponse } from './lib/http.js';

type ObservationEvent = { httpMethod: string; headers?: Record<string, string>; body?: string | null };
type Dependencies = {
  authenticate(event: ObservationEvent): Promise<{ id: string } | null>;
  canEdit(coachId: string, athleteId: string): Promise<boolean>;
  persist(coachId: string, observation: Observation): Promise<Observation>;
};

function configuration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing Supabase configuration');
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

async function canEditDefault(coachId: string, athleteId: string) {
  const { url, headers } = configuration();
  const query = new URLSearchParams({ select: 'athlete_id', coach_id: `eq.${coachId}`, athlete_id: `eq.${athleteId}`, role: 'eq.coach', limit: '1' });
  const response = await fetch(`${url}/rest/v1/coach_athletes?${query}`, { headers, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Unable to authorize observation');
  return ((await response.json()) as unknown[]).length === 1;
}

async function persistDefault(coachId: string, observation: Observation) {
  const { url, headers } = configuration();
  const response = await fetch(`${url}/rest/v1/observations`, {
    method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      id: observation.id, athlete_id: observation.athleteId, created_by: coachId, metric_code: observation.metricCode,
      value: observation.value, unit: observation.unit, observed_at: observation.observedAt, origin: observation.origin,
      quality: observation.quality, protocol_name: observation.protocol.name, protocol_version: observation.protocol.version,
      notes: observation.notes,
    }),
  });
  if (!response.ok) throw new Error('Unable to persist observation');
  return observation;
}

const defaults: Dependencies = { authenticate: authenticateRequest, canEdit: canEditDefault, persist: persistDefault };

export function createObservationsHandler(dependencies: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async (event: ObservationEvent) => {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método no permitido.' });
    if (!bearerToken(event.headers)) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
    if ((event.body?.length ?? 0) > 12_000) return jsonResponse(413, { error: 'La observación supera el tamaño permitido.' });
    try {
      const user = await deps.authenticate(event);
      if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
      const parsedJson = JSON.parse(event.body ?? '');
      const parsed = observationSchema.safeParse(parsedJson);
      if (!parsed.success) return jsonResponse(400, { error: parsed.error.issues[0]?.message ?? 'Observación no válida.' });
      if (!(await deps.canEdit(user.id, parsed.data.athleteId))) return jsonResponse(403, { error: 'No tienes permiso de edición para este ciclista.' });
      return jsonResponse(201, await deps.persist(user.id, parsed.data));
    } catch (error) {
      if (error instanceof SyntaxError) return jsonResponse(400, { error: 'El cuerpo de la observación no es JSON válido.' });
      return jsonResponse(500, { error: 'No se pudo guardar la observación.' });
    }
  };
}

export const handler = createObservationsHandler();
