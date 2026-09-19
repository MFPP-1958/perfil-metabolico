import { describe, expect, it, vi } from 'vitest';
import {
  createPowerAnalysisHandler,
  loadLatestPowerSnapshot,
  persistConfirmedPowerAnalysis,
} from '../../netlify/functions/power-analysis';

const athleteId = '8ca7cc82-02b0-47ca-84ca-253607a04b72';
const snapshotId = 'ab77d6b7-cbcf-49a4-920c-519f9e29e895';

const snapshotRow = {
  id: snapshotId,
  athlete_id: athleteId,
  created_by: '19e4a15f-64ed-4ee2-b1ed-57ab27e0660c',
  sport: 'Ride',
  environment: 'indoor',
  oldest: '2026-06-08',
  newest: '2026-09-05',
  points: [
    { seconds: 120, watts: 410 },
    { seconds: 300, watts: 340 },
    { seconds: 1_200, watts: 280 },
  ],
  source_models: [{
    type: 'ECP', cpWatts: 260, wPrimeKj: 18, pmaxWatts: 1_000, ftpWatts: 255, r2: 0.99,
  }],
  source_version: 'intervals-openapi-v1',
  content_hash: 'a'.repeat(64),
  synchronized_at: '2026-09-05T10:00:00.000Z',
};

const ftpRow = {
  value: 255,
  observed_at: '2026-09-05T09:00:00.000Z',
  quality: 'imported_estimate',
};

const invalidPowerQueries: Array<{ label: string; query: Record<string, string> }> = [
  { label: 'UUID externo', query: { athleteId: 'external-i123' } },
  { label: 'rango invertido', query: { oldest: '2026-09-06', newest: '2026-09-05' } },
  { label: 'fecha futura', query: { oldest: '2026-09-01', newest: '2026-09-06' } },
  { label: 'entorno desconocido', query: { environment: 'mixto' } },
  { label: 'propiedad inesperada', query: { extra: 'physiology' } },
];

function getEvent(query: Record<string, string> = {}) {
  return {
    httpMethod: 'GET',
    headers: { authorization: 'Bearer access-token' },
    queryStringParameters: {
      athleteId,
      oldest: '2026-06-08',
      newest: '2026-09-05',
      environment: 'indoor',
      ...query,
    },
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }),
    authorize: vi.fn().mockResolvedValue('coach'),
    loadLatestSnapshot: vi.fn().mockResolvedValue({ snapshot: snapshotRow, ftp: ftpRow }),
    loadSnapshot: vi.fn().mockResolvedValue(snapshotRow),
    persistAnalysis: vi.fn().mockResolvedValue({
      created: true,
      row: {
        id: '33dad9bf-8f42-4cff-8910-15c34ef24e6a',
        snapshot_id: snapshotId,
        model: 'ECP',
        algorithm_version: 'pd-ecp-2p@1.1.0',
        cp_watts: 273.0952380952381,
        w_prime_joules: 16857.142857142855,
        pmax_watts: null,
        rmse_watts: 7.715167498104586,
        quality: { complete: false, warnings: ['Falta un esfuerzo máximo de 15 s o menos.'] },
        confirmed_at: '2026-09-05T12:00:00.000Z',
      },
    }),
    now: vi.fn().mockReturnValue(new Date('2026-09-05T12:00:00.000Z')),
    ...overrides,
  };
}

