import { evaluateLactateSprint, type LactateSprintSession } from '../../physiology/lactate/protocol';

export function LactateSprintWizard({ initial }: { initial: LactateSprintSession }) {
  const assessment = evaluateLactateSprint(initial);
  const complete = assessment.kind === 'vlamax_estimate';
  return (
    <section className="protocol-view" aria-labelledby="lactate-title">
      <header><div><h1 id="lactate-title">Test de esprint con lactato</h1><p>Estimación condicionada al cumplimiento del protocolo</p></div><span className="model-version">lactate-sprint@1.0.0</span></header>
      <ol className="protocol-steps">
        <li><strong>Preparación</strong><span>Reposo, alimentación, calibración y lactato basal.</span></li>
        <li><strong>Esprint</strong><span>Duración, resistencia, cadencia y tiempo aláctico documentados.</span></li>
        <li><strong>Muestras</strong><span>Minuto y concentración hasta confirmar el pico.</span></li>
        <li><strong>Revisión profesional</strong><span>Confirmación antes de guardar el resultado derivado.</span></li>
      </ol>
      <div className={complete ? 'protocol-result protocol-result--valid' : 'protocol-result protocol-result--warning'}>
        <h2>{complete ? 'VLa máx estimada' : assessment.kind === 'invalid' ? 'Protocolo no válido' : 'Protocolo incompleto'}</h2>
        {assessment.value != null && <p><strong>{assessment.value.toFixed(3)}</strong> {assessment.unit}</p>}
        {assessment.reasons.map((reason) => <p key={reason}>{reason}</p>)}
        {assessment.sensitivity && <small>Sensibilidad por tiempo aláctico: {assessment.sensitivity.lower.toFixed(3)}–{assessment.sensitivity.upper.toFixed(3)} {assessment.unit}</small>}
      </div>
      <table aria-label="Muestras de lactato"><thead><tr><th>Extracción</th><th>Lactato</th></tr></thead><tbody>{initial.samples.map((sample, index) => <tr key={`${sample.minute}-${index}`}><td>{sample.minute == null ? 'Sin minuto' : `${sample.minute} min`}</td><td>{sample.lactate} mmol·l⁻¹</td></tr>)}</tbody></table>
      <button type="button" disabled={!complete}>Confirmar y guardar resultado</button>
    </section>
  );
}
