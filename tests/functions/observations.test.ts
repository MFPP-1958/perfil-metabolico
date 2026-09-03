import { describe, expect, it, vi } from 'vitest';
import { createObservationsHandler } from '../../netlify/functions/observations';

const observation = { id: '6b8c6a31-9a5b-40d8-8b0b-8e337268e7b9', athleteId: '8ca7cc82-02b0-47ca-84ca-253607a04b72', metricCode: 'ftp', value: 280, unit: 'W', observedAt: '2026-09-01T08:00:00Z', origin: 'field_test', quality: 'measured', protocol: { name: '20 min', version: '1' } };
const event = { httpMethod: 'POST', headers: { authorization: 'Bearer test' }, body: JSON.stringify(observation) };

describe('observation creation API', () => {
  it('rejects anonymous requests', async () => {
    const response = await createObservationsHandler()( { ...event, headers: {} } );
    expect(response.statusCode).toBe(401);
  });

  it('rejects viewers before persistence', async () => {
    const persist = vi.fn();
    const response = await createObservationsHandler({ authenticate: vi.fn().mockResolvedValue({ id: 'viewer-1' }), canEdit: vi.fn().mockResolvedValue(false), persist })(event);
    expect(response.statusCode).toBe(403);
    expect(persist).not.toHaveBeenCalled();
  });

  it('validates and persists a traceable observation', async () => {
    const persist = vi.fn().mockResolvedValue(observation);
    const response = await createObservationsHandler({ authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }), canEdit: vi.fn().mockResolvedValue(true), persist })(event);
    expect(response.statusCode).toBe(201);
    expect(persist).toHaveBeenCalledWith('coach-1', expect.objectContaining({ metricCode: 'ftp', protocol: { name: '20 min', version: '1' } }));
  });

  it('rejects invalid units and oversized bodies', async () => {
    const deps = { authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }), canEdit: vi.fn().mockResolvedValue(true), persist: vi.fn() };
    expect((await createObservationsHandler(deps)({ ...event, body: JSON.stringify({ ...observation, unit: 'kg' }) })).statusCode).toBe(400);
    expect((await createObservationsHandler(deps)({ ...event, body: 'x'.repeat(20_000) })).statusCode).toBe(413);
  });
});
