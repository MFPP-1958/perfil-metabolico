import { fitPowerDuration } from '../../physiology/power-duration/fit';
import type { PowerDurationInput, PowerDurationModel } from '../../physiology/power-duration/types';

function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  return `${seconds / 60} min`;
}

export function PowerDurationView({ input, model }: { input: PowerDurationInput; model: PowerDurationModel }) {
  const fit = fitPowerDuration(input, model);
  const maxWatts = Math.max(...fit.points.map((point) => point.watts));
  return (
    <section className="model-view" aria-labelledby="pd-title">
      <header><div><h1 id="pd-title">Potencia y duración</h1><p>{input.period} · {input.sport} · {input.indoor === null ? 'entorno sin registrar' : input.indoor ? 'interior' : 'exterior'}</p></div><span className="model-version">{fit.algorithmVersion}</span></header>
      <div className="model-summary"><p><span>CP</span><strong>{fit.cpWatts.toFixed(0)} W</strong></p><p><span>W′</span><strong>{(fit.wPrimeJoules / 1000).toFixed(1)} kJ</strong></p><p><span>RMSE</span><strong>{fit.rmseWatts.toFixed(1)} W</strong></p>{fit.pmaxWatts != null && <p><span>Pmax modelada</span><strong>{fit.pmaxWatts.toFixed(0)} W</strong></p>}</div>
      <div className="curve-plot" aria-hidden="true">{fit.points.map((point) => <i key={point.seconds} style={{ height: `${(point.watts / maxWatts) * 100}%` }} />)}</div>
      {!fit.quality.complete && <div className="model-warning"><strong>Cobertura incompleta</strong><ul>{fit.quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      <table aria-label="Potencia observada y modelada"><thead><tr><th>Duración</th><th>Observada</th><th>Modelada</th><th>Residuo</th></tr></thead><tbody>{fit.points.map((point) => <tr key={point.seconds}><td>{durationLabel(point.seconds)}</td><td>{point.watts.toFixed(0)} W</td><td>{point.modelledWatts.toFixed(0)} W</td><td>{point.residualWatts.toFixed(1)} W</td></tr>)}</tbody></table>
    </section>
  );
}
