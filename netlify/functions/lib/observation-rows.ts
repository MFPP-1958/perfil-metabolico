import { observationSchema, type Observation } from '../../../src/domain/observation.js';

/** Columnas de `public.observations`. Es el único sitio que conoce este mapeo. */
export interface ObservationRow {
  id: string;
  athlete_id: string;
  created_by: string;
  metric_code: string;
  value: number;
  unit: string;
  observed_at: string;
  origin: string;
  quality: string;
  source_reference: { software: string; version?: string } | null;
  protocol_name: string;
  protocol_version: string;
  notes: string | null;
}

export function toObservationRow(coachId: string, observation: Observation): ObservationRow {
  return {
    id: observation.id,
    athlete_id: observation.athleteId,
    created_by: coachId,
    metric_code: observation.metricCode,
    value: observation.value,
    unit: observation.unit,
    observed_at: observation.observedAt,
    origin: observation.origin,
    quality: observation.quality,
    source_reference: observation.sourceReference ?? null,
    protocol_name: observation.protocol.name,
    protocol_version: observation.protocol.version,
    notes: observation.notes ?? null,
  };
}

/**
 * Devuelve null cuando la fila no supera el contrato del dominio. Una observación de
 * origen externo sin programa registrado entra aquí: se descarta en vez de presentarse
 * como si fuera una medición propia.
 */
export function fromObservationRow(row: ObservationRow | Record<string, unknown>): Observation | null {
  const source = row.source_reference as { software?: unknown; version?: unknown } | null | undefined;
  const parsed = observationSchema.safeParse({
    id: row.id,
    athleteId: row.athlete_id,
    metricCode: row.metric_code,
    value: Number(row.value),
    unit: row.unit,
    observedAt: row.observed_at,
    origin: row.origin,
    quality: row.quality,
    protocol: { name: row.protocol_name, version: row.protocol_version },
    ...(source && typeof source.software === 'string'
      ? { sourceReference: { software: source.software, ...(typeof source.version === 'string' ? { version: source.version } : {}) } }
      : {}),
    ...(row.notes == null ? {} : { notes: row.notes }),
  });
  return parsed.success ? parsed.data : null;
}
