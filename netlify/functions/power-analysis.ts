import { z } from 'zod';
import type { AnalysisEnvironment } from '../../src/analysis/types.js';
import { fitPowerDuration } from '../../src/physiology/power-duration/fit.js';
import type { CurveQuality, PowerDurationModel } from '../../src/physiology/power-duration/types.js';
import { authenticateRequest } from './lib/authorization.js';
import { bearerToken, jsonResponse } from './lib/http.js';

type PowerAnalysisEvent = {
  httpMethod: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string> | null;
  body?: string | null;
};

type AnalysisRole = 'coach' | 'viewer';

interface PowerQuery {
  athleteId: string;
  oldest: string;
  newest: string;
  environment: AnalysisEnvironment;
}

interface PowerAnalysisDependencies {
  authenticate(event: PowerAnalysisEvent): Promise<{ id: string } | null>;
  authorize(coachId: string, athleteId: string): Promise<AnalysisRole | null>;
  loadLatestSnapshot(query: PowerQuery): Promise<{ snapshot: unknown | null; ftp: unknown | null }>;
  loadSnapshot(snapshotId: string): Promise<unknown | null>;
  persistAnalysis(input: ConfirmedAnalysisPayload): Promise<{ row: unknown; created: boolean }>;
  now(): Date;
}

interface ConfirmedAnalysisPayload {
  athleteId: string;
  snapshotId: string;
  createdBy: string;
  model: PowerDurationModel;
  algorithmVersion: string;
  cpWatts: number;
  wPrimeJoules: number;
  pmaxWatts: number | null;
  rmseWatts: number;
  quality: CurveQuality;
}

interface SupabaseService {
  url: string;
  headers: Record<string, string>;
}

const positiveFinite = z.number().finite().positive();
const nonNegativeFinite = z.number().finite().nonnegative();

const pointSchema = z.strictObject({
  seconds: positiveFinite,
  watts: positiveFinite,
});

const sourcePowerModelSchema = z.strictObject({
  type: z.enum(['ECP', 'FFT_CURVES', 'MORTON_3P', 'MS_2P']),
  cpWatts: nonNegativeFinite.nullable(),
  wPrimeKj: nonNegativeFinite.nullable(),
  pmaxWatts: nonNegativeFinite.nullable(),
  ftpWatts: nonNegativeFinite.nullable(),
  r2: z.number().finite().nullable(),
});

const rawSnapshotSchema = z.object({
  id: z.uuid(),
  athlete_id: z.uuid(),
  sport: z.literal('Ride'),
  environment: z.enum(['all', 'outdoor', 'indoor']),
  oldest: z.iso.date(),
  newest: z.iso.date(),
  points: z.array(pointSchema).min(1),
  source_models: z.array(sourcePowerModelSchema),
  synchronized_at: z.iso.datetime({ offset: true }),
});

const rawFtpSchema = z.object({
  value: positiveFinite,
  observed_at: z.iso.datetime({ offset: true }),
  quality: z.literal('imported_estimate'),
});

export const powerSnapshotSchema = z.strictObject({
  id: z.uuid(),
  athleteId: z.uuid(),
  oldest: z.iso.date(),
  newest: z.iso.date(),
  environment: z.enum(['all', 'outdoor', 'indoor']),
  points: z.array(pointSchema).min(1),
  sourceModels: z.array(sourcePowerModelSchema),
  synchronizedAt: z.iso.datetime({ offset: true }),
  ftp: z.strictObject({
    value: positiveFinite,
    observedAt: z.iso.datetime({ offset: true }),
    quality: z.literal('imported_estimate'),
  }).nullable(),
});

const clientResultSchema = z.strictObject({
  cpWatts: nonNegativeFinite,
  wPrimeJoules: nonNegativeFinite,
  pmaxWatts: nonNegativeFinite.nullable(),
  rmseWatts: nonNegativeFinite,
});

const confirmationRequestSchema = z.strictObject({
  snapshotId: z.uuid(),
  model: z.enum(['ECP', 'MORTON_3P']),
  result: clientResultSchema,
});

