import { MADER_CONSTANTS } from './references';

/** Estado metabólico estacionario en un nivel de ADP, antes de convertirlo a potencia. */
export interface MetabolicState {
  /** VO₂ estacionario relativo, en ml·kg⁻¹·min⁻¹. */
  vo2Relative: number;
  /** Tasa glucolítica estacionaria, en mmol·l⁻¹·s⁻¹. */
  glycolyticRate: number;
}

export interface MetabolicSweep {
  /** Estados recorridos hasta el cruce, en orden ascendente de intensidad. */
  states: MetabolicState[];
  /** Estado de déficit de piruvato máximo. */
  fatmax: MetabolicState;
  /** Estado interpolado donde la glucólisis iguala a la capacidad oxidativa. */
  mlss: MetabolicState;
}

export function metabolicStateAt(adp: number, vo2max: number, vlamax: number): MetabolicState {
  const { oxidativeAffinity, glycolyticAffinity } = MADER_CONSTANTS;
  return {
    vo2Relative: vo2max / (1 + oxidativeAffinity / adp ** 2),
    glycolyticRate: vlamax / (1 + glycolyticAffinity / adp ** 3),
  };
}

/** Capacidad de oxidación de piruvato expresada en equivalentes de lactato, mmol·l⁻¹·s⁻¹. */
export function oxidativeCapacity(vo2Relative: number): number {
  const { oxygenLactateEquivalent, lactateDistributionVolume } = MADER_CONSTANTS;
  return (oxygenLactateEquivalent * (vo2Relative / 60)) / lactateDistributionVolume;
}

export function pyruvateDeficit(state: MetabolicState): number {
  return oxidativeCapacity(state.vo2Relative) - state.glycolyticRate;
}

/**
 * Recorre el dominio de ADP y localiza los dos anclajes del modelo. Es la única
 * implementación del barrido: el modelo de Mader y el motor de sustratos la comparten
 * para no poder divergir en el MLSS que publican.
 */
export function sweepMetabolicStates(vo2max: number, vlamax: number): MetabolicSweep {
  const { adpStart, adpEnd, adpStep } = MADER_CONSTANTS;
  const states: MetabolicState[] = [];
  let fatmax: MetabolicState | undefined;
  let mlss: MetabolicState | undefined;
  let largestDeficit = -Infinity;
  let previous: MetabolicState | undefined;
  let previousDeficit: number | undefined;

  for (let adp = adpStart; adp <= adpEnd; adp += adpStep) {
    const state = metabolicStateAt(adp, vo2max, vlamax);
    const deficit = pyruvateDeficit(state);

    if (deficit > largestDeficit) {
      largestDeficit = deficit;
      fatmax = state;
    }
    if (previous && previousDeficit != null && previousDeficit > 0 && deficit <= 0) {
      // El déficit es afín en ambas variables primitivas, así que interpolarlas
      // linealmente sitúa el punto exactamente sobre el cruce.
      const fraction = previousDeficit / (previousDeficit - deficit);
      mlss = {
        vo2Relative: previous.vo2Relative + fraction * (state.vo2Relative - previous.vo2Relative),
        glycolyticRate: previous.glycolyticRate + fraction * (state.glycolyticRate - previous.glycolyticRate),
      };
      break;
    }
    states.push(state);
    previous = state;
    previousDeficit = deficit;
  }

  if (!fatmax || !mlss) throw new Error('No se encontró un equilibrio metabólico dentro del dominio del modelo.');
  return { states, fatmax, mlss };
}
