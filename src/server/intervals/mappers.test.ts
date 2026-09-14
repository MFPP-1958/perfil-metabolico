import { describe, expect, it } from 'vitest';
import athlete from './fixtures/athlete.json';
import activity from './fixtures/activity.json';
import curve from './fixtures/power-curve.json';
import durabilityCurves from './fixtures/durability-curves.json';
import planned from './fixtures/planned-workout.json';
import { mapActivity, mapDurabilityCurves, mapPlannedWorkout, mapPowerCurve, mapSportSettings } from './mappers';

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

  it('selects the fresh curve for power when the grouped response starts with a fatigued curve', () => {
    const mapped = mapPowerCurve(durabilityCurves);

    expect(mapped.points.find((point) => point.seconds === 10)?.watts).toBe(900);
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

  it('maps fresh, kj0 and kj1 independently of response order', () => {
    const mapped = mapDurabilityCurves(durabilityCurves);

    expect(mapped.fresh?.level).toBe('fresh');
    expect(mapped.fatigued.map((curve) => [curve.level, curve.afterKj])).toEqual([
      ['kj0', 700],
      ['kj1', 1400],
    ]);
    expect(mapped.fatigued[0].points[0]).toMatchObject({
      seconds: 10,
      watts: 870,
      activityId: 'i2',
      startIndex: 1,
      endIndex: 11,
    });
    expect(mapped.fatigued.find((curve) => curve.level === 'kj1')?.points[0].supportingActivityIds).toEqual(['i3', 'i5', 'i6']);
    expect(mapped.fatigued.find((curve) => curve.level === 'kj1')?.points[0].supportingEffortCount).toBe(3);
  });

  it('keeps a valid fresh curve when a fatigued curve is malformed', () => {
    const mapped = mapDurabilityCurves({
      list: [durabilityCurves.list[1], { id: '90d-kj0', secs: [10], values: [] }],
    });

    expect(mapped.fresh?.points).toHaveLength(4);
    expect(mapped.fatigued).toHaveLength(0);
    expect(mapped.rejected).toEqual(['kj0']);
  });

  it('keeps best-power points when one submax support fragment is malformed', () => {
    const mapped = mapDurabilityCurves({
      list: [{
        ...durabilityCurves.list[2],
        submax_values: [[860], [390], [270], [225]],
        submax_activity_id: [['i8'], 'unexpected', ['i9'], ['i10']],
      }],
    });

    expect(mapped.fatigued).toHaveLength(1);
    expect(mapped.fatigued[0].points.map((point) => point.watts)).toEqual([870, 395, 274, 226]);
    expect(mapped.fatigued[0].points[0].supportingActivityIds).toEqual(['i2', 'i8']);
    expect(mapped.fatigued[0].points[1].supportingActivityIds).toEqual(['i2']);
    expect(mapped.fatigued[0].points[2].supportingActivityIds).toEqual(['i3', 'i9']);
  });

  it('keeps a curve when the complete optional submax metadata is malformed', () => {
    const mapped = mapDurabilityCurves({
      list: [{
        ...durabilityCurves.list[2],
        submax_values: 'unexpected',
        submax_activity_id: 'unexpected',
      }],
    });

    expect(mapped.rejected).toEqual([]);
    expect(mapped.fatigued[0].points[0]).toMatchObject({ watts: 870, supportingActivityIds: ['i2'] });
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
    expect(mapActivity({ ...activity, device_watts: true })).toEqual(expect.objectContaining({
      sourceId: 'i9001', athleteSourceId: 'i123', durationSeconds: 5400, averagePowerWatts: 218, deviceWatts: true,
    }));
  });

  it('maps structured planned blocks and their original target units', () => {
    expect(mapPlannedWorkout(planned).blocks[0]).toMatchObject({ durationSeconds: 720, targetUnit: '%ftp' });
  });

  it('rejects partial payloads that do not identify their owner', () => {
    expect(() => mapActivity({ id: 'i99', moving_time: 30 })).toThrow(/actividad/i);
  });
});
