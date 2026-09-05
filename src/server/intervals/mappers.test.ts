import { describe, expect, it } from 'vitest';
import athlete from './fixtures/athlete.json';
import activity from './fixtures/activity.json';
import curve from './fixtures/power-curve.json';
import planned from './fixtures/planned-workout.json';
import { mapActivity, mapPlannedWorkout, mapPowerCurve, mapSportSettings } from './mappers';

describe('Intervals.icu explicit mappers', () => {
  it('maps cycling FTP and W-prime with their field origin', () => {
    const mapped = mapSportSettings(athlete);
    expect(mapped.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricCode: 'ftp', value: 255, sourceField: 'sportSettings[Ride].ftp' }),
      expect.objectContaining({ metricCode: 'w_prime', value: 16, unit: 'kJ', sourceField: 'sportSettings[Ride].w_prime' }),
    ]));
  });

  it('keeps model CP, model FTP, Pmax and observed five-second power distinct', () => {
    const mapped = mapPowerCurve(curve);
    expect(mapped.models[0]).toMatchObject({ type: 'ECP', cpWatts: 267, ftpWatts: 254, pmaxWatts: 1040 });
    expect(mapped.points.find((point) => point.seconds === 5)).toMatchObject({ watts: 925, metricCode: 'power_5s' });
  });

  it('normalizes curve points to positive, sorted, unique best powers', () => {
    const mapped = mapPowerCurve({
      list: [{
        id: '90d',
        secs: [300, 5, 60, 5, 0, 1200],
        values: [320, 900, 510, 925, 1000, -1],
        powerModels: [],
      }],
    });
    expect(mapped.points.map(({ seconds, watts }) => ({ seconds, watts }))).toEqual([
      { seconds: 5, watts: 925 },
      { seconds: 60, watts: 510 },
      { seconds: 300, watts: 320 },
    ]);
  });

  it('normalizes and sorts all documented source power models', () => {
    const mapped = mapPowerCurve({
      list: [{
        id: '90d', secs: [5], values: [900],
        powerModels: [
          { type: 'MORTON_3P', criticalPower: 260, wPrime: 18000, pMax: 1000, ftp: 250 },
          { type: 'ECP', criticalPower: 265, wPrime: 17000, pMax: 980, ftp: 255 },
        ],
      }],
    });
    expect(mapped.models.map((model) => model.type)).toEqual(['ECP', 'MORTON_3P']);
    expect(mapped.models[0]).toMatchObject({ cpWatts: 265, wPrimeKj: 17, pmaxWatts: 980, ftpWatts: 255 });
  });

  it('produces the same canonical model order when equivalent input is reordered', () => {
    const first = [
      { type: 'ECP', criticalPower: 265, wPrime: 17000, pMax: 980, ftp: 255 },
      { type: 'ECP', criticalPower: 260, wPrime: 18000, pMax: 1000, ftp: 250 },
      { type: 'MORTON_3P', criticalPower: 262, wPrime: 17500, pMax: 990, ftp: 252 },
    ];
    const build = (powerModels: typeof first) => mapPowerCurve({
      list: [{ id: '90d', secs: [5], values: [900], powerModels }],
    }).models;

    expect(build(first)).toEqual(build([...first].reverse()));
  });

  it('maps an activity without retaining the raw object', () => {
    expect(mapActivity(activity)).toEqual(expect.objectContaining({
      sourceId: 'i9001', athleteSourceId: 'i123', durationSeconds: 5400, averagePowerWatts: 218,
    }));
  });

  it('maps structured planned blocks and their original target units', () => {
    expect(mapPlannedWorkout(planned).blocks[0]).toMatchObject({ durationSeconds: 720, targetUnit: '%ftp' });
  });

  it('rejects partial payloads that do not identify their owner', () => {
    expect(() => mapActivity({ id: 'i99', moving_time: 30 })).toThrow(/actividad/i);
  });
});
