import { MADER_CONSTANTS, MADER_MODEL_VERSION } from './references';

type InputQuality = 'measured' | 'calculated' | 'imported_estimate' | 'incomplete' | 'rejected';

type ModelInput<Unit extends string> = {
  value: number;
  unit: Unit;
  quality: InputQuality;
  observationId: string;
};

export interface MaderInputs {
  vo2max: ModelInput<'ml·kg⁻¹·min⁻¹'>;
  vlamax: ModelInput<'mmol·l⁻¹·s⁻¹'>;
  bodyMass: ModelInput<'kg'>;
  pVo2max: ModelInput<'W'>;
  cadenceRpm?: number;
  comparison?: {
    ftpWatts?: number;
    cpWatts?: number;
    lt2Watts?: number;
    mlssMeasuredWatts?: number;
  };
}

export interface MaderConfig {
  restingVo2: number;
  sensitivityVlamaxDelta?: number;
  acknowledged?: boolean;
}

export type ExperimentalMaderResult = {
  status: 'blocked';
  reasons: string[];
  version: typeof MADER_MODEL_VERSION;
} | {
  status: 'calculated';
  reasons: string[];
  version: typeof MADER_MODEL_VERSION;
  mlssWatts: number;
  fatmaxWatts: number;
  inputLineage: string[];
  cadenceWarning: string;
  sensitivity: {
    vlamaxDelta: number;
    mlssWatts: { lower: number; upper: number };
    fatmaxWatts: { lower: number; upper: number };
  };
  reportEligible: boolean;
};

function calculate(vo2max: number, vlamax: number, bodyMass: number, pVo2max: number, restingVo2: number) {
  const { oxidativeAffinity, glycolyticAffinity, oxygenLactateEquivalent, lactateDistributionVolume, adpStart, adpEnd, adpStep } = MADER_CONSTANTS;
  let previousDifference: number | undefined;
  let previousVo2 = 0;
  let mlssVo2: number | undefined;
  let fatmaxVo2 = 0;
  let largestDifference = -Infinity;

  for (let adp = adpStart; adp <= adpEnd; adp += adpStep) {
    const vo2Steady = vo2max / (1 + oxidativeAffinity / adp ** 2);
    const vlaSteady = vlamax / (1 + glycolyticAffinity / adp ** 3);
    const oxidativeLactate = oxygenLactateEquivalent * (vo2Steady / 60) / lactateDistributionVolume;
    const difference = oxidativeLactate - vlaSteady;

    if (difference > largestDifference) {
      largestDifference = difference;
      fatmaxVo2 = vo2Steady;
    }
    if (previousDifference != null && previousDifference > 0 && difference <= 0) {
      const fraction = previousDifference / (previousDifference - difference);
      mlssVo2 = previousVo2 + fraction * (vo2Steady - previousVo2);
      break;
    }
    previousDifference = difference;
    previousVo2 = vo2Steady;
  }

  if (mlssVo2 == null) throw new Error('No se encontró un equilibrio metabólico dentro del dominio del modelo.');
  const oxygenCostPerWatt = ((vo2max - restingVo2) * bodyMass) / pVo2max;
  if (oxygenCostPerWatt <= 0) throw new Error('La relación entre VO₂ y P@VO₂max no permite convertir el resultado a vatios.');
  const toWatts = (relativeVo2: number) => (relativeVo2 * bodyMass - restingVo2 * bodyMass) / oxygenCostPerWatt;
  return { mlssWatts: toWatts(mlssVo2), fatmaxWatts: toWatts(fatmaxVo2) };
}

export function runMaderModel(inputs: MaderInputs, config: MaderConfig): ExperimentalMaderResult {
  const reasons: string[] = [];
  const required = [inputs.vo2max, inputs.vlamax, inputs.bodyMass, inputs.pVo2max];
  if (required.some((input) => !Number.isFinite(input.value) || input.value <= 0)) reasons.push('Todos los valores de entrada deben ser positivos y finitos.');
  if (inputs.vo2max.quality !== 'measured') reasons.push('El VO₂max debe proceder de una medición compatible.');
  if (!['measured', 'calculated'].includes(inputs.vlamax.quality)) reasons.push('La VLa máx debe proceder de un protocolo medido y completo.');
  if (inputs.bodyMass.quality !== 'measured') reasons.push('La masa corporal debe estar medida.');
  if (inputs.pVo2max.quality !== 'measured') reasons.push('La P@VO₂max debe estar medida en una prueba compatible.');
  if (!Number.isFinite(config.restingVo2) || config.restingVo2 <= 0 || config.restingVo2 >= inputs.vo2max.value) reasons.push('El VO₂ de reposo configurado no es válido.');
  if (reasons.length) return { status: 'blocked', reasons, version: MADER_MODEL_VERSION };

  try {
    const central = calculate(inputs.vo2max.value, inputs.vlamax.value, inputs.bodyMass.value, inputs.pVo2max.value, config.restingVo2);
    const delta = Math.max(0.01, config.sensitivityVlamaxDelta ?? 0.1);
    const lowVla = calculate(inputs.vo2max.value, Math.max(0.001, inputs.vlamax.value - delta), inputs.bodyMass.value, inputs.pVo2max.value, config.restingVo2);
    const highVla = calculate(inputs.vo2max.value, inputs.vlamax.value + delta, inputs.bodyMass.value, inputs.pVo2max.value, config.restingVo2);
    return {
      status: 'calculated', reasons: [], version: MADER_MODEL_VERSION,
      ...central,
      inputLineage: required.map((input) => input.observationId),
      cadenceWarning: inputs.cadenceRpm == null
        ? 'La cadencia no está documentada y el modelo no incorpora su posible efecto.'
        : `Cadencia documentada: ${inputs.cadenceRpm} rpm. El modelo no incorpora su posible efecto.`,
      sensitivity: {
        vlamaxDelta: delta,
        mlssWatts: { lower: Math.min(lowVla.mlssWatts, highVla.mlssWatts), upper: Math.max(lowVla.mlssWatts, highVla.mlssWatts) },
        fatmaxWatts: { lower: Math.min(lowVla.fatmaxWatts, highVla.fatmaxWatts), upper: Math.max(lowVla.fatmaxWatts, highVla.fatmaxWatts) },
      },
      reportEligible: config.acknowledged === true,
    };
  } catch (error) {
    return { status: 'blocked', reasons: [error instanceof Error ? error.message : 'El cálculo no pudo completarse.'], version: MADER_MODEL_VERSION };
  }
}
