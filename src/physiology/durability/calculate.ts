import type { PowerDurationPoint } from '../power-duration/types';

export interface DurabilitySnapshot {
  sport: string;
  indoor: boolean | null;
  observations: number;
  points: readonly PowerDurationPoint[];
}
export interface DurabilityWorkload {
  priorKjPerKg: number;
  priorWorkAboveCpKj: number;
  intensityDistribution: { low: number; moderate: number; high: number };
}
export interface DurabilityResult {
  valid: boolean;
  comparisons: readonly { seconds: number; freshWatts: number; fatiguedWatts: number; declinePercent: number }[];
  workload: DurabilityWorkload;
  onsetSeconds: number | null;
  confidence: 'low' | 'moderate' | 'high';
  warnings: string[];
}

const targetDurations = [10, 60, 300, 1200];

export function calculateDurability(fresh: DurabilitySnapshot, fatigued: DurabilitySnapshot, workload: DurabilityWorkload): DurabilityResult {
  const warnings: string[] = [];
  if (fresh.sport !== fatigued.sport) warnings.push('Las curvas pertenecen a deportes distintos.');
  if (fresh.indoor !== null && fatigued.indoor !== null && fresh.indoor !== fatigued.indoor) warnings.push('No se deben comparar condiciones de interior y exterior sin advertencia.');
  const comparisons = targetDurations.flatMap((seconds) => {
    const before = fresh.points.find((point) => point.seconds === seconds);
    const after = fatigued.points.find((point) => point.seconds === seconds);
    if (!before || !after || before.watts <= 0) return [];
    return [{ seconds, freshWatts: before.watts, fatiguedWatts: after.watts, declinePercent: ((before.watts - after.watts) / before.watts) * 100 }];
  });
  if (!comparisons.length) warnings.push('No existen duraciones objetivo coincidentes entre las dos curvas.');
  const observationFloor = Math.min(fresh.observations, fatigued.observations);
  if (observationFloor < 3) warnings.push('Hay pocas observaciones para estimar la variabilidad habitual.');
  const incompatible = fresh.sport !== fatigued.sport || (fresh.indoor !== null && fatigued.indoor !== null && fresh.indoor !== fatigued.indoor);
  return {
    valid: comparisons.length > 0 && !incompatible,
    comparisons,
    workload,
    onsetSeconds: comparisons.find((comparison) => comparison.declinePercent >= 5)?.seconds ?? null,
    confidence: observationFloor < 3 ? 'low' : comparisons.length >= 3 && observationFloor >= 5 ? 'high' : 'moderate',
    warnings,
  };
}