const qualitySchema = z.strictObject({
  complete: z.boolean(),
  warnings: z.array(z.string()),
});

const rawAnalysisRunSchema = z.object({
  id: z.uuid(),
  snapshot_id: z.uuid(),
  model: z.enum(['ECP', 'MORTON_3P']),
  algorithm_version: z.string().min(1).max(120),
  cp_watts: nonNegativeFinite,
  w_prime_joules: nonNegativeFinite,
  pmax_watts: nonNegativeFinite.nullable(),
  rmse_watts: nonNegativeFinite,
  quality: qualitySchema,
  confirmed_at: z.iso.datetime({ offset: true }),
});

export const confirmedPowerAnalysisSchema = z.strictObject({
  id: z.uuid(),
  snapshotId: z.uuid(),
  model: z.enum(['ECP', 'MORTON_3P']),
  algorithmVersion: z.string().min(1).max(120),
  cpWatts: nonNegativeFinite,
  wPrimeJoules: nonNegativeFinite,
  pmaxWatts: nonNegativeFinite.nullable(),
  rmseWatts: nonNegativeFinite,
  quality: qualitySchema,
  confirmedAt: z.iso.datetime({ offset: true }),
});

const powerQuerySchema = z.strictObject({
  athleteId: z.uuid(),
  oldest: z.iso.date(),
  newest: z.iso.date(),
  environment: z.enum(['all', 'outdoor', 'indoor']),
});

function utcDay(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function parsePowerQuery(input: unknown, now: Date): PowerQuery | null {
  const parsed = powerQuerySchema.safeParse(input);
  if (!parsed.success) return null;
  const days = Math.floor((utcDay(parsed.data.newest) - utcDay(parsed.data.oldest)) / 86_400_000) + 1;
  if (parsed.data.newest > now.toISOString().slice(0, 10) || days < 1 || days > 730) return null;
  return parsed.data;
}

function configuration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing Supabase configuration');
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
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
  if (!response.ok) throw new Error('Unable to authorize power analysis');
  const rows = await response.json() as Array<{ role?: unknown }>;
  return rows[0]?.role === 'coach' || rows[0]?.role === 'viewer' ? rows[0].role : null;
}

const snapshotSelect = 'id,athlete_id,sport,environment,oldest,newest,points,source_models,synchronized_at';

export async function loadLatestPowerSnapshot(
  fetchImpl: typeof fetch,
  service: SupabaseService,
  query: PowerQuery,
) {
  const { url, headers } = service;
  const snapshotQuery = new URLSearchParams({
    select: snapshotSelect,
    athlete_id: `eq.${query.athleteId}`,
    sport: 'eq.Ride',
    environment: `eq.${query.environment}`,
    oldest: `eq.${query.oldest}`,
    newest: `eq.${query.newest}`,
    order: 'synchronized_at.desc',
    limit: '1',
  });
  const snapshotResponse = await fetchImpl(`${url}/rest/v1/power_curve_snapshots?${snapshotQuery}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!snapshotResponse.ok) throw new Error('Unable to load power curve snapshot');
  const snapshots = await snapshotResponse.json() as unknown[];
  if (!snapshots[0]) return { snapshot: null, ftp: null };

  const ftpQuery = new URLSearchParams({
    select: 'value,observed_at,quality',
    athlete_id: `eq.${query.athleteId}`,
    metric_code: 'eq.ftp',
    origin: 'eq.intervals_icu',
    quality: 'eq.imported_estimate',
    order: 'observed_at.desc',
    limit: '1',
  });
  const ftpResponse = await fetchImpl(`${url}/rest/v1/observations?${ftpQuery}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!ftpResponse.ok) throw new Error('Unable to load imported FTP observation');
  const ftpRows = await ftpResponse.json() as unknown[];
  return { snapshot: snapshots[0], ftp: ftpRows[0] ?? null };
}

async function loadLatestSnapshotDefault(query: PowerQuery) {
  return loadLatestPowerSnapshot(fetch, configuration(), query);
}

