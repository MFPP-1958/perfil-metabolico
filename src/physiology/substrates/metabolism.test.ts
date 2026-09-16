import { describe, expect, it } from 'vitest';
import { buildSubstrateProfile, projectSubstrateCurve } from './metabolism';
import { runMaderModel } from '../mader/model';
import type { MaderInputs } from '../mader/model';

const measuredInputs: MaderInputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'vo2-1' },
  vlamax: { value: 0.8, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'vla-1' },
  bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'mass-1' },
  pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'pvo2-1' },
};

const config = { restingVo2: 5, acknowledged: true };

describe('substrate metabolism profile', () => {
  it('reproduces an independently calculated reference case at FATmax', () => {
    const result = buildSubstrateProfile(measuredInputs, config);
    expect(result.status).toBe('calculated');
    if (result.status !== 'calculated') return;
    expect(result.fatmax.powerWatts).toBeCloseTo(186.6884, 2);
    expect(result.fatmax.fatOxidationGramsPerMin).toBeCloseTo(0.797, 3);
    expect(result.fatmax.carbohydrateGramsPerHour).toBeCloseTo(80.4408, 2);
    expect(result.fatmax.energyKcalPerHour).toBeCloseTo(695.1118, 2);
    expect(result.version).toBe('substrate-metabolism@1.0.0');
  });

  it('anchors MLSS to the same crossing point as the Mader model', () => {
    const result = buildSubstrateProfile(measuredInputs, config);
    expect(result.status).toBe('calculated');
    if (result.status !== 'calculated') return;
    expect(result.mlss.powerWatts).toBeCloseTo(286.5827, 2);
    expect(result.mlss.percentVo2max).toBeCloseTo(73.7305, 2);
    expect(result.mlss.pyruvateDeficit).toBeCloseTo(0, 4);
  });

  it('peaks fat oxidation at FATmax and exhausts it at MLSS', () => {
    const result = buildSubstrateProfile(measuredInputs, config);
    expect(result.status).toBe('calculated');
    if (result.status !== 'calculated') return;
    const peak = Math.max(...result.curve.map((point) => point.fatOxidationGramsPerMin));
    expect(result.fatmax.fatOxidationGramsPerMin).toBeCloseTo(peak, 2);
    expect(result.mlss.fatOxidationGramsPerMin).toBeCloseTo(0, 2);
  });

  it('raises carbohydrate cost monotonically with power', () => {
    const result = buildSubstrateProfile(measuredInputs, config);
    expect(result.status).toBe('calculated');
    if (result.status !== 'calculated') return;
    expect(result.curve.length).toBeGreaterThan(20);
    for (let i = 1; i < result.curve.length; i += 1) {
      expect(result.curve[i].powerWatts).toBeGreaterThan(result.curve[i - 1].powerWatts);
      expect(result.curve[i].carbohydrateGramsPerHour).toBeGreaterThan(result.curve[i - 1].carbohydrateGramsPerHour);
    }
  });

  it('inherits the Mader provenance gate and blocks an imported VLa-max estimate', () => {
    const result = buildSubstrateProfile({
      ...measuredInputs,
      vlamax: { ...measuredInputs.vlamax, quality: 'imported_estimate' },
    }, config);
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reasons.join(' ')).toMatch(/VLa/i);
  });

  it('never reports a lactate concentration it cannot derive', () => {
    const result = buildSubstrateProfile(measuredInputs, config);
    expect(result.status).toBe('calculated');
    if (result.status !== 'calculated') return;
    expect(JSON.stringify(result)).not.toMatch(/lactateConcentration|mmol·l⁻¹"/);
    expect(result.limitations.join(' ')).toMatch(/concentración de lactato/i);
  });

  it('publishes the same anchors as the Mader model it shares a sweep with', () => {
    const substrates = buildSubstrateProfile(measuredInputs, config);
    const mader = runMaderModel(measuredInputs, config);
    expect(substrates.status).toBe('calculated');
    expect(mader.status).toBe('calculated');
    if (substrates.status !== 'calculated' || mader.status !== 'calculated') return;
    expect(substrates.mlss.powerWatts).toBeCloseTo(mader.mlssWatts, 6);
    expect(substrates.fatmax.powerWatts).toBeCloseTo(mader.fatmaxWatts, 6);
  });

  it('carries the third-party provenance notice through to the substrate curve', () => {
    const result = buildSubstrateProfile({
      ...measuredInputs,
      vlamax: { ...measuredInputs.vlamax, quality: 'calculated', sourceReference: { software: 'WKO5', version: '5.0.16' } },
    }, config);
    expect(result.status).toBe('calculated');
    if (result.status !== 'calculated') return;
    expect(result.provenanceNotices.join(' ')).toMatch(/WKO5 5\.0\.16/);
    expect(result.curve.length).toBeGreaterThan(20);
  });
});

describe('projectSubstrateCurve', () => {
  const values = { vo2max: 68, vlamax: 0.8, bodyMass: 70, pVo2max: 400 };
  const config = { restingVo2: 5 };

  it('reproduce exactamente la curva que publica buildSubstrateProfile', () => {
    const gated = buildSubstrateProfile({
      vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
      vlamax: { value: 0.8, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'o-vla' },
      bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
      pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
    }, config);
    const projected = projectSubstrateCurve(values, config);

    if (gated.status !== 'calculated') throw new Error('El perfil de referencia debe calcularse.');
    expect(projected.curve).toEqual(gated.curve);
    expect(projected.fatmax).toEqual(gated.fatmax);
    expect(projected.mlss).toEqual(gated.mlss);
  });

  it('desplaza el MLSS a menos vatios cuando sube la VLa máx', () => {
    const baja = projectSubstrateCurve({ ...values, vlamax: 0.4 }, config);
    const alta = projectSubstrateCurve({ ...values, vlamax: 0.9 }, config);
    expect(alta.mlss.powerWatts).toBeLessThan(baja.mlss.powerWatts);
    expect(alta.fatmax.powerWatts).toBeLessThan(baja.fatmax.powerWatts);
    expect(alta.fatmax.fatOxidationGramsPerMin).toBeLessThan(baja.fatmax.fatOxidationGramsPerMin);
  });
});
