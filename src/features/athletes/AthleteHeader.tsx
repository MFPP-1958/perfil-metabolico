import type { AthleteSummary } from './AthleteSelector';

export function AthleteHeader({ athlete, demo = false }: { athlete: AthleteSummary; demo?: boolean }) {
  const initials = athlete.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <header className="selected-athlete">
      <span className="selected-athlete__initials" aria-hidden="true">{initials}</span>
      <div><h2>{athlete.name}</h2><p>{demo ? 'Datos sintéticos; no pertenecen a una persona real' : `Intervals.icu ${athlete.intervalsId}`}</p></div>
      <span className={`quality-chip ${demo ? 'quality-chip--warning' : 'quality-chip--valid'}`}>{demo ? 'Demostración' : 'Vinculado'}</span>
    </header>
  );
}
