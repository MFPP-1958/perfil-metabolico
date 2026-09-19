import { Fragment, useMemo, useState } from 'react';
import { useAnalysis } from '../../analysis/AnalysisContext';
import { metricCatalog } from '../../domain/metrics';
import type { Observation } from '../../domain/observation';
import { resolveProfile, sourceTier, type ResolvedMetric } from '../../domain/profile';
import { ObservationForm } from '../observations/ObservationForm';
import { ageText, formatDay, formatMetric, sourceText, TIER_SYMBOLS } from './provenance';
import { Wko5BatchForm } from './Wko5BatchForm';

function ValueCell({ observation }: { observation: Observation }) {
  return (
    <>
      <span className="provenance-mark" aria-hidden="true">{TIER_SYMBOLS[sourceTier(observation)]}</span>{' '}
      <strong>{formatMetric(observation.metricCode, observation.value, observation.unit)}</strong>
    </>
  );
}

function RetractControl({ observation, onRetract }: { observation: Observation; onRetract(id: string, reason: string): Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const label = `${metricCatalog[observation.metricCode].label} ${formatMetric(observation.metricCode, observation.value, observation.unit)}`;

  if (!open) {
    return <button type="button" className="text-action" aria-label={`Retirar ${label}`} onClick={() => setOpen(true)}>Retirar</button>;
  }
  return (
    <div className="retract-control">
      <label>Motivo de la retirada
        <input id={`retract-${observation.id}`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Por ejemplo: error al teclear" />
      </label>
      <button
        type="button"
        className="secondary-action"
        disabled={!reason.trim() || busy}
        onClick={() => {
          setBusy(true);
          void onRetract(observation.id, reason.trim()).then((ok) => {
            setBusy(false);
            if (ok) setOpen(false);
          });
        }}
      >
        Confirmar retirada
      </button>
      <button type="button" className="text-action" onClick={() => { setOpen(false); setReason(''); }}>Cancelar</button>
    </div>
  );
}

function MetricRows({ metric, onRetract }: { metric: ResolvedMetric; onRetract(id: string, reason: string): Promise<boolean> }) {
  const [expanded, setExpanded] = useState(false);
  const current = metric.current;
  const alternatives = metric.alternatives.length;
  const alternativesLabel = `${alternatives} ${alternatives === 1 ? 'alternativa' : 'alternativas'}`;

  return (
    <>
      <tr className={metric.expired ? 'metric-row metric-row--expired' : 'metric-row'}>
        <th scope="row">{metric.label}</th>
        <td>{current ? <ValueCell observation={current} /> : <span className="muted">Sin dato</span>}</td>
        <td>{current ? formatDay(current.observedAt) : '—'}</td>
        <td>{current ? sourceText(current) : '—'}</td>
        <td>
          {current && metric.ageDays !== null && (
            metric.expired
              ? <span className="quality-chip quality-chip--warning">Caducado · {ageText(metric.ageDays)}</span>
              : <span className="muted">Vigente · {ageText(metric.ageDays)}</span>
          )}
        </td>
        <td>
          {alternatives > 0 && (
            <button type="button" className="text-action" aria-expanded={expanded} aria-label={`Ver ${alternativesLabel} de ${metric.label}`} onClick={() => setExpanded((value) => !value)}>
              {alternativesLabel}
            </button>
          )}
        </td>
        <td>{current && <RetractControl observation={current} onRetract={onRetract} />}</td>
      </tr>
      {expanded && metric.alternatives.map((observation) => (
        <tr key={observation.id} className="metric-row metric-row--alternative">
          <td><span className="muted">alternativa</span></td>
          <td><ValueCell observation={observation} /></td>
          <td>{formatDay(observation.observedAt)}</td>
          <td>{sourceText(observation)}</td>
          <td />
          <td />
          <td><RetractControl observation={observation} onRetract={onRetract} /></td>
        </tr>
      ))}
    </>
  );
}

export function DataSourcesWorkspace() {
  const { athlete, athleteId, loadingAthlete, today, addObservation, addObservations, retractObservation } = useAnalysis();
  const observations = useMemo(() => athlete?.observations ?? [], [athlete]);
  const profile = useMemo(() => resolveProfile(observations, today), [observations, today]);
  const retracted = observations.filter((observation) => observation.retractedAt);
  const [savedSingle, setSavedSingle] = useState(false);

  if (!athlete) {
    return (
      <section className="workspace workspace-empty" role={loadingAthlete ? 'status' : undefined}>
        <h1>Datos y fuentes</h1>
        <p>{athleteId ? 'Cargando los valores del ciclista…' : 'Selecciona un ciclista en la barra superior para ver y registrar sus valores.'}</p>
      </section>
    );
  }

  return (
    <section className="model-view data-sources" aria-labelledby="data-sources-title">
      <header>
        <div>
          <p className="eyebrow">Datos y fuentes</p>
          <h1 id="data-sources-title">{athlete.name}</h1>
          <p>De dónde sale cada número. Para cada métrica vale el dato vigente de la fuente más fiable; el resto queda como alternativa.</p>
        </div>
      </header>
      <p className="provenance-legend">
        <span>● medido</span><span>◇ calculado por la app</span><span>○ programa externo</span><span>◐ estimación de Intervals.icu</span>
      </p>

      <div className="power-table-scroll" tabIndex={0} role="region" aria-label="Tabla de valores vigentes">
        <table aria-label="Valores vigentes por métrica">
          <thead>
            <tr><th scope="col">Métrica</th><th scope="col">Vigente</th><th scope="col">Fecha de la medición</th><th scope="col">Fuente</th><th scope="col">Estado</th><th scope="col">Alternativas</th><th scope="col"><span className="visually-hidden">Acciones</span></th></tr>
          </thead>
          <tbody>
            {profile.metrics.map((metric) => (
              <Fragment key={metric.metricCode}>
                <MetricRows metric={metric} onRetract={retractObservation} />
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="data-sources__forms">
        <Wko5BatchForm athleteId={athlete.id} today={today} onSubmit={addObservations} />
        <div>
          <ObservationForm
            athleteId={athlete.id}
            onAdd={(observation) => {
              setSavedSingle(false);
              void addObservation(observation).then((ok) => setSavedSingle(ok));
            }}
          />
          {savedSingle && <p role="status" className="field-hint">Valor guardado.</p>}
        </div>
      </div>

      <section aria-labelledby="retired-title" className="data-sources__retired">
        <h2 id="retired-title">Valores retirados</h2>
        {retracted.length ? (
          <ul aria-label="Valores retirados">
            {retracted.map((observation) => (
              <li key={observation.id}>
                <strong>{metricCatalog[observation.metricCode].label}</strong>{' '}
                {formatMetric(observation.metricCode, observation.value, observation.unit)} del {formatDay(observation.observedAt)} ·{' '}
                retirado el {formatDay(observation.retractedAt as string)}: «{observation.retractionReason}»
              </li>
            ))}
          </ul>
        ) : <p className="muted">Ninguno. Un valor retirado deja de usarse en los cálculos pero se conserva aquí.</p>}
      </section>
    </section>
  );
}
