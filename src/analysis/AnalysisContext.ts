import { createContext, useContext } from 'react';
import type { Observation } from '../domain/observation';
import type { AthleteDetail } from '../features/athletes/athleteApi';
import type { AthleteSummary } from '../features/athletes/AthleteSelector';
import type { AnalysisEnvironment, AnalysisPeriod, SyncState } from './types';

export interface AnalysisContextValue {
  athletes: readonly AthleteSummary[];
  athleteId: string;
  athlete: AthleteDetail | null;
  period: AnalysisPeriod;
  environment: AnalysisEnvironment;
  today: string;
  sync: SyncState;
  loadingRoster: boolean;
  loadingAthlete: boolean;
  error: string;
  selectAthlete(id: string): void;
  setPeriod(period: AnalysisPeriod): void;
  setEnvironment(environment: AnalysisEnvironment): void;
  synchronize(): Promise<void>;
  reloadRoster(): Promise<void>;
  /** Resuelve a cierto solo cuando el servidor ha aceptado y guardado la observación. */
  addObservation(observation: Observation): Promise<boolean>;
  /** Guarda varios valores de una vez; o entran todos o ninguno. Resuelve a cierto si el servidor los aceptó. */
  addObservations(observations: Observation[]): Promise<boolean>;
  /** Retira un valor erróneo con su motivo, sin borrarlo del historial. */
  retractObservation(observationId: string, reason: string): Promise<boolean>;
  clearError(): void;
}

export const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function useAnalysis() {
  const context = useContext(AnalysisContext);
  if (!context) throw new Error('useAnalysis debe utilizarse dentro de AnalysisProvider.');
  return context;
}
