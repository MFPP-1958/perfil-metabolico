import type { Observation } from '../../domain/observation';

const qualityLabels = {
  measured: 'Medido', imported_estimate: 'Estimación importada', calculated: 'Calculado',
  incomplete: 'Incompleto', rejected: 'Rechazado',
} as const;

export function qualityLabel(quality: Observation['quality']) { return qualityLabels[quality]; }
