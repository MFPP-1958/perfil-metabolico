import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { MaderInputs } from '../../src/physiology/mader/model.js';
import { MADER_MODEL_VERSION } from '../../src/physiology/mader/references.js';
import {
  buildMetabolicScenario,
  type EventProfile,
  type MetabolicScenarioResult,
} from '../../src/physiology/scenarios/scenario.js';
import { SCENARIO_MODEL_VERSION } from '../../src/physiology/scenarios/references.js';
import { authenticateRequest } from './lib/authorization.js';
import { bearerToken, jsonResponse } from './lib/http.js';

type ScenarioEvent = {
  httpMethod: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string> | null;
  body?: string | null;
};

type ScenarioRole = 'coach' | 'viewer';

export interface PersistScenarioInput {
  athleteId: string;
  createdBy: string;
  scenarioName: string;
  rationale: string;
  eventProfile: EventProfile;
  realInputs: MaderInputs;
  targets: { vlamax: number; vo2max?: number };
  referencePowerWatts: number;
  config: { restingVo2: number };
  modelVersions: { mader: string; scenario: string };
  outcome: MetabolicScenarioResult;
  contentHash: string;
}

export interface ScenarioDependencies {
  authenticate(event: ScenarioEvent): Promise<{ id: string } | null>;
  authorize(coachId: string, athleteId: string): Promise<ScenarioRole | null>;
  listScenarios(athleteId: string): Promise<unknown[]>;
  persistScenario(input: PersistScenarioInput): Promise<{ row: unknown; created: boolean }>;
}

interface SupabaseService {
  url: string;
  headers: Record<string, string>;
}

const positiveFinite = z.number().finite().positive();

/**
 * Forma de cada entrada real (VO₂max, VLa máx, masa, P@VO₂max): la calidad y
 * la procedencia se comprueban aquí solo en cuanto a su tipo. Si la entrada
 * no supera la guarda de procedencia de Mader (p. ej. una calidad
 * incompatible), `buildMetabolicScenario` la bloquea más adelante con un
 * motivo legible; este esquema no duplica esa regla de negocio.
 */
const modelInputSchema = z.strictObject({
  value: z.number().finite(),
  unit: z.string().min(1),
  quality: z.enum(['measured', 'calculated', 'imported_estimate', 'incomplete', 'rejected']),
  observationId: z.string().min(1),
  sourceReference: z.strictObject({
    software: z.string().min(1),
    version: z.string().min(1).optional(),
  }).optional(),
});

const saveScenarioSchema = z.strictObject({
  athleteId: z.uuid(),
  scenarioName: z.string().min(1).max(120),
  rationale: z.string().min(1).max(2_000),
  eventProfile: z.enum(['explosiva', 'rodador', 'escalador', 'fondo']),
  realInputs: z.strictObject({
    vo2max: modelInputSchema,
    vlamax: modelInputSchema,
    bodyMass: modelInputSchema,
    pVo2max: modelInputSchema,
    comparison: z.strictObject({
      ftpWatts: z.number().finite().positive().optional(),
      cpWatts: z.number().finite().positive().optional(),
      lt2Watts: z.number().finite().positive().optional(),
      mlssMeasuredWatts: z.number().finite().positive().optional(),
    }).optional(),
  }),
  targets: z.strictObject({
    vlamax: positiveFinite,
    vo2max: positiveFinite.optional(),
  }),
  referencePowerWatts: positiveFinite,
  config: z.strictObject({ restingVo2: positiveFinite }),
});

const listQuerySchema = z.strictObject({ athleteId: z.uuid() });

// Las columnas jsonb (real_inputs, targets, config, model_versions, outcome)
// ya se validaron por completo con `saveScenarioSchema` antes de escribirlas:
// aquí solo se comprueba que sigan siendo objetos, no se retipan campo a
// campo. `real_inputs` y las demás nunca se copian por spread hacia la
// respuesta; `scenarioResponse` reconstruye el objeto con nombres explícitos.
const rawScenarioRowSchema = z.object({
  id: z.uuid(),
  athlete_id: z.uuid(),
  created_by: z.uuid(),
  scenario_name: z.string().min(1).max(120),
  rationale: z.string().min(1).max(2_000),
  event_profile: z.enum(['explosiva', 'rodador', 'escalador', 'fondo']),
  real_inputs: z.record(z.string(), z.unknown()),
  targets: z.record(z.string(), z.unknown()),
  reference_power_watts: positiveFinite,
  config: z.record(z.string(), z.unknown()),
  model_versions: z.record(z.string(), z.unknown()),
  outcome: z.record(z.string(), z.unknown()),
  content_hash: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
});

