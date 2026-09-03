import { useMemo, useState } from 'react';
import { approvePrescription, generatePrescriptionDraft, type ApprovedPrescription, type PrescriptionContext } from '../../prescription/generate';

export function PrescriptionEditor({ context, coachId }: { context: PrescriptionContext; coachId: string }) {
  const generated = useMemo(() => generatePrescriptionDraft(context), [context]);
  const [approved, setApproved] = useState<ApprovedPrescription | null>(null);
  const [override, setOverride] = useState('');
  if (generated.status === 'blocked') return <section className="model-view"><h1>Prescripción bloqueada</h1><div role="alert" className="model-warning">{generated.reasons.join(' ')}</div></section>;
  return <section className="model-view prescription-editor" aria-labelledby="prescription-title">
    <header><div><h1 id="prescription-title">Prescripción explicable</h1><p>{approved ? `Aprobada por ${approved.approval.coachId}` : 'Borrador pendiente de revisión'}</p></div><span className={`quality-chip quality-chip--${approved ? 'valid' : 'warning'}`}>{approved ? 'Aprobada' : 'Borrador'}</span></header>
    <div className="prescription-context"><p><strong>Objetivo</strong>{generated.goal}</p><p><strong>Fase</strong>{generated.phase}</p><p><strong>Disponibilidad</strong>{context.availableDays} días/semana</p></div>
    {generated.sessions.map((session) => <article className="prescription-card" key={session.id}><h2>{session.title}</h2><p><strong>Dosis:</strong> {session.dosage}</p><p><strong>Justificación:</strong> {session.rationale}</p><p><strong>Progresión:</strong> {session.progression}</p><p><strong>Cancelar o modificar si:</strong> {session.stopCriteria.join('; ')}.</p><p><strong>Evaluación:</strong> {session.evaluation}</p><small>{session.reference}</small></article>)}
    <h2>Evidencia congelada</h2><ul>{generated.evidenceSnapshot.map((item) => <li key={item.observationId}>{item.metricCode}: {item.value} {item.unit} · obs. {item.observationId} · {item.quality}</li>)}</ul>
    {generated.safeguards.map((item) => <p className="model-warning" key={item}>{item}</p>)}
    <label className="coach-notes">Ajustes y justificación del entrenador<textarea value={override} onChange={(event) => setOverride(event.target.value)} rows={3} /></label>
    <button type="button" className="primary-action" disabled={approved != null} onClick={() => setApproved(approvePrescription(generated, { coachId, at: new Date().toISOString() }))}>Aprobar prescripción</button>
  </section>;
}
