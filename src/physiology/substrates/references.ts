export const SUBSTRATE_MODEL_VERSION = 'substrate-metabolism@2.0.0';

export const SUBSTRATE_CONSTANTS = {
  /** 1 unidad glucosilo del glucógeno rinde 2 piruvato. */
  pyruvatePerGlucosyl: 2,
  /** Masa molar de la unidad glucosilo (C6H10O5). */
  glucosylMolarMassGrams: 162.14,
  /** Oxidar 1 mmol de piruvato o lactato consume 3 mmol de O₂: 3 × 22,4 ml. */
  millilitresOxygenPerMmolPyruvate: 67.2,
  /** Palmitato: 23 mol O2 por 256,42 g. */
  litresOxygenPerGramFat: 2.009,
  kcalPerLitreOxygenCarbohydrate: 5.05,
  kcalPerLitreOxygenFat: 4.69,
} as const;

export const SUBSTRATE_LIMITATIONS = [
  'El reparto de sustratos se deriva de la propia glucólisis del modelo de Mader, no de calorimetría indirecta. No se mide VCO₂ ni se estima un cociente respiratorio.',
  'Por debajo de FATmax la oxidación directa de piruvato sin formación neta de lactato no está representada, así que el consumo de carbohidrato es un límite inferior.',
  'La constante de eliminación de lactato de Mader es un parámetro ajustado, no un equivalente químico. El reparto usa la estequiometría real (3 O₂ por piruvato), así que la oxidación de grasa se agota algo antes del MLSS y el pico de la curva queda unos vatios por debajo del FATmax de Mader. La calorimetría muestra que en la realidad se conserva algo de grasa en el MLSS.',
  'FATmax y gramos por hora derivados del modelo no tienen validación publicada frente a calorimetría: son una hipótesis de trabajo, no una medición.',
  'No se publica una concentración de lactato en mmol por litro: el juego de constantes disponible no incluye la cinética de eliminación necesaria para derivarla. Solo se expone la tasa neta de acumulación.',
] as const;

export const SUBSTRATE_REFERENCES = [
  'Frayn KN. Calculation of substrate oxidation rates in vivo from gaseous exchange. J Appl Physiol (1983). doi:10.1152/jappl.1983.55.2.628.',
  'Jeukendrup AE, Wallis GA. Measurement of substrate oxidation during exercise by means of gas exchange measurements. Int J Sports Med (2005). doi:10.1055/s-2004-830512.',
  'Dunst AK, Hesse C, Ueberschär O. Eur J Appl Physiol (2025). doi:10.1007/s00421-024-05663-4.',
] as const;
