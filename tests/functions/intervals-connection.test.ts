import { describe, expect, it, vi } from 'vitest';
import { createIntervalsConnectionHandler } from '../../netlify/functions/intervals-connection';

const roster = [
  { id: 'i123', name: 'Ana Ciclista', email: 'private@example.com' },
  { id: 'i456', name: 'Luis Ciclista', icu_api_key: 'never-return' },
];

function request(method = 'GET', body?: unknown) {
  return {
    httpMethod: method,
    headers: { authorization: 'Bearer valid-token' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function dependencies(overrides = {}) {
  return {
    authenticate: vi.fn().mockResolvedValue({ id: 'coach-owner' }),
    ownerId: vi.fn().mockReturnValue('coach-owner'),
    loadRoster: vi.fn().mockResolvedValue(roster),
    persist: vi.fn().mockResolvedValue({ added: 1, existing: 0, failed: [] }),
    ...overrides,
  };
}

describe('Intervals connection', () => {
  it('rejects a request without a Supabase session', async () => {
    const deps = dependencies({ authenticate: vi.fn().mockResolvedValue(null) });
    const response = await createIntervalsConnectionHandler(deps)({ ...request(), headers: {} });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an authenticated user who is not the configured owner', async () => {
    const deps = dependencies({ authenticate: vi.fn().mockResolvedValue({ id: 'other-coach' }) });
    const response = await createIntervalsConnectionHandler(deps)(request());
    expect(response.statusCode).toBe(403);
    expect(deps.loadRoster).not.toHaveBeenCalled();
  });

  it('returns only safe roster summaries to the owner', async () => {
    const response = await createIntervalsConnectionHandler(dependencies())(request());
    expect(JSON.parse(response.body)).toEqual({ athletes: [
      { id: 'i123', name: 'Ana Ciclista' },
      { id: 'i456', name: 'Luis Ciclista' },
    ] });
    expect(response.body).not.toContain('private@example.com');
    expect(response.body).not.toContain('never-return');
  });

  it.each([
    ['malformed JSON', '{'],
    ['empty selection', JSON.stringify({ athleteIds: [] })],
    ['duplicate identifiers', JSON.stringify({ athleteIds: ['i123', 'i123'] })],
    ['invalid identifiers', JSON.stringify({ athleteIds: ['123'] })],
    ['too many identifiers', JSON.stringify({ athleteIds: Array.from({ length: 101 }, (_, index) => `i${index + 1}`) })],
  ])('rejects %s', async (_label, body) => {
    const deps = dependencies();
    const response = await createIntervalsConnectionHandler(deps)({ ...request('POST'), body });
    expect(response.statusCode).toBe(400);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('rejects a selection containing athletes outside the fresh roster', async () => {
    const deps = dependencies();
    const response = await createIntervalsConnectionHandler(deps)(request('POST', { athleteIds: ['i999'] }));
    expect(response.statusCode).toBe(400);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('persists only a unique valid explicit selection', async () => {
    const deps = dependencies();
    const response = await createIntervalsConnectionHandler(deps)(request('POST', { athleteIds: ['i456'] }));
    expect(response.statusCode).toBe(200);
    expect(deps.persist).toHaveBeenCalledWith('coach-owner', [
      { id: 'i123', name: 'Ana Ciclista' },
      { id: 'i456', name: 'Luis Ciclista' },
    ], ['i456']);
  });
});
