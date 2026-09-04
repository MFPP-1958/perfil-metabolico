import type { AthleteSummary } from './AthleteSelector';

export function AthleteHeader({ athlete, demo = false, onSync, syncing = false, syncMessage = '' }: {
  athlete: AthleteSummary;
  demo?: boolean;
  onSync?: () => void;
  syncing?: boolean;
  syncMessage?: string;
}) {
  const initials = athlete.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <header className="selected-athlete">
      <span className="selected-athlete__initials" aria-hidden="true">{initials}</span>
      <div><h2>{athlete.name}</h2><p>{demo ? 'Datos sintéticos; no pertenecen a una persona real' : `Intervals.icu ${athlete.intervalsId}`}</p></div>
      <div className="selected-athlete__actions">
        <span className={`quality-chip ${demo ? 'quality-chip--warning' : 'quality-chip--valid'}`}>{demo ? 'Demostración' : 'Vinculado'}</span>
        {!demo && onSync && (
          <button type="button" className="secondary-action" disabled={syncing} onClick={onSync}>
            {syncing ? 'Sincronizando…' : `Sincronizar ${athlete.name}`}
          </button>
        )}
        {syncMessage && <p className="connection-status" role="status">{syncMessage}</p>}
      </div>
    </header>
  );
}
