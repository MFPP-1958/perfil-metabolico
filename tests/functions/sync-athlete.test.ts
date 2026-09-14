import { describe, expect, it, vi } from 'vitest';
import { IntervalsClient } from '../../src/server/intervals/client';
import {
  createDurabilitySnapshotPayload,
  createPowerCurveSnapshotPayload,
  createSyncHandler,
  loadIntervalsAthleteData,
  normalizeAthleteData,
  persistNormalizedAthleteData,
} from '../../netlify/functions/sync-athlete';
import durabilityCurves from '../../src/server/intervals/fixtures/durability-curves.json';

const internalAthleteId = '8ca7cc82-02b0-47ca-84ca-253607a04b72';

function event(body: Record<string, unknown> | string = {}) {
  const request = typeof body === 'string' ? body : JSON.stringify({
    athleteId: internalAthleteId,
    oldest: '2026-06-08',
    newest: '2026-09-05',
    environment: 'all',
    syncKey: 'sync-2',
    ...body,
  });
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer token' },
    body: request,
  };
}

function dependencies(overrides = {}) {
  return {
    authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }),
    now: vi.fn().mockReturnValue(new Date('2026-09-05T12:00:00Z')),
    resolveAthlete: vi.fn().mockResolvedValue({ id: internalAthleteId, intervalsAthleteId: 'i123' }),
    beginSync: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue({
      athlete: { id: 'i123', name: 'Test athlete', sportSettings: [] }, activities: [],
      powerCurves: { list: [
        { id: '90d', weight: 70, secs: [5], values: [900], powerModels: [] },
        { id: '90d-kj0', after_kj: 700, weight: 70, secs: [5], values: [850], powerModels: [] },
        { id: '90d-kj1', after_kj: 1400, weight: 70, secs: [5], values: [800], powerModels: [] },
      ] },
      durabilityCurves: { list: [
        { id: '90d', weight: 70, secs: [5], values: [900], powerModels: [] },
        { id: '90d-kj0', after_kj: 700, weight: 70, secs: [5], values: [850], powerModels: [] },
        { id: '90d-kj1', after_kj: 1400, weight: 70, secs: [5], values: [800], powerModels: [] },
      ] },
      plannedWorkouts: [], warnings: [],
      updated: ['athlete', 'activities', 'power_curves', 'durability_curves', 'planned_workouts'],
    }),
    commit: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('athlete synchronization', () => {
  it('authenticates before inspecting a malformed body', async () => {
    const deps = dependencies({ authenticate: vi.fn().mockResolvedValue(null) });
    const response = await createSyncHandler(deps)({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer invalid-token' },
      body: '{contains-untrusted-profile-data',
    });

    expect(response.statusCode).toBe(401);
    expect(deps.authenticate).toHaveBeenCalledOnce();
  });

  it('rejects a cyclist outside the coach roster', async () => {
    const handler = createSyncHandler(dependencies({ resolveAthlete: vi.fn().mockResolvedValue(null) }));
    expect((await handler(event())).statusCode).toBe(403);
  });

  it('rejects an anonymous request before authorization or Intervals.icu access', async () => {
    const deps = dependencies({ authenticate: vi.fn().mockResolvedValue(null), resolveAthlete: vi.fn(), load: vi.fn() });
    const response = await createSyncHandler(deps)(event());
    expect(response.statusCode).toBe(401);
    expect(deps.resolveAthlete).not.toHaveBeenCalled();
    expect(deps.load).not.toHaveBeenCalled();
  });

  it('resolves authorization before sending any request to Intervals.icu', async () => {
    const deps = dependencies({
      resolveAthlete: vi.fn().mockResolvedValue(null),
      load: vi.fn(),
    });
    await createSyncHandler(deps)(event());
    expect(deps.load).not.toHaveBeenCalled();
  });

  it('loads the external athlete only after resolving the authorized internal UUID', async () => {
    const deps = dependencies();
    await createSyncHandler(deps)(event({ environment: 'indoor' }));
    expect(deps.load).toHaveBeenCalledWith('i123', expect.objectContaining({
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'indoor',
    }));
    expect(deps.beginSync).toHaveBeenCalledWith(internalAthleteId, 'sync-2');
    expect(deps.commit).toHaveBeenCalledWith(
      'coach-1', internalAthleteId, 'sync-2', expect.objectContaining({ profileName: 'Test athlete' }), expect.objectContaining({ environment: 'indoor' }),
    );
  });

  it('rejects invalid, oversized and non-JSON bodies without echoing submitted data', async () => {
    const invalid = await createSyncHandler(dependencies())(event({ athleteId: 'sensitive-invalid-id' }));
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain('sensitive-invalid-id');

    const malformed = await createSyncHandler(dependencies())(event('{not-json'));
    expect(malformed.statusCode).toBe(400);

    const oversized = await createSyncHandler(dependencies())(event('x'.repeat(12 * 1024 + 1)));
    expect(oversized.statusCode).toBe(413);
    expect(oversized.body).not.toContain('xxxx');
  });

  it('reports partial upstream failures without discarding usable data', async () => {
    const deps = dependencies({
      load: vi.fn().mockResolvedValue({
        athlete: { id: 'i123', name: 'Test athlete', sportSettings: [] }, activities: [], powerCurves: null, durabilityCurves: null,
        plannedWorkouts: [], warnings: ['power_curves', 'durability_curves'],
        updated: ['athlete', 'activities', 'planned_workouts'],
      }),
    });
    const response = await createSyncHandler(deps)(event());
    expect(response.statusCode).toBe(207);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'partial', warnings: ['power_curves', 'durability_curves'] });
    expect(deps.commit).toHaveBeenCalledOnce();
    expect(deps.commit).toHaveBeenCalledWith(
      'coach-1', internalAthleteId, 'sync-2',
      expect.objectContaining({ snapshot: null, durabilitySnapshot: null }),
      expect.any(Object),
    );
  });

  it('returns only a normalized synchronization summary', async () => {
    const response = await createSyncHandler(dependencies())(event());
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      synchronizedAt: '2026-09-05T12:00:00.000Z',
      status: 'complete',
      updated: ['athlete', 'activities', 'power_curves', 'durability_curves', 'planned_workouts'],
      warnings: [],
      counts: {
        athlete: { received: 1, accepted: 1, rejected: 0 },
        activities: { received: 0, accepted: 0, rejected: 0 },
        power_curves: { received: 1, accepted: 1, rejected: 0 },
        durability_curves: { received: 3, accepted: 3, rejected: 0 },
        planned_workouts: { received: 0, accepted: 0, rejected: 0 },
      },
    });
    expect(response.body).not.toContain('i123');
  });

  it('does not persist a response superseded by a newer athlete request', async () => {
    const deps = dependencies({ commit: vi.fn().mockResolvedValue(false) });
    const response = await createSyncHandler(deps)(event());
    expect(response.statusCode).toBe(409);
    expect(deps.commit).toHaveBeenCalledOnce();
  });

  it('rejects stale A after B starts and commits only B at the atomic boundary', async () => {
    let latestKey = '';
    const aLoaded = (() => {
      let resolve!: (value: Awaited<ReturnType<ReturnType<typeof dependencies>['load']>>) => void;
      const promise = new Promise<Awaited<ReturnType<ReturnType<typeof dependencies>['load']>>>((done) => { resolve = done; });
      return { promise, resolve };
    })();
    const grouped = (watts: number) => ({ list: [
      { id: '90d', secs: [5], values: [watts], powerModels: [] },
      { id: '90d-kj0', after_kj: 700, secs: [5], values: [watts - 50], powerModels: [] },
      { id: '90d-kj1', after_kj: 1400, secs: [5], values: [watts - 100], powerModels: [] },
    ] });
    const loaded = (name: string, watts: number) => ({
      athlete: { id: 'i123', name, sportSettings: [] }, activities: [],
      powerCurves: grouped(watts), durabilityCurves: grouped(watts), plannedWorkouts: [], warnings: [],
      updated: ['power_curves', 'durability_curves'],
    });
    const committed: Array<{ key: string; freshWatts: number }> = [];
    const deps = dependencies({
      beginSync: vi.fn(async (_athleteId: string, key: string) => { latestKey = key; }),
      load: vi.fn((_externalId: string, request: { syncKey: string }) => request.syncKey === 'sync-a'
        ? aLoaded.promise
        : Promise.resolve(loaded('B', 901))),
      commit: vi.fn(async (_coachId: string, _athleteId: string, key: string, data: { durabilitySnapshot: { fresh_curve: { points: Array<{ watts: number }> } } }) => {
        if (key !== latestKey) return false;
        committed.push({ key, freshWatts: data.durabilitySnapshot.fresh_curve.points[0].watts });
        return true;
      }),
    });
    const handler = createSyncHandler(deps);

    const requestA = handler(event({ syncKey: 'sync-a' }));
    await vi.waitFor(() => expect(deps.beginSync).toHaveBeenCalledWith(internalAthleteId, 'sync-a'));
    const requestB = handler(event({ syncKey: 'sync-b' }));
    await vi.waitFor(() => expect(deps.beginSync).toHaveBeenCalledWith(internalAthleteId, 'sync-b'));
    expect((await requestB).statusCode).toBe(200);
    aLoaded.resolve(loaded('A', 801));

    expect((await requestA).statusCode).toBe(409);
    expect(committed).toEqual([{ key: 'sync-b', freshWatts: 901 }]);
  });

  it('reports sanitized rejection counts for mixed arrays and an invalid profile', async () => {
    const deps = dependencies({
      load: vi.fn().mockResolvedValue({
        athlete: { id: 'i123', name: '', sportSettings: [{ types: ['Ride'], ftp: 'private-invalid-value' }] },
        activities: [
          { id: 'i1', icu_athlete_id: 'i123', name: 'Valid private name', type: 'Ride', start_date: '2026-09-01T08:00:00Z', moving_time: 3600 },
          { id: 'i2', icu_athlete_id: 'i123', name: 'Rejected private name', type: 'Ride', start_date: 'bad-date', moving_time: -1 },
        ],
        powerCurves: null,
        plannedWorkouts: [
          { id: 1, athlete_id: 'i123', start_date_local: '2026-09-06T08:00:00', name: 'Valid workout', category: 'WORKOUT' },
          { id: 2, athlete_id: 'private-id', start_date_local: 'bad-date', name: 'Rejected workout', category: 'WORKOUT' },
        ],
        warnings: ['power_curves'],
        updated: ['athlete', 'activities', 'planned_workouts'],
      }),
      commit: vi.fn().mockResolvedValue(true),
    });

    const response = await createSyncHandler(deps)(event());
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(207);
    expect(body.status).toBe('partial');
    expect(body.counts).toMatchObject({
      athlete: { received: 1, accepted: 0, rejected: 1 },
      activities: { received: 2, accepted: 1, rejected: 1 },
      planned_workouts: { received: 2, accepted: 1, rejected: 1 },
    });
    expect(body.warnings).toEqual(expect.arrayContaining([
      'athlete:1_rejected', 'activities:1_rejected', 'planned_workouts:1_rejected', 'power_curves',
    ]));
    expect(response.body).not.toContain('private');
  });

  it('records the cancellation key before loading upstream data', async () => {
    const order: string[] = [];
    const deps = dependencies({
      beginSync: vi.fn().mockImplementation(async () => { order.push('begin'); }),
      load: vi.fn().mockImplementation(async () => { order.push('load'); return { athlete: { id: 'i123', name: 'Test athlete', sportSettings: [] }, activities: [], powerCurves: null, plannedWorkouts: [], warnings: [], updated: [] }; }),
      commit: vi.fn().mockImplementation(async () => { order.push('commit'); return true; }),
    });
    await createSyncHandler(deps)(event());
    expect(order).toEqual(['begin', 'load', 'commit']);
  });

  it.each([
    ['all', undefined],
    ['indoor', '[{"field_id":"indoor","operator":"eq","value":true}]'],
    ['outdoor', '[{"field_id":"indoor","operator":"eq","value":false}]'],
  ] as const)('loads exact dates and the %s power-curve environment', async (environment, expectedFilters) => {
    const calls: Array<{ path: string; query?: Readonly<Record<string, string>> }> = [];
    const client = new IntervalsClient({
      async get(path, query) {
        calls.push({ path, query });
        if (path.endsWith('/activities') || path.endsWith('/events')) return [];
        if (path.endsWith('/power-curves')) return { list: [
          { id: '90d-kj1', after_kj: 1400, secs: [5], values: [800], powerModels: [] },
          { id: '90d', secs: [5], values: [900], powerModels: [] },
          { id: '90d-kj0', after_kj: 700, secs: [5], values: [850], powerModels: [] },
        ] };
        return { id: 'i123', name: 'Ciclista', sportSettings: [] };
      },
    });

    const result = await loadIntervalsAthleteData(client, 'i123', {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment, syncKey: 'sync-2',
    });

    expect(calls).toEqual([
      { path: '/athlete/i123', query: undefined },
      { path: '/athlete/i123/activities', query: { oldest: '2026-06-08', newest: '2026-09-05' } },
      { path: '/athlete/i123/power-curves', query: {
        curves: '90d,90d-kj0,90d-kj1', newest: '2026-09-05', type: 'Ride', subMaxEfforts: '3',
        ...(expectedFilters ? { filters: expectedFilters } : {}),
      } },
      { path: '/athlete/i123/events', query: { oldest: '2026-06-08', newest: '2026-09-05', category: 'WORKOUT' } },
    ]);
    expect(result.durabilityCurves).not.toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('keeps a component warning while returning the other synchronized components', async () => {
    const client = new IntervalsClient({
      async get(path) {
        if (path.endsWith('/power-curves')) throw new Error('upstream unavailable');
        if (path.endsWith('/activities') || path.endsWith('/events')) return [];
        return { id: 'i123', name: 'Ciclista', sportSettings: [] };
      },
    });
    const result = await loadIntervalsAthleteData(client, 'i123', {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all', syncKey: 'sync-2',
    });
    expect(result.warnings).toEqual(['power_curves', 'durability_curves']);
    expect(result.updated).toEqual(['athlete', 'activities', 'planned_workouts']);
  });

  it('marks a malformed fulfilled curve as a component warning', async () => {
    const client = new IntervalsClient({
      async get(path) {
        if (path.endsWith('/power-curves')) return { list: [] };
        if (path.endsWith('/activities') || path.endsWith('/events')) return [];
        return { id: 'i123', name: 'Ciclista', sportSettings: [] };
      },
    });
    const result = await loadIntervalsAthleteData(client, 'i123', {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all', syncKey: 'sync-2',
    });
    expect(result.powerCurves).toBeNull();
    expect(result.warnings).toContain('power_curves');
    expect(result.warnings).toContain('durability_curves');
    expect(result.updated).not.toContain('power_curves');
    const normalized = normalizeAthleteData(result, {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all', syncKey: 'sync-2',
    }, new Date('2026-09-05T12:00:00Z'));
    expect(normalized.counts.power_curves).toEqual({ received: 1, accepted: 0, rejected: 1 });
    expect(normalized.warnings).toContain('power_curves:1_rejected');
  });

  it('counts malformed fulfilled collections as one rejected component without exposing their content', async () => {
    const client = new IntervalsClient({
      async get(path) {
        if (path.endsWith('/activities')) return { privateActivity: 'do-not-expose' };
        if (path.endsWith('/events')) return { privateWorkout: 'do-not-expose' };
        if (path.endsWith('/power-curves')) return { list: [
          { id: '90d', secs: [5], values: [900], powerModels: [] },
          { id: '90d-kj0', after_kj: 700, secs: [5], values: [850], powerModels: [] },
          { id: '90d-kj1', after_kj: 1400, secs: [5], values: [800], powerModels: [] },
        ] };
        return { id: 'i123', name: 'Ciclista', sportSettings: [] };
      },
    });
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all' as const, syncKey: 'sync-2',
    };
    const result = await loadIntervalsAthleteData(client, 'i123', request);
    const normalized = normalizeAthleteData(result, request, new Date('2026-09-05T12:00:00Z'));

    expect(normalized.counts.activities).toEqual({ received: 1, accepted: 0, rejected: 1 });
    expect(normalized.counts.planned_workouts).toEqual({ received: 1, accepted: 0, rejected: 1 });
    expect(normalized.warnings).toEqual(expect.arrayContaining([
      'activities:1_rejected', 'planned_workouts:1_rejected',
    ]));
    expect(JSON.stringify(normalized)).not.toContain('do-not-expose');
  });

  it('hashes only canonical normalized curve content', () => {
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'indoor' as const, syncKey: 'sync-2',
    };
    const payload = createPowerCurveSnapshotPayload({
      list: [{
        id: 'raw-secret-id', secs: [60, 5, 5], values: [510, 900, 925], rawSecret: 'never-store-this',
        powerModels: [{ type: 'ECP', criticalPower: 265, wPrime: 17000, pMax: 980, ftp: 255 }],
      }],
    }, request);

    expect(payload).toEqual({
      sport: 'Ride',
      environment: 'indoor',
      oldest: '2026-06-08',
      newest: '2026-09-05',
      points: [{ seconds: 5, watts: 925 }, { seconds: 60, watts: 510 }],
      source_models: [{ type: 'ECP', cpWatts: 265, wPrimeKj: 17, pmaxWatts: 980, ftpWatts: 255, r2: null }],
      source_version: 'intervals-openapi-v1',
      content_hash: '8e6fe6e7fee445c8e086b2fcbbac00bf448f25c7c0c6bcc1cb0676e80eeb4f9e',
    });
    expect(JSON.stringify(payload)).not.toContain('raw-secret-id');
    expect(JSON.stringify(payload)).not.toContain('never-store-this');
  });

  it('uses the fresh member of a grouped response for the power snapshot', () => {
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all' as const, syncKey: 'sync-2',
    };

    expect(createPowerCurveSnapshotPayload(durabilityCurves, request).points[0]).toEqual({ seconds: 10, watts: 900 });
  });

  it('persists a partial durability snapshot without discarding fresh and valid fatigued curves', () => {
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all' as const, syncKey: 'sync-2',
    };
    const normalized = normalizeAthleteData({
      athlete: null,
      activities: [],
      powerCurves: { list: [durabilityCurves.list[1]] },
      durabilityCurves: { list: [
        durabilityCurves.list[1],
        { id: '90d-kj0', after_kj: 700, secs: [10], values: [] },
        durabilityCurves.list[0],
      ] },
      plannedWorkouts: [],
      warnings: [],
      updated: ['power_curves', 'durability_curves'],
      received: { durability_curves: 3 },
    }, request, new Date('2026-09-05T12:00:00Z'));

    expect(normalized.durabilitySnapshot?.fresh_curve).toBeDefined();
    expect(normalized.durabilitySnapshot?.fatigued_curves).toHaveLength(1);
    expect(normalized.warnings).toContain('durability_curves:1_rejected');
    expect(normalized.counts.durability_curves).toEqual({ received: 3, accepted: 2, rejected: 1 });
  });

  it('keeps a fresh-only durability snapshot with a readable partial warning', () => {
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all' as const, syncKey: 'sync-2',
    };
    const normalized = normalizeAthleteData({
      athlete: null,
      activities: [],
      powerCurves: { list: [durabilityCurves.list[1]] },
      durabilityCurves: { list: [durabilityCurves.list[1]] },
      plannedWorkouts: [],
      warnings: [],
      updated: ['power_curves', 'durability_curves'],
      received: { durability_curves: 1 },
    }, request, new Date('2026-09-05T12:00:00Z'));

    expect(normalized.durabilitySnapshot?.fresh_curve.points).toHaveLength(4);
    expect(normalized.warnings).toContain('Faltan curvas fatigadas de Durabilidad para uno o más umbrales.');
  });

  it('normalizes a non-positive source weight to null before atomic persistence', () => {
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all' as const, syncKey: 'sync-2',
    };
    const payload = createDurabilitySnapshotPayload({
      list: [{ id: '90d', weight: 0, secs: [10], values: [900], powerModels: [] }],
    }, [], request, '2026-09-05T12:00:00.000Z');

    expect(payload.weight_kg).toBeNull();
    expect(payload.weight_observed_at).toBeNull();
    expect(payload.fresh_curve.weightKg).toBeNull();
  });

  it('stores complete durability provenance and hashes canonical curve order', () => {
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all' as const, syncKey: 'sync-2',
    };
    const activities = [
      { intervals_activity_id: 'i1', normalized_data: { name: 'Private one', deviceWatts: true } },
      { intervals_activity_id: 'i2', normalized_data: { name: 'Private two', deviceWatts: true } },
      { intervals_activity_id: 'i3', normalized_data: { name: 'Private three', deviceWatts: false } },
    ];
    const payload = createDurabilitySnapshotPayload(durabilityCurves, activities, request, '2026-09-05T12:00:00.000Z');
    const reordered = createDurabilitySnapshotPayload(
      { list: [...durabilityCurves.list].reverse() }, activities, request, '2026-09-05T12:00:00.000Z',
    );

    expect(payload.fresh_curve.points[0]).toMatchObject({
      seconds: 10,
      activityId: 'i1',
      supportingActivityIds: ['i1'],
      supportingActivityCount: 1,
      supportingEffortCount: 1,
      powerSource: 'measured',
      startIndex: 1,
      endIndex: 11,
    });
    expect(payload.fatigued_curves.map((curve) => curve.afterKj)).toEqual([700, 1400]);
    expect(payload.fatigued_curves[1].points[0]).toMatchObject({
      supportingActivityIds: ['i3', 'i5', 'i6'], supportingActivityCount: 3, supportingEffortCount: 3, powerSource: 'unknown',
    });
    expect(payload).toMatchObject({ weight_kg: 70, weight_observed_at: '2026-09-05T12:00:00.000Z' });
    expect(payload.content_hash).toBe(reordered.content_hash);
    expect(JSON.stringify(payload)).not.toContain('Private');
  });

  it('does not claim measured power when the record has no primary activity id', () => {
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all' as const, syncKey: 'sync-2',
    };
    const payload = createDurabilitySnapshotPayload({
      list: [{
        id: '90d',
        weight: 70,
        secs: [10],
        values: [900],
        submax_values: [[890]],
        submax_activity_id: [['i2']],
        powerModels: [],
      }],
    }, [{ intervals_activity_id: 'i2', normalized_data: { deviceWatts: true } }], request, '2026-09-05T12:00:00.000Z');

    expect(payload.fresh_curve.points[0]).toMatchObject({
      activityId: null,
      supportingActivityIds: ['i2'],
      powerSource: 'unknown',
    });
  });

  it('keeps the same logical hash when source models arrive reordered', () => {
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all' as const, syncKey: 'sync-2',
    };
    const models = [
      { type: 'ECP', criticalPower: 265, wPrime: 17000, pMax: 980, ftp: 255 },
      { type: 'ECP', criticalPower: 260, wPrime: 18000, pMax: 1000, ftp: 250 },
      { type: 'MORTON_3P', criticalPower: 262, wPrime: 17500, pMax: 990, ftp: 252 },
    ];
    const curveWith = (powerModels: typeof models) => ({
      list: [{ id: '90d', secs: [5], values: [900], powerModels }],
    });

    expect(createPowerCurveSnapshotPayload(curveWith(models), request).content_hash)
      .toBe(createPowerCurveSnapshotPayload(curveWith([...models].reverse()), request).content_hash);
  });

  it('sends all pre-normalized components through one atomic server RPC without rewriting the latest key', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return Response.json(true);
    }) as unknown as typeof fetch;
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all' as const, syncKey: 'sync-2',
    };
    const normalized = normalizeAthleteData({
      athlete: { id: 'i123', name: 'Authorized athlete', sportSettings: [{ types: ['Ride'], ftp: 255, w_prime: 17000 }] },
      activities: [{ id: 'i9001', icu_athlete_id: 'i123', name: 'Ride', type: 'Ride', start_date: '2026-09-01T08:00:00Z', moving_time: 3600, device_watts: true }],
      powerCurves: { list: [
        { id: '90d', weight: 70, secs: [5], values: [900], activity_id: ['i9001'], powerModels: [] },
        { id: '90d-kj0', after_kj: 700, weight: 70, secs: [5], values: [850], activity_id: ['i9001'], powerModels: [] },
        { id: '90d-kj1', after_kj: 1400, weight: 70, secs: [5], values: [800], activity_id: ['i9001'], powerModels: [] },
      ] },
      durabilityCurves: { list: [
        { id: '90d', weight: 70, secs: [5], values: [900], activity_id: ['i9001'], powerModels: [] },
        { id: '90d-kj0', after_kj: 700, weight: 70, secs: [5], values: [850], activity_id: ['i9001'], powerModels: [] },
        { id: '90d-kj1', after_kj: 1400, weight: 70, secs: [5], values: [800], activity_id: ['i9001'], powerModels: [] },
      ] },
      plannedWorkouts: [{ id: 45, athlete_id: 'i123', start_date_local: '2026-09-06T08:00:00', name: 'Workout', category: 'WORKOUT' }],
      warnings: [],
      updated: ['athlete', 'activities', 'power_curves', 'durability_curves', 'planned_workouts'],
    }, request, new Date('2026-09-05T12:00:00Z'));

    const persisted = await persistNormalizedAthleteData(
      fetchImpl,
      { url: 'https://supabase.test', headers: { apikey: 'server-only', Authorization: 'Bearer server-only', 'Content-Type': 'application/json' } },
      'coach-1',
      internalAthleteId,
      'sync-2',
      normalized,
      request,
    );

    expect(persisted).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://supabase.test/rest/v1/rpc/persist_athlete_sync');
    const body = JSON.parse(String(requests[0].init?.body));
    expect(body).toMatchObject({
      target_athlete_id: internalAthleteId,
      expected_sync_key: 'sync-2',
      target_coach_id: 'coach-1',
      sync_payload: {
        status: 'complete',
        activities: [{ intervals_activity_id: 'i9001' }],
        snapshot: { points: [{ seconds: 5, watts: 900 }] },
        durability_snapshot: {
          fresh_curve: { points: [{ seconds: 5, watts: 900, supportingActivityCount: 1, supportingEffortCount: 1 }] },
          fatigued_curves: [{ afterKj: 700 }, { afterKj: 1400 }],
        },
      },
    });
    expect(body.sync_payload).not.toHaveProperty('latest_sync_key');
  });
});
