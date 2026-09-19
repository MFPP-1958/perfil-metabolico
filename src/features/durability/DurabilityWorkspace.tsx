import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnalysis } from '../../analysis/AnalysisContext';
import { resolvePeriod } from '../../analysis/period';
import { snapshotFitsPeriod, staleWindowNotice, type WindowKind } from '../../analysis/snapshotWindow';
import type { AnalysisEnvironment, ResolvedPeriod } from '../../analysis/types';
import { DurabilityDemo } from '../../app/DemoViews';
import { DurabilityView } from './DurabilityView';
import {
  durabilityApi as defaultDurabilityApi,
  type ConfirmedDurabilityAnalysis,
  type DurabilityApi,
  type DurabilitySnapshotResponse,
} from './durabilityApi';

interface LoadState {
  key: string;
  error: string;
  snapshot: DurabilitySnapshotResponse | null;
}

interface ConfirmationState {
  status: 'idle' | 'saving' | 'saved' | 'error';
  result: ConfirmedDurabilityAnalysis | null;
  message: string;
}

const INTERNAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emptyLoad: LoadState = { key: '', error: '', snapshot: null };
const emptyConfirmation: ConfirmationState = { status: 'idle', result: null, message: '' };

function snapshotMatches(
  snapshot: DurabilitySnapshotResponse | null,
  athleteId: string,
  period: ResolvedPeriod,
  environment: DurabilitySnapshotResponse['environment'],
  kind: WindowKind,
) {
  return Boolean(
    snapshot
    && snapshot.athleteId === athleteId
    && snapshot.environment === environment
    && snapshotFitsPeriod(snapshot, period, kind),
  );
}

function confirmedSnapshot(
  snapshot: DurabilitySnapshotResponse,
  confirmation: ConfirmedDurabilityAnalysis | null,
): DurabilitySnapshotResponse {
  if (!confirmation) return snapshot;
  return {
    ...snapshot,
    result: {
      algorithmVersion: confirmation.algorithmVersion,
      rows: confirmation.comparisons,
      coverage: confirmation.quality.coverage,
      warnings: confirmation.quality.warnings,
    },
  };
}

function environmentNote(environment: AnalysisEnvironment) {
  if (environment === 'all') return null;
  return `Tienes puesto el filtro «${environment === 'indoor' ? 'Rodillo' : 'Exterior'}», y cada entorno se sincroniza por separado. Prueba con todos los entornos o sincroniza este.`;
}

