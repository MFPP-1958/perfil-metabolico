export const MADER_MODEL_VERSION = 'mader-reproduction@1.0.0';

export const MADER_CONSTANTS = {
  oxidativeAffinity: 0.0635,
  glycolyticAffinity: 1.1 ** 3,
  oxygenLactateEquivalent: 0.02049,
  lactateDistributionVolume: 0.4,
  adpStart: 0.005,
  adpEnd: 3,
  adpStep: 0.001,
} as const;

export const MADER_EVIDENCE_NOTICE =
  'Reproducción experimental del planteamiento de Mader. La conversión a potencia deduce el coste de oxígeno y no incorpora el efecto de la cadencia. Sus salidas requieren contraste con mediciones independientes.';

export const MADER_REFERENCES = [
  'Mader A. Eine Theorie zur Berechnung der Dynamik und des Steady State von Phosphorylierungszustand und Stoffwechselaktivität der Muskelzelle als Folge des Energiebedarfs (1984).',
  'Mader A, Heck H. A theory of the metabolic origin of anaerobic threshold (1986).',
  'Dunst AK, Hesse C, Ueberschär O. Eur J Appl Physiol (2025). doi:10.1007/s00421-024-05663-4.',
] as const;
