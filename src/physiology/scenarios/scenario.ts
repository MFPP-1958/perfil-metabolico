import { runMaderModel, type MaderInputs } from '../mader/model';
import { SUBSTRATE_LIMITATIONS } from '../substrates/references';
import {
  projectSubstrateCurve,
  type SubstrateConfig,
  type SubstratePoint,
  type SubstrateProjection,
} from '../substrates/metabolism';
import { SCENARIO_HYPOTHESIS_NOTICE, SCENARIO_LIMITATIONS, SCENARIO_MODEL_VERSION } from './references';

export type EventProfile = 'explosiva' | 'rodador' | 'escalador' | 'fondo';

export interface ScenarioTargets {
  vlamax: number;
  vo2max?: number;
}

export interface ScenarioConfig extends SubstrateConfig {
  /** Potencia sobre la que se lee el efecto práctico. Por defecto, el MLSS actual. */
  referencePowerWatts?: number;
}

export interface ScenarioChange {
  fatmaxWattsDelta: number;
  fatmaxFatGramsPerMinDelta: number;
  mlssWattsDelta: number;
  fatGramsPerMinDeltaAtReference: number;
  carbohydrateGramsPerHourDeltaAtReference: number;
  percentVo2maxAtReference: { current: number; target: number };
}

export type MetabolicScenarioResult =
  | { status: 'blocked'; reasons: string[]; version: typeof SCENARIO_MODEL_VERSION }
  | {
      status: 'calculated';
      version: typeof SCENARIO_MODEL_VERSION;
      current: SubstrateProjection;
      target: SubstrateProjection;
      appliedTargets: { vlamax: number; vo2max: number };
      realValues: { vlamax: number; vo2max: number };
      change: ScenarioChange;
      referencePowerWatts: number;
      comparable: boolean;
      withinSensitivity: boolean;
      notices: string[];
      limitations: string[];
      inputLineage: string[];
      cadenceWarning: string;
      provenanceNotices: string[];
      reportEligible: boolean;
    };

export function sampleAtPower(curve: readonly SubstratePoint[], watts: number): SubstratePoint {
  let closest = curve[0];
  let distance = Math.abs(closest.powerWatts - watts);
  for (const point of curve) {
    const candidate = Math.abs(point.powerWatts - watts);
    if (candidate < distance) {
      closest = point;
      distance = candidate;
    }
  }
  return closest;
}

function positive(value: number | undefined): boolean {
  return value != null && Number.isFinite(value) && value > 0;
}

export function buildMetabolicScenario(
  inputs: MaderInputs,
  config: ScenarioConfig,
  targets: ScenarioTargets,
): MetabolicScenarioResult {
  // La guarda se ejecuta una sola vez y solo sobre las entradas reales.
  const gate = runMaderModel(inputs, config);
  if (gate.status === 'blocked') {
    return { status: 'blocked', reasons: gate.reasons, version: SCENARIO_MODEL_VERSION };
  }

  const reasons: string[] = [];
  if (!positive(targets.vlamax)) reasons.push('La VLa máx objetivo debe ser un número positivo.');
  if (targets.vo2max !== undefined && !positive(targets.vo2max)) reasons.push('El VO₂max objetivo debe ser un número positivo.');
  if (targets.vo2max !== undefined && targets.vo2max <= config.restingVo2) reasons.push('El VO₂max objetivo debe superar al VO₂ de reposo configurado.');
  if (reasons.length) return { status: 'blocked', reasons, version: SCENARIO_MODEL_VERSION };

  const realValues = { vlamax: inputs.vlamax.value, vo2max: inputs.vo2max.value };
  const appliedTargets = { vlamax: targets.vlamax, vo2max: targets.vo2max ?? realValues.vo2max };

  const current = projectSubstrateCurve({
    vo2max: realValues.vo2max,
    vlamax: realValues.vlamax,
    bodyMass: inputs.bodyMass.value,
    pVo2max: inputs.pVo2max.value,
  }, config);

  const target = projectSubstrateCurve({
    vo2max: appliedTargets.vo2max,
    vlamax: appliedTargets.vlamax,
    bodyMass: inputs.bodyMass.value,
    pVo2max: inputs.pVo2max.value,
  }, config);

  const referencePowerWatts = positive(config.referencePowerWatts)
    ? (config.referencePowerWatts as number)
    : current.mlss.powerWatts;
  const currentAtReference = sampleAtPower(current.curve, referencePowerWatts);
  const targetAtReference = sampleAtPower(target.curve, referencePowerWatts);

  const vlamaxDistance = Math.abs(appliedTargets.vlamax - realValues.vlamax);
  const comparable = vlamaxDistance > 0.005 || appliedTargets.vo2max !== realValues.vo2max;
  const withinSensitivity = comparable && vlamaxDistance <= gate.sensitivity.vlamaxDelta;

  const notices = [SCENARIO_HYPOTHESIS_NOTICE];
  if (!comparable) {
    notices.push('El objetivo coincide con el valor real del ciclista: no hay nada que comparar.');
  }
  if (withinSensitivity) {
    notices.push(`La diferencia propuesta, de ${vlamaxDistance.toFixed(2)} mmol·l⁻¹·s⁻¹, no supera la sensibilidad del propio modelo, de ${gate.sensitivity.vlamaxDelta.toFixed(2)}. La separación entre las dos curvas no se distingue de su incertidumbre.`);
  }

  return {
    status: 'calculated',
    version: SCENARIO_MODEL_VERSION,
    current,
    target,
    appliedTargets,
    realValues,
    referencePowerWatts,
    comparable,
    withinSensitivity,
    change: {
      fatmaxWattsDelta: target.fatmax.powerWatts - current.fatmax.powerWatts,
      fatmaxFatGramsPerMinDelta: target.fatmax.fatOxidationGramsPerMin - current.fatmax.fatOxidationGramsPerMin,
      mlssWattsDelta: target.mlss.powerWatts - current.mlss.powerWatts,
      fatGramsPerMinDeltaAtReference: targetAtReference.fatOxidationGramsPerMin - currentAtReference.fatOxidationGramsPerMin,
      carbohydrateGramsPerHourDeltaAtReference: targetAtReference.carbohydrateGramsPerHour - currentAtReference.carbohydrateGramsPerHour,
      percentVo2maxAtReference: { current: currentAtReference.percentVo2max, target: targetAtReference.percentVo2max },
    },
    notices,
    limitations: [...SUBSTRATE_LIMITATIONS, ...SCENARIO_LIMITATIONS],
    inputLineage: gate.inputLineage,
    cadenceWarning: gate.cadenceWarning,
    provenanceNotices: gate.provenanceNotices,
    reportEligible: gate.reportEligible,
  };
}