describe('authorized power snapshot API', () => {
  it('returns 401 without a bearer token before database access', async () => {
    const deps = dependencies({ authenticate: vi.fn(), authorize: vi.fn(), loadLatestSnapshot: vi.fn() });
    const response = await createPowerAnalysisHandler(deps)({ ...getEvent(), headers: {} });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'Sesión necesaria o caducada.' });
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.loadLatestSnapshot).not.toHaveBeenCalled();
  });

  it('returns 403 before reading a cyclist outside the authenticated roster', async () => {
    const deps = dependencies({ authorize: vi.fn().mockResolvedValue(null), loadLatestSnapshot: vi.fn() });
    const response = await createPowerAnalysisHandler(deps)(getEvent());

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: 'Ciclista no autorizado.' });
    expect(deps.authorize).toHaveBeenCalledWith('coach-1', athleteId);
    expect(deps.loadLatestSnapshot).not.toHaveBeenCalled();
  });

  it.each(invalidPowerQueries)('returns 400 for an invalid $label query without reading snapshots', async ({ query }) => {
    const deps = dependencies({ authorize: vi.fn(), loadLatestSnapshot: vi.fn() });
    const response = await createPowerAnalysisHandler(deps)(getEvent(query));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: 'Consulta de potencia no válida.' });
    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.loadLatestSnapshot).not.toHaveBeenCalled();
  });

  it('returns only the newest exact-context snapshot and separately labelled imported FTP', async () => {
    const deps = dependencies();
    const response = await createPowerAnalysisHandler(deps)(getEvent());

    expect(response.statusCode).toBe(200);
    expect(deps.loadLatestSnapshot).toHaveBeenCalledWith({
      athleteId,
      oldest: '2026-06-08',
      newest: '2026-09-05',
      environment: 'indoor',
      window: 'fixed',
    });
    expect(JSON.parse(response.body)).toEqual({
      id: snapshotId,
      athleteId,
      oldest: '2026-06-08',
      newest: '2026-09-05',
      environment: 'indoor',
      points: snapshotRow.points,
      sourceModels: snapshotRow.source_models,
      synchronizedAt: '2026-09-05T10:00:00.000Z',
      ftp: { value: 255, observedAt: '2026-09-05T09:00:00.000Z', quality: 'imported_estimate' },
    });
    expect(response.body).not.toContain('created_by');
    expect(response.body).not.toContain('content_hash');
    expect(response.body).not.toContain('source_version');
  });

  it('queries the newest exact-context snapshot and the newest imported FTP observation', async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requests.push(String(input));
      return requests.length === 1
        ? new Response(JSON.stringify([snapshotRow]), { status: 200 })
        : new Response(JSON.stringify([ftpRow]), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await loadLatestPowerSnapshot(fetchImpl, {
      url: 'https://supabase.test',
      headers: { apikey: 'server-secret', Authorization: 'Bearer server-secret', 'Content-Type': 'application/json' },
    }, {
      athleteId,
      oldest: '2026-06-08',
      newest: '2026-09-05',
      environment: 'indoor',
      window: 'fixed',
    });

    expect(result).toEqual({ snapshot: snapshotRow, ftp: ftpRow });
    const snapshotUrl = new URL(requests[0]);
    expect(snapshotUrl.pathname).toBe('/rest/v1/power_curve_snapshots');
    expect(Object.fromEntries(snapshotUrl.searchParams)).toEqual({
      select: 'id,athlete_id,sport,environment,oldest,newest,points,source_models,synchronized_at',
      athlete_id: `eq.${athleteId}`,
      sport: 'eq.Ride',
      environment: 'eq.indoor',
      oldest: 'eq.2026-06-08',
      newest: 'eq.2026-09-05',
      order: 'synchronized_at.desc',
      limit: '1',
    });
    const ftpUrl = new URL(requests[1]);
    expect(ftpUrl.pathname).toBe('/rest/v1/observations');
    expect(Object.fromEntries(ftpUrl.searchParams)).toEqual({
      select: 'value,observed_at,quality',
      athlete_id: `eq.${athleteId}`,
      metric_code: 'eq.ftp',
      origin: 'eq.intervals_icu',
      quality: 'eq.imported_estimate',
      order: 'observed_at.desc',
      limit: '1',
    });
  });

  // El periodo «90 días» termina hoy, así que sus dos extremos avanzan cada día.
  // Con igualdad estricta la instantánea de anteayer dejaba de encontrarse y la
  // pantalla decía que no había curva teniendo uno guardada.
  it('con ventana deslizante recupera la instantánea de los mismos días tomada hace dos', async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requests.push(String(input));
      return requests.length === 1
        ? new Response(JSON.stringify([snapshotRow]), { status: 200 })
        : new Response(JSON.stringify([ftpRow]), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await loadLatestPowerSnapshot(fetchImpl, {
      url: 'https://supabase.test',
      headers: { apikey: 'server-secret', Authorization: 'Bearer server-secret', 'Content-Type': 'application/json' },
    }, {
      athleteId,
      oldest: '2026-06-10',
      newest: '2026-09-07',
      environment: 'indoor',
      window: 'rolling',
    });

    expect(result).toEqual({ snapshot: snapshotRow, ftp: ftpRow });
    const snapshotUrl = new URL(requests[0]);
    expect(Object.fromEntries(snapshotUrl.searchParams)).toEqual({
      select: 'id,athlete_id,sport,environment,oldest,newest,points,source_models,synchronized_at',
      athlete_id: `eq.${athleteId}`,
      sport: 'eq.Ride',
      environment: 'eq.indoor',
      newest: 'lte.2026-09-07',
      order: 'synchronized_at.desc',
      limit: '8',
    });
  });

  it('con ventana deslizante descarta una instantánea de otra duración', async () => {
    const treintaDias = { ...snapshotRow, oldest: '2026-08-07', newest: '2026-09-05' };
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify([treintaDias]),
      { status: 200 },
    )) as unknown as typeof fetch;

    const result = await loadLatestPowerSnapshot(fetchImpl, {
      url: 'https://supabase.test',
      headers: { apikey: 'server-secret', Authorization: 'Bearer server-secret', 'Content-Type': 'application/json' },
    }, {
      athleteId,
      oldest: '2026-06-10',
      newest: '2026-09-07',
      environment: 'indoor',
      window: 'rolling',
    });

    expect(result).toEqual({ snapshot: null, ftp: null });
  });

  it('con ventana deslizante descarta una instantánea demasiado vieja', async () => {
    const vieja = { ...snapshotRow, oldest: '2026-01-01', newest: '2026-03-31' };
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify([vieja]),
      { status: 200 },
    )) as unknown as typeof fetch;

    const result = await loadLatestPowerSnapshot(fetchImpl, {
      url: 'https://supabase.test',
      headers: { apikey: 'server-secret', Authorization: 'Bearer server-secret', 'Content-Type': 'application/json' },
    }, {
      athleteId,
      oldest: '2026-06-10',
      newest: '2026-09-07',
      environment: 'indoor',
      window: 'rolling',
    });

    expect(result).toEqual({ snapshot: null, ftp: null });
  });

  it('returns 404 when the exact period and environment have no snapshot', async () => {
    const deps = dependencies({ loadLatestSnapshot: vi.fn().mockResolvedValue({ snapshot: null, ftp: null }) });
    const response = await createPowerAnalysisHandler(deps)(getEvent());

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: 'No hay una curva sincronizada para este periodo y entorno.' });
  });

  it('rejects malformed database JSON instead of returning an unvalidated snapshot', async () => {
    const deps = dependencies({
      loadLatestSnapshot: vi.fn().mockResolvedValue({
        snapshot: { ...snapshotRow, points: [{ seconds: -1, watts: 400 }] },
        ftp: ftpRow,
      }),
    });
    const response = await createPowerAnalysisHandler(deps)(getEvent());

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: 'No se pudo cargar el análisis de potencia.' });
  });
});

