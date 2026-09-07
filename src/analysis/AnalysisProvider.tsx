import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Observation } from '../domain/observation';
import {
  athleteApi as defaultApi,
  type AthleteApi,
  type AthleteDetail,
} from '../features/athletes/athleteApi';
import type { AthleteSummary } from '../features/athletes/AthleteSelector';
import { resolvePeriod } from './period';
import {
  ANALYSIS_PREFERENCES_STORAGE_KEY,
  loadAnalysisPreferences,
  saveAnalysisPreferences,
} from './preferences';
import type {
  AnalysisEnvironment,
  AnalysisPeriod,
  SyncState,
} from './types';
import { AnalysisContext, type AnalysisContextValue } from './AnalysisContext';

interface AnalysisProviderProps {
  children: ReactNode;
  api?: AthleteApi;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now?: () => Date;
  createSyncKey?: () => string;
}

const DEFAULT_PERIOD: AnalysisPeriod = { preset: 90 };
const EMPTY_SYNC: SyncState = { status: 'idle', synchronizedAt: null };

function warningMessage(warnings: readonly string[]) {
  const labels: Record<string, string> = {
    athlete: 'perfil',
    activities: 'actividades',
    power_curves: 'potencia',
    planned_workouts: 'entrenamientos',
  };
  const translated = warnings.map((warning) => labels[warning] ?? warning);
  return translated.length
    ? `Sincronización parcial: ${translated.join(', ')}`
    : 'Sincronización completada';
}

