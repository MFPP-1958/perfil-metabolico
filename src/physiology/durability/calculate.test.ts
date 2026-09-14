import { describe, expect, it } from 'vitest';
import { calculateDurability, DURABILITY_ALGORITHM_VERSION } from './calculate';
import type { DurabilityInput, DurabilityPoint } from './types';

type PointTuple = readonly [number, number];

function points(
  values: readonly PointTuple[],
  powerSource: 'measured' | 'unknown' = 'measured',
  supportingActivityCount = 2,
): DurabilityPoint[] {
  return values.map(([seconds, watts], index) => ({
    seconds,
    watts,
    activityId: `i${index + 1}`,
    supportingActivityCount,
    supportingEffortCount: 3,
    powerSource,
  }));
}

function inputWith(config: {
  fresh: readonly PointTuple[];
  kj0?: { afterKj: number; points: readonly PointTuple[] };
  kj1?: { afterKj: number; points: readonly PointTuple[] };
  weightKg?: number | null;
}): DurabilityInput {
  const weightKg = config.weightKg === undefined ? 70 : config.weightKg;
  const fatigued: Array<DurabilityInput['fatigued'][number]> = [];
  if (config.kj0) {
    fatigued.push({ level: 'kj0', weightKg, afterKj: config.kj0.afterKj, points: points(config.kj0.points) });
  }
  if (config.kj1) {
    fatigued.push({ level: 'kj1', weightKg, afterKj: config.kj1.afterKj, points: points(config.kj1.points) });
  }
  return {
    sport: 'Ride',
    environment: 'all',
    oldest: '2026-06-16',
    newest: '2026-09-14',
    fresh: { weightKg, points: points(config.fresh) },
    fatigued,
  };
}

function twoLevelInput(): DurabilityInput {
  return inputWith({
    fresh: [[10, 900], [60, 400], [300, 300], [1200, 240]],
    kj0: { afterKj: 700, points: [[10, 880], [60, 390], [300, 291], [1200, 232]] },
    kj1: { afterKj: 1400, points: [[10, 850], [60, 375], [300, 270], [1200, 215]] },
  });
}

