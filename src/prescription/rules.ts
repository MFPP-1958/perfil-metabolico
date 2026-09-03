export interface PrescriptionRule {
  id: string;
  title: string;
  rationale: string;
  dosage: string;
  progression: string;
  stopCriteria: string[];
  evaluation: string;
  reference: string;
}

export const prescriptionRules: readonly PrescriptionRule[] = [{
  id: 'aerobic-power-intervals@1.0.0',
  title: 'Intervalos de potencia aeróbica',
  rationale: 'Acumular tiempo de calidad cerca de la potencia asociada al VO₂max, con dosis ajustada por tolerancia y fase.',
  dosage: '4 × 4 min al 90–95 % de P@VO₂max; 4 min de recuperación activa.',
  progression: 'Aumentar una repetición cuando se completen dos sesiones con potencia estable y RPE ≤8.',
  stopCriteria: ['Pérdida de potencia superior al 5 % durante dos repeticiones', 'Dolor, mareo o síntomas anómalos', 'RPE 10 antes de la última repetición'],
  evaluation: 'Revisar potencia media, variabilidad, frecuencia cardiaca, RPE y recuperación a las 24 h.',
  reference: 'Midgley AW, McNaughton LR. Sports Med. 2006;36:117–132. doi:10.2165/00007256-200636020-00003',
}] as const;