function configuration(): SupabaseService {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing Supabase configuration');
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

async function authorizeDefault(coachId: string, athleteId: string): Promise<ScenarioRole | null> {
  const { url, headers } = configuration();
  const query = new URLSearchParams({
    select: 'role',
    coach_id: `eq.${coachId}`,
    athlete_id: `eq.${athleteId}`,
    limit: '1',
  });
  const response = await fetch(`${url}/rest/v1/coach_athletes?${query}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to authorize metabolic scenario access');
  const rows = await response.json() as Array<{ role?: unknown }>;
  return rows[0]?.role === 'coach' || rows[0]?.role === 'viewer' ? rows[0].role : null;
}

const scenarioSelect = [
  'id', 'athlete_id', 'created_by', 'scenario_name', 'rationale', 'event_profile',
  'real_inputs', 'targets', 'reference_power_watts', 'config', 'model_versions', 'outcome',
  'content_hash', 'created_at',
].join(',');

export async function listMetabolicScenarios(
  fetchImpl: typeof fetch,
  service: SupabaseService,
  athleteId: string,
) {
  const query = new URLSearchParams({
    select: scenarioSelect,
    athlete_id: `eq.${athleteId}`,
    order: 'created_at.desc',
  });
  const response = await fetchImpl(`${service.url}/rest/v1/metabolic_scenarios?${query}`, {
    headers: service.headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to load metabolic scenarios');
  return (await response.json()) as unknown[];
}

async function listScenariosDefault(athleteId: string) {
  return listMetabolicScenarios(fetch, configuration(), athleteId);
}

/**
 * Único punto de escritura de este archivo. Solo llama al REST de
 * `metabolic_scenarios`: nunca toca `observations` ni `derived_results`, que
 * son las tablas de mediciones reales. `on_conflict` sobre
 * `(athlete_id, content_hash)` hace que dos guardados idénticos resuelvan a
 * la misma fila en vez de duplicarla.
 */
export async function persistMetabolicScenario(
  fetchImpl: typeof fetch,
  service: SupabaseService,
  input: PersistScenarioInput,
) {
  const insertResponse = await fetchImpl(
    `${service.url}/rest/v1/metabolic_scenarios?on_conflict=athlete_id,content_hash`,
    {
      method: 'POST',
      headers: { ...service.headers, Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        athlete_id: input.athleteId,
        created_by: input.createdBy,
        scenario_name: input.scenarioName,
        rationale: input.rationale,
        event_profile: input.eventProfile,
        real_inputs: input.realInputs,
        targets: input.targets,
        reference_power_watts: input.referencePowerWatts,
        config: input.config,
        model_versions: input.modelVersions,
        outcome: input.outcome,
        content_hash: input.contentHash,
      }),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!insertResponse.ok) throw new Error('Unable to persist metabolic scenario');
  const inserted = (await insertResponse.json()) as unknown[];
  if (inserted[0]) return { row: inserted[0], created: true };

  const existingQuery = new URLSearchParams({
    select: scenarioSelect,
    athlete_id: `eq.${input.athleteId}`,
    content_hash: `eq.${input.contentHash}`,
    limit: '1',
  });
  const existingResponse = await fetchImpl(`${service.url}/rest/v1/metabolic_scenarios?${existingQuery}`, {
    headers: service.headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!existingResponse.ok) throw new Error('Unable to load metabolic scenario');
  const existing = (await existingResponse.json()) as unknown[];
  if (!existing[0]) throw new Error('Metabolic scenario was not returned');
  return { row: existing[0], created: false };
}

async function persistScenarioDefault(input: PersistScenarioInput) {
  return persistMetabolicScenario(fetch, configuration(), input);
}

const defaults: ScenarioDependencies = {
  authenticate: authenticateRequest,
  authorize: authorizeDefault,
  listScenarios: listScenariosDefault,
  persistScenario: persistScenarioDefault,
};

/**
 * JSON con las claves ordenadas de forma recursiva, para que el hash de
 * contenido no dependa del orden en que llegaron las claves del cuerpo.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function scenarioResponse(raw: unknown) {
  const row = rawScenarioRowSchema.parse(raw);
  return {
    id: row.id,
    athleteId: row.athlete_id,
    createdBy: row.created_by,
    scenarioName: row.scenario_name,
    rationale: row.rationale,
    eventProfile: row.event_profile,
    realInputs: row.real_inputs,
    targets: row.targets,
    referencePowerWatts: row.reference_power_watts,
    config: row.config,
    modelVersions: row.model_versions,
    outcome: row.outcome,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

export function createMetabolicScenarioHandler(dependencies: Partial<ScenarioDependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async (event: ScenarioEvent) => {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Método no permitido.' }, { Allow: 'GET, POST' });
    }
    if (!bearerToken(event.headers)) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });

    try {
      const user = await deps.authenticate(event);
      if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });

      if (event.httpMethod === 'GET') {
        const query = listQuerySchema.safeParse(event.queryStringParameters ?? {});
        if (!query.success) return jsonResponse(400, { error: 'Consulta de escenarios no válida.' });
        if (!(await deps.authorize(user.id, query.data.athleteId))) {
          return jsonResponse(403, { error: 'Ciclista no autorizado.' });
        }
        const rows = await deps.listScenarios(query.data.athleteId);
        return jsonResponse(200, rows.map(scenarioResponse));
      }

      const rawBody = event.body ?? '';
      if (Buffer.byteLength(rawBody, 'utf8') > 12 * 1024) {
        return jsonResponse(413, { error: 'El escenario supera el tamaño permitido.' });
      }
      let parsedBody: z.infer<typeof saveScenarioSchema>;
      try {
        parsedBody = saveScenarioSchema.parse(JSON.parse(rawBody));
      } catch {
        return jsonResponse(400, { error: 'Escenario no válido.' });
      }

      if ((await deps.authorize(user.id, parsedBody.athleteId)) !== 'coach') {
        return jsonResponse(403, { error: 'No tienes permiso para guardar escenarios de este ciclista.' });
      }

      // El propio servidor recalcula el resultado a partir de las entradas
      // reales enviadas: nada que el cliente afirme sobre el resultado se usa.
      const realInputs = parsedBody.realInputs as MaderInputs;
      const outcome = buildMetabolicScenario(
        realInputs,
        { restingVo2: parsedBody.config.restingVo2, referencePowerWatts: parsedBody.referencePowerWatts },
        parsedBody.targets,
      );
      if (outcome.status === 'blocked') {
        return jsonResponse(400, { error: outcome.reasons.join(' ') });
      }

      const modelVersions = { mader: MADER_MODEL_VERSION, scenario: SCENARIO_MODEL_VERSION };
      const contentHash = createHash('sha256').update(canonicalJson({
        athleteId: parsedBody.athleteId,
        realInputs: parsedBody.realInputs,
        targets: parsedBody.targets,
        referencePowerWatts: parsedBody.referencePowerWatts,
        config: parsedBody.config,
        modelVersions,
      })).digest('hex');

      const persisted = await deps.persistScenario({
        athleteId: parsedBody.athleteId,
        createdBy: user.id,
        scenarioName: parsedBody.scenarioName,
        rationale: parsedBody.rationale,
        eventProfile: parsedBody.eventProfile,
        realInputs,
        targets: parsedBody.targets,
        referencePowerWatts: parsedBody.referencePowerWatts,
        config: { restingVo2: parsedBody.config.restingVo2 },
        modelVersions,
        outcome,
        contentHash,
      });

      return jsonResponse(persisted.created ? 201 : 200, scenarioResponse(persisted.row));
    } catch {
      return jsonResponse(500, { error: event.httpMethod === 'GET'
        ? 'No se pudieron cargar los escenarios guardados.'
        : 'No se pudo guardar el escenario.' });
    }
  };
}

export const handler = createMetabolicScenarioHandler();
