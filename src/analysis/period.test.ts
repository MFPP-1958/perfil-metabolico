import { describe, expect, it } from 'vitest';
import { resolvePeriod, type AnalysisPeriod } from './period';

describe('resolvePeriod', () => {
  it('resolves a preset as an inclusive UTC date range', () => {
    expect(resolvePeriod({ preset: 90 }, '2026-09-05')).toEqual({
      oldest: '2026-06-08',
      newest: '2026-09-05',
      days: 90,
    });
  });

  it('resolves the other supported presets', () => {
    expect(resolvePeriod({ preset: 30 }, '2026-03-01')).toEqual({ oldest: '2026-01-31', newest: '2026-03-01', days: 30 });
    expect(resolvePeriod({ preset: 180 }, '2026-09-05')).toEqual({ oldest: '2026-03-10', newest: '2026-09-05', days: 180 });
    expect(resolvePeriod({ preset: 365 }, '2026-09-05')).toEqual({ oldest: '2025-09-06', newest: '2026-09-05', days: 365 });
  });

  it('accepts a valid custom range and counts natural days inclusively', () => {
    const period: AnalysisPeriod = { preset: 'custom', oldest: '2026-01-01', newest: '2026-01-31' };
    expect(resolvePeriod(period, '2026-09-05')).toEqual({ oldest: '2026-01-01', newest: '2026-01-31', days: 31 });
  });

  it('rejects custom ranges longer than 730 days', () => {
    expect(() => resolvePeriod({ preset: 'custom', oldest: '2024-01-01', newest: '2026-09-05' }, '2026-09-05')).toThrow('730');
  });

  it('rejects future dates', () => {
    expect(() => resolvePeriod({ preset: 'custom', oldest: '2026-09-06', newest: '2026-09-06' }, '2026-09-05')).toThrow('futuras');
  });

  it('rejects reversed, malformed, and invalid calendar dates', () => {
    expect(() => resolvePeriod({ preset: 'custom', oldest: '2026-02-02', newest: '2026-02-01' }, '2026-09-05')).toThrow(/anterior|posterior/i);
    expect(() => resolvePeriod({ preset: 'custom', oldest: '01/01/2026', newest: '2026-01-02' }, '2026-09-05')).toThrow(/fecha/i);
    expect(() => resolvePeriod({ preset: 'custom', oldest: '2026-02-30', newest: '2026-03-01' }, '2026-09-05')).toThrow(/fecha/i);
    expect(() => resolvePeriod({ preset: 90, extra: true } as never, '2026-09-05')).toThrow(/periodo/i);
    expect(() => resolvePeriod({ preset: 60 as never }, '2026-09-05')).toThrow(/periodo|días/i);
  });

  it('uses a strict UTC date-only today value', () => {
    expect(() => resolvePeriod({ preset: 90 }, '2026-09-05T23:59:59Z')).toThrow(/fecha/i);
    expect(() => resolvePeriod({ preset: 90 }, '2026-09-05')).not.toThrow();
  });
});
