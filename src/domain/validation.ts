import { metricCatalog, type MetricCode, type MetricUnit } from './metrics';

export function metricUnit(metric: MetricCode): MetricUnit {
  return metricCatalog[metric].unit;
}

export function assertMetricIdentity(expected: MetricCode, actual: MetricCode): void {
  if (expected === actual) return;
  throw new Error(`${metricCatalog[expected].label} no puede sustituirse por ${metricCatalog[actual].label}.`);
}
