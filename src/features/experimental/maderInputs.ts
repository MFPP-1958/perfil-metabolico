import { metricCatalog, type MetricCode } from '../../domain/metrics';
import type { Observation } from '../../domain/observation';
import { resolveProfile, type ProfileAtDate } from '../../domain/profile';
import type { MaderInputs } from '../../physiology/mader/model';

export interface MissingMetric {
  metricCode: MetricCode;
  label: string;
  /** Cómo se obtiene ese valor, para que el entrenador sepa qué hacer. */
  protocol: string;
}

export type MaderInputsResult =
  | { status: 'ready'; inputs: MaderInputs; warnings: string[] }
  | { status: 'incomplete'; missing: MissingMetric[] };

const REQUIRED: ReadonlyArray<{ code: MetricCode; protocol: string }> = [
  { code: 'vo2max', protocol: 'Prueba de laboratorio en rampa, o valor de laboratorio externo con su fecha.' },
  { code: 'vlamax', protocol: 'Test de esprint con lactato, o valor calculado en WKO5 con origen external_model.' },
  { code: 'body_mass', protocol: 'Pesada fechada, registro manual o importación de Intervals.icu.' },
  { code: 'p_vo2max', protocol: 'Potencia asociada al VO₂max, de la misma prueba que lo determinó.' },
];

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const DAY_MS = 86_400_000;
/** Separación máxima entre las fechas de las entradas antes de avisar. */
const MAX_INPUT_SPREAD_DAYS = 30;

function localDay(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Entradas de Mader a partir del perfil a una fecha: la misma regla que el resto de la app. */
export function maderInputsFromProfile(profile: ProfileAtDate): MaderInputsResult {
  const found = new Map<MetricCode, Observation>();
  const missing: MissingMetric[] = [];

  for (const requirement of REQUIRED) {
    const observation = profile.byCode[requirement.code]?.current;
    if (observation) found.set(requirement.code, observation);
    else missing.push({ metricCode: requirement.code, label: metricCatalog[requirement.code].label, protocol: requirement.protocol });
  }
  if (missing.length) return { status: 'incomplete', missing };

  const input = <Unit extends string>(code: MetricCode) => {
    const observation = found.get(code) as Observation;
    return {
      value: observation.value,
      unit: metricCatalog[code].unit as Unit,
      quality: observation.quality,
      observationId: observation.id,
      ...(observation.sourceReference ? { sourceReference: observation.sourceReference } : {}),
    };
  };

  const warnings: string[] = [];
  const vo2max = found.get('vo2max') as Observation;
  const pVo2max = found.get('p_vo2max') as Observation;
  if (localDay(vo2max.observedAt) !== localDay(pVo2max.observedAt)) {
    warnings.push('El VO₂max y la P@VO₂max no proceden del mismo día. Deben salir del mismo test: si no, el paso de oxígeno a vatios mezcla dos momentos distintos.');
  }
  const times = [...found.values()].map((observation) => Date.parse(observation.observedAt));
  const spreadDays = Math.round((Math.max(...times) - Math.min(...times)) / DAY_MS);
  if (spreadDays > MAX_INPUT_SPREAD_DAYS) {
    warnings.push(`Las entradas del modelo están separadas ${spreadDays} días entre sí. El cálculo combina estados del ciclista que quizá ya no coinciden.`);
  }

  const ftp = profile.byCode.ftp?.current;
  const cp = profile.byCode.cp?.current;
  const mlss = profile.byCode.mlss?.current;
  const comparison = {
    ...(ftp ? { ftpWatts: ftp.value } : {}),
    ...(cp ? { cpWatts: cp.value } : {}),
    ...(mlss ? { mlssMeasuredWatts: mlss.value } : {}),
  };

  return {
    status: 'ready',
    warnings,
    inputs: {
      vo2max: input<'ml·kg⁻¹·min⁻¹'>('vo2max'),
      vlamax: input<'mmol·l⁻¹·s⁻¹'>('vlamax'),
      bodyMass: input<'kg'>('body_mass'),
      pVo2max: input<'W'>('p_vo2max'),
      ...(Object.keys(comparison).length ? { comparison } : {}),
    },
  };
}

export function maderInputsFromObservations(observations: readonly Observation[], asOf: string = localToday()): MaderInputsResult {
  return maderInputsFromProfile(resolveProfile(observations, asOf));
}
