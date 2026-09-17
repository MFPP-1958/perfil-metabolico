import { describe, expect, it, vi } from 'vitest';
import type { MaderInputs } from '../../src/physiology/mader/model';
import { buildMetabolicScenario } from '../../src/physiology/scenarios/scenario';
import {
  createMetabolicScenarioHandler,
  listMetabolicScenarios,
  persistMetabolicScenario,
  type PersistScenarioInput,
} from './metabolic-scenarios';

const athleteId = '8ca7cc82-02b0-47ca-84ca-253607a04b72';
const coachId = '19e4a15f-64ed-4ee2-b1ed-57ab27e0660c';

const validRealInputs: MaderInputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
  vlamax: { value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'o-vla' },
  bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
  pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
  comparison: { ftpWatts: 295 },
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    athleteId,
    scenarioName: 'Más techo glucolítico',
    rationale: 'Sube la VLa máx para el esprint final.',
    eventProfile: 'explosiva',
    realInputs: validRealInputs,
    targets: { vlamax: 0.8 },
    referencePowerWatts: 250,
    config: { restingVo2: 5 },
    ...overrides,
  };
}

function rawRowFromInput(input: PersistScenarioInput, overrides: Record<string, unknown> = {}) {
  return {
    id: '33dad9bf-8f42-4cff-8910-15c34ef24e6a',
    athlete_id: input.athleteId,
    created_by: input.createdBy,
    scenario_name: input.scenarioName,
    rationale: input.rationale,
    event_profile: input.eventProfile,
    real_inputs: input.realInputs,
    targets: input.targets,
    reference_power_watts: input.referencePowerWatts,
    config: input.config,
    model_versions: input.modelVersions,
    outcome: input.outcome,
    content_hash: input.contentHash,
    created_at: '2026-09-17T12:00:00.000Z',
    ...overrides,
  };
}

function getEvent(query: Record<string, string> = {}) {
  return {
    httpMethod: 'GET',
    headers: { authorization: 'Bearer access-token' },
    queryStringParameters: { athleteId, ...query },
  };
}

function postEvent(body: unknown) {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer access-token' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    authenticate: vi.fn().mockResolvedValue({ id: coachId }),
    authorize: vi.fn().mockResolvedValue('coach'),
    listScenarios: vi.fn().mockResolvedValue([]),
    persistScenario: vi.fn(async (input: PersistScenarioInput) => ({
      created: true,
      row: rawRowFromInput(input),
    })),
    ...overrides,
  };
}

describe('metabolic scenario authorization', () => {
  it('returns 401 without a bearer token before touching the database', async () => {
    const deps = dependencies({ authenticate: vi.fn(), authorize: vi.fn(), persistScenario: vi.fn() });
    const response = await createMetabolicScenarioHandler(deps)({ ...postEvent(validBody()), headers: {} });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'Sesión necesaria o caducada.' });
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(deps.persistScenario).not.toHaveBeenCalled();
  });

  it('returns 401 when the token does not resolve to a user', async () => {
    const deps = dependencies({ authenticate: vi.fn().mockResolvedValue(null) });
    const response = await createMetabolicScenarioHandler(deps)(postEvent(validBody()));

    expect(response.statusCode).toBe(401);
    expect(deps.persistScenario).not.toHaveBeenCalled();
  });

  it('returns 403 on POST for a cyclist the coach cannot reach, without saving anything', async () => {
    const deps = dependencies({ authorize: vi.fn().mockResolvedValue(null) });
    const response = await createMetabolicScenarioHandler(deps)(postEvent(validBody()));

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: 'No tienes permiso para guardar escenarios de este ciclista.' });
    expect(deps.authorize).toHaveBeenCalledWith(coachId, athleteId);
    expect(deps.persistScenario).not.toHaveBeenCalled();
  });

  it('returns 403 on POST for a viewer, since only a coach proposes a scenario', async () => {
    const deps = dependencies({ authorize: vi.fn().mockResolvedValue('viewer') });
    const response = await createMetabolicScenarioHandler(deps)(postEvent(validBody()));

    expect(response.statusCode).toBe(403);
    expect(deps.persistScenario).not.toHaveBeenCalled();
  });

  it('returns 403 on GET for a cyclist the coach cannot reach', async () => {
    const deps = dependencies({ authorize: vi.fn().mockResolvedValue(null) });
    const response = await createMetabolicScenarioHandler(deps)(getEvent());

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: 'Ciclista no autorizado.' });
    expect(deps.listScenarios).not.toHaveBeenCalled();
  });

  it('allows a viewer to list, unlike saving', async () => {
    const deps = dependencies({ authorize: vi.fn().mockResolvedValue('viewer') });
    const response = await createMetabolicScenarioHandler(deps)(getEvent());

    expect(response.statusCode).toBe(200);
    expect(deps.listScenarios).toHaveBeenCalledWith(athleteId);
  });
});

