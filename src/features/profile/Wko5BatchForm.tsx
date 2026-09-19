import { type FormEvent, useState } from 'react';
import { metricCatalog, type MetricCode } from '../../domain/metrics';
import { observationSchema, type Observation } from '../../domain/observation';
import { formatDay } from './provenance';

/**
 * Alta rápida de los valores que da WKO5 (u otro programa de modelado) para un
 * ciclista: todos con la misma fecha y el mismo programa, y guardados juntos.
 */

interface BatchField {
  code: MetricCode;
  label: string;
  /** Convierte lo escrito a la unidad del catálogo (TTE se escribe en minutos). */
  toCatalogUnit?: (value: number) => number;
}

const FIELDS: readonly BatchField[] = [
  { code: 'mftp', label: 'mFTP (W)' },
  { code: 'frc', label: 'FRC (kJ)' },
  { code: 'pmax', label: 'Pmáx (W)' },
  { code: 'tte', label: 'TTE (min)', toCatalogUnit: (minutes) => Math.round(minutes * 60) },
  { code: 'vo2max', label: 'VO₂max (ml/kg/min)' },
  { code: 'vlamax', label: 'VLa máx (mmol/l/s)' },
  { code: 'p_vo2max', label: 'P@VO₂max (W)' },
];

function observedAtFor(date: string, today: string) {
  if (date === today) return new Date().toISOString();
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12).toISOString();
}

function emptyValues() {
  return Object.fromEntries(FIELDS.map((field) => [field.code, ''])) as Record<MetricCode, string>;
}

export function Wko5BatchForm({ athleteId, today, onSubmit }: {
  athleteId: string;
  today: string;
  /** Resuelve a cierto solo si el servidor ha guardado el lote entero. */
  onSubmit(observations: Observation[]): Promise<boolean>;
}) {
  const [date, setDate] = useState(today);
  const [software, setSoftware] = useState('WKO5');
  const [version, setVersion] = useState('');
  const [values, setValues] = useState<Record<MetricCode, string>>(emptyValues);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const program = software.trim() || 'el programa';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved('');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Indica la fecha del cálculo.');
    if (date > today) return setError('La fecha del cálculo no puede ser posterior a hoy.');
    if (!software.trim()) return setError('Indica el programa que calculó los valores.');

    const observations: Observation[] = [];
    for (const field of FIELDS) {
      const raw = values[field.code].trim();
      if (!raw) continue;
      const typed = Number(raw.replace(',', '.'));
      if (!Number.isFinite(typed)) return setError(`${field.label}: escribe un número.`);
      const parsed = observationSchema.safeParse({
        id: crypto.randomUUID(),
        athleteId,
        metricCode: field.code,
        value: field.toCatalogUnit ? field.toCatalogUnit(typed) : typed,
        unit: metricCatalog[field.code].unit,
        observedAt: observedAtFor(date, today),
        origin: 'external_model',
        // Un valor que calculó otro programa no es una medición nuestra.
        quality: 'calculated',
        protocol: { name: `Modelo de ${software.trim()}`, version: version.trim() || 'sin versión' },
        sourceReference: { software: software.trim(), ...(version.trim() ? { version: version.trim() } : {}) },
      });
      if (!parsed.success) return setError(`${field.label}: ${parsed.error.issues[0]?.message ?? 'valor no válido.'}`);
      observations.push(parsed.data);
    }
    if (!observations.length) return setError('Escribe al menos un valor.');

    setError('');
    setSaving(true);
    const ok = await onSubmit(observations);
    setSaving(false);
    if (!ok) return;
    setValues(emptyValues());
    setSaved(`${observations.length === 1 ? 'Guardado 1 valor' : `Guardados ${observations.length} valores`} de ${software.trim()} del ${formatDay(observedAtFor(date, today))}.`);
  }

  return (
    <form className="batch-form" onSubmit={(event) => void submit(event)} aria-labelledby="batch-form-title">
      <h3 id="batch-form-title">Registrar valores de un programa de modelado</h3>
      <p className="field-hint">Escribe solo los que tengas; se guardan juntos, como calculados (no medidos), con la fecha y el programa.</p>
      <div className="batch-form__context">
        <label>Fecha del cálculo en {program}<input id="batch-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        <label>Programa<input id="batch-software" value={software} onChange={(event) => setSoftware(event.target.value)} /></label>
        <label>Versión del programa<input id="batch-version" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="Opcional" /></label>
      </div>
      <div className="batch-form__values">
        {FIELDS.map((field) => (
          <label key={field.code}>{field.label}
            <input
              id={`batch-${field.code}`}
              inputMode="decimal"
              value={values[field.code]}
              onChange={(event) => setValues((current) => ({ ...current, [field.code]: event.target.value }))}
            />
          </label>
        ))}
      </div>
      {error && <p role="alert" className="field-error">{error}</p>}
      {saved && <p role="status" className="field-hint">{saved}</p>}
      <button type="submit" className="primary-action" disabled={saving}>{saving ? 'Guardando…' : `Guardar valores de ${program}`}</button>
    </form>
  );
}
