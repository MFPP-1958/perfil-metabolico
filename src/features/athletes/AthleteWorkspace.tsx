import { useAnalysis } from '../../analysis/AnalysisContext';
import type { Observation } from '../../domain/observation';
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

  function add(observation: Observation) {
    void addObservation(observation);
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
            <ObservationForm athleteId={athlete.id} onAdd={add} />
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
