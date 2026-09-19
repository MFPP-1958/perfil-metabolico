import { describe, expect, it, vi } from 'vitest';
import { createSessionsHandler, mapIntervals, mapStream, rideZones } from '../../netlify/functions/sessions';

const athleteId = '8ca7cc82-02b0-47ca-84ca-253607a04b72';
const activityId = '3f0f5c0e-8f1f-4d8e-9d55-1f1b8f7f2a10';
const coachId = '19e4a15f-64ed-4ee2-b1ed-57ab27e0660c';

function getEvent(query: Record<string, string>, headers: Record<string, string> = { authorization: 'Bearer access-token' }) {
  return { httpMethod: 'GET', headers, queryStringParameters: query };
}

const listQuery = { athleteId, oldest: '2026-06-21', newest: '2026-09-18' };

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    authenticate: vi.fn().mockResolvedValue({ id: coachId }),
    authorize: vi.fn().mockResolvedValue('coach'),
    listActivities: vi.fn().mockResolvedValue([{
      id: activityId,
      started_at: '2026-09-08T06:16:42+00:00',
      duration_seconds: 5400,
      indoor: false,
      normalized_data: { name: "Segorbe - FTP-Ext.96 % (20')-1 x ( 2 x 10' @ 96 % FTP R-10'", averagePowerWatts: 170 },
    }]),
    loadActivity: vi.fn().mockResolvedValue({ intervalsActivityId: 'i184470088', intervalsAthleteId: 'i593028' }),
    fetchIntervals: vi.fn().mockResolvedValue({ icu_intervals: [
      { type: 'RECOVERY', moving_time: 600, start_time: 0, average_watts: 150, average_heartrate: 130, average_cadence: 85 },
      { type: 'WORK', moving_time: 180, start_time: 600, average_watts: 255, average_heartrate: 165, average_cadence: 92 },
    ] }),
    fetchSportSettings: vi.fn().mockResolvedValue([{ types: ['Ride', 'VirtualRide'], power_zones: [55, 75, 90, 105, 120, 150, 999] }]),
    fetchStreams: vi.fn().mockResolvedValue([
      { type: 'time', data: [0, 1, 2] },
      { type: 'watts', data: [200, null, 210] },
      { type: 'heartrate', data: [150, 151, 152] },
      { type: 'cadence', data: [90, 91, 92] },
    ]),
    ...overrides,
  };
}

