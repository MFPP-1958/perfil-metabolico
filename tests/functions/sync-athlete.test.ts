import { describe, expect, it, vi } from 'vitest';
import { IntervalsClient } from '../../src/server/intervals/client';
import {
  createPowerCurveSnapshotPayload,
  createSyncHandler,
  loadIntervalsAthleteData,
  persistNormalizedAthleteData,
  persistPowerCurveSnapshot,
  withoutUnchangedSnapshots,
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
    isLatestSync: vi.fn().mockResolvedValue(true),
    load: vi.fn().mockResolvedValue({
      athlete: { id: 'i123' }, activities: [], powerCurves: { list: [] }, plannedWorkouts: [], warnings: [],
      updated: ['athlete', 'activities', 'power_curves', 'planned_workouts'],
    }),
    persist: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('athlete synchronization', () => {
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
    expect(deps.persist).toHaveBeenCalledWith(
      'coach-1', internalAthleteId, 'sync-2', expect.any(Object), expect.objectContaining({ environment: 'indoor' }),
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
        athlete: { id: 'i123' }, activities: [], powerCurves: null, plannedWorkouts: [], warnings: ['power_curves'],
        updated: ['athlete', 'activities', 'planned_workouts'],
      }),
    });
    const response = await createSyncHandler(deps)(event());
    expect(response.statusCode).toBe(207);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'partial', warnings: ['power_curves'] });
    expect(deps.persist).toHaveBeenCalledOnce();
  });

  it('returns only a normalized synchronization summary', async () => {
    const response = await createSyncHandler(dependencies())(event());
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      synchronizedAt: '2026-09-05T12:00:00.000Z',
      status: 'complete',
      updated: ['athlete', 'activities', 'power_curves', 'planned_workouts'],
      warnings: [],
    });
    expect(response.body).not.toContain('i123');
  });

  it('does not persist a response superseded by a newer athlete request', async () => {
    const deps = dependencies({ isLatestSync: vi.fn().mockResolvedValue(false) });
    const response = await createSyncHandler(deps)(event());
    expect(response.statusCode).toBe(409);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('records the cancellation key before loading upstream data', async () => {
    const order: string[] = [];
    const deps = dependencies({
      beginSync: vi.fn().mockImplementation(async () => { order.push('begin'); }),
      load: vi.fn().mockImplementation(async () => { order.push('load'); return { athlete: { id: 'i123' }, activities: [], powerCurves: null, plannedWorkouts: [], warnings: [] }; }),
      isLatestSync: vi.fn().mockImplementation(async () => { order.push('check'); return true; }),
    });
    await createSyncHandler(deps)(event());
    expect(order).toEqual(['begin', 'load', 'check']);
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
  });

  it('does not append an unchanged imported physiological snapshot', () => {
    const incoming = [
      { metric_code: 'ftp', value: 280, unit: 'W', protocol_name: 'sportSettings[Ride].ftp', protocol_version: 'intervals-openapi-v1' },
      { metric_code: 'vo2max', value: 61, unit: 'ml·kg⁻¹·min⁻¹', protocol_name: 'sportSettings[Ride].vo2max', protocol_version: 'intervals-openapi-v1' },
    ];
    const existing = [{ metric_code: 'ftp', value: 280, unit: 'W', protocol_name: 'sportSettings[Ride].ftp', protocol_version: 'intervals-openapi-v1' }];
    expect(withoutUnchangedSnapshots(incoming, existing, ['metric_code', 'value', 'unit', 'protocol_name', 'protocol_version'])).toEqual([incoming[1]]);
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

  it('uses an idempotent snapshot insert while retaining changed content history', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all' as const, syncKey: 'sync-2',
    };
    const rawCurve = { list: [{ id: '90d', secs: [5], values: [900], powerModels: [] }] };

    await persistPowerCurveSnapshot(fetchImpl, {
      url: 'https://supabase.test', headers: { apikey: 'secret', Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    }, 'coach-1', internalAthleteId, request, rawCurve);
    await persistPowerCurveSnapshot(fetchImpl, {
      url: 'https://supabase.test', headers: { apikey: 'secret', Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    }, 'coach-1', internalAthleteId, request, { list: [{ ...rawCurve.list[0], values: [901] }] });

    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe('https://supabase.test/rest/v1/power_curve_snapshots?on_conflict=athlete_id,sport,environment,oldest,newest,content_hash');
    expect(new Headers(requests[0].init?.headers).get('Prefer')).toBe('resolution=ignore-duplicates,return=minimal');
    const first = JSON.parse(String(requests[0].init?.body));
    const second = JSON.parse(String(requests[1].init?.body));
    expect(first).toMatchObject({ athlete_id: internalAthleteId, created_by: 'coach-1', points: [{ seconds: 5, watts: 900 }] });
    expect(first.content_hash).not.toBe(second.content_hash);
  });

  it('persists normalized components against the authorized internal athlete without recreating ownership', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (init?.method === 'GET' || (!init?.method && (url.includes('/observations?') || url.includes('/derived_results?')))) {
        return Response.json([]);
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const request = {
      athleteId: internalAthleteId,
      oldest: '2026-06-08', newest: '2026-09-05', days: 90, environment: 'all' as const, syncKey: 'sync-2',
    };
    await persistNormalizedAthleteData(
      fetchImpl,
      { url: 'https://supabase.test', headers: { apikey: 'secret', Authorization: 'Bearer secret', 'Content-Type': 'application/json' } },
      new Date('2026-09-05T12:00:00Z'),
      'coach-1',
      internalAthleteId,
      'sync-2',
      {
        athlete: { id: 'i123', name: 'Ciclista autorizado', sportSettings: [{ types: ['Ride'], ftp: 255, w_prime: 17000 }] },
        activities: [{ id: 'i9001', icu_athlete_id: 'i123', name: 'Ruta', type: 'Ride', start_date: '2026-09-01T08:00:00Z', moving_time: 3600 }],
        powerCurves: { list: [{ id: '90d', secs: [5], values: [900], powerModels: [] }] },
        plannedWorkouts: [{ id: 45, athlete_id: 'i123', start_date_local: '2026-09-06T08:00:00', name: 'Series', category: 'WORKOUT' }],
        warnings: [],
        updated: ['athlete', 'activities', 'power_curves', 'planned_workouts'],
      },
      request,
    );

    expect(requests.some(({ url }) => url.includes('/coach_athletes'))).toBe(false);
    expect(requests.some(({ url }) => url.includes('on_conflict=intervals_athlete_id'))).toBe(false);
    expect(requests.some(({ url }) => url.includes('/power_curve_snapshots?on_conflict='))).toBe(true);
    const bodies = requests.flatMap(({ init }) => typeof init?.body === 'string' ? [init.body] : []);
    expect(bodies.every((body) => !body.includes('"intervals_athlete_id"'))).toBe(true);
    expect(bodies.filter((body) => body.includes('"athlete_id"')).every((body) => body.includes(internalAthleteId))).toBe(true);
  });
});
