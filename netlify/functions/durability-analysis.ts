import { z } from 'zod';
import { calculateDurability, DURABILITY_ALGORITHM_VERSION } from '../../src/physiology/durability/calculate.js';
import type {
  CoverageQuality,
  DurabilityInput,
  DurabilityPoint,
  DurabilityRow,
} from '../../src/physiology/durability/types.js';
import { authenticateRequest } from './lib/authorization.js';
import { bearerToken, jsonResponse } from './lib/http.js';

export type DurabilityAnalysisEvent = {
  httpMethod: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string> | null;
  body?: string | null;
};

type AnalysisRole = 'coach' | 'viewer';
type AnalysisEnvironment = 'all' | 'outdoor' | 'indoor';

export interface DurabilityQuery {
  athleteId: string;
  oldest: string;
  newest: string;
  environment: AnalysisEnvironment;
}

export interface PersistedDurabilityAnalysis {
  athleteId: string;
  snapshotId: string;
  createdBy: string;
  algorithmVersion: typeof DURABILITY_ALGORITHM_VERSION;
  comparisons: DurabilityRow[];
  quality: { coverage: CoverageQuality; warnings: string[] };
}

export interface DurabilityAnalysisDependencies {
  authenticate(event: DurabilityAnalysisEvent): Promise<{ id: string } | null>;
  authorize(coachId: string, athleteId: string): Promise<AnalysisRole | null>;
  loadLatestSnapshot(query: DurabilityQuery): Promise<unknown | null>;
  loadSnapshot(snapshotId: string): Promise<unknown | null>;
  confirmAnalysis(input: PersistedDurabilityAnalysis): Promise<AtomicDurabilityConfirmation>;
  now(): Date;
}

export type AtomicDurabilityConfirmation =
  | { status: 'created'; analysis: unknown }
  | { status: 'existing'; analysis: unknown }
  | { status: 'stale' }
  | { status: 'not_found' };

interface SupabaseService {
  url: string;
  headers: Record<string, string>;
}

const positiveFinite = z.number().finite().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const nullableWeight = positiveFinite.nullable();
const environmentSchema = z.enum(['all', 'outdoor', 'indoor']);
const coverageSchema = z.enum(['high', 'moderate', 'low', 'insufficient']);
const powerSourceSchema = z.enum(['measured', 'unknown']);

const persistedPointSchema = z.strictObject({
  seconds: positiveFinite,
  watts: positiveFinite,
  activityId: z.string().nullable(),
  supportingActivityIds: z.array(z.string()),
  startIndex: nonNegativeInteger.nullable(),
  endIndex: nonNegativeInteger.nullable(),
  supportingActivityCount: nonNegativeInteger,
  supportingEffortCount: nonNegativeInteger,
  powerSource: powerSourceSchema,
});

const persistedFreshCurveSchema = z.strictObject({
  weightKg: nullableWeight,
  points: z.array(persistedPointSchema).min(1),
});

const persistedFatiguedCurveSchema = z.strictObject({
  level: z.enum(['kj0', 'kj1']),
  afterKj: positiveFinite,
  weightKg: nullableWeight,
  points: z.array(persistedPointSchema).min(1),
});

const rawSnapshotSchema = z.object({
  id: z.uuid(),
  athlete_id: z.uuid(),
  sport: z.literal('Ride'),
  environment: environmentSchema,
  oldest: z.iso.date(),
  newest: z.iso.date(),
  fresh_curve: persistedFreshCurveSchema,
  fatigued_curves: z.array(persistedFatiguedCurveSchema).max(2),
  weight_kg: nullableWeight,
  weight_observed_at: z.iso.datetime({ offset: true }).nullable(),
  source_version: z.string().min(1).max(120),
  synchronized_at: z.iso.datetime({ offset: true }),
});

const levelResultSchema = z.strictObject({
  afterKj: z.number().finite(),
  afterKjPerKg: z.number().finite().nullable(),
  fatiguedWatts: z.number().finite().nullable(),
  declinePercent: z.number().finite().nullable(),
  quality: z.enum(['observed', 'insufficient', 'incompatible']),
  supportingActivityCount: nonNegativeInteger,
  supportingEffortCount: nonNegativeInteger,
  powerSource: powerSourceSchema,
});

const durabilityRowSchema = z.strictObject({
  seconds: z.union([z.literal(10), z.literal(60), z.literal(300), z.literal(1_200)]),
  freshWatts: z.number().finite().nullable(),
  levels: z.strictObject({
    kj0: levelResultSchema.optional(),
    kj1: levelResultSchema.optional(),
  }),
  onsetAfterKj: z.number().finite().nullable(),
  onsetAfterKjPerKg: z.number().finite().nullable(),
});

const qualitySchema = z.strictObject({
  coverage: coverageSchema,
  warnings: z.array(z.string()),
});

const resultSchema = z.strictObject({
  algorithmVersion: z.literal(DURABILITY_ALGORITHM_VERSION),
  rows: z.array(durabilityRowSchema),
  coverage: coverageSchema,
  warnings: z.array(z.string()),
});

