import { describe, expect, it, vi } from 'vitest';
import { IntervalsClient } from './client';

describe('IntervalsClient', () => {
  it('requests fresh and fatigued power curves in one call', async () => {
    const get = vi.fn().mockResolvedValue({ list: [] });
    const client = new IntervalsClient({ get });

    await client.getDurabilityCurves('i123', '90d', '2026-09-14', true);

    expect(get).toHaveBeenCalledWith('/athlete/i123/power-curves', {
      curves: '90d,90d-kj0,90d-kj1',
      newest: '2026-09-14',
      type: 'Ride',
      subMaxEfforts: '3',
      filters: JSON.stringify([{ field_id: 'indoor', operator: 'eq', value: 'indoor' }]),
    });
  });
});
