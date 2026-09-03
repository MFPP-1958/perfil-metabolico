import { describe, expect, it, vi } from 'vitest';
import { createSyncHandler } from '../../netlify/functions/sync-athlete';

function event(athleteId = 'i123', syncKey = 'sync-2') {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer token' },
    queryStringParameters: { athleteId, syncKey },
  };
}

function dependencies(overrides = {}) {
  return {
    authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }),
    authorize: vi.fn().mockResolvedValue(true),
    isLatestSync: vi.fn().mockResolvedValue(true),
    load: vi.fn().mockResolvedValue({
      athlete: { id: 'i123' }, activities: [], powerCurves: { list: [] }, plannedWorkouts: [], warnings: [],
    }),
    persist: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('athlete synchronization', () => {
  it('rejects a cyclist outside the coach roster', async () => {
    const handler = createSyncHandler(dependencies({ authorize: vi.fn().mockResolvedValue(false) }));
    expect((await handler(event())).statusCode).toBe(403);
  });

  it('reports partial upstream failures without discarding usable data', async () => {
    const deps = dependencies({
      load: vi.fn().mockResolvedValue({
        athlete: { id: 'i123' }, activities: [], powerCurves: null, plannedWorkouts: [], warnings: ['power_curves'],
      }),
    });
    const response = await createSyncHandler(deps)(event());
    expect(response.statusCode).toBe(207);
    expect(JSON.parse(response.body).warnings).toEqual(['power_curves']);
    expect(deps.persist).toHaveBeenCalledOnce();
  });

  it('does not persist a response superseded by a newer athlete request', async () => {
    const deps = dependencies({ isLatestSync: vi.fn().mockResolvedValue(false) });
    const response = await createSyncHandler(deps)(event());
    expect(response.statusCode).toBe(409);
    expect(deps.persist).not.toHaveBeenCalled();
  });
});
