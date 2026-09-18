import { z } from 'zod';
import type { WindowKind } from '../../analysis/snapshotWindow';
import type { AnalysisEnvironment } from '../../analysis/types';
import { getAccessToken } from '../../auth/supabase';
import type { PowerDurationModel } from '../../physiology/power-duration/types';

const nonNegativeFinite = z.number().finite().nonnegative();
const positiveFinite = z.number().finite().positive();

const pointSchema = z.strictObject({ seconds: positiveFinite, watts: positiveFinite });

const sourcePowerModelSchema = z.strictObject({
  type: z.enum(['ECP', 'FFT_CURVES', 'MORTON_3P', 'MS_2P']),
  cpWatts: nonNegativeFinite.nullable(),
  wPrimeKj: nonNegativeFinite.nullable(),
  pmaxWatts: nonNegativeFinite.nullable(),
  ftpWatts: nonNegativeFinite.nullable(),
  r2: z.number().finite().nullable(),
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

const qualitySchema = z.strictObject({
  complete: z.boolean(),
  warnings: z.array(z.string()),
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

export type SourcePowerModel = z.infer<typeof sourcePowerModelSchema>;
export type PowerSnapshot = z.infer<typeof powerSnapshotSchema>;
export type ConfirmedPowerAnalysis = z.infer<typeof confirmedPowerAnalysisSchema>;

export interface PowerSnapshotQuery {
  athleteId: string;
  oldest: string;
  newest: string;
  environment: AnalysisEnvironment;
  window: WindowKind;
}

export interface ConfirmPowerAnalysisInput {
  snapshotId: string;
  model: PowerDurationModel;
  result: {
    cpWatts: number;
    wPrimeJoules: number;
    pmaxWatts: number | null;
    rmseWatts: number;
  };
}

export interface PowerApi {
  load(query: PowerSnapshotQuery, signal: AbortSignal): Promise<PowerSnapshot>;
  confirm(input: ConfirmPowerAnalysisInput): Promise<ConfirmedPowerAnalysis>;
}

interface PowerApiDependencies {
  getToken(): Promise<string>;
  fetchImpl: typeof fetch;
}

const statusMessages: Readonly<Record<number, string>> = {
  401: 'La sesión ha caducado. Inicia sesión de nuevo.',
  403: 'No tienes permiso para acceder a este análisis.',
  404: 'No hay una curva sincronizada para el periodo y entorno seleccionados.',
  409: 'El análisis está desactualizado. Recalcula los resultados antes de confirmarlo.',
};

async function responseError(response: Response) {
  const known = statusMessages[response.status];
  if (known) return known;
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // The stable fallback below avoids exposing transport response text.
  }
  return 'No se pudo completar la operación de potencia.';
}

async function parseSuccessfulResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  try {
    return schema.parse(await response.json());
  } catch {
    throw new Error('La respuesta de potencia no es válida.');
  }
}

export function createPowerApi(dependencies: Partial<PowerApiDependencies> = {}): PowerApi {
  const getToken = dependencies.getToken ?? getAccessToken;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  return {
    async load(query, signal) {
      const token = await getToken();
      const search = new URLSearchParams({
        athleteId: query.athleteId,
        oldest: query.oldest,
        newest: query.newest,
        environment: query.environment,
        window: query.window,
      });
      const response = await fetchImpl(`/.netlify/functions/power-analysis?${search}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) throw new Error(await responseError(response));
      return parseSuccessfulResponse(response, powerSnapshotSchema);
    },

    async confirm(input) {
      const token = await getToken();
      const response = await fetchImpl('/.netlify/functions/power-analysis', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await responseError(response));
      return parseSuccessfulResponse(response, confirmedPowerAnalysisSchema);
    },
  };
}

export const powerApi = createPowerApi();
