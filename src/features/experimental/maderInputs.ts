import { metricCatalog, type MetricCode } from '../../domain/metrics';
import type { Observation } from '../../domain/observation';
import type { MaderInputs } from '../../physiology/mader/model';

export interface MissingMetric {
  metricCode: MetricCode;
  label: string;
  /** Cómo se obtiene ese valor, para que el entrenador sepa qué hacer. */
  protocol: string;
}

export type MaderInputsResult =
  | { status: 'ready'; inputs: MaderInputs }
  | { status: 'incomplete'; missing: MissingMetric[] };

const REQUIRED: ReadonlyArray<{ code: MetricCode; protocol: string }> = [
  { code: 'vo2max', protocol: 'Prueba de laboratorio en rampa, o valor de laboratorio externo con su fecha.' },
  { code: 'vlamax', protocol: 'Test de esprint con lactato, o valor calculado en WKO5 con origen external_model.' },
  { code: 'body_mass', protocol: 'Pesada fechada, registro manual o importación de Intervals.icu.' },
  { code: 'p_vo2max', protocol: 'Potencia asociada al VO₂max, de la misma prueba que lo determinó.' },
];

const USABLE_QUALITIES = new Set(['measured', 'calculated', 'imported_estimate']);

function latest(observations: readonly Observation[], code: MetricCode): Observation | undefined {
  return observations
    .filter((observation) => observation.metricCode === code && USABLE_QUALITIES.has(observation.quality))
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
}

export function maderInputsFromObservations(observations: readonly Observation[]): MaderInputsResult {
  const found = new Map<MetricCode, Observation>();
  const missing: MissingMetric[] = [];

  for (const requirement of REQUIRED) {
    const observation = latest(observations, requirement.code);
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

  const ftp = latest(observations, 'ftp');
  const cp = latest(observations, 'cp');
  const mlss = latest(observations, 'mlss');
  const comparison = {
    ...(ftp ? { ftpWatts: ftp.value } : {}),
    ...(cp ? { cpWatts: cp.value } : {}),
    ...(mlss ? { mlssMeasuredWatts: mlss.value } : {}),
  };

  return {
    status: 'ready',
    inputs: {
      vo2max: input<'ml·kg⁻¹·min⁻¹'>('vo2max'),
      vlamax: input<'mmol·l⁻¹·s⁻¹'>('vlamax'),
      bodyMass: input<'kg'>('body_mass'),
      pVo2max: input<'W'>('p_vo2max'),
      ...(Object.keys(comparison).length ? { comparison } : {}),
    },
  };
}
