import { useAnalysis } from '../../analysis/AnalysisContext';
import type { Observation } from '../../domain/observation';
import { useState } from 'react';
import { ObservationForm } from '../observations/ObservationForm';
import { ObservationHistory } from '../observations/ObservationHistory';
import { AthleteHeader } from './AthleteHeader';
import { DataQualityPanel } from './DataQualityPanel';
import { IntervalsConnectionPanel } from './IntervalsConnectionPanel';

export type { AthleteApi, AthleteDetail } from './athleteApi';

export function AthleteWorkspace() {
  const {
    athlete,
    athleteId,
    loadingAthlete,
    reloadRoster,
    addObservation,
  } = useAnalysis();

  // La ficha se añade al historial en cuanto se envía, pero confirmar antes de que
  // el servidor responda sería prometer un guardado que aún puede fallar.
  const [saved, setSaved] = useState(false);

  function add(observation: Observation) {
    setSaved(false);
    void addObservation(observation).then((ok) => setSaved(ok));
  }

  return (
    <section className="athlete-workspace" aria-labelledby="athlete-workspace-title">
      <header className="workspace-heading">
        <div>
          <h1 id="athlete-workspace-title">Mesa de análisis</h1>
          <p>Identidad, procedencia y calidad antes de interpretar cualquier número.</p>
        </div>
      </header>
      <IntervalsConnectionPanel onImported={reloadRoster} />
      {athlete ? (
        <>
          <AthleteHeader athlete={athlete} />
          <div className="athlete-data-grid">
            <div><h3>Historial inmutable</h3><ObservationHistory observations={athlete.observations} /></div>
            <DataQualityPanel observations={athlete.observations} />
            <div>
              <ObservationForm athleteId={athlete.id} onAdd={add} />
              {saved && <p role="status" className="field-hint">Observación guardada.</p>}
            </div>
          </div>
        </>
      ) : (
        <div className="workspace-empty" role={loadingAthlete ? 'status' : undefined}>
          <h2>{loadingAthlete ? 'Cargando ciclista…' : 'Selecciona un ciclista'}</h2>
          <p>
            {athleteId
              ? 'Estamos preparando sus observaciones y controles de calidad.'
              : 'El análisis permanece vacío para evitar atribuir datos a la persona equivocada.'}
          </p>
        </div>
      )}
    </section>
  );
}
