import { useState, type ReactNode } from 'react';
import { DurabilityView } from '../features/durability/DurabilityView';
import type { DurabilityRow, DurabilitySnapshotResponse } from '../features/durability/durabilityApi';
import { EvolutionView } from '../features/evolution/EvolutionView';
import { MaderView } from '../features/experimental/MaderView';
import { PowerDurationView } from '../features/power/PowerDurationView';
import { PrescriptionEditor } from '../features/prescription/PrescriptionEditor';
import { ReportBuilder } from '../features/reports/ReportBuilder';
import { SessionReview } from '../features/sessions/SessionReview';
import { LactateSprintWizard } from '../features/tests/LactateSprintWizard';

function ExplicitDemo({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <><div className="demo-banner" role="status">Demostración sintética. No corresponde a ningún ciclista.</div>{children}</>;
  return <section className="workspace workspace-empty"><h1>{label}</h1><p>Selecciona un ciclista desde la mesa de análisis o abre datos sintéticos para revisar este módulo.</p><button type="button" className="primary-action" onClick={() => setOpen(true)}>Abrir demostración</button></section>;
}

const powerPoints = [{ seconds: 10, watts: 940 }, { seconds: 60, watts: 560 }, { seconds: 180, watts: 405 }, { seconds: 300, watts: 365 }, { seconds: 1200, watts: 315 }];

export function PowerDemo() { return <ExplicitDemo label="Potencia y duración"><PowerDurationView input={{ points: powerPoints, sport: 'Ride', period: '90 días', indoor: false }} model="MORTON_3P" /></ExplicitDemo>; }

const demoDurabilityRows: DurabilityRow[] = ([10, 60, 300, 1_200] as const).map((seconds, index) => {
  const freshWatts = [940, 560, 365, 315][index];
  return {
    seconds,
    freshWatts,
    levels: {
      kj0: {
        afterKj: 700,
        afterKjPerKg: 10,
        fatiguedWatts: Math.round(freshWatts * .95),
        declinePercent: 5,
        quality: 'observed',
        supportingActivityCount: 3,
        supportingEffortCount: 5,
        powerSource: 'measured',
      },
      kj1: {
        afterKj: 1_400,
        afterKjPerKg: 20,
        fatiguedWatts: Math.round(freshWatts * .9),
        declinePercent: 10,
        quality: 'observed',
        supportingActivityCount: 2,
        supportingEffortCount: 4,
        powerSource: 'measured',
      },
    },
    onsetAfterKj: 700,
    onsetAfterKjPerKg: 10,
  };
});

const demoDurabilitySnapshot: DurabilitySnapshotResponse = {
  id: '51000000-0000-4000-8000-000000000001',
  athleteId: '61000000-0000-4000-8000-000000000001',
  oldest: '2026-06-17',
  newest: '2026-09-14',
  environment: 'all',
  weightKg: 70,
  weightObservedAt: '2026-09-14T09:00:00.000Z',
  synchronizedAt: '2026-09-14T10:00:00.000Z',
  sourceVersion: 'datos-sinteticos@1.0.0',
  result: {
    algorithmVersion: 'durability-record-profile@2.0.0',
    rows: demoDurabilityRows,
    coverage: 'high',
    warnings: ['Ejemplo sintético para revisar la lectura del perfil.'],
  },
};

export function DurabilityDemo({ onClose }: { onClose?: () => void }) {
  return (
    <>
      <div className="demo-banner" role="status">Demostración sintética. No corresponde al ciclista activo.</div>
      {onClose && (
        <div className="demo-toolbar">
          <button type="button" className="secondary-action" onClick={onClose}>Volver al análisis real</button>
        </div>
      )}
      <DurabilityView snapshot={demoDurabilitySnapshot} />
    </>
  );
}
export function TestsDemo() { return <ExplicitDemo label="Tests fisiológicos"><LactateSprintWizard initial={{ baselineLactate: 1.2, sprintDurationSeconds: 15, alacticTimeSeconds: 3, samples: [{ minute: 1, lactate: 6.1 }, { minute: 3, lactate: 9.4 }, { minute: 5, lactate: 10.2 }, { minute: 7, lactate: 9.9 }] }} /><MaderView inputs={{ vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'demo-vo2' }, vlamax: { value: .8, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'demo-vla' }, bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'demo-mass' }, pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'demo-pvo2' }, cadenceRpm: 92, comparison: { ftpWatts: 295, cpWatts: 305, mlssMeasuredWatts: 282 } }} /></ExplicitDemo>; }

const planned = { title: '3 × 5 min VO₂', blocks: [{ id: 'w', kind: 'warmup' as const, durationSeconds: 600, target: { type: 'power' as const, min: 150, max: 210 } }, { id: 'r1', kind: 'work' as const, durationSeconds: 300, target: { type: 'power' as const, min: 330, max: 350 } }, { id: 'c', kind: 'cooldown' as const, durationSeconds: 600, target: { type: 'heart_rate' as const, min: 90, max: 130 } }] };
const completed = { title: 'VO₂ martes', blocks: [{ plannedKind: 'warmup' as const, durationSeconds: 600, averagePower: 180, variabilityIndex: 1.03, averageHeartRate: 128, averageCadence: 90, rpe: 3 }, { plannedKind: 'work' as const, durationSeconds: 290, averagePower: 337, variabilityIndex: 1.04, averageHeartRate: 174, averageCadence: 96, rpe: 8 }, { plannedKind: 'cooldown' as const, durationSeconds: 550, averagePower: 135, variabilityIndex: 1.08, averageHeartRate: 125, averageCadence: 84, rpe: 2 }] };
export function SessionsDemo() { return <ExplicitDemo label="Sesiones"><SessionReview planned={planned} completed={completed} /></ExplicitDemo>; }
export function EvolutionDemo() { return <ExplicitDemo label="Evolución"><EvolutionView typicalError={5} observations={[{ value: 300, unit: 'W', metricCode: 'cp', protocol: 'ecp@1', observedAt: '2026-05-01', modelVersion: 'ecp@1.0.0', source: 'Intervals.icu' }, { value: 308, unit: 'W', metricCode: 'cp', protocol: 'ecp@1', observedAt: '2026-08-01', modelVersion: 'ecp@1.0.0', source: 'Intervals.icu' }]} /></ExplicitDemo>; }
export function PrescriptionDemo() { return <ExplicitDemo label="Prescripción"><PrescriptionEditor coachId="entrenador-demo" context={{ athleteId: 'demo', age: 30, goal: 'Mejorar potencia aeróbica', phase: 'desarrollo', availableDays: 4, evidence: [{ metricCode: 'p_vo2max', value: 400, unit: 'W', observationId: 'demo-pvo2', quality: 'measured' }] }} /></ExplicitDemo>; }
export function ReportsDemo() { return <ExplicitDemo label="Informes"><ReportBuilder data={{ athleteId: 'demo', athleteName: 'Ciclista de demostración', generatedAt: '2026-09-03T16:00:00Z', results: [{ id: 'demo-cp', metric: 'CP', value: 305, unit: 'W', status: 'approved', modelVersion: 'ecp@1.0.0', source: 'Curva de potencia Intervals.icu', limitation: 'La estimación depende de la cobertura de esfuerzos máximos.' }], prescription: { id: 'demo-p', status: 'approved', summary: '4 × 4 min de potencia aeróbica.', approvedBy: 'entrenador-demo' } }} /></ExplicitDemo>; }
