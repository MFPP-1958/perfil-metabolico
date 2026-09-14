import { describe, expect, it, vi } from 'vitest';
import {
  createDurabilityAnalysisHandler,
  loadLatestDurabilitySnapshot,
  persistConfirmedDurabilityAnalysis,
} from '../../netlify/functions/durability-analysis';
import type { DurabilityRow } from '../../src/physiology/durability/types';

const coachId = '11000000-0000-4000-8000-000000000001';
const athleteId = '21000000-0000-4000-8000-000000000001';
const otherAthleteId = '21000000-0000-4000-8000-000000000002';
const snapshotId = '31000000-0000-4000-8000-000000000001';
const newerSnapshotId = '31000000-0000-4000-8000-000000000002';
const analysisId = '41000000-0000-4000-8000-000000000001';

function point(seconds: number, watts: number, suffix: string) {
  return {
    seconds,
    watts,
    activityId: `intervals-private-${suffix}`,
    supportingActivityIds: [`intervals-private-${suffix}`, `intervals-support-${suffix}`],
    startIndex: 12,
    endIndex: 24,
    supportingActivityCount: 2,
    supportingEffortCount: 3,
    powerSource: 'measured',
  };
}

const snapshotRow = {
  id: snapshotId,
  athlete_id: athleteId,
  created_by: coachId,
  sport: 'Ride',
  environment: 'all',
  oldest: '2026-06-16',
  newest: '2026-09-14',
  fresh_curve: {
    weightKg: 70,
    points: [
      point(10, 900, 'fresh-10'),
      point(60, 400, 'fresh-60'),
      point(300, 300, 'fresh-300'),
      point(1_200, 240, 'fresh-1200'),
    ],
  },
  fatigued_curves: [
    {
      level: 'kj0', afterKj: 700, weightKg: 70,
      points: [
        point(10, 855, 'kj0-10'),
        point(60, 380, 'kj0-60'),
        point(300, 285, 'kj0-300'),
        point(1_200, 228, 'kj0-1200'),
      ],
    },
    {
      level: 'kj1', afterKj: 1_400, weightKg: 70,
      points: [
        point(10, 810, 'kj1-10'),
        point(60, 360, 'kj1-60'),
        point(300, 270, 'kj1-300'),
        point(1_200, 216, 'kj1-1200'),
      ],
    },
  ],
  weight_kg: 70,
  weight_observed_at: '2026-09-14T09:00:00.000Z',
  source_version: 'intervals-openapi-v1',
  content_hash: 'a'.repeat(64),
  synchronized_at: '2026-09-14T10:00:00.000Z',
};

const comparisonRows = ([10, 60, 300, 1_200] as const).map<DurabilityRow>((seconds, index) => {
  const freshWatts = [900, 400, 300, 240][index];
  return {
    seconds,
    freshWatts,
    levels: {
      kj0: {
        afterKj: 700,
        afterKjPerKg: 10,
        fatiguedWatts: [855, 380, 285, 228][index],
        declinePercent: 5,
        quality: 'observed',
        supportingActivityCount: 2,
        supportingEffortCount: 3,
        powerSource: 'measured',
      },
      kj1: {
        afterKj: 1_400,
        afterKjPerKg: 20,
        fatiguedWatts: [810, 360, 270, 216][index],
        declinePercent: 10,
        quality: 'observed',
        supportingActivityCount: 2,
        supportingEffortCount: 3,
        powerSource: 'measured',
      },
    },
    onsetAfterKj: 700,
    onsetAfterKjPerKg: 10,
  };
});

const confirmedRow = {
  id: analysisId,
  athlete_id: athleteId,
  snapshot_id: snapshotId,
  created_by: coachId,
  algorithm_version: 'durability-record-profile@2.0.0',
  comparisons: comparisonRows,
  quality: { coverage: 'high', warnings: [] },
  confirmed_at: '2026-09-14T10:30:00.000Z',
};

