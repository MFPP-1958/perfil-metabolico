import { describe, expect, it } from 'vitest';
import { assessCurveCompleteness, fitPowerDuration } from './fit';

describe('power-duration models', () => {
  it('recovers an exact two-parameter critical-power fixture', () => {
    const points = [120, 300, 600, 1200].map((seconds) => ({ seconds, watts: 300 + 18_000 / seconds }));
    const result = fitPowerDuration({ points, sport: 'Ride', period: '2026-06/2026-09', indoor: false }, 'ECP');
    expect(result.cpWatts).toBeCloseTo(300, 6);
    expect(result.wPrimeJoules).toBeCloseTo(18_000, 3);
    expect(result.rmseWatts).toBeCloseTo(0, 6);
    expect(result.pmaxWatts).toBeNull();
  });

  it('fits a Morton three-parameter curve without treating observed 5 s as Pmax', () => {
    const cp = 280, wPrime = 20_000, pmax = 1100;
    const points = [5, 15, 60, 300, 1200].map((seconds) => ({ seconds, watts: cp + wPrime / (seconds + wPrime / (pmax - cp)) }));
    const result = fitPowerDuration({ points, sport: 'Ride', period: '90d', indoor: null }, 'MORTON_3P');
    expect(result.cpWatts).toBeCloseTo(cp, 1);
    expect(result.wPrimeJoules).toBeCloseTo(wPrime, -1);
    expect(result.pmaxWatts).toBeCloseTo(pmax, 0);
    expect(result.rmseWatts).toBeLessThan(0.05);
    expect(result.observedFiveSecondWatts).toBeCloseTo(points[0].watts, 6);
  });

  it('warns when the curve lacks sprint, severe and long-duration domains', () => {
    const quality = assessCurveCompleteness([{ seconds: 60, watts: 500 }, { seconds: 600, watts: 300 }]);
    expect(quality.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/15 s/), expect.stringMatching(/2–8 min/), expect.stringMatching(/20 min/),
    ]));
  });
});
