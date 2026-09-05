import { describe, expect, it } from 'vitest';
import { observationSchema } from '../src/domain/observation';

describe('observation timestamps', () => {
  it('accepts the explicit UTC offset returned by PostgreSQL', () => {
    const result = observationSchema.safeParse({
      id: '6b8c6a31-9a5b-40d8-8b0b-8e337268e7b9',
      athleteId: '8ca7cc82-02b0-47ca-84ca-253607a04b72',
      metricCode: 'ftp',
      value: 280,
      unit: 'W',
      observedAt: '2026-09-05T05:26:58.123456+00:00',
      origin: 'intervals_icu',
      quality: 'imported_estimate',
      protocol: { name: 'sportSettings[Ride].ftp', version: 'intervals-openapi-v1' },
    });
    expect(result.success).toBe(true);
  });
});
