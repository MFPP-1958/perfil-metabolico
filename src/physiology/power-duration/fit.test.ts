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

  it('fits critical power only on 2–20 min efforts, so long rides do not drag CP down', () => {
    // Una hora a 250 W cae por debajo de la hipérbola: el modelo de dos parámetros no
    // describe duraciones largas y, si se incluyen, CP baja y W′ sube artificialmente.
    const points = [...[120, 300, 600, 1200].map((seconds) => ({ seconds, watts: 300 + 18_000 / seconds })), { seconds: 3600, watts: 250 }];
    const result = fitPowerDuration({ points, sport: 'Ride', period: '90d', indoor: null }, 'ECP');
    expect(result.cpWatts).toBeCloseTo(300, 6);
    expect(result.wPrimeJoules).toBeCloseTo(18_000, 3);
    expect(result.rmseWatts).toBeCloseTo(0, 6);
    // Los puntos fuera del dominio se siguen mostrando con su residuo.
    expect(result.points.at(-1)?.residualWatts).toBeLessThan(0);
    expect(result.algorithmVersion).toBe('pd-ecp-2p@1.1.0');
  });

  it('keeps Morton 3P on efforts up to 20 min, sprints included', () => {
    const cp = 280, wPrime = 20_000, pmax = 1100;
    const exact = [5, 15, 60, 300, 1200].map((seconds) => ({ seconds, watts: cp + wPrime / (seconds + wPrime / (pmax - cp)) }));
    const result = fitPowerDuration({ points: [...exact, { seconds: 3600, watts: 235 }, { seconds: 10_800, watts: 190 }], sport: 'Ride', period: '90d', indoor: null }, 'MORTON_3P');
    expect(result.cpWatts).toBeCloseTo(cp, 1);
    expect(result.pmaxWatts).toBeCloseTo(pmax, 0);
    expect(result.algorithmVersion).toBe('pd-morton-3p@1.1.0');
  });

  it('warns when the curve lacks sprint, severe and long-duration domains', () => {
    const quality = assessCurveCompleteness([{ seconds: 60, watts: 500 }, { seconds: 600, watts: 300 }]);
    expect(quality.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/15 s/), expect.stringMatching(/2–8 min/), expect.stringMatching(/20 min/),
    ]));
  });
});
