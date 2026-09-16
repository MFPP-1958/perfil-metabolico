import { describe, expect, it } from 'vitest';
import type { Observation } from '../../domain/observation';
import { maderInputsFromObservations } from './maderInputs';

const athleteId = '11111111-1111-4111-8111-111111111111';

function observation(overrides: Partial<Observation>): Observation {
  return {
    id: crypto.randomUUID(),
    athleteId,
    metricCode: 'vo2max',
    value: 68,
    unit: 'ml·kg⁻¹·min⁻¹',
    observedAt: '2026-09-01T08:00:00.000Z',
    origin: 'laboratory',
    quality: 'measured',
    protocol: { name: 'rampa', version: '1' },
    ...overrides,
  } as Observation;
}

const completo: Observation[] = [
  observation({}),
  observation({ metricCode: 'vlamax', value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', origin: 'external_model', quality: 'calculated', sourceReference: { software: 'WKO5' } }),
  observation({ metricCode: 'body_mass', value: 70, unit: 'kg', origin: 'manual' }),
  observation({ metricCode: 'p_vo2max', value: 400, unit: 'W', origin: 'field_test' }),
  observation({ metricCode: 'ftp', value: 295, unit: 'W', origin: 'field_test' }),
];

describe('maderInputsFromObservations', () => {
  it('construye las entradas con la observación más reciente de cada métrica', () => {
    const result = maderInputsFromObservations([
      ...completo,
      observation({ metricCode: 'vlamax', value: 0.6, unit: 'mmol·l⁻¹·s⁻¹', observedAt: '2026-09-10T08:00:00.000Z', origin: 'external_model', quality: 'calculated', sourceReference: { software: 'WKO5', version: '5.0.16' } }),
    ]);
    if (result.status !== 'ready') throw new Error('Las entradas deben estar completas.');
    expect(result.inputs.vlamax.value).toBe(0.6);
    expect(result.inputs.vlamax.sourceReference).toEqual({ software: 'WKO5', version: '5.0.16' });
    expect(result.inputs.comparison?.ftpWatts).toBe(295);
  });

  it('conserva identificador y calidad de cada observación usada', () => {
    const result = maderInputsFromObservations(completo);
    if (result.status !== 'ready') throw new Error('Las entradas deben estar completas.');
    expect(result.inputs.vo2max.quality).toBe('measured');
    expect(result.inputs.vo2max.observationId).toBe(completo[0].id);
  });

  it('nombra la métrica que falta y el protocolo que la produce', () => {
    const result = maderInputsFromObservations(completo.filter((item) => item.metricCode !== 'p_vo2max'));
    if (result.status !== 'incomplete') throw new Error('Debe faltar la P@VO₂max.');
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].metricCode).toBe('p_vo2max');
    expect(result.missing[0].label).toBe('P@VO₂max');
    expect(result.missing[0].protocol.length).toBeGreaterThan(10);
  });

  it('enumera todas las métricas ausentes de un ciclista sin perfil', () => {
    const result = maderInputsFromObservations([observation({ metricCode: 'ftp', value: 239, unit: 'W' })]);
    if (result.status !== 'incomplete') throw new Error('Debe faltar casi todo.');
    expect(result.missing.map((item) => item.metricCode).sort()).toEqual(['body_mass', 'p_vo2max', 'vlamax', 'vo2max']);
  });

  it('descarta observaciones rechazadas o incompletas', () => {
    const result = maderInputsFromObservations([
      ...completo,
      observation({ metricCode: 'vo2max', value: 99, observedAt: '2026-09-12T08:00:00.000Z', quality: 'rejected' }),
    ]);
    if (result.status !== 'ready') throw new Error('Las entradas deben estar completas.');
    expect(result.inputs.vo2max.value).toBe(68);
  });

  it('no inventa el FTP de comparación cuando no existe', () => {
    const result = maderInputsFromObservations(completo.filter((item) => item.metricCode !== 'ftp'));
    if (result.status !== 'ready') throw new Error('Las entradas deben estar completas.');
    expect(result.inputs.comparison?.ftpWatts).toBeUndefined();
  });
});