const invalidVlamaxCases: Array<{ label: string; vlamax: unknown }> = [
  { label: 'ausente', vlamax: undefined },
  { label: 'cero', vlamax: 0 },
  { label: 'negativo', vlamax: -0.4 },
  // JSON no puede transportar Infinity: JSON.stringify lo convierte en null,
  // y ese null debe rechazarse igual que cualquier otro valor no numérico.
  { label: 'no finito', vlamax: Number.POSITIVE_INFINITY },
];

describe('validación del cuerpo con Zod', () => {
  it.each(invalidVlamaxCases)('returns 400 when targets.vlamax is $label', async ({ vlamax }) => {
    const deps = dependencies();
    const response = await createMetabolicScenarioHandler(deps)(postEvent(validBody({ targets: { vlamax } })));

    expect(response.statusCode).toBe(400);
    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.persistScenario).not.toHaveBeenCalled();
  });

  it('rejects a body carrying an extra outcome field instead of trusting it', async () => {
    const deps = dependencies();
    const response = await createMetabolicScenarioHandler(deps)(postEvent({
      ...validBody(),
      outcome: { status: 'calculated', fabricated: true },
    }));

    expect(response.statusCode).toBe(400);
    expect(deps.persistScenario).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const deps = dependencies();
    const response = await createMetabolicScenarioHandler(deps)(postEvent('{not valid json'));

    expect(response.statusCode).toBe(400);
    expect(deps.persistScenario).not.toHaveBeenCalled();
  });
});

describe('la guarda de Mader bloquea entradas reales insuficientes', () => {
  it('returns 400 when a real input fails the provenance guard, without persisting', async () => {
    const deps = dependencies();
    const body = validBody({
      realInputs: {
        ...validRealInputs,
        vo2max: { ...validRealInputs.vo2max, quality: 'imported_estimate' },
      },
    });
    const response = await createMetabolicScenarioHandler(deps)(postEvent(body));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/VO₂max/);
    expect(deps.persistScenario).not.toHaveBeenCalled();
  });
});

