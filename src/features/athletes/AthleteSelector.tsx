import { useMemo, useState } from 'react';

export interface AthleteSummary { id: string; intervalsId: string; name: string }

export function AthleteSelector({ athletes, value, onChange, loading }: {
  athletes: readonly AthleteSummary[];
  value: string;
  onChange: (id: string) => void;
  loading: boolean;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => athletes.filter((athlete) => athlete.name.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))), [athletes, search]);
  return (
    <div className="athlete-picker">
      <label htmlFor="athlete-search">Buscar ciclista</label>
      <input id="athlete-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      <label htmlFor="athlete-select">Ciclista</label>
      <select id="athlete-select" value={value} onChange={(event) => onChange(event.target.value)} disabled={loading || !athletes.length}>
        <option value="">{loading ? 'Cargando ciclistas…' : athletes.length ? 'Selecciona un ciclista' : 'No hay ciclistas vinculados'}</option>
        {filtered.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name}</option>)}
      </select>
    </div>
  );
}
