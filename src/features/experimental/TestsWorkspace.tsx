import { useMemo } from 'react';
import { useAnalysis } from '../../analysis/AnalysisContext';
import { maderInputsFromObservations } from './maderInputs';
import { MaderView } from './MaderView';

export function TestsWorkspace() {
  const { athlete, loadingAthlete } = useAnalysis();
  const observations = useMemo(() => athlete?.observations ?? [], [athlete]);
  const inputs = useMemo(() => maderInputsFromObservations(observations), [observations]);

  if (!athlete) {
    return (
      <section className="empty-state" aria-labelledby="tests-title">
        <h1 id="tests-title">Tests fisiológicos</h1>
        <p>Selecciona un ciclista en la barra de análisis para trabajar con sus pruebas.</p>
      </section>
    );
  }

  return (
    <section className="model-view" aria-labelledby="tests-title">
      <header>
        <p className="eyebrow">Tests fisiológicos</p>
        <h1 id="tests-title">{athlete.name}</h1>
        <p>Protocolos guiados y modelos alimentados por sus propias observaciones.</p>
      </header>

      {loadingAthlete && <p role="status">Cargando las observaciones del ciclista.</p>}

      <div className="protocol-result protocol-result--warning" role="note" aria-labelledby="lactate-pending-title">
        <h2 id="lactate-pending-title">Test de esprint con lactato pendiente de captura</h2>
        <p>El asistente guiado todavía no admite introducir una sesión de esprint: eso es una función con diseño propio, pendiente de construir.</p>
        <p>Mientras tanto, registra la VLa máx en el formulario de observaciones de la mesa de análisis, con origen <code>external_model</code>: la misma vía que ya usas para valores calculados con software de modelado de terceros.</p>
      </div>

      {inputs.status === 'incomplete' ? (
        <div role="alert" className="protocol-result protocol-result--warning">
          <h2>Perfil incompleto</h2>
          <p>El modelo de Mader necesita estas métricas antes de poder calcular nada:</p>
          <ul>
            {inputs.missing.map((metric) => (
              <li key={metric.metricCode}><strong>{metric.label}</strong>: {metric.protocol}</li>
            ))}
          </ul>
          <p>Se añaden en la mesa de análisis, con su origen, su protocolo y su fecha.</p>
        </div>
      ) : (
        <MaderView inputs={inputs.inputs} />
      )}
    </section>
  );
}
