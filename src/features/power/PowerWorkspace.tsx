import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnalysis } from '../../analysis/AnalysisContext';
import { resolvePeriod } from '../../analysis/period';
import { fitPowerDuration } from '../../physiology/power-duration/fit';
import { assessCurveCompleteness } from '../../physiology/power-duration/quality';
import type { PowerDurationInput, PowerDurationModel } from '../../physiology/power-duration/types';
import { PowerDurationView } from './PowerDurationView';
import {
  powerApi as defaultPowerApi,
  type ConfirmedPowerAnalysis,
  type PowerApi,
  type PowerSnapshot,
} from './powerApi';

interface ConfirmationState {
  status: 'idle' | 'saving' | 'saved' | 'error';
  result: ConfirmedPowerAnalysis | null;
  message: string;
}

interface LoadState {
  key: string;
  error: string;
  snapshot: PowerSnapshot | null;
}

const INTERNAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emptyConfirmation: ConfirmationState = { status: 'idle', result: null, message: '' };
const emptyLoad: LoadState = { key: '', error: '', snapshot: null };

function modelAvailability(points: PowerSnapshot['points']) {
  const durations = new Set(points.map((point) => point.seconds));
  const ecpDurations = new Set(points.filter((point) => point.seconds >= 120).map((point) => point.seconds));
  return {
    ecp: ecpDurations.size >= 2,
    morton: durations.size >= 3,
  };
}

function recommendedModel(points: PowerSnapshot['points']): PowerDurationModel | null {
  const quality = assessCurveCompleteness(points);
  const missingShort = quality.warnings.some((warning) => warning.includes('15 s'));
  const missingLong = quality.warnings.some((warning) => warning.includes('20 min'));
  const available = modelAvailability(points);
  if (available.morton && !missingShort && !missingLong) return 'MORTON_3P';
  if (available.ecp) return 'ECP';
  if (available.morton) return 'MORTON_3P';
  return null;
}

function makeInput(snapshot: PowerSnapshot): PowerDurationInput {
  return {
    points: snapshot.points,
    sport: 'Ride',
    period: `${snapshot.oldest}–${snapshot.newest}`,
    indoor: snapshot.environment === 'all' ? null : snapshot.environment === 'indoor',
  };
}

function fitSnapshot(snapshot: PowerSnapshot, model: PowerDurationModel) {
  try {
    return { fit: fitPowerDuration(makeInput(snapshot), model), error: '' };
  } catch (reason) {
    return {
      fit: null,
      error: reason instanceof Error ? reason.message : 'No se pudo ajustar la curva.',
    };
  }
}

function snapshotMatches(
  snapshot: PowerSnapshot | null,
  athleteId: string,
  oldest: string,
  newest: string,
  environment: PowerSnapshot['environment'],
) {
  return Boolean(
    snapshot
    && snapshot.athleteId === athleteId
    && snapshot.oldest === oldest
    && snapshot.newest === newest
    && snapshot.environment === environment,
  );
}

function SyntheticPowerDemo({ onClose }: { onClose(): void }) {
  return (
    <>
      <div className="demo-banner" role="status">Demostración sintética. No corresponde al ciclista activo.</div>
      <div className="demo-toolbar">
        <button type="button" className="secondary-action" onClick={onClose}>Volver al análisis real</button>
      </div>
      <PowerDurationView
        input={{
          points: [
            { seconds: 5, watts: 940 },
            { seconds: 60, watts: 560 },
            { seconds: 180, watts: 405 },
            { seconds: 300, watts: 365 },
            { seconds: 1200, watts: 315 },
          ],
          sport: 'Ride',
          period: 'Demostración de 90 días',
          indoor: false,
        }}
        model="MORTON_3P"
      />
    </>
  );
}

