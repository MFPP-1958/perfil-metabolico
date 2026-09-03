import { describe, expect, it } from 'vitest';
import { calculateDurability } from './calculate';

const fresh = { sport: 'Ride', indoor: false, observations: 8, points: [{ seconds: 10, watts: 900 }, { seconds: 60, watts: 500 }, { seconds: 300, watts: 350 }, { seconds: 1200, watts: 300 }] };
const workload = { priorKjPerKg: 25, priorWorkAboveCpKj: 12, intensityDistribution: { low: 65, moderate: 25, high: 10 } };

describe('physiological durability', () => {
  it('calculates decline only at matched durations', () => {
    const result = calculateDurability(fresh, { ...fresh, points: [{ seconds: 10, watts: 810 }, { seconds: 300, watts: 315 }] }, workload);
    expect(result.comparisons).toEqual([
      expect.objectContaining({ seconds: 10, declinePercent: 10 }),
      expect.objectContaining({ seconds: 300, declinePercent: 10 }),
    ]);
  });

  it('warns when conditions are incompatible', () => {
    const result = calculateDurability(fresh, { ...fresh, indoor: true }, workload);
    expect(result.valid).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/interior.*exterior/i);
  });

  it('rejects a comparison with no matched target durations', () => {
    const result = calculateDurability(fresh, { ...fresh, points: [{ seconds: 30, watts: 600 }] }, workload);
    expect(result.valid).toBe(false);
    expect(result.comparisons).toHaveLength(0);
  });

  it('marks sparse observations as low confidence', () => {
    const result = calculateDurability({ ...fresh, observations: 1 }, { ...fresh, observations: 1 }, workload);
    expect(result.confidence).toBe('low');
  });
});
