import type { Observation } from '../../domain/observation';
import { ObservationCard } from './ObservationCard';

export function ObservationHistory({ observations }: { observations: readonly Observation[] }) {
  if (!observations.length) return <p className="empty-state">Todavía no hay observaciones para este ciclista.</p>;
  return <div className="observation-history">{observations.map((item) => <ObservationCard key={item.id} observation={item} />)}</div>;
}
