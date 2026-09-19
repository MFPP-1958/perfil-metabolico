import { describe, expect, it } from 'vitest';
import type { Observation } from './observation';
import { checkThresholdCoherence, resolveProfile } from './profile';

const athleteId = '96a0a55f-bf3a-41d0-a2df-567548bff081';
let sequence = 0;

function obs(metricCode: Observation['metricCode'], value: number, unit: string, observedAt: string, origin: Observation['origin'], extra: Partial<Observation> = {}): Observation {
  sequence += 1;
  const quality: Observation['quality'] = origin === 'intervals_icu' ? 'imported_estimate' : origin === 'external_model' || origin === 'calculated' ? 'calculated' : 'measured';
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    athleteId, metricCode, value, unit, observedAt, origin, quality,
    protocol: { name: 'x', version: '1' },
    ...(origin === 'external_model' ? { sourceReference: { software: 'WKO5' } } : {}),
    ...extra,
  };
}

// Las observaciones reales de Jaume Santamaria.
const jaume = [
  obs('ftp', 236, 'W', '2026-09-15T15:45:07Z', 'intervals_icu'),
  obs('ftp', 239, 'W', '2026-09-16T10:29:10Z', 'field_test'),
  obs('vo2max', 71.5, 'ml·kg⁻¹·min⁻¹', '2026-09-18T07:07:10Z', 'external_model'),
  obs('vlamax', 0.3, 'mmol·l⁻¹·s⁻¹', '2026-09-18T07:07:52Z', 'external_model'),
  obs('p_vo2max', 392, 'W', '2026-09-18T07:08:18Z', 'external_model'),
  obs('body_mass', 54.8, 'kg', '2026-09-18T07:08:43Z', 'manual'),
];

describe('resolveProfile', () => {
  it('prefiere el test de campo a la estimación de Intervals aunque esta sea anterior o posterior', () => {
    const profile = resolveProfile(jaume, '2026-09-19');
    const ftp = profile.byCode.ftp!;
    expect(ftp.current?.value).toBe(239);
    expect(ftp.alternatives.map((item) => item.value)).toEqual([236]);
    expect(ftp.expired).toBe(false);
    expect(ftp.ageDays).toBe(3);
  });

  it('solo ve lo que se sabía en la fecha pedida', () => {
    const profile = resolveProfile(jaume, '2026-09-15');
    expect(profile.byCode.ftp?.current?.value).toBe(236);
    expect(profile.byCode.vo2max?.current).toBeNull();
    expect(profile.byCode.body_mass?.current).toBeNull();
  });

  it('prefiere un valor vigente a uno caducado aunque sea de una fuente mejor', () => {
    const lab = obs('vo2max', 69, 'ml·kg⁻¹·min⁻¹', '2026-03-01T09:00:00Z', 'laboratory');
    const wko = obs('vo2max', 71.5, 'ml·kg⁻¹·min⁻¹', '2026-09-18T07:00:00Z', 'external_model');
    const profile = resolveProfile([lab, wko], '2026-09-19');
    expect(profile.byCode.vo2max?.current?.value).toBe(71.5);
    expect(profile.byCode.vo2max?.alternatives[0]).toMatchObject({ value: 69 });
  });

  it('marca como caducado un valor sin alternativa vigente, sin esconderlo', () => {
    const profile = resolveProfile([obs('body_mass', 56, 'kg', '2026-08-01T08:00:00Z', 'manual')], '2026-09-19');
    expect(profile.byCode.body_mass?.current?.value).toBe(56);
    expect(profile.byCode.body_mass?.expired).toBe(true);
    expect(profile.byCode.body_mass?.freshnessDays).toBe(14);
  });

  it('ignora valores retirados, rechazados o incompletos', () => {
    const retracted = obs('ftp', 300, 'W', '2026-09-17T08:00:00Z', 'field_test', { retractedAt: '2026-09-18T08:00:00Z', retractionReason: 'Error al teclear' });
    const rejected = obs('ftp', 310, 'W', '2026-09-17T09:00:00Z', 'field_test', { quality: 'rejected' });
    const profile = resolveProfile([...jaume, retracted, rejected], '2026-09-19');
    expect(profile.byCode.ftp?.current?.value).toBe(239);
    expect(profile.byCode.ftp?.alternatives.map((item) => item.value)).toEqual([236]);
  });

  it('entre fuentes iguales gana el más reciente', () => {
    const profile = resolveProfile([
      obs('body_mass', 55.4, 'kg', '2026-09-10T08:00:00Z', 'manual'),
      obs('body_mass', 54.8, 'kg', '2026-09-18T08:00:00Z', 'manual'),
    ], '2026-09-19');
    expect(profile.byCode.body_mass?.current?.value).toBe(54.8);
  });

  it('recorre las métricas del perfil en un orden fijo aunque no tengan datos', () => {
    const profile = resolveProfile([], '2026-09-19');
    expect(profile.metrics.map((metric) => metric.metricCode)).toEqual(expect.arrayContaining(['vo2max', 'vlamax', 'p_vo2max', 'ftp', 'mftp', 'cp', 'body_mass']));
    expect(profile.metrics.every((metric) => metric.current === null)).toBe(true);
  });
});

describe('checkThresholdCoherence', () => {
  it('avisa cuando FTP y MLSS modelado discrepan más de un 5 % y señala el sospechoso', () => {
    const profile = resolveProfile(jaume, '2026-09-19');
    const coherence = checkThresholdCoherence(profile, { label: 'MLSS modelado (Mader)', watts: 338 });
    expect(coherence.status).toBe('discrepant');
    expect(coherence.spreadPercent).toBeCloseTo(41.4, 0);
    expect(coherence.suspect?.label).toBe('MLSS modelado (Mader)');
  });

  it('da por coherentes valores dentro del 5 %', () => {
    const profile = resolveProfile([...jaume, obs('cp', 236, 'W', '2026-09-19T08:00:00Z', 'calculated')], '2026-09-19');
    const coherence = checkThresholdCoherence(profile, null);
    expect(coherence.status).toBe('coherent');
    expect(coherence.values.map((value) => value.watts)).toEqual([239, 236]);
  });

  it('no juzga con un solo valor', () => {
    expect(checkThresholdCoherence(resolveProfile([], '2026-09-19'), null).status).toBe('insufficient');
  });
});
