import { useState } from 'react';
import { resolvePeriod } from './period';
import { useAnalysis } from './AnalysisContext';
import type { AnalysisEnvironment, AnalysisPeriod } from './types';

const PRESET_OPTIONS = [30, 90, 180, 365] as const;

function initialCustomPeriod(period: AnalysisPeriod, today: string) {
  if (period.preset === 'custom') return { oldest: period.oldest, newest: period.newest };
  const resolved = resolvePeriod(period, today);
  return { oldest: resolved.oldest, newest: resolved.newest };
}

function validateCustomPeriod(oldest: string, newest: string, today: string) {
  try {
    resolvePeriod({ preset: 'custom', oldest, newest }, today);
    return '';
  } catch (reason) {
    return reason instanceof Error ? reason.message : 'Periodo personalizado no válido.';
  }
}

function formatSynchronizedAt(value: string) {
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function AnalysisContextBar() {
  const {
    athletes,
    athleteId,
    period,
    environment,
    today,
    sync,
    loadingRoster,
    error,
    selectAthlete,
    setPeriod,
    setEnvironment,
    synchronize,
  } = useAnalysis();
  const [customDraft, setCustomDraft] = useState<{ oldest: string; newest: string } | null>(null);
  const customPeriod = customDraft ?? initialCustomPeriod(period, today);
  const customError = period.preset === 'custom'
    ? validateCustomPeriod(customPeriod.oldest, customPeriod.newest, today)
    : '';

  function changePeriod(value: string) {
    if (value === 'custom') {
      const next = initialCustomPeriod(period, today);
      setCustomDraft(null);
      setPeriod({ preset: 'custom', ...next });
      return;
    }
    setCustomDraft(null);
    setPeriod({ preset: Number(value) as 30 | 90 | 180 | 365 });
  }

  function changeCustomDates(oldest: string, newest: string) {
    if (!validateCustomPeriod(oldest, newest, today)) {
      setPeriod({ preset: 'custom', oldest, newest });
    }
  }

  function updateOldest(value: string) {
    const next = { oldest: value, newest: customPeriod.newest };
    setCustomDraft(next);
    changeCustomDates(next.oldest, next.newest);
  }

  function updateNewest(value: string) {
    const next = { oldest: customPeriod.oldest, newest: value };
    setCustomDraft(next);
    changeCustomDates(next.oldest, next.newest);
  }

  const statusMessage = sync.status === 'complete' || sync.status === 'partial'
    ? sync.message
    : '';
  const cannotSynchronize = !athleteId || sync.status === 'running' || Boolean(customError);

  return (
    <section className="analysis-context" aria-label="Contexto común del análisis">
      <div className="analysis-context__fields">
        <label>
          <span>Ciclista activo</span>
          <select
            aria-label="Ciclista activo"
            value={athleteId}
            disabled={loadingRoster || !athletes.length}
            onChange={(event) => selectAthlete(event.target.value)}
          >
            <option value="">
              {loadingRoster ? 'Cargando ciclistas…' : athletes.length ? 'Selecciona un ciclista' : 'No hay ciclistas vinculados'}
            </option>
            {athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name}</option>)}
          </select>
        </label>

        <label>
          <span>Periodo</span>
          <select aria-label="Periodo" value={String(period.preset)} onChange={(event) => changePeriod(event.target.value)}>
            {PRESET_OPTIONS.map((days) => <option key={days} value={days}>{days} días</option>)}
            <option value="custom">Personalizado</option>
          </select>
        </label>

        {period.preset === 'custom' && (
          <div className="analysis-context__dates">
            <label>
              <span>Fecha inicial</span>
              <input type="date" aria-label="Fecha inicial" value={customPeriod.oldest} max={today} onChange={(event) => updateOldest(event.target.value)} />
            </label>
            <label>
              <span>Fecha final</span>
              <input type="date" aria-label="Fecha final" value={customPeriod.newest} max={today} onChange={(event) => updateNewest(event.target.value)} />
            </label>
          </div>
        )}

        <label>
          <span>Entorno</span>
          <select
            aria-label="Entorno"
            value={environment}
            onChange={(event) => setEnvironment(event.target.value as AnalysisEnvironment)}
          >
            <option value="all">Todos</option>
            <option value="outdoor">Exterior</option>
            <option value="indoor">Interior</option>
          </select>
        </label>
      </div>

      <div className="analysis-context__action">
        <button
          type="button"
          className="primary-action"
          disabled={cannotSynchronize}
          onClick={() => void synchronize()}
        >
          {sync.status === 'running' ? 'Sincronizando…' : 'Sincronizar con Intervals.icu'}
        </button>
        <p className="analysis-context__timestamp">
          {sync.synchronizedAt
            ? `Última sincronización: ${formatSynchronizedAt(sync.synchronizedAt)}`
            : 'Todavía sin sincronizar'}
        </p>
      </div>

      {customError && <p className="analysis-context__message field-error" role="alert">{customError}</p>}
      {!customError && sync.status === 'failed' && <p className="analysis-context__message field-error" role="alert">{sync.message}</p>}
      {!customError && sync.status !== 'failed' && error && <p className="analysis-context__message field-error" role="alert">{error}</p>}
      {statusMessage && <p className="analysis-context__message connection-summary" role="status">{statusMessage}</p>}
    </section>
  );
}