async function loadSnapshotDefault(snapshotId: string) {
  const { url, headers } = configuration();
  const query = new URLSearchParams({ select: snapshotSelect, id: `eq.${snapshotId}`, limit: '1' });
  const response = await fetch(`${url}/rest/v1/power_curve_snapshots?${query}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to load power curve snapshot');
  return ((await response.json()) as unknown[])[0] ?? null;
}

export async function persistConfirmedPowerAnalysis(
  fetchImpl: typeof fetch,
  service: SupabaseService,
  input: ConfirmedAnalysisPayload,
) {
  const insertResponse = await fetchImpl(
    `${service.url}/rest/v1/power_analysis_runs?on_conflict=snapshot_id,model,algorithm_version,created_by`,
    {
      method: 'POST',
      headers: { ...service.headers, Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        athlete_id: input.athleteId,
        snapshot_id: input.snapshotId,
        created_by: input.createdBy,
        model: input.model,
        algorithm_version: input.algorithmVersion,
        cp_watts: input.cpWatts,
        w_prime_joules: input.wPrimeJoules,
        pmax_watts: input.pmaxWatts,
        rmse_watts: input.rmseWatts,
        quality: input.quality,
      }),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!insertResponse.ok) throw new Error('Unable to persist confirmed power analysis');
  const inserted = await insertResponse.json() as unknown[];
  if (inserted[0]) return { row: inserted[0], created: true };

  const existingQuery = new URLSearchParams({
    select: 'id,snapshot_id,model,algorithm_version,cp_watts,w_prime_joules,pmax_watts,rmse_watts,quality,confirmed_at',
    snapshot_id: `eq.${input.snapshotId}`,
    model: `eq.${input.model}`,
    algorithm_version: `eq.${input.algorithmVersion}`,
    created_by: `eq.${input.createdBy}`,
    limit: '1',
  });
  const existingResponse = await fetchImpl(`${service.url}/rest/v1/power_analysis_runs?${existingQuery}`, {
    headers: service.headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!existingResponse.ok) throw new Error('Unable to load confirmed power analysis');
  const existing = await existingResponse.json() as unknown[];
  if (!existing[0]) throw new Error('Confirmed power analysis was not returned');
  return { row: existing[0], created: false };
}

async function persistAnalysisDefault(input: ConfirmedAnalysisPayload) {
  return persistConfirmedPowerAnalysis(fetch, configuration(), input);
}

const defaults: PowerAnalysisDependencies = {
  authenticate: authenticateRequest,
  authorize: authorizeDefault,
  loadLatestSnapshot: loadLatestSnapshotDefault,
  loadSnapshot: loadSnapshotDefault,
  persistAnalysis: persistAnalysisDefault,
  now: () => new Date(),
};

function snapshotResponse(snapshotInput: unknown, ftpInput: unknown | null) {
  const snapshot = rawSnapshotSchema.parse(snapshotInput);
  const ftp = ftpInput === null ? null : rawFtpSchema.parse(ftpInput);
  return powerSnapshotSchema.parse({
    id: snapshot.id,
    athleteId: snapshot.athlete_id,
    oldest: snapshot.oldest,
    newest: snapshot.newest,
    environment: snapshot.environment,
    points: snapshot.points,
    sourceModels: snapshot.source_models,
    synchronizedAt: snapshot.synchronized_at,
    ftp: ftp ? { value: ftp.value, observedAt: ftp.observed_at, quality: ftp.quality } : null,
  });
}

function analysisResponse(input: unknown) {
  const row = rawAnalysisRunSchema.parse(input);
  return confirmedPowerAnalysisSchema.parse({
    id: row.id,
    snapshotId: row.snapshot_id,
    model: row.model,
    algorithmVersion: row.algorithm_version,
    cpWatts: row.cp_watts,
    wPrimeJoules: row.w_prime_joules,
    pmaxWatts: row.pmax_watts,
    rmseWatts: row.rmse_watts,
    quality: row.quality,
    confirmedAt: row.confirmed_at,
  });
}

function displayedResultMatches(
  displayed: z.infer<typeof clientResultSchema>,
  recalculated: { cpWatts: number; wPrimeJoules: number; pmaxWatts: number | null; rmseWatts: number },
) {
  const matches = (left: number, right: number) => Math.abs(left - right) <= 0.01;
  const pmaxMatches = displayed.pmaxWatts === null || recalculated.pmaxWatts === null
    ? displayed.pmaxWatts === recalculated.pmaxWatts
    : matches(displayed.pmaxWatts, recalculated.pmaxWatts);
  return matches(displayed.cpWatts, recalculated.cpWatts)
    && matches(displayed.wPrimeJoules, recalculated.wPrimeJoules)
    && pmaxMatches
    && matches(displayed.rmseWatts, recalculated.rmseWatts);
}

export function createPowerAnalysisHandler(dependencies: Partial<PowerAnalysisDependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async (event: PowerAnalysisEvent) => {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Método no permitido.' });
    }
    if (!bearerToken(event.headers)) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });

    try {
      const user = await deps.authenticate(event);
      if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });

      if (event.httpMethod === 'GET') {
        const query = parsePowerQuery(event.queryStringParameters ?? {}, deps.now());
        if (!query) return jsonResponse(400, { error: 'Consulta de potencia no válida.' });
        if (!(await deps.authorize(user.id, query.athleteId))) {
          return jsonResponse(403, { error: 'Ciclista no autorizado.' });
        }
        const loaded = await deps.loadLatestSnapshot(query);
        if (!loaded.snapshot) {
          return jsonResponse(404, { error: 'No hay una curva sincronizada para este periodo y entorno.' });
        }
        return jsonResponse(200, snapshotResponse(loaded.snapshot, loaded.ftp));
      }

      const rawBody = event.body ?? '';
      if (Buffer.byteLength(rawBody, 'utf8') > 12 * 1024) {
        return jsonResponse(413, { error: 'La confirmación supera el tamaño permitido.' });
      }
      let parsedBody: z.infer<typeof confirmationRequestSchema>;
      try {
        parsedBody = confirmationRequestSchema.parse(JSON.parse(rawBody));
      } catch {
        return jsonResponse(400, { error: 'Confirmación de potencia no válida.' });
      }

      const rawSnapshot = await deps.loadSnapshot(parsedBody.snapshotId);
      if (!rawSnapshot) return jsonResponse(404, { error: 'La instantánea de potencia ya no está disponible.' });
      const snapshot = rawSnapshotSchema.parse(rawSnapshot);
      if ((await deps.authorize(user.id, snapshot.athlete_id)) !== 'coach') {
        return jsonResponse(403, { error: 'No tienes permiso para confirmar este análisis.' });
      }

      let recalculated;
      try {
        recalculated = fitPowerDuration({
          points: snapshot.points,
          sport: snapshot.sport,
          period: `${snapshot.oldest}/${snapshot.newest}`,
          indoor: snapshot.environment === 'all' ? null : snapshot.environment === 'indoor',
        }, parsedBody.model);
      } catch {
        return jsonResponse(409, { error: 'La curva no permite confirmar el modelo seleccionado.' });
      }
      if (!displayedResultMatches(parsedBody.result, recalculated)) {
        return jsonResponse(409, {
          error: 'Los resultados han cambiado. Recalcula el análisis antes de confirmarlo.',
        });
      }

      const persisted = await deps.persistAnalysis({
        athleteId: snapshot.athlete_id,
        snapshotId: snapshot.id,
        createdBy: user.id,
        model: parsedBody.model,
        algorithmVersion: recalculated.algorithmVersion,
        cpWatts: recalculated.cpWatts,
        wPrimeJoules: recalculated.wPrimeJoules,
        pmaxWatts: recalculated.pmaxWatts,
        rmseWatts: recalculated.rmseWatts,
        quality: recalculated.quality,
      });
      return jsonResponse(persisted.created ? 201 : 200, analysisResponse(persisted.row));
    } catch {
      return jsonResponse(500, { error: event.httpMethod === 'GET'
        ? 'No se pudo cargar el análisis de potencia.'
        : 'No se pudo confirmar el análisis de potencia.' });
    }
  };
}

export const handler = createPowerAnalysisHandler();
