import type { Observation } from '../../domain/observation';

export function DataQualityPanel({ observations }: { observations: readonly Observation[] }) {
  const complete = observations.filter((observation) => !['incomplete', 'rejected'].includes(observation.quality)).length;
  return (
    <aside className="quality-panel" aria-label="Calidad de datos">
      <strong>Calidad del conjunto</strong>
      <span>{complete} de {observations.length} observaciones utilizables</span>
      <p>El origen y el protocolo acompañan siempre al valor.</p>
    </aside>
  );
}
