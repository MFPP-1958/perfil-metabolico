import { describe, expect, it } from 'vitest';
import { fromObservationRow, toObservationRow } from '../../netlify/functions/lib/observation-rows.js';
import type { Observation } from '../../src/domain/observation.js';

const modelled: Observation = {
  id: '6b8c6a31-9a5b-40d8-8b0b-8e337268e7b9',
  athleteId: '8ca7cc82-02b0-47ca-84ca-253607a04b72',
  metricCode: 'vlamax',
  value: 0.72,
  unit: 'mmol·l⁻¹·s⁻¹',
  observedAt: '2026-09-16T08:00:00.000Z',
  origin: 'external_model',
  quality: 'calculated',
  sourceReference: { software: 'WKO5', version: '5.0.16' },
  protocol: { name: 'Entrada manual', version: '1' },
};

describe('observation row mapping', () => {
  it('writes the third-party software into its own column', () => {
    const row = toObservationRow('coach-1', modelled);
    expect(row.origin).toBe('external_model');
    expect(row.source_reference).toEqual({ software: 'WKO5', version: '5.0.16' });
  });

  it('survives a round trip through the database columns', () => {
    const restored = fromObservationRow(toObservationRow('coach-1', modelled));
    expect(restored).toEqual(modelled);
  });

  it('drops a third-party row whose software was never recorded', () => {
    const row = { ...toObservationRow('coach-1', modelled), source_reference: null };
    expect(fromObservationRow(row)).toBeNull();
  });

  it('leaves a measured observation without a source reference', () => {
    const measured: Observation = {
      ...modelled, metricCode: 'ftp', value: 310, unit: 'W', origin: 'field_test', quality: 'measured', sourceReference: undefined,
    };
    const row = toObservationRow('coach-1', measured);
    expect(row.source_reference).toBeNull();
    expect(fromObservationRow(row)).not.toHaveProperty('sourceReference');
  });
});
