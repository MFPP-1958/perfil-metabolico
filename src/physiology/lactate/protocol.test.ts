import { describe, expect, it } from 'vitest';
import { evaluateLactateSprint } from './protocol';

const complete = {
  baselineLactate: 1.2,
  sprintDurationSeconds: 15,
  alacticTimeSeconds: 3,
  samples: [{ minute: 1, lactate: 6.1 }, { minute: 3, lactate: 9.4 }, { minute: 5, lactate: 10.2 }, { minute: 7, lactate: 9.9 }],
};

describe('lactate sprint assessment', () => {
  it('invalidates a high baseline lactate concentration', () => {
    expect(evaluateLactateSprint({ ...complete, baselineLactate: 3.1 }).kind).toBe('invalid');
  });

  it('invalidates samples without collection-minute labels', () => {
    expect(evaluateLactateSprint({ ...complete, samples: [{ minute: null, lactate: 8 }] }).kind).toBe('invalid');
  });

  it('uses a cautious accumulation-rate label when peak is not confirmed', () => {
    const result = evaluateLactateSprint({ ...complete, samples: complete.samples.slice(0, 3) });
    expect(result.kind).toBe('peak_accumulation_rate');
  });

  it('invalidates an alactic time outside sprint duration', () => {
    expect(evaluateLactateSprint({ ...complete, alacticTimeSeconds: 16 }).kind).toBe('invalid');
  });

  it('returns a VLa-max estimate and alactic-time sensitivity for a complete protocol', () => {
    const result = evaluateLactateSprint(complete);
    expect(result.kind).toBe('vlamax_estimate');
    expect(result.value).toBeCloseTo(0.75, 4);
    expect(result.sensitivity?.lower).toBeLessThan(result.value!);
    expect(result.sensitivity?.upper).toBeGreaterThan(result.value!);
  });
});
