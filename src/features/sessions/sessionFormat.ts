import type { Observation } from '../../domain/observation';
import type { ReferenceValue, SessionReferences } from '../../training/title-prescription/compliance';
import type { PrescriptionReference, TitlePrescription, TitleTarget } from '../../training/title-prescription/parseTitle';

const REFERENCE_LABELS: Record<PrescriptionReference, string> = { FTP: 'FTP', 'P@VO2max': 'P@VO₂max', 'Pmáx': 'Pmáx' };

// Referencias del ciclista: de qué observación sale cada vatio objetivo.
function latestReference(observations: readonly Observation[], code: Observation['metricCode']): ReferenceValue | null {
  const usable = observations
    .filter((observation) => observation.metricCode === code)
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt));
  // Un valor medido o calculado manda sobre una estimación importada, aunque esta sea más reciente.
  const chosen = usable.find((observation) => observation.quality === 'measured' || observation.quality === 'calculated')
    ?? usable.find((observation) => observation.quality === 'imported_estimate');
  return chosen ? { value: chosen.value, quality: chosen.quality, observedAt: chosen.observedAt } : null;
}

export function referencesFromObservations(observations: readonly Observation[], powerZones: readonly number[] | null): SessionReferences {
  return {
    ftp: latestReference(observations, 'ftp'),
    pVo2max: latestReference(observations, 'p_vo2max'),
    pmax: latestReference(observations, 'pmax'),
    powerZones,
  };
}

// Formatos.
export const decimalFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

export function formatDuration(seconds: number) {
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded} s`;
  if (rounded < 3600) {
    const minutes = Math.floor(rounded / 60);
    const rest = rounded % 60;
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.round((rounded % 3600) / 60);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function targetSummary(target: TitleTarget) {
  if (target.kind === 'watts') return `${target.watts} W`;
  if (target.kind === 'zone') return `Z${target.zone}`;
  const reference = target.reference ? REFERENCE_LABELS[target.reference] : target.unknownReference ?? '';
  return `${decimalFormat.format(target.percent)} % ${reference}`.trim();
}

export function prescriptionSummary(prescription: TitlePrescription) {
  if (!prescription.hasStructure || prescription.reps === null || prescription.repSeconds === null) return 'Sin pauta en el título';
  const structure = prescription.sets && prescription.sets > 1
    ? `${prescription.sets} × ${prescription.reps} × ${formatDuration(prescription.repSeconds)}`
    : `${prescription.reps} × ${formatDuration(prescription.repSeconds)}`;
  return prescription.target ? `${structure} · ${targetSummary(prescription.target)}` : structure;
}

