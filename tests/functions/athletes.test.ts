import { describe, expect, it, vi } from 'vitest';
import { createAthletesHandler } from '../../netlify/functions/athletes';

const roster = [{ id: '8ca7cc82-02b0-47ca-84ca-253607a04b72', intervalsId: 'i123', name: 'Ana Test', role: 'coach' as const }];
const base = { authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }), list: vi.fn().mockResolvedValue(roster), observations: vi.fn().mockResolvedValue([{ id: '6b8c6a31-9a5b-40d8-8b0b-8e337268e7b9', athleteId: roster[0].id, metricCode: 'ftp', value: 280, unit: 'W', observedAt: '2026-09-01T08:00:00Z', origin: 'field_test', quality: 'measured', protocol: { name: '20 min', version: '1' } }]) };

function event(athleteId?: string, query: Record<string, string> = {}) { return { httpMethod: 'GET', headers: { authorization: 'Bearer test' }, queryStringParameters: athleteId ? { athleteId, ...query } : undefined }; }

describe('normalized athlete API', () => {
  it('lists internal and Intervals identifiers separately', async () => {
    const response = await createAthletesHandler(base)(event());
    expect(JSON.parse(response.body)[0]).toMatchObject({ id: roster[0].id, intervalsId: 'i123' });
  });

  it('loads traceable observations only for a roster athlete', async () => {
    const response = await createAthletesHandler(base)(event(roster[0].id));
    expect(JSON.parse(response.body).observations[0].protocol.name).toBe('20 min');
  });

  it('rejects an internal athlete outside the roster before reading observations', async () => {
    const deps = { ...base, observations: vi.fn() };
    const response = await createAthletesHandler(deps)(event('96a0a55f-bf3a-41d0-a2df-567548bff081'));
    expect(response.statusCode).toBe(403);
    expect(deps.observations).not.toHaveBeenCalled();
  });

  it('returns the persisted synchronization state for the exact authorized context', async () => {
    const syncState = vi.fn().mockResolvedValue({
      status: 'partial',
      synchronizedAt: '2026-09-05T11:45:00.000Z',
      warnings: ['activities:1_rejected'],
      counts: { activities: { received: 2, accepted: 1, rejected: 1 } },
    });
    const deps = { ...base, observations: vi.fn(), syncState };

    const response = await createAthletesHandler(deps)(event(roster[0].id, {
      syncState: 'true',
      oldest: '2026-06-08',
      newest: '2026-09-05',
      environment: 'indoor',
    }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'partial',
      synchronizedAt: '2026-09-05T11:45:00.000Z',
      warnings: ['activities:1_rejected'],
      counts: { activities: { received: 2, accepted: 1, rejected: 1 } },
    });
    expect(syncState).toHaveBeenCalledWith(roster[0].id, {
      oldest: '2026-06-08', newest: '2026-09-05', environment: 'indoor',
    });
    expect(deps.observations).not.toHaveBeenCalled();
  });
});
