import { useMemo } from 'react';
import { useAnalysis } from '../../analysis/AnalysisContext';
import { LactateSprintWizard } from '../tests/LactateSprintWizard';
import { maderInputsFromObservations } from './maderInputs';
import { MaderView } from './MaderView';

export function TestsWorkspace() {
  const { athlete, loadingAthlete, addObservation } = useAnalysis();
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

      <LactateSprintWizard
        initial={{ baselineLactate: 0, sprintDurationSeconds: 0, alacticTimeSeconds: 0, samples: [] }}
        onConfirm={(vlamax) => {
          void addObservation({
            id: crypto.randomUUID(), athleteId: athlete.id, metricCode: 'vlamax', value: vlamax,
            unit: 'mmol·l⁻¹·s⁻¹', observedAt: new Date().toISOString(), origin: 'field_test',
            quality: 'measured', protocol: { name: 'esprint con lactato', version: 'lactate-sprint@1.0.0' },
          });
        }}
      />

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
