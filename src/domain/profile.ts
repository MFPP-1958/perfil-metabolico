import { metricCatalog, type MetricCode } from './metrics';
import type { Observation } from './observation';

/**
 * Perfil de un ciclista a una fecha: para cada métrica, el valor que vale ese día.
 *
 * Es la única regla que decide qué valor se usa, y la comparten las pantallas, los
 * modelos y los informes. Por orden:
 *   1. Un valor vigente gana a uno caducado, aunque el caducado venga de mejor fuente.
 *   2. Entre vigentes (o entre caducados), gana la fuente más fiable.
 *   3. A igualdad de fuente, el más reciente.
 * Nunca se mezclan dos fuentes en un número: los demás valores quedan como alternativas.
 */

export type ProfileGroup = 'capacities' | 'thresholds' | 'body';

interface ProfileMetricDefinition {
  code: MetricCode;
  group: ProfileGroup;
  /** Días que un valor se considera vigente. Criterio práctico, no norma publicada. */
  freshnessDays: number;
}

export const PROFILE_METRICS: readonly ProfileMetricDefinition[] = [
  { code: 'vo2max', group: 'capacities', freshnessDays: 84 },
  { code: 'p_vo2max', group: 'capacities', freshnessDays: 84 },
  { code: 'vlamax', group: 'capacities', freshnessDays: 84 },
  { code: 'pmax', group: 'capacities', freshnessDays: 42 },
  { code: 'ftp', group: 'thresholds', freshnessDays: 42 },
  { code: 'mftp', group: 'thresholds', freshnessDays: 42 },
  { code: 'cp', group: 'thresholds', freshnessDays: 42 },
  { code: 'w_prime', group: 'thresholds', freshnessDays: 42 },
  { code: 'frc', group: 'thresholds', freshnessDays: 42 },
  { code: 'tte', group: 'thresholds', freshnessDays: 42 },
  { code: 'mlss', group: 'thresholds', freshnessDays: 84 },
  { code: 'lt1', group: 'thresholds', freshnessDays: 84 },
  { code: 'vt1', group: 'thresholds', freshnessDays: 84 },
  { code: 'body_mass', group: 'body', freshnessDays: 14 },
];

/** Jerarquía de fuentes: laboratorio > test de campo > registro propio > modelo de la app > programa externo > estimación importada. */
export const SOURCE_TIERS = ['laboratory', 'field_test', 'own_record', 'app_model', 'external_model', 'imported'] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  laboratory: 'Laboratorio',
  field_test: 'Test de campo',
  own_record: 'Registro propio',
  app_model: 'Modelo de la app',
  external_model: 'Programa externo',
  imported: 'Estimación de Intervals.icu',
};

export function sourceTier(observation: Observation): SourceTier {
  switch (observation.origin) {
    case 'laboratory': return 'laboratory';
    case 'field_test': return 'field_test';
    case 'manual':
    case 'device': return 'own_record';
    case 'calculated': return 'app_model';
    case 'external_model': return 'external_model';
    case 'intervals_icu': return 'imported';
  }
}

export interface ResolvedMetric {
  metricCode: MetricCode;
  label: string;
  unit: string;
  group: ProfileGroup;
  freshnessDays: number;
  current: Observation | null;
  tier: SourceTier | null;
  /** Días entre la medición y el final de la fecha del perfil. */
  ageDays: number | null;
  expired: boolean;
  /** Los demás valores conocidos a esa fecha, en el mismo orden de preferencia. */
  alternatives: Observation[];
}

export interface ProfileAtDate {
  asOf: string;
  metrics: ResolvedMetric[];
  byCode: Partial<Record<MetricCode, ResolvedMetric>>;
}

const DAY_MS = 86_400_000;