describe('sessions function', () => {
  it('returns 401 without a bearer token before touching anything', async () => {
    const deps = dependencies({ authenticate: vi.fn() });
    const response = await createSessionsHandler(deps)(getEvent(listQuery, {}));
    expect(response.statusCode).toBe(401);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it('rejects anything but GET', async () => {
    const response = await createSessionsHandler(dependencies())({ ...getEvent(listQuery), httpMethod: 'POST' });
    expect(response.statusCode).toBe(405);
  });

  it('returns 403 for a cyclist the coach cannot reach, without reading activities', async () => {
    const deps = dependencies({ authorize: vi.fn().mockResolvedValue(null) });
    const response = await createSessionsHandler(deps)(getEvent(listQuery));
    expect(response.statusCode).toBe(403);
    expect(deps.authorize).toHaveBeenCalledWith(coachId, athleteId);
    expect(deps.listActivities).not.toHaveBeenCalled();
  });

  it('rejects malformed queries', async () => {
    const handler = createSessionsHandler(dependencies());
    expect((await handler(getEvent({ athleteId: 'no-uuid', oldest: '2026-06-21', newest: '2026-09-18' }))).statusCode).toBe(400);
    expect((await handler(getEvent({ ...listQuery, oldest: '2026-09-19' }))).statusCode).toBe(400);
    expect((await handler(getEvent({ ...listQuery, extra: 'x' }))).statusCode).toBe(400);
  });

  it('lists the activities of the period with their title', async () => {
    const deps = dependencies();
    const response = await createSessionsHandler(deps)(getEvent(listQuery));
    expect(response.statusCode).toBe(200);
    expect(deps.listActivities).toHaveBeenCalledWith(athleteId, '2026-06-21', '2026-09-18');
    expect(JSON.parse(response.body)).toEqual({ activities: [{
      id: activityId,
      startedAt: '2026-09-08T06:16:42+00:00',
      name: "Segorbe - FTP-Ext.96 % (20')-1 x ( 2 x 10' @ 96 % FTP R-10'",
      durationSeconds: 5400,
      averagePowerWatts: 170,
      indoor: false,
    }] });
  });

  it('allows a viewer to read', async () => {
    const response = await createSessionsHandler(dependencies({ authorize: vi.fn().mockResolvedValue('viewer') }))(getEvent(listQuery));
    expect(response.statusCode).toBe(200);
  });

  it('returns the detected intervals and the ride zones of one activity', async () => {
    const deps = dependencies();
    const response = await createSessionsHandler(deps)(getEvent({ athleteId, activityId }));
    expect(response.statusCode).toBe(200);
    expect(deps.loadActivity).toHaveBeenCalledWith(athleteId, activityId);
    expect(deps.fetchIntervals).toHaveBeenCalledWith('i184470088');
    const body = JSON.parse(response.body);
    expect(body.activityId).toBe(activityId);
    expect(body.powerZones).toEqual([55, 75, 90, 105, 120, 150, 999]);
    expect(deps.fetchStreams).toHaveBeenCalledWith('i184470088');
    expect(body.stream).toEqual({ time: [0, 1, 2], watts: [200, null, 210], heartRate: [150, 151, 152], cadence: [90, 91, 92] });
    expect(body.intervals[1]).toEqual({ index: 1, type: 'WORK', startSeconds: 600, movingSeconds: 180, averageWatts: 255, averageHeartRate: 165, averageCadence: 92 });
  });

  it('returns 404 when the activity does not belong to that cyclist, without calling Intervals.icu', async () => {
    const deps = dependencies({ loadActivity: vi.fn().mockResolvedValue(null) });
    const response = await createSessionsHandler(deps)(getEvent({ athleteId, activityId }));
    expect(response.statusCode).toBe(404);
    expect(deps.fetchIntervals).not.toHaveBeenCalled();
  });

  it('still answers without zones if Intervals.icu fails to give them', async () => {
    const deps = dependencies({ fetchSportSettings: vi.fn().mockRejectedValue(new Error('boom')) });
    const response = await createSessionsHandler(deps)(getEvent({ athleteId, activityId }));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).powerZones).toBeNull();
  });

  it('still answers without the power stream if Intervals.icu fails to give it', async () => {
    const deps = dependencies({ fetchStreams: vi.fn().mockRejectedValue(new Error('boom')) });
    const response = await createSessionsHandler(deps)(getEvent({ athleteId, activityId }));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).stream).toBeNull();
  });

  it('returns 502 when Intervals.icu does not give the intervals', async () => {
    const deps = dependencies({ fetchIntervals: vi.fn().mockRejectedValue(new Error('boom')) });
    const response = await createSessionsHandler(deps)(getEvent({ athleteId, activityId }));
    expect(response.statusCode).toBe(502);
  });
});

describe('mapIntervals', () => {
  it('keeps only what the screen needs and tolerates missing numbers', () => {
    expect(mapIntervals({ icu_intervals: [{ type: 'WORK', moving_time: 30, average_watts: null, extra: 'x' }] })).toEqual([
      { index: 0, type: 'WORK', startSeconds: null, movingSeconds: 30, averageWatts: null, averageHeartRate: null, averageCadence: null },
    ]);
    expect(mapIntervals({})).toEqual([]);
  });
});

describe('mapStream', () => {
  it('keeps time, power, heart rate and cadence aligned', () => {
    expect(mapStream([{ type: 'time', data: [0, 1] }, { type: 'watts', data: [100, 'x'] }])).toEqual({
      time: [0, 1], watts: [100, null], heartRate: null, cadence: null,
    });
  });

  it('refuses a stream without time or power, or with misaligned series', () => {
    expect(mapStream([{ type: 'time', data: [0, 1] }])).toBeNull();
    expect(mapStream([{ type: 'time', data: [0, 1] }, { type: 'watts', data: [100] }])).toBeNull();
    expect(mapStream([{ type: 'time', data: [0, 1] }, { type: 'watts', data: [100, 110] }, { type: 'heartrate', data: [1] }]))
      .toMatchObject({ heartRate: null });
    expect(mapStream('nada')).toBeNull();
  });
});

describe('rideZones', () => {
  it('takes the cycling power zones and ignores other sports', () => {
    expect(rideZones([{ types: ['Run'], power_zones: [1, 2] }, { types: ['Ride'], power_zones: [55, 75] }])).toEqual([55, 75]);
    expect(rideZones([{ types: ['Ride'], power_zones: null }])).toBeNull();
    expect(rideZones('nada')).toBeNull();
  });
});
