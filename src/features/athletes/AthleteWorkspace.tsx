import { useEffect, useRef, useState } from 'react';
import type { Observation } from '../../domain/observation';
import { getAccessToken } from '../../auth/supabase';
import { ObservationForm } from '../observations/ObservationForm';
import { ObservationHistory } from '../observations/ObservationHistory';
import { AthleteHeader } from './AthleteHeader';
import { AthleteSelector, type AthleteSummary } from './AthleteSelector';
import { DataQualityPanel } from './DataQualityPanel';

export interface AthleteDetail extends AthleteSummary { observations: Observation[] }
export interface AthleteApi {
  list(): Promise<AthleteSummary[]>;
  load(id: string, signal?: AbortSignal): Promise<AthleteDetail>;
}

const defaultApi: AthleteApi = {
  async list() {
    const token = await getAccessToken();
    const response = await fetch('/.netlify/functions/athletes', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('No se pudo cargar la lista de ciclistas.');
    const athletes = await response.json() as { id: string; name: string }[];
    return athletes.map((athlete) => ({ id: athlete.id, intervalsId: athlete.id, name: athlete.name }));
  },
  async load(id, signal) {
    const token = await getAccessToken();
    const query = new URLSearchParams({ athleteId: id });
    const response = await fetch(`/.netlify/functions/athletes?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok) throw new Error('No se pudo cargar el ciclista.');
    const athlete = await response.json() as { id: string; name: string };
    return { id: athlete.id, intervalsId: athlete.id, name: athlete.name, observations: [] };
  },
};

const demoAthlete: AthleteDetail = {
  id: 'a6540e20-25cf-4c49-bc37-c56d7f5534ac', intervalsId: 'demo', name: 'Ciclista de demostración', observations: [],
};

export function AthleteWorkspace({ api = defaultApi }: { api?: AthleteApi }) {
  const [athletes, setAthletes] = useState<AthleteSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [athlete, setAthlete] = useState<AthleteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);

  useEffect(() => {
    void api.list().then(setAthletes).catch((reason) => setError(reason instanceof Error ? reason.message : 'No se pudo cargar la lista.')).finally(() => setLoading(false));
  }, [api]);

  function select(id: string) {
    setSelectedId(id);
    setAthlete(null);
    if (!id) return;
    const current = ++request.current;
    const controller = new AbortController();
    void api.load(id, controller.signal).then((next) => {
      if (current === request.current) setAthlete(next);
    }).catch((reason) => {
      if (current === request.current && reason?.name !== 'AbortError') setError('No se pudo cargar el ciclista.');
    });
  }

  function activateDemo() {
    request.current += 1;
    setSelectedId('');
    setAthlete(demoAthlete);
    setError('');
  }

  return (
    <section className="athlete-workspace" aria-labelledby="athlete-workspace-title">
      <header className="workspace-heading">
        <div><h1 id="athlete-workspace-title">Mesa de análisis</h1><p>Identidad, procedencia y calidad antes de interpretar cualquier número.</p></div>
        <button type="button" className="secondary-action" onClick={activateDemo}>Abrir demostración</button>
      </header>
      <AthleteSelector athletes={athletes} value={selectedId} onChange={select} loading={loading} />
      {error && <p role="alert" className="field-error">{error}</p>}
      {athlete ? (
        <>
          <AthleteHeader athlete={athlete} demo={athlete.intervalsId === 'demo'} />
          <div className="athlete-data-grid">
            <div><h3>Historial inmutable</h3><ObservationHistory observations={athlete.observations} /></div>
            <DataQualityPanel observations={athlete.observations} />
            <ObservationForm athleteId={athlete.id} onAdd={(observation) => setAthlete((current) => current ? { ...current, observations: [observation, ...current.observations] } : current)} />
          </div>
        </>
      ) : <div className="workspace-empty"><h2>Selecciona un ciclista</h2><p>El análisis permanece vacío para evitar atribuir datos a la persona equivocada.</p></div>}
    </section>
  );
}
