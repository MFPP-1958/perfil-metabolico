import { calculateDurability, type DurabilitySnapshot, type DurabilityWorkload } from '../../physiology/durability/calculate';

function duration(seconds: number) { return seconds < 60 ? `${seconds} s` : `${seconds / 60} min`; }

export function DurabilityView({ fresh, fatigued, workload }: { fresh: DurabilitySnapshot; fatigued: DurabilitySnapshot; workload: DurabilityWorkload }) {
  const result = calculateDurability(fresh, fatigued, workload);
  return (
    <section className="model-view" aria-labelledby="durability-title">
      <header><div><h1 id="durability-title">Durabilidad</h1><p>Cambio de potencia después de trabajo acumulado</p></div><span className="model-version">durability@1.0.0</span></header>
      <div className="workload-context"><strong>Contexto previo</strong><span>{workload.priorKjPerKg} kJ/kg</span><span>{workload.priorWorkAboveCpKj} kJ sobre CP</span><span>{workload.intensityDistribution.low}/{workload.intensityDistribution.moderate}/{workload.intensityDistribution.high} % baja/moderada/alta</span></div>
      {result.warnings.length > 0 && <div className="model-warning"><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      <table aria-label="Comparación de potencia fresca y fatigada"><thead><tr><th>Duración</th><th>Fresca</th><th>Fatigada</th><th>Cambio</th></tr></thead><tbody>{result.comparisons.map((comparison) => <tr key={comparison.seconds}><td>{duration(comparison.seconds)}</td><td>{comparison.freshWatts} W</td><td>{comparison.fatiguedWatts} W</td><td>{comparison.declinePercent.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %</td></tr>)}</tbody></table>
      <p className="confidence-note">Confianza: {result.confidence}. {result.onsetSeconds ? `El deterioro ≥5 % aparece desde ${duration(result.onsetSeconds)}.` : 'No se identifica un inicio de deterioro con los datos disponibles.'}</p>
    </section>
  );
}
