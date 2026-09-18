import { z } from 'zod';
import type { WindowKind } from '../../analysis/snapshotWindow';
import type { AnalysisEnvironment } from '../../analysis/types';
import { getAccessToken } from '../../auth/supabase';

const positiveFinite = z.number().finite().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const coverageSchema = z.enum(['high', 'moderate', 'low', 'insufficient']);
const durationSchema = z.union([z.literal(10), z.literal(60), z.literal(300), z.literal(1_200)]);

const levelSchema = z.strictObject({
  afterKj: z.number().finite(),
  afterKjPerKg: z.number().finite().nullable(),
  fatiguedWatts: z.number().finite().nullable(),
  declinePercent: z.number().finite().nullable(),
  quality: z.enum(['observed', 'insufficient', 'incompatible']),
  supportingActivityCount: nonNegativeInteger,
  supportingEffortCount: nonNegativeInteger,
  powerSource: z.enum(['measured', 'unknown']),
});

const rowSchema = z.strictObject({
  seconds: durationSchema,
  freshWatts: z.number().finite().nullable(),
  levels: z.strictObject({
    kj0: levelSchema.optional(),
    kj1: levelSchema.optional(),
  }),
  onsetAfterKj: z.number().finite().nullable(),
  onsetAfterKjPerKg: z.number().finite().nullable(),
});

const canonicalRowsSchema = z.array(rowSchema).length(4).superRefine((rows, context) => {
  const durations = rows.map((row) => row.seconds).sort((left, right) => left - right);
  if (durations.join(',') !== '10,60,300,1200') {
    context.addIssue({ code: 'custom', message: 'Las duraciones canónicas no están completas.' });
  }
});

const qualitySchema = z.strictObject({
  coverage: coverageSchema,
  warnings: z.array(z.string()),
});

const resultSchema = z.strictObject({
  algorithmVersion: z.literal('durability-record-profile@2.0.0'),
  rows: canonicalRowsSchema,
  coverage: coverageSchema,
  warnings: z.array(z.string()),
});

export const durabilitySnapshotSchema = z.strictObject({
  id: z.uuid(),
  athleteId: z.uuid(),
  oldest: z.iso.date(),
  newest: z.iso.date(),
  environment: z.enum(['all', 'outdoor', 'indoor']),
  weightKg: positiveFinite.nullable(),
  weightObservedAt: z.iso.datetime({ offset: true }).nullable(),
  synchronizedAt: z.iso.datetime({ offset: true }),
  sourceVersion: z.string().min(1).max(120),
  result: resultSchema,
});

export const confirmedDurabilityAnalysisSchema = z.strictObject({
  id: z.uuid(),
  snapshotId: z.uuid(),
  algorithmVersion: z.literal('durability-record-profile@2.0.0'),
  comparisons: canonicalRowsSchema,
  quality: qualitySchema,
  confirmedAt: z.iso.datetime({ offset: true }),
});

export type DurabilityRow = z.infer<typeof rowSchema>;
export type DurabilityLevelResult = z.infer<typeof levelSchema>;
export type DurabilitySnapshotResponse = z.infer<typeof durabilitySnapshotSchema>;
export type ConfirmedDurabilityAnalysis = z.infer<typeof confirmedDurabilityAnalysisSchema>;

export interface DurabilitySnapshotQuery {
  athleteId: string;
  oldest: string;
  newest: string;
  environment: AnalysisEnvironment;
  window: WindowKind;
}

export interface ConfirmDurabilityAnalysisInput {
  snapshotId: string;
}

export interface DurabilityApi {
  load(query: DurabilitySnapshotQuery, signal: AbortSignal): Promise<DurabilitySnapshotResponse>;
  confirm(input: ConfirmDurabilityAnalysisInput): Promise<ConfirmedDurabilityAnalysis>;
}

interface DurabilityApiDependencies {
  getToken(): Promise<string>;
  fetchImpl: typeof fetch;
}

const statusMessages: Readonly<Record<number, string>> = {
  401: 'La sesión ha caducado. Inicia sesión de nuevo.',
  403: 'No tienes permiso para acceder a este análisis.',
  404: 'No hay un análisis de Durabilidad sincronizado para el periodo y entorno seleccionados.',
  409: 'El análisis ha quedado desactualizado. Vuelve a cargarlo antes de confirmar.',
};

function responseError(response: Response) {
  return statusMessages[response.status] ?? 'No se pudo completar la operación de Durabilidad.';
}

async function parseSuccessfulResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  try {
    return schema.parse(await response.json());
  } catch {
    throw new Error('La respuesta de Durabilidad no es válida.');
  }
}

export function createDurabilityApi(
  dependencies: Partial<DurabilityApiDependencies> = {},
): DurabilityApi {
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
      const response = await fetchImpl(`/.netlify/functions/durability-analysis?${search}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) throw new Error(responseError(response));
      return parseSuccessfulResponse(response, durabilitySnapshotSchema);
    },

    async confirm(input) {
      const token = await getToken();
      const response = await fetchImpl('/.netlify/functions/durability-analysis', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: input.snapshotId }),
      });
      if (!response.ok) throw new Error(responseError(response));
      return parseSuccessfulResponse(response, confirmedDurabilityAnalysisSchema);
    },
  };
}

export const durabilityApi = createDurabilityApi();
