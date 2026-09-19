import { useEffect, useMemo, useState } from 'react';
import { useAnalysis } from '../../analysis/AnalysisContext';
import { resolvePeriod } from '../../analysis/period';
import type { AnalysisEnvironment } from '../../analysis/types';
import type { Observation } from '../../domain/observation';
import {
  defaultSelection,
  describeReference,
  DURATION_TOLERANCE,
  evaluateCompliance,
  resolveTargetWatts,
  type DetectedInterval,
  type Verdict,
} from '../../training/title-prescription/compliance';
import { findBestEfforts, MAX_PAUSE_SECONDS } from '../../training/title-prescription/bestEfforts';
import { parseTitlePrescription, type PrescriptionReference, type TitlePrescription, type TitleTarget } from '../../training/title-prescription/parseTitle';
import { decimalFormat, formatDuration, prescriptionSummary, referencesFromObservations } from './sessionFormat';
import { sessionsApi as defaultSessionsApi, type SessionActivity, type SessionDetail, type SessionsApi } from './sessionsApi';

const INTERNAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TargetKind = 'percent' | 'watts' | 'zone' | 'none';
type SeriesSource = 'intervals' | 'stream';

interface PrescriptionForm {
  repetitions: string;
  repMinutes: string;
  targetKind: TargetKind;
  targetValue: string;
  reference: PrescriptionReference | '';
}

// ---------- Formatos ----------