export function PowerWorkspace({ api = defaultPowerApi }: { api?: PowerApi }) {
  const { athleteId, period, environment, today, sync, synchronize } = useAnalysis();
  const [loadState, setLoadState] = useState<LoadState>(emptyLoad);
  const [selectedModel, setSelectedModel] = useState<PowerDurationModel | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(emptyConfirmation);
  const [retryVersion, setRetryVersion] = useState(0);
  const [demoOpen, setDemoOpen] = useState(false);
  const requestGeneration = useRef(0);
  const confirmationGeneration = useRef(0);

  const resolved = useMemo(() => {
    try {
      return { period: resolvePeriod(period, today), error: '' };
    } catch (reason) {
      return {
        period: null,
        error: reason instanceof Error ? reason.message : 'El periodo seleccionado no es válido.',
      };
    }
  }, [period, today]);
  const hasValidAthlete = INTERNAL_ID.test(athleteId);
  const scopeKey = hasValidAthlete && resolved.period
    ? [athleteId, resolved.period.oldest, resolved.period.newest, environment].join('|')
    : '';
  const requestKey = scopeKey
    ? [scopeKey, sync.synchronizedAt ?? '', retryVersion].join('|')
    : '';
  const compatibleSnapshot = resolved.period && snapshotMatches(
    loadState.snapshot,
    athleteId,
    resolved.period.oldest,
    resolved.period.newest,
    environment,
  ) ? loadState.snapshot : null;
  const loading = Boolean(requestKey) && loadState.key !== requestKey;
  const snapshot = compatibleSnapshot;
  const error = loadState.key === requestKey ? loadState.error : '';

  useEffect(() => {
    if (demoOpen || !hasValidAthlete || !resolved.period) return;
    const generation = ++requestGeneration.current;
    confirmationGeneration.current += 1;
    const controller = new AbortController();
    void api.load({
      athleteId,
      oldest: resolved.period.oldest,
      newest: resolved.period.newest,
      environment,
    }, controller.signal).then((next) => {
      if (generation !== requestGeneration.current || controller.signal.aborted) return;
      setSelectedModel(recommendedModel(next.points));
      setLoadState({ key: requestKey, error: '', snapshot: next });
      setConfirmation(emptyConfirmation);
    }).catch((reason: unknown) => {
      if (generation !== requestGeneration.current || controller.signal.aborted) return;
      setLoadState((current) => ({
        key: requestKey,
        error: reason instanceof Error ? reason.message : 'No se pudo cargar la curva de potencia.',
        snapshot: snapshotMatches(
          current.snapshot,
          athleteId,
          resolved.period!.oldest,
          resolved.period!.newest,
          environment,
        ) ? current.snapshot : null,
      }));
      setConfirmation(emptyConfirmation);
    });

    return () => {
      requestGeneration.current += 1;
      confirmationGeneration.current += 1;
      controller.abort();
    };
  }, [api, athleteId, demoOpen, environment, hasValidAthlete, requestKey, resolved.period]);

  const model = useMemo(() => (
    snapshot && selectedModel
      ? fitSnapshot(snapshot, selectedModel)
      : { fit: null, error: snapshot ? 'La curva no permite ajustar ECP ni Morton 3P.' : '' }
  ), [selectedModel, snapshot]);
  const modelFit = model.fit;
  const modelError = model.error;

  const retryLoad = useCallback(() => setRetryVersion((current) => current + 1), []);
  const chooseModel = useCallback((model: PowerDurationModel) => {
    confirmationGeneration.current += 1;
    setSelectedModel(model);
    setConfirmation(emptyConfirmation);
  }, []);

  const confirm = useCallback(async () => {
    if (!snapshot || !selectedModel || !modelFit || confirmation.status === 'saving') return;
    const generation = ++confirmationGeneration.current;
    setConfirmation({ status: 'saving', result: null, message: '' });
    try {
      const result = await api.confirm({
        snapshotId: snapshot.id,
        model: selectedModel,
        result: {
          cpWatts: modelFit.cpWatts,
          wPrimeJoules: modelFit.wPrimeJoules,
          pmaxWatts: modelFit.pmaxWatts,
          rmseWatts: modelFit.rmseWatts,
        },
      });
      if (generation !== confirmationGeneration.current) return;
      setConfirmation({ status: 'saved', result, message: '' });
    } catch (reason) {
      if (generation !== confirmationGeneration.current) return;
      setConfirmation({
        status: 'error',
        result: null,
        message: reason instanceof Error ? reason.message : 'No se pudo confirmar el análisis.',
      });
    }
  }, [api, confirmation.status, modelFit, selectedModel, snapshot]);

  if (demoOpen) return <SyntheticPowerDemo onClose={() => setDemoOpen(false)} />;

  if (!athleteId) {
    return (
      <section className="workspace workspace-empty">
        <h1>Selecciona un ciclista</h1>
        <p>Elige el ciclista activo en la barra superior para cargar su curva real.</p>
        <button type="button" className="secondary-action" onClick={() => setDemoOpen(true)}>Abrir demostración sintética</button>
      </section>
    );
  }

  if (!hasValidAthlete || resolved.error) {
    return (
      <section className="workspace workspace-empty" role="alert">
        <h1>El contexto de análisis no es válido</h1>
        <p>{resolved.error || 'Vuelve a seleccionar un ciclista autorizado.'}</p>
      </section>
    );
  }

  if ((loading || (!snapshot && !error)) && !snapshot) {
    return (
      <section className="workspace power-loading" aria-labelledby="power-loading-title">
        <h1 id="power-loading-title">Potencia y duración</h1>
        <p role="status">Cargando curva de potencia real…</p>
      </section>
    );
  }

  if (!snapshot) {
    const missingSnapshot = /no hay una curva sincronizada/i.test(error);
    return (
      <section className="workspace workspace-empty">
        <h1>{missingSnapshot ? 'No hay curva para este periodo' : 'No se pudo cargar la curva'}</h1>
        <p>{error}</p>
        <div className="power-empty-actions">
          <button
            type="button"
            className="primary-action"
            disabled={sync.status === 'running'}
            onClick={() => void synchronize()}
          >
            {sync.status === 'running' ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
          <button type="button" className="secondary-action" onClick={retryLoad}>Reintentar carga</button>
          <button type="button" className="text-action" onClick={() => setDemoOpen(true)}>Abrir demostración sintética</button>
        </div>
      </section>
    );
  }

  const availability = modelAvailability(snapshot.points);

  return (
    <section className="power-workspace">
      {sync.status === 'failed' && (
        <div className="power-context-warning" role="alert">
          Se muestra la última instantánea guardada. {sync.message}
        </div>
      )}
      {sync.status === 'partial' && (
        <div className="power-context-warning" role="status">{sync.message}</div>
      )}
      {loading && (
        <div className="power-context-warning" role="status">
          Actualizando la curva. Se mantiene visible la última instantánea guardada.
        </div>
      )}
      {error && (
        <div className="power-context-warning" role="alert">
          No se pudo actualizar la curva. Se muestra la última instantánea guardada. {error}
        </div>
      )}

      <fieldset className="power-model-selector">
        <legend>Modelo de potencia-duración</legend>
        <div className="power-model-options">
          <label>
            <input
              type="radio"
              name="power-model"
              value="ECP"
              checked={selectedModel === 'ECP'}
              disabled={!availability.ecp}
              onChange={() => chooseModel('ECP')}
            />
            <span><strong>ECP</strong><small>Prioriza los esfuerzos de 2 minutos o más.</small></span>
          </label>
          <label>
            <input
              type="radio"
              name="power-model"
              value="MORTON_3P"
              checked={selectedModel === 'MORTON_3P'}
              disabled={!availability.morton}
              onChange={() => chooseModel('MORTON_3P')}
            />
            <span><strong>Morton 3P</strong><small>Recomendado con cobertura corta y larga completa.</small></span>
          </label>
        </div>
      </fieldset>

      <PowerDurationView
        input={makeInput(snapshot)}
        model={selectedModel}
        fit={modelFit}
        fitError={modelError}
        ftp={snapshot.ftp}
        synchronizedAt={snapshot.synchronizedAt}
      />

      <footer className="power-confirmation">
        <div>
          <strong>Decisión profesional</strong>
          <p>Confirmar guarda este resultado como registro inmutable. No modifica zonas ni prescripciones.</p>
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={!selectedModel || !modelFit || confirmation.status === 'saving'}
          onClick={() => void confirm()}
        >
          {confirmation.status === 'saving' ? 'Confirmando…' : 'Confirmar análisis'}
        </button>
        {confirmation.status === 'saved' && confirmation.result && (
          <p className="confirmation-success" role="status">
            Análisis confirmado de forma inmutable el{' '}
            <time dateTime={confirmation.result.confirmedAt}>
              {new Date(confirmation.result.confirmedAt).toLocaleString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </time>.
          </p>
        )}
        {confirmation.status === 'error' && (
          <div className="confirmation-error" role="alert">
            <p>{confirmation.message}</p>
            <button type="button" className="secondary-action" onClick={() => void confirm()}>Reintentar confirmación</button>
          </div>
        )}
      </footer>
    </section>
  );
}
