import { describe, expect, it, vi } from 'vitest';
import { IntervalsClient } from '../../src/server/intervals/client';
import {
  createPowerCurveSnapshotPayload,
  createSyncHandler,
  loadIntervalsAthleteData,
  normalizeAthleteData,
  persistNormalizedAthleteData,
} from '../../netlify/functions/sync-athlete';

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
      powerCurves: { list: [{ id: '90d', secs: [5], values: [900], powerModels: [] }] },
      plannedWorkouts: [], warnings: [],
      updated: ['athlete', 'activities', 'power_curves', 'planned_workouts'],
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
        athlete: { id: 'i123', name: 'Test athlete', sportSettings: [] }, activities: [], powerCurves: null, plannedWorkouts: [], warnings: ['power_curves'],
        updated: ['athlete', 'activities', 'planned_workouts'],
      }),
    });
    const response = await createSyncHandler(deps)(event());
    expect(response.statusCode).toBe(207);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'partial', warnings: ['power_curves'] });
    expect(deps.commit).toHaveBeenCalledOnce();
  });

  it('returns only a normalized synchronization summary', async () => {
    const response = await createSyncHandler(dependencies())(event());
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      synchronizedAt: '2026-09-05T12:00:00.000Z',
      status: 'complete',
      updated: ['athlete', 'activities', 'power_curves', 'planned_workouts'],
      warnings: [],
      counts: {
        athlete: { received: 1, accepted: 1, rejected: 0 },
        activities: { received: 0, accepted: 0, rejected: 0 },
        power_curves: { received: 1, accepted: 1, rejected: 0 },
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
    const committed: string[] = [];
    const deps = dependencies({
      beginSync: vi.fn(async (_athleteId: string, key: string) => { latestKey = key; }),
      load: vi.fn((_externalId: string, request: { syncKey: string }) => request.syncKey === 'sync-a'
        ? aLoaded.promise
        : Promise.resolve({ athlete: { id: 'i123', name: 'B', sportSettings: [] }, activities: [], powerCurves: null, plannedWorkouts: [], warnings: [], updated: [] })),
      commit: vi.fn(async (_coachId: string, _athleteId: string, key: string) => {
        if (key !== latestKey) return false;
        committed.push(key);
        return true;
      }),
    });
    const handler = createSyncHandler(deps);

    const requestA = handler(event({ syncKey: 'sync-a' }));
    await vi.waitFor(() => expect(deps.beginSync).toHaveBeenCalledWith(internalAthleteId, 'sync-a'));
    const requestB = handler(event({ syncKey: 'sync-b' }));
    await vi.waitFor(() => expect(deps.beginSync).toHaveBeenCalledWith(internalAthleteId, 'sync-b'));
    expect((await requestB).statusCode).toBe(200);
    aLoaded.resolve({ athlete: { id: 'i123', name: 'A', sportSettings: [] }, activities: [], powerCurves: null, plannedWorkouts: [], warnings: [], updated: [] });

    expect((await requestA).statusCode).toBe(409);
    expect(committed).toEqual(['sync-b']);
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
        if (path.endsWith('/power-curves')) return { list: [{ id: '90d', secs: [5], values: [900], powerModels: [] }] };
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
        curves: '90d', newest: '2026-09-05', type: 'Ride', ...(expectedFilters ? { filters: expectedFilters } : {}),
      } },
      { path: '/athlete/i123/events', query: { oldest: '2026-06-08', newest: '2026-09-05', category: 'WORKOUT' } },
    ]);
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
    expect(result.warnings).toEqual(['power_curves']);
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
        if (path.endsWith('/power-curves')) return { list: [{ id: '90d', secs: [5], values: [900], powerModels: [] }] };
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
      activities: [{ id: 'i9001', icu_athlete_id: 'i123', name: 'Ride', type: 'Ride', start_date: '2026-09-01T08:00:00Z', moving_time: 3600 }],
      powerCurves: { list: [{ id: '90d', secs: [5], values: [900], powerModels: [] }] },
      plannedWorkouts: [{ id: 45, athlete_id: 'i123', start_date_local: '2026-09-06T08:00:00', name: 'Workout', category: 'WORKOUT' }],
      warnings: [],
      updated: ['athlete', 'activities', 'power_curves', 'planned_workouts'],
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
      },
    });
    expect(body.sync_payload).not.toHaveProperty('latest_sync_key');
  });
});