function parseNumber(value: string) {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatClock(seconds: number | null) {
  if (seconds == null) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function formFromPrescription(prescription: TitlePrescription): PrescriptionForm {
  const repetitions = prescription.sets !== null && prescription.reps !== null ? String(prescription.sets * prescription.reps) : '';
  const repMinutes = prescription.repSeconds !== null ? String(Math.round(prescription.repSeconds / 60 * 100) / 100) : '';
  const target = prescription.target;
  if (!target) return { repetitions, repMinutes, targetKind: 'none', targetValue: '', reference: 'FTP' };
  if (target.kind === 'watts') return { repetitions, repMinutes, targetKind: 'watts', targetValue: String(target.watts), reference: 'FTP' };
  if (target.kind === 'zone') return { repetitions, repMinutes, targetKind: 'zone', targetValue: String(target.zone), reference: 'FTP' };
  return { repetitions, repMinutes, targetKind: 'percent', targetValue: String(target.percent), reference: target.reference ?? '' };
}

function targetFromForm(form: PrescriptionForm, parsed: TitlePrescription | null): TitleTarget | null {
  const value = parseNumber(form.targetValue);
  if (form.targetKind === 'none' || value === null) return null;
  if (form.targetKind === 'watts') return { kind: 'watts', watts: value };
  if (form.targetKind === 'zone') return { kind: 'zone', zone: Math.round(value) };
  const parsedPercent = parsed?.target?.kind === 'percent' ? parsed.target : null;
  return {
    kind: 'percent',
    percent: value,
    reference: form.reference || null,
    referenceAssumed: false,
    unknownReference: form.reference ? null : parsedPercent?.unknownReference ?? null,
    progressive: false,
  };
}

function matchesEnvironment(activity: SessionActivity, environment: AnalysisEnvironment) {
  if (environment === 'all') return true;
  return activity.indoor === (environment === 'indoor');
}

function VerdictChip({ label, verdict }: { label: string; verdict: Verdict }) {
  const tone = verdict.tone === 'good' ? 'valid' : verdict.tone === 'bad' ? 'rejected' : 'warning';
  return <span className={`quality-chip quality-chip--${tone}`}>{label}: {verdict.label}</span>;
}

// ---------- Detalle de una sesión ----------

function IntervalRows({ rows, selection, onToggle }: { rows: readonly DetectedInterval[]; selection?: readonly number[]; onToggle?: (index: number) => void }) {
  return (
    <>
      {rows.map((interval) => (
        <tr key={interval.index} className={selection?.includes(interval.index) ? 'session-row--selected' : undefined}>
          {selection && onToggle && (
            <td>
              <input
                type="checkbox"
                aria-label={`Intervalo ${interval.index + 1} cuenta como serie`}
                checked={selection.includes(interval.index)}
                disabled={interval.averageWatts == null}
                onChange={() => onToggle(interval.index)}
              />
            </td>
          )}
          <td>{interval.index + 1}</td>
          {selection && <td>{interval.type === 'WORK' ? 'Trabajo' : interval.type === 'RECOVERY' ? 'Recuperación' : interval.type}</td>}
          <td>{formatClock(interval.startSeconds)}</td>
          <td>{formatDuration(interval.movingSeconds)}</td>
          <td>{interval.averageWatts != null ? `${Math.round(interval.averageWatts)} W` : '—'}</td>
          <td>{interval.averageHeartRate != null ? `${Math.round(interval.averageHeartRate)} ppm` : '—'}</td>
          <td>{interval.averageCadence != null ? `${Math.round(interval.averageCadence)} rpm` : '—'}</td>
        </tr>
      ))}
    </>
  );
}

function SessionComparison({ activity, detail, observations }: { activity: SessionActivity; detail: SessionDetail; observations: readonly Observation[] }) {
  const parsed = useMemo(() => parseTitlePrescription(activity.name ?? ''), [activity.name]);
  const [form, setForm] = useState<PrescriptionForm>(() => formFromPrescription(parsed));
  const [manualSelection, setManualSelection] = useState<number[] | null>(null);
  const [chosenSource, setChosenSource] = useState<SeriesSource | null>(null);

  const references = useMemo(() => referencesFromObservations(observations, detail.powerZones), [detail.powerZones, observations]);
  const repetitions = parseNumber(form.repetitions);
  const repSecondsValue = parseNumber(form.repMinutes);
  const repSeconds = repSecondsValue === null ? null : repSecondsValue * 60;
  const target = targetFromForm(form, parsed);
  const resolution = resolveTargetWatts(target, references);
  const automaticSelection = defaultSelection(detail.intervals, repSeconds, repetitions);
  const selection = manualSelection ?? automaticSelection;
  const stream = detail.stream;
  const efforts = stream && repSeconds && repetitions ? findBestEfforts(stream, repSeconds, repetitions) : [];

  // Si Intervals.icu no detectó intervalos de la duración pautada, las series se
  // buscan en la señal de potencia. El entrenador puede cambiar de fuente.
  const automaticSource: SeriesSource = automaticSelection.length === 0 && stream && repSeconds ? 'stream' : 'intervals';
  const source = chosenSource === 'stream' && !stream ? 'intervals' : chosenSource ?? automaticSource;
  const fromStream = source === 'stream';
  const counted = fromStream ? efforts : detail.intervals.filter((interval) => selection.includes(interval.index));
  const result = evaluateCompliance(counted, resolution, { repetitions, repSeconds });
  const noneFits = !fromStream && manualSelection === null && repSeconds !== null && selection.length === 0;

  const update = (patch: Partial<PrescriptionForm>) => setForm((current) => ({ ...current, ...patch }));
  const toggle = (index: number) => setManualSelection(
    selection.includes(index) ? selection.filter((item) => item !== index) : [...selection, index].sort((a, b) => a - b),
  );

  const parsedTarget = parsed.target?.kind === 'percent' ? parsed.target : null;
  const valueLabel = form.targetKind === 'watts' ? 'Vatios' : form.targetKind === 'zone' ? 'Zona' : 'Porcentaje';
  const missingChip = result.missingRepetitions > 0 && !noneFits && (fromStream
    ? `Solo caben ${result.count} ${result.count === 1 ? 'bloque' : 'bloques'} en la actividad`
    : result.missingRepetitions === 1 ? 'Falta 1 serie' : `Faltan ${result.missingRepetitions} series`);

  return (
    <article className="session-comparison" aria-labelledby="session-title">
      <header>
        <p className="eyebrow">{formatDate(activity.startedAt)} · {formatDuration(activity.durationSeconds)}{activity.indoor === true ? ' · rodillo' : activity.indoor === false ? ' · exterior' : ''}</p>
        <h2 id="session-title">{activity.name ?? 'Actividad sin título'}</h2>
      </header>

      <fieldset className="session-prescription">
        <legend>Pauta leída del título</legend>
        <p className="session-note">
          {parsed.hasStructure
            ? `Leído: ${prescriptionSummary(parsed)}${parsed.workMinutes !== null ? ` · ${decimalFormat.format(parsed.workMinutes)} min de trabajo${parsed.workMinutesDerived ? ' (deducidos)' : ''}` : ''}.`
            : 'El título no trae una pauta que se pueda leer. Escríbela aquí para comparar.'}
          {parsedTarget?.referenceAssumed && ' El título no nombra la referencia del porcentaje: se asume FTP.'}
          {parsedTarget?.progressive && ' Es una progresión: se compara con su punto medio.'}
          {parsedTarget?.unknownReference && ` La referencia ${parsedTarget.unknownReference} no está entre las que conoce la aplicación: elige una.`}
        </p>
        <div className="session-prescription__fields">
          <label>Repeticiones<input inputMode="numeric" value={form.repetitions} onChange={(event) => update({ repetitions: event.target.value })} /></label>
          <label>Duración de cada una (min)<input inputMode="decimal" value={form.repMinutes} onChange={(event) => update({ repMinutes: event.target.value })} /></label>
          <label>Objetivo
            <select value={form.targetKind} onChange={(event) => update({ targetKind: event.target.value as TargetKind })}>
              <option value="percent">% de una referencia</option>
              <option value="watts">Vatios</option>
              <option value="zone">Zona de Intervals.icu</option>
              <option value="none">Sin objetivo</option>
            </select>
          </label>
          {form.targetKind !== 'none' && (
            <label>{valueLabel}<input inputMode="decimal" value={form.targetValue} onChange={(event) => update({ targetValue: event.target.value })} /></label>
          )}
          {form.targetKind === 'percent' && (
            <label>Referencia
              <select value={form.reference} onChange={(event) => update({ reference: event.target.value as PrescriptionReference | '' })}>
                <option value="">Sin elegir</option>
                <option value="FTP">FTP</option>
                <option value="P@VO2max">P@VO₂max</option>
                <option value="Pmáx">Pmáx</option>
              </select>
            </label>
          )}
        </div>
        <p className="session-note">
          {resolution.status === 'ok' ? `Objetivo: ${resolution.basis}.` : resolution.reason}
        </p>
      </fieldset>

      <fieldset className="session-source">
        <legend>Series tomadas de</legend>
        <label>
          <input type="radio" name="series-source" checked={!fromStream} onChange={() => setChosenSource('intervals')} />
          Intervalos detectados por Intervals.icu
        </label>
        <label>
          <input type="radio" name="series-source" checked={fromStream} disabled={!stream} onChange={() => setChosenSource('stream')} />
          Mejores bloques de la señal de potencia{stream ? '' : ' (Intervals.icu no ha dado la señal)'}
        </label>
      </fieldset>

      <section aria-label="Resultado" className="session-result">
        <div className="model-summary">
          <p><span>Objetivo</span><strong>{resolution.status === 'ok' ? `${Math.round(resolution.watts)} W` : '—'}</strong></p>
          <p><span>Potencia ejecutada</span><strong>{result.meanWatts !== null ? `${Math.round(result.meanWatts)} W` : '—'}</strong></p>
          <p><span>Cumplimiento</span><strong>{result.powerPercent !== null ? `${Math.round(result.powerPercent)} %` : '—'}</strong></p>
          <p><span>Series</span><strong>{`${result.count} de ${repetitions ?? '—'}`}</strong></p>
          <p><span>Duración media</span><strong>{result.meanSeconds !== null ? formatDuration(result.meanSeconds) : '—'}</strong></p>
          <p><span>Volumen de trabajo</span><strong>{result.meanSeconds !== null ? formatDuration(result.meanSeconds * result.count) : '—'}</strong></p>
        </div>
        <p className="session-verdict">
          <VerdictChip label="Potencia" verdict={result.powerVerdict} />
          {fromStream
            // Los bloques miden lo que pide la pauta por construcción: no hay duración que juzgar.
            ? <span className="quality-chip">Duración: la fija la pauta</span>
            : <VerdictChip label="Duración" verdict={result.durationVerdict} />}
          {missingChip && <span className="quality-chip quality-chip--rejected">{missingChip}</span>}
        </p>
        {noneFits && (
          <p className="model-warning" role="status">
            Ningún intervalo detectado dura lo que pide la pauta ({formatDuration(repSeconds)} ± {Math.round(DURATION_TOLERANCE * 100)} %), así que no hay veredicto.
            Intervals.icu suele trocear los esfuerzos largos en tramos más cortos, o no detectarlos si fueron muy continuos.
            {stream ? ' Elige «Mejores bloques de la señal de potencia» o marca a mano los intervalos.' : ' Si reconoces las series en la tabla, márcalas a mano.'}
          </p>
        )}
        {fromStream && (
          <p className="session-note" role="status">
            {chosenSource === null && 'Intervals.icu no detectó intervalos de la duración pautada, así que las series se buscan en la señal de potencia. '}
            Son los {repetitions ?? ''} bloques de {repSeconds ? formatDuration(repSeconds) : '—'} que, sin solaparse, dan la potencia media más alta de la actividad;
            no se cuenta ningún bloque con una parada de más de {MAX_PAUSE_SECONDS} s dentro. Si la sesión no se hizo como estaba pautada,
            estos bloques son simplemente lo mejor que hubo.
          </p>
        )}
      </section>

      {fromStream ? (
        <>
          <h3>Bloques encontrados en la señal de potencia</h3>
          {efforts.length === 0 ? (
            <p>No cabe ningún bloque de esa duración en la actividad.</p>
          ) : (
            <div className="power-table-scroll" tabIndex={0} role="region" aria-label="Bloques encontrados">
              <table>
                <thead>
                  <tr><th scope="col">N.º</th><th scope="col">Inicio</th><th scope="col">Duración</th><th scope="col">Potencia</th><th scope="col">FC</th><th scope="col">Cadencia</th></tr>
                </thead>
                <tbody><IntervalRows rows={efforts} /></tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <h3>Intervalos detectados por Intervals.icu</h3>
          {detail.intervals.length === 0 ? (
            <p>Intervals.icu no detectó intervalos en esta actividad.</p>
          ) : (
            <div className="power-table-scroll" tabIndex={0} role="region" aria-label="Intervalos detectados">
              <table>
                <thead>
                  <tr><th scope="col">Serie</th><th scope="col">N.º</th><th scope="col">Tipo</th><th scope="col">Inicio</th><th scope="col">Duración</th><th scope="col">Potencia</th><th scope="col">FC</th><th scope="col">Cadencia</th></tr>
                </thead>
                <tbody><IntervalRows rows={detail.intervals} selection={selection} onToggle={toggle} /></tbody>
              </table>
            </div>
          )}
          {manualSelection !== null && (
            <button type="button" className="text-action" onClick={() => setManualSelection(null)}>Volver a la selección automática</button>
          )}
        </>
      )}

      <p className="session-note">
        La pauta se lee del título porque hoy no se prescribe dentro de Intervals.icu. Con los intervalos de Intervals.icu cuentan por
        defecto los de trabajo cuya duración encaja con la pauta; la potencia es siempre la media ponderada por el tiempo. Cuando
        prescribas en Intervals.icu, esto pasará a leer el entrenamiento planificado.
      </p>
    </article>
  );
}

// ---------- Pantalla ----------

interface ListState { key: string; activities: SessionActivity[]; error: string }
interface DetailState { key: string; detail: SessionDetail | null; error: string }

export function SessionsWorkspace({ api = defaultSessionsApi }: { api?: SessionsApi }) {
  const { athleteId, athlete, period, environment, today, sync } = useAnalysis();
  const [listState, setListState] = useState<ListState>({ key: '', activities: [], error: '' });
  const [detailState, setDetailState] = useState<DetailState>({ key: '', detail: null, error: '' });
  const [selectedId, setSelectedId] = useState('');
  const [onlyPrescribed, setOnlyPrescribed] = useState(false);

  const resolved = useMemo(() => {
    try { return resolvePeriod(period, today); } catch { return null; }
  }, [period, today]);
  const validAthlete = INTERNAL_ID.test(athleteId);
  const listKey = validAthlete && resolved ? [athleteId, resolved.oldest, resolved.newest, sync.synchronizedAt ?? ''].join('|') : '';

  useEffect(() => {
    if (!listKey || !resolved) return;
    const controller = new AbortController();
    api.list({ athleteId, oldest: resolved.oldest, newest: resolved.newest }, controller.signal)
      .then((activities) => { if (!controller.signal.aborted) setListState({ key: listKey, activities, error: '' }); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setListState({ key: listKey, activities: [], error: reason instanceof Error ? reason.message : 'No se pudieron leer las sesiones.' });
      });
    return () => controller.abort();
  }, [api, athleteId, listKey, resolved]);

  const detailKey = validAthlete && selectedId ? `${athleteId}|${selectedId}` : '';
  useEffect(() => {
    if (!detailKey) return;
    const controller = new AbortController();
    api.detail({ athleteId, activityId: selectedId }, controller.signal)
      .then((detail) => { if (!controller.signal.aborted) setDetailState({ key: detailKey, detail, error: '' }); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setDetailState({ key: detailKey, detail: null, error: reason instanceof Error ? reason.message : 'No se pudo abrir la sesión.' });
      });
    return () => controller.abort();
  }, [api, athleteId, detailKey, selectedId]);

  const listed = useMemo(() => {
    if (listState.key !== listKey) return [];
    return listState.activities
      .filter((activity) => matchesEnvironment(activity, environment))
      .map((activity) => ({ activity, prescription: parseTitlePrescription(activity.name ?? '') }))
      .filter((item) => !onlyPrescribed || item.prescription.hasStructure)
      .sort((left, right) => Date.parse(right.activity.startedAt) - Date.parse(left.activity.startedAt));
  }, [environment, listKey, listState, onlyPrescribed]);

  if (!validAthlete || !athlete) {
    return (
      <section className="workspace workspace-empty">
        <h1>Sesiones</h1>
        <p>Selecciona un ciclista en la barra superior para revisar sus sesiones.</p>
      </section>
    );
  }

  const loadingList = listState.key !== listKey;
  const selectedActivity = listState.activities.find((activity) => activity.id === selectedId) ?? null;
  const detail = detailState.key === detailKey ? detailState : null;
  const references = referencesFromObservations(athlete.observations, null);

  return (
    <section className="model-view sessions-workspace" aria-labelledby="sessions-title">
      <header>
        <div>
          <p className="eyebrow">Sesiones</p>
          <h1 id="sessions-title">{athlete.name}</h1>
          <p>Lo prescrito frente a lo ejecutado, sesión a sesión.</p>
        </div>
      </header>
      <p className="session-note">
        Referencias del ciclista:{' '}
        {(['ftp', 'pVo2max', 'pmax'] as const).map((key, index) => {
          const label = key === 'ftp' ? 'FTP' : key === 'pVo2max' ? 'P@VO₂max' : 'Pmáx';
          const value = references[key];
          return <span key={key}>{index ? ' · ' : ''}{label} {value ? `${describeReference(value)}` : 'sin registrar'}</span>;
        })}.
      </p>

      {listState.key === listKey && listState.error && <p className="model-warning" role="alert">{listState.error}</p>}

      <div className="sessions-layout">
        <div className="sessions-list">
          <label className="sessions-filter">
            <input type="checkbox" checked={onlyPrescribed} onChange={(event) => setOnlyPrescribed(event.target.checked)} />
            Solo sesiones con pauta
          </label>
          {loadingList && <p role="status">Cargando las actividades del periodo…</p>}
          {!loadingList && !listState.error && listed.length === 0 && (
            <p>No hay actividades guardadas en este periodo. Sincroniza el ciclista para traerlas de Intervals.icu.</p>
          )}
          {listed.length > 0 && (
            <ul aria-label="Actividades del periodo">
              {listed.map(({ activity, prescription }) => (
                <li key={activity.id}>
                  <button
                    type="button"
                    aria-pressed={activity.id === selectedId}
                    className={prescription.hasStructure ? undefined : 'sessions-list__item--plain'}
                    onClick={() => setSelectedId(activity.id)}
                  >
                    <span className="sessions-list__date">{formatDate(activity.startedAt)}</span>
                    <strong>{activity.name ?? 'Actividad sin título'}</strong>
                    <span className="sessions-list__summary">{prescriptionSummary(prescription)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sessions-detail">
          {!selectedActivity && <p className="session-note">Elige una sesión de la lista para compararla con su pauta.</p>}
          {selectedActivity && !detail && <p role="status">Trayendo los intervalos de Intervals.icu…</p>}
          {selectedActivity && detail?.error && <p className="model-warning" role="alert">{detail.error}</p>}
          {selectedActivity && detail?.detail && (
            <SessionComparison key={selectedActivity.id} activity={selectedActivity} detail={detail.detail} observations={athlete.observations} />
          )}
        </div>
      </div>
    </section>
  );
}
