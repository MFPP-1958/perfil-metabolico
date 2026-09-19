import type { MetricCode } from '../../domain/metrics';
import type { Observation } from '../../domain/observation';
import { SOURCE_TIER_LABELS, sourceTier, type SourceTier } from '../../domain/profile';

/**
 * La procedencia se distingue por forma, no por color, para no saturar la pantalla:
 * ● medido · ◇ calculado por la app · ○ programa externo · ◐ estimación de Intervals.icu.
 */
export const TIER_SYMBOLS: Record<SourceTier, string> = {
  laboratory: '●',
  field_test: '●',
  own_record: '●',
  app_model: '◇',
  external_model: '○',
  imported: '◐',
};

export function sourceText(observation: Observation) {
  const tier = sourceTier(observation);
  const software = observation.sourceReference;
  if (tier === 'external_model' && software) return software.version ? `${software.software} ${software.version}` : software.software;
  return SOURCE_TIER_LABELS[tier];
}

const DECIMALS: Partial<Record<MetricCode, number>> = {
  vo2max: 1, vlamax: 2, peak_accumulation_rate: 2, body_mass: 1, frc: 1, w_prime: 1, lactate: 1, rpe: 0,
};

const numberFormats = new Map<number, Intl.NumberFormat>();
function formatNumber(value: number, decimals: number) {
  let format = numberFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    numberFormats.set(decimals, format);
  }
  return format.format(value);
}

/** Cifra y unidad por separado, para poder dar a la unidad menos peso visual. TTE se muestra en minutos. */
export function formatMetricParts(metricCode: MetricCode, value: number, unit: string) {
  if (metricCode === 'tte') return { number: formatNumber(value / 60, 0), unit: 'min' };
  return { number: formatNumber(value, DECIMALS[metricCode] ?? 0), unit };
}

/** Valor con su unidad, con los decimales que tienen sentido para esa métrica. */
export function formatMetric(metricCode: MetricCode, value: number, unit: string) {
  const parts = formatMetricParts(metricCode, value, unit);
  return `${parts.number} ${parts.unit}`;
}

export function formatWattsPerKg(watts: number, kilograms: number) {
  return `${formatNumber(watts / kilograms, 2)} W/kg`;
}

const dateFormat = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export function formatDay(iso: string) {
  return dateFormat.format(new Date(iso)).replace(/\./g, '');
}

export function ageText(days: number) {
  if (days <= 0) return 'hoy';
  if (days === 1) return 'hace 1 día';
  return `hace ${days} días`;
}

export function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
