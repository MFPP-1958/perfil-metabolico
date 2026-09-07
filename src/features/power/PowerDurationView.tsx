import { fitPowerDuration } from '../../physiology/power-duration/fit';
import type { PowerDurationFit, PowerDurationInput, PowerDurationModel } from '../../physiology/power-duration/types';
import type { PowerSnapshot } from './powerApi';
import { PowerCurveChart } from './PowerCurveChart';

interface PowerDurationViewProps {
  input: PowerDurationInput;
  model: PowerDurationModel | null;
  fit?: PowerDurationFit | null;
  fitError?: string;
  ftp?: PowerSnapshot['ftp'];
  synchronizedAt?: string;
}

const observedDurations = [
  { seconds: 5, label: 'Mejor 5 s' },
  { seconds: 60, label: 'Mejor 1 min' },
  { seconds: 300, label: 'Mejor 5 min' },
  { seconds: 1200, label: 'Mejor 20 min' },
] as const;

function environmentLabel(indoor: boolean | null) {
  if (indoor === null) return 'Todas las actividades';
  return indoor ? 'Rodillo' : 'Exterior';
}

function calculateFit(input: PowerDurationInput, model: PowerDurationModel | null) {
  if (!model) return { fit: null, error: 'La curva no permite ajustar ECP ni Morton 3P.' };
  try {
    return { fit: fitPowerDuration(input, model), error: '' };
  } catch (reason) {
    return { fit: null, error: reason instanceof Error ? reason.message : 'No se pudo ajustar la curva.' };
  }
}

export function PowerDurationView({
  input,
  model,
  fit: suppliedFit,
  fitError = '',
  ftp = null,
  synchronizedAt,
}: PowerDurationViewProps) {
  const calculated = suppliedFit === undefined ? calculateFit(input, model) : { fit: suppliedFit, error: fitError };
  const fit = calculated.fit;
  const error = calculated.error || fitError;
  const exactBests = observedDurations.flatMap((duration) => {
    const point = input.points.find((candidate) => candidate.seconds === duration.seconds);
    return point ? [{ ...duration, watts: point.watts }] : [];
  });

  return (
    <section className="model-view" aria-labelledby="pd-title">
      <header>
        <div>
          <h1 id="pd-title">Potencia y duración</h1>
          <p>{input.period} · {environmentLabel(input.indoor)}</p>
        </div>
        {fit && <span className="model-version">{fit.algorithmVersion}</span>}
      </header>

      <div className="power-evidence-strip" aria-label="Mejores valores observados">
        <div className="power-observed-bests">
          {exactBests.length ? exactBests.map((best) => (
            <p key={best.seconds}><span>{best.label}</span><strong>{best.watts.toFixed(0)} W</strong></p>
          )) : <p className="power-evidence-empty">No hay mejores en las duraciones de referencia exactas.</p>}
        </div>
        <section className="ftp-evidence" aria-labelledby="ftp-title">
          <h2 id="ftp-title">FTP importado</h2>
          {ftp ? <><strong>{ftp.value.toFixed(0)} W</strong><span>Estimación de Intervals.icu</span></> : <span>No disponible</span>}
        </section>
      </div>

      {!fit ? (
        <section className="power-fit-error" aria-labelledby="fit-error-title">
          <h2 id="fit-error-title">No se puede ajustar este modelo</h2>
          <p>{error || 'No se pudo ajustar la curva.'}</p>
          <p>Sincroniza la curva con más duraciones o elige otro modelo disponible.</p>
        </section>
      ) : (
        <div className="power-model-layout">
          <PowerCurveChart fit={fit} />
          <aside className="power-diagnostics" aria-label="Resultados y calidad del modelo">
            <h2>Resultado modelado</h2>
            <div className="model-summary">
              <p><span>CP modelada</span><strong>{fit.cpWatts.toFixed(0)} W</strong></p>
              <p><span>W′</span><strong>{(fit.wPrimeJoules / 1000).toFixed(1)} kJ</strong></p>
              <p>
                <span>Pmax modelada</span>
                <strong>{fit.pmaxWatts == null ? 'No estimada por ECP' : `${fit.pmaxWatts.toFixed(0)} W`}</strong>
              </p>
              <p><span>RMSE</span><strong>{fit.rmseWatts.toFixed(1)} W</strong></p>
              <p><span>Residuos</span><strong>{Math.max(...fit.points.map((point) => Math.abs(point.residualWatts))).toFixed(1)} W máx.</strong></p>
            </div>
            <dl className="power-provenance">
              <div><dt>Ventana</dt><dd>{input.period}</dd></div>
              <div><dt>Entorno</dt><dd>{environmentLabel(input.indoor)}</dd></div>
              <div><dt>Algoritmo</dt><dd>{fit.algorithmVersion}</dd></div>
              {synchronizedAt && <div><dt>Instantánea</dt><dd><time dateTime={synchronizedAt}>{new Date(synchronizedAt).toLocaleString('es-ES')}</time></dd></div>}
            </dl>
            {!fit.quality.complete && (
              <div className="model-warning">
                <strong>Cobertura incompleta</strong>
                <ul>{fit.quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </div>
            )}
            {fit.quality.complete && <p className="quality-chip quality-chip--valid">Cobertura completa</p>}
          </aside>
        </div>
      )}
    </section>
  );
}