const rawAnalysisRunSchema = z.object({
  id: z.uuid(),
  snapshot_id: z.uuid(),
  created_by: z.uuid(),
  algorithm_version: z.literal(DURABILITY_ALGORITHM_VERSION),
  comparisons: z.array(durabilityRowSchema),
  quality: qualitySchema,
  confirmed_at: z.iso.datetime({ offset: true }),
});

const atomicConfirmationSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('created'), analysis: z.unknown() }),
  z.strictObject({ status: z.literal('existing'), analysis: z.unknown() }),
  z.strictObject({ status: z.literal('stale') }),
  z.strictObject({ status: z.literal('not_found') }),
]);

const querySchema = z.strictObject({
  athleteId: z.uuid(),
  oldest: z.iso.date(),
  newest: z.iso.date(),
  environment: environmentSchema,
});

const confirmationSchema = z.strictObject({ snapshotId: z.uuid() });

function utcDay(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function parseQuery(input: unknown, now: Date): DurabilityQuery | null {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return null;
  const days = Math.floor((utcDay(parsed.data.newest) - utcDay(parsed.data.oldest)) / 86_400_000) + 1;
  if (parsed.data.newest > now.toISOString().slice(0, 10) || days < 1 || days > 730) return null;
  return parsed.data;
}

function configuration(): SupabaseService {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing Supabase configuration');
  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  };
}

async function authorizeDefault(coachId: string, athleteId: string): Promise<AnalysisRole | null> {
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
  if (!response.ok) throw new Error('Unable to authorize durability analysis');
  const rows = await response.json() as Array<{ role?: unknown }>;
  return rows[0]?.role === 'coach' || rows[0]?.role === 'viewer' ? rows[0].role : null;
}

const snapshotSelect = [
  'id',
  'athlete_id',
  'sport',
  'environment',
  'oldest',
  'newest',
  'fresh_curve',
  'fatigued_curves',
  'weight_kg',
  'weight_observed_at',
  'source_version',
  'synchronized_at',
].join(',');

