import { describe, expect, it } from 'vitest';
import type { MaderInputs } from '../mader/model';
import { buildMetabolicScenario, sampleAtPower } from './scenario';
import { SCENARIO_MODEL_VERSION } from './references';

const inputs: MaderInputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
  vlamax: { value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', quality: 'calculated', observationId: 'o-vla', sourceReference: { software: 'WKO5' } },
  bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
  pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
  comparison: { ftpWatts: 295 },
};
const config = { restingVo2: 5, referencePowerWatts: 250 };

describe('buildMetabolicScenario', () => {
  it('publica las dos proyecciones y la versión del modelo', () => {
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.8 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.version).toBe(SCENARIO_MODEL_VERSION);
    expect(result.current.curve.length).toBeGreaterThan(1);
    expect(result.target.curve.length).toBeGreaterThan(1);
    expect(result.appliedTargets).toEqual({ vlamax: 0.8, vo2max: 68 });
  });

  it('cifra el precio de subir la VLa máx con signo negativo', () => {
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.8 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.change.mlssWattsDelta).toBeLessThan(0);
    expect(result.change.fatmaxWattsDelta).toBeLessThan(0);
    expect(result.change.fatmaxFatGramsPerMinDelta).toBeLessThan(0);
    expect(result.change.carbohydrateGramsPerHourDeltaAtReference).toBeGreaterThan(0);
  });

  it('conserva el VO₂max real cuando no se propone objetivo', () => {
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.8 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.appliedTargets.vo2max).toBe(68);
  });

  it('aplica el VO₂max objetivo cuando se propone', () => {
    const soloVlamax = buildMetabolicScenario(inputs, config, { vlamax: 0.8 });
    const conVo2max = buildMetabolicScenario(inputs, config, { vlamax: 0.8, vo2max: 72 });
    if (soloVlamax.status !== 'calculated' || conVo2max.status !== 'calculated') {
      throw new Error('Los dos escenarios deben calcularse.');
    }
    expect(conVo2max.appliedTargets.vo2max).toBe(72);
    // Más techo oxidativo con la misma glucólisis desplaza el MLSS a más vatios.
    expect(conVo2max.target.mlss.powerWatts).toBeGreaterThan(soloVlamax.target.mlss.powerWatts);
  });

  it('mantiene la economía del ciclista al subir el VO₂max, no la P@VO₂max', () => {
    // Conservar la P@VO₂max real equivaldría a empeorar el coste de O₂ por vatio y
    // dejaba el efecto de un VO₂max un 10 % mayor en +5,3 W en vez de +41,3 W.
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.4, vo2max: 74.8 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.change.mlssWattsDelta).toBeCloseTo(41.34, 1);
  });

  it('avisa cuando el objetivo no se distingue de la sensibilidad del modelo', () => {
    const result = buildMetabolicScenario(inputs, { ...config, sensitivityVlamaxDelta: 0.1 }, { vlamax: 0.45 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.withinSensitivity).toBe(true);
    expect(result.notices.join(' ')).toMatch(/sensibilidad/i);
  });

  it('declara que no hay comparación cuando el objetivo iguala al valor real', () => {
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.4 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.comparable).toBe(false);
  });

  it('hereda el bloqueo y las razones de la guarda de procedencia', () => {
    const result = buildMetabolicScenario(
      { ...inputs, vo2max: { ...inputs.vo2max, quality: 'imported_estimate' } },
      config,
      { vlamax: 0.8 },
    );
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reasons.join(' ')).toMatch(/VO₂max/);
  });

  it('bloquea un objetivo que no es un número positivo y finito', () => {
    for (const vlamax of [0, -0.2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = buildMetabolicScenario(inputs, config, { vlamax });
      expect(result.status).toBe('blocked');
    }
  });

  it('arrastra el aviso de procedencia del programa de terceros', () => {
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.8 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.provenanceNotices.join(' ')).toMatch(/WKO5/);
  });

  it('usa el MLSS actual como referencia cuando no se fija una potencia', () => {
    const result = buildMetabolicScenario(inputs, { restingVo2: 5 }, { vlamax: 0.8 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.referencePowerWatts).toBeCloseTo(result.current.mlss.powerWatts, 6);
  });

  it('no avisa de sensibilidad cuando solo el VO₂max cambia, no la VLa máx', () => {
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.4, vo2max: 72 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.comparable).toBe(true);
    expect(result.withinSensitivity).toBe(false);
    expect(result.notices.join(' ')).not.toMatch(/sensibilidad/i);
  });
});

describe('sampleAtPower', () => {
  it('devuelve el punto de la curva más próximo a la potencia pedida', () => {
    const curve = [
      { powerWatts: 100, percentVo2max: 40, pyruvateDeficit: 0, netLactateAccumulation: 0, fatOxidationGramsPerMin: 0.5, carbohydrateGramsPerHour: 30, energyKcalPerHour: 400 },
      { powerWatts: 200, percentVo2max: 60, pyruvateDeficit: 0, netLactateAccumulation: 0, fatOxidationGramsPerMin: 0.7, carbohydrateGramsPerHour: 90, energyKcalPerHour: 700 },
    ];
    expect(sampleAtPower(curve, 190).powerWatts).toBe(200);
    expect(sampleAtPower(curve, 120).powerWatts).toBe(100);
  });
});
