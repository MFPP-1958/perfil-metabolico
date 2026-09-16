import { metricCatalog } from '../../domain/metrics';
import type { Observation } from '../../domain/observation';
import { qualityLabel } from '../athletes/quality';

const originLabels: Record<Observation['origin'], string> = {
  manual: 'registro manual',
  intervals_icu: 'Intervals.icu',
  laboratory: 'laboratorio',
  field_test: 'test de campo',
  device: 'dispositivo',
  calculated: 'calculado por la aplicación',
  external_model: 'programa externo',
};

function originText(observation: Observation): string {
  const source = observation.sourceReference;
  if (!source) return originLabels[observation.origin];
  return source.version ? `${source.software} ${source.version}` : source.software;
}

export function ObservationCard({ observation }: { observation: Observation }) {
  return (
    <article className="observation-card">
      <div><strong>{metricCatalog[observation.metricCode].label}</strong><span>{observation.value} {observation.unit}</span></div>
      <span className={`quality-chip quality-chip--${observation.quality}`}>{qualityLabel(observation.quality)}</span>
      <p>{observation.protocol.name} · {observation.protocol.version}</p>
      <small>{new Date(observation.observedAt).toLocaleString('es-ES')} · {originText(observation)}</small>
    </article>
  );
}
