import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnalysis } from '../../analysis/AnalysisContext';
import { metricCatalog } from '../../domain/metrics';
import type { MaderInputs } from '../../physiology/mader/model';
import { bandFor, EVENT_PROFILE_LABELS } from '../../physiology/scenarios/bands';
import { SCENARIO_MINOR_NOTICE } from '../../physiology/scenarios/references';
import { buildMetabolicScenario, type EventProfile } from '../../physiology/scenarios/scenario';
import { ScenarioChart } from './ScenarioChart';
import { scenarioApi as defaultScenarioApi, type SavedScenario, type ScenarioApi } from './scenarioApi';

const EVENT_PROFILES: readonly EventProfile[] = ['explosiva', 'rodador', 'escalador', 'fondo'];

function number(value: number, decimals = 0) {
  return value.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Toda cifra de coste lleva su signo explícito, incluso cuando es cero. */
function signed(value: number, decimals = 0) {
  const formatted = number(Math.abs(value), decimals);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return `±${formatted}`;
}

/**
 * Convierte texto a número admitiendo tanto el punto como la coma decimal:
 * un entrenador español escribe «0,8» de forma natural, no como caso límite,
 * y esta misma pantalla se lo devuelve formateado con coma (`toLocaleString`
 * con `es-ES`). Solo se normaliza la primera coma: un segundo separador deja
 * el texto no numérico y cae, correctamente, en `NaN`.
 */
function parseDecimal(text: string): number {
  return Number(text.trim().replace(',', '.'));
}

function parseOptionalNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = parseDecimal(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'error'; message: string };

function formatSavedDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

type TargetValidation =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'out-of-range'; message: string }
  | { status: 'valid'; value: number };

/**
 * Valida un campo de objetivo contra el catálogo, distinguiendo un texto que
 * no es un número de un número que sí lo es pero cae fuera del rango
 * admisible: son dos afirmaciones distintas y el entrenador necesita saber
 * cuál de las dos se le está haciendo.
 */
function validateTarget(text: string, catalog: { min: number; max: number; unit: string }, label: string): TargetValidation {
  const trimmed = text.trim();
  if (trimmed === '') return { status: 'empty' };
  const value = parseDecimal(trimmed);
  if (!Number.isFinite(value)) {
    return { status: 'invalid', message: `${label} objetivo (${text}) no es un número válido.` };
  }
  if (value < catalog.min || value > catalog.max) {
    return {
      status: 'out-of-range',
      message: `${label} objetivo (${text}) está fuera del rango admisible del catálogo: ${catalog.min}–${catalog.max} ${catalog.unit}.`,
    };
  }
  return { status: 'valid', value };
}

