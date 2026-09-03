import { type FormEvent, useState } from 'react';
import { metricCatalog, type MetricCode } from '../../domain/metrics';
import { observationSchema, type Observation } from '../../domain/observation';

const selectableMetrics: readonly MetricCode[] = ['ftp', 'cp', 'lt1', 'vt1', 'vo2max', 'vlamax', 'lactate', 'body_mass', 'rpe'];

export function ObservationForm({ athleteId, onAdd }: { athleteId: string; onAdd: (observation: Observation) => void }) {
  const [metric, setMetric] = useState<MetricCode>('ftp');
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = observationSchema.safeParse({
      id: crypto.randomUUID(), athleteId, metricCode: metric,
      value: Number(data.get('value')), unit: metricCatalog[metric].unit,
      observedAt: new Date().toISOString(), origin: data.get('origin'), quality: 'measured',
      protocol: { name: String(data.get('protocolName') ?? ''), version: String(data.get('protocolVersion') ?? '') },
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'La observación no es válida.');
      return;
    }
    setError('');
    onAdd(parsed.data);
    event.currentTarget.reset();
  }
  return (
    <form className="observation-form" onSubmit={submit}>
      <h3>Añadir observación</h3>
      <label htmlFor="metric-code">Métrica</label>
      <select id="metric-code" value={metric} onChange={(event) => setMetric(event.target.value as MetricCode)}>
        {selectableMetrics.map((code) => <option key={code} value={code}>{metricCatalog[code].label} ({metricCatalog[code].unit})</option>)}
      </select>
      <label htmlFor="observation-value">Valor</label>
      <input id="observation-value" name="value" type="number" step="any" required />
      <label htmlFor="observation-origin">Origen</label>
      <select id="observation-origin" name="origin" defaultValue="field_test">
        <option value="field_test">Test de campo</option><option value="laboratory">Laboratorio</option><option value="manual">Registro manual</option><option value="device">Dispositivo</option>
      </select>
      <label htmlFor="protocol-name">Protocolo</label>
      <input id="protocol-name" name="protocolName" required defaultValue="Entrada manual" />
      <label htmlFor="protocol-version">Versión</label>
      <input id="protocol-version" name="protocolVersion" required defaultValue="1" />
      {error && <p role="alert" className="field-error">{error}</p>}
      <button type="submit">Añadir observación</button>
    </form>
  );
}