/** Final del día `asOf` (AAAA-MM-DD) en hora local: lo medido ese día cuenta. */
export function endOfLocalDay(asOf: string) {
  const [year, month, day] = asOf.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function usable(observation: Observation) {
  return !observation.retractedAt && observation.quality !== 'rejected' && observation.quality !== 'incomplete';
}

export function resolveProfile(observations: readonly Observation[], asOf: string): ProfileAtDate {
  const horizon = endOfLocalDay(asOf);
  const metrics = PROFILE_METRICS.map((definition): ResolvedMetric => {
    const ranked = observations
      .filter((observation) => observation.metricCode === definition.code && usable(observation))
      .filter((observation) => Date.parse(observation.observedAt) <= horizon)
      .map((observation) => {
        const ageDays = Math.floor((horizon - Date.parse(observation.observedAt)) / DAY_MS);
        return { observation, ageDays, expired: ageDays > definition.freshnessDays, tier: SOURCE_TIERS.indexOf(sourceTier(observation)) };
      })
      .sort((left, right) => Number(left.expired) - Number(right.expired)
        || left.tier - right.tier
        || Date.parse(right.observation.observedAt) - Date.parse(left.observation.observedAt));
    const chosen = ranked[0];
    const catalog = metricCatalog[definition.code];
    return {
      metricCode: definition.code,
      label: catalog.label,
      unit: catalog.unit,
      group: definition.group,
      freshnessDays: definition.freshnessDays,
      current: chosen?.observation ?? null,
      tier: chosen ? SOURCE_TIERS[chosen.tier] : null,
      ageDays: chosen?.ageDays ?? null,
      expired: chosen?.expired ?? false,
      alternatives: ranked.slice(1).map((item) => item.observation),
    };
  });
  return {
    asOf,
    metrics,
    byCode: Object.fromEntries(metrics.map((metric) => [metric.metricCode, metric])),
  };
}

// ---------- Coherencia entre estimaciones del umbral ----------

export interface ThresholdValue {
  label: string;
  watts: number;
  /** Cierto si sale de un modelo (de la app o de un programa externo), no de una medición. */
  modelled: boolean;
  ageDays: number | null;
}

export interface ThresholdCoherence {
  status: 'insufficient' | 'coherent' | 'discrepant';
  values: ThresholdValue[];
  /** (máximo / mínimo − 1) × 100. */
  spreadPercent: number | null;
  /** El valor que conviene revisar primero cuando discrepan. */
  suspect: ThresholdValue | null;
}

/** Tolerancia entre FTP, mFTP, CP y MLSS: por encima, uno de ellos está mal. */
export const COHERENCE_TOLERANCE_PERCENT = 5;

/**
 * FTP, mFTP, CP y MLSS miden cosas distintas pero caen cerca: si se separan más de
 * un 5 %, uno de ellos está mal. El sospechoso es primero el modelado y, entre iguales,
 * el más antiguo.
 */
export function checkThresholdCoherence(profile: ProfileAtDate, modelledMlss: { label: string; watts: number } | null): ThresholdCoherence {
  const values: ThresholdValue[] = (['ftp', 'mftp', 'cp', 'mlss'] as const).flatMap((code) => {
    const metric = profile.byCode[code];
    if (!metric?.current) return [];
    const modelled = metric.tier === 'app_model' || metric.tier === 'external_model' || metric.tier === 'imported';
    return [{ label: metric.label, watts: metric.current.value, modelled, ageDays: metric.ageDays }];
  });
  if (modelledMlss) values.push({ label: modelledMlss.label, watts: modelledMlss.watts, modelled: true, ageDays: 0 });
  if (values.length < 2) return { status: 'insufficient', values, spreadPercent: null, suspect: null };

  const wattsList = values.map((value) => value.watts);
  const spreadPercent = (Math.max(...wattsList) / Math.min(...wattsList) - 1) * 100;
  if (spreadPercent <= COHERENCE_TOLERANCE_PERCENT) return { status: 'coherent', values, spreadPercent, suspect: null };

  const sorted = [...wattsList].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const suspect = [...values].sort((left, right) => Number(right.modelled) - Number(left.modelled)
    || Math.abs(right.watts - median) - Math.abs(left.watts - median)
    || (right.ageDays ?? 0) - (left.ageDays ?? 0))[0];
  return { status: 'discrepant', values, spreadPercent, suspect };
}
