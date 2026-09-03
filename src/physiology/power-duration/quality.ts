import type { CurveQuality, PowerDurationPoint } from './types';

export function assessCurveCompleteness(points: readonly PowerDurationPoint[]): CurveQuality {
  const warnings: string[] = [];
  if (!points.some((point) => point.seconds <= 15)) warnings.push('Falta un esfuerzo máximo de 15 s o menos.');
  if (!points.some((point) => point.seconds >= 120 && point.seconds <= 480)) warnings.push('Falta cobertura del dominio de 2–8 min.');
  if (!points.some((point) => point.seconds >= 1200)) warnings.push('Falta un esfuerzo de 20 min o más.');
  return { complete: warnings.length === 0, warnings };
}
