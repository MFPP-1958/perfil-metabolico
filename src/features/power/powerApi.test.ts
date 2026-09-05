import { describe, expect, it, vi } from 'vitest';
import { createPowerApi } from './powerApi';

const athleteId = '8ca7cc82-02b0-47ca-84ca-253607a04b72';
const snapshotId = 'ab77d6b7-cbcf-49a4-920c-519f9e29e895';

const snapshot = {
  id: snapshotId,
  athleteId,
  oldest: '2026-06-08',
  newest: '2026-09-05',
  environment: 'indoor',
  points: [{ seconds: 120, watts: 410 }, { seconds: 300, watts: 340 }],
  sourceModels: [{
    type: 'ECP', cpWatts: 260, wPrimeKj: 18, pmaxWatts: 1_000, ftpWatts: 255, r2: 0.99,
  }],
  synchronizedAt: '2026-09-05T10:00:00.000Z',
  ftp: { value: 255, observedAt: '2026-09-05T09:00:00.000Z', quality: 'imported_estimate' },
};

const confirmation = {
  id: '33dad9bf-8f42-4cff-8910-15c34ef24e6a',
  snapshotId,
  model: 'ECP',
  algorithmVersion: 'pd-ecp-2p@1.0.0',
  cpWatts: 273.095,
  wPrimeJoules: 16_857.143,
  pmaxWatts: null,
  rmseWatts: 7.715,
  quality: { complete: false, warnings: ['Falta un esfuerzo máximo de 15 s o menos.'] },
  confirmedAt: '2026-09-05T12:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('power analysis browser API', () => {
  it('loads with a bearer token and AbortSignal using only non-physiological query fields', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(snapshot));
    const api = createPowerApi({ getToken: vi.fn().mockResolvedValue('access-token'), fetchImpl });

    const result = await api.load({
      athleteId,
      oldest: '2026-06-08',
      newest: '2026-09-05',
      environment: 'indoor',
    }, controller.signal);

    expect(result).toEqual(snapshot);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`/.netlify/functions/power-analysis?athleteId=${athleteId}&oldest=2026-06-08&newest=2026-09-05&environment=indoor`);
    expect(init).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer access-token' },
      signal: controller.signal,
    });
    expect(url).not.toMatch(/watts|ftp|cp|wPrime|pmax|rmse|name|intervals/i);
  });

  it('confirms with JSON and returns the immutable server result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(confirmation, 201));
    const api = createPowerApi({ getToken: vi.fn().mockResolvedValue('access-token'), fetchImpl });
    const input = {
      snapshotId,
      model: 'ECP' as const,
      result: { cpWatts: 273.1, wPrimeJoules: 16_857.14, pmaxWatts: null, rmseWatts: 7.72 },
    };

    expect(await api.confirm(input)).toEqual(confirmation);
    expect(fetchImpl).toHaveBeenCalledWith('/.netlify/functions/power-analysis', {
      method: 'POST',
      headers: { Authorization: 'Bearer access-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  });

  it.each([
    [401, 'La sesión ha caducado. Inicia sesión de nuevo.'],
    [403, 'No tienes permiso para acceder a este análisis.'],
    [404, 'No hay una curva sincronizada para el periodo y entorno seleccionados.'],
    [409, 'El análisis está desactualizado. Recalcula los resultados antes de confirmarlo.'],
  ])('maps HTTP %s to a specific Spanish error', async (status, message) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'internal wording' }, status));
    const api = createPowerApi({ getToken: vi.fn().mockResolvedValue('access-token'), fetchImpl });

    await expect(api.load({
      athleteId,
      oldest: '2026-06-08',
      newest: '2026-09-05',
      environment: 'all',
    }, new AbortController().signal)).rejects.toThrow(message);
  });

  it('rejects a malformed successful response instead of trusting it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ...snapshot, athleteId: 'i123' }));
    const api = createPowerApi({ getToken: vi.fn().mockResolvedValue('access-token'), fetchImpl });

    await expect(api.load({
      athleteId,
      oldest: '2026-06-08',
      newest: '2026-09-05',
      environment: 'all',
    }, new AbortController().signal)).rejects.toThrow('La respuesta de potencia no es válida.');
  });
});
