import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAnalysis } from '../../analysis/AnalysisContext';
import { checkThresholdCoherence, COHERENCE_TOLERANCE_PERCENT, resolveProfile, type ProfileGroup, type ResolvedMetric } from '../../domain/profile';
import { runMaderModel } from '../../physiology/mader/model';
import { maderInputsFromProfile } from '../experimental/maderInputs';
import { ageText, formatDay, formatMetric, formatWattsPerKg, sourceText, TIER_SYMBOLS } from './provenance';

const GROUPS: ReadonlyArray<{ group: ProfileGroup; title: string }> = [
  { group: 'capacities', title: 'Capacidades máximas' },
  { group: 'thresholds', title: 'Umbral y capacidad anaeróbica' },
  { group: 'body', title: 'Cuerpo' },
];

const numberFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, signDisplay: 'always' });

function deltaText(metric: ResolvedMetric, previous: ResolvedMetric | undefined, compareDate: string) {
  if (!metric.current || !previous?.current || previous.current.id === metric.current.id) return null;
  const difference = metric.current.value - previous.current.value;
  if (Math.abs(difference) < 1e-9) return `sin cambio respecto al ${formatDay(`${compareDate}T12:00:00`)}`;
  const shown = metric.metricCode === 'tte' ? `${numberFormat.format(Math.round(difference / 60))} min` : `${numberFormat.format(difference)} ${metric.unit}`;
  return `${shown.replace('-', '−')} respecto al ${formatDay(`${compareDate}T12:00:00`)}`;
}

function MetricTile({ metric, bodyMass, previous, compareDate }: { metric: ResolvedMetric; bodyMass: number | null; previous?: ResolvedMetric; compareDate: string }) {
  const current = metric.current;
  if (!current || !metric.tier) return null;
  const perKg = metric.unit === 'W' && bodyMass ? formatWattsPerKg(current.value, bodyMass) : null;
  const delta = compareDate ? deltaText(metric, previous, compareDate) : null;
  return (
    <div role="group" aria-label={metric.label} className={metric.expired ? 'metric-tile metric-tile--expired' : 'metric-tile'}>
      <span className="metric-tile__label">{metric.label}</span>
      <strong className="metric-tile__value">{formatMetric(metric.metricCode, current.value, current.unit)}</strong>
      {perKg && <span className="metric-tile__secondary">{perKg}</span>}
      <span className="metric-tile__source">
        <span aria-hidden="true">{TIER_SYMBOLS[metric.tier]}</span> {sourceText(current)} · {formatDay(current.observedAt)}
      </span>
      <span className={metric.expired ? 'quality-chip quality-chip--warning' : 'metric-tile__age'}>
        {metric.expired ? `Caducado · ${ageText(metric.ageDays ?? 0)}` : ageText(metric.ageDays ?? 0)}
      </span>
      {delta && <span className="metric-tile__delta">{delta}</span>}
    </div>
  );
}