export function ScenarioPanel({
  inputs,
  minor,
  api = defaultScenarioApi,
}: {
  inputs: MaderInputs;
  minor: boolean;
  api?: ScenarioApi;
}) {
  const { athleteId } = useAnalysis();
  const [targetVlamaxText, setTargetVlamaxText] = useState('');
  const [targetVo2maxText, setTargetVo2maxText] = useState('');
  const [referencePowerText, setReferencePowerText] = useState('');
  const [eventProfile, setEventProfile] = useState<EventProfile>('rodador');
  const [scenarioName, setScenarioName] = useState('');
  const [rationale, setRationale] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [listError, setListError] = useState('');
  const saveGeneration = useRef(0);
  const listGeneration = useRef(0);

  const referencePowerWatts = parseOptionalNumber(referencePowerText);

  const vlamaxCatalog = metricCatalog.vlamax;
  const vo2maxCatalog = metricCatalog.vo2max;

  // La guarda de rango se comprueba aquí, antes de tocar el motor: un valor
  // fuera del catálogo, o que directamente no es un número, nunca llega a
  // `buildMetabolicScenario`. Las dos situaciones son afirmaciones distintas
  // y llevan mensajes distintos.
  const vlamaxValidation = useMemo(
    () => validateTarget(targetVlamaxText, vlamaxCatalog, 'La VLa máx'),
    [targetVlamaxText, vlamaxCatalog],
  );
  const vo2maxValidation = useMemo(
    () => validateTarget(targetVo2maxText, vo2maxCatalog, 'El VO₂max'),
    [targetVo2maxText, vo2maxCatalog],
  );

  const targetError =
    vlamaxValidation.status === 'invalid' || vlamaxValidation.status === 'out-of-range'
      ? vlamaxValidation.message
      : vo2maxValidation.status === 'invalid' || vo2maxValidation.status === 'out-of-range'
        ? vo2maxValidation.message
        : undefined;

  // Se guarda aparte de `scenario` porque el guardado envía el mismo objeto
  // de objetivos que alimentó el cálculo: recalcularlo en el momento de
  // guardar podría desincronizarse si algún día cambia el orden de los
  // memos.
  const targets = useMemo(() => {
    if (vlamaxValidation.status !== 'valid') return undefined;
    return {
      vlamax: vlamaxValidation.value,
      ...(vo2maxValidation.status === 'valid' ? { vo2max: vo2maxValidation.value } : {}),
    };
  }, [vlamaxValidation, vo2maxValidation]);

  const scenario = useMemo(() => {
    if (!targets || targetError) return undefined;
    return buildMetabolicScenario(inputs, { restingVo2: 5, referencePowerWatts }, targets);
  }, [inputs, targets, referencePowerWatts, targetError]);

  const band = bandFor(eventProfile);

  // Recupera los escenarios guardados de este ciclista al montar el panel y
  // cada vez que cambia de ciclista: es la vía por la que "volver a la ruta"
  // recupera lo guardado, sin depender de nada en el propio navegador.
  useEffect(() => {
    if (!athleteId) return;
    const generation = ++listGeneration.current;
    const controller = new AbortController();
    void api.list(athleteId, controller.signal)
      .then((scenarios) => {
        if (generation !== listGeneration.current || controller.signal.aborted) return;
        setSavedScenarios(scenarios);
        setListError('');
      })
      .catch((reason: unknown) => {
        if (generation !== listGeneration.current || controller.signal.aborted) return;
        setListError(reason instanceof Error ? reason.message : 'No se pudieron cargar los escenarios guardados.');
      });
    return () => {
      listGeneration.current += 1;
      controller.abort();
    };
  }, [api, athleteId]);

  const trimmedScenarioName = scenarioName.trim();
  const trimmedRationale = rationale.trim();
  const canSave = Boolean(
    scenario
    && scenario.status === 'calculated'
    && scenario.comparable
    && trimmedScenarioName !== ''
    && trimmedRationale !== ''
    && saveState.status !== 'saving',
  );

  const handleSave = useCallback(() => {
    if (!scenario || scenario.status !== 'calculated' || !scenario.comparable || !targets) return;
    if (trimmedScenarioName === '' || trimmedRationale === '') return;
    const generation = ++saveGeneration.current;
    setSaveState({ status: 'saving' });
    void api.save({
      athleteId,
      scenarioName: trimmedScenarioName,
      rationale: trimmedRationale,
      eventProfile,
      realInputs: inputs,
      targets,
      referencePowerWatts: scenario.referencePowerWatts,
      config: { restingVo2: 5 },
    })
      .then((saved) => {
        if (generation !== saveGeneration.current) return;
        setSaveState({ status: 'saved' });
        setScenarioName('');
        setRationale('');
        setSavedScenarios((current) => [saved, ...current]);
      })
      .catch((reason: unknown) => {
        if (generation !== saveGeneration.current) return;
        setSaveState({
          status: 'error',
          message: reason instanceof Error ? reason.message : 'No se pudo guardar el escenario.',
        });
      });
  }, [api, athleteId, eventProfile, inputs, scenario, targets, trimmedRationale, trimmedScenarioName]);

  return (
    <section className="model-view experimental-view scenario-panel" aria-labelledby="scenario-title">
      <header>
        <div>
          <p className="eyebrow">Laboratorio de escenarios</p>
          <h2 id="scenario-title">Proponer un perfil objetivo</h2>
          <p>Compara el perfil metabólico real del ciclista con una VLa máx hipotética y lee qué costaría el cambio.</p>
        </div>
      </header>

      {minor && <p className="model-warning" role="note">{SCENARIO_MINOR_NOTICE}</p>}

      <form className="scenario-panel__form" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="scenario-target-vlamax">VLa máx objetivo ({vlamaxCatalog.unit})</label>
        <input
          id="scenario-target-vlamax"
          type="text"
          inputMode="decimal"
          value={targetVlamaxText}
          onChange={(event) => setTargetVlamaxText(event.target.value)}
        />

        <label htmlFor="scenario-target-vo2max">VO₂max objetivo ({vo2maxCatalog.unit}), opcional</label>
        <input
          id="scenario-target-vo2max"
          type="text"
          inputMode="decimal"
          value={targetVo2maxText}
          onChange={(event) => setTargetVo2maxText(event.target.value)}
        />

        <label htmlFor="scenario-reference-power">Potencia de referencia (W), opcional</label>
        <input
          id="scenario-reference-power"
          type="text"
          inputMode="decimal"
          placeholder="Por defecto, el MLSS actual"
          value={referencePowerText}
          onChange={(event) => setReferencePowerText(event.target.value)}
        />

        <label htmlFor="scenario-event-profile">Perfil de la prueba</label>
        <select
          id="scenario-event-profile"
          value={eventProfile}
          onChange={(event) => setEventProfile(event.target.value as EventProfile)}
        >
          {EVENT_PROFILES.map((profile) => (
            <option key={profile} value={profile}>{EVENT_PROFILE_LABELS[profile]}</option>
          ))}
        </select>
      </form>

      {band ? (
        <div className="scenario-panel__band" data-testid="banda-orientativa">
          <p>
            Orientación bibliográfica para «{EVENT_PROFILE_LABELS[band.profile]}»: {number(band.lower, 2)}–{number(band.upper, 2)} {vlamaxCatalog.unit}.
            {' '}Esta banda es una orientación de lectura, nunca un objetivo de prescripción.
          </p>
          <p>Población: {band.population}</p>
          <p>{band.reference}</p>
        </div>
      ) : (
        <p className="scenario-panel__band-empty">
          Este perfil de prueba no tiene banda publicada en las fuentes del proyecto.
        </p>
      )}

      {targetError && <p role="alert" className="protocol-result protocol-result--warning">{targetError}</p>}

      {!targetError && vlamaxValidation.status === 'empty' && (
        <p className="scenario-panel__placeholder">Propón una VLa máx objetivo para comparar el perfil real con el hipotético.</p>
      )}

      {!targetError && scenario?.status === 'blocked' && (
        <div role="alert" className="protocol-result protocol-result--warning">
          <h3>Cálculo bloqueado</h3>
          {scenario.reasons.map((reason) => <p key={reason}>{reason}</p>)}
        </div>
      )}

      {scenario?.status === 'calculated' && (
        <>
          <ScenarioChart scenario={scenario} ftpWatts={inputs.comparison?.ftpWatts} />

          <section aria-labelledby="scenario-cost-title">
            <h3 id="scenario-cost-title">Qué cuesta el cambio</h3>
            <ul className="scenario-panel__cost">
              <li>FATmax, potencia: {signed(scenario.change.fatmaxWattsDelta)} W</li>
              <li>FATmax, oxidación de grasa: {signed(scenario.change.fatmaxFatGramsPerMinDelta, 2)} g/min</li>
              <li>MLSS, potencia: {signed(scenario.change.mlssWattsDelta)} W</li>
              <li>
                Grasa oxidada en la potencia de referencia ({number(scenario.referencePowerWatts)} W):
                {' '}{signed(scenario.change.fatGramsPerMinDeltaAtReference, 2)} g/min
              </li>
              <li>
                Carbohidrato consumido en la potencia de referencia ({number(scenario.referencePowerWatts)} W):
                {' '}{signed(scenario.change.carbohydrateGramsPerHourDeltaAtReference)} g/h
              </li>
              <li>
                % VO₂max en la potencia de referencia: actual {number(scenario.change.percentVo2maxAtReference.current)} %,
                {' '}objetivo {number(scenario.change.percentVo2maxAtReference.target)} %
                {' '}({signed(scenario.change.percentVo2maxAtReference.target - scenario.change.percentVo2maxAtReference.current)} puntos)
              </li>
            </ul>
          </section>

          <div className="durability-table-scroll" tabIndex={0} aria-label="Tabla desplazable de la comparación de perfiles">
            <table aria-label="Comparación de perfiles">
              <thead>
                <tr>
                  <th scope="col">Perfil</th>
                  <th scope="col">VLa máx</th>
                  <th scope="col">VO₂max</th>
                  <th scope="col">FATmax</th>
                  <th scope="col">MLSS</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Perfil actual</th>
                  <td>{number(scenario.realValues.vlamax, 2)} {vlamaxCatalog.unit}</td>
                  <td>{number(scenario.realValues.vo2max)} {vo2maxCatalog.unit}</td>
                  <td>{number(scenario.current.fatmax.powerWatts)} W</td>
                  <td>{number(scenario.current.mlss.powerWatts)} W</td>
                </tr>
                <tr>
                  <th scope="row">Perfil objetivo</th>
                  <td>{number(scenario.appliedTargets.vlamax, 2)} {vlamaxCatalog.unit} (objetivo)</td>
                  <td>{number(scenario.appliedTargets.vo2max)} {vo2maxCatalog.unit} (objetivo)</td>
                  <td>{number(scenario.target.fatmax.powerWatts)} W (objetivo)</td>
                  <td>{number(scenario.target.mlss.powerWatts)} W (objetivo)</td>
                </tr>
                <tr>
                  <th scope="row">Diferencia</th>
                  <td>{signed(scenario.appliedTargets.vlamax - scenario.realValues.vlamax, 2)} {vlamaxCatalog.unit}</td>
                  <td>{signed(scenario.appliedTargets.vo2max - scenario.realValues.vo2max)} {vo2maxCatalog.unit}</td>
                  <td>{signed(scenario.change.fatmaxWattsDelta)} W</td>
                  <td>{signed(scenario.change.mlssWattsDelta)} W</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/*
            `scenario.notices` ya incluye el aviso de "no hay nada que
            comparar" cuando `!scenario.comparable` (ver
            `buildMetabolicScenario`): no se repite aquí para no duplicar el
            mismo aviso en pantalla.
          */}
          {scenario.notices.map((notice) => <p key={notice} className="model-warning" role="note">{notice}</p>)}
          {scenario.provenanceNotices.map((notice) => <p key={notice} className="model-warning" role="note">{notice}</p>)}
          <p className="model-warning" role="note">{scenario.cadenceWarning}</p>

          <ul className="scenario-panel__limits" aria-label="Limitaciones del escenario">
            {scenario.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>

          <section aria-labelledby="scenario-save-title" className="scenario-panel__save">
            <h3 id="scenario-save-title">Guardar este escenario</h3>
            <p>
              Guardar deja constancia de por qué se propone este cambio, junto con las entradas reales, el objetivo
              y la potencia de referencia: sigue siendo reproducible aunque el ciclista vuelva a medirse.
            </p>

            <label htmlFor="scenario-name">Nombre del escenario</label>
            <input
              id="scenario-name"
              type="text"
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value)}
            />

            <label htmlFor="scenario-rationale">Justificación</label>
            <textarea
              id="scenario-rationale"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />

            <button type="button" className="primary-action" disabled={!canSave} onClick={handleSave}>
              {saveState.status === 'saving' ? 'Guardando…' : 'Guardar escenario'}
            </button>

            {saveState.status === 'error' && (
              <p role="alert" className="protocol-result protocol-result--warning">{saveState.message}</p>
            )}
            {saveState.status === 'saved' && <p role="status">Escenario guardado.</p>}
          </section>
        </>
      )}

      <section aria-labelledby="scenario-saved-title" className="scenario-panel__saved">
        <h3 id="scenario-saved-title">Escenarios guardados</h3>
        {listError && <p role="alert" className="protocol-result protocol-result--warning">{listError}</p>}
        {!listError && savedScenarios.length === 0 && (
          <p>Todavía no se ha guardado ningún escenario para este ciclista.</p>
        )}
        {savedScenarios.length > 0 && (
          <ul aria-label="Escenarios guardados">
            {savedScenarios.map((saved) => (
              <li key={saved.id}>
                <time dateTime={saved.createdAt}>{formatSavedDate(saved.createdAt)}</time>
                {' — '}
                {saved.scenarioName}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
