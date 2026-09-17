import { describe, expect, it, vi } from 'vitest';
import type { MaderInputs } from '../../physiology/mader/model';
import { createScenarioApi } from './scenarioApi';

const athleteId = '8ca7cc82-02b0-47ca-84ca-253607a04b72';
const coachId = '19e4a15f-64ed-4ee2-b1ed-57ab27e0660c';

const realInputs: MaderInputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
  vlamax: { value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'o-vla' },
  bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
  pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
  comparison: { ftpWatts: 295 },
};

const savedScenario = {
  id: '33dad9bf-8f42-4cff-8910-15c34ef24e6a',
  athleteId,
  createdBy: coachId,
  scenarioName: 'Más techo glucolítico',
  rationale: 'Sube la VLa máx para el esprint final.',
  eventProfile: 'explosiva' as const,
  realInputs,
  targets: { vlamax: 0.8 },
  referencePowerWatts: 250,
  config: { restingVo2: 5 },
  modelVersions: { mader: 'mader-reproduction@1.0.0', scenario: 'metabolic-scenario@1.0.0' },
  outcome: {
    status: 'blocked' as const,
    reasons: ['La VLa máx objetivo debe ser un número positivo.'],
    version: 'metabolic-scenario@1.0.0',
  },
  contentHash: 'a'.repeat(64),
  createdAt: '2026-09-17T10:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('metabolic scenario browser API', () => {
  it('lists with a bearer token, AbortSignal, and only the athleteId query field', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([savedScenario]));
    const api = createScenarioApi({ getToken: vi.fn().mockResolvedValue('access-token'), fetchImpl });

    const result = await api.list(athleteId, controller.signal);

    expect(result).toEqual([savedScenario]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`/.netlify/functions/metabolic-scenarios?athleteId=${athleteId}`);
    expect(init).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer access-token' },
      signal: controller.signal,
    });
  });

  it('saves with JSON and returns the server-recalculated scenario', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(savedScenario, 201));
    const api = createScenarioApi({ getToken: vi.fn().mockResolvedValue('access-token'), fetchImpl });
    const input = {
      athleteId,
      scenarioName: savedScenario.scenarioName,
      rationale: savedScenario.rationale,
      eventProfile: savedScenario.eventProfile,
      realInputs,
      targets: savedScenario.targets,
      referencePowerWatts: savedScenario.referencePowerWatts,
      config: savedScenario.config,
    };

    expect(await api.save(input)).toEqual(savedScenario);
    expect(fetchImpl).toHaveBeenCalledWith('/.netlify/functions/metabolic-scenarios', {
      method: 'POST',
      headers: { Authorization: 'Bearer access-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  });

  it('maps a 403 to a specific Spanish message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'internal wording' }, 403));
    const api = createScenarioApi({ getToken: vi.fn().mockResolvedValue('access-token'), fetchImpl });

    await expect(api.list(athleteId, new AbortController().signal))
      .rejects.toThrow('No tienes permiso para acceder a los escenarios de este ciclista.');
  });

  it('maps a 401 to a specific Spanish message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'internal wording' }, 401));
    const api = createScenarioApi({ getToken: vi.fn().mockResolvedValue('access-token'), fetchImpl });

    await expect(api.list(athleteId, new AbortController().signal))
      .rejects.toThrow('La sesión ha caducado. Inicia sesión de nuevo.');
  });

  it('rejects a malformed successful response instead of trusting it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ ...savedScenario, athleteId: 'i123' }]));
    const api = createScenarioApi({ getToken: vi.fn().mockResolvedValue('access-token'), fetchImpl });

    await expect(api.list(athleteId, new AbortController().signal))
      .rejects.toThrow('La respuesta de escenarios no es válida.');
  });

  it('falls back to the server error message for an unmapped status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'La guarda de Mader bloqueó el cálculo.' }, 400));
    const api = createScenarioApi({ getToken: vi.fn().mockResolvedValue('access-token'), fetchImpl });

    await expect(api.save({
      athleteId,
      scenarioName: 'x',
      rationale: 'y',
      eventProfile: 'rodador',
      realInputs,
      targets: { vlamax: 0.8 },
      referencePowerWatts: 250,
      config: { restingVo2: 5 },
    })).rejects.toThrow('La guarda de Mader bloqueó el cálculo.');
  });
});
