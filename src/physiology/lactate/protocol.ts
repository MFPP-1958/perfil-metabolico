export interface LactateSample { minute: number | null; lactate: number }
export interface LactateSprintSession {
  baselineLactate: number;
  sprintDurationSeconds: number;
  alacticTimeSeconds: number;
  samples: readonly LactateSample[];
}
export interface LactateSprintAssessment {
  kind: 'peak_accumulation_rate' | 'vlamax_estimate' | 'invalid';
  value: number | null;
  unit: 'mmol·l⁻¹·s⁻¹';
  peakLactate: number | null;
  peakMinute: number | null;
  sensitivity?: { lower: number; upper: number; alacticTimeRangeSeconds: [number, number] };
  reasons: string[];
  algorithmVersion: 'lactate-sprint@1.0.0';
}

export function evaluateLactateSprint(session: LactateSprintSession): LactateSprintAssessment {
  const invalid = (reason: string): LactateSprintAssessment => ({ kind: 'invalid', value: null, unit: 'mmol·l⁻¹·s⁻¹', peakLactate: null, peakMinute: null, reasons: [reason], algorithmVersion: 'lactate-sprint@1.0.0' });
  if (!Number.isFinite(session.baselineLactate) || session.baselineLactate < 0 || session.baselineLactate > 2.5) return invalid('El lactato basal es alto o no válido; repite el protocolo en condiciones estables.');
  if (session.sprintDurationSeconds < 10 || session.sprintDurationSeconds > 30) return invalid('La duración del esprint debe estar entre 10 y 30 segundos.');
  if (session.alacticTimeSeconds <= 0 || session.alacticTimeSeconds >= session.sprintDurationSeconds) return invalid('El tiempo aláctico debe ser positivo y menor que el esprint.');
  if (!session.samples.length || session.samples.some((sample) => sample.minute === null || sample.minute! < 0 || !Number.isFinite(sample.lactate))) return invalid('Cada muestra necesita minuto de extracción y concentración válida.');
  const ordered = [...session.samples].sort((a, b) => a.minute! - b.minute!);
  const peakIndex = ordered.reduce((best, sample, index) => sample.lactate > ordered[best].lactate ? index : best, 0);
  const peak = ordered[peakIndex];
  const effectiveSeconds = session.sprintDurationSeconds - session.alacticTimeSeconds;
  const value = (peak.lactate - session.baselineLactate) / effectiveSeconds;
  if (value <= 0) return invalid('El incremento de lactato no es positivo.');
  const peakConfirmed = peakIndex < ordered.length - 1 && ordered.slice(peakIndex + 1).some((sample) => sample.lactate <= peak.lactate);
  const lowAlactic = Math.max(0.5, session.alacticTimeSeconds - 1);
  const highAlactic = Math.min(session.sprintDurationSeconds - 0.5, session.alacticTimeSeconds + 1);
  const delta = peak.lactate - session.baselineLactate;
  return {
    kind: peakConfirmed ? 'vlamax_estimate' : 'peak_accumulation_rate',
    value,
    unit: 'mmol·l⁻¹·s⁻¹',
    peakLactate: peak.lactate,
    peakMinute: peak.minute,
    sensitivity: {
      lower: delta / (session.sprintDurationSeconds - lowAlactic),
      upper: delta / (session.sprintDurationSeconds - highAlactic),
      alacticTimeRangeSeconds: [lowAlactic, highAlactic],
    },
    reasons: peakConfirmed ? [] : ['No hay una muestra posterior que confirme la meseta o el descenso del lactato.'],
    algorithmVersion: 'lactate-sprint@1.0.0',
  };
}