export function AnalysisProvider({
  children,
  api = defaultApi,
  storage = window.localStorage,
  now = () => new Date(),
  createSyncKey = () => crypto.randomUUID(),
}: AnalysisProviderProps) {
  const [athletes, setAthletes] = useState<AthleteSummary[]>([]);
  const [athleteId, setAthleteId] = useState('');
  const [athlete, setAthlete] = useState<AthleteDetail | null>(null);
  const [period, setPeriodState] = useState<AnalysisPeriod>(DEFAULT_PERIOD);
  const [environment, setEnvironmentState] = useState<AnalysisEnvironment>('all');
  const [sync, setSync] = useState<SyncState>(EMPTY_SYNC);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [loadingAthlete, setLoadingAthlete] = useState(false);
  const [error, setError] = useState('');
  const rosterReady = useRef(false);
  const [today] = useState(() => now().toISOString().slice(0, 10));
  const analysisGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const rosterGeneration = useRef(0);

  const loadRoster = useCallback(async () => {
    const generation = ++rosterGeneration.current;
    setLoadingRoster(true);
    setError('');
    try {
      const next = await api.list();
      if (generation !== rosterGeneration.current) return;
      setAthletes(next);
      if (!rosterReady.current) {
        rosterReady.current = true;
        const restored = loadAnalysisPreferences(storage, new Set(next.map((item) => item.id)));
        if (restored) {
          try {
            resolvePeriod(restored.period, today);
            setPeriodState(restored.period);
            setEnvironmentState(restored.environment);
            setAthleteId(restored.athleteId);
          } catch {
            storage.removeItem(ANALYSIS_PREFERENCES_STORAGE_KEY);
          }
        }
      } else if (athleteId && !next.some((item) => item.id === athleteId)) {
        analysisGeneration.current += 1;
        detailGeneration.current += 1;
        setAthleteId('');
        setAthlete(null);
        setSync(EMPTY_SYNC);
      }
    } catch (reason) {
      if (generation === rosterGeneration.current) {
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar la lista de ciclistas.');
      }
    } finally {
      if (generation === rosterGeneration.current) setLoadingRoster(false);
    }
  }, [api, athleteId, storage, today]);

  useEffect(() => {
    const generation = ++rosterGeneration.current;
    void api.list().then((next) => {
      if (generation !== rosterGeneration.current) return;
      setAthletes(next);
      rosterReady.current = true;
      const restored = loadAnalysisPreferences(storage, new Set(next.map((item) => item.id)));
      if (!restored) return;
      try {
        resolvePeriod(restored.period, today);
        setPeriodState(restored.period);
        setEnvironmentState(restored.environment);
        setLoadingAthlete(true);
        setAthleteId(restored.athleteId);
      } catch {
        try { storage.removeItem(ANALYSIS_PREFERENCES_STORAGE_KEY); } catch { /* Storage can be read-only. */ }
      }
    }).catch((reason: unknown) => {
      if (generation === rosterGeneration.current) {
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar la lista de ciclistas.');
      }
    }).finally(() => {
      if (generation === rosterGeneration.current) setLoadingRoster(false);
    });
    return () => {
      rosterGeneration.current += 1;
      analysisGeneration.current += 1;
      detailGeneration.current += 1;
    };
  }, [api, storage, today]);

  useEffect(() => {
    if (!athleteId) return;
    const generation = ++detailGeneration.current;
    const controller = new AbortController();
    void api.load(athleteId, controller.signal).then((next) => {
      if (generation === detailGeneration.current) setAthlete(next);
    }).catch((reason: unknown) => {
      if (generation === detailGeneration.current && !(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError('No se pudo cargar el ciclista.');
      }
    }).finally(() => {
      if (generation === detailGeneration.current) setLoadingAthlete(false);
    });
    return () => controller.abort();
  }, [api, athleteId]);

  useEffect(() => {
    if (!rosterReady.current || !athleteId || !athletes.some((item) => item.id === athleteId)) return;
    try {
      saveAnalysisPreferences(storage, { athleteId, period, environment });
    } catch {
      // Private browsing or storage policy must not block analysis.
    }
  }, [athleteId, athletes, environment, period, storage]);

  const selectAthlete = useCallback((id: string) => {
    const next = athletes.some((item) => item.id === id) ? id : '';
    analysisGeneration.current += 1;
    detailGeneration.current += 1;
    setAthleteId(next);
    setAthlete(null);
    setLoadingAthlete(Boolean(next));
    setSync(EMPTY_SYNC);
    setError('');
  }, [athletes]);

  const setPeriod = useCallback((next: AnalysisPeriod) => {
    resolvePeriod(next, today);
    analysisGeneration.current += 1;
    setPeriodState(next);
    setSync(EMPTY_SYNC);
    setError('');
  }, [today]);

  const setEnvironment = useCallback((next: AnalysisEnvironment) => {
    if (!['all', 'outdoor', 'indoor'].includes(next)) throw new Error('Entorno de análisis no válido.');
    analysisGeneration.current += 1;
    setEnvironmentState(next);
    setSync(EMPTY_SYNC);
    setError('');
  }, []);

  const synchronize = useCallback(async () => {
    if (!athleteId || !api.sync) return;
    const generation = analysisGeneration.current;
    const resolved = resolvePeriod(period, today);
    setSync({ status: 'running', synchronizedAt: sync.synchronizedAt });
    setError('');
    try {
      const result = await api.sync({
        athleteId,
        oldest: resolved.oldest,
        newest: resolved.newest,
        environment,
        syncKey: createSyncKey(),
      });
      if (generation !== analysisGeneration.current) return;
      const refreshed = await api.load(athleteId);
      if (generation !== analysisGeneration.current) return;
      setAthlete(refreshed);
      setSync({
        status: result.status,
        synchronizedAt: result.synchronizedAt,
        message: warningMessage(result.warnings),
      });
    } catch (reason) {
      if (generation !== analysisGeneration.current) return;
      const message = reason instanceof Error ? reason.message : 'No se pudo sincronizar el ciclista.';
      setError(message);
      setSync({ status: 'failed', synchronizedAt: sync.synchronizedAt, message });
    }
  }, [api, athleteId, createSyncKey, environment, period, sync.synchronizedAt, today]);

  const addObservation = useCallback(async (observation: Observation) => {
    if (!athlete || observation.athleteId !== athlete.id) return;
    setAthlete((current) => current ? { ...current, observations: [observation, ...current.observations] } : current);
    if (!api.createObservation) return;
    try {
      await api.createObservation(observation);
    } catch {
      setAthlete((current) => current
        ? { ...current, observations: current.observations.filter((item) => item.id !== observation.id) }
        : current);
      setError('La observación no se guardó y se ha retirado del historial.');
    }
  }, [api, athlete]);

  const value = useMemo<AnalysisContextValue>(() => ({
    athletes,
    athleteId,
    athlete,
    period,
    environment,
    today,
    sync,
    loadingRoster,
    loadingAthlete,
    error,
    selectAthlete,
    setPeriod,
    setEnvironment,
    synchronize,
    reloadRoster: loadRoster,
    addObservation,
    clearError: () => setError(''),
  }), [
    addObservation,
    athlete,
    athleteId,
    athletes,
    environment,
    error,
    loadRoster,
    loadingAthlete,
    loadingRoster,
    period,
    selectAthlete,
    setEnvironment,
    setPeriod,
    sync,
    synchronize,
    today,
  ]);

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}
