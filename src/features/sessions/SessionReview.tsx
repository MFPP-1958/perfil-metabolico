import { useState } from 'react';
import { alignWorkout } from '../../training/alignment/align';
import type { CompletedWorkout, PlannedWorkoutStructure } from '../../training/alignment/types';

const kindLabels = { warmup: 'Calentamiento', work: 'Trabajo', recovery: 'Recuperación', cooldown: 'Vuelta a la calma' };

export function SessionReview({ planned, completed }: { planned: PlannedWorkoutStructure; completed: CompletedWorkout }) {
  const [notes, setNotes] = useState('');
  const alignment = alignWorkout(planned, completed);
  return <section className="model-view session-review" aria-labelledby="session-title">
    <header><div><h1 id="session-title">Revisión de sesión</h1><p>{planned.title} frente a {completed.title}</p></div><span className={`quality-chip quality-chip--${alignment.confidence === 'high' ? 'valid' : 'warning'}`}>Confianza {alignment.confidence === 'high' ? 'alta' : 'baja'}</span></header>
    {alignment.warnings.map((warning) => <p className="model-warning" key={warning}>{warning}</p>)}
    <table aria-label="Bloques prescritos y realizados"><thead><tr><th>Bloque</th><th>Estado</th><th>Duración</th><th>Potencia</th><th>FC / cadencia</th><th>RPE</th></tr></thead><tbody>
      {alignment.blocks.map((block, index) => <tr key={`${block.planned?.id ?? 'extra'}-${index}`}>
        <td>{block.planned ? kindLabels[block.planned.kind] : 'Bloque adicional'}</td><td>{block.status === 'matched' ? 'Realizado' : block.status === 'skipped' ? 'Omitido' : 'Adicional'}</td>
        <td>{block.completed ? `${block.completed.durationSeconds} s` : '—'}{block.durationCompliancePercent != null ? ` · ${block.durationCompliancePercent.toFixed(0)}%` : ''}</td>
        <td>{block.completed?.averagePower != null ? `${block.completed.averagePower} W` : '—'}{block.powerCompliancePercent != null ? ` · ${block.powerCompliancePercent.toFixed(0)}%` : ''}</td>
        <td>{block.completed?.averageHeartRate ?? '—'} bpm / {block.completed?.averageCadence ?? '—'} rpm</td><td>{block.completed?.rpe ?? '—'}</td>
      </tr>)}
    </tbody></table>
    <label className="coach-notes">Notas del entrenador<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} maxLength={2000} /></label>
  </section>;
}