function postEvent(body: unknown) {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer access-token' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

const displayedEcpResult = {
  cpWatts: 273.1,
  wPrimeJoules: 16_857.14,
  pmaxWatts: null,
  rmseWatts: 7.72,
};

describe('immutable power analysis confirmation', () => {
  it('reloads the snapshot and persists only the server recalculation', async () => {
    const deps = dependencies();
    const response = await createPowerAnalysisHandler(deps)(postEvent({
      snapshotId,
      model: 'ECP',
      result: displayedEcpResult,
    }));

    expect(response.statusCode).toBe(201);
    expect(deps.loadSnapshot).toHaveBeenCalledWith(snapshotId);
    expect(deps.authorize).toHaveBeenCalledWith('coach-1', athleteId);
    expect(deps.persistAnalysis).toHaveBeenCalledWith({
      athleteId,
      snapshotId,
      createdBy: 'coach-1',
      model: 'ECP',
      algorithmVersion: 'pd-ecp-2p@1.1.0',
      cpWatts: 273.0952380952381,
      wPrimeJoules: 16857.142857142855,
      pmaxWatts: null,
      rmseWatts: 7.715167498104586,
      quality: { complete: false, warnings: ['Falta un esfuerzo máximo de 15 s o menos.'] },
    });
    expect(JSON.parse(response.body)).toMatchObject({
      snapshotId,
      model: 'ECP',
      algorithmVersion: 'pd-ecp-2p@1.1.0',
      confirmedAt: '2026-09-05T12:00:00.000Z',
    });
    expect(response.body).not.toContain('athleteId');
    expect(response.body).not.toContain('createdBy');
  });

  it('recalculates and persists a complete Morton confirmation on the server', async () => {
    const mortonSnapshot = {
      ...snapshotRow,
      points: [
        { seconds: 5, watts: 960.5590802380133 },
        { seconds: 15, watts: 787.7739828644887 },
        { seconds: 60, watts: 517.001636646896 },
        { seconds: 300, watts: 341.65463729564175 },
        { seconds: 1200, watts: 296.33469658842506 },
      ],
    };
    const persistAnalysis = vi.fn().mockResolvedValue({
      created: true,
      row: {
        id: '43dad9bf-8f42-4cff-8910-15c34ef24e6b',
        snapshot_id: snapshotId,
        model: 'MORTON_3P',
        algorithm_version: 'pd-morton-3p@1.1.0',
        cp_watts: 280,
        w_prime_joules: 20000,
        pmax_watts: 1100.088800118559,
        rmse_watts: 0,
        quality: { complete: true, warnings: [] },
        confirmed_at: '2026-09-05T12:00:00.000Z',
      },
    });
    const deps = dependencies({ loadSnapshot: vi.fn().mockResolvedValue(mortonSnapshot), persistAnalysis });

    const response = await createPowerAnalysisHandler(deps)(postEvent({
      snapshotId,
      model: 'MORTON_3P',
      result: { cpWatts: 280, wPrimeJoules: 20000, pmaxWatts: 1100.09, rmseWatts: 0 },
    }));

    expect(response.statusCode).toBe(201);
    const stored = persistAnalysis.mock.calls[0][0];
    expect(stored.model).toBe('MORTON_3P');
    expect(stored.algorithmVersion).toBe('pd-morton-3p@1.1.0');
    expect(stored.cpWatts).toBeCloseTo(280, 6);
    expect(stored.wPrimeJoules).toBeCloseTo(20000, 3);
    expect(stored.pmaxWatts).toBeCloseTo(1100.0888, 3);
    expect(stored.rmseWatts).toBeCloseTo(0, 6);
    expect(stored.quality).toEqual({ complete: true, warnings: [] });
  });

  it('returns 409 without persistence when the displayed numbers differ from the server by more than 0.01', async () => {
    const deps = dependencies();
    const response = await createPowerAnalysisHandler(deps)(postEvent({
      snapshotId,
      model: 'ECP',
      result: { ...displayedEcpResult, cpWatts: 274 },
    }));

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Los resultados han cambiado. Recalcula el análisis antes de confirmarlo.',
    });
    expect(deps.persistAnalysis).not.toHaveBeenCalled();
  });

  it('rejects client attempts to choose identity or authoritative stored fields', async () => {
    const deps = dependencies();
    const response = await createPowerAnalysisHandler(deps)(postEvent({
      snapshotId,
      model: 'ECP',
      result: displayedEcpResult,
      athleteId,
      createdBy: 'another-user',
      algorithmVersion: 'untrusted-version',
    }));

    expect(response.statusCode).toBe(400);
    expect(deps.loadSnapshot).not.toHaveBeenCalled();
    expect(deps.persistAnalysis).not.toHaveBeenCalled();
  });

  it('returns 403 for a viewer and 404 for a missing snapshot', async () => {
    const viewer = dependencies({ authorize: vi.fn().mockResolvedValue('viewer') });
    const missing = dependencies({ loadSnapshot: vi.fn().mockResolvedValue(null), authorize: vi.fn() });
    const event = postEvent({ snapshotId, model: 'ECP', result: displayedEcpResult });

    const viewerResponse = await createPowerAnalysisHandler(viewer)(event);
    const missingResponse = await createPowerAnalysisHandler(missing)(event);

    expect(viewerResponse.statusCode).toBe(403);
    expect(JSON.parse(viewerResponse.body)).toEqual({ error: 'No tienes permiso para confirmar este análisis.' });
    expect(viewer.persistAnalysis).not.toHaveBeenCalled();
    expect(missingResponse.statusCode).toBe(404);
    expect(JSON.parse(missingResponse.body)).toEqual({ error: 'La instantánea de potencia ya no está disponible.' });
    expect(missing.authorize).not.toHaveBeenCalled();
  });

  it('returns an existing immutable row for an identical idempotency key', async () => {
    const existingRow = {
      id: '33dad9bf-8f42-4cff-8910-15c34ef24e6a',
      snapshot_id: snapshotId,
      model: 'ECP',
      algorithm_version: 'pd-ecp-2p@1.1.0',
      cp_watts: 273.0952380952381,
      w_prime_joules: 16857.142857142855,
      pmax_watts: null,
      rmse_watts: 7.715167498104586,
      quality: { complete: false, warnings: ['Falta un esfuerzo máximo de 15 s o menos.'] },
      confirmed_at: '2026-09-05T12:00:00.000Z',
    };
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return requests.length === 1
        ? new Response('[]', { status: 201, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify([existingRow]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;

    const result = await persistConfirmedPowerAnalysis(fetchImpl, {
      url: 'https://supabase.test',
      headers: { apikey: 'server-secret', Authorization: 'Bearer server-secret', 'Content-Type': 'application/json' },
    }, {
      athleteId,
      snapshotId,
      createdBy: '19e4a15f-64ed-4ee2-b1ed-57ab27e0660c',
      model: 'ECP',
      algorithmVersion: 'pd-ecp-2p@1.1.0',
      cpWatts: 273.0952380952381,
      wPrimeJoules: 16857.142857142855,
      pmaxWatts: null,
      rmseWatts: 7.715167498104586,
      quality: { complete: false, warnings: ['Falta un esfuerzo máximo de 15 s o menos.'] },
    });

    expect(result).toEqual({ created: false, row: existingRow });
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe('https://supabase.test/rest/v1/power_analysis_runs?on_conflict=snapshot_id,model,algorithm_version,created_by');
    expect(new Headers(requests[0].init?.headers).get('Prefer')).toBe('resolution=ignore-duplicates,return=representation');
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({
      athlete_id: athleteId,
      snapshot_id: snapshotId,
      created_by: '19e4a15f-64ed-4ee2-b1ed-57ab27e0660c',
      cp_watts: 273.0952380952381,
    });
    expect(requests[1].url).toContain('snapshot_id=eq.');
    expect(requests[1].url).toContain('algorithm_version=eq.pd-ecp-2p%401.1.0');
  });
});