export function ProfileWorkspace() {
  const { athlete, athleteId, loadingAthlete, today } = useAnalysis();
  const [asOf, setAsOf] = useState(today);
  const [compareDate, setCompareDate] = useState('');
  const observations = useMemo(() => athlete?.observations ?? [], [athlete]);
  const validAsOf = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : today;
  const profile = useMemo(() => resolveProfile(observations, validAsOf), [observations, validAsOf]);
  const previous = useMemo(() => (compareDate ? resolveProfile(observations, compareDate) : null), [observations, compareDate]);

  const maderInputs = maderInputsFromProfile(profile);
  const mader = maderInputs.status === 'ready' ? runMaderModel(maderInputs.inputs, { restingVo2: 5 }) : null;
  const coherence = checkThresholdCoherence(profile, mader?.status === 'calculated' ? { label: 'MLSS modelado (Mader)', watts: mader.mlssWatts } : null);
  const bodyMass = profile.byCode.body_mass?.current?.value ?? null;

  if (!athlete) {
    return (
      <section className="workspace workspace-empty" role={loadingAthlete ? 'status' : undefined}>
        <h1>Perfil</h1>
        <p>{athleteId ? 'Cargando el perfil del ciclista…' : 'Selecciona un ciclista en la barra superior para ver su perfil.'}</p>
      </section>
    );
  }

  const missing = profile.metrics.filter((metric) => !metric.current).map((metric) => metric.label);

  return (
    <section className="model-view profile-view" aria-labelledby="profile-title">
      <header>
        <div>
          <p className="eyebrow">Perfil metabólico</p>
          <h1 id="profile-title">{athlete.name}</h1>
          <p>Lo que se sabía del ciclista en la fecha elegida, con la fuente y la antigüedad de cada dato.</p>
        </div>
        <div className="profile-dates">
          <label>Perfil a fecha<input id="profile-date" type="date" value={asOf} max={today} onChange={(event) => setAsOf(event.target.value || today)} /></label>
          <label>Comparar con<input id="profile-compare" type="date" value={compareDate} max={today} onChange={(event) => setCompareDate(event.target.value)} /></label>
        </div>
      </header>

      {GROUPS.map(({ group, title }) => {
        const metrics = profile.metrics.filter((metric) => metric.group === group && metric.current);
        if (!metrics.length) return null;
        return (
          <section key={group} className="profile-group" aria-labelledby={`profile-group-${group}`}>
            <h2 id={`profile-group-${group}`}>{title}</h2>
            <div className="metric-tiles">
              {metrics.map((metric) => (
                <MetricTile key={metric.metricCode} metric={metric} bodyMass={bodyMass} previous={previous?.byCode[metric.metricCode]} compareDate={compareDate} />
              ))}
            </div>
          </section>
        );
      })}
      {missing.length > 0 && (
        <p className="muted">Sin dato a esta fecha: {missing.join(', ')}. Se registran en <Link to="/datos">Datos y fuentes</Link>.</p>
      )}

      <section className="profile-panel" aria-label="Coherencia del umbral">
        <h2>Coherencia del umbral</h2>
        {coherence.status === 'insufficient' && <p>Hace falta al menos dos estimaciones del umbral (FTP, mFTP, CP, MLSS) para comprobar que cuadran.</p>}
        {coherence.status !== 'insufficient' && (
          <ul className="coherence-values">
            {coherence.values.map((value) => (
              <li key={value.label}><span>{value.label}</span> <strong>{Math.round(value.watts)} W</strong></li>
            ))}
          </ul>
        )}
        {coherence.status === 'coherent' && (
          <p><span className="quality-chip quality-chip--valid">Coherentes</span> Se separan un {Math.round(coherence.spreadPercent ?? 0)} %, dentro del {COHERENCE_TOLERANCE_PERCENT} % esperable.</p>
        )}
        {coherence.status === 'discrepant' && (
          <div className="model-warning">
            <p><strong>No cuadran: se separan un {Math.round(coherence.spreadPercent ?? 0)} %.</strong> Miden cosas parecidas y deberían quedar a menos de un {COHERENCE_TOLERANCE_PERCENT} %: uno de ellos está mal.</p>
            {coherence.suspect && <p>Revisa primero: {coherence.suspect.label}.{coherence.suspect.label.includes('Mader') ? ' Depende de la P@VO₂max, el VO₂max y la VLa máx: si alguno está mal, arrastra el resultado.' : ''}</p>}
          </div>
        )}
      </section>

      <section className="profile-panel" aria-label="Modelo metabólico a esta fecha">
        <h2>Modelo metabólico a esta fecha</h2>
        {maderInputs.status === 'incomplete' && (
          <p>Faltan datos para el modelo de Mader: {maderInputs.missing.map((item) => item.label).join(', ')}.</p>
        )}
        {mader?.status === 'blocked' && <p className="model-warning">{mader.reasons.join(' ')}</p>}
        {mader?.status === 'calculated' && maderInputs.status === 'ready' && (
          <>
            <div className="model-summary">
              <p><span>MLSS</span><strong>{Math.round(mader.mlssWatts)} W</strong>{bodyMass ? <small>{formatWattsPerKg(mader.mlssWatts, bodyMass)}</small> : null}</p>
              <p><span>FATmax</span><strong>{Math.round(mader.fatmaxWatts)} W</strong>{bodyMass ? <small>{formatWattsPerKg(mader.fatmaxWatts, bodyMass)}</small> : null}</p>
            </div>
            {maderInputs.warnings.map((warning) => <p key={warning} className="model-warning">{warning}</p>)}
            <p className="muted">Modelo experimental: orienta, no mide. El detalle, los sustratos y los escenarios están en <Link to="/tests">Tests</Link>.</p>
          </>
        )}
      </section>
    </section>
  );
}