export async function loadLatestDurabilitySnapshot(
  fetchImpl: typeof fetch,
  service: SupabaseService,
  query: DurabilityQuery,
) {
  const search = new URLSearchParams({
    select: snapshotSelect,
    athlete_id: `eq.${query.athleteId}`,
    sport: 'eq.Ride',
    environment: `eq.${query.environment}`,
    oldest: `eq.${query.oldest}`,
    newest: `eq.${query.newest}`,
    order: 'synchronized_at.desc,id.desc',
    limit: '1',
  });
  const response = await fetchImpl(`${service.url}/rest/v1/durability_curve_snapshots?${search}`, {
    headers: service.headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to load durability snapshot');
  const rows = await response.json() as unknown[];
  return rows[0] ?? null;
}

async function loadLatestSnapshotDefault(query: DurabilityQuery) {
  return loadLatestDurabilitySnapshot(fetch, configuration(), query);
}

async function loadSnapshotDefault(snapshotId: string) {
  const service = configuration();
  const search = new URLSearchParams({ select: snapshotSelect, id: `eq.${snapshotId}`, limit: '1' });
  const response = await fetch(`${service.url}/rest/v1/durability_curve_snapshots?${search}`, {
    headers: service.headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to load durability snapshot');
  return ((await response.json()) as unknown[])[0] ?? null;
}

export async function confirmDurabilityAnalysisAtomically(
  fetchImpl: typeof fetch,
  service: SupabaseService,
  input: PersistedDurabilityAnalysis,
) {
  const response = await fetchImpl(`${service.url}/rest/v1/rpc/confirm_durability_analysis`, {
    method: 'POST',
    headers: service.headers,
    body: JSON.stringify({
      target_snapshot_id: input.snapshotId,
      target_created_by: input.createdBy,
      target_algorithm_version: input.algorithmVersion,
      target_comparisons: input.comparisons,
      target_quality: input.quality,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to confirm durability analysis atomically');
  return atomicConfirmationSchema.parse(await response.json());
}

async function confirmAnalysisDefault(input: PersistedDurabilityAnalysis) {
  return confirmDurabilityAnalysisAtomically(fetch, configuration(), input);
}

const defaults: DurabilityAnalysisDependencies = {
  authenticate: authenticateRequest,
  authorize: authorizeDefault,
  loadLatestSnapshot: loadLatestSnapshotDefault,
  loadSnapshot: loadSnapshotDefault,
  confirmAnalysis: confirmAnalysisDefault,
  now: () => new Date(),
};

function toDurabilityPoint(point: z.infer<typeof persistedPointSchema>): DurabilityPoint {
  return {
    seconds: point.seconds,
    watts: point.watts,
    activityId: point.activityId,
    supportingActivityCount: point.supportingActivityCount,
    supportingEffortCount: point.supportingEffortCount,
    powerSource: point.powerSource,
  };
}

function durabilityInput(snapshot: z.infer<typeof rawSnapshotSchema>): DurabilityInput {
  return {
    sport: snapshot.sport,
    environment: snapshot.environment,
    oldest: snapshot.oldest,
    newest: snapshot.newest,
    weightObservedAt: snapshot.weight_observed_at,
    fresh: {
      weightKg: snapshot.fresh_curve.weightKg,
      points: snapshot.fresh_curve.points.map(toDurabilityPoint),
    },
    fatigued: snapshot.fatigued_curves.map((curve) => ({
      level: curve.level,
      afterKj: curve.afterKj,
      weightKg: curve.weightKg,
      points: curve.points.map(toDurabilityPoint),
    })),
  };
}

function snapshotResponse(raw: unknown) {
  const snapshot = rawSnapshotSchema.parse(raw);
  const result = resultSchema.parse(calculateDurability(durabilityInput(snapshot)));
  return {
    id: snapshot.id,
    athleteId: snapshot.athlete_id,
    oldest: snapshot.oldest,
    newest: snapshot.newest,
    environment: snapshot.environment,
    weightKg: snapshot.weight_kg,
    weightObservedAt: snapshot.weight_observed_at,
    synchronizedAt: snapshot.synchronized_at,
    sourceVersion: snapshot.source_version,
    result,
  };
}

function analysisResponse(raw: unknown, expected?: Pick<PersistedDurabilityAnalysis, 'snapshotId' | 'algorithmVersion' | 'createdBy'>) {
  const row = rawAnalysisRunSchema.parse(raw);
  if (expected && (
    row.snapshot_id !== expected.snapshotId
    || row.algorithm_version !== expected.algorithmVersion
    || row.created_by !== expected.createdBy
  )) {
    throw new Error('Confirmed durability analysis does not match its owner');
  }
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    algorithmVersion: row.algorithm_version,
    comparisons: row.comparisons,
    quality: row.quality,
    confirmedAt: row.confirmed_at,
  };
}

export function createDurabilityAnalysisHandler(
  dependencies: Partial<DurabilityAnalysisDependencies> = {},
) {
  const deps = { ...defaults, ...dependencies };
  return async (event: DurabilityAnalysisEvent) => {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Método no permitido.' }, { Allow: 'GET, POST' });
    }
    if (!bearerToken(event.headers)) {
      return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
    }

    try {
      const user = await deps.authenticate(event);
      if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });

      if (event.httpMethod === 'GET') {
        const query = parseQuery(event.queryStringParameters ?? {}, deps.now());
        if (!query) return jsonResponse(400, { error: 'Consulta de Durabilidad no válida.' });
        if (!(await deps.authorize(user.id, query.athleteId))) {
          return jsonResponse(403, { error: 'Ciclista no autorizado.' });
        }
        const rawSnapshot = await deps.loadLatestSnapshot(query);
        if (!rawSnapshot) {
          return jsonResponse(404, { error: 'No hay una instantánea de Durabilidad para este periodo y entorno.' });
        }
        return jsonResponse(200, snapshotResponse(rawSnapshot));
      }

      const rawBody = event.body ?? '';
      if (Buffer.byteLength(rawBody, 'utf8') > 12 * 1024) {
        return jsonResponse(413, { error: 'La confirmación supera el tamaño permitido.' });
      }
      let confirmation: z.infer<typeof confirmationSchema>;
      try {
        confirmation = confirmationSchema.parse(JSON.parse(rawBody));
      } catch {
        return jsonResponse(400, { error: 'Confirmación de Durabilidad no válida.' });
      }

      const rawSnapshot = await deps.loadSnapshot(confirmation.snapshotId);
      if (!rawSnapshot) {
        return jsonResponse(404, { error: 'La instantánea de Durabilidad ya no está disponible.' });
      }
      const snapshot = rawSnapshotSchema.parse(rawSnapshot);
      if ((await deps.authorize(user.id, snapshot.athlete_id)) !== 'coach') {
        return jsonResponse(403, { error: 'No tienes permiso para confirmar este análisis.' });
      }

      const result = resultSchema.parse(calculateDurability(durabilityInput(snapshot)));
      if (result.coverage === 'insufficient') {
        return jsonResponse(409, { error: 'La instantánea no tiene cobertura suficiente para confirmarla.' });
      }

      const confirmationInput = {
        athleteId: snapshot.athlete_id,
        snapshotId: snapshot.id,
        createdBy: user.id,
        algorithmVersion: result.algorithmVersion,
        comparisons: result.rows,
        quality: { coverage: result.coverage, warnings: result.warnings },
      };
      const persisted = await deps.confirmAnalysis(confirmationInput);
      if (persisted.status === 'not_found') {
        return jsonResponse(404, { error: 'La instantánea de Durabilidad ya no está disponible.' });
      }
      if (persisted.status === 'stale') {
        return jsonResponse(409, { error: 'La instantánea ha quedado obsoleta. Vuelve a cargar el análisis.' });
      }
      return jsonResponse(
        persisted.status === 'created' ? 201 : 200,
        analysisResponse(persisted.analysis, confirmationInput),
      );
    } catch {
      return jsonResponse(500, {
        error: event.httpMethod === 'GET'
          ? 'No se pudo cargar el análisis de Durabilidad.'
          : 'No se pudo confirmar el análisis de Durabilidad.',
      });
    }
  };
}

export const handler = createDurabilityAnalysisHandler();
