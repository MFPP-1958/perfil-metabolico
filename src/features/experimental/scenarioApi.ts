import { z } from 'zod';
import { getAccessToken } from '../../auth/supabase';
import type { MaderInputs } from '../../physiology/mader/model';
import type { EventProfile } from '../../physiology/scenarios/scenario';

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

const realInputsSchema = z.strictObject({
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
});

const targetsSchema = z.strictObject({
  vlamax: z.number().finite().positive(),
  vo2max: z.number().finite().positive().optional(),
});

const configSchema = z.strictObject({ restingVo2: z.number().finite().positive() });

const modelVersionsSchema = z.strictObject({
  mader: z.string().min(1),
  scenario: z.string().min(1),
});

const substratePointSchema = z.strictObject({
  powerWatts: z.number().finite(),
  percentVo2max: z.number().finite(),
  pyruvateDeficit: z.number().finite(),
  netLactateAccumulation: z.number().finite(),
  fatOxidationGramsPerMin: z.number().finite(),
  carbohydrateGramsPerHour: z.number().finite(),
  energyKcalPerHour: z.number().finite(),
});

const substrateProjectionSchema = z.strictObject({
  curve: z.array(substratePointSchema),
  fatmax: substratePointSchema,
  mlss: substratePointSchema,
});

const scenarioChangeSchema = z.strictObject({
  fatmaxWattsDelta: z.number().finite(),
  fatmaxFatGramsPerMinDelta: z.number().finite(),
  mlssWattsDelta: z.number().finite(),
  fatGramsPerMinDeltaAtReference: z.number().finite(),
  carbohydrateGramsPerHourDeltaAtReference: z.number().finite(),
  percentVo2maxAtReference: z.strictObject({
    current: z.number().finite(),
    target: z.number().finite(),
  }),
});

const scenarioOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('blocked'),
    reasons: z.array(z.string()),
    version: z.string().min(1),
  }),
  z.strictObject({
    status: z.literal('calculated'),
    version: z.string().min(1),
    current: substrateProjectionSchema,
    target: substrateProjectionSchema,
    appliedTargets: z.strictObject({ vlamax: z.number().finite(), vo2max: z.number().finite() }),
    realValues: z.strictObject({ vlamax: z.number().finite(), vo2max: z.number().finite() }),
    change: scenarioChangeSchema,
    referencePowerWatts: z.number().finite().positive(),
    comparable: z.boolean(),
    withinSensitivity: z.boolean(),
    notices: z.array(z.string()),
    limitations: z.array(z.string()),
    inputLineage: z.array(z.string()),
    cadenceWarning: z.string(),
    provenanceNotices: z.array(z.string()),
    reportEligible: z.boolean(),
  }),
]);

export const savedScenarioSchema = z.strictObject({
  id: z.uuid(),
  athleteId: z.uuid(),
  createdBy: z.uuid(),
  scenarioName: z.string().min(1).max(120),
  rationale: z.string().min(1).max(2_000),
  eventProfile: z.enum(['explosiva', 'rodador', 'escalador', 'fondo']),
  realInputs: realInputsSchema,
  targets: targetsSchema,
  referencePowerWatts: z.number().finite().positive(),
  config: configSchema,
  modelVersions: modelVersionsSchema,
  outcome: scenarioOutcomeSchema,
  contentHash: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
});

const savedScenarioListSchema = z.array(savedScenarioSchema);

export type SavedScenario = z.infer<typeof savedScenarioSchema>;

export interface SaveScenarioInput {
  athleteId: string;
  scenarioName: string;
  rationale: string;
  eventProfile: EventProfile;
  realInputs: MaderInputs;
  targets: { vlamax: number; vo2max?: number };
  referencePowerWatts: number;
  config: { restingVo2: number };
}

/**
 * Lo que respondió el servidor al guardar. `created` en falso significa que ya
 * tenía guardado un escenario con estos mismos números y ha devuelto aquel: el
 * nombre y la justificación recién escritos no se han guardado, y quien llame
 * debe decirlo en vez de dar el guardado por bueno.
 */
export interface SaveScenarioResult {
  scenario: SavedScenario;
  created: boolean;
}

export interface ScenarioApi {
  list(athleteId: string, signal: AbortSignal): Promise<SavedScenario[]>;
  save(input: SaveScenarioInput): Promise<SaveScenarioResult>;
}

interface ScenarioApiDependencies {
  getToken(): Promise<string>;
  fetchImpl: typeof fetch;
}

const statusMessages: Readonly<Record<number, string>> = {
  401: 'La sesión ha caducado. Inicia sesión de nuevo.',
  403: 'No tienes permiso para acceder a los escenarios de este ciclista.',
};

async function responseError(response: Response) {
  const known = statusMessages[response.status];
  if (known) return known;
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // El mensaje estable de abajo evita filtrar el texto sin validar de la respuesta.
  }
  return 'No se pudo completar la operación con el escenario.';
}

async function parseSuccessfulResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  try {
    return schema.parse(await response.json());
  } catch {
    throw new Error('La respuesta de escenarios no es válida.');
  }
}

export function createScenarioApi(dependencies: Partial<ScenarioApiDependencies> = {}): ScenarioApi {
  const getToken = dependencies.getToken ?? getAccessToken;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  return {
    async list(athleteId, signal) {
      const token = await getToken();
      const search = new URLSearchParams({ athleteId });
      const response = await fetchImpl(`/.netlify/functions/metabolic-scenarios?${search}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) throw new Error(await responseError(response));
      return parseSuccessfulResponse(response, savedScenarioListSchema);
    },

    async save(input) {
      const token = await getToken();
      const response = await fetchImpl('/.netlify/functions/metabolic-scenarios', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await responseError(response));
      // 201 lo creó; 200 significa que ya existía uno idéntico y devuelve aquel.
      const created = response.status === 201;
      return { scenario: await parseSuccessfulResponse(response, savedScenarioSchema), created };
    },
  };
}

export const scenarioApi = createScenarioApi();
