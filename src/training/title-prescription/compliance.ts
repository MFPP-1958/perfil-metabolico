import type { Observation } from '../../domain/observation';
import type { PrescriptionReference, TitleTarget } from './parseTitle';

/** Intervalo detectado por Intervals.icu en la actividad. */
export interface DetectedInterval {
  index: number;
  type: string;
  startSeconds: number | null;
  movingSeconds: number;
  averageWatts: number | null;
  averageHeartRate: number | null;
  averageCadence: number | null;
}

export interface ReferenceValue {
  value: number;
  quality: Observation['quality'];
  observedAt: string;
}

export interface SessionReferences {
  ftp: ReferenceValue | null;
  pVo2max: ReferenceValue | null;
  pmax: ReferenceValue | null;
  /** Límites superiores de cada zona en % del FTP, como los guarda Intervals.icu. */
  powerZones: readonly number[] | null;
}

export type TargetResolution =
  | { status: 'ok'; watts: number; lowWatts: number | null; highWatts: number | null; basis: string }
  | { status: 'missing'; reason: string };

export interface Verdict {
  label: string;
  tone: 'good' | 'mid' | 'bad' | 'none';
}

export interface ComplianceResult {
  count: number;
  meanSeconds: number | null;
  meanWatts: number | null;
  powerPercent: number | null;
  durationPercent: number | null;
  missingRepetitions: number;
  powerVerdict: Verdict;
  durationVerdict: Verdict;
}

const REFERENCE_LABELS: Record<PrescriptionReference, string> = { FTP: 'FTP', 'P@VO2max': 'P@VO₂max', 'Pmáx': 'Pmáx' };
const QUALITY_LABELS: Record<Observation['quality'], string> = {
  measured: 'medido',
  calculated: 'calculado',
  imported_estimate: 'estimación importada',
  incomplete: 'incompleto',
  rejected: 'rechazado',
};

/** Tolerancia de duración para decidir que un intervalo corresponde a una serie (±35 %). */
export const DURATION_TOLERANCE = 0.35;

function referenceValue(reference: PrescriptionReference, references: SessionReferences) {
  if (reference === 'FTP') return references.ftp;
  if (reference === 'P@VO2max') return references.pVo2max;
  return references.pmax;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function describeReference(value: ReferenceValue) {
  return `${Math.round(value.value)} W, ${QUALITY_LABELS[value.quality]}`;
}

export function resolveTargetWatts(target: TitleTarget | null, references: SessionReferences): TargetResolution {
  if (!target) return { status: 'missing', reason: 'La pauta no trae un objetivo de potencia. Escríbelo en los campos de la pauta.' };
  if (target.kind === 'watts') return { status: 'ok', watts: target.watts, lowWatts: null, highWatts: null, basis: `${target.watts} W escritos en la pauta` };

  if (target.kind === 'zone') {
    const ftp = references.ftp;
    const zones = references.powerZones;
    if (!ftp) return { status: 'missing', reason: 'Para resolver una zona hace falta el FTP del ciclista. Añádelo en la mesa de análisis.' };
    const high = zones?.[target.zone - 1];
    if (!zones || high == null) return { status: 'missing', reason: `Intervals.icu no tiene definida la zona ${target.zone} de este ciclista.` };
    const low = target.zone >= 2 ? zones[target.zone - 2] : 0;
    // La última zona llega a 999 %: se acota a 30 puntos sobre su suelo.
    const cappedHigh = Math.min(high, low + 30);
    const bounded = high === cappedHigh;
    return {
      status: 'ok',
      watts: round1(ftp.value * (low + cappedHigh) / 2 / 100),
      lowWatts: round1(ftp.value * low / 100),
      highWatts: bounded ? round1(ftp.value * high / 100) : null,
      basis: `zona ${target.zone} (${low}–${bounded ? `${high} %` : 'sin techo'} del FTP; FTP ${describeReference(ftp)})`,
    };
  }

  if (!target.reference) {
    return { status: 'missing', reason: `La pauta usa ${target.unknownReference ?? 'una referencia'} y la aplicación no sabe a cuántos vatios corresponde. Elige la referencia en los campos de la pauta.` };
  }
  const value = referenceValue(target.reference, references);
  const label = REFERENCE_LABELS[target.reference];
  if (!value) return { status: 'missing', reason: `Falta la ${label} del ciclista. Añádela en la mesa de análisis.` };
  return {
    status: 'ok',
    watts: round1(value.value * target.percent / 100),
    lowWatts: null,
    highWatts: null,
    basis: `${round1(target.percent)} % de ${label} (${describeReference(value)})`,
  };
}

function isWork(interval: DetectedInterval) {
  return interval.type === 'WORK' && interval.averageWatts != null && interval.movingSeconds > 0;
}

/**
 * Qué intervalos cuentan como series por defecto: los de trabajo cuya duración
 * encaja con la pauta. Una sesión trae intervalos ajenos (repechos, tramos en
 * tempo) que falsean el cumplimiento si se promedian. Si no encaja ninguno no se
 * elige nada: promediarlos todos daría un veredicto que no corresponde a la pauta.
 */
export function defaultSelection(intervals: readonly DetectedInterval[], repSeconds: number | null, repetitions: number | null): number[] {
  if (!repSeconds) return [];
  const fitting = intervals.filter((interval) => isWork(interval) && Math.abs(interval.movingSeconds - repSeconds) / repSeconds <= DURATION_TOLERANCE);
  const limited = repetitions && fitting.length > repetitions ? fitting.slice(0, repetitions) : fitting;
  return limited.map((interval) => interval.index);
}

export function verdictFor(percent: number | null): Verdict {
  if (percent == null) return { label: 'Sin dato', tone: 'none' };
  const gap = Math.abs(percent - 100);
  if (gap <= 5) return { label: 'En objetivo', tone: 'good' };
  if (gap <= 12) return { label: percent > 100 ? 'Por encima' : 'Por debajo', tone: 'mid' };
  return { label: percent > 100 ? 'Muy por encima' : 'Muy por debajo', tone: 'bad' };
}

export function evaluateCompliance(
  selected: readonly DetectedInterval[],
  target: TargetResolution,
  prescription: { repetitions: number | null; repSeconds: number | null },
): ComplianceResult {
  const usable = selected.filter((interval) => interval.averageWatts != null && interval.movingSeconds > 0);
  const count = usable.length;
  const totalSeconds = usable.reduce((sum, interval) => sum + interval.movingSeconds, 0);
  const meanSeconds = count ? totalSeconds / count : null;
  // Media ponderada por el tiempo: una serie más larga pesa más, como en un potenciómetro.
  const meanWatts = count ? usable.reduce((sum, interval) => sum + (interval.averageWatts as number) * interval.movingSeconds, 0) / totalSeconds : null;
  const powerPercent = meanWatts != null && target.status === 'ok' ? meanWatts / target.watts * 100 : null;
  const durationPercent = meanSeconds != null && prescription.repSeconds ? meanSeconds / prescription.repSeconds * 100 : null;

  let powerVerdict = verdictFor(powerPercent);
  if (meanWatts != null && target.status === 'ok' && target.lowWatts != null && meanWatts >= target.lowWatts && (target.highWatts == null || meanWatts <= target.highWatts)) {
    powerVerdict = { label: 'En objetivo', tone: 'good' };
  }

  return {
    count,
    meanSeconds,
    meanWatts,
    powerPercent,
    durationPercent,
    missingRepetitions: prescription.repetitions && count < prescription.repetitions ? prescription.repetitions - count : 0,
    powerVerdict,
    durationVerdict: verdictFor(durationPercent),
  };
}
