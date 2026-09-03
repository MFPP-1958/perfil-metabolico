import { useState } from 'react';
import { buildReportSnapshot, type ReportAudience, type ReportData } from '../../reports/build-report';
import '../../styles/report.css';

export function ReportBuilder({ data }: { data: ReportData }) {
  const [audience, setAudience] = useState<ReportAudience>('coach');
  const report = buildReportSnapshot(audience, data);
  return <section className="report-builder" aria-labelledby="report-title">
    <div className="report-controls" aria-label="Controles del informe">
      <label>Audiencia<select value={audience} onChange={(event) => setAudience(event.target.value as ReportAudience)}><option value="coach">Entrenador</option><option value="cyclist">Ciclista</option><option value="family">Familia</option></select></label>
      <button type="button" className="primary-action" disabled={report.status !== 'ready'} onClick={() => window.print()}>Imprimir o guardar PDF</button>
    </div>
    {report.status === 'blocked' ? <div role="alert" className="model-warning"><h1 id="report-title">Informe bloqueado</h1>{report.reasons.map((reason) => <p key={reason}>{reason}</p>)}</div> : <article className="print-report">
      <header><p>MFPP Metabolic Lab</p><h1 id="report-title">{report.title}</h1><p>{report.athleteName} · {new Date(report.snapshot.generatedAt).toLocaleDateString('es-ES')}</p></header>
      <p className="report-introduction">{report.introduction}</p>
      <section><h2>Resultados aprobados</h2><table aria-label="Resultados incluidos en el informe"><thead><tr><th>Métrica</th><th>Valor</th><th>Método</th></tr></thead><tbody>{report.results.map((result) => <tr key={result.id}><td>{result.metric}</td><td>{result.value} {result.unit}</td><td>{result.modelVersion}</td></tr>)}</tbody></table></section>
      {report.prescription && <section><h2>Trabajo acordado</h2><p>{report.prescription.summary}</p><small>Aprobación: {report.prescription.approvedBy}</small></section>}
      <section><h2>Qué limita la interpretación</h2>{report.results.map((result) => <p key={result.id}>{result.metric}: {result.limitation}</p>)}</section>
      <footer><strong>Fuentes del dato</strong><ul>{report.citations.map((citation) => <li key={citation}>{citation}</li>)}</ul><small>Instantánea cerrada el {new Date(report.snapshot.generatedAt).toLocaleString('es-ES')}. Los cambios posteriores no modifican este informe.</small></footer>
    </article>}
  </section>;
}
