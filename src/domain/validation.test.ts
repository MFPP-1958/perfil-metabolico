import { describe, expect, it } from 'vitest';

import { observationSchema } from './observation';
import { assertMetricIdentity, metricUnit } from './validation';

const baseObservation = {
  id: '6b8c6a31-9a5b-40d8-8b0b-8e337268e7b9',
  athleteId: '8ca7cc82-02b0-47ca-84ca-253607a04b72',
  metricCode: 'ftp',
  value: 310,
  unit: 'W',
  observedAt: '2026-09-01T08:00:00.000Z',
  origin: 'intervals_icu',
  quality: 'imported_estimate',
  protocol: { name: 'Intervals.icu sport settings', version: '2026-09' },
};

describe('physiological validation', () => {
  it('rejects a unit that does not belong to the metric', () => {
    const result = observationSchema.safeParse({ ...baseObservation, unit: 'ml·kg⁻¹·min⁻¹' });
    expect(result.success).toBe(false);
  });

  it('rejects impossible negative physiological values', () => {
    const result = observationSchema.safeParse({ ...baseObservation, value: -1 });
    expect(result.success).toBe(false);
  });

  it('requires origin, quality and protocol provenance', () => {
    const incomplete: Record<string, unknown> = { ...baseObservation };
    delete incomplete.origin;
    delete incomplete.protocol;
    delete incomplete.quality;
    expect(observationSchema.safeParse(incomplete).success).toBe(false);
  });

  it('keeps FTP and critical power as different metric identities', () => {
    expect(() => assertMetricIdentity('cp', 'ftp')).toThrow(/CP.*FTP/);
    expect(metricUnit('cp')).toBe('W');
    expect(metricUnit('ftp')).toBe('W');
  });

  it('accepts a traceable observation with the exact unit', () => {
    expect(observationSchema.parse(baseObservation)).toMatchObject(baseObservation);
  });
});
