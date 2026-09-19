import { describe, expect, it, vi } from 'vitest';
import { createObservationsHandler } from '../../netlify/functions/observations';
import type { Observation } from '../../src/domain/observation';

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

describe('carga de varios valores de una vez', () => {
  const second = { ...observation, id: '7c9d7b42-0b6c-41e9-9c1c-9f448379f8ca', metricCode: 'vo2max', value: 71.5, unit: 'ml·kg⁻¹·min⁻¹', origin: 'external_model', quality: 'calculated', sourceReference: { software: 'WKO5' } };
  const batchEvent = { ...event, body: JSON.stringify({ observations: [observation, second] }) };

  it('guarda todos los valores juntos o ninguno', async () => {
    const persistMany = vi.fn(async (_coach: string, list: Observation[]) => list);
    const response = await createObservationsHandler({ authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }), canEdit: vi.fn().mockResolvedValue(true), persistMany })(batchEvent);
    expect(response.statusCode).toBe(201);
    expect(persistMany).toHaveBeenCalledWith('coach-1', [expect.objectContaining({ metricCode: 'ftp' }), expect.objectContaining({ metricCode: 'vo2max' })]);
    expect(JSON.parse(response.body).observations).toHaveLength(2);
  });

  it('rechaza el lote entero si un valor no es válido, sin guardar nada', async () => {
    const persistMany = vi.fn();
    const bad = { ...second, unit: 'W' };
    const response = await createObservationsHandler({ authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }), canEdit: vi.fn().mockResolvedValue(true), persistMany })({ ...event, body: JSON.stringify({ observations: [observation, bad] }) });
    expect(response.statusCode).toBe(400);
    expect(persistMany).not.toHaveBeenCalled();
  });

  it('no mezcla ciclistas en un lote ni acepta lotes vacíos o enormes', async () => {
    const deps = { authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }), canEdit: vi.fn().mockResolvedValue(true), persistMany: vi.fn() };
    const otherAthlete = { ...second, athleteId: '9c3d8157-99a0-4ae6-83be-ad15c4e56f9f' };
    expect((await createObservationsHandler(deps)({ ...event, body: JSON.stringify({ observations: [observation, otherAthlete] }) })).statusCode).toBe(400);
    expect((await createObservationsHandler(deps)({ ...event, body: JSON.stringify({ observations: [] }) })).statusCode).toBe(400);
    expect((await createObservationsHandler(deps)({ ...event, body: JSON.stringify({ observations: Array.from({ length: 21 }, () => observation) }) })).statusCode).toBe(400);
    expect(deps.persistMany).not.toHaveBeenCalled();
  });

  it('no deja crear un valor ya retirado', async () => {
    const persist = vi.fn();
    const response = await createObservationsHandler({ authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }), canEdit: vi.fn().mockResolvedValue(true), persist })({ ...event, body: JSON.stringify({ ...observation, retractedAt: '2026-09-19T08:00:00Z', retractionReason: 'x' }) });
    expect(response.statusCode).toBe(400);
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('retirar un valor', () => {
  const retractEvent = (reason = 'Error al teclear el valor') => ({ ...event, body: JSON.stringify({ retract: { athleteId: observation.athleteId, observationId: observation.id, reason } }) });

  it('lo retira con motivo, solo si el entrenador puede editar al ciclista', async () => {
    const retract = vi.fn().mockResolvedValue({ ...observation, retractedAt: '2026-09-19T08:00:00.000Z', retractionReason: 'Error al teclear el valor' });
    const canEdit = vi.fn().mockResolvedValue(true);
    const response = await createObservationsHandler({ authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }), canEdit, retract })(retractEvent());
    expect(response.statusCode).toBe(200);
    expect(canEdit).toHaveBeenCalledWith('coach-1', observation.athleteId);
    expect(retract).toHaveBeenCalledWith(observation.athleteId, observation.id, 'Error al teclear el valor');
    expect(JSON.parse(response.body).retractionReason).toBe('Error al teclear el valor');
  });

  it('exige un motivo', async () => {
    const retract = vi.fn();
    const response = await createObservationsHandler({ authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }), canEdit: vi.fn().mockResolvedValue(true), retract })(retractEvent('  '));
    expect(response.statusCode).toBe(400);
    expect(retract).not.toHaveBeenCalled();
  });

  it('devuelve 404 si el valor no existe para ese ciclista o ya estaba retirado', async () => {
    const response = await createObservationsHandler({ authenticate: vi.fn().mockResolvedValue({ id: 'coach-1' }), canEdit: vi.fn().mockResolvedValue(true), retract: vi.fn().mockResolvedValue(null) })(retractEvent());
    expect(response.statusCode).toBe(404);
  });

  it('rechaza a quien solo puede ver', async () => {
    const retract = vi.fn();
    const response = await createObservationsHandler({ authenticate: vi.fn().mockResolvedValue({ id: 'viewer-1' }), canEdit: vi.fn().mockResolvedValue(false), retract })(retractEvent());
    expect(response.statusCode).toBe(403);
    expect(retract).not.toHaveBeenCalled();
  });
});
