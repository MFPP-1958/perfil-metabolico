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
