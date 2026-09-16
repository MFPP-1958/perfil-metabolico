import { describe, expect, it } from 'vitest';
import { runMaderModel, type MaderInputs } from './model';

const measuredInputs: MaderInputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'vo2-1' },
  vlamax: { value: 0.8, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'vla-1' },
  bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'mass-1' },
  pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'pvo2-1' },
};

describe('experimental Mader model', () => {
  it('reproduces an independently calculated reference case', () => {
    const result = runMaderModel(measuredInputs, { restingVo2: 5, acknowledged: true });
    expect(result.status).toBe('calculated');
    if (result.status !== 'calculated') return;
    expect(result.mlssWatts).toBeCloseTo(286.58, 1);
    expect(result.fatmaxWatts).toBeCloseTo(186.69, 1);
    expect(result.version).toBe('mader-reproduction@1.0.0');
    expect(result.inputLineage).toHaveLength(4);
  });

  it('blocks an imported VLa-max estimate', () => {
    const result = runMaderModel({
      ...measuredInputs,
      vlamax: { ...measuredInputs.vlamax, quality: 'imported_estimate' },
    }, { restingVo2: 5 });
    expect(result.status).toBe('blocked');
    expect(result.reasons.join(' ')).toMatch(/VLa/i);
  });

  it('reports sensitivity without exposing an LT1 output', () => {
    const result = runMaderModel(measuredInputs, { restingVo2: 5, sensitivityVlamaxDelta: 0.1 });
    expect(result.status).toBe('calculated');
    if (result.status !== 'calculated') return;
    expect(result.sensitivity.mlssWatts.lower).toBeLessThan(result.mlssWatts);
    expect(result.sensitivity.mlssWatts.upper).toBeGreaterThan(result.mlssWatts);
    expect(result).not.toHaveProperty('lt1Watts');
    expect(result).not.toHaveProperty('zoneUpdate');
  });

  it('requires coach acknowledgement for report eligibility and warns about cadence', () => {
    const result = runMaderModel(measuredInputs, { restingVo2: 5, acknowledged: false });
    expect(result.status).toBe('calculated');
    if (result.status !== 'calculated') return;
    expect(result.reportEligible).toBe(false);
    expect(result.cadenceWarning).toMatch(/cadencia/i);
  });

  it('accepts a VLa-max modelled by third-party software and says so in the result', () => {
    const result = runMaderModel({
      ...measuredInputs,
      vlamax: { ...measuredInputs.vlamax, quality: 'calculated', sourceReference: { software: 'WKO5', version: '5.0.16' } },
    }, { restingVo2: 5, acknowledged: true });
    expect(result.status).toBe('calculated');
    if (result.status !== 'calculated') return;
    expect(result.provenanceNotices.join(' ')).toMatch(/WKO5 5\.0\.16/);
    expect(result.provenanceNotices.join(' ')).toMatch(/VLa máx/);
  });

  it('reports no provenance notice when every input was measured directly', () => {
    const result = runMaderModel(measuredInputs, { restingVo2: 5, acknowledged: true });
    expect(result.status).toBe('calculated');
    if (result.status !== 'calculated') return;
    expect(result.provenanceNotices).toEqual([]);
  });
});