export function DurabilityWorkspace({ api = defaultDurabilityApi }: { api?: DurabilityApi }) {
  const { athleteId, period, environment, today, sync, setEnvironment } = useAnalysis();
  const [loadState, setLoadState] = useState<LoadState>(emptyLoad);
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
  // Un preajuste («los últimos 90 días») termina hoy, así que su ventana se
  // desplaza a diario; un periodo personalizado nombra dos fechas y no se mueve.
  const windowKind: WindowKind = period.preset === 'custom' ? 'fixed' : 'rolling';
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
    resolved.period,
    environment,
    windowKind,
  ) ? loadState.snapshot : null;
  const loading = Boolean(requestKey) && loadState.key !== requestKey;
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
      window: windowKind,
    }, controller.signal).then((next) => {
      if (generation !== requestGeneration.current || controller.signal.aborted) return;
      setLoadState({ key: requestKey, error: '', snapshot: next });
      setConfirmation(emptyConfirmation);
    }).catch((reason: unknown) => {
      if (generation !== requestGeneration.current || controller.signal.aborted) return;
      setLoadState((current) => ({
        key: requestKey,
        error: reason instanceof Error ? reason.message : 'No se pudo cargar Durabilidad.',
        snapshot: snapshotMatches(
          current.snapshot,
          athleteId,
          resolved.period!,
          environment,
          windowKind,
        ) ? current.snapshot : null,
      }));
      setConfirmation(emptyConfirmation);
    });

    return () => {
      requestGeneration.current += 1;
      confirmationGeneration.current += 1;
      controller.abort();
    };
  }, [api, athleteId, demoOpen, environment, hasValidAthlete, requestKey, resolved.period, windowKind]);

  const retryLoad = useCallback(() => setRetryVersion((current) => current + 1), []);
  const confirmationNeedsReload = confirmation.status === 'error'
    && /desactualizado|vuelve a cargarlo/i.test(confirmation.message);
  const confirm = useCallback(async () => {
    if (!compatibleSnapshot || confirmation.status === 'saving' || confirmation.status === 'saved') return;
    const generation = ++confirmationGeneration.current;
    setConfirmation({ status: 'saving', result: null, message: '' });
    try {
      const result = await api.confirm({ snapshotId: compatibleSnapshot.id });
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
  }, [api, compatibleSnapshot, confirmation.status]);

  if (demoOpen) return <DurabilityDemo onClose={() => setDemoOpen(false)} />;

  if (!athleteId) {
    return (
      <section className="workspace workspace-empty">
        <h1>Selecciona un ciclista</h1>
        <p>Elige el ciclista activo en la barra superior para cargar su Durabilidad real.</p>
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

  if ((loading || (!compatibleSnapshot && !error)) && !compatibleSnapshot) {
    return (
      <section className="workspace durability-loading" aria-labelledby="durability-loading-title">
        <h1 id="durability-loading-title">Durabilidad</h1>
        <p role="status">Cargando Durabilidad real…</p>
      </section>
    );
  }

  if (!compatibleSnapshot) {
    const missingSnapshot = /no hay un análisis de durabilidad sincronizado/i.test(error);
    return (
      <section className="workspace workspace-empty">
        <h1>{missingSnapshot ? 'No hay datos de Durabilidad' : 'No se pudo cargar Durabilidad'}</h1>
        <p>{error}</p>
        {missingSnapshot && (
          <p>Usa el botón «Sincronizar con Intervals.icu» de la barra superior y vuelve cuando termine.</p>
        )}
        {environmentNote(environment) && <p>{environmentNote(environment)}</p>}
        <div className="durability-empty-actions">
          {environment !== 'all' && (
            <button type="button" className="primary-action" onClick={() => setEnvironment('all')}>Ver todos los entornos</button>
          )}
          <button type="button" className="secondary-action" onClick={retryLoad}>Reintentar carga</button>
          <button type="button" className="text-action" onClick={() => setDemoOpen(true)}>Abrir demostración sintética</button>
        </div>
      </section>
    );
  }

  const visibleSnapshot = confirmedSnapshot(compatibleSnapshot, confirmation.result);
  // La instantánea puede ser de días antes, así que se dice qué cubre de verdad.
  const windowNotice = resolved.period
    ? staleWindowNotice(compatibleSnapshot, resolved.period)
    : null;
  const coverageInsufficient = compatibleSnapshot.result.coverage === 'insufficient';
  const cannotConfirm = coverageInsufficient || confirmationNeedsReload;

  return (
    <section className="durability-workspace">
      {sync.status === 'failed' && (
        <div className="durability-context-warning" role="alert">
          Se muestra la última instantánea guardada. {sync.message}
        </div>
      )}
      {sync.status === 'partial' && (
        <div className="durability-context-warning" role="status">{sync.message}</div>
      )}
      {windowNotice && (
        <div className="durability-context-warning" role="status">{windowNotice}</div>
      )}
      {loading && (
        <div className="durability-context-warning" role="status">
          Actualizando Durabilidad. Se mantiene visible la última instantánea guardada.
        </div>
      )}
      {error && (
        <div className="durability-context-warning" role="alert">
          No se pudo actualizar Durabilidad. Se muestra la última instantánea guardada. {error}
        </div>
      )}

      <DurabilityView snapshot={visibleSnapshot} />

      <footer className="durability-confirmation">
        <div>
          <strong>Decisión profesional</strong>
          <p>Confirmar guarda el cálculo del servidor como registro inmutable. No modifica zonas ni prescripciones.</p>
          {coverageInsufficient && <p>La cobertura es insuficiente para confirmar este análisis.</p>}
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={cannotConfirm || confirmation.status === 'saving' || confirmation.status === 'saved'}
          onClick={() => void confirm()}
        >
          {confirmation.status === 'saving'
            ? 'Confirmando…'
            : confirmation.status === 'saved' ? 'Análisis confirmado' : 'Confirmar análisis'}
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
            {confirmationNeedsReload ? (
              <button type="button" className="secondary-action" onClick={retryLoad}>Recargar análisis</button>
            ) : (
              <button type="button" className="secondary-action" onClick={() => void confirm()}>Reintentar confirmación</button>
            )}
          </div>
        )}
      </footer>
    </section>
  );
}
