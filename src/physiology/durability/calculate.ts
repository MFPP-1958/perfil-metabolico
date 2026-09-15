import type {
  CellQuality,
  CoverageQuality,
  DurabilityInput,
  DurabilityLevel,
  DurabilityLevelResult,
  DurabilityPoint,
  DurabilityResult,
  DurabilityRow,
} from './types';

export const DURABILITY_ALGORITHM_VERSION = 'durability-record-profile@2.0.0' as const;
export const CANONICAL_DURATIONS = [10, 60, 300, 1200] as const;

function declinePercent(freshWatts: number, fatiguedWatts: number): number {
  return ((freshWatts - fatiguedWatts) / freshWatts) * 100;
}

function validWeight(weightKg: number | null): weightKg is number {
  return weightKg !== null && Number.isFinite(weightKg) && weightKg > 0;
}

function contemporaryWeight(input: DurabilityInput): boolean {
  if (input.weightObservedAt === null) return false;
  const observedAt = Date.parse(input.weightObservedAt);
  const periodStart = Date.parse(`${input.oldest}T00:00:00.000Z`);
  const periodEnd = Date.parse(`${input.newest}T23:59:59.999Z`);
  return Number.isFinite(observedAt)
    && Number.isFinite(periodStart)
    && Number.isFinite(periodEnd)
    && observedAt >= periodStart
    && observedAt <= periodEnd;
}

function assertFiniteInput(input: DurabilityInput): void {
  const points = [input.fresh.points, ...input.fatigued.map((curve) => curve.points)].flat();
  if (points.some((point) => !Number.isFinite(point.seconds) || !Number.isFinite(point.watts))) {
    throw new Error('Las duraciones y potencias deben tener valores finitos.');
  }
  if (points.some((point) => (
    !Number.isInteger(point.supportingActivityCount)
    || point.supportingActivityCount < 0
    || !Number.isInteger(point.supportingEffortCount)
    || point.supportingEffortCount < 0
  ))) {
    throw new Error('Los recuentos de soporte deben ser finitos, enteros y no negativos.');
  }
  if (input.fatigued.some((curve) => !Number.isFinite(curve.afterKj))) {
    throw new Error('El trabajo acumulado debe tener un valor finito.');
  }
}

function compatibleContext(input: DurabilityInput): boolean {
  const sport: unknown = input.sport;
  const environment: unknown = input.environment;
  return sport === 'Ride' && (environment === 'all' || environment === 'outdoor' || environment === 'indoor');
}

function unavailableComparison(
  afterKj: number,
  weightKg: number | null,
  quality: CellQuality,
): DurabilityLevelResult {
  return {
    afterKj,
    afterKjPerKg: validWeight(weightKg) ? afterKj / weightKg : null,
    fatiguedWatts: null,
    declinePercent: null,
    quality,
    supportingActivityCount: 0,
    supportingEffortCount: 0,
    powerSource: 'unknown',
  };
}

function comparison(
  freshPoint: DurabilityPoint | undefined,
  fatiguedPoint: DurabilityPoint | undefined,
  afterKj: number,
  weightKg: number | null,
): DurabilityLevelResult {
  if (!freshPoint || !fatiguedPoint || freshPoint.watts <= 0 || fatiguedPoint.watts <= 0) {
    return unavailableComparison(afterKj, weightKg, 'insufficient');
  }

  return {
    afterKj,
    afterKjPerKg: validWeight(weightKg) ? afterKj / weightKg : null,
    fatiguedWatts: fatiguedPoint.watts,
    declinePercent: declinePercent(freshPoint.watts, fatiguedPoint.watts),
    quality: 'observed',
    supportingActivityCount: Math.min(freshPoint.supportingActivityCount, fatiguedPoint.supportingActivityCount),
    supportingEffortCount: Math.min(freshPoint.supportingEffortCount, fatiguedPoint.supportingEffortCount),
    powerSource: freshPoint.powerSource === 'measured' && fatiguedPoint.powerSource === 'measured' ? 'measured' : 'unknown',
  };
}

function pointsByDuration(points: readonly DurabilityPoint[]) {
  const grouped = new Map<number, DurabilityPoint[]>();
  for (const point of points) {
    const matches = grouped.get(point.seconds) ?? [];
    matches.push(point);
    grouped.set(point.seconds, matches);
  }
  return grouped;
}

