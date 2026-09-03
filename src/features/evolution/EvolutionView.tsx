import { classifyChange, type ComparableResult } from '../../physiology/change/meaningful-change';

export function EvolutionView({ observations, typicalError }: { observations: ComparableResult[]; typicalError: number }) {
  const sorted = [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const metric = sorted[0]?.metricCode.toUpperCase() ?? 'métrica';
  return <section className="model-view evolution-view" aria-labelledby="evolution-title">
    <header><div><h1 id="evolution-title">Evolución de {metric}</h1><p>Cambios interpretados con compatibilidad de protocolo y error típico de ±{typicalError} {sorted[0]?.unit}.</p></div></header>
    {sorted.length === 0 ? <p className="workspace-empty">No hay observaciones para comparar.</p> : <table aria-label={`Evolución de ${metric}`}>
      <thead><tr><th>Fecha</th><th>Valor</th><th>Fuente</th><th>Protocolo / versión</th><th>Interpretación</th></tr></thead>
      <tbody>{sorted.map((observation, index) => {
        const assessment = index === 0 ? null : classifyChange(sorted[index - 1], observation, typicalError);
        return <tr key={`${observation.observedAt}-${index}`}>
          <td>{observation.observedAt}</td><td><strong>{observation.value} {observation.unit}</strong></td><td>{observation.source}</td>
          <td>{observation.protocol}<small>{observation.modelVersion ? ` · ${observation.modelVersion}` : ''}</small></td>
          <td>{assessment?.explanation ?? 'Referencia inicial.'}</td>
        </tr>;
      })}</tbody>
    </table>}
    <p className="confidence-note">La clasificación describe compatibilidad y magnitud observada; no atribuye por sí sola una causa al cambio.</p>
  </section>;
}
