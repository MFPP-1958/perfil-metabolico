import { useMemo, useState } from 'react';
import { metricCatalog } from '../../domain/metrics';
import type { MaderInputs } from '../../physiology/mader/model';
import { bandFor, EVENT_PROFILE_LABELS } from '../../physiology/scenarios/bands';
import { SCENARIO_MINOR_NOTICE } from '../../physiology/scenarios/references';
import { buildMetabolicScenario, type EventProfile } from '../../physiology/scenarios/scenario';
import { ScenarioChart } from './ScenarioChart';

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

function parseOptionalNumber(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

export function ScenarioPanel({ inputs, minor }: { inputs: MaderInputs; minor: boolean }) {
  const [targetVlamaxText, setTargetVlamaxText] = useState('');
  const [targetVo2maxText, setTargetVo2maxText] = useState('');
  const [referencePowerText, setReferencePowerText] = useState('');
  const [eventProfile, setEventProfile] = useState<EventProfile>('rodador');

  const targetVlamax = parseOptionalNumber(targetVlamaxText);
  const targetVo2max = parseOptionalNumber(targetVo2maxText);
  const referencePowerWatts = parseOptionalNumber(referencePowerText);

  const vlamaxCatalog = metricCatalog.vlamax;
  const vo2maxCatalog = metricCatalog.vo2max;

  // La guarda de rango se comprueba aquí, antes de tocar el motor: un valor
  // fuera del catálogo nunca llega a `buildMetabolicScenario`.
  const rangeError = useMemo(() => {
    if (targetVlamax !== undefined && (!Number.isFinite(targetVlamax) || targetVlamax < vlamaxCatalog.min || targetVlamax > vlamaxCatalog.max)) {
      return `La VLa máx objetivo (${targetVlamaxText}) está fuera del rango admisible del catálogo: ${vlamaxCatalog.min}–${vlamaxCatalog.max} ${vlamaxCatalog.unit}.`;
    }
    if (targetVo2max !== undefined && (!Number.isFinite(targetVo2max) || targetVo2max < vo2maxCatalog.min || targetVo2max > vo2maxCatalog.max)) {
      return `El VO₂max objetivo (${targetVo2maxText}) está fuera del rango admisible del catálogo: ${vo2maxCatalog.min}–${vo2maxCatalog.max} ${vo2maxCatalog.unit}.`;
    }
    return undefined;
  }, [targetVlamax, targetVo2max, targetVlamaxText, targetVo2maxText, vlamaxCatalog, vo2maxCatalog]);

  const scenario = useMemo(() => {
    if (targetVlamax === undefined || rangeError) return undefined;
    return buildMetabolicScenario(
      inputs,
      { restingVo2: 5, referencePowerWatts },
      { vlamax: targetVlamax, ...(targetVo2max !== undefined ? { vo2max: targetVo2max } : {}) },
    );
  }, [inputs, targetVlamax, targetVo2max, referencePowerWatts, rangeError]);

  const band = bandFor(eventProfile);

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

      {rangeError && <p role="alert" className="protocol-result protocol-result--warning">{rangeError}</p>}

      {!rangeError && targetVlamax === undefined && (
        <p className="scenario-panel__placeholder">Propón una VLa máx objetivo para comparar el perfil real con el hipotético.</p>
      )}

      {!rangeError && scenario?.status === 'blocked' && (
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
        </>
      )}
    </section>
  );
}
