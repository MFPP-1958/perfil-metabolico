import { useState, type ReactNode } from 'react';
import { DurabilityView } from '../features/durability/DurabilityView';
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
export function DurabilityDemo() { return <ExplicitDemo label="Durabilidad"><DurabilityView fresh={{ sport: 'Ride', indoor: false, observations: 8, points: [{ seconds: 10, watts: 940 }, { seconds: 60, watts: 560 }, { seconds: 300, watts: 365 }, { seconds: 1200, watts: 315 }] }} fatigued={{ sport: 'Ride', indoor: false, observations: 6, points: [{ seconds: 10, watts: 900 }, { seconds: 60, watts: 525 }, { seconds: 300, watts: 338 }, { seconds: 1200, watts: 292 }] }} workload={{ priorKjPerKg: 28, priorWorkAboveCpKj: 42, intensityDistribution: { low: 72, moderate: 18, high: 10 } }} /></ExplicitDemo>; }
export function TestsDemo() { return <ExplicitDemo label="Tests fisiológicos"><LactateSprintWizard initial={{ baselineLactate: 1.2, sprintDurationSeconds: 15, alacticTimeSeconds: 3, samples: [{ minute: 1, lactate: 6.1 }, { minute: 3, lactate: 9.4 }, { minute: 5, lactate: 10.2 }, { minute: 7, lactate: 9.9 }] }} /><MaderView inputs={{ vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'demo-vo2' }, vlamax: { value: .8, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'demo-vla' }, bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'demo-mass' }, pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'demo-pvo2' }, cadenceRpm: 92, comparison: { ftpWatts: 295, cpWatts: 305, mlssMeasuredWatts: 282 } }} /></ExplicitDemo>; }

const planned = { title: '3 × 5 min VO₂', blocks: [{ id: 'w', kind: 'warmup' as const, durationSeconds: 600, target: { type: 'power' as const, min: 150, max: 210 } }, { id: 'r1', kind: 'work' as const, durationSeconds: 300, target: { type: 'power' as const, min: 330, max: 350 } }, { id: 'c', kind: 'cooldown' as const, durationSeconds: 600, target: { type: 'heart_rate' as const, min: 90, max: 130 } }] };
const completed = { title: 'VO₂ martes', blocks: [{ plannedKind: 'warmup' as const, durationSeconds: 600, averagePower: 180, variabilityIndex: 1.03, averageHeartRate: 128, averageCadence: 90, rpe: 3 }, { plannedKind: 'work' as const, durationSeconds: 290, averagePower: 337, variabilityIndex: 1.04, averageHeartRate: 174, averageCadence: 96, rpe: 8 }, { plannedKind: 'cooldown' as const, durationSeconds: 550, averagePower: 135, variabilityIndex: 1.08, averageHeartRate: 125, averageCadence: 84, rpe: 2 }] };
export function SessionsDemo() { return <ExplicitDemo label="Sesiones"><SessionReview planned={planned} completed={completed} /></ExplicitDemo>; }
export function EvolutionDemo() { return <ExplicitDemo label="Evolución"><EvolutionView typicalError={5} observations={[{ value: 300, unit: 'W', metricCode: 'cp', protocol: 'ecp@1', observedAt: '2026-05-01', modelVersion: 'ecp@1.0.0', source: 'Intervals.icu' }, { value: 308, unit: 'W', metricCode: 'cp', protocol: 'ecp@1', observedAt: '2026-08-01', modelVersion: 'ecp@1.0.0', source: 'Intervals.icu' }]} /></ExplicitDemo>; }
export function PrescriptionDemo() { return <ExplicitDemo label="Prescripción"><PrescriptionEditor coachId="entrenador-demo" context={{ athleteId: 'demo', age: 30, goal: 'Mejorar potencia aeróbica', phase: 'desarrollo', availableDays: 4, evidence: [{ metricCode: 'p_vo2max', value: 400, unit: 'W', observationId: 'demo-pvo2', quality: 'measured' }] }} /></ExplicitDemo>; }
export function ReportsDemo() { return <ExplicitDemo label="Informes"><ReportBuilder data={{ athleteId: 'demo', athleteName: 'Ciclista de demostración', generatedAt: '2026-09-03T16:00:00Z', results: [{ id: 'demo-cp', metric: 'CP', value: 305, unit: 'W', status: 'approved', modelVersion: 'ecp@1.0.0', source: 'Curva de potencia Intervals.icu', limitation: 'La estimación depende de la cobertura de esfuerzos máximos.' }], prescription: { id: 'demo-p', status: 'approved', summary: '4 × 4 min de potencia aeróbica.', approvedBy: 'entrenador-demo' } }} /></ExplicitDemo>; }
