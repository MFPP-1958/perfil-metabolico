import { useState } from 'react';
import { intervalsConnectionApi, type ImportSummary, type IntervalsConnectionApi, type RosterCandidate } from './intervalsConnectionApi';

type State = 'idle' | 'loading' | 'selection' | 'importing' | 'result' | 'error';

function resultMessage(summary: ImportSummary) {
  const parts = [
    summary.added === 1 ? '1 ciclista incorporado' : `${summary.added} ciclistas incorporados`,
  ];
  if (summary.existing) parts.push(`${summary.existing} ya ${summary.existing === 1 ? 'estaba vinculado' : 'estaban vinculados'}`);
  if (summary.failed.length) parts.push(`${summary.failed.length} sin incorporar`);
  return parts.join('. ');
}

export function IntervalsConnectionPanel({
  api = intervalsConnectionApi,
  onImported,
}: {
  api?: IntervalsConnectionApi;
  onImported(): Promise<void> | void;
}) {
  const [state, setState] = useState<State>('idle');
  const [roster, setRoster] = useState<RosterCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');

  async function discover() {
    setState('loading');
    setMessage('');
    setSelected(new Set());
    try {
      const athletes = await api.discover();
      setRoster(athletes);
      setState('selection');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'No se pudo consultar Intervals.icu.');
      setState('error');
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function importSelection() {
    if (!selected.size) return;
    setState('importing');
    setMessage('');
    try {
      const summary = await api.importSelected([...selected]);
      await onImported();
      setMessage(resultMessage(summary));
      setState('result');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'No se pudieron incorporar los ciclistas seleccionados.');
      setState('error');
    }
  }

  return (
    <section className="intervals-connection" aria-labelledby="intervals-connection-title">
      <div className="intervals-connection__intro">
        <div>
          <h2 id="intervals-connection-title">Conexión con Intervals.icu</h2>
          <p>Consulta tu plantilla y decide qué ciclistas incorporar a esta aplicación.</p>
        </div>
        <button type="button" className="secondary-action" disabled={state === 'loading' || state === 'importing'} onClick={() => void discover()}>
          {state === 'loading' ? 'Conectando…' : state === 'selection' ? 'Actualizar plantilla' : 'Conectar Intervals.icu'}
        </button>
      </div>

      {state === 'selection' && (
        <div className="roster-selection">
          {roster.length ? roster.map((athlete) => (
            <label key={athlete.id}>
              <input aria-label={athlete.name} type="checkbox" checked={selected.has(athlete.id)} onChange={() => toggle(athlete.id)} />
              <span><strong>{athlete.name}</strong><small>{athlete.id}</small></span>
            </label>
          )) : <p className="connection-status">Intervals.icu no ha devuelto ciclistas disponibles.</p>}
          {roster.length > 0 && (
            <button type="button" className="primary-action" disabled={!selected.size} onClick={() => void importSelection()}>
              Incorporar {selected.size} {selected.size === 1 ? 'ciclista' : 'ciclistas'}
            </button>
          )}
        </div>
      )}

      {state === 'importing' && <p className="connection-status" role="status">Incorporando la selección…</p>}
      {state === 'result' && <p className="connection-summary" role="status">{message}</p>}
      {state === 'error' && <p className="field-error connection-status" role="alert">{message}</p>}
    </section>
  );
}