describe('versioned physiological durability', () => {
  it('keeps signed decline at exact canonical durations', () => {
    const result = calculateDurability(inputWith({
      fresh: [[10, 900], [60, 400], [300, 300], [1200, 240]],
      kj0: { afterKj: 700, points: [[10, 810], [60, 420], [300, 285], [1200, 216]] },
    }));

    expect(result.algorithmVersion).toBe('durability-record-profile@2.0.0');
    expect(DURABILITY_ALGORITHM_VERSION).toBe(result.algorithmVersion);
    expect(result.rows.map((row) => row.seconds)).toEqual([10, 60, 300, 1200]);
    expect(result.rows.find((row) => row.seconds === 10)?.levels.kj0?.declinePercent).toBeCloseTo(10);
    expect(result.rows.find((row) => row.seconds === 60)?.levels.kj0?.declinePercent).toBeCloseTo(-5);
  });

  it('does not interpolate a missing canonical duration', () => {
    const result = calculateDurability(inputWith({
      fresh: [[10, 900], [60, 400]],
      kj0: { afterKj: 700, points: [[10, 810], [59, 401], [61, 399]] },
    }));

    expect(result.rows.find((row) => row.seconds === 60)?.levels.kj0).toMatchObject({
      fatiguedWatts: null,
      declinePercent: null,
      quality: 'insufficient',
    });
  });

  it('reports onset by accumulated work for each duration', () => {
    const result = calculateDurability(twoLevelInput());

    expect(result.rows.find((row) => row.seconds === 300)).toMatchObject({
      onsetAfterKj: 1400,
      onsetAfterKjPerKg: 20,
    });
  });

  it('uses the lowest available workload that reaches the five percent boundary', () => {
    const input = inputWith({
      fresh: [[300, 300]],
      kj0: { afterKj: 700, points: [[300, 270]] },
      kj1: { afterKj: 1400, points: [[300, 240]] },
    });
    const result = calculateDurability({ ...input, fatigued: [...input.fatigued].reverse() });

    const row = result.rows.find((candidate) => candidate.seconds === 300);
    expect(row?.levels.kj0?.declinePercent).toBe(10);
    expect(row?.levels.kj1?.declinePercent).toBe(20);
    expect(row).toMatchObject({ onsetAfterKj: 700, onsetAfterKjPerKg: 10 });
  });

  it('keeps canonical rows when no fatigued curves are available', () => {
    const result = calculateDurability(inputWith({ fresh: [[10, 900], [30, 650]] }));

    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]).toMatchObject({ freshWatts: 900, levels: {}, onsetAfterKj: null, onsetAfterKjPerKg: null });
    expect(result.rows[1]).toMatchObject({ freshWatts: null, levels: {}, onsetAfterKj: null, onsetAfterKjPerKg: null });
  });

  it('reports high coverage from three observed durations in both levels', () => {
    const result = calculateDurability(inputWith({
      fresh: [[10, 900], [60, 400], [300, 300]],
      kj0: { afterKj: 700, points: [[10, 850], [60, 380], [300, 280]] },
      kj1: { afterKj: 1400, points: [[10, 810], [60, 360], [300, 260]] },
    }));

    expect(result.coverage).toBe('high');
  });

  it('uses the exact duration intersection when rating both levels', () => {
    const result = calculateDurability(inputWith({
      fresh: [[10, 900], [60, 400], [300, 300], [1200, 240]],
      kj0: { afterKj: 700, points: [[10, 850], [60, 380], [300, 280]] },
      kj1: { afterKj: 1400, points: [[60, 360], [300, 260], [1200, 210]] },
    }));

    expect(result.coverage).toBe('moderate');
  });

  it('reports moderate coverage from two observed durations in both levels', () => {
    const result = calculateDurability(inputWith({
      fresh: [[10, 900], [60, 400]],
      kj0: { afterKj: 700, points: [[10, 850], [60, 380]] },
      kj1: { afterKj: 1400, points: [[10, 810], [60, 360]] },
    }));

    expect(result.coverage).toBe('moderate');
  });

  it('reports moderate coverage from three observed durations in one level', () => {
    const result = calculateDurability(inputWith({
      fresh: [[10, 900], [60, 400], [300, 300]],
      kj0: { afterKj: 700, points: [[10, 850], [60, 380], [300, 280]] },
    }));

    expect(result.coverage).toBe('moderate');
  });

  it('reports low coverage from two observed durations in one level', () => {
    const result = calculateDurability(inputWith({
      fresh: [[10, 900], [60, 400]],
      kj0: { afterKj: 700, points: [[10, 850], [60, 380]] },
    }));

    expect(result.coverage).toBe('low');
  });

  it.each([null, 0, -70, Number.POSITIVE_INFINITY, Number.NaN])(
    'lowers otherwise high coverage for invalid weight %s',
    (weightKg) => {
      const valid = twoLevelInput();
      const invalid = inputWith({
        fresh: [[10, 900], [60, 400], [300, 300], [1200, 240]],
        kj0: { afterKj: 700, points: [[10, 880], [60, 390], [300, 291], [1200, 232]] },
        kj1: { afterKj: 1400, points: [[10, 850], [60, 375], [300, 270], [1200, 215]] },
        weightKg,
      });
      const result = calculateDurability(invalid);

      expect(calculateDurability(valid).coverage).toBe('high');
      expect(result.coverage).toBe('low');
      expect(result.rows[0].levels.kj0?.afterKjPerKg).toBeNull();
      expect(result.warnings).toContain('No hay un peso válido para expresar el trabajo en kJ/kg.');
    },
  );

  it('lowers otherwise high coverage when only fresh weight is absent', () => {
    const input = twoLevelInput();
    const result = calculateDurability({ ...input, fresh: { ...input.fresh, weightKg: null } });

    expect(calculateDurability(input).coverage).toBe('high');
    expect(result.coverage).toBe('low');
    expect(result.warnings).toContain('No hay un peso válido para expresar el trabajo en kJ/kg.');
  });

  it('lowers otherwise high coverage when only one fatigued weight is absent', () => {
    const input = twoLevelInput();
    const fatigued = input.fatigued.map((curve) => curve.level === 'kj1' ? { ...curve, weightKg: null } : curve);
    const result = calculateDurability({ ...input, fatigued });

    expect(calculateDurability(input).coverage).toBe('high');
    expect(result.coverage).toBe('low');
    expect(result.rows[0].levels.kj0?.afterKjPerKg).toBe(10);
    expect(result.rows[0].levels.kj1?.afterKjPerKg).toBeNull();
    expect(result.warnings).toContain('No hay un peso válido para expresar el trabajo en kJ/kg.');
  });

  it('lowers coverage when a valid cell has one supporting activity', () => {
    const input = twoLevelInput();
    const freshPoints = input.fresh.points.map((point) => ({ ...point, supportingActivityCount: 1 }));
    const result = calculateDurability({ ...input, fresh: { ...input.fresh, points: freshPoints } });

    expect(result.coverage).toBe('low');
    expect(result.rows[0].levels.kj0?.supportingActivityCount).toBe(1);
  });

  it('lowers coverage when either point has unknown power provenance', () => {
    const input = twoLevelInput();
    const freshPoints = input.fresh.points.map((point) => ({ ...point, powerSource: 'unknown' as const }));
    const result = calculateDurability({ ...input, fresh: { ...input.fresh, points: freshPoints } });

    expect(result.coverage).toBe('low');
    expect(result.rows[0].levels.kj0?.powerSource).toBe('unknown');
  });

  it('reports insufficient coverage when no exact comparisons exist', () => {
    const result = calculateDurability(inputWith({
      fresh: [[10, 900]],
      kj0: { afterKj: 700, points: [[11, 810]] },
    }));

    expect(result.coverage).toBe('insufficient');
    expect(result.warnings).toContain('No existen duraciones canónicas coincidentes entre las curvas.');
  });

  it('includes an exact five percent decline in onset detection', () => {
    const result = calculateDurability(inputWith({
      fresh: [[300, 300]],
      kj0: { afterKj: 700, points: [[300, 285]] },
    }));

    expect(result.rows.find((row) => row.seconds === 300)?.onsetAfterKj).toBe(700);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite fresh power %s',
    (watts) => {
      const input = inputWith({
        fresh: [[10, watts]],
        kj0: { afterKj: 700, points: [[10, 810]] },
      });

      expect(() => calculateDurability(input)).toThrow(/finito/i);
    },
  );

  it('rejects non-finite fatigued power outside canonical durations', () => {
    const input = inputWith({
      fresh: [[10, 900]],
      kj0: { afterKj: 700, points: [[10, 810], [30, Number.NaN]] },
    });

    expect(() => calculateDurability(input)).toThrow(/finito/i);
  });

  it('rejects a non-finite accumulated workload', () => {
    const input = inputWith({
      fresh: [[10, 900]],
      kj0: { afterKj: Number.POSITIVE_INFINITY, points: [[10, 810]] },
    });

    expect(() => calculateDurability(input)).toThrow(/finito/i);
  });

  it('rejects a non-finite fresh activity count', () => {
    const input = twoLevelInput();
    const freshPoints = input.fresh.points.map((point, index) => index === 0
      ? { ...point, supportingActivityCount: Number.NaN }
      : point);

    expect(() => calculateDurability({ ...input, fresh: { ...input.fresh, points: freshPoints } }))
      .toThrow(/recuentos.*enteros.*no negativos/i);
  });

  it('rejects a non-finite fresh effort count', () => {
    const input = twoLevelInput();
    const freshPoints = input.fresh.points.map((point, index) => index === 0
      ? { ...point, supportingEffortCount: Number.POSITIVE_INFINITY }
      : point);

    expect(() => calculateDurability({ ...input, fresh: { ...input.fresh, points: freshPoints } }))
      .toThrow(/recuentos.*enteros.*no negativos/i);
  });

  it('rejects a negative fatigued activity count', () => {
    const input = twoLevelInput();
    const fatigued = input.fatigued.map((curve) => ({
      ...curve,
      points: curve.points.map((point, index) => index === 0 ? { ...point, supportingActivityCount: -1 } : point),
    }));

    expect(() => calculateDurability({ ...input, fatigued }))
      .toThrow(/recuentos.*enteros.*no negativos/i);
  });

  it('rejects a fractional fatigued effort count', () => {
    const input = twoLevelInput();
    const fatigued = input.fatigued.map((curve) => ({
      ...curve,
      points: curve.points.map((point, index) => index === 0 ? { ...point, supportingEffortCount: 1.5 } : point),
    }));

    expect(() => calculateDurability({ ...input, fatigued }))
      .toThrow(/recuentos.*enteros.*no negativos/i);
  });

  it.each([
    { freshWatts: 0, fatiguedWatts: 810 },
    { freshWatts: -900, fatiguedWatts: 810 },
    { freshWatts: 900, fatiguedWatts: 0 },
    { freshWatts: 900, fatiguedWatts: -810 },
  ])('marks non-positive power as insufficient for comparison', ({ freshWatts, fatiguedWatts }) => {
    const result = calculateDurability(inputWith({
      fresh: [[10, freshWatts]],
      kj0: { afterKj: 700, points: [[10, fatiguedWatts]] },
    }));

    expect(result.rows[0].levels.kj0).toMatchObject({
      fatiguedWatts: null,
      declinePercent: null,
      quality: 'insufficient',
    });
    expect(result.coverage).toBe('insufficient');
  });

  it('blocks calculation for an incompatible sport context', () => {
    const input = { ...twoLevelInput(), sport: 'Run' } as unknown as DurabilityInput;
    const result = calculateDurability(input);

    expect(result.coverage).toBe('insufficient');
    expect(result.rows[0].levels.kj0).toMatchObject({
      fatiguedWatts: null,
      declinePercent: null,
      quality: 'incompatible',
    });
    expect(result.warnings).toContain('El contexto de las curvas es incompatible.');
  });
});
