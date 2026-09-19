import { z } from 'zod';
import { observationSchema, type Observation } from '../../src/domain/observation.js';
import { fromObservationRow, toObservationRow } from './lib/observation-rows.js';
import { authenticateRequest } from './lib/authorization.js';
import { bearerToken, jsonResponse } from './lib/http.js';

// Observaciones: crear una, crear varias de una vez (todas o ninguna) y retirar
// una errónea con su motivo. Nunca se borran: retirar deja el valor en el
// historial, fechado, y fuera de los cálculos.

type ObservationEvent = { httpMethod: string; headers?: Record<string, string>; body?: string | null };
type Dependencies = {
  authenticate(event: ObservationEvent): Promise<{ id: string } | null>;
  canEdit(coachId: string, athleteId: string): Promise<boolean>;
  persist(coachId: string, observation: Observation): Promise<Observation>;
  persistMany(coachId: string, observations: Observation[]): Promise<Observation[]>;
  retract(athleteId: string, observationId: string, reason: string): Promise<Observation | null>;
};

const MAX_BATCH = 20;
const batchSchema = z.strictObject({ observations: z.array(z.unknown()).min(1).max(MAX_BATCH) });
const retractSchema = z.strictObject({
  retract: z.strictObject({
    athleteId: z.uuid(),
    observationId: z.uuid(),
    reason: z.string().trim().min(1, 'Indica por qué retiras el valor.').max(500),
  }),
});

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

async function persistManyDefault(coachId: string, observations: Observation[]) {
  const { url, headers } = configuration();
  // PostgREST inserta un array en una sola sentencia: o entran todas o ninguna.
  const response = await fetch(`${url}/rest/v1/observations`, {
    method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(8_000),
    body: JSON.stringify(observations.map((observation) => toObservationRow(coachId, observation))),
  });
  if (!response.ok) throw new Error('Unable to persist observations');
  return observations;
}

async function persistDefault(coachId: string, observation: Observation) {
  const [saved] = await persistManyDefault(coachId, [observation]);
  return saved;
}

async function retractDefault(athleteId: string, observationId: string, reason: string) {
  const { url, headers } = configuration();
  const query = new URLSearchParams({ id: `eq.${observationId}`, athlete_id: `eq.${athleteId}`, retracted_at: 'is.null' });
  const response = await fetch(`${url}/rest/v1/observations?${query}`, {
    method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({ retracted_at: new Date().toISOString(), retraction_reason: reason }),
  });
  if (!response.ok) throw new Error('Unable to retract observation');
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows[0] ? fromObservationRow(rows[0]) : null;
}

const defaults: Dependencies = {
  authenticate: authenticateRequest,
  canEdit: canEditDefault,
  persist: persistDefault,
  persistMany: persistManyDefault,
  retract: retractDefault,
};

/** Valida una observación nueva: no puede nacer retirada. */
function parseNew(candidate: unknown): { observation: Observation } | { error: string } {
  const parsed = observationSchema.safeParse(candidate);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Observación no válida.' };
  if (parsed.data.retractedAt || parsed.data.retractionReason) return { error: 'Un valor nuevo no puede registrarse ya retirado.' };
  return { observation: parsed.data };
}

export function createObservationsHandler(dependencies: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async (event: ObservationEvent) => {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método no permitido.' });
    if (!bearerToken(event.headers)) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
    if ((event.body?.length ?? 0) > 16_000) return jsonResponse(413, { error: 'La observación supera el tamaño permitido.' });
    try {
      const user = await deps.authenticate(event);
      if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
      const body = JSON.parse(event.body ?? '') as unknown;

      if (body && typeof body === 'object' && 'retract' in body) {
        const parsed = retractSchema.safeParse(body);
        if (!parsed.success) return jsonResponse(400, { error: parsed.error.issues[0]?.message ?? 'Solicitud de retirada no válida.' });
        const { athleteId, observationId, reason } = parsed.data.retract;
        if (!(await deps.canEdit(user.id, athleteId))) return jsonResponse(403, { error: 'No tienes permiso de edición para este ciclista.' });
        const retracted = await deps.retract(athleteId, observationId, reason);
        if (!retracted) return jsonResponse(404, { error: 'Ese valor no existe para este ciclista o ya estaba retirado.' });
        return jsonResponse(200, retracted);
      }

      if (body && typeof body === 'object' && 'observations' in body) {
        const batch = batchSchema.safeParse(body);
        if (!batch.success) return jsonResponse(400, { error: `Un lote debe tener entre 1 y ${MAX_BATCH} valores.` });
        const observations: Observation[] = [];
        for (const candidate of batch.data.observations) {
          const result = parseNew(candidate);
          if ('error' in result) return jsonResponse(400, { error: result.error });
          observations.push(result.observation);
        }
        const athleteId = observations[0].athleteId;
        if (observations.some((observation) => observation.athleteId !== athleteId)) {
          return jsonResponse(400, { error: 'Un lote solo puede contener valores de un mismo ciclista.' });
        }
        if (!(await deps.canEdit(user.id, athleteId))) return jsonResponse(403, { error: 'No tienes permiso de edición para este ciclista.' });
        return jsonResponse(201, { observations: await deps.persistMany(user.id, observations) });
      }

      const single = parseNew(body);
      if ('error' in single) return jsonResponse(400, { error: single.error });
      if (!(await deps.canEdit(user.id, single.observation.athleteId))) return jsonResponse(403, { error: 'No tienes permiso de edición para este ciclista.' });
      return jsonResponse(201, await deps.persist(user.id, single.observation));
    } catch (error) {
      if (error instanceof SyntaxError) return jsonResponse(400, { error: 'El cuerpo de la observación no es JSON válido.' });
      return jsonResponse(500, { error: 'No se pudo guardar la observación.' });
    }
  };
}

export const handler = createObservationsHandler();