const exactQuery = {
  athleteId,
  oldest: '2026-06-16',
  newest: '2026-09-14',
  environment: 'all',
} as const;

function getEvent(query: Record<string, string> = {}) {
  return {
    httpMethod: 'GET',
    headers: { authorization: 'Bearer access-token' },
    queryStringParameters: { ...exactQuery, ...query },
  };
}

function postEvent(body: unknown, headers = { authorization: 'Bearer access-token' }) {
  return { httpMethod: 'POST', headers, body: JSON.stringify(body) };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    authenticate: vi.fn().mockResolvedValue({ id: coachId }),
    authorize: vi.fn().mockResolvedValue('coach'),
    loadLatestSnapshot: vi.fn().mockResolvedValue(snapshotRow),
    loadSnapshot: vi.fn().mockResolvedValue(snapshotRow),
    loadConfirmedAnalysis: vi.fn().mockResolvedValue(null),
    persistAnalysis: vi.fn().mockResolvedValue({ row: confirmedRow, created: true }),
    now: vi.fn().mockReturnValue(new Date('2026-09-14T12:00:00.000Z')),
    ...overrides,
  };
}

describe('authorized durability analysis API', () => {
  it('returns the allowed methods with a 405 response', async () => {
    const response = await createDurabilityAnalysisHandler(dependencies())({ httpMethod: 'PATCH' });

    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe('GET, POST');
  });

  it('returns 401 without a bearer token before database access', async () => {
    const deps = dependencies({ authenticate: vi.fn(), authorize: vi.fn(), loadLatestSnapshot: vi.fn() });
    const response = await createDurabilityAnalysisHandler(deps)({ ...getEvent(), headers: {} });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'Sesión necesaria o caducada.' });
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.loadLatestSnapshot).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid session before parsing malformed POST JSON', async () => {
    const deps = dependencies({ authenticate: vi.fn().mockResolvedValue(null), loadSnapshot: vi.fn() });
    const response = await createDurabilityAnalysisHandler(deps)({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer expired-token' },
      body: '{',
    });

    expect(response.statusCode).toBe(401);
    expect(deps.authenticate).toHaveBeenCalledOnce();
    expect(deps.loadSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ['UUID externo', { athleteId: 'i123' }],
    ['rango invertido', { oldest: '2026-09-15', newest: '2026-09-14' }],
    ['más de 730 días', { oldest: '2024-09-14' }],
    ['fecha futura', { newest: '2026-09-15' }],
    ['entorno desconocido', { environment: 'mixed' }],
    ['campo inesperado', { externalAthleteId: 'i123' }],
  ])('returns 400 for an invalid %s query before authorization', async (_label, query) => {
    const deps = dependencies({ authorize: vi.fn(), loadLatestSnapshot: vi.fn() });
    const response = await createDurabilityAnalysisHandler(deps)(getEvent(query));

    expect(response.statusCode).toBe(400);
    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.loadLatestSnapshot).not.toHaveBeenCalled();
  });

  it('returns 403 before reading snapshots for a cyclist outside the authenticated roster', async () => {
    const deps = dependencies({ authorize: vi.fn().mockResolvedValue(null), loadLatestSnapshot: vi.fn() });
    const response = await createDurabilityAnalysisHandler(deps)(getEvent());

    expect(response.statusCode).toBe(403);
    expect(deps.authorize).toHaveBeenCalledWith(coachId, athleteId);
    expect(deps.loadLatestSnapshot).not.toHaveBeenCalled();
  });

  it('returns 404 when no exactly matching persisted snapshot exists', async () => {
    const deps = dependencies({ authorize: vi.fn().mockResolvedValue('viewer'), loadLatestSnapshot: vi.fn().mockResolvedValue(null) });
    const response = await createDurabilityAnalysisHandler(deps)(getEvent());

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: 'No hay una instantánea de Durabilidad para este periodo y entorno.' });
  });

  it('returns a server-calculated matching snapshot to an authorized viewer without private identifiers', async () => {
    const deps = dependencies({ authorize: vi.fn().mockResolvedValue('viewer') });
    const response = await createDurabilityAnalysisHandler(deps)(getEvent());
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(deps.loadLatestSnapshot).toHaveBeenCalledWith(exactQuery);
    expect(body).toMatchObject({
      id: snapshotId,
      athleteId,
      oldest: '2026-06-16',
      newest: '2026-09-14',
      environment: 'all',
      weightKg: 70,
      weightObservedAt: '2026-09-14T09:00:00.000Z',
      synchronizedAt: '2026-09-14T10:00:00.000Z',
      sourceVersion: 'intervals-openapi-v1',
      result: {
        algorithmVersion: 'durability-record-profile@2.0.0',
        coverage: 'high',
        warnings: [],
      },
    });
    expect(body.result.rows[0]).toMatchObject({
      seconds: 10,
      freshWatts: 900,
      onsetAfterKj: 700,
      levels: {
        kj0: { fatiguedWatts: 855, declinePercent: 5, supportingActivityCount: 2, supportingEffortCount: 3 },
        kj1: { fatiguedWatts: 810, declinePercent: 10, supportingActivityCount: 2, supportingEffortCount: 3 },
      },
    });
    expect(response.body).not.toContain('intervals-private');
    expect(response.body).not.toContain('intervals-support');
    expect(response.body).not.toContain('activityId');
    expect(response.body).not.toContain('supportingActivityIds');
    expect(response.body).not.toContain('startIndex');
    expect(response.body).not.toContain('endIndex');
    expect(response.body).not.toContain('created_by');
    expect(response.body).not.toContain('content_hash');
  });

  it('uses UUID descending as a stable tie-breaker for equally synchronized snapshots', async () => {
    const tiedWinner = { ...snapshotRow, id: newerSnapshotId };
    const tiedSnapshots = [snapshotRow, tiedWinner];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      const order = new URL(requestUrl).searchParams.get('order');
      const ordered = order === 'synchronized_at.desc,id.desc'
        ? [...tiedSnapshots].sort((left, right) => right.id.localeCompare(left.id))
        : tiedSnapshots;
      return new Response(JSON.stringify(ordered.slice(0, 1)), { status: 200 });
    });
    const result = await loadLatestDurabilitySnapshot(fetchImpl, {
      url: 'https://supabase.test',
      headers: { apikey: 'server-secret', Authorization: 'Bearer server-secret' },
    }, exactQuery);

    expect(result).toEqual(tiedWinner);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url] = fetchImpl.mock.calls[0];
    const parsed = new URL(url instanceof Request ? url.url : String(url));
    expect(parsed.origin).toBe('https://supabase.test');
    expect(parsed.pathname).toBe('/rest/v1/durability_curve_snapshots');
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
      athlete_id: `eq.${athleteId}`,
      sport: 'eq.Ride',
      environment: 'eq.all',
      oldest: 'eq.2026-06-16',
      newest: 'eq.2026-09-14',
      order: 'synchronized_at.desc,id.desc',
      limit: '1',
    });
  });

  it('rejects malformed persisted snapshot JSON instead of exposing it', async () => {
    const deps = dependencies({ loadLatestSnapshot: vi.fn().mockResolvedValue({ ...snapshotRow, fresh_curve: { points: 'private' } }) });
    const response = await createDurabilityAnalysisHandler(deps)(getEvent());

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('private');
  });

  it('reloads the authorized current snapshot and persists only the server recalculation', async () => {
    const deps = dependencies();
    const response = await createDurabilityAnalysisHandler(deps)(postEvent({ snapshotId }));

    expect(response.statusCode).toBe(201);
    expect(deps.loadSnapshot).toHaveBeenCalledWith(snapshotId);
    expect(deps.authorize).toHaveBeenCalledWith(coachId, athleteId);
    expect(deps.loadLatestSnapshot).toHaveBeenCalledWith(exactQuery);
    expect(deps.persistAnalysis).toHaveBeenCalledWith({
      athleteId,
      snapshotId,
      createdBy: coachId,
      algorithmVersion: 'durability-record-profile@2.0.0',
      comparisons: expect.arrayContaining([
        expect.objectContaining({
          seconds: 10,
          freshWatts: 900,
          levels: expect.objectContaining({
            kj0: expect.objectContaining({ fatiguedWatts: 855, declinePercent: 5 }),
          }),
        }),
      ]),
      quality: { coverage: 'high', warnings: [] },
    });
    expect(JSON.parse(response.body)).toEqual({
      id: analysisId,
      snapshotId,
      algorithmVersion: 'durability-record-profile@2.0.0',
      comparisons: comparisonRows,
      quality: { coverage: 'high', warnings: [] },
      confirmedAt: '2026-09-14T10:30:00.000Z',
    });
    expect(response.body).not.toContain(athleteId);
    expect(response.body).not.toContain(coachId);
  });

  it.each([
    { snapshotId, result: { rows: [] } },
    { snapshotId, comparisons: [{ watts: 99_999 }] },
    { snapshotId, score: 100 },
    { snapshotId, athleteId: otherAthleteId },
    { snapshotId, weightKg: 40 },
  ])('rejects forged client fields without loading or persisting a snapshot', async (body) => {
    const deps = dependencies({ loadSnapshot: vi.fn(), persistAnalysis: vi.fn() });
    const response = await createDurabilityAnalysisHandler(deps)(postEvent(body));

    expect(response.statusCode).toBe(400);
    expect(deps.loadSnapshot).not.toHaveBeenCalled();
    expect(deps.persistAnalysis).not.toHaveBeenCalled();
  });

  it('distinguishes a missing POST snapshot from a forbidden owned snapshot', async () => {
    const missingDeps = dependencies({ loadSnapshot: vi.fn().mockResolvedValue(null) });
    const missing = await createDurabilityAnalysisHandler(missingDeps)(postEvent({ snapshotId }));
    expect(missing.statusCode).toBe(404);

    const forbiddenDeps = dependencies({ authorize: vi.fn().mockResolvedValue(null), loadLatestSnapshot: vi.fn() });
    const forbidden = await createDurabilityAnalysisHandler(forbiddenDeps)(postEvent({ snapshotId }));
    expect(forbidden.statusCode).toBe(403);
    expect(forbiddenDeps.loadLatestSnapshot).not.toHaveBeenCalled();
  });

  it('returns 403 when a viewer tries to confirm', async () => {
    const deps = dependencies({ authorize: vi.fn().mockResolvedValue('viewer'), loadLatestSnapshot: vi.fn(), persistAnalysis: vi.fn() });
    const response = await createDurabilityAnalysisHandler(deps)(postEvent({ snapshotId }));

    expect(response.statusCode).toBe(403);
    expect(deps.loadLatestSnapshot).not.toHaveBeenCalled();
    expect(deps.persistAnalysis).not.toHaveBeenCalled();
  });

  it('returns 409 when the requested snapshot is no longer the latest exact-context snapshot', async () => {
    const deps = dependencies({
      loadLatestSnapshot: vi.fn().mockResolvedValue({ ...snapshotRow, id: newerSnapshotId }),
      persistAnalysis: vi.fn(),
    });
    const response = await createDurabilityAnalysisHandler(deps)(postEvent({ snapshotId }));

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({ error: 'La instantánea ha quedado obsoleta. Vuelve a cargar el análisis.' });
    expect(deps.persistAnalysis).not.toHaveBeenCalled();
  });

  it('returns an earlier immutable confirmation before checking whether its snapshot became stale', async () => {
    const deps = dependencies({
      loadConfirmedAnalysis: vi.fn().mockResolvedValue(confirmedRow),
      loadLatestSnapshot: vi.fn().mockResolvedValue({ ...snapshotRow, id: newerSnapshotId }),
      persistAnalysis: vi.fn(),
    });
    const response = await createDurabilityAnalysisHandler(deps)(postEvent({ snapshotId }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      id: analysisId,
      snapshotId,
      algorithmVersion: 'durability-record-profile@2.0.0',
      comparisons: comparisonRows,
      quality: { coverage: 'high', warnings: [] },
      confirmedAt: '2026-09-14T10:30:00.000Z',
    });
    expect(deps.loadConfirmedAnalysis).toHaveBeenCalledWith({
      snapshotId,
      algorithmVersion: 'durability-record-profile@2.0.0',
      createdBy: coachId,
    });
    expect(deps.loadLatestSnapshot).not.toHaveBeenCalled();
    expect(deps.persistAnalysis).not.toHaveBeenCalled();
  });

  it('returns 409 when server recalculation has insufficient coverage', async () => {
    const insufficientSnapshot = {
      ...snapshotRow,
      fresh_curve: { ...snapshotRow.fresh_curve, points: [point(10, 900, 'only-fresh')] },
      fatigued_curves: [{
        ...snapshotRow.fatigued_curves[0],
        points: [point(60, 380, 'only-fatigued')],
      }],
    };
    const deps = dependencies({
      loadSnapshot: vi.fn().mockResolvedValue(insufficientSnapshot),
      loadLatestSnapshot: vi.fn().mockResolvedValue(insufficientSnapshot),
      persistAnalysis: vi.fn(),
    });
    const response = await createDurabilityAnalysisHandler(deps)(postEvent({ snapshotId }));

    expect(response.statusCode).toBe(409);
    expect(deps.persistAnalysis).not.toHaveBeenCalled();
  });

  it('returns the existing immutable analysis for an identical confirmation', async () => {
    const deps = dependencies({ persistAnalysis: vi.fn().mockResolvedValue({ row: confirmedRow, created: false }) });
    const response = await createDurabilityAnalysisHandler(deps)(postEvent({ snapshotId }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).id).toBe(analysisId);
  });

  it('inserts idempotently and reloads an existing confirmation without updating it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([confirmedRow]), { status: 200 }));

    const result = await persistConfirmedDurabilityAnalysis(fetchImpl, {
      url: 'https://supabase.test',
      headers: { apikey: 'server-secret', Authorization: 'Bearer server-secret', 'Content-Type': 'application/json' },
    }, {
      athleteId,
      snapshotId,
      createdBy: coachId,
      algorithmVersion: 'durability-record-profile@2.0.0',
      comparisons: comparisonRows,
      quality: { coverage: 'high', warnings: [] },
    });

    expect(result).toEqual({ row: confirmedRow, created: false });
    const [insertUrl, insertInit] = fetchImpl.mock.calls[0];
    expect(insertUrl).toContain('on_conflict=snapshot_id%2Calgorithm_version%2Ccreated_by');
    expect(insertInit?.method).toBe('POST');
    expect(insertInit?.headers?.Prefer).toBe('resolution=ignore-duplicates,return=representation');
    expect(JSON.parse(String(insertInit?.body))).toEqual({
      athlete_id: athleteId,
      snapshot_id: snapshotId,
      created_by: coachId,
      algorithm_version: 'durability-record-profile@2.0.0',
      comparisons: comparisonRows,
      quality: { coverage: 'high', warnings: [] },
    });
    const [existingUrl, existingInit] = fetchImpl.mock.calls[1];
    expect(existingUrl).toContain(`snapshot_id=eq.${snapshotId}`);
    expect(existingUrl).toContain('algorithm_version=eq.durability-record-profile%402.0.0');
    expect(existingUrl).toContain(`created_by=eq.${coachId}`);
    expect(existingInit?.method).toBeUndefined();
  });
});
