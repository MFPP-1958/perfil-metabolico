import { type FormEvent, useState } from 'react';
import { metricCatalog, type MetricCode } from '../../domain/metrics';
import { observationSchema, type Observation } from '../../domain/observation';

const selectableMetrics: readonly MetricCode[] = [
  'ftp', 'mftp', 'cp', 'w_prime', 'frc', 'mlss', 'lt1', 'vt1', 'p_vo2max', 'pmax', 'vo2max', 'vlamax', 'lactate', 'body_mass', 'tte', 'rpe',
];

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * La fecha de un valor es la de su medición: un test del día 2 que se anota el 19
 * pertenece al perfil del día 2. Si es hoy, se guarda la hora actual para que el
 * último valor anotado sea también el último en el tiempo.
 */
function observedAtFor(date: string, today: string) {
  if (date === today) return new Date().toISOString();
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12).toISOString();
}

export function ObservationForm({ athleteId, onAdd, today = localToday() }: {
  athleteId: string;
  onAdd: (observation: Observation) => void;
  /** Fecha local de hoy (AAAA-MM-DD); se inyecta en las pruebas. */
  today?: string;
}) {
  const [metric, setMetric] = useState<MetricCode>('ftp');
  const [origin, setOrigin] = useState('field_test');
  const [error, setError] = useState('');
  const modelled = origin === 'external_model';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const software = String(data.get('sourceSoftware') ?? '').trim();
    const softwareVersion = String(data.get('sourceVersion') ?? '').trim();
    const measuredOn = String(data.get('measuredOn') ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredOn)) {
      setError('Indica la fecha de la medición.');
      return;
    }
    if (measuredOn > today) {
      setError('La fecha de la medición no puede ser posterior a hoy.');
      return;
    }
    const parsed = observationSchema.safeParse({
      id: crypto.randomUUID(), athleteId, metricCode: metric,
      value: Number(data.get('value')), unit: metricCatalog[metric].unit,
      observedAt: observedAtFor(measuredOn, today), origin,
      // Un valor que calculó otro programa no es una medición nuestra.
      quality: modelled ? 'calculated' : 'measured',
      protocol: { name: String(data.get('protocolName') ?? ''), version: String(data.get('protocolVersion') ?? '') },
      ...(modelled && software ? { sourceReference: { software, ...(softwareVersion ? { version: softwareVersion } : {}) } } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'La observación no es válida.');
      return;
    }
    setError('');
    onAdd(parsed.data);
    form.reset();
    setOrigin('field_test');
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
      <label htmlFor="observation-date">Fecha de la medición</label>
      <input id="observation-date" name="measuredOn" type="date" required defaultValue={today} />
      <label htmlFor="observation-origin">Origen</label>
      <select id="observation-origin" name="origin" value={origin} onChange={(event) => setOrigin(event.target.value)}>
        <option value="field_test">Test de campo</option>
        <option value="laboratory">Laboratorio</option>
        <option value="manual">Registro manual</option>
        <option value="device">Dispositivo</option>
        <option value="external_model">Calculado por otro programa</option>
      </select>
      {modelled && (
        <>
          <label htmlFor="source-software">Programa</label>
          <input id="source-software" name="sourceSoftware" placeholder="WKO5" />
          <label htmlFor="source-version">Versión del programa</label>
          <input id="source-version" name="sourceVersion" placeholder="5.0.16" />
          <p className="field-hint">El valor se guardará como calculado, no como medido, y los informes dirán de dónde viene.</p>
        </>
      )}
      <label htmlFor="protocol-name">Protocolo</label>
      <input id="protocol-name" name="protocolName" required defaultValue="Entrada manual" />
      <label htmlFor="protocol-version">Versión</label>
      <input id="protocol-version" name="protocolVersion" required defaultValue="1" />
      {error && <p role="alert" className="field-error">{error}</p>}
      <button type="submit">Añadir observación</button>
    </form>
  );
}
