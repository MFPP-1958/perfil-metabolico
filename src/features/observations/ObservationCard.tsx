import { metricCatalog } from '../../domain/metrics';
import type { Observation } from '../../domain/observation';
import { qualityLabel } from '../athletes/quality';

export function ObservationCard({ observation }: { observation: Observation }) {
  return (
    <article className="observation-card">
      <div><strong>{metricCatalog[observation.metricCode].label}</strong><span>{observation.value} {observation.unit}</span></div>
      <span className={`quality-chip quality-chip--${observation.quality}`}>{qualityLabel(observation.quality)}</span>
      <p>{observation.protocol.name} · {observation.protocol.version}</p>
      <small>{new Date(observation.observedAt).toLocaleString('es-ES')} · {observation.origin}</small>
    </article>
  );
}
