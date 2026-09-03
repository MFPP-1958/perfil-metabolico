import { describe, expect, it } from 'vitest';
import { classifyChange } from './meaningful-change';

const previous = { value: 300, unit: 'W', metricCode: 'cp', protocol: 'ecp@1', observedAt: '2026-06-01', modelVersion: 'ecp@1.0.0', source: 'Intervals.icu' };

describe('meaningful change', () => {
  it('classifies a change below typical error', () => {
    expect(classifyChange(previous, { ...previous, value: 301 }, 5).classification).toBe('below_error');
  });

  it('classifies a change within the uncertainty band', () => {
    expect(classifyChange(previous, { ...previous, value: 304 }, 5).classification).toBe('within_error');
  });

  it('classifies positive and negative changes beyond typical error', () => {
    expect(classifyChange(previous, { ...previous, value: 310 }, 5).classification).toBe('likely_increase');
    expect(classifyChange(previous, { ...previous, value: 290 }, 5).classification).toBe('likely_decrease');
  });

  it('suppresses direction for incompatible units or protocols', () => {
    expect(classifyChange(previous, { ...previous, protocol: 'morton@1', value: 320 }, 5).classification).toBe('incompatible');
    expect(classifyChange(previous, { ...previous, unit: 'kJ', value: 20 }, 5).direction).toBe('suppressed');
  });
});