describe('el servidor recalcula y nunca confía en el cliente', () => {
  it('persists the server-recomputed outcome, matching buildMetabolicScenario', async () => {
    const deps = dependencies();
    const response = await createMetabolicScenarioHandler(deps)(postEvent(validBody()));

    expect(response.statusCode).toBe(201);
    expect(deps.persistScenario).toHaveBeenCalledTimes(1);
    const stored = (deps.persistScenario as ReturnType<typeof vi.fn>).mock.calls[0][0] as PersistScenarioInput;

    const expectedOutcome = buildMetabolicScenario(
      validRealInputs,
      { restingVo2: 5, referencePowerWatts: 250 },
      { vlamax: 0.8 },
    );
    expect(stored.outcome).toEqual(expectedOutcome);
    expect(stored.createdBy).toBe(coachId);
  });

  it('computes the same content hash for two identical requests', async () => {
    const deps = dependencies();
    const handler = createMetabolicScenarioHandler(deps);

    await handler(postEvent(validBody()));
    await handler(postEvent(JSON.parse(JSON.stringify(validBody()))));

    const calls = (deps.persistScenario as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].contentHash).toBe(calls[1][0].contentHash);
    expect(calls[0][0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('ningún valor objetivo llega a observations ni a derived_results', () => {
  it('the default persistence implementation only ever calls the metabolic_scenarios table', async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requests.push(new URL(String(input)).pathname);
      return new Response(JSON.stringify([{ id: 'row-1' }]), { status: 201 });
    }) as unknown as typeof fetch;

    await persistMetabolicScenario(fetchImpl, {
      url: 'https://supabase.test',
      headers: { apikey: 'server-secret', Authorization: 'Bearer server-secret', 'Content-Type': 'application/json' },
    }, {
      athleteId,
      createdBy: coachId,
      scenarioName: 'Más techo glucolítico',
      rationale: 'Sube la VLa máx para el esprint final.',
      eventProfile: 'explosiva',
      realInputs: validRealInputs,
      targets: { vlamax: 0.8 },
      referencePowerWatts: 250,
      config: { restingVo2: 5 },
      modelVersions: { mader: 'mader-reproduction@1.0.0', scenario: 'metabolic-scenario@1.0.0' },
      outcome: { status: 'blocked', reasons: ['x'], version: 'metabolic-scenario@1.0.0' } as PersistScenarioInput['outcome'],
      contentHash: 'a'.repeat(64),
    });

    expect(new Set(requests)).toEqual(new Set(['/rest/v1/metabolic_scenarios']));
  });

  it('an identical content hash does not create a second row', async () => {
    const store = new Map<string, Record<string, unknown>>();
    let nextId = 1;
    const service = {
      url: 'https://supabase.test',
      headers: { apikey: 'server-secret', Authorization: 'Bearer server-secret', 'Content-Type': 'application/json' },
    };
    const input: PersistScenarioInput = {
      athleteId,
      createdBy: coachId,
      scenarioName: 'Más techo glucolítico',
      rationale: 'Sube la VLa máx para el esprint final.',
      eventProfile: 'explosiva',
      realInputs: validRealInputs,
      targets: { vlamax: 0.8 },
      referencePowerWatts: 250,
      config: { restingVo2: 5 },
      modelVersions: { mader: 'mader-reproduction@1.0.0', scenario: 'metabolic-scenario@1.0.0' },
      outcome: { status: 'blocked', reasons: ['x'], version: 'metabolic-scenario@1.0.0' } as PersistScenarioInput['outcome'],
      contentHash: 'stable-hash-value',
    };
    const key = `${input.athleteId}:${input.contentHash}`;

    const fetchImpl = vi.fn(async (requestInput: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(requestInput));
      if (init?.method === 'POST') {
        if (store.has(key)) return new Response('[]', { status: 201 });
        const row = { id: `row-${nextId}`, content_hash: input.contentHash };
        nextId += 1;
        store.set(key, row);
        return new Response(JSON.stringify([row]), { status: 201 });
      }
      const contentHash = url.searchParams.get('content_hash')?.replace('eq.', '');
      const row = [...store.values()].find((candidate) => candidate.content_hash === contentHash);
      return new Response(JSON.stringify(row ? [row] : []), { status: 200 });
    }) as unknown as typeof fetch;

    const first = await persistMetabolicScenario(fetchImpl, service, input);
    const second = await persistMetabolicScenario(fetchImpl, service, input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.row).toEqual(first.row);
    expect(store.size).toBe(1);
  });
});

describe('la respuesta nunca incluye claves ni correos', () => {
  it('drops unexpected columns such as api keys or e-mails from the persistence layer', async () => {
    const deps = dependencies({
      persistScenario: vi.fn(async (input: PersistScenarioInput) => ({
        created: true,
        row: rawRowFromInput(input, { api_key: 'sk_live_should_never_leak', athlete_email: 'athlete@example.com' }),
      })),
    });
    const response = await createMetabolicScenarioHandler(deps)(postEvent(validBody()));

    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain('api_key');
    expect(response.body).not.toContain('sk_live');
    expect(response.body).not.toContain('athlete_email');
    expect(response.body).not.toMatch(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-zA-Z]{2,}/);
  });

  it('drops unexpected columns from the list response too', async () => {
    const deps = dependencies({
      listScenarios: vi.fn().mockResolvedValue([
        rawRowFromInput({
          athleteId,
          createdBy: coachId,
          scenarioName: 'Más techo glucolítico',
          rationale: 'Sube la VLa máx para el esprint final.',
          eventProfile: 'explosiva',
          realInputs: validRealInputs,
          targets: { vlamax: 0.8 },
          referencePowerWatts: 250,
          config: { restingVo2: 5 },
          modelVersions: { mader: 'mader-reproduction@1.0.0', scenario: 'metabolic-scenario@1.0.0' },
          outcome: { status: 'blocked', reasons: ['x'], version: 'metabolic-scenario@1.0.0' } as PersistScenarioInput['outcome'],
          contentHash: 'a'.repeat(64),
        }, { api_key: 'sk_live_should_never_leak', athlete_email: 'athlete@example.com' }),
      ]),
    });
    const response = await createMetabolicScenarioHandler(deps)(getEvent());

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('api_key');
    expect(response.body).not.toContain('athlete_email');
    expect(response.body).not.toMatch(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-zA-Z]{2,}/);
  });
});

describe('listMetabolicScenarios', () => {
  it('orders by created_at descending and selects only known columns', async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requests.push(String(input));
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;

    await listMetabolicScenarios(fetchImpl, {
      url: 'https://supabase.test',
      headers: { apikey: 'server-secret', Authorization: 'Bearer server-secret', 'Content-Type': 'application/json' },
    }, athleteId);

    const url = new URL(requests[0]);
    expect(url.pathname).toBe('/rest/v1/metabolic_scenarios');
    expect(url.searchParams.get('order')).toBe('created_at.desc');
    expect(url.searchParams.get('athlete_id')).toBe(`eq.${athleteId}`);
    expect(url.searchParams.get('select')).not.toBeNull();
  });
});