function coverageQuality(input: DurabilityInput, rows: readonly DurabilityRow[]): CoverageQuality {
  const observedByLevel: Record<DurabilityLevel, DurabilityLevelResult[]> = { kj0: [], kj1: [] };
  for (const row of rows) {
    for (const level of ['kj0', 'kj1'] as const) {
      const cell = row.levels[level];
      if (cell?.quality === 'observed') observedByLevel[level].push(cell);
    }
  }

  const observed = [...observedByLevel.kj0, ...observedByLevel.kj1];
  if (observed.length === 0) return 'insufficient';

  const hasValidWeight = validWeight(input.fresh.weightKg)
    && input.fatigued.every((curve) => validWeight(curve.weightKg));
  const hasLimitedProvenance = observed.some(
    (cell) => cell.powerSource === 'unknown' || cell.supportingActivityCount < 2,
  );
  if (!hasValidWeight || !contemporaryWeight(input) || hasLimitedProvenance) return 'low';

  const kj0Count = observedByLevel.kj0.length;
  const kj1Count = observedByLevel.kj1.length;
  const sharedCount = rows.filter((row) => (
    row.levels.kj0?.quality === 'observed' && row.levels.kj1?.quality === 'observed'
  )).length;
  if (sharedCount >= 3) return 'high';
  if (sharedCount >= 2 || Math.max(kj0Count, kj1Count) >= 3) return 'moderate';
  return 'low';
}

export function calculateDurability(input: DurabilityInput): DurabilityResult {
  assertFiniteInput(input);
  const contextIsCompatible = compatibleContext(input);
  const freshPoints = pointsByDuration(input.fresh.points);
  const curvesByLevel = new Map<DurabilityLevel, DurabilityInput['fatigued'][number][]>();
  for (const curve of input.fatigued) {
    const matches = curvesByLevel.get(curve.level) ?? [];
    matches.push(curve);
    curvesByLevel.set(curve.level, matches);
  }
  const ambiguousLevels = (['kj0', 'kj1'] as const).filter((level) => (curvesByLevel.get(level)?.length ?? 0) > 1);
  const rows: DurabilityRow[] = CANONICAL_DURATIONS.map((seconds) => {
    const freshMatches = freshPoints.get(seconds) ?? [];
    const freshPoint = freshMatches.length === 1 ? freshMatches[0] : undefined;
    const freshIsAmbiguous = freshMatches.length > 1;
    const levels: DurabilityRow['levels'] = {};

    for (const level of ['kj0', 'kj1'] as const) {
      const curves = curvesByLevel.get(level) ?? [];
      if (curves.length === 0) continue;
      if (curves.length > 1) {
        const afterKj = Math.min(...curves.map((curve) => curve.afterKj));
        levels[level] = unavailableComparison(afterKj, null, 'incompatible');
        continue;
      }
      const curve = curves[0];
      const fatiguedMatches = pointsByDuration(curve.points).get(seconds) ?? [];
      const durationIsAmbiguous = freshIsAmbiguous || fatiguedMatches.length > 1;
      levels[level] = !contextIsCompatible || durationIsAmbiguous
        ? unavailableComparison(curve.afterKj, curve.weightKg, 'incompatible')
        : comparison(freshPoint, fatiguedMatches[0], curve.afterKj, curve.weightKg);
    }

    const onset = Object.values(levels)
      .filter((level): level is DurabilityLevelResult => level?.declinePercent !== null && level.declinePercent >= 5)
      .sort((left, right) => left.afterKj - right.afterKj)[0];

    return {
      seconds,
      freshWatts: freshIsAmbiguous ? null : freshPoint?.watts ?? null,
      levels,
      onsetAfterKj: onset?.afterKj ?? null,
      onsetAfterKjPerKg: onset?.afterKjPerKg ?? null,
    };
  });

  if (!contextIsCompatible) {
    return {
      algorithmVersion: DURABILITY_ALGORITHM_VERSION,
      rows,
      coverage: 'insufficient',
      warnings: ['El contexto de las curvas es incompatible.'],
    };
  }

  const coverage = coverageQuality(input, rows);
  const warnings: string[] = [];
  const hasValidWeight = input.fatigued.every((curve) => validWeight(curve.weightKg))
    && validWeight(input.fresh.weightKg);
  if (!hasValidWeight) {
    warnings.push('No hay un peso válido para expresar el trabajo en kJ/kg.');
  } else if (!contemporaryWeight(input)) {
    warnings.push('El peso no tiene una fecha observada válida dentro del periodo; la cobertura se limita a baja.');
  }
  for (const level of ambiguousLevels) {
    warnings.push(`El nivel ${level} aparece más de una vez y no se ha utilizado como observación.`);
  }
  if (coverage === 'insufficient') {
    warnings.push('No existen duraciones canónicas coincidentes entre las curvas.');
  }

  return {
    algorithmVersion: DURABILITY_ALGORITHM_VERSION,
    rows,
    coverage,
    warnings,
  };
}
