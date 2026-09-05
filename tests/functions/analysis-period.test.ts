import { describe, expect, it } from 'vitest';
import { parseSyncRequest } from '../../netlify/functions/lib/analysis-period';

const validRequest = {
  athleteId: '8ca7cc82-02b0-47ca-84ca-253607a04b72',
  oldest: '2026-06-08',
  newest: '2026-09-05',
  environment: 'all',
  syncKey: 'sync_123',
};

describe('analysis-period sync request', () => {
  it('resolves an inclusive valid period', () => {
    expect(parseSyncRequest(validRequest, new Date('2026-09-05T12:00:00Z'))).toEqual({
      ...validRequest,
      days: 90,
    });
  });

  it.each([
    ['an external athlete id', { athleteId: 'i123' }],
    ['a future newest date', { newest: '2026-09-06' }],
    ['a reversed period', { oldest: '2026-09-05', newest: '2026-09-04' }],
    ['a 731-day inclusive period', { oldest: '2024-09-05', newest: '2026-09-05' }],
    ['an unknown environment', { environment: 'virtual' }],
    ['an unknown property', { unexpected: true }],
  ])('rejects %s', (_label, override) => {
    expect(() => parseSyncRequest({ ...validRequest, ...override }, new Date('2026-09-05T12:00:00Z')))
      .toThrow(/sincronización no válida/i);
  });
});
