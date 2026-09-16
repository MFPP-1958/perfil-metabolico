import { MADER_CONSTANTS } from '../mader/references';
import { runMaderModel, type MaderConfig, type MaderInputs } from '../mader/model';
import { oxidativeCapacity, pyruvateDeficit, sweepMetabolicStates, type MetabolicState } from '../mader/sweep';
import { SUBSTRATE_CONSTANTS, SUBSTRATE_LIMITATIONS, SUBSTRATE_MODEL_VERSION } from './references';

export interface SubstratePoint {
  powerWatts: number;
  percentVo2max: number;
  /** Capacidad oxidativa menos glucólisis, en mmol·l⁻¹·s⁻¹. Positivo por debajo del MLSS. */
  pyruvateDeficit: number;
  /** Acumulación neta de lactato, en mmol·l⁻¹·s⁻¹. Es el déficit con signo opuesto. */
  netLactateAccumulation: number;
  fatOxidationGramsPerMin: number;
  carbohydrateGramsPerHour: number;
  energyKcalPerHour: number;
}

export interface SubstrateConfig extends MaderConfig {
  /** Número de puntos de la curva devuelta. */
  curvePoints?: number;
}

export type SubstrateProfileResult =
  | { status: 'blocked'; reasons: string[]; version: typeof SUBSTRATE_MODEL_VERSION }
  | {
      status: 'calculated';
      version: typeof SUBSTRATE_MODEL_VERSION;
      curve: SubstratePoint[];
      fatmax: SubstratePoint;
      mlss: SubstratePoint;
      inputLineage: string[];
      cadenceWarning: string;
      provenanceNotices: string[];
      limitations: string[];
      reportEligible: boolean;
    };

function describe(state: MetabolicState, vo2max: number, bodyMass: number, toWatts: (relative: number) => number): SubstratePoint {
  const { lactateDistributionVolume, oxygenLactateEquivalent } = MADER_CONSTANTS;
  const { pyruvatePerGlucosyl, glucosylMolarMassGrams, litresOxygenPerGramFat, kcalPerLitreOxygenCarbohydrate, kcalPerLitreOxygenFat } = SUBSTRATE_CONSTANTS;

  const capacity = oxidativeCapacity(state.vo2Relative);
  const deficit = pyruvateDeficit(state);
  const distributionVolumeLitres = lactateDistributionVolume * bodyMass;

  // Flujo glucolítico total del organismo, en mmol·s⁻¹ de equivalentes de lactato.
  const glycolyticFlux = state.glycolyticRate * distributionVolumeLitres;
  // Piruvato que la mitocondria alcanza a oxidar, limitado por la capacidad oxidativa.
  const oxidisedFlux = Math.min(state.glycolyticRate, capacity) * distributionVolumeLitres;

  const vo2Absolute = state.vo2Relative * bodyMass;
  const vo2FromCarbohydrate = (oxidisedFlux * 60) / oxygenLactateEquivalent;
  const vo2FromFat = Math.max(0, vo2Absolute - vo2FromCarbohydrate);

  return {
    powerWatts: toWatts(state.vo2Relative),
    percentVo2max: (state.vo2Relative / vo2max) * 100,
    pyruvateDeficit: deficit,
    netLactateAccumulation: -deficit,
    fatOxidationGramsPerMin: vo2FromFat / 1000 / litresOxygenPerGramFat,
    carbohydrateGramsPerHour: ((glycolyticFlux * 3600) / pyruvatePerGlucosyl) * (glucosylMolarMassGrams / 1000),
    energyKcalPerHour: ((vo2FromCarbohydrate * 60) / 1000) * kcalPerLitreOxygenCarbohydrate + ((vo2FromFat * 60) / 1000) * kcalPerLitreOxygenFat,
  };
}

export function buildSubstrateProfile(inputs: MaderInputs, config: SubstrateConfig): SubstrateProfileResult {
  // El motor de Mader es la única puerta de entrada: reutiliza sus guardas de procedencia.
  const gate = runMaderModel(inputs, config);
  if (gate.status === 'blocked') {
    return { status: 'blocked', reasons: gate.reasons, version: SUBSTRATE_MODEL_VERSION };
  }

  const vo2max = inputs.vo2max.value;
  const vlamax = inputs.vlamax.value;
  const bodyMass = inputs.bodyMass.value;
  const oxygenCostPerWatt = ((vo2max - config.restingVo2) * bodyMass) / inputs.pVo2max.value;
  const toWatts = (relative: number) => (relative * bodyMass - config.restingVo2 * bodyMass) / oxygenCostPerWatt;

  const { states, fatmax, mlss } = sweepMetabolicStates(vo2max, vlamax);
  const sweep = states.filter((state) => toWatts(state.vo2Relative) > 0);

  const requested = Math.max(2, config.curvePoints ?? 60);
  const sampleCount = Math.min(requested, sweep.length);
  const curve: SubstratePoint[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const index = Math.round((i * (sweep.length - 1)) / (sampleCount - 1));
    curve.push(describe(sweep[index], vo2max, bodyMass, toWatts));
  }

  return {
    status: 'calculated',
    version: SUBSTRATE_MODEL_VERSION,
    curve,
    fatmax: describe(fatmax, vo2max, bodyMass, toWatts),
    mlss: describe(mlss, vo2max, bodyMass, toWatts),
    inputLineage: gate.inputLineage,
    cadenceWarning: gate.cadenceWarning,
    provenanceNotices: gate.provenanceNotices,
    limitations: [...SUBSTRATE_LIMITATIONS],
    reportEligible: gate.reportEligible,
  };
}
