import { describe, expect, it, vi } from 'vitest';

import { createHandler } from '../../netlify/functions/intervals.js';

function event(query = {}, overrides = {}) {
  return {
    httpMethod: 'GET',
    headers: { authorization: 'Bearer valid-token' },
    queryStringParameters: query,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  return {
    authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }),
    listAuthorizedAthleteIds: vi.fn().mockResolvedValue(new Set(['i123'])),
    fetchIntervals: vi.fn().mockResolvedValue({
      status: 200,
      body: JSON.stringify({ id: 'i123', name: 'Ciclista' }),
    }),
    ...overrides,
  };
}

describe('Intervals gateway', () => {
  it('rejects anonymous requests', async () => {
    const handler = createHandler(dependencies());
    const response = await handler(event({ operation: 'athletes' }, { headers: {} }));
    expect(response.statusCode).toBe(401);
  });

  it('rejects non-GET methods', async () => {
    const handler = createHandler(dependencies());
    const response = await handler(event({ operation: 'athletes' }, { httpMethod: 'POST' }));
    expect(response.statusCode).toBe(405);
  });

  it('rejects arbitrary upstream paths', async () => {
    const handler = createHandler(dependencies());
    const response = await handler(event({ operation: 'raw', path: '/athletes' }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects unsupported query keys', async () => {
    const handler = createHandler(dependencies());
    const response = await handler(
      event({ operation: 'activities', athleteId: 'i123', oldest: '2026-01-01', unexpected: '1' }),
    );
    expect(response.statusCode).toBe(400);
  });

  it('rejects athletes outside the authenticated coach roster', async () => {
    const handler = createHandler(dependencies());
    const response = await handler(event({ operation: 'athlete', athleteId: 'i999' }));
    expect(response.statusCode).toBe(403);
  });

  it('filters the athlete list to the authenticated coach roster', async () => {
    const deps = dependencies({
      fetchIntervals: vi.fn().mockResolvedValue({
        status: 200,
        body: JSON.stringify([
          { id: 'i123', name: 'Autorizado' },
          { id: 'i999', name: 'No autorizado' },
        ]),
      }),
    });
    const handler = createHandler(deps);
    const response = await handler(event({ operation: 'athletes' }));
    expect(JSON.parse(response.body)).toEqual([{ id: 'i123', name: 'Autorizado' }]);
  });

  it('never returns sensitive athlete or wellness fields', async () => {
    const deps = dependencies({
      fetchIntervals: vi.fn().mockResolvedValue({
        status: 200,
        body: JSON.stringify({
          id: 'i123',
          name: 'Ciclista',
          email: 'private@example.com',
          icu_api_key: 'secret',
          nested: { whoop_scope: 'private', safe: true },
          wellness: { menstrual_phase: 'private', resting_hr: 44 },
        }),
      }),
    });
    const handler = createHandler(deps);
    const response = await handler(event({ operation: 'athlete', athleteId: 'i123' }));
    expect(response.body).not.toContain('private@example.com');
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('menstrual_phase');
    expect(JSON.parse(response.body)).toEqual({
      id: 'i123',
      name: 'Ciclista',
      nested: { safe: true },
      wellness: { resting_hr: 44 },
    });
  });
});
