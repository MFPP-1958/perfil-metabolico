import { readFileSync } from 'node:fs';
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
    beginSync: vi.fn().mockResolvedValue(undefined),
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

  it('does not transfer athlete ownership during an upsert', () => {
    const source = readFileSync('netlify/functions/sync-athlete.ts', 'utf8');
    const athleteUpsert = source.slice(source.indexOf('/rest/v1/athletes?'), source.indexOf('let rows'));
    expect(athleteUpsert).toContain('resolution=ignore-duplicates');
    expect(athleteUpsert).not.toContain('resolution=merge-duplicates');
  });
});
