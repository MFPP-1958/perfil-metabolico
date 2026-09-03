export interface ComparableResult {
  value: number;
  unit: string;
  metricCode: string;
  protocol: string;
  observedAt: string;
  modelVersion?: string;
  source: string;
}

export interface ChangeAssessment {
  classification: 'baseline' | 'below_error' | 'within_error' | 'likely_increase' | 'likely_decrease' | 'incompatible';
  direction: 'increase' | 'decrease' | 'stable' | 'suppressed';
  absoluteChange?: number;
  relativeChangePercent?: number;
  explanation: string;
}

export function classifyChange(previous: ComparableResult, current: ComparableResult, typicalError: number): ChangeAssessment {
  if (previous.metricCode !== current.metricCode) return { classification: 'incompatible', direction: 'suppressed', explanation: 'Métricas incompatibles: no se interpreta la dirección del cambio.' };
  if (previous.unit !== current.unit) return { classification: 'incompatible', direction: 'suppressed', explanation: 'Unidades incompatibles: no se interpreta la dirección del cambio.' };
  if (previous.protocol !== current.protocol) return { classification: 'incompatible', direction: 'suppressed', explanation: 'Protocolos incompatibles: no se interpreta la dirección del cambio.' };
  if (!Number.isFinite(typicalError) || typicalError <= 0) {
    return { classification: 'incompatible', direction: 'suppressed', explanation: 'Falta un error típico válido para interpretar el cambio.' };
  }
  const absoluteChange = current.value - previous.value;
  const magnitude = Math.abs(absoluteChange);
  const relativeChangePercent = previous.value === 0 ? 0 : absoluteChange / previous.value * 100;
  if (magnitude <= typicalError * 0.5) return { classification: 'below_error', direction: 'stable', absoluteChange, relativeChangePercent, explanation: 'Cambio inferior a la mitad del error típico; no se interpreta como cambio fisiológico.' };
  if (magnitude <= typicalError) return { classification: 'within_error', direction: 'stable', absoluteChange, relativeChangePercent, explanation: 'Cambio dentro del error típico de la medición.' };
  const increase = absoluteChange > 0;
  return {
    classification: increase ? 'likely_increase' : 'likely_decrease',
    direction: increase ? 'increase' : 'decrease', absoluteChange, relativeChangePercent,
    explanation: increase ? 'Aumento probable por encima del error típico.' : 'Descenso probable por encima del error típico.',
  };
}
