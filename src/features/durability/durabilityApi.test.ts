import { describe, expect, it, vi } from 'vitest';
import { createDurabilityApi } from './durabilityApi';

const athleteId = '21000000-0000-4000-8000-000000000001';
const snapshotId = '31000000-0000-4000-8000-000000000001';

const observedLevel = {
  afterKj: 700,
  afterKjPerKg: 10,
  fatiguedWatts: 810,
  declinePercent: 10,
  quality: 'observed',
  supportingActivityCount: 2,
  supportingEffortCount: 3,
  powerSource: 'measured',
} as const;

const rows = ([10, 60, 300, 1_200] as const).map((seconds) => ({
  seconds,
  freshWatts: seconds === 10 ? 900 : 300,
  levels: { kj0: observedLevel },
  onsetAfterKj: 700,
  onsetAfterKjPerKg: 10,
}));

const snapshotResponse = {
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
    rows,
    coverage: 'high',
    warnings: [],
  },
} as const;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DurabilityApi', () => {
  it('requests the exact active context with bearer auth and the supplied signal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(snapshotResponse));
    const api = createDurabilityApi({ getToken: async () => 'token', fetchImpl });
    const signal = new AbortController().signal;

    await api.load({
      athleteId,
      oldest: '2026-06-16',
      newest: '2026-09-14',
      environment: 'all',
    }, signal);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [requestUrl, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl, 'https://mfpp.test');
    expect(url.pathname).toBe('/.netlify/functions/durability-analysis');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      athleteId,
      oldest: '2026-06-16',
      newest: '2026-09-14',
      environment: 'all',
    });
    expect(init).toEqual({ method: 'GET', headers: { Authorization: 'Bearer token' }, signal });
  });

  it('confirms with snapshotId only and validates the immutable server record', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      id: '41000000-0000-4000-8000-000000000001',
      snapshotId,
      algorithmVersion: 'durability-record-profile@2.0.0',
      comparisons: rows,
      quality: { coverage: 'high', warnings: [] },
      confirmedAt: '2026-09-14T10:30:00.000Z',
    }, 201));
    const api = createDurabilityApi({ getToken: async () => 'token', fetchImpl });

    const confirmed = await api.confirm({ snapshotId });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/.netlify/functions/durability-analysis');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer token', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ snapshotId });
    expect(confirmed.confirmedAt).toBe('2026-09-14T10:30:00.000Z');
  });

  it.each([
    [401, 'La sesión ha caducado. Inicia sesión de nuevo.'],
    [403, 'No tienes permiso para acceder a este análisis.'],
    [404, 'No hay un análisis de Durabilidad sincronizado para el periodo y entorno seleccionados.'],
    [409, 'El análisis ha quedado desactualizado. Vuelve a cargarlo antes de confirmar.'],
  ])('maps status %i to a safe Spanish message', async (status, message) => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ error: 'remote detail' }, status));
    const api = createDurabilityApi({ getToken: async () => 'token', fetchImpl });

    await expect(api.load({
      athleteId,
      oldest: '2026-06-16',
      newest: '2026-09-14',
      environment: 'all',
    }, new AbortController().signal)).rejects.toThrow(message);
  });

  it('rejects malformed successful JSON without exposing its remote contents', async () => {
    const secret = 'external-private-id';
    const fetchImpl = vi.fn().mockResolvedValue(response({ ...snapshotResponse, privateId: secret }));
    const api = createDurabilityApi({ getToken: async () => 'token', fetchImpl });

    const operation = api.load({
      athleteId,
      oldest: '2026-06-16',
      newest: '2026-09-14',
      environment: 'all',
    }, new AbortController().signal);

    await expect(operation).rejects.toThrow('La respuesta de Durabilidad no es válida.');
    await expect(operation).rejects.not.toThrow(secret);
  });
});
